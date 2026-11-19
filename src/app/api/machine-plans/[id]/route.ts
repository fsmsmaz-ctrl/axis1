// ============================================================
// v121 — خطة عمل الماكينات: تعديل / حذف عمل واحد
// PATCH  /api/machine-plans/[id] — مدير الخطة فقط
// DELETE /api/machine-plans/[id] — مدير الخطة فقط
//
// ضمانات صارمة:
//   • كل تعديل يحفظ الإصدار السابق كاملاً (MachinePlanVersion) قبل التطبيق
//     مع تاريخ التعديل واسم من قام به — تغيير التواريخ لا يُخفي التأخير السابق.
//   • تعارض الماكينة يمنع الحفظ بـ 409 حتى تأكيد صريح.
//   • عند تغيير مدة العمل يقترح الخادم إزاحة الأعمال التالية المرتبطة
//     بنفس الماكينة — لا تُطبق إلا بعد تأكيد مدير الخطة (مسار /shift).
//   • لا يغيّر النظام تاريخ الخطة الأصلية عند التأخير تلقائياً — التاريخ
//     المتوقع يُعرض للمقارنة فقط.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { canManageMachinePlans } from '@/lib/auth'
import { ensureMachinePlansSupport } from '@/lib/db-selfheal'
import { computePlanning, parseHolidayConfig, parseDateOnly, toISODate, addDaysUTC, diffCalendarDays, ACTIVITY_TYPES } from '@/lib/machine-plan-math'

function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  var s = v.trim()
  if (!s) return null
  return s.slice(0, max)
}

var CONFIDENCES = ['green', 'yellow', 'red', 'gray']
var ACTIVITY_KEYS = Object.keys(ACTIVITY_TYPES)

