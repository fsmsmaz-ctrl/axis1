import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { canWrite, canViewPricing, SYSTEM_ADMIN_EMAIL } from '@/lib/auth'
import { db, invalidateCachePrefix } from '@/lib/db'
import { buildAuditDetails, safeDbOp, handleDbError, recalcProgress, sanitizeDailyReport } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'

// v27: إعادة إسناد التقرير اليومي (المشروع + خط الحفر) — مسار مخصص مستقل عن تعديل المحتوى
// - للمسودة/المُسلَّم: كل من يملك كتابة التقارير اليومية أو السلامة
// - للمعتمد/المرفوض: الإدارة العليا (top_management) ومدير النظام فقط — تصحيح إداري موثّق
// - يُزامن تقرير السلامة المرتبط (إن وجد) ليبقى على نفس المشروع
// - يعيد حساب الإيراد (سعر خط الحفر الجديد أو سعر المشروع احتياطاً) وتقدم الخط/المشروع القديم والجديد
// - كل تغيير يُوثَّق في الرقابة بصيغة «قبل ← الآن» بأسماء مقروءة لا معرفات
// v29: إعادة تثبيت قراءات التقرير المنقول على الخط الجديد (نقطة الارتكاز =
// اكتمال الخط الجديد من تقاريره الأخرى) حتى لا يتضخم تقدم الخط/المشروع الجديد،
// وينخفض تقدم الخط/المشروع القديم تلقائياً بإخراج أمتار التقرير من حساباته
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  var user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  // استخراج معلومات المستخدم بعد فحص الـ null لإرضاء TypeScript داخل الـ callbacks
  var userId = user.id
  var userName = user.name
  var isSystemAdmin = (user.email || '').toLowerCase().trim() === SYSTEM_ADMIN_EMAIL
  var isTopManagement = user.role === 'top_management'
  var canEdit = canWrite(user.role, 'daily_reports', user.permissions) || canWrite(user.role, 'safety', user.permissions)

  if (!isSystemAdmin && !isTopManagement && !canEdit) {
    return NextResponse.json(
      { error: 'forbidden', message: 'تعديل إسناد المشروع وخط الحفر متاح للموظفين المصرّح لهم فقط' },
      { status: 403 }
    )
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
    var body = await req.json()
    var newProjectId = body.projectId ? String(body.projectId) : ''
    if (!newProjectId) {
      return NextResponse.json({ error: 'missing_fields', message: 'المشروع الجديد مطلوب' }, { status: 400 })
    }
    var newDriveLineId = body.driveLineId ? String(body.driveLineId) : null

    var existingResult = await safeDbOp(
      () => db.dailyReport.findUnique({
        where: { id: String(id) },
        select: {
          projectId: true,
          driveLineId: true,
          status: true,
          startReading: true,
          endReading: true,
          dailyMeters: true,
          dailyRevenue: true,
          safety: { select: { id: true, projectId: true } },
          project: { select: { id: true, name: true } },
          driveLine: { select: { id: true, lineNumber: true, startPoint: true, endPoint: true } },
        },
      }),
      'البحث عن التقرير'
    )
    if (!existingResult.success) return existingResult.response
    var existing = existingResult.data
    if (!existing) {
      return NextResponse.json({ error: 'not_found', message: 'التقرير اليومي غير موجود' }, { status: 404 })
    }

    // بوابات الحالة: المعتمد/المرفوض للإدارة العليا ومدير النظام فقط
    if (!isSystemAdmin && !isTopManagement && (existing.status === 'approved' || existing.status === 'rejected')) {
      return NextResponse.json(
        { error: 'forbidden', message: 'تعديل إسناد تقرير معتمد أو مرفوض متاح للإدارة العليا ومدير النظام فقط' },
        { status: 403 }
      )
    }

    // لا تغيير فعلي؟ نرفض بوضوح بدل كتابة بيانات مطابقة
    var projectChanged = newProjectId !== existing.projectId
    var lineChanged = (newDriveLineId || null) !== (existing.driveLineId || null)
    if (!projectChanged && !lineChanged) {
      return NextResponse.json({ error: 'no_changes', message: 'لا يوجد تغيير في الإسناد — اختر مشروعاً أو خطاً مختلفاً' }, { status: 400 })
    }

    // التحقق من المشروع الجديد
    var newProjectResult = await safeDbOp(
      () => db.project.findUnique({ where: { id: newProjectId }, select: { id: true, name: true, pricePerMeter: true } }),
      'التحقق من المشروع'
    )
    if (!newProjectResult.success) return newProjectResult.response
    var newProject = newProjectResult.data
    if (!newProject) {
      return NextResponse.json({ error: 'invalid_project', message: 'المشروع المحدد غير موجود' }, { status: 400 })
    }

    // التحقق من خط الحفر الجديد: موجود ومنتمٍ للمشروع الجديد (منع تلوث مالي بين المشاريع)
    var newLine: any = null
    if (newDriveLineId) {
      var newLineResult = await safeDbOp(
        () => db.driveLine.findUnique({ where: { id: String(newDriveLineId) } }),
        'التحقق من خط الحفر'
      )
      if (!newLineResult.success) return newLineResult.response
      newLine = newLineResult.data
      if (!newLine) {
        return NextResponse.json({ error: 'invalid_drive_line', message: 'خط الحفر المحدد غير موجود' }, { status: 400 })
      }
      if (newLine.projectId !== newProjectId) {
        return NextResponse.json({ error: 'invalid_drive_line', message: 'خط الحفر المحدد لا ينتمي إلى المشروع المحدد' }, { status: 400 })
      }
    }

    // إعادة حساب المشتقات بنفس قواعد تعديل التقرير: الإيراد = الأمتار × سعر الخط (أو سعر المشروع احتياطاً)
    var linePrice = newLine && newLine.pricePerMeter != null ? newLine.pricePerMeter : null
    var projectPrice = newProject.pricePerMeter != null ? newProject.pricePerMeter : 0
    var dailyRevenue = existing.dailyMeters * (linePrice != null ? linePrice : projectPrice)
    var totalLength = newLine ? newLine.totalLength : 0

    // v29: إعادة تثبيت القراءات على الخط الجديد — قراءات التقرير القديمة كانت
    // مقيسة على خط الحفر القديم، وتركها كما هي يلوّث حساب اكتمال الخط الجديد
    // (MAX قراءة النهاية) فيظهر تقدم المشروع الجديد مضخّماً بقيمة من مشروع آخر.
    // القاعدة: نقطة الارتكاز = اكتمال الخط الجديد من تقاريره الأخرى
    // (الأعلى بين MAX قراءة النهاية ومجموع الأمتار، مستثنياً التقرير المنقول نفسه)،
    // ثم تُثبَّت قراءات التقرير فوقه: البداية = الارتكاز، النهاية = الارتكاز + الأمتار.
    // الأمتار اليومية والإيراد لا يتغيران — فقط موقع القراءات على السلسلة الجديدة.
    var movedMeters = existing.dailyMeters || 0
    var reanchored = false
    var newStartReading = existing.startReading || 0
    var newEndReading = existing.endReading || 0
    if (newLine && lineChanged && movedMeters > 0) {
      var anchorAgg = await safeDbOp(
        () => Promise.all([
          db.dailyReport.aggregate({ where: { driveLineId: newLine.id, NOT: { id: String(id) } }, _max: { endReading: true } }),
          db.dailyReport.aggregate({ where: { driveLineId: newLine.id, NOT: { id: String(id) } }, _sum: { dailyMeters: true } }),
        ]),
        'حساب نقطة الارتكاز على الخط الجديد'
      )
      if (!anchorAgg.success) return anchorAgg.response
      var maxEnd = (anchorAgg.data && anchorAgg.data[0] && anchorAgg.data[0]._max && anchorAgg.data[0]._max.endReading) || 0
      var sumMeters = (anchorAgg.data && anchorAgg.data[1] && anchorAgg.data[1]._sum && anchorAgg.data[1]._sum.dailyMeters) || 0
      var anchor = Math.max(maxEnd, sumMeters)
      newStartReading = anchor
      newEndReading = anchor + movedMeters
      reanchored = true
    }
    var totalMeters = newEndReading
    var remainingMeters = Math.max(0, totalLength - totalMeters)
    var progressPercent = totalLength > 0 ? Math.min((totalMeters / totalLength) * 100, 100) : 0

    var updateResult = await safeDbOp(
      () => db.dailyReport.update({
        where: { id: String(id) },
        data: {
          projectId: newProjectId,
          driveLineId: newDriveLineId,
          dailyRevenue: dailyRevenue,
          startReading: newStartReading,
          endReading: newEndReading,
          totalMeters: totalMeters,
          remainingMeters: remainingMeters,
          progressPercent: progressPercent,
        },
      }),
      'تحديث إسناد التقرير'
    )
    if (!updateResult.success) return updateResult.response

    // مزامنة تقرير السلامة المرتبط — يبقى دائماً على نفس مشروع التقرير اليومي
    // (تقرير السلامة لا يحمل خط حفر خاصاً به؛ الخط يأتي من التقرير اليومي المرتبط)
    if (existing.safety && projectChanged) {
      await safeDbOp(
        () => db.safetyReport.update({ where: { id: existing.safety.id }, data: { projectId: newProjectId } }),
        'مزامنة تقرير السلامة'
      )
    }

    // إعادة حساب التقدم للخط/المشروع القديم والجديد (يعدّل completedLength وprogress وحالة الخط)
    await recalcProgress(db, existing.projectId, existing.driveLineId || null)
    await recalcProgress(db, newProjectId, newDriveLineId || null)

    // v29: إبطال كاش لوحة التحكم حتى تظهر النسب المحدثة فوراً بعد النقل
    invalidateCachePrefix('dashboard:')

    // توثيق التغيير في الرقابة بصيغة «قبل ← الآن» بأسماء مقروءة
    var oldProjectName = existing.project ? existing.project.name : String(existing.projectId)
    var newProjectName = newProject.name
    var oldLineLabel = existing.driveLine
      ? ('خط ' + (existing.driveLine.lineNumber || '-') + ': ' + (existing.driveLine.startPoint || '-') + ' \u2192 ' + (existing.driveLine.endPoint || '-'))
      : 'بدون خط حفر'
    var newLineLabel = newLine
      ? ('خط ' + (newLine.lineNumber || '-') + ': ' + (newLine.startPoint || '-') + ' \u2192 ' + (newLine.endPoint || '-'))
      : 'بدون خط حفر'
    var summary = 'تعديل إسناد التقرير اليومي — بتاريخ ' + new Date(updateResult.data.reportDate).toISOString().split('T')[0]
    var details = buildAuditDetails(
      {
        assignment: oldProjectName + ' — ' + oldLineLabel,
        revenue: existing.dailyRevenue,
        readings: (existing.startReading || 0) + ' \u2192 ' + (existing.endReading || 0) + ' م',
      },
      {
        assignment: newProjectName + ' — ' + newLineLabel,
        revenue: dailyRevenue,
        readings: newStartReading + ' \u2192 ' + newEndReading + ' م' + (reanchored ? ' (أُعيد تثبيتها على الخط الجديد)' : ''),
      },
      summary,
      {
        labelOverrides: {
          assignment: { ar: 'المشروع وخط الحفر', en: 'Project & Drive Line' },
          revenue: { ar: 'الإيراد (أُعيد حسابه)', en: 'Revenue (recalculated)' },
          readings: { ar: 'القراءات (البداية \u2192 النهاية)', en: 'Readings (start \u2192 end)' },
        },
      }
    )

    await safeDbOp(
      () => db.auditLog.create({
        data: {
          userId: userId,
          projectId: newProjectId,
          dailyReportId: String(id),
          action: 'update',
          entity: 'daily_report',
          entityId: String(id),
          details: details,
        },
      }),
      'سجل التدقيق'
    )

    // إشعار إداري غير حاجز — لتتبع عمليات النقل في لوحة الإشعارات
    safeDbOp(
      () => db.notification.create({
        data: {
          projectId: newProjectId,
          type: 'report_delay',
          title: 'تعديل إسناد تقرير يومي',
          message: 'تم نقل التقرير من «' + oldProjectName + ' — ' + oldLineLabel + '» إلى «' + newProjectName + ' — ' + newLineLabel + '» بواسطة ' + userName,
          severity: 'info',
          entityType: 'daily_report',
          entityId: String(id),
        },
      }),
      'إشعار تعديل الإسناد'
    ).catch(function() {})

    // الرد بالتقرير المحدّث كاملاً معقّماً (لا إيراد لغير المصرح لهم)
    var freshResult = await safeDbOp(
      () => db.dailyReport.findUnique({
        where: { id: String(id) },
        include: {
          project: true,
          driveLine: true,
          safety: true,
          createdBy: { select: { name: true, nameEn: true } },
          approver: { select: { name: true, nameEn: true } },
        },
      }),
      'جلب التقرير المحدّث'
    )

    return NextResponse.json({
      success: true,
      report: freshResult.success && freshResult.data ? sanitizeDailyReport(freshResult.data, canViewPricing(user)) : updateResult.data,
      revenue: dailyRevenue,
    })
  } catch (error) {
    return handleDbError(error, 'تعديل إسناد التقرير اليومي')
  }
}

