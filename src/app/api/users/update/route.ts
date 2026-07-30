import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import bcrypt from 'bcryptjs'
import { handleDbError } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'

var ADMIN_EMAIL = 'admin@axis.om'
var VALID_ROLES = ['top_management', 'project_manager', 'site_engineer', 'hse_officer', 'foreman', 'accountant']

var ALL_PERMISSIONS = [
  'drive_lines', 'daily_reports', 'safety', 'equipment', 'costs', 'finishings', 'performance', 'notifications',
  'rpt_daily_site', 'rpt_production', 'rpt_safety', 'rpt_attendance',
  'rpt_revenue', 'rpt_costs', 'rpt_profit', 'rpt_equipment',
  'rpt_weekly', 'rpt_monthly', 'rpt_handover',
]

export async function PATCH(req: NextRequest) {
  // Rate limit user updates
  var rl = checkRateLimit(req, RateLimitPresets.write)
  if (rl.limited) {
    return NextResponse.json(
      { error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    )
  }

  try {
    var authUser = await getAuthUser(req)
    if (!authUser || authUser.email.toLowerCase().trim() !== ADMIN_EMAIL) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 403 })
    }

    var body = await req.json()
    var userId = body.userId
    var name = body.name
    var nameEn = body.nameEn
    var role = body.role
    var phone = body.phone
    var password = body.password
    var permissions = body.permissions

    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 })
    }

    var targetUser = await db.user.findUnique({ where: { id: userId } })
    if (!targetUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    if (targetUser.email.toLowerCase().trim() === ADMIN_EMAIL) {
      return NextResponse.json({ error: 'Cannot modify admin account' }, { status: 403 })
    }

    var updateData: Record<string, any> = {}

    if (name !== undefined && name.trim()) updateData.name = name.trim()
    if (nameEn !== undefined && nameEn.trim()) updateData.nameEn = nameEn.trim()
    if (phone !== undefined) updateData.phone = phone.trim() || null
    if (role !== undefined) {
      if (!VALID_ROLES.includes(role)) {
        return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
      }
      updateData.role = role
    }

    if (permissions !== undefined) {
      var cleanPerms: Record<string, boolean> = {}
      if (permissions && typeof permissions === 'object') {
        for (var i = 0; i < ALL_PERMISSIONS.length; i++) {
          var key = ALL_PERMISSIONS[i]
          if (typeof permissions[key] === 'boolean') {
            cleanPerms[key] = permissions[key]
          }
        }
      }
      updateData.permissions = Object.keys(cleanPerms).length > 0 ? cleanPerms : null
    }

    if (password && password.trim()) {
      updateData.password = await bcrypt.hash(password.trim(), 12)
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    var updated = await db.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true, email: true, name: true, nameEn: true,
        role: true, phone: true, active: true, permissions: true, createdAt: true,
      }
    })

    return NextResponse.json({
      message: 'User updated successfully.',
      user: { ...updated, permissions: updated.permissions ?? {} }
    })
  } catch (error) {
    console.error('Update user error:', error)
    return handleDbError(error, 'تحديث المستخدم')
  }
}
