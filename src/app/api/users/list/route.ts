import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, safeDbOp } from '@/lib/api-helpers'

// Lightweight user list for dropdowns — available to all authenticated users
// Returns only id, name, nameEn — no sensitive data
export async function GET(req: NextRequest) {
  var user = await getAuthUser(req)
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    // FIX-5.3: Wrapped in safeDbOp for consistent error handling
    var usersResult = await safeDbOp(
      () => db.user.findMany({
        where: { active: true },
        select: { id: true, name: true, nameEn: true },
        orderBy: { name: 'asc' },
      }),
      'جلب قائمة المستخدمين'
    )
    if (!usersResult.success) return usersResult.response
    return NextResponse.json({ users: usersResult.data })
  } catch (error) {
    return handleDbError(error, 'جلب قائمة المستخدمين')
  }
}
