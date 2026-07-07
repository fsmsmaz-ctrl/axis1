import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import bcrypt from 'bcryptjs'

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  if (user.email.toLowerCase().trim() !== 'admin@axis.om') {
    return NextResponse.json({ error: 'forbidden', message: 'فقط المدير يمكنه إنشاء مستخدم' }, { status: 403 })
  }

  try {
    const body = await req.json()
    const { name, nameEn, email, phone, role, password, permissions } = body

    if (!name?.trim() || !email?.trim() || !password?.trim()) {
      return NextResponse.json({ error: 'missing_fields', message: 'الاسم والبريد وكلمة المرور مطلوبة' }, { status: 400 })
    }

    const existing = await db.user.findUnique({ where: { email: email.trim().toLowerCase() } })
    if (existing) {
      return NextResponse.json({ error: 'exists', message: 'البريد الإلكتروني مستخدم بالفعل' }, { status: 409 })
    }

    const hashedPassword = await bcrypt.hash(password.trim(), 12)

    const newUser = await db.user.create({
      data: {
        email: email.trim().toLowerCase(),
        name: name.trim(),
        nameEn: nameEn?.trim() || null,
        phone: phone?.trim() || null,
        role: role || 'site_engineer',
        password: hashedPassword,
        permissions: permissions || null,
      },
      select: { id: true, email: true, name: true, nameEn: true, phone: true, role: true, active: true, language: true, permissions: true, createdAt: true },
    })

    return NextResponse.json({ user: newUser, success: true })
  } catch (error: any) {
    console.error('User register error:', error)
    return NextResponse.json({ error: 'server_error', message: 'فشل إنشاء المستخدم' }, { status: 500 })
  }
}
