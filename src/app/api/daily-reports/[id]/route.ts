import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { canWrite, hasPermission, canViewPricing, SYSTEM_ADMIN_EMAIL } from '@/lib/auth'
import { db } from '@/lib/db'
import { buildAuditDetails, safeDbOp, handleDbError, recalcProgress, sanitizeDailyReport } from '@/lib/api-helpers'

import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  var user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // SECURITY FIX: كانت القراءة متاحة لأي مستخدم مصادق متجاوزة صلاحيات التقارير المخصصة
  var canRead = hasPermission(user.role, 'daily_reports', user.permissions, user.email)
    || hasPermission(user.role, 'safety', user.permissions, user.email)
    || hasPermission(user.role, 'rpt_daily_site', user.permissions, user.email)
  if (!canRead) {
    return NextResponse.json({ error: 'forbidden', message: 'لا تملك صلاحية عرض التقارير اليومية' }, { status: 403 })
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

  // v14.2 SECURITY: الإيراد اليومي مشتق من سعر المتر السري — يُحذف لغير المصرح لهم
  return NextResponse.json({ report: sanitizeDailyReport(result.data, canViewPricing(user)) })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  var user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // v13.1 SECURITY: تعديل التقارير لمن يملك كتابة التقارير اليومية فقط
  // (المشرف فورمان يعدّل المسودات — كان التعديل مفتوحاً لأي مستخدم مسجل)
  // v38: الإدارة العليا تعدّل التقارير اليومية دائماً (بأي حالة)
  var isTopManagementUser = user.role === 'top_management'
  if (!isTopManagementUser && !canWrite(user.role, 'daily_reports', user.permissions)) {
    return NextResponse.json({ error: 'forbidden', message: 'تعديل التقارير اليومية متاح للمشرفين والإدارة فقط' }, { status: 403 })
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
        select: { createdById: true, status: true, projectId: true, safetyLocked: true, driveLineId: true, reportDate: true, weather: true, workStartTime: true, workEndTime: true, operatingHours: true, stoppageHours: true, stoppageReason: true, workersCount: true, attendees: true, startReading: true, endReading: true, dailyMeters: true, pipesInstalled: true, soilExcavated: true, productionNotes: true, problems: true, safety: { select: { id: true } } },
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

    // v23: أي موظف مصرّح له يعدّل ويحفظ التقرير قبل الاعتماد — حتى لو أنشأه موظف آخر
    // (تقارير قسم السلامة تصل هنا ويكملها أي موظف دون قيود ملكية أو تسليم)
    var isSystemAdmin = (user!.email || '').toLowerCase().trim() === SYSTEM_ADMIN_EMAIL
    // v38: الإدارة العليا تعدّل كل التقارير (حتى المعتمد/المرفوض) مثل مدير النظام
    var canEditReport = isTopManagementUser || canWrite(user!.role, 'daily_reports', user!.permissions) || canWrite(user!.role, 'safety', user!.permissions)
    if (!isSystemAdmin && !canEditReport) {
      return NextResponse.json({ error: 'forbidden', message: 'تعديل التقارير اليومية متاح للموظفين المصرّح لهم فقط' }, { status: 403 })
    }
    // نقطة الإغلاق هي الاعتماد: المسودة والمُسلَّم لكل المصرّح لهم، والمعتمد/المرفوض لمدير النظام والإدارة العليا (v38)
    if (!isSystemAdmin && !isTopManagementUser && (existingReport.status === 'approved' || existingReport.status === 'rejected')) {
      return NextResponse.json({ error: 'forbidden', message: 'لا يمكن تعديل تقرير معتمد أو مرفوض — التعديل متاح لمدير النظام والإدارة العليا فقط' }, { status: 403 })
    }

    // SECURITY FIX: حدود القراءات (نفس قواعد الإنشاء) — منع القيم السالبة/العملاقة
    var startReading = parseFloat(body.startReading) || 0
    var endReading = parseFloat(body.endReading) || 0
    if (startReading < 0 || endReading < 0) {
      return NextResponse.json(
        { error: 'invalid_reading', message: 'قراءات العدّاد يجب أن تكون أرقاماً غير سالبة' },
        { status: 400 }
      )
    }
    if (endReading < startReading) {
      return NextResponse.json(
        { error: 'invalid_reading', message: 'قراءة النهاية يجب أن تكون أكبر من أو تساوي قراءة البداية' },
        { status: 400 }
      )
    }
    if (endReading > 1000000) {
      return NextResponse.json(
        { error: 'invalid_reading', message: 'قيمة قراءة غير معقولة (الحد الأقصى 1,000,000 متر)' },
        { status: 400 }
      )
    }
    var dailyMeters = Math.max(0, endReading - startReading)

    // إعادة حساب الإيراد عند التعديل = الأمتار الجديدة × سعر متر خط الحفر (أو سعر المشروع احتياطياً)
    // v13: نستخدم الخط الفعلي النهائي للتقرير (الموجود حالياً إن لم يُرسل خط جديد)
    var finalDriveLineId = fromSafety ? existingReport.driveLineId : (body.driveLineId !== undefined ? (body.driveLineId || null) : existingReport.driveLineId)

    // SECURITY FIX: فحص انتماء خط الحفر للمشروع عند التعديل — كان POST يفحص و PUT لا
    // يفحص، فمكن ربط تقرير المشروع (أ) بخط من مشروع (ب) بسعر أعلى (تلوث مالي وتقدم)
    if (finalDriveLineId && finalDriveLineId !== existingReport.driveLineId) {
      var lineCheckResult = await safeDbOp(
        () => db.driveLine.findUnique({ where: { id: String(finalDriveLineId) }, select: { projectId: true } }),
        'التحقق من خط الحفر'
      )
      if (!lineCheckResult.success || !lineCheckResult.data) {
        return NextResponse.json(
          { error: 'invalid_drive_line', message: 'خط الحفر المحدد غير موجود' },
          { status: 400 }
        )
      }
      if (lineCheckResult.data.projectId !== existingReport.projectId) {
        return NextResponse.json(
          { error: 'invalid_drive_line', message: 'خط الحفر المحدد لا ينتمي إلى مشروع هذا التقرير' },
          { status: 400 }
        )
      }
    }
    var projectPriceResult = await safeDbOp(
      () => db.project.findUnique({ where: { id: existingReport.projectId }, select: { pricePerMeter: true } }),
      'جلب سعر المتر'
    )
    var projectPrice = projectPriceResult.success && projectPriceResult.data && projectPriceResult.data.pricePerMeter != null ? projectPriceResult.data.pricePerMeter : 0
    var linePriceResult = finalDriveLineId
      ? await safeDbOp(
          () => db.driveLine.findUnique({ where: { id: finalDriveLineId }, select: { pricePerMeter: true } }),
          'جلب سعر خط الحفر'
        )
      : { success: false as const }
    var linePrice = linePriceResult.success && linePriceResult.data && linePriceResult.data.pricePerMeter != null ? linePriceResult.data.pricePerMeter : null
    var dailyRevenue = dailyMeters * (linePrice != null ? linePrice : projectPrice)

    // Look up drive line (safe)
    var driveLineResult = finalDriveLineId
      ? await safeDbOp(
          () => db.driveLine.findUnique({ where: { id: finalDriveLineId } }),
          'جلب خط الحفر'
        )
      : { success: false as const }

    var driveLine = driveLineResult.success ? driveLineResult.data : null
    var totalLength = driveLine ? driveLine.totalLength : 0
    var totalMeters = endReading
    var remainingMeters = Math.max(0, totalLength - totalMeters)
    // SECURITY FIX: حصر نسبة التقدم بـ 100% + منع القيم السالبة للساعات والعمال
    var progressPercent = totalLength > 0 ? Math.min((totalMeters / totalLength) * 100, 100) : 0

    // Update the report (safe)
    // v22: بناء بيانات التعديل مسبقاً لتوثيق فروق الحقول بدقة (قبل ← الآن)
    var reportUpdateData: any = {
      projectId: existingReport.projectId,
      driveLineId: finalDriveLineId,
      reportDate: existingReport.reportDate,
      weather: fromSafety ? existingReport.weather : (body.weather || null),
      workStartTime: body.workStartTime || null,
      workEndTime: body.workEndTime || null,
      operatingHours: Math.max(0, parseFloat(body.operatingHours) || 0),
      stoppageHours: Math.max(0, parseFloat(body.stoppageHours) || 0),
      stoppageReason: body.stoppageReason || null,
      workersCount: Math.max(0, parseInt(body.workersCount) || 0),
      attendees: body.attendees || null,
      startReading: startReading,
      endReading: endReading,
      dailyMeters: dailyMeters,
      dailyRevenue: dailyRevenue,
      totalMeters: totalMeters,
      remainingMeters: remainingMeters,
      progressPercent: progressPercent,
      soilExcavated: body.soilExcavated || null,
      pipesInstalled: Math.max(0, parseInt(body.pipesInstalled) || 0),
      productionNotes: body.productionNotes || null,
      problems: body.problems || null,
      // SECURITY FIX: التسليم حصراً عبر المسار المخصص /submit — كان قبول
      // status:'submitted' هنا يتخطى إشعار المعتمدين وسجل تدقيق التسليم
      status: body.status === 'draft' ? 'draft' : existingReport.status,
    }
    var updateResult = await safeDbOp(
      () => db.dailyReport.update({
        where: { id },
        data: reportUpdateData,
      }),
      'تحديث التقرير اليومي'
    )

    if (!updateResult.success) return updateResult.response

    // CRITICAL: Recalculate progress after editing a report
    // Determine which drive line(s) to recalculate
    var newDriveLineId = finalDriveLineId
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
    // v22: توثيق دقيق للحقول المعدّلة في التقرير — القيمة قبل ← القيمة الآن
    var reportOld: any = {
      weather: existingReport.weather,
      workStartTime: existingReport.workStartTime,
      workEndTime: existingReport.workEndTime,
      operatingHours: existingReport.operatingHours,
      stoppageHours: existingReport.stoppageHours,
      stoppageReason: existingReport.stoppageReason,
      workersCount: existingReport.workersCount,
      attendees: existingReport.attendees,
      startReading: existingReport.startReading,
      endReading: existingReport.endReading,
      dailyMeters: existingReport.dailyMeters,
      pipesInstalled: existingReport.pipesInstalled,
      soilExcavated: existingReport.soilExcavated,
      productionNotes: existingReport.productionNotes,
      problems: existingReport.problems,
    }
    var reportDiff = buildAuditDetails(reportOld, reportUpdateData, 'تعديل تقرير يومي', {
      skipFields: ['id', 'createdAt', 'updatedAt', 'cuid', 'projectId', 'reportDate', 'driveLineId', 'status', 'dailyRevenue', 'totalMeters', 'remainingMeters', 'progressPercent'],
    })
    safeDbOp(
      () => db.auditLog.create({
        data: {
          userId: user!.id,
          projectId: existingReport.projectId,
          dailyReportId: id,
          action: 'update',
          entity: 'daily_report',
          entityId: id,
          details: reportDiff,
        },
      }),
      'سجل التدقيق'
    ).catch(function() {})

    // v14.2 SECURITY: الرد مُعقّم — لا إيراد لمستخدم غير مصرح له
    return NextResponse.json({ report: sanitizeDailyReport(updateResult.data, canViewPricing(user)) })
  } catch (error) {
    return handleDbError(error, 'تحديث التقرير اليومي')
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  var user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // v13.1 SECURITY: حذف تقرير يومي = إتلاف سجل مالي — للإدارة العليا ومدير النظام فقط
  var isSystemAdmin = (user.email || '').toLowerCase().trim() === SYSTEM_ADMIN_EMAIL
  if (!isSystemAdmin && user.role !== 'top_management') {
    return NextResponse.json({ error: 'forbidden', message: 'حذف التقارير اليومية متاح للإدارة العليا فقط' }, { status: 403 })
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

    // v38: الحذف للإدارة العليا ومدير النظام — الفحص أعلاه (isSystemAdmin / top_management) يكفي
    // (كان هنا جدار ثانٍ يسمح لمدير النظام فقط فجعل صلاحية الإدارة العليا عديمة الفائدة)

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

