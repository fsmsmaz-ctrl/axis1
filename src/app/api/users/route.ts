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
        avatar: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    })

    // v49: آخر تغيير يخص كل مستخدم (صورة/كلمة مرور/تعديل إداري) من سجل العمليات
    // — يظهر في «إدارة المستخدمين» تحت بيانات كل مستخدم
    let v49ProfileLogs: any[] = []
    try {
      v49ProfileLogs = await db.auditLog.findMany({
        where: { entity: 'user' },
        orderBy: { createdAt: 'desc' },
        take: 400,
        select: {
          entityId: true, action: true, details: true, createdAt: true,
          user: { select: { name: true, nameEn: true } },
        },
      })
    } catch (logErr) {
      console.warn('v49 last profile change fetch skipped:', logErr)
    }
    const v49LastByUser: Record<string, any> = {}
    for (const lg of v49ProfileLogs) {
      if (lg.entityId && !v49LastByUser[lg.entityId]) {
        let v49Summary = lg.details || ''
        try {
          const v49Parsed = JSON.parse(lg.details)
          if (v49Parsed && typeof v49Parsed === 'object' && v49Parsed.summary) v49Summary = String(v49Parsed.summary)
        } catch { }
        v49LastByUser[lg.entityId] = {
          summary: v49Summary,
          action: lg.action,
          at: lg.createdAt,
          by: lg.user ? (lg.user.nameEn || lg.user.name) : null,
        }
      }
    }

    const usersWithPerms = users.map(u => ({
      ...u,
      permissions: u.permissions ?? {},
      // v49: آخر تغيير يخص المستخدم — يظهر في إدارة المستخدمين
      lastProfileChange: v49LastByUser[u.id] || null,
    }))

    return NextResponse.json({ users: usersWithPerms })
  } catch (error) {
    return handleDbError(error, 'جلب المستخدمين')
  }
}
