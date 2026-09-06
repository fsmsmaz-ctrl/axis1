import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, safeDbOp } from '@/lib/api-helpers'
import { hasPermission, isTaskManager } from '@/lib/auth'

const VALID_PRIORITIES = ['urgent', 'high', 'normal', 'low']
const VALID_SIZES = ['small', 'medium', 'large']

// بيانات التفاصيل الكاملة: المهمة + السجل + المرفقات
function taskInclude() {
  return {
    assignee: { select: { id: true, name: true, nameEn: true } },
    creator: { select: { id: true, name: true, nameEn: true } },
    closedBy: { select: { id: true, name: true, nameEn: true } },
    lastUpdatedBy: { select: { id: true, name: true, nameEn: true } },
    events: {
      orderBy: { createdAt: 'desc' as const },
      take: 100,
      include: { actor: { select: { id: true, name: true, nameEn: true } } },
    },
    attachments: {
      orderBy: { createdAt: 'desc' as const },
      include: { uploader: { select: { id: true, name: true, nameEn: true } } },
    },
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await getAuthUser(req)
    if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
    if (!hasPermission(user.role, 'tasks', user.permissions)) {
      return NextResponse.json({ error: 'forbidden', message: 'لا تملك صلاحية الوصول' }, { status: 403 })
    }

    const result = await safeDbOp(
      () => db.task.findUnique({ where: { id }, include: taskInclude() }),
      'جلب تفاصيل المهمة'
    )
    if (!result.success) return result.response
    const task = result.data
    if (!task) return NextResponse.json({ error: 'not_found', message: 'المهمة غير موجودة' }, { status: 404 })

    // الموظف يرى مهامه فقط
    if (!isTaskManager(user) && task.assigneeId !== user.id) {
      return NextResponse.json({ error: 'forbidden', message: 'يمكنك عرض مهامك المسندة فقط' }, { status: 403 })
    }

    return NextResponse.json({ task, viewer: { isManager: isTaskManager(user), userId: user.id } })
  } catch (error: any) {
    return handleDbError(error, 'جلب تفاصيل المهمة')
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await getAuthUser(req)
    if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })

    // تعديل بيانات المهمة للمدير فقط
    if (!isTaskManager(user)) {
      return NextResponse.json({ error: 'forbidden', message: 'تعديل بيانات المهمة متاح للإدارة فقط' }, { status: 403 })
    }

    const existing = await db.task.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'not_found', message: 'المهمة غير موجودة' }, { status: 404 })

    // لا تُعدَّل المهام المغلقة نهائياً أو الملغاة (سلامة السجل)
    if (existing.status === 'closed' || existing.status === 'cancelled') {
      return NextResponse.json({ error: 'locked', message: 'لا يمكن تعديل مهمة مغلقة نهائياً أو ملغاة' }, { status: 409 })
    }

    const body = await req.json()
    const data: any = { lastUpdatedById: user.id }
    const events: any[] = []

    if (body.title !== undefined) {
      const title = String(body.title).trim()
      if (!title) return NextResponse.json({ error: 'invalid_value', message: 'عنوان المهمة مطلوب' }, { status: 400 })
      data.title = title
    }
    if (body.description !== undefined) data.description = body.description ? String(body.description).trim() : null
    if (body.category !== undefined) data.category = body.category ? String(body.category).trim() : null
    if (body.priority !== undefined && VALID_PRIORITIES.includes(String(body.priority))) data.priority = String(body.priority)
    if (body.size !== undefined && VALID_SIZES.includes(String(body.size))) data.size = String(body.size)

    // تغيير موعد الإنجاز — يُسجَّل في سجل المهمة مع التاريخ واسم مَن عدّل
    if (body.dueDate !== undefined) {
      const nd = new Date(body.dueDate)
      if (isNaN(nd.getTime())) return NextResponse.json({ error: 'invalid_value', message: 'تاريخ الإنجاز غير صالح' }, { status: 400 })
      if (nd.getTime() !== new Date(existing.dueDate).getTime()) {
        data.dueDate = nd
        events.push({ type: 'due_date_change', oldDueDate: existing.dueDate, newDueDate: nd })
      }
    }

    // تغيير المسؤول — يُسجَّل مع تنبيه للموظف الجديد
    if (body.assigneeId !== undefined && String(body.assigneeId) !== existing.assigneeId) {
      const newAssignee = await db.user.findUnique({ where: { id: String(body.assigneeId) }, select: { id: true, name: true, active: true } })
      if (!newAssignee) return NextResponse.json({ error: 'invalid_reference', message: 'الموظف الجديد غير موجود' }, { status: 400 })
      data.assigneeId = String(body.assigneeId)
      events.push({ type: 'assignee_change', oldAssigneeId: existing.assigneeId, newAssigneeId: String(body.assigneeId) })
    }

    const updateResult = await safeDbOp(
      () => db.task.update({ where: { id }, data, include: taskInclude() }),
      'تعديل المهمة'
    )
    if (!updateResult.success) return updateResult.response

    // كتابة أحداث التغيير (موعد/مسؤول) + حدث ملاحظة عام إن وُجد تعديل آخر
    for (const ev of events) {
      await safeDbOp(
        () => db.taskEvent.create({
          data: {
            taskId: id,
            actorId: user.id,
            type: ev.type,
            fromStatus: existing.status,
            toStatus: existing.status,
            oldDueDate: ev.oldDueDate || null,
            newDueDate: ev.newDueDate || null,
            oldAssigneeId: ev.oldAssigneeId || null,
            newAssigneeId: ev.newAssigneeId || null,
            note: body.changeNote ? String(body.changeNote).trim() : null,
          },
        }),
        'تسجيل حدث التعديل'
      )
    }
    if (events.length === 0) {
      // تعديل حقول وصفية — يبقى أثره في updatedAt + lastUpdatedBy
      await safeDbOp(
        () => db.taskEvent.create({
          data: { taskId: id, actorId: user.id, type: 'note', fromStatus: existing.status, toStatus: existing.status, note: 'تعديل بيانات المهمة' },
        }),
        'تسجيل حدث التعديل'
      )
    }

    // تنبيه الموظف الجديد عند تغيير الإسناد
    const assigneeEvent = events.find((e: any) => e.type === 'assignee_change')
    if (assigneeEvent && assigneeEvent.newAssigneeId !== user.id) {
      await db.notification.create({
        data: {
          userId: assigneeEvent.newAssigneeId,
          type: 'task_assigned',
          title: 'تم إسناد مهمة إليك',
          message: 'المهمة #' + existing.taskNumber + ': ' + updateResult.data.title + ' أُسندت إليك بواسطة ' + user.name + '.',
          severity: 'info',
          link: 'tasks',
          entityType: 'task',
          entityId: 'assign:' + id,
        },
      }).catch(() => {})
    }

    return NextResponse.json({ task: updateResult.data, success: true })
  } catch (error: any) {
    return handleDbError(error, 'تعديل المهمة')
  }
}
