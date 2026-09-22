import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, validateRequired, parseNumber, safeDbOp, parseDateRange } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { hasPermission, canWrite } from '@/lib/auth'
import { notifyUsers } from '@/lib/notify'

var COST_CATEGORIES = ['labor', 'housing', 'transport', 'fuel', 'maintenance', 'parts', 'oil', 'safety', 'rental', 'other']

export async function GET(req: NextRequest) {
  var user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  // v13.1 SECURITY: فرض صلاحية التكاليف على الخادم — كانت القراءة متاحة لأي مستخدم مسجل
  // (المحاسب/التقارير المالية rpt_costs و rpt_revenue و rpt_profit مسموحة أيضاً لصفحة التقارير)
  var canReadCosts = hasPermission(user.role, 'costs', user.permissions, user.email)
    || hasPermission(user.role, 'rpt_costs', user.permissions, user.email)
    || hasPermission(user.role, 'rpt_revenue', user.permissions, user.email)
    || hasPermission(user.role, 'rpt_profit', user.permissions, user.email)
  if (!canReadCosts) {
    return NextResponse.json({ error: 'forbidden', message: 'لا تملك صلاحية عرض التكاليف والإيرادات' }, { status: 403 })
  }

  var searchParams = new URL(req.url).searchParams
  var projectId = searchParams.get('projectId')

  var where: any = {}
  if (projectId) where.projectId = projectId

  // Period range filter (from/to) — used by the Reports section so cost,
  // revenue and profit reports respect the selected period.
  var dateRange = parseDateRange(searchParams.get('from'), searchParams.get('to'))
  if (dateRange.gte || dateRange.lt) where.date = dateRange

  // Try full query with includes first
  var costsResult = await safeDbOp(
    () => db.cost.findMany({
      where,
      orderBy: { date: 'desc' },
      include: {
        project: { select: { id: true, name: true, code: true } },
        dailyReport: { select: { id: true, reportDate: true } },
        recordedBy: { select: { name: true, nameEn: true } },
      },
    }),
    'جلب التكاليف'
  )

  // Fallback: if full query fails, try without optional relations
  if (!costsResult.success) {
    console.error('[costs GET] Full query failed, trying without relations:', costsResult.response)
    costsResult = await safeDbOp(
      () => db.cost.findMany({
        where,
        orderBy: { date: 'desc' },
        include: {
          project: { select: { id: true, name: true, code: true } },
        },
      }),
      'جلب التكاليف (بدون علاقات اختيارية)'
    )
  }

  // Fallback 2: if still failing, try simplest query
  if (!costsResult.success) {
    console.error('[costs GET] Query without relations failed, trying simple query:', costsResult.response)
    costsResult = await safeDbOp(
      () => db.cost.findMany({
        where,
        orderBy: { date: 'desc' },
      }),
      'جلب التكاليف (بسيط)'
    )
  }

  if (!costsResult.success) return costsResult.response

  var byCategoryResult = await safeDbOp(
    () => db.cost.groupBy({
      by: ['category'],
      where,
      _sum: { amount: true },
    }),
    'تجميع التكاليف حسب الفئة'
  )

  var costs = costsResult.data
  var byCategory = byCategoryResult.success
    ? byCategoryResult.data.map(function(c: any) { return { category: c.category, amount: c._sum.amount || 0 } })
    : []
  var total = costs.reduce(function(s: number, c: any) { return s + c.amount }, 0)

  // Active rental assets from CompanyAsset (this month)
  var today = new Date()
  today.setHours(0, 0, 0, 0)
  var monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
  var monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999)

  var rentalResult = await safeDbOp(
    () => db.companyAsset.findMany({
      where: {
        ownership: 'rented',
        rentalCost: { gt: 0 },
        status: { notIn: ['returned', 'damaged'] },
        OR: [
          { rentalStart: null, rentalEnd: null },
          { rentalStart: null, rentalEnd: { gte: monthStart } },
          { rentalStart: { lte: monthEnd }, rentalEnd: null },
          { rentalStart: { lte: monthEnd }, rentalEnd: { gte: monthStart } },
        ],
        ...(projectId ? { projectId: projectId } : {}),
      },
      select: { id: true, name: true, supplier: true, rentalCost: true, project: { select: { name: true } } },
    }),
    'جلب الإيجارات'
  )

  var rentalAssets = rentalResult.success ? rentalResult.data : []
  var totalRentalCost = rentalAssets.reduce(function(s: number, a: any) { return s + (a.rentalCost || 0) }, 0)

  // Add rental to byCategory
  var allByCategory = byCategory.slice()
  if (totalRentalCost > 0) {
    var existingRental = allByCategory.find(function(c: any) { return c.category === 'rental' })
    if (existingRental) {
      existingRental.amount += totalRentalCost
    } else {
      allByCategory.push({ category: 'rental', amount: totalRentalCost })
    }
  }

  var grandTotal = total + totalRentalCost

  return NextResponse.json({
    costs,
    byCategory: allByCategory,
    total,
    totalRentalCost,
    grandTotal,
    rentalAssets: rentalAssets.map(function(a: any) {
      return {
        id: a.id,
        name: a.name,
        supplier: a.supplier || '-',
        rentalCost: a.rentalCost || 0,
        projectName: a.project ? a.project.name : '-',
      }
    }),
  })
}

