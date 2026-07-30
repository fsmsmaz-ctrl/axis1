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

  // Run both queries in parallel
  var costsResult = await safeDbOp(
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

  var byCategoryResult = await safeDbOp(
    () => db.cost.groupBy({
      by: ['category'],
      where,
      _sum: { amount: true },
    }),
    'تجميع التكاليف حسب الفئة'
  )

  if (!costsResult.success) return costsResult.response

  var costs = costsResult.data
  var byCategory = byCategoryResult.success
    ? byCategoryResult.data.map(function(c: any) { return { category: c.category, amount: c._sum.amount || 0 } })
    : []
  var total = costs.reduce(function(s: number, c: any) { return s + c.amount }, 0)

  return NextResponse.json({ costs, byCategory, total })
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
          recordedById: user.id,
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
            userId: user.id,
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
