import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { hasPermission, canWrite } from '@/lib/auth'
import { db } from '@/lib/db'
import { handleDbError, validateRequired, safeDbOp } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { ensureDailyReportSafety } from '@/lib/db-selfheal'

export async function GET(req: NextRequest) {
  var user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  // v13.1 SECURITY: قسم السلامة لمن يملك صلاحيتها أو تقرير السلامة في صفحة التقارير
  var canRead = hasPermission(user.role, 'safety', user.permissions, user.email)
    || hasPermission(user.role, 'rpt_safety', user.permissions, user.email)
  if (!canRead) {
    return NextResponse.json({ error: 'forbidden', message: 'لا تملك صلاحية الوصول لقسم السلامة' }, { status: 403 })
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
        // v26: خط الحفر المرتبط لعرضه مقفلاً في وضع تعديل تقرير السلامة
        dailyReport: { select: { id: true, reportDate: true, status: true, driveLine: { select: { id: true, lineNumber: true, startPoint: true, endPoint: true } } } },
        signedByUser: { select: { name: true, nameEn: true } },
      },
    }),
    'جلب تقارير السلامة'
  )

  if (!result.success) return result.response
  return NextResponse.json({ safetyReports: result.data })
}

var VALID_INCIDENT_CREATE = ['none', 'near_miss', 'incident', 'accident']

