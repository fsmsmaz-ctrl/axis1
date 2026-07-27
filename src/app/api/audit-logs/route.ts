import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { safeDbOp, handleDbError } from '@/lib/api-helpers'

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const entity = searchParams.get('entity')
  const action = searchParams.get('action')
  const projectId = searchParams.get('projectId')
  const userId = searchParams.get('userId')
  const dateFrom = searchParams.get('dateFrom')
  const dateTo = searchParams.get('dateTo')
  const page = parseInt(searchParams.get('page') || '1')
  const limit = parseInt(searchParams.get('limit') || '50')

  const where: any = {}
  if (entity) where.entity = entity
  if (action) where.action = action
  if (projectId) where.projectId = projectId
  if (userId) where.userId = userId
  if (dateFrom || dateTo) {
    where.createdAt = {}
    if (dateFrom) where.createdAt.gte = new Date(dateFrom)
    if (dateTo) {
      const d = new Date(dateTo)
      d.setHours(23, 59, 59, 999)
      where.createdAt.lte = d
    }
  }

  const skip = (page - 1) * limit

  const [logsResult, countResult, usersResult] = await Promise.all([
    safeDbOp(
      () => db.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          user: { select: { id: true, name: true, nameEn: true, email: true } },
          project: { select: { id: true, name: true, code: true } },
        },
      }),
      'جلب سجلات المراقبة'
    ),
    safeDbOp(() => db.auditLog.count({ where }), 'عد سجلات المراقبة'),
    safeDbOp(
      () => db.user.findMany({ select: { id: true, name: true, nameEn: true, email: true }, orderBy: { name: 'asc' } }),
      'جلب قائمة المستخدمين'
    ),
  ])

  if (!logsResult.success) return logsResult.response

  const logs = logsResult.data
  const total = countResult.success ? countResult.data : 0
  const users = usersResult.success ? usersResult.data : []

  // Entity stats
  const entityStats = [
    { entity: 'project', ar: 'المشاريع', en: 'Projects', count: logs.filter((l: any) => l.entity === 'project').length },
    { entity: 'daily_report', ar: 'التقارير اليومية', en: 'Daily Reports', count: logs.filter((l: any) => l.entity === 'daily_report').length },
    { entity: 'safety_report', ar: 'تقارير السلامة', en: 'Safety Reports', count: logs.filter((l: any) => l.entity === 'safety_report').length },
    { entity: 'cost', ar: 'التكاليف', en: 'Costs', count: logs.filter((l: any) => l.entity === 'cost').length },
    { entity: 'equipment', ar: 'المعدات', en: 'Equipment', count: logs.filter((l: any) => l.entity === 'equipment').length },
    { entity: 'drive_line', ar: 'خطوط الحفر', en: 'Drive Lines', count: logs.filter((l: any) => l.entity === 'drive_line').length },
    { entity: 'finishing', ar: 'التشطيبات', en: 'Finishings', count: logs.filter((l: any) => l.entity === 'finishing').length },
  ]

  const actionStats = [
    { action: 'create', ar: 'إنشاء', en: 'Create', count: logs.filter((l: any) => l.action === 'create').length },
    { action: 'update', ar: 'تعديل', en: 'Update', count: logs.filter((l: any) => l.action === 'update').length },
    { action: 'delete', ar: 'حذف', en: 'Delete', count: logs.filter((l: any) => l.action === 'delete').length },
    { action: 'approve', ar: 'اعتماد', en: 'Approve', count: logs.filter((l: any) => l.action === 'approve').length },
    { action: 'reject', ar: 'رفض', en: 'Reject', count: logs.filter((l: any) => l.action === 'reject').length },
  ]

  return NextResponse.json({
    logs,
    total,
    page,
    totalPages: Math.ceil(total / limit),
    entityStats,
    actionStats,
    users,
  })
}
