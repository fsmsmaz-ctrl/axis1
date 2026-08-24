import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import bcrypt from 'bcryptjs'
import { handleDbError, safeDbOp } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { VALID_ROLES } from '@/lib/auth'

// FIX-3.2: Removed hardcoded ADMIN_EMAIL — now uses role-based check

var ALL_PERMISSIONS = [
  'projects', 'drive_lines', 'daily_reports', 'safety', 'equipment', 'costs', 'finishings', 'performance', 'notifications',
  'rpt_daily_site', 'rpt_production', 'rpt_safety', 'rpt_attendance',
  'rpt_revenue', 'rpt_costs', 'rpt_profit', 'rpt_equipment',
  'rpt_weekly', 'rpt_monthly', 'rpt_handover',
]

export async function PATCH(req: NextRequest) {
  var rl = checkRateLimit(req, RateLimitPresets.write)
  if (rl.limited) {
    return NextResponse.json(
      { error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    )
  }

  try {
    var authUser = await getAuthUser(req)
    // FIX-3.2: Use role check instead of hardcoded email
    if (!authUser || authUser.role !== 'top_management') {
      return NextResponse.json({ error: 'forbidden', message: 'هذه العملية متاحة فقط للإدارة العليا' }, { status: 403 })
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
      return NextResponse.json({ error: 'missing_fields', message: 'معرف المستخدم مطلوب' }, { status: 400 })
    }

    var targetResult = await safeDbOp(
      () => db.user.findUnique({ where: { id: userId }, select: { id: true, email: true, role: true } }),
      'البحث عن المستخدم'
    )
    if (!targetResult.success) return targetResult.response
    if (!targetResult.data) {
      return NextResponse.json({ error: 'not_found', message: 'المستخدم غير موجود' }, { status: 404 })
    }

    // FIX-3.2: Protect top_management accounts from modification by role, not email
    if (targetResult.data.role === 'top_management' && targetResult.data.id !== authUser.id) {
      return NextResponse.json({ error: 'forbidden', message: 'لا يمكن تعديل حسابات الإدارة العليا' }, { status: 403 })
    }

    var updateData: Record<string, any> = {}

    if (name !== undefined && name.trim()) updateData.name = name.trim()
    if (nameEn !== undefined && nameEn.trim()) updateData.nameEn = nameEn.trim()
    if (phone !== undefined) updateData.phone = phone.trim() || null
    if (role !== undefined) {
      if (!(VALID_ROLES as readonly string[]).includes(role)) {
        return NextResponse.json({ error: 'invalid_value', message: 'دور غير صالح. الأدوار المسموحة: ' + (VALID_ROLES as readonly string[]).join(', ') }, { status: 400 })
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
      if (password.trim().length < 6) {
        return NextResponse.json({ error: 'invalid_value', message: 'كلمة المرور قصيرة جداً (6 أحرف على الأقل)' }, { status: 400 })
      }
      updateData.password = await bcrypt.hash(password.trim(), 12)
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'missing_fields', message: 'لم يتم تحديد أي حقل للتحديث' }, { status: 400 })
    }

    var updateResult = await safeDbOp(
      () => db.user.update({
        where: { id: userId },
        data: updateData,
        select: {
          id: true, email: true, name: true, nameEn: true,
          role: true, phone: true, active: true, permissions: true, createdAt: true,
        }
      }),
      'تحديث المستخدم'
    )
    if (!updateResult.success) return updateResult.response

    return NextResponse.json({
      message: 'تم تحديث المستخدم بنجاح',
      user: { ...updateResult.data, permissions: updateResult.data.permissions ?? {} }
    })
  } catch (error) {
    console.error('Update user error:', error)
    return handleDbError(error, 'تحديث المستخدم')
  }
}