function activityLabel(p: { activityType: string; activityName: string | null }): string {
  return p.activityType === 'custom' && p.activityName ? p.activityName : (ACTIVITY_TYPES[p.activityType] || { ar: p.activityType }).ar
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    var { id } = await params
    var user = await getAuthUser(req)
    if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
    if (!canManageMachinePlans(user)) {
      return NextResponse.json({ error: 'forbidden', message: 'تعديل خطة الماكينات محصورة بحساب مدير الخطة — صلاحية machine_plans_edit تُمنح من إدارة المستخدمين' }, { status: 403 })
    }
    var rl = checkRateLimit(req, RateLimitPresets.write)
    if (rl.limited) {
      return NextResponse.json({ error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار قليلاً' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })
    }
    await ensureMachinePlansSupport()

    var existing = await db.machinePlan.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'not_found', message: 'عمل الماكينة غير موجود' }, { status: 404 })

    var body = await req.json().catch(() => ({} as Record<string, unknown>))

    // الحقول المسموح تعديلها — كل ما لم يُرسل يبقى كما هو
    var machineName = str(body.machineName, 60) || existing.machineName
    var projectName = str(body.projectName, 160) || existing.projectName
    var location = 'location' in body ? str(body.location, 160) : existing.location
    var chainage = 'chainage' in body ? str(body.chainage, 60) : existing.chainage
    var remarks = 'remarks' in body ? str(body.remarks, 1000) : existing.remarks
    var pipeDiameter = 'pipeDiameter' in body ? str(body.pipeDiameter, 30) : existing.pipeDiameter
    var sleeveDiameter = 'sleeveDiameter' in body ? str(body.sleeveDiameter, 30) : existing.sleeveDiameter
    var activityType = typeof body.activityType === 'string' && ACTIVITY_KEYS.indexOf(body.activityType) !== -1 ? body.activityType : existing.activityType
    var activityName = 'activityName' in body ? str(body.activityName, 120) : existing.activityName

    var tunnelLength = body.tunnelLength === undefined ? existing.tunnelLength : (typeof body.tunnelLength === 'number' ? body.tunnelLength : parseFloat(String(body.tunnelLength)))
    if (isNaN(tunnelLength) || tunnelLength < 0) return NextResponse.json({ error: 'invalid_value', message: 'طول النفق غير صالح' }, { status: 400 })
    if (activityType === 'digging' && !(tunnelLength > 0)) return NextResponse.json({ error: 'invalid_value', message: 'عمل الحفر يتطلب طول نفق أكبر من صفر' }, { status: 400 })

    var start = parseDateOnly(typeof body.startDate === 'string' ? body.startDate : '') || existing.startDate
    var end = parseDateOnly(typeof body.endDate === 'string' ? body.endDate : '') || existing.endDate
    if (start.getUTCFullYear() < 2000 || start.getUTCFullYear() > 2100 || end.getUTCFullYear() < 2000 || end.getUTCFullYear() > 2100) {
      return NextResponse.json({ error: 'invalid_value', message: 'التواريخ خارج النطاق المسموح' }, { status: 400 })
    }

    var planningMode = typeof body.planningMode === 'string' && (body.planningMode === 'by_rate' || body.planningMode === 'by_end_date') ? body.planningMode : existing.planningMode
    var avgRate = 'avgRate' in body ? (body.avgRate === null || body.avgRate === '' ? null : (typeof body.avgRate === 'number' ? body.avgRate : parseFloat(String(body.avgRate)))) : existing.avgRate
    if (avgRate !== null && (isNaN(avgRate) || avgRate < 0)) return NextResponse.json({ error: 'invalid_value', message: 'متوسط الإنتاج غير صالح' }, { status: 400 })
    var confidence = typeof body.confidence === 'string' && CONFIDENCES.indexOf(body.confidence) !== -1 ? body.confidence : existing.confidence
    var holidayCfg = typeof body.holidayConfig === 'string' && body.holidayConfig.trim() !== '' ? body.holidayConfig.slice(0, 2000) : existing.holidayConfig || JSON.stringify(parseHolidayConfig(null))
    var sortIndex = typeof body.sortIndex === 'number' ? Math.max(0, Math.min(999, Math.floor(body.sortIndex))) : existing.sortIndex
    var machineColor = typeof body.machineColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.machineColor.trim()) ? body.machineColor.trim() : existing.machineColor
    var driveLineId = 'driveLineId' in body ? (typeof body.driveLineId === 'string' && body.driveLineId.trim() !== '' ? body.driveLineId.trim() : null) : existing.driveLineId
    var statusOverride = 'statusOverride' in body ? (body.statusOverride === 'suspended' ? 'suspended' : null) : existing.statusOverride

    // الحساب الهندسي النهائي على الخادم
    var planning = computePlanning({ mode: planningMode as 'by_rate' | 'by_end_date', lengthM: tunnelLength, start: start, end: end, rate: avgRate, holidays: parseHolidayConfig(holidayCfg) })
    if (!planning.ok) return NextResponse.json({ error: 'invalid_value', message: planning.issues.join(' — ') }, { status: 400 })
    var effectiveEnd = activityType === 'digging' ? (planning.computedEnd || end) : end

    // التعارض (باستثناء العمل نفسه) — لا حفظ بلا تأكيد صريح
    var confirmConflicts = body.confirmConflicts === true
    var conflictRows = await db.machinePlan.findMany({
      where: {
        machineName: { equals: machineName },
        id: { not: existing.id },
        startDate: { lt: addDaysUTC(effectiveEnd, 1) },
        endDate: { gte: start },
      },
    })
    var conflicts: Record<string, unknown>[] = []
    for (var i = 0; i < conflictRows.length; i++) {
      var r = conflictRows[i]
      var sameSite = (r.projectName || '').trim().toLowerCase() === projectName.trim().toLowerCase() &&
        ((r.location || '')).trim().toLowerCase() === ((location || '')).trim().toLowerCase()
      if (sameSite) continue
      conflicts.push({ id: r.id, machineName: r.machineName, projectName: r.projectName, location: r.location, activityLabel: activityLabel(r), startDate: toISODate(r.startDate), endDate: toISODate(r.endDate) })
    }
    if (conflicts.length > 0 && !confirmConflicts) {
      return NextResponse.json({ error: 'conflict', saved: false, conflicts: conflicts, message: 'الماكينة مبرمجة في مشروع/موقع آخر خلال الفترة نفسها — راجع التعارضات وأكد إن أردت المتابعة' }, { status: 409 })
    }

    // الأعمال التالية المرتبطة بنفس الماكينة — تُقترح للإزاحة بعد التأكيد (لا تُطبق هنا)
    var oldEnd = existing.endDate
    var endDeltaDays = diffCalendarDays(oldEnd, effectiveEnd)
    var followUps: Record<string, unknown>[] = []
    if (endDeltaDays !== 0) {
      var laterRows = await db.machinePlan.findMany({
        where: { machineName: { equals: machineName }, id: { not: existing.id }, startDate: { gt: existing.startDate } },
        orderBy: [{ startDate: 'asc' }],
      })
      for (var f = 0; f < laterRows.length; f++) {
        var fr = laterRows[f]
        followUps.push({
          id: fr.id,
          machineName: fr.machineName,
          projectName: fr.projectName,
          location: fr.location,
          activityLabel: activityLabel(fr),
          startDate: toISODate(fr.startDate),
          endDate: toISODate(fr.endDate),
          suggestedStartDate: toISODate(addDaysUTC(fr.startDate, endDeltaDays)),
          suggestedEndDate: toISODate(addDaysUTC(fr.endDate, endDeltaDays)),
        })
      }
    }

    // حفظ الإصدار السابق قبل التعديل — لا تغيير للتواريخ يُخفي التاريخ السابق
    var changeNote = str(body.changeNote, 300) || 'تعديل الخطة'
    await db.machinePlanVersion.create({
      data: {
        planId: existing.id,
        version: existing.currentVersion,
        snapshot: JSON.stringify({
          machineName: existing.machineName, machineColor: existing.machineColor, projectName: existing.projectName,
          location: existing.location, chainage: existing.chainage, tunnelLength: existing.tunnelLength,
          pipeDiameter: existing.pipeDiameter, sleeveDiameter: existing.sleeveDiameter, remarks: existing.remarks,
          activityType: existing.activityType, activityName: existing.activityName,
          startDate: toISODate(existing.startDate), endDate: toISODate(existing.endDate),
          planningMode: existing.planningMode, avgRate: existing.avgRate, requiredRate: existing.requiredRate,
          diggingDays: existing.diggingDays, confidence: existing.confidence, holidayConfig: existing.holidayConfig,
          driveLineId: existing.driveLineId, statusOverride: existing.statusOverride, sortIndex: existing.sortIndex,
        }),
        note: changeNote,
        changedById: user.id,
        changedByName: user.name,
      },
    })

    var updated = await db.machinePlan.update({
      where: { id: existing.id },
      data: {
        machineName: machineName,
        machineColor: machineColor,
        projectName: projectName,
        location: location,
        chainage: chainage,
        tunnelLength: tunnelLength,
        pipeDiameter: pipeDiameter,
        sleeveDiameter: sleeveDiameter,
        remarks: remarks,
        activityType: activityType,
        activityName: activityName,
        startDate: start,
        endDate: effectiveEnd,
        planningMode: planningMode,
        avgRate: avgRate,
        requiredRate: activityType === 'digging' && planning.requiredRate > 0 ? planning.requiredRate : null,
        diggingDays: activityType === 'digging' && planning.diggingDays > 0 ? planning.diggingDays : null,
        confidence: confidence,
        holidayConfig: holidayCfg,
        driveLineId: driveLineId,
        statusOverride: statusOverride,
        sortIndex: sortIndex,
        currentVersion: { increment: 1 },
        updatedById: user.id,
        updatedByName: user.name,
        lastUpdatedAt: new Date(),
      },
    })

    return NextResponse.json({ plan: updated, conflicts: conflicts, followUps: followUps, endDeltaDays: endDeltaDays, message: 'حُفظ التعديل — الإصدار السابق محفوظ تلقائياً' })
  } catch (error) {
    return handleDbError(error, 'PATCH /api/machine-plans/[id]')
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    var { id } = await params
    var user = await getAuthUser(req)
    if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
    if (!canManageMachinePlans(user)) {
      return NextResponse.json({ error: 'forbidden', message: 'حذف أعمال خطة الماكينات محصور بحساب مدير الخطة' }, { status: 403 })
    }
    var rl = checkRateLimit(req, RateLimitPresets.write)
    if (rl.limited) {
      return NextResponse.json({ error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار قليلاً' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })
    }
    await ensureMachinePlansSupport()

    var existing = await db.machinePlan.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'not_found', message: 'عمل الماكينة غير موجود' }, { status: 404 })

    await db.machinePlan.delete({ where: { id } })

    // مساءلة الحذف في سجل التدقيق النظامي
    try {
      await db.auditLog.create({
        data: {
          userId: user.id,
          action: 'delete',
          entity: 'machine_plan',
          entityId: existing.id,
          details: JSON.stringify({ machineName: existing.machineName, projectName: existing.projectName, activity: activityLabel(existing), startDate: toISODate(existing.startDate), endDate: toISODate(existing.endDate), deletedBy: user.name }),
        },
      })
    } catch (auditE) {
      console.error('v121: machine plan delete audit failed:', auditE)
    }

    return NextResponse.json({ ok: true, message: 'حُذف عمل الماكينة من الخطة' })
  } catch (error) {
    return handleDbError(error, 'DELETE /api/machine-plans/[id]')
  }
}
