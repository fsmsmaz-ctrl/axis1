// ============================================================
// v121 — خطة عمل الماكينات: القائمة + الإنشاء
// GET  /api/machine-plans   — مشاهدة للجميع (ومنهم الزائر) — بلا بيانات مالية أصلاً
// POST /api/machine-plans   — حساب مدير الخطة فقط (machine_plans_edit / مدير النظام)
//
// قواعد صارمة:
//   • القراءة: فحص machine_plans من الخادم — الزائر يرى الخطة دون أي أزرار.
//   • الكتابة: canManageMachinePlans من الخادم (مرتبطة بالحساب/User ID لا بالاسم).
//   • الحسابات الهندسية تعاد على الخادم دائماً (لا ثقة بحسابات الواجهة).
//   • تعارض الماكينة (نفس الماكينة في موقعين/مشروعين في فترة واحدة) يمنع
//     الحفظ بـ 409 مع قائمة التعارض — لا حفظ إلا بتأكيد صريح (confirmConflicts).
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { hasPermission, canManageMachinePlans } from '@/lib/auth'
import { ensureMachinePlansSupport } from '@/lib/db-selfheal'
import {
  computePlanning, computePlanProgress, parseHolidayConfig, parseDateOnly, toISODate, addDaysUTC,
  ACTIVITY_TYPES,
} from '@/lib/machine-plan-math'

// ألوان افتراضية للأجهزة الجديدة — يستبدلها مدير الخطة من نافذة الألوان
var MACHINE_PALETTE = ['#2563eb', '#d97706', '#059669', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#ea580c', '#4f46e5']

function machineDefaultColor(name: string): string {
  var h = 0
  for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return MACHINE_PALETTE[h % MACHINE_PALETTE.length]
}

function validateColor(v: unknown): string | null {
  if (typeof v !== 'string') return null
  var s = v.trim()
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s : null
}

function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  var s = v.trim()
  if (!s) return null
  return s.slice(0, max)
}

var CONFIDENCES = ['green', 'yellow', 'red', 'gray']
var ACTIVITY_KEYS = Object.keys(ACTIVITY_TYPES)

function parseBodyDates(body: Record<string, unknown>): { start: Date | null; end: Date | null; bad: boolean } {
  var start = parseDateOnly(typeof body.startDate === 'string' ? body.startDate : '')
  var end = parseDateOnly(typeof body.endDate === 'string' ? body.endDate : '')
  if (!start || !end) return { start: start, end: end, bad: true }
  if (start.getUTCFullYear() < 2000 || start.getUTCFullYear() > 2100 || end.getUTCFullYear() < 2000 || end.getUTCFullYear() > 2100) return { start: start, end: end, bad: true }
  return { start: start, end: end, bad: false }
}

// تعارض الماكينة: نفس الماكينة في مشروع/موقع آخر خلال فترة متداخلة
interface ConflictRow { id: string; machineName: string; projectName: string; location: string | null; activityLabel: string; startDate: string; endDate: string }

async function findMachineConflicts(machineName: string, start: Date, end: Date, projectName: string, location: string | null, excludeId?: string): Promise<ConflictRow[]> {
  var rows = await db.machinePlan.findMany({
    where: {
      machineName: { equals: machineName },
      id: excludeId ? { not: excludeId } : undefined,
      // تداخل زمني: بداية قبل نهاية الجديد ونهايته بعد بداية الجديد
      startDate: { lt: addDaysUTC(end, 1) },
      endDate: { gte: start },
    },
  })
  var out: ConflictRow[] = []
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i]
    var sameSite = (r.projectName || '').trim().toLowerCase() === projectName.trim().toLowerCase() &&
      ((r.location || '')).trim().toLowerCase() === ((location || '')).trim().toLowerCase()
    if (sameSite) continue // نفس المشروع ونفس الموقع — تتابع طبيعي لأعمال الماكينة
    out.push({
      id: r.id,
      machineName: r.machineName,
      projectName: r.projectName,
      location: r.location,
      activityLabel: r.activityType === 'custom' && r.activityName ? r.activityName : (ACTIVITY_TYPES[r.activityType] || { ar: r.activityType }).ar,
      startDate: toISODate(r.startDate),
      endDate: toISODate(r.endDate),
    })
  }
  return out
}

