import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { SYSTEM_ADMIN_EMAIL } from '@/lib/auth'
import { db } from '@/lib/db'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { safeDbOp, handleDbError, parseDateRange } from '@/lib/api-helpers'

export const dynamic = 'force-dynamic'

// v60: تقرير المتوسطات التشغيلية والمالية — تقرير سري
// يظهر حصرياً للإدارة العليا (top_management) ومدير النظام (admin@axis.om).
// الحماية على الخادم نفسه: أي حساب آخر (موظفون/مشرفون/مالية/العميل/زائر)
// يُرفض هنا حتى لو وصل للرابط المباشر أو استدعى الـ API يدوياً — والتصدير
// (PDF/Excel) يتم في الواجهة من بيانات لا يمكن لغير المخوّلين جلبها أصلاً.

// القاعدة الزمنية: أيام العمل الفعلية = كل يوم يوجد فيه تقرير عمل يومي مُسلَّم
// أو معتمد — بما فيها أيام الإنجاز صفر (يوم عمل فعلي)؛ أيام الإجازات أو الأيام
// بلا تقارير لا تدخل في المتوسطات.

// القسمة الآمنة: أي قسمة على صفر (أو بيانات ناقصة) ترجع null →
// الواجهة تعرض «لا توجد بيانات كافية» بدل نتيجة خاطئة
function div(a: number, b: number): number | null {
  if (a === null || a === undefined || !isFinite(a)) return null
  if (!b || !isFinite(b)) return null
  return a / b
}

function dayKey(d: Date | string): string {
  return new Date(d).toISOString().split('T')[0]
}

