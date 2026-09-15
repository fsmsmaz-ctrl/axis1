// ============================================================
// مراقب المهام — فحص دوري للمواعيد والتأخير وإصدار التنبيهات
// ============================================================
// يرصد الحالات التالية ويُصدر تنبيهات موجهة:
//  1) مهمة موعدها خلال 24 ساعة ولم تُغلق → الموظف المسؤول
//  2) مهمة متأخرة عن موعد الإنجاز → الموظف المسؤول + الإدارة
//  3) مهمة جاهزة للمراجعة منذ أكثر من 24 ساعة → الإدارة
//
// نفس نمط report-watch: throttle 10 دقائق + قفل تزامن
// + منع تكرار التنبيه الواحد عبر entityId في notifyUsers.
// ============================================================

import { db } from './db'
import { notifyUsers } from './notify'

const SCAN_INTERVAL_MS = 10 * 60 * 1000 // 10 دقائق بين كل فحص والآخر

let lastScanAt: number = 0
let scanInFlight: Promise<{ created: number }> | null = null

function fmtDate(d: Date): string {
  return d.toISOString().split('T')[0]
}

/** تنفيذ الفحص الكامل الآن — يُرجع عدد التنبيهات المُنشأة */
export async function runTaskScanNow(): Promise<{ created: number }> {
  let created = 0
  const now = new Date()
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  const cutoff24hAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)

  const openStatuses = ['new', 'in_progress', 'waiting', 'returned']

  // ─────────────────────────────────────────────────────────
  // 1) مهلة 24 ساعة قبل موعد الإنجاز — للموظف المسؤول
  //    (v19: النوع task_due_reminder شخصي — يبقى في قسم التنبيهات)
  // ─────────────────────────────────────────────────────────
  try {
    const dueSoon = await db.task.findMany({
      where: { status: { in: openStatuses }, dueDate: { gte: now, lte: in24h } },
      select: { id: true, taskNumber: true, title: true, dueDate: true, assigneeId: true },
      take: 30,
      orderBy: { dueDate: 'asc' },
    })

    for (const t of dueSoon) {
      // تنبيه موجه للموظف المسؤول مباشرة (صف مستقل + منع تكرار)
      // v19: النوع شخصي (task_due_reminder) — النوع الرقابي محجوز لقسم الرقابة
      const dup = await db.notification.findFirst({
        where: { type: 'task_due_reminder', entityId: t.id + ':due24', userId: t.assigneeId },
        select: { id: true },
      })
      if (!dup) {
        await db.notification.create({
          data: {
            userId: t.assigneeId,
            type: 'task_due_reminder',
            title: 'مهمة يقترب موعد إنجازها',
            message: 'المهمة #' + t.taskNumber + ' («' + t.title + '») موعدها المطلوب ' + fmtDate(new Date(t.dueDate)) + ' — خلال 24 ساعة. يرجى استكمالها أو تحديث حالتها.',
            severity: 'warning',
            link: 'tasks',
            entityType: 'task',
            entityId: t.id + ':due24',
          },
        })
        created += 1
      }
    }
  } catch (e) {
    console.error('[task-watch] due-soon scan failed:', e)
  }

  // ─────────────────────────────────────────────────────────
  // 2) مهام متأخرة (تجاوزت موعد الإنجاز ولم تُغلق) — المسؤول + الإدارة
  //    (v19: تذكير المكلَّف task_overdue_reminder شخصي — نسخة الإدارة task_overdue رقابية)
  // ─────────────────────────────────────────────────────────
  try {
    const overdue = await db.task.findMany({
      where: { status: { in: openStatuses }, dueDate: { lt: now } },
      select: { id: true, taskNumber: true, title: true, dueDate: true, assigneeId: true },
      take: 30,
      orderBy: { dueDate: 'asc' },
    })

    for (const t of overdue) {
      const msg = 'المهمة #' + t.taskNumber + ' («' + t.title + '») تجاوزت موعد الإنجاز المطلوب (' + fmtDate(new Date(t.dueDate)) + ') ولم تُغلق بعد.'
      // أ) الموظف المسؤول — صف مباشر بمنع تكرار (v19: نوع شخصي يبقى في التنبيهات)
      const dupAssignee = await db.notification.findFirst({
        where: { type: 'task_overdue_reminder', entityId: t.id + ':late', userId: t.assigneeId },
        select: { id: true },
      })
      if (!dupAssignee) {
        await db.notification.create({
          data: {
            userId: t.assigneeId,
            type: 'task_overdue_reminder',
            title: 'تأخير في مهمة مسندة إليك',
            message: msg + ' يرجى تحديث حالتها أو إرسالها للمراجعة فوراً.',
            severity: 'critical',
            link: 'tasks',
            entityType: 'task',
            entityId: t.id + ':late',
          },
        })
        created += 1
      }
      // ب) الإدارة (مدير المهام) — النسخة الرقابية task_overdue (تظهر في قسم الرقابة فقط)
      const count = await notifyUsers({
        type: 'task_overdue',
        title: 'مهمة متأخرة عن موعدها',
        message: msg,
        severity: 'warning',
        link: 'tasks',
        entityType: 'task',
        entityId: t.id + ':late:mgr',
        permissions: ['tasks'],
        roles: ['top_management', 'project_manager'],
        includeSystemAdmin: true,
        excludeUserIds: [t.assigneeId],
        dedupeHours: 24,
      })
      created += count
    }
  } catch (e) {
    console.error('[task-watch] overdue scan failed:', e)
  }

  // ─────────────────────────────────────────────────────────
  // 3) جاهزة للمراجعة منذ أكثر من 24 ساعة — تذكير الإدارة
  // ─────────────────────────────────────────────────────────
  try {
    const pendingReview = await db.task.findMany({
      where: { status: 'ready_review', reviewRequestedAt: { lt: cutoff24hAgo } },
      select: { id: true, taskNumber: true, title: true, reviewRequestedAt: true },
      take: 25,
      orderBy: { reviewRequestedAt: 'asc' },
    })

    for (const t of pendingReview) {
      const count = await notifyUsers({
        type: 'task_review_pending',
        title: 'مهمة بانتظار مراجعتك منذ أكثر من 24 ساعة',
        message: 'المهمة #' + t.taskNumber + ' («' + t.title + '») جاهزة للمراجعة منذ ' + fmtDate(new Date(t.reviewRequestedAt || now)) + '. تتطلب اعتماداً أو إعادة للتعديل.',
        severity: 'warning',
        link: 'tasks',
        entityType: 'task',
        entityId: t.id + ':review',
        permissions: ['tasks'],
        roles: ['top_management', 'project_manager'],
        includeSystemAdmin: true,
        dedupeHours: 24,
      })
      created += count
    }
  } catch (e) {
    console.error('[task-watch] pending review scan failed:', e)
  }

  return { created }
}

/**
 * تشغيل الفحص مع throttle — مرة واحدة كحد أقصى كل 10 دقائق.
 */
export async function runTaskScanThrottled(force: boolean = false): Promise<{ created: number; skipped: boolean }> {
  const now = Date.now()
  if (!force && now - lastScanAt < SCAN_INTERVAL_MS) {
    return { created: 0, skipped: true }
  }
  if (scanInFlight) return { ...(await scanInFlight), skipped: true }

  lastScanAt = now
  scanInFlight = runTaskScanNow()
  try {
    const result = await scanInFlight
    return { ...result, skipped: false }
  } finally {
    scanInFlight = null
  }
}
