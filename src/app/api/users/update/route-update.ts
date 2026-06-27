import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import bcrypt from 'bcryptjs'

const ADMIN_EMAIL = 'admin@axis.om'
const VALID_ROLES = [
  'top_management', 'project_manager', 'site_engineer',
  'hse_officer', 'foreman', 'accountant',
]

export async function PATCH(req: NextRequest) {
  try {
    const authUser = await getAuthUser(req)
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (authUser.email.toLowerCase().trim() !== ADMIN_EMAIL) {
      return NextResponse.json(
        { error: 'Access denied. Only admin can update users.' },
        { status: 403 }
      )
    }

    const body = await req.json()
    const { userId, name, nameEn, role, phone, password } = body

    if (!userId) {
      return NextResponse.json({ error: 'User ID is required.' }, { status: 400 })
    }

    const targetUser = await db.user.findUnique({ where: { id: userId } })
    if (!targetUser) {
      return NextResponse.json({ error: 'User not found.' }, { status: 404 })
    }
    if (targetUser.email.toLowerCase().trim() === ADMIN_EMAIL) {
      return NextResponse.json(
        { error: 'Cannot modify the admin account.' },
        { status: 400 }
      )
    }

    const updateData: any = {}
    if (name !== undefined) updateData.name = name.trim()
    if (nameEn !== undefined) updateData.nameEn = (nameEn || name).trim()
    if (role !== undefined) {
      if (!VALID_ROLES.includes(role)) {
        return NextResponse.json({ error: 'Invalid role.' }, { status: 400 })
      }
      updateData.role = role
    }
    if (phone !== undefined) updateData.phone = phone.trim() || null
    if (password !== undefined && password.length >= 6) {
      updateData.password = await bcrypt.hash(password, 10)
    } else if (password !== undefined && password.length > 0 && password.length < 6) {
      return NextResponse.json(
        { error: 'Password must be at least 6 characters.' },
        { status: 400 }
      )
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No changes provided.' }, { status: 400 })
    }

    const updated = await db.user.update({
      where: { id: userId },
      data: updateData,
      select: { id: true, email: true, name: true, nameEn: true, role: true, phone: true, active: true },
    })

    const roleLabels: Record<string, { ar: string; en: string }> = {
      top_management: { ar: 'الإدارة العليا', en: 'Top Management' },
      project_manager: { ar: 'مدير المشروع', en: 'Project Manager' },
      site_engineer: { ar: 'مهندس الموقع', en: 'Site Engineer' },
      hse_officer: { ar: 'مسؤول السلامة', en: 'HSE Officer' },
      foreman: { ar: 'المشرف', en: 'Foreman' },
      accountant: { ar: 'المحاسب', en: 'Accountant' },
    }

    return NextResponse.json({
      message: 'User updated successfully.',
      user: { ...updated, roleLabel: roleLabels[updated.role] || { ar: updated.role, en: updated.role } },
    })
  } catch (error) {
    console.error('Update user error:', error)
    return NextResponse.json({ error: 'Failed to update user.' }, { status: 500 })
  }
}