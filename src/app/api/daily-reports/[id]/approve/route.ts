import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { SYSTEM_ADMIN_EMAIL, canViewPricing } from '@/lib/auth'
import { db } from '@/lib/db'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { safeDbOp, handleDbError, sanitizeDailyReport, recalcDrillingDates } from '@/lib/api-helpers'
import { ensureDriveLineDates } from '@/lib/db-selfheal'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  var user = await getAuthUser(req)
  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  // v59: الاعتماد لمدير النظام (admin@axis.om) أو الإدارة العليا (top_management) —
  // كان حصراً لمدير النظام فقط (v23)، وتوسّع بطلب صريح: المستخدم الإداري الذي يرى
  // التقارير في لوحة التحكم يعتمدها من هناك مباشرة.
  var isSystemAdmin = (user.email || '').toLowerCase().trim() === SYSTEM_ADMIN_EMAIL
  var isTopManagement = String(user.role || '').toLowerCase().trim() === 'top_management'
  if (!isSystemAdmin && !isTopManagement) {
    return NextResponse.json({ error: 'forbidden', message: 'اعتماد التقارير متاح لمدير النظام والإدارة العليا فقط' }, { status: 403 })
  }

  var rl = checkRateLimit(req, RateLimitPresets.write)
  if (rl.limited) {
    return NextResponse.json(
      { error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار قليلاً' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    )
  }

  var { id } = await params

  // v79: ضمان جاهزية عمودَي تواريخ الحفر — الاعتماد هو لحظة انضمام التقرير للمنشور
  await ensureDriveLineDates()

  try {
    var existingResult = await safeDbOp(
      () => db.dailyReport.findUnique({ where: { id } }),
      'البحث عن التقرير'
    )
    if (!existingResult.success) return existingResult.response
    var existingReport = existingResult.data

    if (!existingReport) {
      return NextResponse.json({ error: 'not_found', message: 'التقرير غير موجود' }, { status: 404 })
    }

    // v59: إصلاح خطأ صامت خطير — الزر «رفض» في الواجهة يرسل { action: 'reject' }
    // لكن نقطة النهاية كانت تتجاهل الجسم تماماً فتعتمد التقرير بدل رفضه!
    var bodyAction: any = {}
    try { bodyAction = await req.json() } catch (e) { bodyAction = {} }
    var action = bodyAction && bodyAction.action === 'reject' ? 'reject' : 'approve'

    if (existingReport.status !== 'submitted') {
      return NextResponse.json(
        { error: 'invalid_status', message: action === 'reject' ? 'لا يمكن رفض تقرير لم يتم تسليمه' : 'لا يمكن اعتماد تقرير لم يتم تسليمه' },
        { status: 400 }
      )
    }

    // v59: مسار الرفض — إرجاع التقرير بوضع «مرفوض» مع إشعار صريح لمنشئه وسجل تدقيق
    if (action === 'reject') {
      var rejectedResult = await safeDbOp(
        () => db.dailyReport.update({
          where: { id },
          data: { status: 'rejected' },
        }),
        'رفض التقرير'
      )
      if (!rejectedResult.success) return rejectedResult.response

      safeDbOp(
        () => db.auditLog.create({
          data: {
            userId: user!.id, dailyReportId: id, projectId: existingReport.projectId,
            action: 'reject', entity: 'daily_report', entityId: id,
            details: 'Rejected daily report',
          },
        }),
        'سجل التدقيق'
      ).catch(function() {})

      // صف موجّه للمنشئ حصراً (لا يُنشأ إذا كان الرافض هو المنشئ نفسه)
      if (existingReport.createdById && existingReport.createdById !== user!.id) {
        db.notification.create({
          data: {
            userId: existingReport.createdById,
            projectId: existingReport.projectId,
            type: 'report_rejected',
            title: 'تم رفض التقرير اليومي',
            message: 'تم رفض تقريرك اليومي بتاريخ ' + new Date(existingReport.reportDate).toISOString().split('T')[0] + ' بواسطة ' + user!.name + '.',
            severity: 'warning',
            link: 'dailyReports',
            entityType: 'daily_report',
            entityId: id + ':rejected',
          },
        }).catch(function() {})
      }

      return NextResponse.json({ report: sanitizeDailyReport(rejectedResult.data, canViewPricing(user)) })
    }

    // v13: لحظة الاعتماد: الإيراد = الأمتار المحفورة × سعر متر خط الحفر (أو سعر المشروع احتياطياً)
    var priceResult = await safeDbOp(
      () => db.project.findUnique({ where: { id: existingReport.projectId }, select: { pricePerMeter: true } }),
      'جلب سعر المتر'
    )
    var projectPrice = priceResult.success && priceResult.data && priceResult.data.pricePerMeter != null ? priceResult.data.pricePerMeter : 0
    var linePriceResult = existingReport.driveLineId
      ? await safeDbOp(
          () => db.driveLine.findUnique({ where: { id: existingReport.driveLineId }, select: { pricePerMeter: true } }),
          'جلب سعر خط الحفر'
        )
      : { success: false as const, response: null as any }
    var linePrice = linePriceResult.success && linePriceResult.data && linePriceResult.data.pricePerMeter != null ? linePriceResult.data.pricePerMeter : null
    var finalRevenue = (existingReport.dailyMeters || 0) * (linePrice != null ? linePrice : projectPrice)

    var updateResult = await safeDbOp(
      () => db.dailyReport.update({
        where: { id },
        data: {
          status: 'approved',
          dailyRevenue: finalRevenue,
          approvedById: user!.id,
          approvedAt: new Date(),
        },
      }),
      'اعتماد التقرير'
    )
    if (!updateResult.success) return updateResult.response

    // v79: اعتماد التقرير ينضم به لمنشور الخط — تاريخا بدء/آخر يوم حفر يتحدثان تلقائياً
    // (أول تقرير معتمد = بدء الحفر، آخر تقرير معتمد = آخر يوم حفر حتى اكتماله)
    if (existingReport.driveLineId) {
      await recalcDrillingDates(db, existingReport.driveLineId)
    }

    safeDbOp(
      () => db.auditLog.create({
        data: {
          userId: user!.id, dailyReportId: id, projectId: existingReport.projectId,
          action: 'approve', entity: 'daily_report', entityId: id,
          details: 'Approved daily report',
        },
      }),
      'سجل التدقيق'
    ).catch(function() {})

    // ── تنبيه منشئ التقرير بنتيجة الاعتماد ──
    // صف موجّه للمنشئ حصراً (لا يُنشأ إذا كان المعتمد هو المنشئ نفسه)
    if (existingReport.createdById && existingReport.createdById !== user!.id) {
      db.notification.create({
        data: {
          userId: existingReport.createdById,
          projectId: existingReport.projectId,
          type: 'report_approved',
          title: 'تم اعتماد التقرير اليومي',
          message: 'تم اعتماد تقريرك اليومي بتاريخ ' + new Date(existingReport.reportDate).toISOString().split('T')[0] + ' بواسطة ' + user!.name + '.',
          severity: 'info',
          link: 'dailyReports',
          entityType: 'daily_report',
          entityId: id + ':approved',
        },
      }).catch(function() {})
    }

    // v14.2 SECURITY: الرد مُعقّم — الاعتماد قد يشمل مستخدمين غير مصرح لهم مالياً
    return NextResponse.json({ report: sanitizeDailyReport(updateResult.data, canViewPricing(user)) })
  } catch (error) {
    return handleDbError(error, 'اعتماد التقرير')
  }
}

