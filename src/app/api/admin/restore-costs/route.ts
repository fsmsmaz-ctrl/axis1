import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db, invalidateCachePrefix } from '@/lib/db'
import { checkRateLimit } from '@/lib/rate-limit'

// v32: استرجاع الفواتير الممسوحة بحذف المشروع (Cascade) من سجل التدقيق — اليتيمة تُسترجع «بدون مشروع»
// ---------------------------------------------------------------------
// الجذر: حذف مشروع يحتوي فواتير يمسحها نهائياً عبر onDelete: Cascade دون أي
// سجل حذف فردي. لكن سجلات التدقيق الخاصة بإنشاء الفواتير (entity='cost',
// action='create') تنجو دائماً (علاقتها بالمشروع اختيارية → SetNull)، وتحمل:
//   entityId = معرف الفاتورة الأصلي
//   details  = 'Created cost: <category> - <description> (<amount> OMR)'
//   createdAt = لحظة التسجيل الأصلية
//   projectId = المشروع (يصبح null إذا حُذف المشروع نفسه)
// POST /api/admin/restore-costs  { dryRun?: boolean, defaultProjectId?: string }
// - يعيد إنشاء الفواتير المفقودة بنفس المعرف الأصلي (idempotent).
// - الفواتير المحذوفة عمداً (لها سجل delete فردي) لا تُسترجع احتراماً للقصد.
// - الفواتير اليتيمة (مشروعها الأصلي محذوف) تُسترجع بلا مشروع (v32) أو تُسند إلى defaultProjectId إن أُرسل.

var COST_CATEGORIES = ['labor', 'housing', 'transport', 'fuel', 'maintenance', 'parts', 'oil', 'safety', 'rental', 'other']

