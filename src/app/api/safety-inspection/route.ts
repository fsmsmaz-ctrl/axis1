import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, validateRequired, safeDbOp } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'

export async function GET(req: NextRequest) {
  var user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  var searchParams = new URL(req.url).searchParams
  var projectId = searchParams.get('projectId')
  var reportDate = searchParams.get('reportDate')
  var limit = parseInt(searchParams.get('limit') || '50')

  if (limit > 200) limit = 200

  var where: any = {}
  if (projectId) where.projectId = projectId
  if (reportDate) {
    var start = new Date(reportDate)
    start.setHours(0, 0, 0, 0)
    var end = new Date(reportDate)
    end.setHours(23, 59, 59, 999)
    where.reportDate = { gte: start, lte: end }
  }

  var result = await safeDbOp(
    () => db.safetyReport.findMany({
      where,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        project: { select: { id: true, name: true, code: true } },
        dailyReport: { select: { id: true, reportDate: true, status: true } },
        signedByUser: { select: { name: true, nameEn: true } },
      },
    }),
    'جلب تقارير السلامة'
  )

  if (!result.success) return result.response
  return NextResponse.json({ safetyReports: result.data })
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

    // === Check: only ONE safety report per employee per project per day ===
    var dateStart = new Date(body.reportDate)
    dateStart.setHours(0, 0, 0, 0)
    var dateEnd = new Date(body.reportDate)
    dateEnd.setHours(23, 59, 59, 999)

    var existingResult = await safeDbOp(
      () => db.safetyReport.findFirst({
        where: {
          projectId: body.projectId,
          signedById: user.id,
          reportDate: { gte: dateStart, lte: dateEnd },
        },
        include: { dailyReport: { select: { id: true } } },
      }),
      'التحقق من فحص السلامة'
    )

    if (existingResult.success && existingResult.data) {
      return NextResponse.json(
        {
          error: 'duplicate',
          message: 'لقد قمت بإنشاء تقرير سلامة لهذا المشروع في هذا التاريخ بالفعل',
          existingId: existingResult.data.id,
        },
        { status: 409 }
      )
    }
    // === End of duplicate check ===

    // 1. Create a minimal daily report (safety_only flag via status)
    var createReportResult = await safeDbOp(
      () => db.dailyReport.create({
        data: {
          projectId: String(body.projectId),
          driveLineId: body.driveLineId || null,
          reportDate: new Date(body.reportDate),
          weather: body.weather || null,
          workStartTime: null,
          workEndTime: null,
          operatingHours: 0,
          stoppageHours: 0,
          workersCount: 0,
          startReading: 0,
          endReading: 0,
          dailyMeters: 0,
          totalMeters: 0,
          remainingMeters: 0,
          progressPercent: 0,
          pipesInstalled: 0,
          dailyRevenue: 0,
          status: 'draft',
          createdById: user.id,
        },
      }),
      'إنشاء التقرير اليومي'
    )

    if (!createReportResult.success) return createReportResult.response

    // 2. Create the safety report linked to the daily report
    var safetyData = {
      dailyReportId: createReportResult.data.id,
      projectId: String(body.projectId),
      reportDate: new Date(body.reportDate),
      ppeAvailable: !!body.ppeAvailable,
      helmetCheck: !!body.helmetCheck,
      bootsCheck: !!body.bootsCheck,
      glovesCheck: !!body.glovesCheck,
      glassesCheck: !!body.glassesCheck,
      workAreaCheck: !!body.workAreaCheck,
      barriersCheck: !!body.barriersCheck,
      shaftCheck: !!body.shaftCheck,
      ventilationCheck: !!body.ventilationCheck,
      electricalCheck: !!body.electricalCheck,
      craneCheck: !!body.craneCheck,
      hydraulicCheck: !!body.hydraulicCheck,
      fireExtinguishers: !!body.fireExtinguishers,
      workPermit: !!body.workPermit,
      toolboxTalk: !!body.toolboxTalk,
      hazards: body.hazards || '[]',
      observations: body.observations || null,
      violations: body.violations || null,
      incidentType: body.incidentType || 'none',
      incidentDescription: body.incidentDescription || null,
      signedBy: user.name,
      signedById: user.id,
      signedAt: new Date(),
    }

    var createSafetyResult = await safeDbOp(
      () => db.safetyReport.create({ data: safetyData }),
      'إنشاء تقرير السلامة'
    )

    if (!createSafetyResult.success) return createSafetyResult.response

    // Audit log
    await safeDbOp(
      () => db.auditLog.create({
        data: {
          userId: user.id,
          projectId: body.projectId,
          dailyReportId: createReportResult.data.id,
          action: 'create',
          entity: 'safety_report',
          entityId: createSafetyResult.data.id,
          details: 'Created safety inspection for ' + body.reportDate,
        },
      }),
      'سجل التدقيق'
    )

    return NextResponse.json({
      success: true,
      safetyReport: createSafetyResult.data,
      dailyReportId: createReportResult.data.id,
    })
  } catch (error: any) {
    return handleDbError(error, 'إنشاء فحص السلامة')
  }
}
