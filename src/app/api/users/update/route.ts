import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import bcrypt from 'bcryptjs'

export async function PATCH(req: NextRequest) {
  const user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  if (user.email.toLowerCase().trim() !== 'admin@axis.om') {
    return NextResponse.json({ error: 'forbidden', message: 'فقط المدير يمكنه التعديل' }, { status: 403 })
  }

  try {
    const body = await req.json()
    const { userId, name, nameEn, role, phone, password, permissions } = body

    if (!userId) {
      return NextResponse.json({ error: 'missing_fields', message: 'معرف المستخدم مطلوب' }, { status: 400 })
    }

    const targetUser = await db.user.findUnique({ where: { id: userId } })
    if (!targetUser) {
      return NextResponse.json({ error: 'not_found', message: 'المستخدم غير موجود' }, { status: 404 })
    }

    const updateData: any = {}
    if (name !== undefined) updateData.name = name
    if (nameEn !== undefined) updateData.nameEn = nameEn || null
    if (role !== undefined) updateData.role = role
    if (phone !== undefined) updateData.phone = phone || null
    if (permissions !== undefined) updateData.permissions = permissions

    if (password && password.trim()) {
      updateData.password = await bcrypt.hash(password.trim(), 12)
    }

    const updated = await db.user.update({
      where: { id: userId },
      data: updateData,
      select: { id: true, email: true, name: true, nameEn: true, phone: true, role: true, active: true, language: true, permissions: true, createdAt: true },
    })

    return NextResponse.json({ user: updated, success: true })
  } catch (error: any) {
    console.error('User update error:', error)
    return NextResponse.json({ error: 'server_error', message: 'فشل تحديث المستخدم' }, { status: 500 })
  }
}