function parseCostDetails(details: string): { category: string; description: string; amount: number } | null {
  // الصيغة المعتمدة في POST /api/costs — المبلغ من النهاية (الوصف قد يحتوي أقواساً)
  var m = /^Created cost: ([A-Za-z]+) - ([\s\S]*) \(([\d.]+) OMR\)$/.exec(details || '')
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

    // 1) سجلات إنشاء الفواتير — تنجو من حذف المشاريع
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
    // إن لم تُطبق الترقية بعد فإن كل محاولات الإنشاء بمعرف مشروع فارغ ستفشل — نكشف ذلك هنا بدل الفشل الصامت
    var migrationApplied: any = null
    try {
      var colInfo: any = await db.$queryRaw`SELECT is_nullable FROM information_schema.columns WHERE table_name = 'Cost' AND column_name = 'projectId'`
      migrationApplied = !!(colInfo && colInfo.length > 0 && String(colInfo[0].is_nullable) === 'YES')
    } catch (e) { migrationApplied = null }

    var scan = { createLogs: createLogs.length, existing: 0, deliberatelyDeleted: 0, restorable: 0, orphaned: 0, invalid: 0 }
    // v33: التغطية الزمنية لسجل التدقيق (الأقدم/الأحدث) — createLogs مرتبة تصاعدياً بالتاريخ
    var coverage = {
      oldest: createLogs.length ? new Date(createLogs[0].createdAt).toISOString() : '',
      newest: createLogs.length ? new Date(createLogs[createLogs.length - 1].createdAt).toISOString() : '',
    }
    var orphans: Array<{ entityId: string; date: string; category: string; description: string; amount: number }> = []
    var restored: string[] = []
    var errors: string[] = []

    for (var i = 0; i < createLogs.length; i++) {
      var log = createLogs[i]
      var costId = String(log.entityId || '')
      if (!costId) continue
      if (existingIds[costId]) { scan.existing++; continue }
      if (deliberatelyDeleted[costId]) { scan.deliberatelyDeleted++; continue }
      var parsed = parseCostDetails(String(log.details || ''))
      if (!parsed) { scan.invalid++; continue }

      // تحديد المشروع: الأصلي إن كان قائماً، وإلا المشروع الافتراضي للفواتير اليتيمة
      var targetProjectId = log.projectId && projectIds[String(log.projectId)] ? String(log.projectId) : ''
      var wasOrphan = false
      if (!targetProjectId) {
        wasOrphan = true
        // v32: اليتيمة تُسترجع بلا مشروع (projectId فارغ) ما لم يُختر مشروع أسناد
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
      if (dryRun) continue

      try {
        await db.cost.create({
          data: {
            id: costId,
            projectId: targetProjectId || null, // v32: بلا مشروع إن لم يوجد بديل
            date: new Date(log.createdAt),
            category: COST_CATEGORIES.indexOf(parsed.category) !== -1 ? parsed.category : 'other',
            description: parsed.description.slice(0, 1000) || 'فاتورة مسترجعة',
            amount: parsed.amount,
            notes: wasOrphan
              ? 'مسترجعة من سجل التدقيق — المشروع الأصلي محذوف فاستُرجعت بلا مشروع؛ أسندها لمشروع بالتعديل وعدّل التاريخ إن لزم'
              : 'مسترجعة من سجل التدقيق — تاريخ الفاتورة الأصلي غير مسجل في السجل (عدّله يدوياً إن لزم)',
          },
        })
        restored.push(costId)
        db.auditLog.create({
          data: {
            userId: user.id,
            projectId: targetProjectId || null,
            action: 'create',
            entity: 'cost',
            entityId: costId,
            details: 'استرجاع فاتورة من سجل التدقيق (كانت ممسوحة بحذف مشروع): ' + parsed.category + ' - ' + parsed.description.slice(0, 200) + ' (' + parsed.amount + ' OMR)',
          },
        }).catch(function() {})
      } catch (err: any) {
        errors.push(costId + ': ' + (err && err.message ? err.message : 'فشل الإنشاء'))
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
          details: 'استرجاع دفعة: ' + restored.length + ' فاتورة من سجل التدقيق (بواسطة ' + (user.name || user.email) + ')',
        },
      }).catch(function() {})
    }

    return NextResponse.json({
      dryRun: dryRun,
      scan: scan,
      migrationApplied: migrationApplied,
      coverage: coverage,
      restoredCount: restored.length,
      restored: restored,
      orphans: orphans,
      errors: errors,
      message: dryRun
        ? (migrationApplied === false
            ? 'تنبيه: ترقية قاعدة البيانات (v32) غير مطبقة بعد — الاسترجاع سيفشل حتى إعادة النشر الناجحة في Netlify'
            : 'الفحص جاهز — ' + scan.restorable + ' فاتورة قابلة للاسترجاع' + (scan.orphaned > 0 ? ' (منها ' + scan.orphaned + ' ستُسترجع بلا مشروع)' : ''))
        : (restored.length > 0
            ? 'تم استرجاع ' + restored.length + ' فاتورة بنجاح' + (scan.orphaned > 0 ? ' (منها ' + scan.orphaned + ' بلا مشروع)' : '')
            : (migrationApplied === false
                ? 'لم تُسترجع أي فاتورة — السبب المؤكد: ترقية قاعدة البيانات (v32) غير مطبقة بعد. أعد النشر وتأكد من نجاح البناء في Netlify (البناء يطبق الترقية تلقائياً) ثم أعد المحاولة'
                : (errors.length > 0
                    ? 'لم تُسترجع أي فاتورة — فشل إنشاء ' + errors.length + ' فاتورة (التفاصيل ظاهرة الآن في النافذة)'
                    : (scan.createLogs === 0
                        ? 'سجل التدقيق لا يحتوي أي سجلات إنشاء فواتير — الفواتير المسجلة قبل 2026-07-27 (قبل تفعيل السجل) أو بين 2026-08-24 و 2026-08-30 (فترة خلوّ السجل) لا يمكن استرجاعها إلا عبر نسخة Supabase الاحتياطية'
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

