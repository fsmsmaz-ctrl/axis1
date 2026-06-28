import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, validateRequired, safeDbOp } from '@/lib/api-helpers'

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const projectId = searchParams.get('projectId')
  const reportDate = searchParams.get('reportDate')
  const limit = parseInt(searchParams.get('limit') || '50')

  const where: any = {}
  if (projectId) where.projectId = projectId
  if (reportDate) {
    const start = new Date(reportDate)
    start.setHours(0, 0, 0, 0)
    const end = new Date(reportDate)
    end.setHours(23, 59, 59, 999)
    where.reportDate = { gte: start, lte: end }
  }

  const result = await safeDbOp(
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
  const user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  try {
    const body = await req.json()

    const validationError = validateRequired(body, ['projectId', 'reportDate'])
    if (validationError) return validationError

    // Check if safety inspection already exists for this project+date
    const dateStart = new Date(body.reportDate)
    dateStart.setHours(0, 0, 0, 0)
    const dateEnd = new Date(body.reportDate)
    dateEnd.setHours(23, 59, 59, 999)

    const existingResult = await safeDbOp(
      () => db.safetyReport.findFirst({
        where: {
          projectId: body.projectId,
          reportDate: { gte: dateStart, lte: dateEnd },
        },
        include: { dailyReport: { select: { id: true } } },
      }),
      'التحقق من فحص السلامة'
    )

    if (existingResult.success && existingResult.data) {
      return NextResponse.json(
        { error: 'duplicate', message: 'يوجد بالفعل فحص سلامة لهذا المشروع في هذا التاريخ', existingId: existingResult.data.id },
        { status: 409 }
      )
    }

    // 1. Create a minimal daily report (safety_only flag via status)
    const createReportResult = await safeDbOp(
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
    const safetyData = {
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

    const createSafetyResult = await safeDbOp(
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
          details: `Created safety inspection for ${body.reportDate}`,
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
