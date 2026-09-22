import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db, invalidateCachePrefix } from '@/lib/db'
import { checkRateLimit } from '@/lib/rate-limit'

// v34: استرجاع الفواتير الممسوحة بحذف المشروع (Cascade) من مصدرين — اليتيمة تُسترجع «بدون مشروع»
// ---------------------------------------------------------------------
// المصدر 1 — سجل التدقيق (entity='cost', action='create'): تنجو سجلاته دائماً
//   (علاقتها بالمشروع اختيارية → SetNull) وتحمل entityId = معرف الفاتورة الأصلي.
//   فجواته: الفواتير قبل 2026-07-27 (قبل التفعيل) وفترة 2026-08-24 → 2026-08-30 (حُذف كود السجل بالخطأ).
//
// المصدر 2 (v34) — سجل الإشعارات (type='cost_overrun'): كل فاتورة مسجلة منذ 2026-07-27
//   أنشأت إشعاراً يحمل التصنيف والوصف والمبلغ والتاريخ، والإشعارات لا تُحذف أبداً ونجوت
//   من حذف المشاريع (projectId اختياري → SetNull). صيغتان تاريخيتان للرسالة:
//   «... بمبلغ X ريال عماني» (07-27→08-24 و 09-02→الآن) و «... بمبلغ X ر.ع» (08-30→09-02).
//   - الإشعارات حتى 2026-09-13 بلا entityId → تُسترجع بمعرف حتمي 'r-<notifId>' (idempotent).
//   - بعدها صف لكل مستلم بنفس entityId → تُجمَّع حسب entityId فلا تتكرر.
//   - حماية التكرار بين المصدرين: توقيع (تصنيف|مبلغ|وصف) — إن كان سجل التدقيق سيسترجع
//     نفس الفاتورة بمعرفها الأصلي يُتجاهل مرشّح الإشعار.
//
// POST /api/admin/restore-costs  { dryRun?: boolean, defaultProjectId?: string }
// - يعيد إنشاء الفواتير المفقودة بنفس المعرف الأصلي إن توفر، وإلا معرف حتمي ثابت (idempotent).
// - الفواتير المحذوفة عمداً (لها سجل delete فردي) لا تُسترجع احتراماً للقصد.
// - الفواتير اليتيمة (مشروعها الأصلي محذوف) تُسترجع بلا مشروع (v32) أو تُسند إلى defaultProjectId إن أُرسل.
// - v33: يفحص مباشرة أن ترقية v32 (Cost.projectId اختياري) مطبقة في قاعدة البيانات ويكشف حالتها صراحة.

var COST_CATEGORIES = ['labor', 'housing', 'transport', 'fuel', 'maintenance', 'parts', 'oil', 'safety', 'rental', 'other']

function parseCostDetails(details: string): { category: string; description: string; amount: number } | null {
  // الصيغة المعتمدة في POST /api/costs — المبلغ من النهاية (الوصف قد يحتوي أقواساً)
  var m = /^Created cost: ([A-Za-z]+) - ([\s\S]*) \(([\d.]+) OMR\)$/.exec(details || '')
  if (!m) return null
  var amount = parseFloat(m[3])
  if (!Number.isFinite(amount) || amount <= 0) return null
  return { category: m[1], description: m[2], amount: amount }
}

// v34: تحليل رسالة الإشعار — يدعم الصيغ التاريخية كلها
function parseCostMessage(message: string): { category: string; description: string; amount: number } | null {
  var m = /^تم إضافة تكلفة: ([A-Za-z]+) - ([\s\S]*) بمبلغ ([\d.]+) (?:ريال عماني|ر\.ع|OMR)$/.exec((message || '').trim())
  if (!m) return null
  var amount = parseFloat(m[3])
  if (!Number.isFinite(amount) || amount <= 0) return null
  return { category: m[1], description: m[2], amount: amount }
}

