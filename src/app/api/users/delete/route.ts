import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'

export async function DELETE(req: NextRequest) {
  const user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  if (user.email.toLowerCase().trim() !== 'admin@axis.om') {
    return NextResponse.json({ error: 'forbidden', message: 'فقط المدير يمكنه الحذف' }, { status: 403 })
  }

  try {
    const { searchParams } = new URL(req.url)
    const userId = searchParams.get('id')

    if (!userId) {
      return NextResponse.json({ error: 'missing_fields', message: 'معرف المستخدم مطلوب' }, { status: 400 })
    }

    const targetUser = await db.user.findUnique({ where: { id: userId } })
    if (!targetUser) {
      return NextResponse.json({ error: 'not_found', message: 'المستخدم غير موجود' }, { status: 404 })
    }

    if (targetUser.email.toLowerCase().trim() === 'admin@axis.om') {
      return NextResponse.json({ error: 'forbidden', message: 'لا يمكن حذف المدير' }, { status: 403 })
    }

    await db.user.delete({ where: { id: userId } })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('User delete error:', error)
    return NextResponse.json({ error: 'server_error', message: 'فشل حذف المستخدم' }, { status: 500 })
  }
}