export async function GET(req: NextRequest) {
  try {
    var user = await getAuthUser(req)
    if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
    if (!hasPermission(user.role, 'machine_plans', user.permissions, user.email)) {
      return NextResponse.json({ error: 'forbidden', message: 'لا تملك صلاحية الوصول لخطة الماكينات' }, { status: 403 })
    }
    var rl = checkRateLimit(req, RateLimitPresets.read)
    if (rl.limited) {
      return NextResponse.json({ error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار قليلاً' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })
    }
    await ensureMachinePlansSupport()

    var plans = await db.machinePlan.findMany({
      orderBy: [{ machineName: 'asc' }, { sortIndex: 'asc' }, { startDate: 'asc' }],
    })

    // سحب الإنجاز الفعلي تلقائياً من التقارير اليومية المعتمدة لكل خط حفر مرتبط
    // (نافذة القياس: من بداية العمل حتى اليوم — بلا إعادة إدخال يدوي إطلاقاً)
    var today = parseDateOnly(new Date()) as Date
    var lineIds: string[] = []
    for (var i = 0; i < plans.length; i++) {
      var lid = plans[i].driveLineId
      if (lid && lineIds.indexOf(lid) === -1) lineIds.push(lid)
    }
    var lines = lineIds.length > 0
      ? await db.driveLine.findMany({ where: { id: { in: lineIds } }, include: { project: { select: { name: true } } } })
      : []
    var lineMap: Record<string, { lineNumber: string; projectName: string; completedLength: number }> = {}
    for (var j = 0; j < lines.length; j++) {
      lineMap[lines[j].id] = { lineNumber: lines[j].lineNumber, projectName: lines[j].project.name, completedLength: lines[j].completedLength }
    }

    var outRows: Record<string, unknown>[] = []
    for (var k = 0; k < plans.length; k++) {
      var p = plans[k]
      var cfg = parseHolidayConfig(p.holidayConfig)
      var actualMeters = 0
      var actualWindowNote = ''
      if (p.driveLineId) {
        var agg = await db.dailyReport.aggregate({
          _sum: { dailyMeters: true },
          where: { driveLineId: p.driveLineId, status: 'approved', reportDate: { gte: p.startDate, lte: addDaysUTC(today, 1) } },
        })
        actualMeters = agg._sum.dailyMeters || 0
        actualWindowNote = 'مجموع أمتار التقارير اليومية المعتمدة لهذا الخط منذ ' + toISODate(p.startDate)
      }
      var isDigging = p.activityType === 'digging'
      var progress = isDigging
        ? computePlanProgress({
            tunnelLength: p.tunnelLength,
            start: p.startDate,
            end: p.endDate,
            avgRate: p.avgRate,
            holidays: cfg,
            actualMeters: actualMeters,
            today: today,
            statusOverride: p.statusOverride,
          })
        : null
      outRows.push({
        id: p.id,
        machineName: p.machineName,
        machineColor: p.machineColor,
        projectName: p.projectName,
        location: p.location,
        chainage: p.chainage,
        tunnelLength: p.tunnelLength,
        pipeDiameter: p.pipeDiameter,
        sleeveDiameter: p.sleeveDiameter,
        remarks: p.remarks,
        activityType: p.activityType,
        activityLabel: p.activityType === 'custom' && p.activityName ? p.activityName : (ACTIVITY_TYPES[p.activityType] || { ar: p.activityType }).ar,
        startDate: toISODate(p.startDate),
        endDate: toISODate(p.endDate),
        planningMode: p.planningMode,
        avgRate: p.avgRate,
        requiredRate: p.requiredRate,
        diggingDays: p.diggingDays,
        confidence: p.confidence,
        holidayConfig: p.holidayConfig,
        driveLineId: p.driveLineId,
        driveLine: p.driveLineId ? (lineMap[p.driveLineId] || null) : null,
        actualMeters: actualMeters,
        actualWindowNote: actualWindowNote,
        progress: progress,
        status: progress ? progress.status : (p.statusOverride === 'suspended' ? 'suspended' : (today.getTime() < p.startDate.getTime() ? 'not_started' : (today.getTime() > p.endDate.getTime() ? 'late' : 'on_track'))),
        statusOverride: p.statusOverride,
        sortIndex: p.sortIndex,
        currentVersion: p.currentVersion,
        createdByName: p.createdByName,
        updatedByName: p.updatedByName,
        lastUpdatedAt: p.lastUpdatedAt.toISOString(),
      })
    }

    // دليل الماكينات — لكل ماكينة لون خاص يظهر في الدليل
    var machineMap: Record<string, { name: string; color: string; count: number }> = {}
    for (var m = 0; m < plans.length; m++) {
      var mn = plans[m].machineName
      if (!machineMap[mn]) machineMap[mn] = { name: mn, color: plans[m].machineColor, count: 0 }
      machineMap[mn].count++
    }
    var machines = Object.keys(machineMap).map(function (key) { return machineMap[key] })

    // آخر تحديث على مستوى الخطة كاملة (وقت + من قام به)
    var lastAt: Date | null = null
    var lastBy = ''
    for (var u = 0; u < plans.length; u++) {
      if (!lastAt || plans[u].lastUpdatedAt.getTime() > lastAt.getTime()) {
        lastAt = plans[u].lastUpdatedAt
        lastBy = plans[u].updatedByName || plans[u].createdByName || ''
      }
    }

    return NextResponse.json({
      plans: outRows,
      machines: machines,
      lastUpdate: lastAt ? { at: lastAt.toISOString(), by: lastBy } : null,
      viewer: { canManage: canManageMachinePlans(user) },
    })
  } catch (error) {
    return handleDbError(error, 'GET /api/machine-plans')
  }
}

export async function POST(req: NextRequest) {
  try {
    var user = await getAuthUser(req)
    if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
    if (!canManageMachinePlans(user)) {
      return NextResponse.json({ error: 'forbidden', message: 'إدارة خطة الماكينات محصورة بحساب مدير الخطة — صلاحية machine_plans_edit تُمنح من إدارة المستخدمين' }, { status: 403 })
    }
    var rl = checkRateLimit(req, RateLimitPresets.write)
    if (rl.limited) {
      return NextResponse.json({ error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار قليلاً' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })
    }
    await ensureMachinePlansSupport()

    var body = await req.json().catch(() => ({} as Record<string, unknown>))
    var machineName = str(body.machineName, 60)
    var projectName = str(body.projectName, 160)
    var activityType = typeof body.activityType === 'string' && ACTIVITY_KEYS.indexOf(body.activityType) !== -1 ? body.activityType : 'digging'
    var d = parseBodyDates(body)
    if (!machineName || !projectName) return NextResponse.json({ error: 'invalid_value', message: 'رقم/اسم الماكينة واسم المشروع مطلوبان' }, { status: 400 })
    if (!d.start || !d.end || d.bad) return NextResponse.json({ error: 'invalid_value', message: 'تاريخا البداية والنهاية مطلوبان وصالحان' }, { status: 400 })

    var tunnelLength = typeof body.tunnelLength === 'number' ? body.tunnelLength : (typeof body.tunnelLength === 'string' && body.tunnelLength.trim() !== '' ? parseFloat(body.tunnelLength) : 0)
    if (isNaN(tunnelLength) || tunnelLength < 0) return NextResponse.json({ error: 'invalid_value', message: 'طول النفق غير صالح' }, { status: 400 })
    if (activityType === 'digging' && !(tunnelLength > 0)) return NextResponse.json({ error: 'invalid_value', message: 'عمل الحفر يتطلب طول نفق أكبر من صفر' }, { status: 400 })

    var planningMode = body.planningMode === 'by_end_date' ? 'by_end_date' : 'by_rate'
    var avgRate = body.avgRate === undefined || body.avgRate === null || body.avgRate === '' ? null : (typeof body.avgRate === 'number' ? body.avgRate : parseFloat(String(body.avgRate)))
    if (avgRate !== null && (isNaN(avgRate) || avgRate < 0)) return NextResponse.json({ error: 'invalid_value', message: 'متوسط الإنتاج غير صالح' }, { status: 400 })
    var confidence = typeof body.confidence === 'string' && CONFIDENCES.indexOf(body.confidence) !== -1 ? body.confidence : 'gray'
    var holidayCfg = typeof body.holidayConfig === 'string' && body.holidayConfig.trim() !== '' ? body.holidayConfig.slice(0, 2000) : JSON.stringify(parseHolidayConfig(null))
    var sortIndex = typeof body.sortIndex === 'number' ? Math.max(0, Math.min(999, Math.floor(body.sortIndex))) : 0

    // الحساب الهندسي النهائي على الخادم — مصدر الحقيقة الوحيد للأرقام
    var planning = computePlanning({ mode: planningMode as 'by_rate' | 'by_end_date', lengthM: tunnelLength, start: d.start, end: d.end, rate: avgRate, holidays: parseHolidayConfig(holidayCfg) })
    if (!planning.ok) return NextResponse.json({ error: 'invalid_value', message: planning.issues.join(' — ') }, { status: 400 })
    var effectiveEnd = planning.computedEnd || d.end
    if (activityType !== 'digging') effectiveEnd = d.end // أعمال التجهيز/الرفع بالتقويم مباشرة

    // التعارض: لا حفظ بلا تأكيد صريح عند وجوده — تحذير واضح إجباري
    var confirmConflicts = body.confirmConflicts === true
    var conflicts = await findMachineConflicts(machineName, d.start, effectiveEnd, projectName, str(body.location, 160))
    if (conflicts.length > 0 && !confirmConflicts) {
      return NextResponse.json({ error: 'conflict', saved: false, conflicts: conflicts, message: 'الماكينة مبرمجة في مشروع/موقع آخر خلال الفترة نفسها — راجع التعارضات وأكد إن أردت المتابعة' }, { status: 409 })
    }

    var created = await db.machinePlan.create({
      data: {
        machineName: machineName,
        machineColor: validateColor(body.machineColor) || machineDefaultColor(machineName),
        projectName: projectName,
        location: str(body.location, 160),
        chainage: str(body.chainage, 60),
        tunnelLength: tunnelLength,
        pipeDiameter: str(body.pipeDiameter, 30),
        sleeveDiameter: str(body.sleeveDiameter, 30),
        remarks: str(body.remarks, 1000),
        activityType: activityType,
        activityName: activityType === 'custom' ? (str(body.activityName, 120) || 'نشاط آخر') : str(body.activityName, 120),
        startDate: d.start,
        endDate: effectiveEnd,
        planningMode: planningMode,
        avgRate: avgRate,
        requiredRate: activityType === 'digging' && planning.requiredRate > 0 ? planning.requiredRate : null,
        diggingDays: activityType === 'digging' && planning.diggingDays > 0 ? planning.diggingDays : null,
        confidence: confidence,
        holidayConfig: holidayCfg,
        driveLineId: typeof body.driveLineId === 'string' && body.driveLineId.trim() !== '' ? body.driveLineId.trim() : null,
        statusOverride: body.statusOverride === 'suspended' ? 'suspended' : null,
        sortIndex: sortIndex,
        createdById: user.id,
        createdByName: user.name,
        updatedById: user.id,
        updatedByName: user.name,
        lastUpdatedAt: new Date(),
      },
    })

    return NextResponse.json({ plan: created, conflicts: conflicts, message: 'أُنشئ عمل الماكينة في الخطة' }, { status: 201 })
  } catch (error) {
    return handleDbError(error, 'POST /api/machine-plans')
  }
}
