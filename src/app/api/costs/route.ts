import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, validateRequired, parseNumber, safeDbOp } from '@/lib/api-helpers'

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const projectId = searchParams.get('projectId')

  const where: any = {}
  if (projectId) where.projectId = projectId

  const [costsResult, byCategoryResult] = await Promise.all([
    safeDbOp(
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
    ),
    safeDbOp(
      () => db.cost.groupBy({
        by: ['category'],
        where,
        _sum: { amount: true },
      }),
      'تجميع التكاليف حسب الفئة'
    ),
  ])
  if (!costsResult.success) return costsResult.response

  const costs = costsResult.data
  const byCategory = byCategoryResult.success
    ? byCategoryResult.data.map((c: any) => ({ category: c.category, amount: c._sum.amount || 0 }))
    : []
  const total = costs.reduce((s: number, c: any) => s + c.amount, 0)

  // Active rental assets from CompanyAsset (this month)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999)

  const rentalResult = await safeDbOp(
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

  const rentalAssets = rentalResult.success ? rentalResult.data : []
  const totalRentalCost = rentalAssets.reduce((s: number, a: any) => s + (a.rentalCost || 0), 0)

  // Merge rental into byCategory
  const allByCategory = byCategory.slice()
  if (totalRentalCost > 0) {
    const existingRental = allByCategory.find((c: any) => c.category === 'rental')
    if (existingRental) {
      existingRental.amount += totalRentalCost
    } else {
      allByCategory.push({ category: 'rental', amount: totalRentalCost })
    }
  }

  const grandTotal = total + totalRentalCost

  return NextResponse.json({
    costs,
    byCategory: allByCategory,
    total,
    totalRentalCost,
    grandTotal,
    rentalAssets: rentalAssets.map((a: any) => ({
      id: a.id,
      name: a.name,
      supplier: a.supplier || '-',
      rentalCost: a.rentalCost || 0,
      projectName: a.project ? a.project.name : '-',
    })),
  })
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  try {
    const body = await req.json()

    const validationError = validateRequired(body, ['projectId', 'date', 'category', 'description', 'amount'])
    if (validationError) return validationError

    const createResult = await safeDbOp(
      () => db.cost.create({
        data: {
          projectId: String(body.projectId),
          dailyReportId: body.dailyReportId || null,
          date: new Date(body.date),
          category: String(body.category),
          description: String(body.description),
          amount: parseNumber(body.amount, 0),
          notes: body.notes ? String(body.notes) : null,
          recordedById: user.id,
        },
      }),
      'إنشاء التكلفة'
    )
    if (!createResult.success) return createResult.response

    Promise.all([
      safeDbOp(
        () => db.auditLog.create({
          data: {
            userId: user.id,
            projectId: String(body.projectId),
            action: 'create',
            entity: 'cost',
            entityId: createResult.data.id,
            details: `Created cost: ${body.category} - ${body.description} (${body.amount} OMR)`,
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
            message: `تم إضافة تكلفة: ${body.category} - ${body.description} بمبلغ ${body.amount} ر.ع`,
            severity: 'info',
          },
        }),
        'إشعار التكلفة'
      ),
    ]).catch(() => {})

    return NextResponse.json({ cost: createResult.data, success: true })
  } catch (error: any) {
    return handleDbError(error, 'إنشاء التكلفة')
  }
}