export async function GET(req: NextRequest) {
  var user = await getAuthUser(req)
  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  var isSystemAdmin = (user.email || '').toLowerCase().trim() === SYSTEM_ADMIN_EMAIL
  var isTopManagement = String(user.role || '').toLowerCase().trim() === 'top_management'
  if (!isSystemAdmin && !isTopManagement) {
    return NextResponse.json(
      { error: 'forbidden', message: 'هذا التقرير سري ومتاح للإدارة العليا فقط' },
      { status: 403 }
    )
  }

  var rl = checkRateLimit(req, RateLimitPresets.read)
  if (rl.limited) {
    return NextResponse.json(
      { error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار قليلاً' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    )
  }

  try {
    var searchParams = new URL(req.url).searchParams
    var projectId = searchParams.get('projectId')
    var driveLineId = searchParams.get('driveLineId')
    var from = searchParams.get('from')
    var to = searchParams.get('to')

    if (!projectId || !from || !to) {
      return NextResponse.json(
        { error: 'bad_request', message: 'يجب تحديد المشروع والفترة (من تاريخ — إلى تاريخ)' },
        { status: 400 }
      )
    }

    var range = parseDateRange(from, to)
    if (!range.gte || !range.lt) {
      return NextResponse.json(
        { error: 'bad_request', message: 'صيغة التاريخ غير صالحة' },
        { status: 400 }
      )
    }

    var projectResult = await safeDbOp(
      () => db.project.findUnique({ where: { id: projectId as string }, select: { id: true, name: true, code: true, pricePerMeter: true } }),
      'جلب المشروع'
    )
    if (!projectResult.success) return projectResult.response
    var project = projectResult.data
    if (!project) {
      return NextResponse.json({ error: 'not_found', message: 'المشروع غير موجود' }, { status: 404 })
    }

    var lineSelected = !!(driveLineId && driveLineId !== 'all')

    // تقارير العمل اليومي في الفترة (المسلَّمة والمعتمدة) — مع فلتر الخط عند تحديده
    var reportWhere: any = {
      projectId: projectId,
      reportDate: { gte: range.gte, lt: range.lt },
      status: { in: ['submitted', 'approved'] },
    }
    if (lineSelected) reportWhere.driveLineId = driveLineId as string

    var reportsResult = await safeDbOp(
      () => db.dailyReport.findMany({
        where: reportWhere,
        select: {
          reportDate: true,
          dailyMeters: true,
          workersCount: true,
          driveLineId: true,
          driveLine: { select: { lineNumber: true, pricePerMeter: true } },
        },
        orderBy: { reportDate: 'asc' },
      }),
      'جلب تقارير الفترة'
    )
    if (!reportsResult.success) return reportsResult.response
    var reports = reportsResult.data || []

    // قيمة الأعمال المنفذة = مجموع أمتار كل خط × سعر المتر المعتمد لذلك الخط
    // (سعر الخط أولاً، وسعر المشروع احتياطياً لخطوط بلا سعر أو تقارير بلا خط —
    // نفس قاعدة احتساب الإيراد لحظة الاعتماد)
    var projectPrice = project.pricePerMeter != null ? Number(project.pricePerMeter) : 0
    var totalMeters = 0
    var workersSum = 0
    var workValue = 0
    var uniqueDays = new Set<string>()
    var perLineMap: Record<string, { label: string; meters: number; price: number; value: number }> = {}

    for (var i = 0; i < reports.length; i++) {
      var r = reports[i]
      var meters = Number(r.dailyMeters) || 0
      var linePrice = r.driveLine && r.driveLine.pricePerMeter != null ? Number(r.driveLine.pricePerMeter) : projectPrice
      var lineLabel = r.driveLine && r.driveLine.lineNumber ? ('خط ' + r.driveLine.lineNumber) : 'بدون خط'
      totalMeters += meters
      workersSum += Number(r.workersCount) || 0
      workValue += meters * linePrice
      uniqueDays.add(dayKey(r.reportDate))

      var bucketKey = r.driveLineId || 'no_line'
      if (!perLineMap[bucketKey]) {
        perLineMap[bucketKey] = { label: lineLabel, meters: 0, price: linePrice, value: 0 }
      }
      perLineMap[bucketKey].meters += meters
      perLineMap[bucketKey].value += meters * linePrice
    }

    var workingDays = uniqueDays.size

    // التكاليف: مستندات مالية على مستوى المشروع كاملاً (لا تُنسب لخط بعينه)
    // لذا عند اختيار خط محدد ترجع costTotal=null وتعرض الواجهة توضيحاً بدل أرقام مضللة
    var costTotal: number | null = null
    var costsByCategory: Array<{ category: string; amount: number }> = []
    if (!lineSelected) {
      var costsAggResult = await safeDbOp(
        () => db.cost.groupBy({
          by: ['category'],
          where: { projectId: projectId as string, date: { gte: range.gte, lt: range.lt } },
          _sum: { amount: true },
        }),
        'تجميع تكاليف الفترة'
      )
      if (!costsAggResult.success) return costsAggResult.response
      costsByCategory = (costsAggResult.data || []).map(function(c: any) {
        return { category: c.category, amount: c._sum.amount || 0 }
      })
      costTotal = costsByCategory.reduce(function(s, c) { return s + c.amount }, 0)
    }

    var insufficient = workingDays === 0 || totalMeters === 0

    var netProfit: number | null = null
    if (!lineSelected && costTotal != null) {
      netProfit = workValue - costTotal
    }

    var metrics = {
      // الإجماليات
      totalMeters: totalMeters,
      workingDays: workingDays,
      workersSum: workersSum,
      costTotal: costTotal,
      workValue: workValue,
      netProfit: netProfit,
      // المتوسطات (null = لا توجد بيانات كافية للقسمة)
      avgDailyMeters: div(totalMeters, workingDays),
      avgWorkers: div(workersSum, workingDays),
      avgCostPerMeter: !lineSelected ? div(costTotal || 0, totalMeters) : null,
      avgDailySpend: !lineSelected ? div(costTotal || 0, workingDays) : null,
      avgDailyProfit: !lineSelected ? div(netProfit || 0, workingDays) : null,
      profitPerMeter: !lineSelected ? div(netProfit || 0, totalMeters) : null,
      profitMarginPct: (!lineSelected && workValue > 0 && netProfit != null) ? (netProfit / workValue) * 100 : null,
    }

    var lineInfo = null
    if (lineSelected) {
      var dlResult = await safeDbOp(
        () => db.driveLine.findUnique({ where: { id: driveLineId as string }, select: { id: true, lineNumber: true, startPoint: true, endPoint: true, pricePerMeter: true } }),
        'جلب خط الحفر'
      )
      if (!dlResult.success) return dlResult.response
      lineInfo = dlResult.data
    }

    return NextResponse.json({
      report: {
        project: project,
        driveLine: lineInfo,
        period: { from: from, to: to },
        metrics: metrics,
        perLine: Object.keys(perLineMap).map(function(k) { return perLineMap[k] }),
        insufficient: insufficient,
        costsScope: lineSelected ? 'project_only' : 'project',
        reportsCount: reports.length,
      },
    })
  } catch (error) {
    return handleDbError(error, 'تقرير المتوسطات التشغيلية والمالية')
  }
}
