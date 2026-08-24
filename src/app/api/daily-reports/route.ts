import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, validateRequired, parseNumber, safeDbOp } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { canWrite } from '@/lib/auth'

export async function GET(req: NextRequest) {
  var user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  var searchParams = new URL(req.url).searchParams
  var projectId = searchParams.get('projectId')
  var limit = parseInt(searchParams.get('limit') || '50')

  if (limit > 200) limit = 200

  var where: any = {}
  if (projectId) where.projectId = projectId

  var result = await safeDbOp(
    () => db.dailyReport.findMany({
      where,
      take: limit,
      orderBy: { reportDate: 'desc' },
      include: {
        project: { select: { id: true, name: true, code: true, pricePerMeter: true } },
        driveLine: { select: { id: true, lineNumber: true, totalLength: true } },
        safety: true,
        createdBy: { select: { name: true, nameEn: true } },
        approver: { select: { name: true, nameEn: true } },
      },
    }),
    'جلب التقارير اليومية'
  )

  if (!result.success) return result.response
  return NextResponse.json({ reports: result.data })
}

export async function POST(req: NextRequest) {
  var user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  // H-1 FIX: RBAC check for daily reports
  if (!canWrite(user.role, 'daily_reports', user.permissions)) {
    return NextResponse.json({ error: 'forbidden', message: 'لا تملك صلاحية لإنشاء تقارير يومية' }, { status: 403 })
  }

  var rl = checkRateLimit(req, RateLimitPresets.write)
  if (rl.limited) {
    return NextResponse.json(
      { error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار قليلاً' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    )
  }

  try {
    var body = await req.json()

    var validationError = validateRequired(body, ['projectId', 'reportDate'])
    if (validationError) return validationError

    // === Check: only ONE daily report per employee per project per day ===
    var dateStart = new Date(body.reportDate)
    dateStart.setHours(0, 0, 0, 0)
    var dateEnd = new Date(body.reportDate)
    dateEnd.setHours(23, 59, 59, 999)

    var existingResult = await safeDbOp(
      () => db.dailyReport.findFirst({
        where: {
          projectId: body.projectId,
          createdById: user.id,
          reportDate: { gte: dateStart, lte: dateEnd },
        },
        select: { id: true, status: true, reportDate: true },
      }),
      'التحقق من تقرير يومي موجود'
    )

    if (existingResult.success && existingResult.data) {
      return NextResponse.json(
        {
          error: 'duplicate',
          message: 'لقد قمت بإنشاء تقرير يومي لهذا المشروع في هذا التاريخ بالفعل',
          existingId: existingResult.data.id,
          existingStatus: existingResult.data.status,
        },
        { status: 409 }
      )
    }

    var startReading = parseNumber(body.startReading, 0)
    var endReading = parseNumber(body.endReading, 0)
    var dailyMeters = Math.max(0, endReading - startReading)

    var dlResult = body.driveLineId
      ? await safeDbOp(
          () => db.driveLine.findUnique({ where: { id: body.driveLineId } }),
          'جلب خط الحفر'
        )
      : { success: false }
    var projResult = await safeDbOp(
      () => db.project.findUnique({ where: { id: body.projectId }, select: { pricePerMeter: true } }),
      'جلب بيانات المشروع'
    )

    var totalLength = dlResult.success && dlResult.data ? dlResult.data.totalLength : 0
    var totalMeters = endReading
    var remainingMeters = Math.max(0, totalLength - totalMeters)
    var progressPercent = totalLength > 0 ? (totalMeters / totalLength) * 100 : 0

    var pricePerMeter = projResult.success && projResult.data ? projResult.data.pricePerMeter : 0
    var dailyRevenue = dailyMeters * pricePerMeter

    var createResult = await safeDbOp(
      () => db.dailyReport.create({
        data: {
          projectId: String(body.projectId),
          driveLineId: body.driveLineId || null,
          reportDate: new Date(body.reportDate),
          weather: body.weather || null,
          workStartTime: body.workStartTime || null,
          workEndTime: body.workEndTime || null,
          operatingHours: parseNumber(body.operatingHours, 0),
          stoppageHours: parseNumber(body.stoppageHours, 0),
          stoppageReason: body.stoppageReason || null,
          workersCount: parseInt(body.workersCount) || 0,
          attendees: body.attendees || null,
          startReading,
          endReading,
          dailyMeters,
          totalMeters,
          remainingMeters,
          progressPercent,
          soilExcavated: body.soilExcavated || null,
          pipesInstalled: parseInt(body.pipesInstalled) || 0,
          productionNotes: body.productionNotes || null,
          problems: body.problems || null,
          dailyRevenue,
          status: body.status || 'draft',
          createdById: user.id,
        },
      }),
      'إنشاء التقرير اليومي'
    )
    if (!createResult.success) return createResult.response

    var updatePromises: Promise<void>[] = []

    if (body.driveLineId) {
      updatePromises.push(
        safeDbOp(
          () => db.driveLine.update({
            where: { id: body.driveLineId },
            data: {
              completedLength: totalMeters,
              progress: progressPercent,
              status: progressPercent >= 100 ? 'completed' : 'in_progress',
            },
          }),
          'تحديث تقدم خط الحفر'
        ).then(function() {})
      )
    }

    if (projResult.success && projResult.data) {
      updatePromises.push(
        (async function() {
          var allLinesResult = await safeDbOp(
            () => db.driveLine.findMany({
              where: { projectId: body.projectId },
              select: { totalLength: true, completedLength: true },
            }),
            'جلب جميع خطوط الحفر'
          )
          if (allLinesResult.success) {
            var totalAll = allLinesResult.data.reduce(function(s: number, l: any) { return s + l.totalLength }, 0)
            var completedAll = allLinesResult.data.reduce(function(s: number, l: any) { return s + l.completedLength }, 0)
            var projectProgress = totalAll > 0 ? (completedAll / totalAll) * 100 : 0
            await safeDbOp(
              () => db.project.update({
                where: { id: body.projectId },
                data: { progress: projectProgress },
              }),
              'تحديث تقدم المشروع'
            )
          }
        })()
      )
    }

    updatePromises.push(
      safeDbOp(
        () => db.auditLog.create({
          data: {
            userId: user.id,
            projectId: body.projectId,
            dailyReportId: createResult.data.id,
            action: 'create',
            entity: 'daily_report',
            entityId: createResult.data.id,
            details: 'Created daily report for ' + body.reportDate,
          },
        }),
        'سجل التدقيق'
      ).then(function() {})
    )

    Promise.all(updatePromises).catch(function() {})

    return NextResponse.json({ report: createResult.data, success: true })
  } catch (error: any) {
    return handleDbError(error, 'إنشاء التقرير اليومي')
  }
}
