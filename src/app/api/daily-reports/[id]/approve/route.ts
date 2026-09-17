import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { SYSTEM_ADMIN_EMAIL, canViewPricing } from '@/lib/auth'
import { db } from '@/lib/db'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { safeDbOp, handleDbError, sanitizeDailyReport } from '@/lib/api-helpers'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  var user = await getAuthUser(req)
  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  // v23: الاعتماد لمدير النظام (admin@axis.om) فقط
  var isSystemAdmin = (user.email || '').toLowerCase().trim() === SYSTEM_ADMIN_EMAIL
  if (!isSystemAdmin) {
    return NextResponse.json({ error: 'forbidden', message: 'اعتماد التقارير متاح لمدير النظام فقط' }, { status: 403 })
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
      () => db.dailyReport.findUnique({ where: { id } }),
      'البحث عن التقرير'
    )
    if (!existingResult.success) return existingResult.response
    var existingReport = existingResult.data

    if (!existingReport) {
      return NextResponse.json({ error: 'not_found', message: 'التقرير غير موجود' }, { status: 404 })
    }

    if (existingReport.status !== 'submitted') {
      return NextResponse.json(
        { error: 'invalid_status', message: 'لا يمكن اعتماد تقرير لم يتم تسليمه' },
        { status: 400 }
      )
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
