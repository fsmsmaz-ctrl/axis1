// ============================================================
// v121 — خطة عمل الماكينات: سجل الإصدارات + الاسترجاع
// GET  /api/machine-plans/[id]/versions — مشاهدة للجميع المخوّلين بالقسم
// POST /api/machine-plans/[id]/versions — استرجاع إصدار سابق — مدير الخطة فقط
//
// كل تعديل يحفظ لقطة كاملة للحالة قبل التعديل (الإصدار N)، والاسترجاع
// يحفظ الحالة الحالية أولاً ثم يطبّق اللقطة المطلوبة — لا فقدان للتاريخ أبداً.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { hasPermission, canManageMachinePlans } from '@/lib/auth'
import { ensureMachinePlansSupport } from '@/lib/db-selfheal'
import { parseDateOnly, toISODate } from '@/lib/machine-plan-math'

function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  var s = v.trim()
  if (!s) return null
  return s.slice(0, max)
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    var { id } = await params
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

    var plan = await db.machinePlan.findUnique({ where: { id }, select: { id: true, currentVersion: true } })
    if (!plan) return NextResponse.json({ error: 'not_found', message: 'عمل الماكينة غير موجود' }, { status: 404 })

    var versions = await db.machinePlanVersion.findMany({
      where: { planId: id },
      orderBy: [{ version: 'desc' }],
      take: 50,
    })

    var out = versions.map(function (v) {
      var snap: Record<string, unknown> = {}
      try { snap = JSON.parse(v.snapshot) } catch { snap = {} }
      return {
        id: v.id,
        version: v.version,
        note: v.note,
        changedByName: v.changedByName,
        changedAt: v.changedAt.toISOString(),
        snapshot: {
          projectName: snap.projectName || '',
          location: snap.location || null,
          chainage: snap.chainage || null,
          tunnelLength: typeof snap.tunnelLength === 'number' ? snap.tunnelLength : 0,
          activityType: snap.activityType || 'digging',
          activityName: snap.activityName || null,
          startDate: typeof snap.startDate === 'string' ? snap.startDate : '',
          endDate: typeof snap.endDate === 'string' ? snap.endDate : '',
          planningMode: snap.planningMode || 'by_rate',
          avgRate: typeof snap.avgRate === 'number' ? snap.avgRate : null,
          requiredRate: typeof snap.requiredRate === 'number' ? snap.requiredRate : null,
          diggingDays: typeof snap.diggingDays === 'number' ? snap.diggingDays : null,
          confidence: snap.confidence || 'gray',
        },
      }
    })

    return NextResponse.json({ versions: out, currentVersion: plan.currentVersion })
  } catch (error) {
    return handleDbError(error, 'GET /api/machine-plans/[id]/versions')
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    var { id } = await params
    var user = await getAuthUser(req)
    if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
    if (!canManageMachinePlans(user)) {
      return NextResponse.json({ error: 'forbidden', message: 'استرجاع الإصدارات محصور بحساب مدير الخطة' }, { status: 403 })
    }
    var rl = checkRateLimit(req, RateLimitPresets.write)
    if (rl.limited) {
      return NextResponse.json({ error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار قليلاً' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })
    }
    await ensureMachinePlansSupport()

    var body = await req.json().catch(() => ({} as Record<string, unknown>))
    var version = typeof body.version === 'number' ? Math.floor(body.version) : NaN
    if (isNaN(version)) return NextResponse.json({ error: 'invalid_value', message: 'رقم الإصدار المطلوب استرجاعه مطلوب' }, { status: 400 })

    var existing = await db.machinePlan.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'not_found', message: 'عمل الماكينة غير موجود' }, { status: 404 })

    var target = await db.machinePlanVersion.findFirst({ where: { planId: id, version: version }, orderBy: [{ version: 'desc' }] })
    if (!target) return NextResponse.json({ error: 'not_found', message: 'الإصدار المطلوب غير موجود في سجل الإصدارات' }, { status: 404 })

    var snap: Record<string, unknown> = {}
    try { snap = JSON.parse(target.snapshot) } catch { return NextResponse.json({ error: 'invalid_value', message: 'لقطة الإصدار تالفة — تعذر الاسترجاع' }, { status: 400 }) }

    // حفظ الحالة الحالية أولاً — الاسترجاع نفسه لا يفقد أي تاريخ
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
        note: 'حفظ آلي قبل الاسترجاع إلى الإصدار ' + version,
        changedById: user.id,
        changedByName: user.name,
      },
    })

    var start = parseDateOnly(typeof snap.startDate === 'string' ? snap.startDate : '') || existing.startDate
    var end = parseDateOnly(typeof snap.endDate === 'string' ? snap.endDate : '') || existing.endDate

    var restored = await db.machinePlan.update({
      where: { id: existing.id },
      data: {
        machineName: str(snap.machineName, 60) || existing.machineName,
        machineColor: typeof snap.machineColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(snap.machineColor) ? snap.machineColor : existing.machineColor,
        projectName: str(snap.projectName, 160) || existing.projectName,
        location: 'location' in snap ? str(snap.location, 160) : existing.location,
        chainage: 'chainage' in snap ? str(snap.chainage, 60) : existing.chainage,
        tunnelLength: typeof snap.tunnelLength === 'number' ? snap.tunnelLength : existing.tunnelLength,
        pipeDiameter: 'pipeDiameter' in snap ? str(snap.pipeDiameter, 30) : existing.pipeDiameter,
        sleeveDiameter: 'sleeveDiameter' in snap ? str(snap.sleeveDiameter, 30) : existing.sleeveDiameter,
        remarks: 'remarks' in snap ? str(snap.remarks, 1000) : existing.remarks,
        activityType: str(snap.activityType, 30) || existing.activityType,
        activityName: 'activityName' in snap ? str(snap.activityName, 120) : existing.activityName,
        startDate: start,
        endDate: end,
        planningMode: snap.planningMode === 'by_end_date' ? 'by_end_date' : 'by_rate',
        avgRate: typeof snap.avgRate === 'number' ? snap.avgRate : null,
        requiredRate: typeof snap.requiredRate === 'number' ? snap.requiredRate : null,
        diggingDays: typeof snap.diggingDays === 'number' ? Math.floor(snap.diggingDays) : null,
        confidence: str(snap.confidence, 10) || 'gray',
        holidayConfig: typeof snap.holidayConfig === 'string' ? snap.holidayConfig.slice(0, 2000) : existing.holidayConfig,
        driveLineId: 'driveLineId' in snap ? (str(snap.driveLineId, 64)) : existing.driveLineId,
        statusOverride: snap.statusOverride === 'suspended' ? 'suspended' : null,
        sortIndex: typeof snap.sortIndex === 'number' ? Math.max(0, Math.min(999, Math.floor(snap.sortIndex))) : existing.sortIndex,
        currentVersion: { increment: 1 },
        updatedById: user.id,
        updatedByName: user.name,
        lastUpdatedAt: new Date(),
      },
    })

    return NextResponse.json({ plan: restored, message: 'استُرجع الإصدار ' + version + ' — الحالة السابقة للحفظ محفوظة تلقائياً في السجل' })
  } catch (error) {
    return handleDbError(error, 'POST /api/machine-plans/[id]/versions')
  }
}
