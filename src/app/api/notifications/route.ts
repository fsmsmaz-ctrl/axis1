import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, safeDbOp } from '@/lib/api-helpers'

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const unreadOnly = searchParams.get('unreadOnly') === 'true'

  const where: any = {}
  if (unreadOnly) where.read = false

  // Run both queries in parallel
  const [result, countResult] = await Promise.all([
    safeDbOp(
      () => db.notification.findMany({
        where,
        include: { project: { select: { name: true, code: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      'جلب التنبيهات'
    ),
    safeDbOp(
      () => db.notification.count({ where: { read: false } }),
      'عد التنبيهات غير المقروءة'
    ),
  ])

  if (!result.success) return result.response

  return NextResponse.json({
    notifications: result.data,
    unreadCount: countResult.success ? countResult.data : 0,
  })
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  try {
    const body = await req.json()

    if (!body.title || !body.message || !body.type) {
      return NextResponse.json({
        error: 'missing_fields',
        message: 'العنوان والرسالة والنوع مطلوبة',
      }, { status: 400 })
    }

    const createResult = await safeDbOp(
      () => db.notification.create({
        data: {
          projectId: body.projectId || null,
          type: String(body.type),
          title: String(body.title),
          message: String(body.message),
          severity: String(body.severity || 'info'),
        },
      }),
      'إنشاء التنبيه'
    )

    if (!createResult.success) return createResult.response
    return NextResponse.json({ notification: createResult.data, success: true })
  } catch (error: any) {
    return handleDbError(error, 'إنشاء التنبيه')
  }
}