export async function POST(req: NextRequest) {
  var user = await getAuthUser(req)
  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  // للإدارة العليا ومدير النظام فقط — العملية تُنشئ سجلات مالية
  var isSystemAdmin = (user.email || '').toLowerCase().trim() === 'admin@axis.om'
  if (user.role !== 'top_management' && !isSystemAdmin) {
    return NextResponse.json({ error: 'forbidden', message: 'استرجاع الفواتير متاح للإدارة العليا فقط' }, { status: 403 })
  }

  var rl = checkRateLimit(req, { maxRequests: 5, windowSeconds: 300, keyPrefix: 'restore-costs' })
  if (rl.limited) {
    return NextResponse.json(
      { error: 'too_many_requests', message: 'طلبات كثيرة جداً — حاول بعد قليل' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    )
  }

  try {
    var body: any = {}
    try { body = await req.json() } catch (e) { body = {} }
    var dryRun = !!body.dryRun
    var defaultProjectId = body.defaultProjectId ? String(body.defaultProjectId) : ''

    // 1) سجلات إنشاء الفواتير من سجل التدقيق — تنجو من حذف المشاريع
    var createLogs = await db.auditLog.findMany({
      where: { action: 'create', entity: 'cost' },
      orderBy: { createdAt: 'asc' },
    })

    // 2) الفواتير المحذوفة عمداً — لها سجل حذف فردي؛ نحترم القصد ولا نسترجعها
    var deleteLogs = await db.auditLog.findMany({
      where: { action: 'delete', entity: 'cost' },
      select: { entityId: true },
    })
    var deliberatelyDeleted: Record<string, boolean> = {}
    for (var d = 0; d < deleteLogs.length; d++) deliberatelyDeleted[deleteLogs[d].entityId] = true

    // 3) الفواتير الموجودة حالياً
    var existingCosts = await db.cost.findMany({ select: { id: true } })
    var existingIds: Record<string, boolean> = {}
    for (var ex = 0; ex < existingCosts.length; ex++) existingIds[existingCosts[ex].id] = true

    // 4) المشاريع القائمة
    var projectsRows = await db.project.findMany({ select: { id: true } })
    var projectIds: Record<string, boolean> = {}
    for (var pr = 0; pr < projectsRows.length; pr++) projectIds[projectsRows[pr].id] = true
    var hasDefault = defaultProjectId !== '' && !!projectIds[defaultProjectId]

    // v33: فحص مباشر لقاعدة البيانات — هل أصبح عمود Cost.projectId اختيارياً (ترقية v32 مطبقة)؟
    var migrationApplied: any = null
    try {
      var colInfo: any = await db.$queryRaw`SELECT is_nullable FROM information_schema.columns WHERE table_name = 'Cost' AND column_name = 'projectId'`
      migrationApplied = !!(colInfo && colInfo.length > 0 && String(colInfo[0].is_nullable) === 'YES')
    } catch (e) { migrationApplied = null }

    // 5) v34: إشعارات إنشاء الفواتير — المصدر الثاني (لا تُحذف أبداً وتنجو من حذف المشاريع)
    var notifRows = await db.notification.findMany({
      where: { type: 'cost_overrun' },
      orderBy: { createdAt: 'asc' },
    })

    var scan = {
      createLogs: createLogs.length,
      notifLogs: notifRows.length,
      existing: 0,
      deliberatelyDeleted: 0,
      restorable: 0,
      orphaned: 0,
      invalid: 0,
      notifInvalid: 0,
      notifDup: 0,
      notifNoEntityId: 0,
      notifExisting: 0,
      notifCrossSkipped: 0,
    }
    // التغطية الزمنية للمصدرين (الصفوف مرتبة تصاعدياً بالتاريخ)
    var coverage = {
      oldest: createLogs.length ? new Date(createLogs[0].createdAt).toISOString() : '',
      newest: createLogs.length ? new Date(createLogs[createLogs.length - 1].createdAt).toISOString() : '',
      notifOldest: notifRows.length ? new Date(notifRows[0].createdAt).toISOString() : '',
      notifNewest: notifRows.length ? new Date(notifRows[notifRows.length - 1].createdAt).toISOString() : '',
    }
    var orphans: Array<{ entityId: string; date: string; category: string; description: string; amount: number }> = []
    var restored: string[] = []
    var errors: string[] = []
    var notifRestorable = 0

    // المرشح الموحد: { key, source, projectIdStr, dateISO, category, description, amount, orphan }
    var candidates: Array<{ key: string; source: string; projectIdStr: string; dateISO: string; category: string; description: string; amount: number; orphan: boolean }> = []
    // توقيعات مرشحي سجل التدقيق — لمنع الاسترجاع المزدوج لنفس الفاتورة من المصدرين
    var auditSignatures: Record<string, boolean> = {}

    // ── المرحلة أ: مرشحون من سجل التدقيق ──
    for (var i = 0; i < createLogs.length; i++) {
      var log = createLogs[i]
      var costId = String(log.entityId || '')
      if (!costId) continue
      if (existingIds[costId]) { scan.existing++; continue }
      if (deliberatelyDeleted[costId]) { scan.deliberatelyDeleted++; continue }
      var parsed = parseCostDetails(String(log.details || ''))
      if (!parsed) { scan.invalid++; continue }

      var targetProjectId = log.projectId && projectIds[String(log.projectId)] ? String(log.projectId) : ''
      var wasOrphan = false
      if (!targetProjectId) {
        wasOrphan = true
        if (hasDefault) targetProjectId = defaultProjectId
        scan.orphaned++
        orphans.push({
          entityId: costId,
          date: new Date(log.createdAt).toISOString(),
          category: parsed.category,
          description: parsed.description,
          amount: parsed.amount,
        })
      }

      scan.restorable++
      auditSignatures[parsed.category + '|' + parsed.amount + '|' + parsed.description.trim()] = true
      candidates.push({
        key: costId,
        source: 'audit',
        projectIdStr: targetProjectId,
        dateISO: new Date(log.createdAt).toISOString(),
        category: parsed.category,
        description: parsed.description,
        amount: parsed.amount,
        orphan: wasOrphan,
      })
    }

    // ── المرحلة ب: مرشحون من الإشعارات (v34) ──
    var seenEntity: Record<string, boolean> = {}
    var seenMsgTime: Record<string, boolean> = {}
    for (var n = 0; n < notifRows.length; n++) {
      var nt = notifRows[n]
      var np = parseCostMessage(String(nt.message || ''))
      if (!np) { scan.notifInvalid++; continue }

      var key: string
      if (nt.entityId) {
        // الإشعارات الحديثة (بعد 2026-09-13): صف لكل مستلم بنفس entityId — نأخذ واحداً فقط
        var eid = String(nt.entityId)
        if (seenEntity[eid]) { scan.notifDup++; continue }
        seenEntity[eid] = true
        key = eid
      } else {
        // الإشعارات القديمة (07-27 → 09-13) بلا entityId — نُميّز بنص الرسالة + لحظة الإنشاء
        var mt = String(nt.message || '') + '@' + new Date(nt.createdAt).toISOString()
        if (seenMsgTime[mt]) { scan.notifDup++; continue }
        seenMsgTime[mt] = true
        key = 'r-' + String(nt.id) // معرف حتمي ثابت → إعادة تشغيل الاسترجاع لا تكرر شيئاً
        scan.notifNoEntityId++
      }

      if (existingIds[key]) { scan.notifExisting++; continue }
      if (deliberatelyDeleted[key]) { scan.deliberatelyDeleted++; continue }
      // إن كان سجل التدقيق سيسترجع نفس الفاتورة بمعرفها الأصلي فلا حاجة لمرشّح الإشعار
      var sig = np.category + '|' + np.amount + '|' + np.description.trim()
      if (auditSignatures[sig]) { scan.notifCrossSkipped++; continue }

      var targetProjectId2 = nt.projectId && projectIds[String(nt.projectId)] ? String(nt.projectId) : ''
      var wasOrphan2 = false
      if (!targetProjectId2) {
        wasOrphan2 = true
        if (hasDefault) targetProjectId2 = defaultProjectId
        scan.orphaned++
        orphans.push({
          entityId: key,
          date: new Date(nt.createdAt).toISOString(),
          category: np.category,
          description: np.description,
          amount: np.amount,
        })
      }

      scan.restorable++
      notifRestorable++
      candidates.push({
        key: key,
        source: 'notification',
        projectIdStr: targetProjectId2,
        dateISO: new Date(nt.createdAt).toISOString(),
        category: np.category,
        description: np.description,
        amount: np.amount,
        orphan: wasOrphan2,
      })
    }

    // ── المرحلة ج: التنفيذ الفعلي ──
    for (var c = 0; c < candidates.length; c++) {
      var cand = candidates[c]
      if (dryRun) continue

      try {
        await db.cost.create({
          data: {
            id: cand.key,
            projectId: cand.projectIdStr || null, // v32: بلا مشروع إن لم يوجد بديل
            date: new Date(cand.dateISO),
            category: COST_CATEGORIES.indexOf(cand.category) !== -1 ? cand.category : 'other',
            description: cand.description.slice(0, 1000) || 'فاتورة مسترجعة',
            amount: cand.amount,
            notes: (cand.source === 'notification' ? 'مسترجعة من سجل الإشعارات' : 'مسترجعة من سجل التدقيق')
              + (cand.orphan
                ? ' — المشروع الأصلي محذوف فاستُرجعت بلا مشروع؛ أسندها لمشروع بالتعديل وعدّل التاريخ إن لزم'
                : ' — عدّل التاريخ يدوياً إن لزم'),
          },
        })
        restored.push(cand.key)
        db.auditLog.create({
          data: {
            userId: user.id,
            projectId: cand.projectIdStr || null,
            action: 'create',
            entity: 'cost',
            entityId: cand.key,
            details: (cand.source === 'notification' ? 'استرجاع فاتورة من سجل الإشعارات' : 'استرجاع فاتورة من سجل التدقيق')
              + ' (كانت ممسوحة بحذف مشروع): ' + cand.category + ' - ' + cand.description.slice(0, 200) + ' (' + cand.amount + ' OMR)',
          },
        }).catch(function() {})
      } catch (err: any) {
        errors.push(cand.key + ': ' + (err && err.message ? err.message : 'فشل الإنشاء'))
      }
    }

    if (!dryRun && restored.length > 0) {
      // إبطال كاش اللوحة كي تظهر الفواتير المسترجعة في الأرقام فوراً
      invalidateCachePrefix('dashboard:')
      db.auditLog.create({
        data: {
          userId: user.id,
          action: 'create',
          entity: 'cost',
          entityId: 'restore-batch-' + Date.now(),
          details: 'استرجاع دفعة: ' + restored.length + ' فاتورة'
            + (notifRestorable > 0 ? ' (منها ' + notifRestorable + ' من سجل الإشعارات)' : '')
            + ' (بواسطة ' + (user.name || user.email) + ')',
        },
      }).catch(function() {})
    }

    return NextResponse.json({
      dryRun: dryRun,
      scan: scan,
      migrationApplied: migrationApplied,
      coverage: coverage,
      notifRestorable: notifRestorable,
      restoredCount: restored.length,
      restored: restored,
      orphans: orphans,
      errors: errors,
      message: dryRun
        ? (migrationApplied === false
            ? 'تنبيه: ترقية قاعدة البيانات (v32) غير مطبقة بعد — الاسترجاع سيفشل حتى إعادة النشر الناجحة في Netlify'
            : 'الفحص جاهز — ' + scan.restorable + ' فاتورة قابلة للاسترجاع'
              + (notifRestorable > 0 ? ' (منها ' + notifRestorable + ' من سجل الإشعارات)' : '')
              + (scan.orphaned > 0 ? ' (منها ' + scan.orphaned + ' ستُسترجع بلا مشروع)' : ''))
        : (restored.length > 0
            ? 'تم استرجاع ' + restored.length + ' فاتورة بنجاح' + (scan.orphaned > 0 ? ' (منها ' + scan.orphaned + ' بلا مشروع)' : '')
            : (migrationApplied === false
                ? 'لم تُسترجع أي فاتورة — السبب المؤكد: ترقية قاعدة البيانات (v32) غير مطبقة بعد. أعد النشر وتأكد من نجاح البناء في Netlify (البناء يطبق الترقية تلقائياً) ثم أعد المحاولة'
                : (errors.length > 0
                    ? 'لم تُسترجع أي فاتورة — فشل إنشاء ' + errors.length + ' فاتورة (التفاصيل ظاهرة الآن في النافذة)'
                    : (scan.createLogs === 0 && scan.notifLogs === 0
                        ? 'لا يوجد أي أثر للفواتير في سجل التدقيق أو الإشعارات — الفواتير المسجلة قبل 2026-07-27 (قبل تفعيل التسجيل) لا يمكن استرجاعها إلا عبر نسخة Supabase الاحتياطية'
                        : 'لا توجد فواتير قابلة للاسترجاع — راجع أرقام الفحص في النافذة')))),
    })
  } catch (error: any) {
    console.error('[restore-costs] failed:', error)
    return NextResponse.json(
      { error: 'restore_failed', message: 'فشل استرجاع الفواتير — راجع سجلات الخادم' },
      { status: 500 }
    )
  }
}
