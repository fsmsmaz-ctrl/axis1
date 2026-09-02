import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { SYSTEM_ADMIN_EMAIL } from '@/lib/auth'
import { db } from '@/lib/db'
import { safeDbOp, handleDbError, recalcProgress } from '@/lib/api-helpers'

import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  var user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
    return NextResponse.json({ error: 'Report not found' }, { status: 404 })
  }

  return NextResponse.json({ report: result.data })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  var user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Rate limit write operations
  var rl = checkRateLimit(req, RateLimitPresets.write)
  if (rl.limited) {
    return NextResponse.json(
      { error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار قليلاً' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    )
  }

  var { id } = await params

  try {
    // Fetch the report first to verify ownership and status
    var existingResult = await safeDbOp(
      () => db.dailyReport.findUnique({
        where: { id },
        select: { createdById: true, status: true, projectId: true, safetyLocked: true, driveLineId: true, reportDate: true, safety: { select: { id: true } } },
      }),
      'البحث عن التقرير'
    )

    if (!existingResult.success) return existingResult.response
    var existingReport = existingResult.data

    if (!existingReport) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 })
    }

    var body = await req.json()

    // بيانات السلامة (المشروع/خط الحفر/التاريخ/الطقس) للقراءة فقط — لا يمكن تعديلها
    // يكفي وجود تقرير سلامة مرتبط (أو علم safetyLocked) لإثبات أن التقرير قادم من قسم السلامة
    // — يشمل التقارير القديمة التي أُنشئت قبل تفعيل العلم
    var fromSafety = !!existingReport.safetyLocked || !!existingReport.safety
    if (fromSafety) {
      delete body.projectId
      delete body.driveLineId
      delete body.reportDate
      delete body.weather
    }

    // بعد التسليم أو الاعتماد أو الرفض: التعديل لمدير النظام (admin@axis.om) فقط
    var isSystemAdmin = (user!.email || '').toLowerCase().trim() === SYSTEM_ADMIN_EMAIL
    if (existingReport.status !== 'draft' && !isSystemAdmin) {
      return NextResponse.json({ error: 'forbidden', message: 'لا يمكن تعديل التقرير بعد تسليمه — التعديل متاح لمدير النظام فقط' }, { status: 403 })
    }

    // التعديل: المشرف (foreman) أو مدير النظام فقط — لا يمكن لأي مستخدم آخر التعديل إطلاقاً
    var isSupervisor = user!.role === 'foreman'
    if (!isSystemAdmin && !isSupervisor) {
      return NextResponse.json({ error: 'forbidden', message: 'تعديل التقارير اليومية متاح للمشرف ومدير النظام فقط' }, { status: 403 })
    }

    var startReading = parseFloat(body.startReading) || 0
    var endReading = parseFloat(body.endReading) || 0
    var dailyMeters = Math.max(0, endReading - startReading)

    // إعادة حساب الإيراد عند التعديل = الأمتار الجديدة × سعر المتر الحالي للمشروع
    var projectPriceResult = await safeDbOp(
      () => db.project.findUnique({ where: { id: existingReport.projectId }, select: { pricePerMeter: true } }),
      'جلب سعر المتر'
    )
    var projectPrice = projectPriceResult.success && projectPriceResult.data ? (projectPriceResult.data.pricePerMeter || 0) : 0
    var dailyRevenue = dailyMeters * projectPrice

    // Look up drive line (safe)
    var driveLineResult = body.driveLineId
      ? await safeDbOp(
          () => db.driveLine.findUnique({ where: { id: body.driveLineId } }),
          'جلب خط الحفر'
        )
      : { success: false }

    var driveLine = driveLineResult.success ? driveLineResult.data : null
    var totalLength = driveLine ? driveLine.totalLength : 0
    var totalMeters = endReading
    var remainingMeters = Math.max(0, totalLength - totalMeters)
    var progressPercent = totalLength > 0 ? (totalMeters / totalLength) * 100 : 0

    // Update the report (safe)
    var updateResult = await safeDbOp(
      () => db.dailyReport.update({
        where: { id },
        data: {
          projectId: existingReport.projectId,
          driveLineId: fromSafety ? existingReport.driveLineId : (body.driveLineId || null),
          reportDate: existingReport.reportDate,
          weather: fromSafety ? existingReport.weather : (body.weather || null),
          workStartTime: body.workStartTime || null,
          workEndTime: body.workEndTime || null,
          operatingHours: parseFloat(body.operatingHours) || 0,
          stoppageHours: parseFloat(body.stoppageHours) || 0,
          stoppageReason: body.stoppageReason || null,
          workersCount: parseInt(body.workersCount) || 0,
          attendees: body.attendees || null,
          startReading: startReading,
          endReading: endReading,
          dailyMeters: dailyMeters,
          dailyRevenue: dailyRevenue,
          totalMeters: totalMeters,
          remainingMeters: remainingMeters,
          progressPercent: progressPercent,
          soilExcavated: body.soilExcavated || null,
          pipesInstalled: parseInt(body.pipesInstalled) || 0,
          productionNotes: body.productionNotes || null,
          problems: body.problems || null,
          // الحالة: تُحفظ الحالية إلا إذا طُلب صراحة draft/submitted —
          // لا يمكن تعيين approved/rejected إلا عبر مسار الاعتماد المخصص
          status: (body.status === 'draft' || body.status === 'submitted') ? body.status : existingReport.status,
        },
      }),
      'تحديث التقرير اليومي'
    )

    if (!updateResult.success) return updateResult.response

    // CRITICAL: Recalculate progress after editing a report
    // Determine which drive line(s) to recalculate
    var newDriveLineId = fromSafety ? existingReport.driveLineId : (body.driveLineId || null)
    if (newDriveLineId) {
      // If drive line changed, also recalc the old one
      if (existingReport.driveLineId && existingReport.driveLineId !== newDriveLineId) {
        await recalcProgress(db, existingReport.projectId, existingReport.driveLineId)
      }
      await recalcProgress(db, existingReport.projectId, String(newDriveLineId))
    } else if (existingReport.driveLineId) {
      // Drive line was removed from report, recalc the old one
      await recalcProgress(db, existingReport.projectId, existingReport.driveLineId)
    } else {
      // No drive line involved, recalc all lines in project
      await recalcProgress(db, existingReport.projectId, null)
    }

    // Audit log (non-critical)
    safeDbOp(
      () => db.auditLog.create({
        data: {
          userId: user!.id,
          projectId: existingReport.projectId,
          dailyReportId: id,
          action: 'update',
          entity: 'daily_report',
          entityId: id,
          details: 'Updated daily report',
        },
      }),
      'سجل التدقيق'
    ).catch(function() {})

    return NextResponse.json({ report: updateResult.data })
  } catch (error) {
    return handleDbError(error, 'تحديث التقرير اليومي')
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  var user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Rate limit write operations
  var rl = checkRateLimit(req, RateLimitPresets.write)
  if (rl.limited) {
    return NextResponse.json(
      { error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار قليلاً' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    )
  }

  var { id } = await params

  try {
    // Get report details before deleting (include driveLineId for progress recalc)
    var reportResult = await safeDbOp(
      () => db.dailyReport.findUnique({
        where: { id },
        select: { projectId: true, status: true, createdById: true, driveLineId: true },
      }),
      'البحث عن التقرير'
    )

    if (!reportResult.success) return reportResult.response
    var report = reportResult.data

    if (!report) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 })
    }

    // Save driveLineId before deletion for progress recalculation
    var deletedDriveLineId = report.driveLineId
    var deletedProjectId = report.projectId

    // الحذف: مدير النظام (admin@axis.om) فقط — مخفٍ وممنوع عن كل المستخدمين الآخرين
    var isSystemAdminDelete = (user!.email || '').toLowerCase().trim() === SYSTEM_ADMIN_EMAIL
    if (!isSystemAdminDelete) {
      return NextResponse.json({ error: 'forbidden', message: 'حذف التقارير متاح لمدير النظام فقط' }, { status: 403 })
    }

    var deleteResult = await safeDbOp(
      () => db.dailyReport.delete({ where: { id } }),
      'حذف التقرير اليومي'
    )

    if (!deleteResult.success) return deleteResult.response

    // CRITICAL: Recalculate progress after deleting a report
    await recalcProgress(db, deletedProjectId, deletedDriveLineId)

    // Audit log + delete notification (non-critical, fire-and-forget)
    Promise.all([
      safeDbOp(
        () => db.auditLog.create({
          data: {
            userId: user!.id,
            projectId: report.projectId,
            dailyReportId: id,
            action: 'delete',
            entity: 'daily_report',
            entityId: id,
            details: 'Deleted daily report',
          },
        }),
        'سجل التدقيق'
      ),
      safeDbOp(
        () => db.notification.create({
          data: {
            projectId: report.projectId,
            type: 'report_delay',
            title: 'حذف تقرير يومي',
            message: 'تم حذف تقرير يومي (المعرف: ' + id + ') بواسطة ' + user!.name,
            severity: 'warning',
          },
        }),
        'إشعار الحذف'
      ),
    ]).catch(function() {})

    return NextResponse.json({ success: true })
  } catch (error) {
    return handleDbError(error, 'حذف التقرير اليومي')
  }
}

