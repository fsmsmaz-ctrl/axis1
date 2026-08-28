import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, validateRequired, parseNumber, safeDbOp, recalcProgress } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'

export async function GET(req: NextRequest) {
  var user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  var searchParams = new URL(req.url).searchParams
  var projectId = searchParams.get('projectId')
  var limit = parseInt(searchParams.get('limit') || '50')

  // Cap limit to prevent excessive data retrieval
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
        driveLine: { select: { id: true, lineNumber: true, totalLength: true, startPoint: true, endPoint: true } },
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

  // Rate limit write operations
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
          createdById: user!.id,
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
    // === End of duplicate check ===

    // Calculate production data
    var startReading = parseNumber(body.startReading, 0)
    var endReading = parseNumber(body.endReading, 0)
    var dailyMeters = Math.max(0, endReading - startReading)

    // Run drive line and project queries in parallel
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
          createdById: user!.id,
        },
      }),
      'إنشاء التقرير اليومي'
    )
    if (!createResult.success) return createResult.response

    // CRITICAL: Await progress recalculation (not fire-and-forget!)
    // In Vercel serverless, the function may be terminated after response is sent,
    // so we MUST await these updates before returning.
    if (body.driveLineId) {
      await recalcProgress(db, String(body.projectId), String(body.driveLineId))
    } else if (projResult.success && projResult.data) {
      await recalcProgress(db, String(body.projectId), null)
    }

    // Audit log (non-critical, can be fire-and-forget)
    safeDbOp(
      () => db.auditLog.create({
        data: {
          userId: user!.id,
          projectId: body.projectId,
          dailyReportId: createResult.data.id,
          action: 'create',
          entity: 'daily_report',
          entityId: createResult.data.id,
          details: 'Created daily report for ' + body.reportDate,
        },
      }),
      'سجل التدقيق'
    ).catch(function() {})

    return NextResponse.json({ report: createResult.data, success: true })
  } catch (error: any) {
    return handleDbError(error, 'إنشاء التقرير اليومي')
  }
}
