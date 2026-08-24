import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, validateRequired, parseNumber, safeDbOp } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { canWrite } from '@/lib/auth'

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthUser(req)
    if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })

    const searchParams = new URL(req.url).searchParams
    const projectId = searchParams.get('projectId')
    const page = parseInt(searchParams.get('page') || '1')
    const limit = Math.min(parseInt(searchParams.get('limit') || '100'), 200)

    const where: any = {}
    if (projectId) where.projectId = projectId

    const [costsResult, byCategoryResult, rentalResult] = await Promise.all([
      safeDbOp(() => db.cost.findMany({
        where, orderBy: { date: 'desc' }, skip: (page - 1) * limit, take: limit,
        include: { project: { select: { id: true, name: true, code: true } }, dailyReport: { select: { id: true, reportDate: true } }, recordedBy: { select: { name: true, nameEn: true } } },
      }), 'جلب التكاليف'),
      safeDbOp(() => db.cost.groupBy({ by: ['category'], where, _sum: { amount: true } }), 'تجميع التكاليف'),
      safeDbOp(() => {
        var today = new Date(); today.setHours(0, 0, 0, 0)
        var monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
        var monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999)
        var rentalWhere: any = { ownership: 'rented', rentalCost: { gt: 0 }, status: { notIn: ['returned', 'damaged'] }, OR: [{ rentalStart: null, rentalEnd: null }, { rentalStart: null, rentalEnd: { gte: monthStart } }, { rentalStart: { lte: monthEnd }, rentalEnd: null }, { rentalStart: { lte: monthEnd }, rentalEnd: { gte: monthStart } }] }
        if (projectId) rentalWhere.projectId = projectId
        return db.companyAsset.findMany({ where: rentalWhere, select: { id: true, name: true, supplier: true, rentalCost: true, project: { select: { name: true } } } })
      }, 'جلب الإيجارات'),
    ])

    if (!costsResult.success) return costsResult.response
    const costs = costsResult.data
    const byCategory = byCategoryResult.success ? byCategoryResult.data.map(function(c: any) { return { category: c.category, amount: c._sum.amount || 0 } }) : []
    const total = costs.reduce(function(s: number, c: any) { return s + c.amount }, 0)
    const rentalAssets = rentalResult.success ? rentalResult.data : []
    const totalRentalCost = rentalAssets.reduce(function(s: number, a: any) { return s + (a.rentalCost || 0) }, 0)

    var allByCategory = byCategory.slice()
    if (totalRentalCost > 0) {
      var existingRental = allByCategory.find(function(c: any) { return c.category === 'rental' })
      if (existingRental) existingRental.amount += totalRentalCost
      else allByCategory.push({ category: 'rental', amount: totalRentalCost })
    }

    return NextResponse.json({ costs, byCategory: allByCategory, total, totalRentalCost, grandTotal: total + totalRentalCost, page, limit, rentalAssets: rentalAssets.map(function(a: any) { return { id: a.id, name: a.name, supplier: a.supplier || '-', rentalCost: a.rentalCost || 0, projectName: a.project ? a.project.name : '-' } }) })
  } catch (error: any) {
    return handleDbError(error, 'جلب التكاليف')
  }
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })

  // H-1 FIX: RBAC check
  if (!canWrite(user.role, 'costs', user.permissions)) {
    return NextResponse.json({ error: 'forbidden', message: 'لا تملك صلاحية لإضافة تكاليف' }, { status: 403 })
  }

  var rl = checkRateLimit(req, RateLimitPresets.write)
  if (rl.limited) return NextResponse.json({ error: 'too_many_requests', message: 'طلبات كثيرة جداً' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })

  try {
    const body = await req.json()
    const validationError = validateRequired(body, ['projectId', 'date', 'category', 'description', 'amount'])
    if (validationError) return validationError

    const createResult = await safeDbOp(
      () => db.cost.create({
        data: { projectId: String(body.projectId), dailyReportId: body.dailyReportId || null, date: new Date(body.date), category: String(body.category), description: String(body.description), amount: parseNumber(body.amount, 0), notes: body.notes ? String(body.notes) : null, recordedById: user.id },
      }), 'إنشاء التكلفة'
    )
    if (!createResult.success) return createResult.response

    Promise.all([
      safeDbOp(() => db.auditLog.create({ data: { userId: user.id, projectId: String(body.projectId), action: 'create', entity: 'cost', entityId: createResult.data.id, details: 'Cost: ' + body.category + ' - ' + body.description } }), 'سجل التدقيق'),
      safeDbOp(() => db.notification.create({ data: { projectId: String(body.projectId), type: 'cost_overrun', title: 'تكلفة جديدة', message: 'تم إضافة: ' + body.category + ' - ' + body.description, severity: 'info' } }), 'إشعار'),
    ]).catch(function() {})

    return NextResponse.json({ cost: createResult.data, success: true })
  } catch (error: any) {
    return handleDbError(error, 'إنشاء التكلفة')
  }
}
