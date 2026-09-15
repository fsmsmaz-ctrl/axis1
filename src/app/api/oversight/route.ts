// ============================================================
// الرقابة العملية — API تجميعي (v17)
// يجمع في نداء واحد:
//  1) التنبيهات الرقابية وإشعارات عمليات البيانات (إضافة/تعديل/حذف)
//  2) تنبيهات متابعة المهام
//  3) التحذيرات الحرجة
//  4) بيانات متابعة المهام الحية (متأخرة / خلال 24 ساعة / بانتظار
//     جهة أخرى / بانتظار المراجعة / معادة)
//  5) عدادات لوحة المؤشرات
// سجل عمليات البيانات نفسه (AuditLog) يُجلب من /api/audit-logs
// الموجود مسبقاً — هذا القسم هو أول مستهلك له في الواجهة.
// البوابة: الإدارة العليا + مديرو المشاريع + مدير النظام فقط.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { safeDbOp } from '@/lib/api-helpers'
import { runScanThrottled } from '@/lib/report-watch'
import { runTaskScanThrottled } from '@/lib/task-watch'
import { OVERSIGHT_NOTIFICATION_TYPES, isOversightViewer } from '@/lib/oversight'
import { SYSTEM_ADMIN_EMAIL } from '@/lib/auth'

// الحالات المفتوحة = كل ما ليس مغلقاً أو ملغى
const OPEN_STATUS = { status: { notIn: ['closed', 'cancelled'] } }

const TASK_SELECT = {
  id: true,
  taskNumber: true,
  title: true,
  priority: true,
  status: true,
  dueDate: true,
  waitingReason: true,
  reviewRequestedAt: true,
  createdAt: true,
  assignee: { select: { id: true, name: true, nameEn: true } },
}

