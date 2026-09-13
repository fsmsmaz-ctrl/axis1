import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError } from '@/lib/api-helpers'

export async function GET(req: NextRequest) {
  const me = await getAuthUser(req)
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (me.role !== 'top_management') return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  try {
    const users = await db.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        nameEn: true,
        phone: true,
        role: true,
        active: true,
        language: true,
        permissions: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    })

    const usersWithPerms = users.map(u => ({
      ...u,
      permissions: u.permissions ?? {},
    }))

    return NextResponse.json({ users: usersWithPerms })
  } catch (error) {
    return handleDbError(error, 'جلب المستخدمين')
  }
}
