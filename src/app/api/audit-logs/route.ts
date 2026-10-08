import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { safeDbOp, handleDbError } from '@/lib/api-helpers'
import { hasPermission, normalizeRole, SYSTEM_ADMIN_EMAIL } from '@/lib/auth'

export async function GET(req: NextRequest) {
  var user = await getAuthUser(req)
  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  // v67 REVIEW: البوابة نفسها لقسم «الرقابة العملية» في الواجهة (hasPermission) —
  // إغلاق الصلاحية من إدارة المستخدمين يغلق السجل فعلاً، والمنح المخصص يفتحه
  if (!hasPermission(user.role, 'oversight', user.permissions, user.email)) {
    return NextResponse.json({ error: 'forbidden', message: 'سجل المراقبة متاح فقط للإدارة' }, { status: 403 })
  }

  var isTopManagement = normalizeRole(user.role) === 'top_management' || user.isSystemAdmin === true ||
    (user.email || '').toLowerCase().trim() === SYSTEM_ADMIN_EMAIL

  var searchParams = new URL(req.url).searchParams
  var entity = searchParams.get('entity')
  var action = searchParams.get('action')
  var projectId = searchParams.get('projectId')
  var userId = searchParams.get('userId')
  var dateFrom = searchParams.get('dateFrom')
  var dateTo = searchParams.get('dateTo')
  var page = Math.max(1, parseInt(searchParams.get('page') || '1') || 1)
  var limit = Math.min(Math.max(1, parseInt(searchParams.get('limit') || '50') || 50), 200)

  var where: any = {}
  if (entity) where.entity = entity
  if (action) where.action = action
  if (projectId) where.projectId = projectId
  if (userId) where.userId = userId

  // FIX: Non-top_management can only see their own project's logs
  // SECURITY FIX: كان الفحص شكلياً — يطلب projectId فقط دون التحقق أن المشروع
  // مُسند لهذا المدير فعلاً، فكان يستطيع قراءة سجلات أي مشروع بمعرفة معرفه
  if (!isTopManagement) {
    if (!projectId) {
      // PM without projectId filter — return empty to avoid leaking other projects
      return NextResponse.json({ logs: [], total: 0, page, totalPages: 0, entityStats: [], actionStats: [], users: [] })
    }
    var ownedProject = await safeDbOp(
      () => db.project.findUnique({ where: { id: String(projectId) }, select: { managerId: true, engineerId: true } }),
      'التحقق من ملكية المشروع'
    )
    var isProjectOwner = ownedProject.success && ownedProject.data &&
      (ownedProject.data.managerId === user.id || ownedProject.data.engineerId === user.id)
    if (!isProjectOwner) {
      return NextResponse.json({ logs: [], total: 0, page, totalPages: 0, entityStats: [], actionStats: [], users: [] })
    }
  }

  if (dateFrom || dateTo) {
    where.createdAt = {}
    // v70: حدود اليوم بتوقيت UTC — اتفاقية بقية النظام (كانت منتصف ليل خادم محلي)
    if (dateFrom) where.createdAt.gte = new Date(dateFrom + 'T00:00:00.000Z')
    if (dateTo) where.createdAt.lte = new Date(dateTo + 'T23:59:59.999Z')
  }

  var skip = (page - 1) * limit

  var results = await Promise.all([
    safeDbOp(
      () => db.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        // v80 SECURITY FIX: صفوف السجل نفسها كانت تكشف بريد المنفّذ لغير الإدارة العليا
        // رغم أن قائمة المستخدمين أسفلها تحجبه — نفس السياسة: email فقط للإدارة العليا
        include: { user: { select: { id: true, name: true, nameEn: true, email: isTopManagement } }, project: { select: { id: true, name: true, code: true } } },
      }),
      'جلب سجلات المراقبة'
    ),
    safeDbOp(function() { return db.auditLog.count({ where }) }, 'عد سجلات المراقبة'),
    safeDbOp(
      // SECURITY FIX: البريد الإلكتروني لأعضاء الفريق لا يُكشف لغير الإدارة العليا
      () => db.user.findMany({ where: { active: true }, select: { id: true, name: true, nameEn: true, email: isTopManagement }, orderBy: { name: 'asc' } }),
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
    // v49: المشتريات وسجلات الملفات الشخصية
    { entity: 'purchase', ar: 'المشتريات', en: 'Purchases', count: logs.filter(function(l: any) { return l.entity === 'purchase' }).length },
    { entity: 'user', ar: 'الملفات الشخصية', en: 'User Profiles', count: logs.filter(function(l: any) { return l.entity === 'user' }).length },
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