export async function POST(req: NextRequest) {
  var user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  // v13.1 SECURITY: كتابة التكاليف للإدارة والمحاسب فقط (كانت مفتوحة لأي مستخدم)
  if (!canWrite(user.role, 'costs', user.permissions)) {
    return NextResponse.json({ error: 'forbidden', message: 'إضافة التكاليف متاحة للإدارة والمحاسب فقط' }, { status: 403 })
  }

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

    // v32: المشروع اختياري — يمكن تسجيل الفواتير «بدون مشروع»
    var validationError = validateRequired(body, ['date', 'category', 'description', 'amount'])
    if (validationError) return validationError

    // SECURITY FIX: التحقق من صحة المبلغ المالي — منع القيم السالبة/الصفرية/العملاقة
    var amount = parseNumber(body.amount, NaN)
    if (!Number.isFinite(amount) || amount <= 0 || amount > 10000000) {
      return NextResponse.json(
        { error: 'invalid_amount', message: 'المبلغ يجب أن يكون رقماً موجباً ومعقولاً (أقل من 10,000,000)' },
        { status: 400 }
      )
    }

    // SECURITY FIX: قائمة سماح لتصنيف التكلفة
    var category = String(body.category)
    if (COST_CATEGORIES.indexOf(category) === -1) {
      category = 'other'
    }

    var userId = user.id

    var createResult = await safeDbOp(
      () => db.cost.create({
        data: {
          projectId: body.projectId ? String(body.projectId) : null, // v32: اختياري
          dailyReportId: body.dailyReportId || null,
          date: new Date(body.date),
          category: category,
          description: String(body.description).slice(0, 1000),
          amount: amount,
          notes: body.notes ? String(body.notes).slice(0, 2000) : null,
          recordedById: userId,
        },
      }),
      'إنشاء التكلفة'
    )
    if (!createResult.success) return createResult.response

    // Audit log + notification (non-critical, fire-and-forget)
    // SECURITY FIX: كان الإشعار بثاً عاماً (userId:null) يكشف المبالغ المالية لكل
    // المستخدمين متجاوزاً بوابة صلاحيات التكاليف — أصبح موجهاً لذوي صلاحية costs فقط
    Promise.all([
      safeDbOp(
        () => db.auditLog.create({
          data: {
            userId: userId,
            projectId: body.projectId ? String(body.projectId) : null,
            action: 'create',
            entity: 'cost',
            entityId: createResult.data.id,
            details: 'Created cost: ' + category + ' - ' + body.description + ' (' + amount + ' OMR)',
          },
        }),
        'سجل التدقيق'
      ),
      notifyUsers({
        type: 'cost_overrun',
        title: 'تكلفة جديدة',
        message: 'تم إضافة تكلفة: ' + category + ' - ' + body.description + ' بمبلغ ' + amount + ' ريال عماني',
        severity: 'info',
        projectId: body.projectId ? String(body.projectId) : null, // v32: اختياري
        entityType: 'cost',
        entityId: createResult.data.id,
        permissions: ['costs'],
        roles: ['top_management', 'project_manager', 'accountant'],
        excludeUserIds: [userId],
        includeSystemAdmin: true,
        link: 'costs',
      }),
    ]).catch(function() {})

    return NextResponse.json({ cost: createResult.data, success: true })
  } catch (error: any) {
    return handleDbError(error, 'إنشاء التكلفة')
  }
}

