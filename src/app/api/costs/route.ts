import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, validateRequired, parseNumber, safeDbOp } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'

export async function GET(req: NextRequest) {
  var user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  var searchParams = new URL(req.url).searchParams
  var projectId = searchParams.get('projectId')

  var where: any = {}
  if (projectId) where.projectId = projectId

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

    var validationError = validateRequired(body, ['projectId', 'date', 'category', 'description', 'amount'])
    if (validationError) return validationError

    var userId = user.id

    var createResult = await safeDbOp(
      () => db.cost.create({
        data: {
          projectId: String(body.projectId),
          dailyReportId: body.dailyReportId || null,
          date: new Date(body.date),
          category: String(body.category),
          description: String(body.description),
          amount: parseNumber(body.amount, 0),
          notes: body.notes ? String(body.notes) : null,
          recordedById: userId,
        },
      }),
      'إنشاء التكلفة'
    )
    if (!createResult.success) return createResult.response

    // Audit log + notification (non-critical, fire-and-forget)
    Promise.all([
      safeDbOp(
        () => db.auditLog.create({
          data: {
            userId: userId,
            projectId: String(body.projectId),
            action: 'create',
            entity: 'cost',
            entityId: createResult.data.id,
            details: 'Created cost: ' + body.category + ' - ' + body.description + ' (' + body.amount + ' OMR)',
          },
        }),
        'سجل التدقيق'
      ),
      safeDbOp(
        () => db.notification.create({
          data: {
            projectId: String(body.projectId),
            type: 'cost_overrun',
            title: 'تكلفة جديدة',
            message: 'تم إضافة تكلفة: ' + body.category + ' - ' + body.description + ' بمبلغ ' + body.amount + ' ريال عماني',
            severity: 'info',
          },
        }),
        'إشعار التكلفة'
      ),
    ]).catch(function() {})

    return NextResponse.json({ cost: createResult.data, success: true })
  } catch (error: any) {
    return handleDbError(error, 'إنشاء التكلفة')
  }
}
