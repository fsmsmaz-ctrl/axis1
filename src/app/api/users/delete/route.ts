import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'

const ADMIN_EMAIL = 'admin@axis.om'

export async function DELETE(req: NextRequest) {
  try {
    const authUser = await getAuthUser(req)
    if (!authUser || authUser.email.toLowerCase().trim() !== ADMIN_EMAIL) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const userId = searchParams.get('id')

    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 })
    }

    // Prevent deleting the admin account
    const targetUser = await db.user.findUnique({ where: { id: userId } })
    if (!targetUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    if (targetUser.email.toLowerCase().trim() === ADMIN_EMAIL) {
      return NextResponse.json({ error: 'Cannot delete admin account' }, { status: 403 })
    }

    await db.user.delete({ where: { id: userId } })

    const remaining = await db.user.count({
      where: { email: { not: ADMIN_EMAIL } }
    })

    return NextResponse.json({
      message: 'User deleted successfully.',
      remainingSlots: 50 - remaining
    })
  } catch (error) {
    console.error('Delete user error:', error)
    return NextResponse.json({ error: 'internal_error', message: 'Failed to delete user' }, { status: 500 })
  }
}
