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

  // Extract user info after null check to satisfy TypeScript inside callbacks
  var userId = user.id
  var userName = user.name

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
          signedById: userId,
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
          status: 'draft',
          // التقرير قادم من قسم السلامة: بياناته الأساسية (المشروع/خط الحفر/التاريخ/الطقس) مقفلة للقراءة فقط
          safetyLocked: true,
          createdById: userId,
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
      signedBy: userName,
      signedById: userId,
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
          userId: userId,
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

var ADMIN_EMAIL = 'admin@axis.om'

export async function DELETE(req: NextRequest) {
  var user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  if (user.email.toLowerCase().trim() !== ADMIN_EMAIL) {
    return NextResponse.json({ error: 'forbidden', message: 'هذه العملية متاحة فقط لمدير النظام' }, { status: 403 })
  }

  var userId = user.id

  var rl = checkRateLimit(req, RateLimitPresets.write)
  if (rl.limited) {
    return NextResponse.json(
      { error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار قليلاً' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    )
  }

  try {
    var body = await req.json()
    var reportId = body.id

    if (!reportId) {
      return NextResponse.json({ error: 'missing_fields', message: 'معرف التقرير مطلوب' }, { status: 400 })
    }

    var reportResult = await safeDbOp(
      () => db.safetyReport.findUnique({
        where: { id: reportId },
        include: { dailyReport: { select: { id: true, status: true } } },
      }),
      'البحث عن تقرير السلامة'
    )

    if (!reportResult.success) return reportResult.response
    if (!reportResult.data) {
      return NextResponse.json({ error: 'not_found', message: 'تقرير السلامة غير موجود' }, { status: 404 })
    }

    var report = reportResult.data
    var dailyReportId = report.dailyReportId

    // Delete the safety report
    var deleteSafetyResult = await safeDbOp(
      () => db.safetyReport.delete({ where: { id: reportId } }),
      'حذف تقرير السلامة'
    )

    if (!deleteSafetyResult.success) return deleteSafetyResult.response

    // Delete the associated daily report if it is a draft with no real data
    if (dailyReportId) {
      await safeDbOp(
        () => db.dailyReport.deleteMany({
          where: {
            id: dailyReportId,
            status: 'draft',
            dailyMeters: 0,
            workersCount: 0,
            operatingHours: 0,
          },
        }),
        'حذف التقرير اليومي المرتبط'
      )
    }

    // Audit log
    await safeDbOp(
      () => db.auditLog.create({
        data: {
          userId: userId,
          projectId: report.projectId,
          action: 'delete',
          entity: 'safety_report',
          entityId: reportId,
          details: 'Deleted safety report ' + reportId,
        },
      }),
      'سجل التدقيق'
    )

    return NextResponse.json({ message: 'تم حذف تقرير السلامة بنجاح' })
  } catch (error: any) {
    return handleDbError(error, 'حذف تقرير السلامة')
  }
}

