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

  const costsResult = await safeDbOp(
    () => db.cost.findMany({
      where,
      orderBy: { date: 'desc' },
      include: {
        project: { select: { id: true, name: true, code: true } },
        dailyReport: { select: { id: true, reportDate: true } },
        recordedBy: { select: { name: true, nameEn: true } },
      },
      take: 200,
    }),
    'جلب التكاليف'
  )
  if (!costsResult.success) return costsResult.response

  const byCategoryResult = await safeDbOp(
    () => db.cost.groupBy({
      by: ['category'],
      where,
      _sum: { amount: true },
    }),
    'تجميع التكاليف حسب الفئة'
  )

  const costs = costsResult.data
  const byCategory = byCategoryResult.success
    ? byCategoryResult.data.map((c: any) => ({ category: c.category, amount: c._sum.amount || 0 }))
    : []
  const total = costs.reduce((s: number, c: any) => s + c.amount, 0)

  return NextResponse.json({ costs, byCategory, total })
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

    return NextResponse.json({ cost: createResult.data, success: true })
  } catch (error: any) {
    return handleDbError(error, 'إنشاء التكلفة')
  }
}
