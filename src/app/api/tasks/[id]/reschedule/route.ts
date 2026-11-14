// ============================================================
// v119 — إعادة ترتيب موعد الإنجاز (قسم «تذكيراتي»)
// POST /api/tasks/[id]/reschedule
// ============================================================
// يتيح للموظف المسؤول تعديل موعد إنجاز مهمته بنفسه — بصلاحية
// مضبوطة ومقصورة بعناية (حماية من الثغرات):
//   • المهمة يجب أن تكون مسندة له شخصياً (أو أن المُعدِّل مدير مهام).
//   • الحالات المسموحة: جديدة / قيد التنفيذ / بانتظار جهة أخرى / معادة للتعديل.
//   • مرفوض نهائياً: المغلقة والملغاة وجاهزة للمراجعة (سلامة دورة المراجعة).
//   • الموعد الجديد يجب أن يكون تاريخاً صالحاً في المستقبل.
//   • التغيير يُسجَّل في سجل المهمة (due_date_change) باسم المُعدِّل والتاريخين،
//     ويصل تنبيه للإدارة عند تعديل الموظف — لا يوجد أي تعديل صامت.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, safeDbOp } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { hasPermission, isTaskManager } from '@/lib/auth'
import { notifyUsers } from '@/lib/notify'

const RESCHEDULABLE_STATUSES = ['new', 'in_progress', 'waiting', 'returned']

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await getAuthUser(req)
    if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })

    // صلاحية الوصول لوحدة المهام (نفس فحص مسارات المهام الأخرى — مدير النظام يتجاوز فحص الصلاحيات)
    if (!hasPermission(user.role, 'tasks', user.permissions, user.email) && !isTaskManager(user)) {
      return NextResponse.json({ error: 'forbidden', message: 'لا تملك صلاحية الوصول لإدارة المهام' }, { status: 403 })
    }

    var rl = checkRateLimit(req, RateLimitPresets.write)
    if (rl.limited) {
      return NextResponse.json({ error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار قليلاً' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })
    }

    const body = await req.json().catch(() => ({} as any))
    if (body.dueDate === undefined || body.dueDate === null || body.dueDate === '') {
      return NextResponse.json({ error: 'invalid_value', message: 'موعد الإنجاز الجديد مطلوب' }, { status: 400 })
    }
    const nd = new Date(body.dueDate)
    if (isNaN(nd.getTime())) {
      return NextResponse.json({ error: 'invalid_value', message: 'تاريخ الإنجاز غير صالح' }, { status: 400 })
    }
    // نطاق منطقي للتاريخ — حماية من القيم الشاذة
    if (nd.getFullYear() < 2000 || nd.getFullYear() > 2100) {
      return NextResponse.json({ error: 'invalid_value', message: 'تاريخ الإنجاز خارج النطاق المسموح' }, { status: 400 })
    }
    // الموعد الجديد في المستقبل — لا معنى لتعيين موعد انقضى أصلاً
    if (nd.getTime() <= Date.now()) {
      return NextResponse.json({ error: 'invalid_value', message: 'موعد الإنجاز الجديد يجب أن يكون في المستقبل' }, { status: 400 })
    }

    const existing = await db.task.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'not_found', message: 'المهمة غير موجودة' }, { status: 404 })

    // الصلاحية المقصورة: الموظف المسؤول نفسه فقط (أو مدير المهام)
    const mine = existing.assigneeId === user.id
    if (!mine && !isTaskManager(user)) {
      return NextResponse.json({ error: 'forbidden', message: 'يمكنك تعديل موعد مهامك المسندة إليك فقط' }, { status: 403 })
    }

    // حراسة دورة حياة المهمة
    if (existing.status === 'closed' || existing.status === 'cancelled') {
      return NextResponse.json({ error: 'locked', message: 'لا يمكن تعديل موعد مهمة مغلقة نهائياً أو ملغاة' }, { status: 409 })
    }
    if (!RESCHEDULABLE_STATUSES.includes(existing.status)) {
      return NextResponse.json({ error: 'locked', message: 'لا يمكن تعديل موعد مهمة بانتظار مراجعة الإدارة' }, { status: 409 })
    }

    if (nd.getTime() === new Date(existing.dueDate).getTime()) {
      return NextResponse.json({ error: 'invalid_value', message: 'الموعد الجديد مطابق للموعد الحالي' }, { status: 400 })
    }

    const note = body.note ? String(body.note).trim().slice(0, 500) : null

    const updateResult = await safeDbOp(
      () => db.task.update({
        where: { id },
        data: { dueDate: nd, lastUpdatedById: user.id },
        include: { assignee: { select: { id: true, name: true, nameEn: true } } },
      }),
      'إعادة ترتيب موعد المهمة'
    )
    if (!updateResult.success) return updateResult.response

    // تسجيل الحدث في سجل المهمة — باسم المُعدِّل والتاريخين (نفس نوع حدث تعديل المدير)
    await safeDbOp(
      () => db.taskEvent.create({
        data: {
          taskId: id,
          actorId: user.id,
          type: 'due_date_change',
          fromStatus: existing.status,
          toStatus: existing.status,
          oldDueDate: existing.dueDate,
          newDueDate: nd,
          note: note || 'تعديل موعد الإنجاز من الموظف المسؤول',
        },
      }),
      'تسجيل حدث تعديل الموعد'
    )

    // تنبيه الإدارة عند تعديل الموظف لموعد مهمته — رقابة كاملة بلا تعديل صامت
    if (!isTaskManager(user)) {
      try {
        const fmt = (d: Date) => d.toISOString().split('T')[0]
        await notifyUsers({
          type: 'task_rescheduled',
          title: 'موظف عدّل موعد إنجاز مهمة مسندة إليه',
          message: 'المهمة #' + existing.taskNumber + ' («' + existing.title + '») — غيّر ' + user.name + ' موعد الإنجاز من ' + fmt(new Date(existing.dueDate)) + ' إلى ' + fmt(nd) + '.',
          severity: 'info',
          link: 'tasks',
          entityType: 'task',
          entityId: id + ':resched',
          permissions: ['tasks'],
          roles: ['top_management', 'project_manager'],
          includeSystemAdmin: true,
          dedupeHours: 24,
        })
      } catch (e) {
        console.error('[tasks/reschedule] manager notify failed:', e)
      }
    }

    return NextResponse.json({ task: updateResult.data, success: true })
  } catch (error: any) {
    return handleDbError(error, 'إعادة ترتيب موعد المهمة')
  }
}

