// ============================================================
// v123 — ترحيل فواتير المقاول القديمة (تشغيل واحد — مدير النظام فقط)
// AXIS Pipe Jacking Management System
// ============================================================
// POST /api/admin/contractor-migration-v123
// ينفذ البند 11 من المواصفة بلا أي حذف وبلا أي اعتماد آلي:
//   1) آلية الـ 10 أمتار متوقفة أصلاً (الوحدة متقاعدة) — هذا المسار
//      يوثق الحالة ويهيئ الأساس المالي للخطوط.
//   2) يراجع فواتير المقاول القديمة المعتمدة (بصمة v116 في جدول
//      التكاليف) ويستخرج لكل خط: الأطوال التي غطتها والمداخيل المعتمدة.
//   3) يكشف الفواتير المكررة (نطاقات متداخلة لنفس الخط) ويجمعها
//      في تقرير للمراجعة — دون حذفها (سجلات مالية).
//   4) لا يعتمد أي شيء آلياً — فقط يثبت على كل خط:
//      settledOldLength/settledOldAmount لمنع احتساب الأطوال
//      التي سبق صرف مستحقاتها مرة أخرى.
//   5) يحدد الخطوط التي عقد المقاول فيها ناقص (اسم/سعر) لاستكماله.
//   الإجراء قابل للتكرار (Idempotent): يعيد الحساب من صفوف التكاليف
//   نفسها فيصل إلى نفس النتيجة كل مرة.
// الصلاحية: مدير النظام فقط — من الخادم.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { SYSTEM_ADMIN_EMAIL } from '@/lib/auth'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { round3 } from '@/lib/contractor-dues'
import { ensureContractorDuesSupport } from '@/lib/db-selfheal'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

// بصمة الفواتير المعتمدة يدوياً في v116 (نفسها في الوحدة القديمة والصفحة)
var APPROVED_MARKER = 'فاتورة مقاول معتمدة #'
var LEGACY_MARKER = 'فاتورة مقاول آلية #'

