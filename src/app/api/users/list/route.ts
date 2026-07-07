import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  if (user.email.toLowerCase().trim() !== 'admin@axis.om') {
    return NextResponse.json({ error: 'forbidden', message: 'فقط المدير يمكنه عرض المستخدمين' }, { status: 403 })
  }

  try {
    const users = await db.user.findMany({
      select: { id: true, email: true, name: true, nameEn: true, phone: true, role: true, active: true, language: true, permissions: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    })

    return NextResponse.json({ users })
  } catch (error: any) {
    console.error('User list error:', error)
    return NextResponse.json({ error: 'server_error', message: 'فشل جلب المستخدمين' }, { status: 500 })
  }
}
