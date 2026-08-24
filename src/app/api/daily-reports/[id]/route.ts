import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { safeDbOp, handleDbError } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { canWrite } from '@/lib/auth'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  var user = await getAuthUser(req)
  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  var { id } = await params

  var result = await safeDbOp(
    () => db.dailyReport.findUnique({
      where: { id },
      include: {
        project: true,
        driveLine: true,
        safety: true,
        costs: true,
        attachments: true,
        createdBy: { select: { name: true, nameEn: true } },
        approver: { select: { name: true, nameEn: true } },
      },
    }),
    'جلب التقرير اليومي'
  )

  if (!result.success) return result.response
  if (!result.data) {
    return NextResponse.json({ error: 'not_found', message: 'التقرير غير موجود' }, { status: 404 })
  }

  return NextResponse.json({ report: result.data })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  var user = await getAuthUser(req)
  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  // FIX: Add centralized RBAC check
  if (!canWrite(user.role, 'daily_reports', user.permissions)) {
    return NextResponse.json({ error: 'forbidden', message: 'لا تملك صلاحية لتعديل التقارير اليومية' }, { status: 403 })
  }

  var rl = checkRateLimit(req, RateLimitPresets.write)
  if (rl.limited) {
    return NextResponse.json(
      { error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار قليلاً' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    )
  }

  var { id } = await params

  try {
    var existingResult = await safeDbOp(
      () => db.dailyReport.findUnique({
        where: { id },
        select: { createdById: true, status: true, projectId: true },
      }),
      'البحث عن التقرير'
    )

    if (!existingResult.success) return existingResult.response
    var existingReport = existingResult.data

    if (!existingReport) {
      return NextResponse.json({ error: 'not_found', message: 'التقرير غير موجود' }, { status: 404 })
    }

    // Non-admin can only edit own draft reports
    var canEditAny = user.role === 'top_management' || user.role === 'project_manager' || user.role === 'site_engineer'
    if (!canEditAny && existingReport.createdById !== user.id) {
      if (existingReport.status !== 'draft') {
        return NextResponse.json({ error: 'forbidden', message: 'لا يمكنك تعديل تقرير آخر موظف' }, { status: 403 })
      }
    }

    if (existingReport.status === 'approved' || existingReport.status === 'rejected') {
      if (user.role !== 'top_management') {
        return NextResponse.json({ error: 'forbidden', message: 'لا يمكن تعديل تقرير تم اعتماده أو رفضه' }, { status: 403 })
      }
    }

    var body = await req.json()

    var startReading = parseFloat(body.startReading) || 0
    var endReading = parseFloat(body.endReading) || 0
    var dailyMeters = Math.max(0, endReading - startReading)

    var driveLineResult = body.driveLineId
      ? await safeDbOp(() => db.driveLine.findUnique({ where: { id: body.driveLineId } }), 'جلب خط الحفر')
      : { success: false }

    var driveLine = driveLineResult.success ? driveLineResult.data : null
    var totalLength = driveLine ? driveLine.totalLength : 0
    var totalMeters = endReading
    var remainingMeters = Math.max(0, totalLength - totalMeters)
    var progressPercent = totalLength > 0 ? (totalMeters / totalLength) * 100 : 0

    var projectResult = await safeDbOp(
      () => db.project.findUnique({ where: { id: existingReport.projectId }, select: { pricePerMeter: true } }),
      'جلب بيانات المشروع'
    )

    var dailyRevenue = dailyMeters * ((projectResult.success && projectResult.data) ? projectResult.data.pricePerMeter : 0)

    var updateResult = await safeDbOp(
      () => db.dailyReport.update({
        where: { id },
        data: {
          projectId: existingReport.projectId,
          driveLineId: body.driveLineId || null,
          reportDate: body.reportDate ? new Date(body.reportDate) : existingReport.reportDate,
          weather: body.weather || null,
          workStartTime: body.workStartTime || null,
          workEndTime: body.workEndTime || null,
          operatingHours: parseFloat(body.operatingHours) || 0,
          stoppageHours: parseFloat(body.stoppageHours) || 0,
          stoppageReason: body.stoppageReason || null,
          workersCount: parseInt(body.workersCount) || 0,
          attendees: body.attendees || null,
          startReading, endReading, dailyMeters, totalMeters, remainingMeters, progressPercent,
          soilExcavated: body.soilExcavated || null,
          pipesInstalled: parseInt(body.pipesInstalled) || 0,
          productionNotes: body.productionNotes || null,
          problems: body.problems || null,
          dailyRevenue,
          status: body.status || 'draft',
        },
      }),
      'تحديث التقرير اليومي'
    )

    if (!updateResult.success) return updateResult.response

    if (body.safety && typeof body.safety === 'object') {
      var safetyBody = body.safety

      var existingSafetyResult = await safeDbOp(
        () => db.safetyReport.findUnique({ where: { dailyReportId: id } }),
        'البحث عن تقرير السلامة'
      )

      var safetyData: any = {
        projectId: existingReport.projectId,
        reportDate: body.reportDate ? new Date(body.reportDate) : existingReport.reportDate,
        ppeAvailable: !!safetyBody.ppeAvailable, helmetCheck: !!safetyBody.helmetCheck,
        bootsCheck: !!safetyBody.bootsCheck, glovesCheck: !!safetyBody.glovesCheck,
        glassesCheck: !!safetyBody.glassesCheck, workAreaCheck: !!safetyBody.workAreaCheck,
        barriersCheck: !!safetyBody.barriersCheck, shaftCheck: !!safetyBody.shaftCheck,
        ventilationCheck: !!safetyBody.ventilationCheck, electricalCheck: !!safetyBody.electricalCheck,
        craneCheck: !!safetyBody.craneCheck, hydraulicCheck: !!safetyBody.hydraulicCheck,
        fireExtinguishers: !!safetyBody.fireExtinguishers, workPermit: !!safetyBody.workPermit,
        toolboxTalk: !!safetyBody.toolboxTalk,
        hazards: safetyBody.hazards || null, observations: safetyBody.observations || null,
        violations: safetyBody.violations || null, incidentType: safetyBody.incidentType || 'none',
        incidentDescription: safetyBody.incidentDescription || null,
      }

      if (existingSafetyResult.success && existingSafetyResult.data) {
        await safeDbOp(() => db.safetyReport.update({ where: { dailyReportId: id }, data: safetyData }), 'تحديث تقرير السلامة').catch(function() {})
      } else {
        safetyData.dailyReportId = id
        safetyData.signedBy = user.name
        safetyData.signedById = user.id
        safetyData.signedAt = new Date()
        await safeDbOp(() => db.safetyReport.create({ data: safetyData }), 'إنشاء تقرير السلامة').catch(function() {})
      }
    }

    safeDbOp(() => db.auditLog.create({ data: { userId: user.id, projectId: existingReport.projectId, dailyReportId: id, action: 'update', entity: 'daily_report', entityId: id, details: 'Updated daily report' } }), 'سجل التدقيق').catch(function() {})

    return NextResponse.json({ report: updateResult.data })
  } catch (error) {
    return handleDbError(error, 'تحديث التقرير اليومي')
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  var user = await getAuthUser(req)
  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  // FIX: Use centralized RBAC instead of hardcoded admin email
  if (!canWrite(user.role, 'daily_reports', user.permissions)) {
    return NextResponse.json({ error: 'forbidden', message: 'لا تملك صلاحية لحذف التقارير اليومية' }, { status: 403 })
  }

  var rl = checkRateLimit(req, RateLimitPresets.write)
  if (rl.limited) {
    return NextResponse.json(
      { error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار قليلاً' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    )
  }

  var { id } = await params

  try {
    // FIX: Use role check instead of hardcoded admin email
    var reportResult = await safeDbOp(
      () => db.dailyReport.findUnique({ where: { id }, select: { projectId: true, status: true, createdById: true, driveLineId: true } }),
      'البحث عن التقرير'
    )

    if (!reportResult.success) return reportResult.response
    var report = reportResult.data

    if (!report) {
      return NextResponse.json({ error: 'not_found', message: 'التقرير غير موجود' }, { status: 404 })
    }

    // FIX: Role-based delete permissions instead of email comparison
    if (report.status === 'approved' && user.role !== 'top_management') {
      return NextResponse.json({ error: 'forbidden', message: 'لا يمكن حذف تقرير تم اعتماده' }, { status: 403 })
    }
    if (user.role !== 'top_management' && user.role !== 'project_manager') {
      if (report.createdById !== user.id) {
        return NextResponse.json({ error: 'forbidden', message: 'لا يمكنك حذف تقرير آخر موظف' }, { status: 403 })
      }
    }

    await safeDbOp(() => db.cost.deleteMany({ where: { dailyReportId: id } }), 'حذف التكاليف المرتبطة').catch(function() {})
    await safeDbOp(() => db.auditLog.deleteMany({ where: { dailyReportId: id } }), 'حذف سجلات التدقيق').catch(function() {})

    var deleteResult = await safeDbOp(() => db.dailyReport.delete({ where: { id } }), 'حذف التقرير اليومي')
    if (!deleteResult.success) return deleteResult.response

    if (report.driveLineId) {
      (async function() {
        var latestReport = await safeDbOp(() => db.dailyReport.findFirst({ where: { driveLineId: report.driveLineId }, orderBy: { reportDate: 'desc' }, select: { endReading: true } }), 'البحث عن آخر تقرير للخط')
        var completedLength = (latestReport.success && latestReport.data) ? latestReport.data.endReading : 0
        var dlResult = await safeDbOp(() => db.driveLine.findUnique({ where: { id: report.driveLineId }, select: { totalLength: true } }), 'جلب بيانات الخط')
        var dlTotalLength = (dlResult.success && dlResult.data) ? dlResult.data.totalLength : 0
        var dlProgress = dlTotalLength > 0 ? (completedLength / dlTotalLength) * 100 : 0
        var dlStatus = dlProgress >= 100 ? 'completed' : 'in_progress'
        await safeDbOp(() => db.driveLine.update({ where: { id: report.driveLineId }, data: { completedLength: completedLength, progress: dlProgress, status: dlStatus } }), 'تحديث تقدم خط الحفر').catch(function() {})

        var allLines = await safeDbOp(() => db.driveLine.findMany({ where: { projectId: report.projectId }, select: { totalLength: true, completedLength: true } }), 'جلب خطوط الحفر')
        if (allLines.success && allLines.data) {
          var totalAll = allLines.data.reduce(function(s: number, l: any) { return s + l.totalLength }, 0)
          var completedAll = allLines.data.reduce(function(s: number, l: any) { return s + l.completedLength }, 0)
          var projectProgress = totalAll > 0 ? (completedAll / totalAll) * 100 : 0
          await safeDbOp(() => db.project.update({ where: { id: report.projectId }, data: { progress: projectProgress } }), 'تحديث تقدم المشروع').catch(function() {})
        }
      })().catch(function() {})
    }

    safeDbOp(() => db.auditLog.create({ data: { userId: user.id, projectId: report.projectId, action: 'delete', entity: 'daily_report', entityId: id, details: 'Deleted daily report' } }), 'سجل التدقيق').catch(function() {})

    return NextResponse.json({ success: true })
  } catch (error) {
    return handleDbError(error, 'حذف التقرير اليومي')
  }
}