export async function POST(req: NextRequest) {
  var user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  // v13.1 SECURITY: إنشاء التقارير اليومية عبر السلامة لمن يملك كتابة السلامة فقط
  // (كان يمكن لأي مستخدم مسجل إنشاء/استبدال تقارير عبر هذا المسار)
  if (!canWrite(user.role, 'safety', user.permissions)) {
    return NextResponse.json({ error: 'forbidden', message: 'إنشاء تقارير السلامة متاح للإدارة والمهندسين ومسؤول السلامة فقط' }, { status: 403 })
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

    // === Validate drive line: must exist, belong to the project, and be in progress ===
    // v58: تُنشأ تقارير السلامة فقط للخطوط قيد التنفيذ — طلب صريح من المستخدم:
    // «الخطوط المكتملة أو التي لم تبدأ يجب ألا تظهر للاختيار وإنشاء تقارير لها».
    // الواجهة تخفيها من القائمة، وهذا الفحص حماية إضافية على الخادم (تحوّط الإرسال المباشر).
    if (body.driveLineId) {
      var dlResult = await safeDbOp(
        () => db.driveLine.findUnique({ where: { id: String(body.driveLineId) } }),
        'جلب خط الحفر'
      )
      if (!dlResult.success) return dlResult.response

      var dl = dlResult.data
      if (!dl) {
        return NextResponse.json(
          { error: 'invalid_drive_line', message: 'خط الحفر المحدد غير موجود' },
          { status: 400 }
        )
      }
      if (dl.projectId !== String(body.projectId)) {
        return NextResponse.json(
          { error: 'invalid_drive_line', message: 'خط الحفر المحدد لا ينتمي إلى المشروع المختار' },
          { status: 400 }
        )
      }
      // v58: رفض الخطوط غير قيد التنفيذ (لم تبدأ / متوقفة / مكتملة) برسالة عربية تذكر حالة الخط الفعلية
      var inactiveLabels: Record<string, string> = { not_started: 'لم يبدأ', completed: 'مكتمل', suspended: 'متوقف' }
      if (dl.status !== 'in_progress') {
        var inactiveLabel = inactiveLabels[dl.status] || dl.status
        return NextResponse.json(
          { error: 'drive_line_not_active', message: 'لا يمكن إنشاء تقرير سلامة لخط «' + (dl.lineNumber || '-') + '» لأن حالته «' + inactiveLabel + '» — تُنشأ تقارير السلامة فقط للخطوط قيد التنفيذ' },
          { status: 400 }
        )
      }
    }
    // === End of drive line validation ===

    // v57: شفاء ذاتي — ضمان وجود عمود safetyLocked وجدول SafetyReport قبل الكتابة
    // (درس v44: الشفاء يُربَط بالمسارات المستخدمة فعلياً — أي نقص يظهر سابقاً كرسالة
    // «قاعدة البيانات غير مهيأة» عند الحفظ دون أي إصلاح تلقائي)
    await ensureDailyReportSafety()

    // === فحص التكرار ===
    // v55: القاعدة أصبحت «تقرير سلامة واحد لكل خط حفر في اليوم» بدل «تقرير واحد لكل مشروع في اليوم» —
    // المشاريع متعددة الخطوط (مثل تواتير 1 وتواتير 2) تحتاج تقرير سلامة مستقلاً لكل خط في نفس التاريخ،
    // بينما القيد القديم كان يربط كل خطوط المشروع ببعضها فيمنع التقرير الثاني.
    // - عند اختيار خط حفر: نمنع التكرار على مستوى (المشروع + الخط + التاريخ) لأي موقّع،
    //   لأن منع تكرار التقرير اليومي لنفس الخط في نفس اليوم أهم من هوية الموقّع
    // - بدون خط حفر: يبقى السلوك القديم (تقرير واحد لكل موظف لكل مشروع في اليوم)
    var dateStart = new Date(body.reportDate)
    dateStart.setHours(0, 0, 0, 0)
    var dateEnd = new Date(body.reportDate)
    dateEnd.setHours(23, 59, 59, 999)

    var selectedLineId = body.driveLineId ? String(body.driveLineId) : ''

    var duplicateWhere: any = selectedLineId
      ? {
          projectId: body.projectId,
          reportDate: { gte: dateStart, lte: dateEnd },
          dailyReport: { driveLineId: selectedLineId },
        }
      : {
          projectId: body.projectId,
          signedById: userId,
          reportDate: { gte: dateStart, lte: dateEnd },
        }

    var existingResult = await safeDbOp(
      () => db.safetyReport.findFirst({
        where: duplicateWhere,
        include: { dailyReport: { select: { id: true, driveLine: { select: { lineNumber: true, startPoint: true, endPoint: true } } } } },
      }),
      'التحقق من فحص السلامة'
    )

    if (existingResult.success && existingResult.data) {
      var dupLine = existingResult.data.dailyReport && existingResult.data.dailyReport.driveLine
      var dupLineLabel = dupLine
        ? ('خط ' + (dupLine.lineNumber || '-') + ' - ' + (dupLine.startPoint || '-') + ' \u2192 ' + (dupLine.endPoint || '-'))
        : ''
      var dupMessage = selectedLineId
        ? ('تم إنشاء تقرير سلامة لهذا الخط (' + dupLineLabel + ') في هذا التاريخ بالفعل — كل خط حفر له تقريره المستقل في نفس اليوم')
        : 'لقد قمت بإنشاء تقرير سلامة لهذا المشروع في هذا التاريخ بالفعل'
      return NextResponse.json(
        {
          error: 'duplicate',
          message: dupMessage,
          existingId: existingResult.data.id,
        },
        { status: 409 }
      )
    }
    // === نهاية فحص التكرار ===

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
      // v70: قوائم سماح وحدود — مطابقة نسخة [id] المصلحة
      hazards: typeof body.hazards === 'string' && body.hazards.length <= 20000 ? body.hazards : '[]',
      observations: body.observations ? String(body.observations).slice(0, 5000) : null,
      violations: body.violations ? String(body.violations).slice(0, 5000) : null,
      incidentType: VALID_INCIDENT_CREATE.includes(String(body.incidentType)) ? String(body.incidentType) : 'none',
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

  // v38: الحذف متاح لمدير النظام والإدارة العليا
  var userRoleNorm = String(user.role || '').toLowerCase().trim()
  if (userRoleNorm !== 'top_management' && user.email.toLowerCase().trim() !== ADMIN_EMAIL) {
    return NextResponse.json({ error: 'forbidden', message: 'هذه العملية متاحة لمدير النظام والإدارة العليا فقط' }, { status: 403 })
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



