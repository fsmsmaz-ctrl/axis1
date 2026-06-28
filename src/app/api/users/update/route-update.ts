import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import bcrypt from 'bcryptjs'

const ADMIN_EMAIL = 'admin@axis.om'
const VALID_ROLES = ['top_management', 'project_manager', 'site_engineer', 'hse_officer', 'foreman', 'accountant']

export async function PATCH(req: NextRequest) {
  try {
    const authUser = await getAuthUser(req)
    if (!authUser || authUser.email.toLowerCase().trim() !== ADMIN_EMAIL) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 403 })
    }

    const body = await req.json()
    const { userId, name, nameEn, role, phone, password } = body

    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 })
    }

    const targetUser = await db.user.findUnique({ where: { id: userId } })
    if (!targetUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    if (targetUser.email.toLowerCase().trim() === ADMIN_EMAIL) {
      return NextResponse.json({ error: 'Cannot modify admin account' }, { status: 403 })
    }

    const updateData: Record<string, string> = {}

    if (name !== undefined && name.trim()) updateData.name = name.trim()
    if (nameEn !== undefined && nameEn.trim()) updateData.nameEn = nameEn.trim()
    if (phone !== undefined) updateData.phone = phone.trim()
    if (role !== undefined) {
      if (!VALID_ROLES.includes(role)) {
        return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
      }
      updateData.role = role
    }

    if (password && password.trim()) {
      updateData.password = await bcrypt.hash(password.trim(), 12)
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    const updated = await db.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        email: true,
        name: true,
        nameEn: true,
        role: true,
        phone: true,
        active: true,
        createdAt: true,
      }
    })

    return NextResponse.json({
      message: 'User updated successfully.',
      user: updated
    })
  } catch (error) {
    console.error('Update user error:', error)
    return NextResponse.json({ error: 'internal_error', message: 'Failed to update user' }, { status: 500 })
  }
}
