import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { safeDbOp, handleDbError } from '@/lib/api-helpers'

export async function GET(req: NextRequest) {
  var user = await getAuthUser(req)
  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  // FIX: Restrict audit logs to top_management and project_manager
  if (user.role !== 'top_management' && user.role !== 'project_manager') {
    return NextResponse.json({ error: 'forbidden', message: 'سجل المراقبة متاح فقط للإدارة' }, { status: 403 })
  }

  var searchParams = new URL(req.url).searchParams
  var entity = searchParams.get('entity')
  var action = searchParams.get('action')
  var projectId = searchParams.get('projectId')
  var userId = searchParams.get('userId')
  var dateFrom = searchParams.get('dateFrom')
  var dateTo = searchParams.get('dateTo')
  var page = parseInt(searchParams.get('page') || '1')
  var limit = parseInt(searchParams.get('limit') || '50')

  if (limit > 200) limit = 200

  var where: any = {}
  if (entity) where.entity = entity
  if (action) where.action = action
  if (projectId) where.projectId = projectId
  if (userId) where.userId = userId

  // FIX: Non-top_management can only see their own project's logs
  if (user.role !== 'top_management' && !projectId) {
    // PM without projectId filter — return empty to avoid leaking other projects
    return NextResponse.json({ logs: [], total: 0, page, totalPages: 0, entityStats: [], actionStats: [], users: [] })
  }

  if (dateFrom || dateTo) {
    where.createdAt = {}
    if (dateFrom) where.createdAt.gte = new Date(dateFrom)
    if (dateTo) {
      var d = new Date(dateTo)
      d.setHours(23, 59, 59, 999)
      where.createdAt.lte = d
    }
  }

  var skip = (page - 1) * limit

  var results = await Promise.all([
    safeDbOp(
      () => db.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { user: { select: { id: true, name: true, nameEn: true, email: true } }, project: { select: { id: true, name: true, code: true } } },
      }),
      'جلب سجلات المراقبة'
    ),
    safeDbOp(function() { return db.auditLog.count({ where }) }, 'عد سجلات المراقبة'),
    safeDbOp(
      () => db.user.findMany({ where: { active: true }, select: { id: true, name: true, nameEn: true, email: true }, orderBy: { name: 'asc' } }),
      'جلب قائمة المستخدمين'
    ),
  ])

  if (!results[0].success) return results[0].response

  var logs = results[0].data
  var total = results[1].success ? results[1].data : 0
  var users = results[2].success ? results[2].data : []

  var entityStats = [
    { entity: 'project', ar: 'المشاريع', en: 'Projects', count: logs.filter(function(l: any) { return l.entity === 'project' }).length },
    { entity: 'daily_report', ar: 'التقارير اليومية', en: 'Daily Reports', count: logs.filter(function(l: any) { return l.entity === 'daily_report' }).length },
    { entity: 'safety_report', ar: 'تقارير السلامة', en: 'Safety Reports', count: logs.filter(function(l: any) { return l.entity === 'safety_report' }).length },
    { entity: 'cost', ar: 'التكاليف', en: 'Costs', count: logs.filter(function(l: any) { return l.entity === 'cost' }).length },
    { entity: 'equipment', ar: 'المعدات', en: 'Equipment', count: logs.filter(function(l: any) { return l.entity === 'equipment' }).length },
    { entity: 'drive_line', ar: 'خطوط الحفر', en: 'Drive Lines', count: logs.filter(function(l: any) { return l.entity === 'drive_line' }).length },
    { entity: 'finishing', ar: 'التشطيبات', en: 'Finishings', count: logs.filter(function(l: any) { return l.entity === 'finishing' }).length },
  ]

  var actionStats = [
    { action: 'create', ar: 'إنشاء', en: 'Create', count: logs.filter(function(l: any) { return l.action === 'create' }).length },
    { action: 'update', ar: 'تعديل', en: 'Update', count: logs.filter(function(l: any) { return l.action === 'update' }).length },
    { action: 'delete', ar: 'حذف', en: 'Delete', count: logs.filter(function(l: any) { return l.action === 'delete' }).length },
    { action: 'approve', ar: 'اعتماد', en: 'Approve', count: logs.filter(function(l: any) { return l.action === 'approve' }).length },
  ]

  return NextResponse.json({
    logs, total, page,
    totalPages: Math.ceil(total / limit),
    entityStats, actionStats, users,
  })
}
