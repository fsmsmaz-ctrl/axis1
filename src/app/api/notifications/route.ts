import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, safeDbOp } from '@/lib/api-helpers'

export async function GET(req: NextRequest) {
  var user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  var searchParams = new URL(req.url).searchParams
  var unreadOnly = searchParams.get('unreadOnly') === 'true'

  var where: any = {}
  if (unreadOnly) where.read = false

  // Run both queries in parallel
  var result = await safeDbOp(
    () => db.notification.findMany({
      where,
      include: { project: { select: { name: true, code: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    'جلب التنبيهات'
  )

  var countResult = await safeDbOp(
    () => db.notification.count({ where: { read: false } }),
    'عد التنبيهات غير المقروءة'
  )

  if (!result.success) return result.response

  return NextResponse.json({
    notifications: result.data,
    unreadCount: countResult.success ? countResult.data : 0,
  })
}
