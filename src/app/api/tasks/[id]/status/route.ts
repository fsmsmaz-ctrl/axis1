import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, safeDbOp } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { hasPermission, isTaskManager } from '@/lib/auth'
import { notifyUsers } from '@/lib/notify'

const OPEN_STATUSES = ['new', 'in_progress', 'waiting', 'returned']

const VALID_RECURRING = ['daily', 'weekly', 'monthly', 'yearly'] as const

function nextDueDate(from: Date, recurring: string): Date {
  const d = new Date(from)
  switch (recurring) {
    case 'daily':
      d.setUTCDate(d.getUTCDate() + 1)
      break
    case 'weekly':
      d.setUTCDate(d.getUTCDate() + 7)
      break
    case 'monthly':
      d.setUTCMonth(d.getUTCMonth() + 1)
      break
    case 'yearly':
      d.setUTCFullYear(d.getUTCFullYear() + 1)
      break
  }
  return d
}

/**
 * تحضير المهمة لانتقال الحالة:
 *  - تسجيل مدة الانتظار المنتهية عند مغادرة حالة waiting
 *  - إرجاع جزء data للتحديث حسب الحالة الجديدة
 */
function buildTransitionData(current: { waitingSince: Date | null; waitingMinutes: number }, toStatus: string, now: Date) {
  const data: any = { status: toStatus }
  let waitingMinutes = current.waitingMinutes
  if (current.waitingSince) {
    waitingMinutes += Math.max(0, Math.floor((now.getTime() - new Date(current.waitingSince).getTime()) / 60000))
  }
  if (toStatus === 'waiting') {
    data.waitingSince = now
    // نُبقي waitingMinutes التراكمية كما هي (تُكمل عند المغادرة)
  } else {
    data.waitingSince = null
    data.waitingMinutes = waitingMinutes
  }
  return data
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await getAuthUser(req)
    if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
    if (!hasPermission(user.role, 'tasks', user.permissions)) {
      return NextResponse.json({ error: 'forbidden', message: 'لا تملك صلاحية الوصول' }, { status: 403 })
    }

    var rl = checkRateLimit(req, RateLimitPresets.write)
    if (rl.limited) return NextResponse.json({ error: 'too_many_requests', message: 'طلبات كثيرة جداً' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })

    const body = await req.json()
    const action = String(body.action || '')
    const reason = body.reason ? String(body.reason).trim() : ''
    const note = body.note ? String(body.note).trim() : ''

    const task = await db.task.findUnique({ where: { id } })
    if (!task) return NextResponse.json({ error: 'not_found', message: 'المهمة غير موجودة' }, { status: 404 })

    const manager = isTaskManager(user)
    const isAssignee = task.assigneeId === user.id

    // الموظف يتعامل مع مهامه فقط
    if (!manager && !isAssignee) {
      return NextResponse.json({ error: 'forbidden', message: 'يمكنك تحديث مهامك المسندة فقط' }, { status: 403 })
    }

    // لا حركة على مهمة مغلقة نهائياً أو ملغاة
    if (task.status === 'closed' || task.status === 'cancelled') {
      return NextResponse.json({ error: 'locked', message: 'المهمة مغلقة نهائياً/ملغاة — لا يمكن تغيير حالتها' }, { status: 409 })
    }

    const now = new Date()

    // ─────────────────── انتقالات الموظف (والمدير أيضاً يستطيعها) ───────────────────
    if (action === 'start') {
      // بدء التنفيذ: جديدة أو معادة → قيد التنفيذ
      if (!['new', 'returned'].includes(task.status)) {
        return NextResponse.json({ error: 'invalid_transition', message: 'بدء التنفيذ متاح فقط للمهام الجديدة أو المعادة للتعديل' }, { status: 409 })
      }
      const data = { ...buildTransitionData(task, 'in_progress', now), startedAt: task.startedAt || now, lastUpdatedById: user.id }
      const updated = await safeDbOp(() => db.task.update({ where: { id }, data }), 'بدء التنفيذ')
      if (!updated.success) return updated.response
      await db.taskEvent.create({ data: { taskId: id, actorId: user.id, type: 'status_change', fromStatus: task.status, toStatus: 'in_progress' } })
      return NextResponse.json({ task: updated.data, success: true })
    }

    if (action === 'wait') {
      // بانتظار جهة أخرى — السبب إلزامي
      if (!OPEN_STATUSES.includes(task.status)) {
        return NextResponse.json({ error: 'invalid_transition', message: 'حالة الانتظار متاحة فقط للمهام المفتوحة' }, { status: 409 })
      }
      if (!reason) return NextResponse.json({ error: 'missing_fields', message: 'سبب الانتظار مطلوب' }, { status: 400 })
      const data = { ...buildTransitionData(task, 'waiting', now), waitingReason: reason, lastUpdatedById: user.id }
      const updated = await safeDbOp(() => db.task.update({ where: { id }, data }), 'تحديث حالة الانتظار')
      if (!updated.success) return updated.response
      await db.taskEvent.create({ data: { taskId: id, actorId: user.id, type: 'status_change', fromStatus: task.status, toStatus: 'waiting', note: reason } })
      // إعلام الإدارة أن المهمة متوقفة بسبب جهة خارجية
      await notifyUsers({
        type: 'task_waiting',
        title: 'مهمة بانتظار جهة أخرى',
        message: 'المهمة #' + task.taskNumber + ' («' + task.title + '») في انتظار جهة أخرى — السبب: ' + reason,
        severity: 'info',
        link: 'tasks',
        entityType: 'task',
        entityId: id + ':waiting',
        permissions: ['tasks'],
        roles: ['top_management', 'project_manager'],
        includeSystemAdmin: true,
        excludeUserIds: [user.id],
      }).catch(() => {})
      return NextResponse.json({ task: updated.data, success: true })
    }

    if (action === 'resume') {
      // استئناف بعد الانتظار
      if (task.status !== 'waiting') {
        return NextResponse.json({ error: 'invalid_transition', message: 'الاستئناف متاح فقط للمهام في حالة الانتظار' }, { status: 409 })
      }
      const data = { ...buildTransitionData(task, 'in_progress', now), lastUpdatedById: user.id }
      const updated = await safeDbOp(() => db.task.update({ where: { id }, data }), 'استئناف المهمة')
      if (!updated.success) return updated.response
      await db.taskEvent.create({ data: { taskId: id, actorId: user.id, type: 'status_change', fromStatus: 'waiting', toStatus: 'in_progress', note: 'استئناف التنفيذ' } })
      return NextResponse.json({ task: updated.data, success: true })
    }

    if (action === 'ready') {
      // جاهزة للمراجعة — من الموظف، مع ملاحظة إلزامية عن الإجراء المنفذ
      if (manager === false && !isAssignee) { /* unreachable — محمي أعلاه */ }
      if (!['in_progress', 'returned', 'waiting', 'new'].includes(task.status)) {
        return NextResponse.json({ error: 'invalid_transition', message: 'الإرسال للمراجعة غير متاح من الحالة الحالية' }, { status: 409 })
      }
      if (!note) return NextResponse.json({ error: 'missing_fields', message: 'ملاحظة الإجراء المنفذ مطلوبة عند الإرسال للمراجعة' }, { status: 400 })
      const data = { ...buildTransitionData(task, 'ready_review', now), reviewRequestedAt: now, reviewNote: note, lastUpdatedById: user.id }
      const updated = await safeDbOp(() => db.task.update({ where: { id }, data }), 'الإرسال للمراجعة')
      if (!updated.success) return updated.response
      await db.taskEvent.create({ data: { taskId: id, actorId: user.id, type: 'review', fromStatus: task.status, toStatus: 'ready_review', note } })
      // إشعار المديرين أن المهمة جاهزة للمراجعة
      await notifyUsers({
        type: 'task_ready_review',
        title: 'مهمة جاهزة للمراجعة',
        message: 'المهمة #' + task.taskNumber + ' («' + task.title + '») أصبحت جاهزة للمراجعة. الإجراء المنفذ: ' + note,
        severity: 'info',
        link: 'tasks',
        entityType: 'task',
        entityId: id + ':ready',
        permissions: ['tasks'],
        roles: ['top_management', 'project_manager'],
        includeSystemAdmin: true,
        excludeUserIds: [user.id],
      }).catch(() => {})
      return NextResponse.json({ task: updated.data, success: true })
    }

    // ─────────────────── انتقالات المدير فقط ───────────────────
    if (action === 'return') {
      if (!manager) return NextResponse.json({ error: 'forbidden', message: 'إعادة المهمة للتعديل متاحة للإدارة فقط' }, { status: 403 })
      if (task.status !== 'ready_review') {
        return NextResponse.json({ error: 'invalid_transition', message: 'الإعادة للتعديل متاحة فقط للمهام الجاهزة للمراجعة' }, { status: 409 })
      }
      if (!reason) return NextResponse.json({ error: 'missing_fields', message: 'سبب الإعادة للتعديل مطلوب' }, { status: 400 })
      const data = { ...buildTransitionData(task, 'returned', now), returnCount: task.returnCount + 1, lastUpdatedById: user.id }
      const updated = await safeDbOp(() => db.task.update({ where: { id }, data }), 'إعادة المهمة للتعديل')
      if (!updated.success) return updated.response
      await db.taskEvent.create({ data: { taskId: id, actorId: user.id, type: 'returned', fromStatus: 'ready_review', toStatus: 'returned', note: reason } })
      // إشعار الموظف بإعادة المهمة
      await db.notification.create({
        data: {
          userId: task.assigneeId,
          type: 'task_returned',
          title: 'أُعيدت مهمة إليك للتعديل',
          message: 'المهمة #' + task.taskNumber + ' («' + task.title + '») أُعيدت للتعديل بواسطة ' + user.name + ' — السبب: ' + reason,
          severity: 'warning',
          link: 'tasks',
          entityType: 'task',
          entityId: id + ':return:' + (task.returnCount + 1),
        },
      }).catch(() => {})
      return NextResponse.json({ task: updated.data, success: true })
    }

    if (action === 'approve') {
      if (!manager) return NextResponse.json({ error: 'forbidden', message: 'اعتماد المهمة متاح للإدارة فقط' }, { status: 403 })
      if (task.status !== 'ready_review') {
        return NextResponse.json({ error: 'invalid_transition', message: 'الاعتماد متاح فقط للمهام الجاهزة للمراجعة' }, { status: 409 })
      }
      const data = {
        ...buildTransitionData(task, 'closed', now),
        closedAt: now,
        closedById: user.id,
        closedOnFirstReview: task.returnCount === 0,
        lastUpdatedById: user.id,
      }
      const updated = await safeDbOp(() => db.task.update({ where: { id }, data }), 'اعتماد المهمة')
      if (!updated.success) return updated.response
      await db.taskEvent.create({ data: { taskId: id, actorId: user.id, type: 'approved', fromStatus: 'ready_review', toStatus: 'closed', note: note || 'تم الاعتماد والإغلاق النهائي' } })
      // إشعار الموظف بالاعتماد
      await db.notification.create({
        data: {
          userId: task.assigneeId,
          type: 'task_approved',
          title: 'تم اعتماد مهمتك وإغلاقها',
          message: 'المهمة #' + task.taskNumber + ' («' + task.title + '») اعتُمدت وأُغلقت نهائياً بواسطة ' + user.name + '.',
          severity: 'info',
          link: 'tasks',
          entityType: 'task',
          entityId: id + ':approved',
        },
      }).catch(() => {})

      // ── المهام الدورية: عند الإغلاق تُنشأ المهمة التالية تلقائياً ──
      let spawned: any = null
      if (task.recurring && (VALID_RECURRING as readonly string[]).includes(task.recurring)) {
        const nd = nextDueDate(new Date(task.dueDate), task.recurring)
        const createdNext = await safeDbOp(
          () => db.task.create({
            data: {
              title: task.title,
              description: task.description,
              category: task.category,
              priority: task.priority,
              size: task.size,
              status: 'new',
              dueDate: nd,
              assigneeId: task.assigneeId,
              creatorId: user.id,
              recurring: task.recurring,
              parentTaskId: task.parentTaskId || task.id,
              lastUpdatedById: user.id,
            },
          }),
          'إنشاء المهمة الدورية التالية'
        )
        if (createdNext.success) {
          spawned = createdNext.data
          await db.taskEvent.create({
            data: {
              taskId: spawned.id,
              actorId: user.id,
              type: 'recurring_spawn',
              toStatus: 'new',
              note: 'أُنشئت تلقائياً بعد إغلاق المهمة #' + task.taskNumber + ' (تكرار ' + task.recurring + ')',
            },
          }).catch(() => {})
          if (task.assigneeId !== user.id) {
            await db.notification.create({
              data: {
                userId: task.assigneeId,
                type: 'task_assigned',
                title: 'مهمة دورية جديدة',
                message: 'أُنشئت المهمة الدورية #' + spawned.taskNumber + ': ' + spawned.title + ' — موعد الإنجاز ' + nd.toISOString().split('T')[0] + '.',
                severity: 'info',
                link: 'tasks',
                entityType: 'task',
                entityId: 'assign:' + spawned.id,
              },
            }).catch(() => {})
          }
        }
      }

      return NextResponse.json({ task: updated.data, spawnedTask: spawned, success: true })
    }

    if (action === 'cancel') {
      if (!manager) return NextResponse.json({ error: 'forbidden', message: 'إلغاء المهمة متاح للإدارة فقط' }, { status: 403 })
      if (!reason) return NextResponse.json({ error: 'missing_fields', message: 'سبب الإلغاء مطلوب — المهمة لا تُحذف بل تُلغى بسجل' }, { status: 400 })
      const data = {
        ...buildTransitionData(task, 'cancelled', now),
        cancelledAt: now,
        cancelReason: reason,
        lastUpdatedById: user.id,
      }
      const updated = await safeDbOp(() => db.task.update({ where: { id }, data }), 'إلغاء المهمة')
      if (!updated.success) return updated.response
      await db.taskEvent.create({ data: { taskId: id, actorId: user.id, type: 'cancelled', fromStatus: task.status, toStatus: 'cancelled', note: reason } })
      // إشعار الموظف بالإلغاء (ما لم يكن هو الملغي)
      if (task.assigneeId !== user.id) {
        await db.notification.create({
          data: {
            userId: task.assigneeId,
            type: 'task_cancelled',
            title: 'أُلغيت مهمة مسندة إليك',
            message: 'المهمة #' + task.taskNumber + ' («' + task.title + '») أُلغيت بواسطة ' + user.name + ' — السبب: ' + reason,
            severity: 'info',
            link: 'tasks',
            entityType: 'task',
            entityId: id + ':cancelled',
          },
        }).catch(() => {})
      }
      return NextResponse.json({ task: updated.data, success: true })
    }

    return NextResponse.json({ error: 'invalid_action', message: 'إجراء غير معروف: ' + action }, { status: 400 })
  } catch (error: any) {
    return handleDbError(error, 'تحديث حالة المهمة')
  }
}
