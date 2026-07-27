import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, safeDbOp } from '@/lib/api-helpers'

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const entity = searchParams.get('entity')
  const action = searchParams.get('action')
  const projectId = searchParams.get('projectId')
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const page = parseInt(searchParams.get('page') || '1')
  const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200)

  const where: any = {}
  if (entity && entity !== 'all') where.entity = entity
  if (action && action !== 'all') where.action = action
  if (projectId) where.projectId = projectId
  if (from || to) {
    where.createdAt = {}
    if (from) where.createdAt.gte = new Date(from)
    if (to) where.createdAt.lte = new Date(to + 'T23:59:59.999Z')
  }

  const [result, countResult] = await Promise.all([
    safeDbOp(
      () => db.auditLog.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, email: true, role: true } },
          project: { select: { id: true, name: true, code: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      'جلب سجلات المراقبة'
    ),
    safeDbOp(
      () => db.auditLog.count({ where }),
      'عد سجلات المراقبة'
    ),
  ])

  if (!result.success) return result.response

  const statsResult = await safeDbOp(
    () => db.auditLog.groupBy({
      by: ['entity'],
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
    }),
    'إحصائيات المراقبة'
  )

  const actionStats = await safeDbOp(
    () => db.auditLog.groupBy({
      by: ['action'],
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
    }),
    'إحصائيات الإجراءات'
  )

  return NextResponse.json({
    logs: result.data,
    total: countResult.success ? countResult.data : 0,
    page,
    limit,
    entityStats: statsResult.success ? statsResult.data : [],
    actionStats: actionStats.success ? actionStats.data : [],
  })
}
