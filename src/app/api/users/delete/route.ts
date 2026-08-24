import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'

var ADMIN_EMAIL = 'admin@axis.om'

export async function DELETE(req: NextRequest) {
  var rl = checkRateLimit(req, RateLimitPresets.auth)
  if (rl.limited) {
    return NextResponse.json(
      { error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    )
  }

  try {
    var authUser = await getAuthUser(req)
    if (!authUser || authUser.email.toLowerCase().trim() !== ADMIN_EMAIL) {
      return NextResponse.json({ error: 'forbidden', message: 'هذه العملية متاحة فقط لمدير النظام' }, { status: 403 })
    }

    var searchParams = new URL(req.url).searchParams
    var userId = searchParams.get('id')

    if (!userId) {
      return NextResponse.json({ error: 'missing_fields', message: 'معرف المستخدم مطلوب' }, { status: 400 })
    }

    var targetUser = await db.user.findUnique({ where: { id: userId } })
    if (!targetUser) {
      return NextResponse.json({ error: 'not_found', message: 'المستخدم غير موجود' }, { status: 404 })
    }

    if (targetUser.email.toLowerCase().trim() === ADMIN_EMAIL) {
      return NextResponse.json({ error: 'forbidden', message: 'لا يمكن حذف حساب مدير النظام' }, { status: 403 })
    }

    // FIX: Soft delete instead of hard delete — prevents orphaned records and DB constraint errors
    await db.user.update({
      where: { id: userId },
      data: { active: false, email: 'deleted_' + userId, role: 'deleted' },
    })

    var remaining = await db.user.count({ where: { active: true } })

    return NextResponse.json({
      message: 'تم حذف المستخدم بنجاح',
      remainingSlots: 50 - remaining
    })
  } catch (error) {
    console.error('Delete user error:', error)
    return handleDbError(error, 'حذف المستخدم')
  }
}
