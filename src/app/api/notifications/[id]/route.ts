import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError } from '@/lib/api-helpers'

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  var user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // H-2 FIX: Only allow marking own notifications as read
  var { id } = await params
  var notification = await db.notification.findUnique({ where: { id }, select: { userId: true } })
  if (!notification) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  // Allow if notification has no userId (broadcast) or belongs to user
  if (notification.userId && notification.userId !== user.id && user.role !== 'top_management') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  var body = await req.json()

  try {
    var updated = await db.notification.update({ where: { id }, data: { read: body.read ?? true } })
    return NextResponse.json({ notification: updated })
  } catch (error) {
    return handleDbError(error, 'تحديث التنبيه')
  }
}