export async function GET(req: NextRequest) {
  var user = await getAuthUser(req)
  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }
  // نسخة ثابتة من المعرف لاستخدامها داخل الدوال المغلقة (closures)
  const uid: string = user.id
  if (!isOversightViewer(user)) {
    return NextResponse.json(
      { error: 'forbidden', message: 'قسم الرقابة العملية متاح للإدارة فقط' },
      { status: 403 }
    )
  }

  var isTop =
    user.role === 'top_management' ||
    user.isSystemAdmin === true ||
    (user.email || '').toLowerCase().trim() === SYSTEM_ADMIN_EMAIL

  // الفحصان الدوريان (مراقب التقارير + مراقب المهام) — مرة كل 10 دقائق كحد أقصى.
  // فتح قسم الرقابة يضمن صدور التحذيرات الرقابية قبل عرضها.
  try {
    await runScanThrottled(false)
    await runTaskScanThrottled(false)
  } catch (e) {
    // الفحص غير حرج — نكمل بجلب ما هو موجود
  }

  var now = new Date()
  var startToday = new Date(now)
  startToday.setHours(0, 0, 0, 0)
  var in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  var weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

  // قاعدة الظهور نفسها في قسم التنبيهات: تنبيهاتي + التنبيهات العامة
  var visible = { OR: [{ userId: user.id }, { userId: null }] }

  // نطاق عدادات سجل العمليات: الإدارة العليا الكل — مدير المشروع مشاريعه فقط
  var logScope = isTop
    ? {}
    : { project: { OR: [{ managerId: user.id }, { engineerId: user.id }] } }

  var results = await Promise.all([
    // 0) التنبيهات الرقابية: الأنواع المنقولة + أي تنبيه حرج
    safeDbOp(
      () => db.notification.findMany({
        where: {
          AND: [
            visible,
            {
              OR: [
                { type: { in: OVERSIGHT_NOTIFICATION_TYPES.slice() } },
                { severity: 'critical' },
              ],
            },
          ],
        },
        include: { project: { select: { name: true, code: true } } },
        orderBy: { createdAt: 'desc' },
        take: 150,
      }),
      'جلب التنبيهات الرقابية'
    ),
    // 1) تنبيهات متابعة المهام (كل أنواع task_ الموجهة للمستخدم)
    safeDbOp(
      () => db.notification.findMany({
        where: { userId: uid, type: { startsWith: 'task_' } },
        orderBy: { createdAt: 'desc' },
        take: 80,
      }),
      'جلب تنبيهات المهام'
    ),
    // 2) التحذيرات الحرجة (مرئية للمستخدم)
    safeDbOp(
      () => db.notification.findMany({
        where: {
          AND: [visible, { severity: 'critical' }],
        },
        include: { project: { select: { name: true, code: true } } },
        orderBy: { createdAt: 'desc' },
        take: 60,
      }),
      'جلب التحذيرات الحرجة'
    ),
    // عدادات غير المقروء
    safeDbOp(
      () => db.notification.count({
        where: { AND: [visible, { read: false, type: { in: OVERSIGHT_NOTIFICATION_TYPES.slice() } }] },
      }),
      'عد التحذيرات الرقابية غير المقروءة'
    ),
    safeDbOp(
      () => db.notification.count({
        where: { AND: [visible, { read: false, severity: 'critical' }] },
      }),
      'عد التحذيرات الحرجة غير المقروءة'
    ),
    // عمليات البيانات — اليوم وآخر 7 أيام
    safeDbOp(() => db.auditLog.count({ where: { createdAt: { gte: startToday }, ...logScope } }), 'عد عمليات اليوم'),
    safeDbOp(() => db.auditLog.count({ where: { createdAt: { gte: weekAgo }, ...logScope } }), 'عد عمليات الأسبوع'),
    // متابعة المهام الحية
    safeDbOp(
      () => db.task.findMany({
        where: { dueDate: { lt: now }, ...OPEN_STATUS },
        select: TASK_SELECT,
        orderBy: { dueDate: 'asc' },
        take: 15,
      }),
      'المهام المتأخرة'
    ),
    safeDbOp(() => db.task.count({ where: { dueDate: { lt: now }, ...OPEN_STATUS } }), 'عد المهام المتأخرة'),
    safeDbOp(
      () => db.task.findMany({
        where: { dueDate: { gte: now, lt: in24h }, ...OPEN_STATUS },
        select: TASK_SELECT,
        orderBy: { dueDate: 'asc' },
        take: 10,
      }),
      'مهام تستحق خلال 24 ساعة'
    ),
    safeDbOp(
      () => db.task.count({ where: { dueDate: { gte: now, lt: in24h }, ...OPEN_STATUS } }),
      'عد مهام 24 ساعة'
    ),
    safeDbOp(
      () => db.task.findMany({
        where: { status: 'waiting' },
        select: TASK_SELECT,
        orderBy: { waitingSince: 'asc' },
        take: 10,
      }),
      'مهام بانتظار جهة أخرى'
    ),
    safeDbOp(() => db.task.count({ where: { status: 'waiting' } }), 'عد مهام الانتظار'),
    safeDbOp(
      () => db.task.findMany({
        where: { status: 'ready_review' },
        select: TASK_SELECT,
        orderBy: { reviewRequestedAt: 'asc' },
        take: 10,
      }),
      'مهام بانتظار المراجعة'
    ),
    safeDbOp(() => db.task.count({ where: { status: 'ready_review' } }), 'عد مهام المراجعة'),
    safeDbOp(
      () => db.task.findMany({
        where: { status: 'returned' },
        select: TASK_SELECT,
        orderBy: { updatedAt: 'desc' },
        take: 10,
      }),
      'المهام المعادة'
    ),
    safeDbOp(() => db.task.count({ where: { status: 'returned' } }), 'عد المهام المعادة'),
    // قائمة المشاريع لفلتر سجل العمليات (مدير المشروع: مشاريعه فقط)
    safeDbOp(
      () => db.project.findMany({
        where: isTop ? {} : { OR: [{ managerId: uid }, { engineerId: uid }] },
        select: { id: true, name: true, code: true },
        orderBy: { name: 'asc' },
      }),
      'جلب مشاريع الرقابة'
    ),
  ])

  // الاستعلام الأول حرج — إذا فشل أعد الخطأ، والبقية تعطي قيماً افتراضية آمنة
  if (!results[0].success) return results[0].response

  function g(i: number, fallback: any) {
    return results[i].success ? results[i].data : fallback
  }

  return NextResponse.json(
    {
      stats: {
        opsToday: g(5, 0),
        ops7d: g(6, 0),
        supervisoryUnread: g(3, 0),
        criticalUnread: g(4, 0),
        lateTasks: g(9, 0),
        dueSoonTasks: g(11, 0),
        waitingTasks: g(13, 0),
        readyReviewTasks: g(15, 0),
        returnedTasks: g(17, 0),
      },
      notifications: results[0].data,
      taskNotifications: g(1, []),
      critical: g(2, []),
      tasks: {
        late: g(7, []),
        dueSoon: g(10, []),
        waiting: g(12, []),
        readyReview: g(14, []),
        returned: g(16, []),
      },
      projects: g(18, []),
      viewer: { isTopManagement: isTop },
    },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}

