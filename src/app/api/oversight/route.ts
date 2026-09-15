// ============================================================
// الرقابة العملية — API تجميعي (v17، محدَّث v21)
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
// v21 — إصلاح جذري لعطل «تعذر الاتصال بالخادم» في قسم الرقابة:
//  1) السبب الجذري: بعد إخراج الفحصين من مسار الطلب في v20 نقص عدد
//     عناصر Promise.all بينما بقيت فهارس g(i) في تجميع الاستجابة على
//     القيم القديمة — g(18) كانت تقرأ عنصراً غير موجود (undefined)
//     فانفجر TypeError في كل نداء → خطأ 500 → رسالة «تعذر الاتصال
//     بالخادم» مهما كانت الشبكة سليمة. الآن تُفكَّك النتائج بالأسماء
//     مباشرة بلا فهارس إطلاقاً فيستحيل انزياحها مستقبلاً.
//  2) عدادات لوحة المؤشرات التسعة دُمجت في استعلام SQL واحد — القسم
//     كان يطلق 18 استعلاماً متوازياً فيستنزف اتصالات قاعدة البيانات
//     على Netlify (Cold Start) ويقترب من مهلة 10 ثوانٍ. الآن 10
//     استعلامات فقط، وفشل استعلام العدادات يعطي أصفاراً دون إسقاط
//     القسم (fallback آمن).
//  3) الفحص الدوري يُشغَّل من الواجهة بعد اكتمال التحميل وليس بالتوازي
//     معه (انظر oversight-page.tsx و notifications-page.tsx).
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { safeDbOp } from '@/lib/api-helpers'
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

  var now = new Date()
  var startToday = new Date(now)
  startToday.setHours(0, 0, 0, 0)
  var in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  var weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

  // قاعدة الظهور نفسها في قسم التنبيهات: تنبيهاتي + التنبيهات العامة
  var visible = { OR: [{ userId: user.id }, { userId: null }] }

  // نطاق عدادات سجل العمليات: الإدارة العليا الكل — مدير المشروع مشاريعه فقط
  var projectScopeSql = isTop
    ? Prisma.empty
    : Prisma.sql` AND "projectId" IN (SELECT "id" FROM "Project" WHERE "managerId" = ${uid} OR "engineerId" = ${uid})`

  // v21: تُفكَّك النتائج بالأسماء مباشرة — لا فهارس رقمية إطلاقاً
  var [
    supervisoryRes,
    taskNotifsRes,
    criticalRes,
    countsRes,
    lateRes,
    dueSoonRes,
    waitingRes,
    readyReviewRes,
    returnedRes,
    projectsRes,
  ] = await Promise.all([
    // التنبيهات الرقابية: الأنواع المنقولة + أي تنبيه حرج
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
    // تنبيهات متابعة المهام (كل أنواع task_ الموجهة للمستخدم)
    safeDbOp(
      () => db.notification.findMany({
        where: { userId: uid, type: { startsWith: 'task_' } },
        orderBy: { createdAt: 'desc' },
        take: 80,
      }),
      'جلب تنبيهات المهام'
    ),
    // التحذيرات الحرجة (مرئية للمستخدم)
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
    // v21: كل عدادات لوحة المؤشرات في استعلام واحد (كانت 9 استعلامات).
    // COUNT(*)::int يعيد number وليس bigint — bigint يفشل في JSON.stringify
    safeDbOp(
      () => db.$queryRaw<Array<Record<string, number>>>`
        SELECT
          (SELECT COUNT(*)::int FROM "Notification"
            WHERE "read" = false
              AND ("userId" = ${uid} OR "userId" IS NULL)
              AND "type" IN (${Prisma.raw(OVERSIGHT_NOTIFICATION_TYPES.slice().map((t) => "'" + t + "'").join(','))})
          ) AS "supervisoryUnread",
          (SELECT COUNT(*)::int FROM "Notification"
            WHERE "read" = false
              AND ("userId" = ${uid} OR "userId" IS NULL)
              AND "severity" = 'critical'
          ) AS "criticalUnread",
          (SELECT COUNT(*)::int FROM "AuditLog"
            WHERE "createdAt" >= ${startToday}${projectScopeSql}
          ) AS "opsToday",
          (SELECT COUNT(*)::int FROM "AuditLog"
            WHERE "createdAt" >= ${weekAgo}${projectScopeSql}
          ) AS "ops7d",
          (SELECT COUNT(*)::int FROM "Task"
            WHERE "dueDate" < ${now} AND "status" NOT IN ('closed', 'cancelled')
          ) AS "lateTasks",
          (SELECT COUNT(*)::int FROM "Task"
            WHERE "dueDate" >= ${now} AND "dueDate" < ${in24h} AND "status" NOT IN ('closed', 'cancelled')
          ) AS "dueSoonTasks",
          (SELECT COUNT(*)::int FROM "Task" WHERE "status" = 'waiting') AS "waitingTasks",
          (SELECT COUNT(*)::int FROM "Task" WHERE "status" = 'ready_review') AS "readyReviewTasks",
          (SELECT COUNT(*)::int FROM "Task" WHERE "status" = 'returned') AS "returnedTasks"
      `,
      'عدادات لوحة الرقابة'
    ),
    // المهام المتأخرة
    safeDbOp(
      () => db.task.findMany({
        where: { dueDate: { lt: now }, ...OPEN_STATUS },
        select: TASK_SELECT,
        orderBy: { dueDate: 'asc' },
        take: 15,
      }),
      'المهام المتأخرة'
    ),
    // مهام تستحق خلال 24 ساعة
    safeDbOp(
      () => db.task.findMany({
        where: { dueDate: { gte: now, lt: in24h }, ...OPEN_STATUS },
        select: TASK_SELECT,
        orderBy: { dueDate: 'asc' },
        take: 10,
      }),
      'مهام تستحق خلال 24 ساعة'
    ),
    // مهام بانتظار جهة أخرى
    safeDbOp(
      () => db.task.findMany({
        where: { status: 'waiting' },
        select: TASK_SELECT,
        orderBy: { waitingSince: 'asc' },
        take: 10,
      }),
      'مهام بانتظار جهة أخرى'
    ),
    // مهام بانتظار المراجعة
    safeDbOp(
      () => db.task.findMany({
        where: { status: 'ready_review' },
        select: TASK_SELECT,
        orderBy: { reviewRequestedAt: 'asc' },
        take: 10,
      }),
      'مهام بانتظار المراجعة'
    ),
    // المهام المعادة
    safeDbOp(
      () => db.task.findMany({
        where: { status: 'returned' },
        select: TASK_SELECT,
        orderBy: { updatedAt: 'desc' },
        take: 10,
      }),
      'المهام المعادة'
    ),
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
  if (!supervisoryRes.success) {
    return supervisoryRes.response || NextResponse.json(
      { error: 'database_error', message: 'تعذر جلب بيانات الرقابة' },
      { status: 500 }
    )
  }

  // v21: استعلام العدادات المجمّع — فشله يعطي أصفاراً فقط دون إسقاط القسم
  var c: Record<string, number> = countsRes.success ? ((countsRes.data as any) || {}) : {}

  return NextResponse.json(
    {
      stats: {
        opsToday: c.opsToday || 0,
        ops7d: c.ops7d || 0,
        supervisoryUnread: c.supervisoryUnread || 0,
        criticalUnread: c.criticalUnread || 0,
        lateTasks: c.lateTasks || 0,
        dueSoonTasks: c.dueSoonTasks || 0,
        waitingTasks: c.waitingTasks || 0,
        readyReviewTasks: c.readyReviewTasks || 0,
        returnedTasks: c.returnedTasks || 0,
      },
      notifications: supervisoryRes.data || [],
      taskNotifications: taskNotifsRes.success ? taskNotifsRes.data : [],
      critical: criticalRes.success ? criticalRes.data : [],
      tasks: {
        late: lateRes.success ? lateRes.data : [],
        dueSoon: dueSoonRes.success ? dueSoonRes.data : [],
        waiting: waitingRes.success ? waitingRes.data : [],
        readyReview: readyReviewRes.success ? readyReviewRes.data : [],
        returned: returnedRes.success ? returnedRes.data : [],
      },
      projects: projectsRes.success ? projectsRes.data : [],
      viewer: { isTopManagement: isTop },
    },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}

