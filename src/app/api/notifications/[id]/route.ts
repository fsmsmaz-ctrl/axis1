import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, safeDbOp } from '@/lib/api-helpers'

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  var user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })

  var { id } = await params

  var notifResult = await safeDbOp(
    () => db.notification.findUnique({ where: { id }, select: { userId: true } }),
    'البحث عن التنبيه'
  )
  if (!notifResult.success) return notifResult.response
  if (!notifResult.data) return NextResponse.json({ error: 'not_found', message: 'التنبيه غير موجود' }, { status: 404 })

  // FIX: Use role check instead of email comparison
  if (notifResult.data.userId && notifResult.data.userId !== user.id && user.role !== 'top_management') {
    return NextResponse.json({ error: 'forbidden', message: 'لا يمكنك تعديل تنبيهات مستخدم آخر' }, { status: 403 })
  }

  var body = await req.json()

  try {
    var updated = await db.notification.update({ where: { id }, data: { read: body.read ?? true } })
    return NextResponse.json({ notification: updated })
  } catch (error) {
    return handleDbError(error, 'تحديث التنبيه')
  }
}
