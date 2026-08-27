import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, safeDbOp } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'

// FIX-3.2: Removed hardcoded ADMIN_EMAIL — now uses role-based check

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
    // FIX-3.2: Use role check instead of hardcoded email
    if (!authUser || authUser.role !== 'top_management') {
      return NextResponse.json({ error: 'forbidden', message: 'هذه العملية متاحة فقط للإدارة العليا' }, { status: 403 })
    }

    var searchParams = new URL(req.url).searchParams
    var userId = searchParams.get('id')

    if (!userId) {
      return NextResponse.json({ error: 'missing_fields', message: 'معرف المستخدم مطلوب' }, { status: 400 })
    }

    var targetResult = await safeDbOp(
      () => db.user.findUnique({ where: { id: userId as string }, select: { id: true, role: true } }),
      'البحث عن المستخدم'
    )
    if (!targetResult.success) return targetResult.response
    if (!targetResult.data) {
      return NextResponse.json({ error: 'not_found', message: 'المستخدم غير موجود' }, { status: 404 })
    }

    // FIX-3.2: Protect top_management accounts by role, not email
    if (targetResult.data.role === 'top_management') {
      return NextResponse.json({ error: 'forbidden', message: 'لا يمكن حذف حسابات الإدارة العليا' }, { status: 403 })
    }

    if (userId === authUser.id) {
      return NextResponse.json({ error: 'forbidden', message: 'لا يمكنك حذف حسابك الخاص' }, { status: 403 })
    }

    // Soft delete — prevents orphaned records and DB constraint errors
    var deleteResult = await safeDbOp(
      () => db.user.update({
        where: { id: userId as string },
        data: { active: false, email: 'deleted_' + userId, role: 'deleted' },
      }),
      'حذف المستخدم'
    )
    if (!deleteResult.success) return deleteResult.response

    var remainingResult = await safeDbOp(
      () => db.user.count({ where: { active: true } }),
      'عد المستخدمين المتبقين'
    )
    var remaining = remainingResult.success ? remainingResult.data : 0

    return NextResponse.json({
      message: 'تم حذف المستخدم بنجاح',
      remainingSlots: 50 - remaining
    })
  } catch (error) {
    console.error('Delete user error:', error)
    return handleDbError(error, 'حذف المستخدم')
  }
}
