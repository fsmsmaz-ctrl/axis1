import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'

var ADMIN_EMAIL = 'admin@axis.om'

export async function DELETE(req: NextRequest) {
  // Rate limit user deletion
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
      return NextResponse.json({ error: 'unauthorized' }, { status: 403 })
    }

    var searchParams = new URL(req.url).searchParams
    var userId = searchParams.get('id')

    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 })
    }

    var targetUser = await db.user.findUnique({ where: { id: userId } })
    if (!targetUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    if (targetUser.email.toLowerCase().trim() === ADMIN_EMAIL) {
      return NextResponse.json({ error: 'Cannot delete admin account' }, { status: 403 })
    }

    await db.user.delete({ where: { id: userId } })

    var remaining = await db.user.count()

    return NextResponse.json({
      message: 'User deleted successfully.',
      remainingSlots: 50 - remaining
    })
  } catch (error) {
    console.error('Delete user error:', error)
    return handleDbError(error, 'حذف المستخدم')
  }
}
