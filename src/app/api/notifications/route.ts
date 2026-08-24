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

  // FIX: Non-admin users should only see their own notifications or broadcast (userId=null)
  if (user.role !== 'top_management' && user.role !== 'project_manager') {
    where.OR = [
      { userId: null },
      { userId: user.id },
    ]
  }

  var result = await safeDbOp(
    () => db.notification.findMany({
      where,
      include: { project: { select: { name: true, code: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    'جلب التنبيهات'
  )

  var countWhere: any = { read: false }
  if (user.role !== 'top_management' && user.role !== 'project_manager') {
    countWhere.OR = [{ userId: null }, { userId: user.id }]
  }

  var countResult = await safeDbOp(
    () => db.notification.count({ where: countWhere }),
    'عد التنبيهات غير المقروءة'
  )

  if (!result.success) return result.response

  return NextResponse.json({
    notifications: result.data,
    unreadCount: countResult.success ? countResult.data : 0,
  })
}
