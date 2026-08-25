import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, safeDbOp } from '@/lib/api-helpers'

// FIX-6.5: Removed duplicate POST handler (frontend uses /api/users/create instead)
// This file now only handles GET (list all users for admin panel)

export async function GET(req: NextRequest) {
  var me = await getAuthUser(req)
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (me.role !== 'top_management') return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  try {
    var usersResult = await safeDbOp(
      () => db.user.findMany({
        select: { id: true, email: true, name: true, nameEn: true, phone: true, role: true, active: true, language: true, permissions: true, createdAt: true, updatedAt: true },
        orderBy: { createdAt: 'desc' },
      }),
      'جلب المستخدمين'
    )
    if (!usersResult.success) return usersResult.response
    return NextResponse.json({ users: usersResult.data.map(function(u) { return { ...u, permissions: u.permissions ?? {} } }) })
  } catch (error) {
    return handleDbError(error, 'جلب المستخدمين')
  }
}