export async function POST(req: NextRequest) {
  var me = await getAuthUser(req)
  if (!me) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })

  var rl = checkRateLimit(req, RateLimitPresets.write)
  if (rl.limited) {
    return NextResponse.json({ error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })
  }

  var email = String(me.email || '').toLowerCase().trim()
  var isSystemAdmin = me.isSystemAdmin === true || email === SYSTEM_ADMIN_EMAIL
  if (!isSystemAdmin) {
    return NextResponse.json({ error: 'forbidden', message: 'الترحيل متاح لمدير النظام فقط' }, { status: 403 })
  }

  try { await ensureContractorDuesSupport() } catch (e: any) {
    console.error('[contractor migration] self-heal failed:', e)
  }

  // 1) كل فواتير المقاول القديمة المعتمدة (v116) من جدول التكاليف
  var oldRows = await db.cost.findMany({
    where: { notes: { startsWith: APPROVED_MARKER } },
    select: { id: true, notes: true, description: true, amount: true, date: true, projectId: true, recordedBy: { select: { name: true } } },
    orderBy: { createdAt: 'asc' },
  })

  // 2) تحقق من بقايا الفواتير الآلية v114 (يجب أن تكون صفراً بعد تنظيف v116)
  var legacyCount = await db.cost.count({ where: { notes: { startsWith: LEGACY_MARKER } } })

  // 3) تحليل كل صف: token = lineId#segKey — والوصف يحمل «من X إلى Y متر»
  interface OldRow {
    costId: string
    lineId: string
    segKey: string
    from: number
    to: number
    amount: number
    description: string
    dateISO: string
  }
  var parsedRows: OldRow[] = []
  var unparseable: string[] = []
  for (var row of oldRows) {
    var token = String(row.notes || '').slice(APPROVED_MARKER.length)
    var hashIdx = token.indexOf('#')
    if (hashIdx <= 0) {
      unparseable.push(row.id)
      continue
    }
    var lineId = token.slice(0, hashIdx)
    var segKey = token.slice(hashIdx + 1)
    var m = /من\s+([\d.]+)\s+إلى\s+([\d.]+)/.exec(String(row.description || ''))
    var from = m ? Number(m[1]) : -1
    var to = m ? Number(m[2]) : -1
    if (from < 0 || to < 0) {
      // احتياط: مقطع رقمي N يغطي (N-1)*10 إلى N*10 — والمقطع الأخير يُقدّر ببيانات الخط لاحقاً
      var k = parseInt(segKey, 10)
      if (Number.isFinite(k) && k > 0) {
        from = (k - 1) * 10
        to = k * 10
      } else {
        unparseable.push(row.id)
        continue
      }
    }
    parsedRows.push({
      costId: row.id,
      lineId: lineId,
      segKey: segKey,
      from: from,
      to: to,
      amount: Number(row.amount) || 0,
      description: String(row.description || ''),
      dateISO: row.date ? row.date.toISOString() : '',
    })
  }

  // 4) تجميع لكل خط + كشف التكرار (نطاقات متداخلة لنفس الخط)
  var byLine: Record<string, { rows: OldRow[]; settledTo: number; amount: number; overlaps: string[] }> = {}
  for (var pr of parsedRows) {
    if (!byLine[pr.lineId]) byLine[pr.lineId] = { rows: [], settledTo: 0, amount: 0, overlaps: [] }
    var bucket = byLine[pr.lineId]
    // تداخل: نطاق يبدأ قبل نهاية أكبر نطاق سابق
    if (bucket.settledTo > 0 && pr.from < bucket.settledTo - 0.0001) {
      bucket.overlaps.push(pr.costId)
    }
    bucket.rows.push(pr)
    if (pr.to > bucket.settledTo) bucket.settledTo = pr.to
    bucket.amount += pr.amount
  }

  // 5) تثبيت المستوطنة المالية على كل خط + تقرير الخطوط الناقصة العقد
  var linesUpdated = 0
  var byLineReport: any[] = []
  var lineIds = Object.keys(byLine)
  var lines = lineIds.length > 0
    ? await db.driveLine.findMany({
        where: { id: { in: lineIds } },
        include: { project: { select: { name: true } } },
      })
    : []

  for (var line of lines) {
    var bucket2 = byLine[line.id]
    var settledLength = round3(bucket2.settledTo)
    var settledAmount = round3(bucket2.amount)
    var needsAgreement = !line.contractorName || !String(line.contractorName).trim() || !(Number(line.pricePerMeter) > 0)

    // التثبيت فقط إن تغيرت القيمة — قابل للتكرار بأمان
    if (round3(Number(line.settledOldLength) || 0) !== settledLength || round3(Number(line.settledOldAmount) || 0) !== settledAmount) {
      await db.driveLine.update({
        where: { id: line.id },
        data: { settledOldLength: settledLength, settledOldAmount: settledAmount },
      })
      linesUpdated++
    }

    byLineReport.push({
      driveLineId: line.id,
      lineNumber: line.lineNumber,
      projectName: line.project ? line.project.name : '',
      contractorName: line.contractorName || '',
      pricePerMeter: line.pricePerMeter || 0,
      invoicesCount: bucket2.rows.length,
      settledOldLength: settledLength,
      settledOldAmount: settledAmount,
      overlaps: bucket2.overlaps,
      needsAgreement: needsAgreement,
      note: needsAgreement ? 'أكمل اسم المقاول وسعر المتر من نافذة المستحقات قبل أي احتساب جديد' : '',
    })
  }

  await db.auditLog.create({
    data: {
      userId: me.id,
      action: 'update',
      entity: 'drive_line',
      entityId: 'contractor-migration-v123',
      details: 'ترحيل v123: فحص ' + oldRows.length + ' فاتورة مقاول قديمة معتمدة على ' + lines.length + ' خط — ثُبتت المستوطنة المالية على ' + linesUpdated + ' خطاً — تكرارات: ' + parsedRows.filter(function(pr) { var b = byLine[pr.lineId]; return b && b.overlaps.indexOf(pr.costId) !== -1 }).length + ' — خطوط ناقصة العقد: ' + byLineReport.filter(function(x) { return x.needsAgreement }).length + ' — بقايا v114 آلية: ' + legacyCount + ' — لا حذف ولا اعتماد آلي',
    },
  })

  return NextResponse.json({
    ok: true,
    message: 'اكتمل الترحيل: ' + oldRows.length + ' فاتورة قديمة معتمدة على ' + lines.length + ' خطاً — ثُبتت المستوطنة على ' + linesUpdated + ' خطاً — لا حذف ولا اعتماد آلي',
    report: {
      oldApprovedInvoices: oldRows.length,
      unparseable: unparseable,
      legacyAutoRows: legacyCount,
      linesUpdated: linesUpdated,
      byLine: byLineReport,
      mechanismStopped: true,
    },
  })
}
