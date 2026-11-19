// ============================================================
// v121 — خطة عمل الماكينات: إزاحة الأعمال التالية لماكينة
// POST /api/machine-plans/shift — مدير الخطة فقط
//
// المواصفة: «عند تغيير مدة أحد الأعمال، يجب تحديث أو تحريك الأعمال
// التالية المرتبطة بالماكينة بعد تأكيد محمد الزيدي» — هذا المسار هو
// خطوة التأكيد: لا يُستدعى إلا من نافذة تأكيد صريحة بعد حفظ التعديل،
// ويطبق الإزاحة على أعمال الماكينة نفسها فقط (مع لقطة إصدار لكل عمل).
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { canManageMachinePlans } from '@/lib/auth'
import { ensureMachinePlansSupport } from '@/lib/db-selfheal'
import { addDaysUTC, toISODate, addWorkingDays, parseHolidayConfig } from '@/lib/machine-plan-math'

export async function POST(req: NextRequest) {
  try {
    var user = await getAuthUser(req)
    if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
    if (!canManageMachinePlans(user)) {
      return NextResponse.json({ error: 'forbidden', message: 'إزاحة الأعمال محصورة بحساب مدير الخطة' }, { status: 403 })
    }
    var rl = checkRateLimit(req, RateLimitPresets.write)
    if (rl.limited) {
      return NextResponse.json({ error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار قليلاً' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })
    }
    await ensureMachinePlansSupport()

    var body = await req.json().catch(() => ({} as Record<string, unknown>))
    var sourceId = typeof body.sourceId === 'string' ? body.sourceId.trim() : ''
    var deltaDays = typeof body.deltaDays === 'number' ? Math.round(body.deltaDays) : NaN
    if (!sourceId || isNaN(deltaDays) || deltaDays === 0) {
      return NextResponse.json({ error: 'invalid_value', message: 'العمل المصدر ومقدار الإزاحة (أيام) مطلوبان — الإزاحة الصفرية بلا معنى' }, { status: 400 })
    }
    if (Math.abs(deltaDays) > 730) return NextResponse.json({ error: 'invalid_value', message: 'مقدار الإزاحة خارج النطاق المسموح (سنتان كحد أقصى)' }, { status: 400 })

    var source = await db.machinePlan.findUnique({ where: { id: sourceId } })
    if (!source) return NextResponse.json({ error: 'not_found', message: 'العمل المصدر غير موجود' }, { status: 404 })

    // الأعمال التالية: أعمال الماكينة نفسها التي تبدأ بعد بداية العمل المصدر
    // (يُعاد تحديدها على الخادم دائماً — لا ثقة بقائمة المعرفات من الواجهة)
    var targets = await db.machinePlan.findMany({
      where: { machineName: { equals: source.machineName }, id: { not: source.id }, startDate: { gt: source.startDate } },
      orderBy: [{ startDate: 'asc' }],
    })

    var updatedRows: Record<string, unknown>[] = []
    for (var i = 0; i < targets.length; i++) {
      var t = targets[i]
      var newStart = addDaysUTC(t.startDate, deltaDays)
      var newEnd = addDaysUTC(t.endDate, deltaDays)
      // أعمال الحفر: إعادة حساب النهاية وفق أيام العمل المخططة وتقويم الإجازات بعد الإزاحة
      // (دلالة addWorkingDays: البداية نفسها تُحتسب يوماً أول — النداء بعدد الأيام كاملاً)
      if (t.activityType === 'digging' && t.planningMode === 'by_rate' && t.diggingDays && t.diggingDays > 0) {
        newEnd = addWorkingDays(newStart, t.diggingDays, parseHolidayConfig(t.holidayConfig))
      }

      await db.machinePlanVersion.create({
        data: {
          planId: t.id,
          version: t.currentVersion,
          snapshot: JSON.stringify({
            machineName: t.machineName, machineColor: t.machineColor, projectName: t.projectName,
            location: t.location, chainage: t.chainage, tunnelLength: t.tunnelLength,
            pipeDiameter: t.pipeDiameter, sleeveDiameter: t.sleeveDiameter, remarks: t.remarks,
            activityType: t.activityType, activityName: t.activityName,
            startDate: toISODate(t.startDate), endDate: toISODate(t.endDate),
            planningMode: t.planningMode, avgRate: t.avgRate, requiredRate: t.requiredRate,
            diggingDays: t.diggingDays, confidence: t.confidence, holidayConfig: t.holidayConfig,
            driveLineId: t.driveLineId, statusOverride: t.statusOverride, sortIndex: t.sortIndex,
          }),
          note: 'إزاحة آلية بمقدار ' + (deltaDays > 0 ? '+' : '') + deltaDays + ' يوم بعد تغيير مدة العمل المصدر',
          changedById: user.id,
          changedByName: user.name,
        },
      })

      var upd = await db.machinePlan.update({
        where: { id: t.id },
        data: {
          startDate: newStart,
          endDate: newEnd,
          currentVersion: { increment: 1 },
          updatedById: user.id,
          updatedByName: user.name,
          lastUpdatedAt: new Date(),
        },
      })
      updatedRows.push({ id: upd.id, machineName: upd.machineName, projectName: upd.projectName, startDate: toISODate(upd.startDate), endDate: toISODate(upd.endDate) })
    }

    return NextResponse.json({ updated: updatedRows.length, rows: updatedRows, message: updatedRows.length > 0 ? 'أُزحت الأعمال التالية للماكينة بمقدار ' + (deltaDays > 0 ? '+' : '') + deltaDays + ' يوم — كل إزاحة محفوظة في سجل الإصدارات' : 'لا توجد أعمال تالية لهذه الماكينة لإزاحتها' })
  } catch (error) {
    return handleDbError(error, 'POST /api/machine-plans/shift')
  }
}
