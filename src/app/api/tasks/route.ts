import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, validateRequired, safeDbOp, parseDateRange } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { hasPermission, isTaskManager } from '@/lib/auth'
import { runTaskScanThrottled } from '@/lib/task-watch'

const VALID_PRIORITIES = ['urgent', 'high', 'normal', 'low']
const VALID_SIZES = ['small', 'medium', 'large']
const VALID_RECURRING = ['daily', 'weekly', 'monthly', 'yearly']

/**
 * إشعار موجه لمستخدم محدد (صف مستقل) — مستخدم لإسناد المهام والإعادة
 * لأن notifyUsers يستهدف أصحاب الصلاحيات وليس مستخدماً بعينه.
 */
async function notifyUserDirect(opts: {
  userId: string
  type: string
  title: string
  message: string
  severity?: 'info' | 'warning' | 'critical'
  entityId?: string
}) {
  try {
    const dup = await db.notification.findFirst({
      where: {
        type: opts.type,
        entityId: opts.entityId || null,
        userId: opts.userId,
        createdAt: { gte: new Date(Date.now() - 60 * 1000) }, // نافذة قصيرة جداً لمنع التكرار المتزامن فقط
      },
      select: { id: true },
    })
    if (dup) return
    await db.notification.create({
      data: {
        userId: opts.userId,
        type: opts.type,
        title: opts.title,
        message: opts.message,
        severity: opts.severity || 'info',
        link: 'tasks',
        entityType: 'task',
        entityId: opts.entityId || null,
      },
    })
  } catch (e) {
    console.error('[tasks] notifyUserDirect failed:', e)
  }
}

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthUser(req)
    if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })

    // صلاحية الوصول للوحدة (مع تجاوزات المستخدم)
    if (!hasPermission(user.role, 'tasks', user.permissions)) {
      return NextResponse.json({ error: 'forbidden', message: 'لا تملك صلاحية الوصول لإدارة المهام' }, { status: 403 })
    }

    // تشغيل مراقب المواعيد مع الخمول (يعمل مرة كل 10 دقائق كحد أقصى)
    runTaskScanThrottled(false).catch(() => {})

    const manager = isTaskManager(user)
    const sp = new URL(req.url).searchParams

    const where: any = {}

    // الموظف يرى مهامه المسندة فقط — المدير يرى الكل أو يفلتر بموظف
    if (!manager) {
      where.assigneeId = user.id
    } else if (sp.get('assigneeId')) {
      where.assigneeId = sp.get('assigneeId')
    }

    if (sp.get('status')) {
      const statuses = String(sp.get('status')).split(',').map((s: string) => s.trim()).filter(Boolean)
      if (statuses.length > 0) where.status = { in: statuses }
    }
    if (sp.get('priority')) where.priority = sp.get('priority')
    if (sp.get('category')) where.category = { contains: String(sp.get('category')) }

    const createdRange = parseDateRange(sp.get('createdFrom'), sp.get('createdTo'))
    if (createdRange.gte || createdRange.lt) where.createdAt = createdRange

    const dueRange = parseDateRange(sp.get('dueFrom'), sp.get('dueTo'))
    const dueCond: any = { ...(where.dueDate || {}) }
    if (dueRange.gte) dueCond.gte = dueRange.gte
    if (dueRange.lt) dueCond.lt = dueRange.lt
    if (dueCond.gte || dueCond.lt) where.dueDate = dueCond

    // فلتر المهام المتأخرة فقط: تجاوزت الموعد ولم تُغلق أو تُلغَ
    if (sp.get('late') === '1') {
      where.dueDate = { ...(where.dueDate || {}), lt: new Date() }
      where.status = { ...(where.status || {}), notIn: ['closed', 'cancelled'] }
    }

    const result = await safeDbOp(
      () => db.task.findMany({
        where,
        orderBy: [{ dueDate: 'asc' }],
        take: 500,
        include: {
          assignee: { select: { id: true, name: true, nameEn: true } },
          creator: { select: { id: true, name: true, nameEn: true } },
          closedBy: { select: { id: true, name: true, nameEn: true } },
          _count: { select: { attachments: true, events: true } },
        },
      }),
      'جلب المهام'
    )
    if (!result.success) return result.response

    return NextResponse.json({
      tasks: result.data,
      viewer: { isManager: manager, userId: user.id },
    })
  } catch (error: any) {
    return handleDbError(error, 'جلب المهام')
  }
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })

  // الإنشاء للمدير فقط (الإدارة العليا / مدير المشروع / مدير النظام)
  if (!isTaskManager(user)) {
    return NextResponse.json({ error: 'forbidden', message: 'إنشاء المهام متاح للإدارة فقط' }, { status: 403 })
  }

  var rl = checkRateLimit(req, RateLimitPresets.write)
  if (rl.limited) return NextResponse.json({ error: 'too_many_requests', message: 'طلبات كثيرة جداً' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })

  try {
    const body = await req.json()
    const validationError = validateRequired(body, ['title', 'assigneeId', 'dueDate'])
    if (validationError) return validationError

    const priority = VALID_PRIORITIES.includes(String(body.priority)) ? String(body.priority) : 'normal'
    const size = VALID_SIZES.includes(String(body.size)) ? String(body.size) : 'medium'
    const recurring = body.recurring && VALID_RECURRING.includes(String(body.recurring)) ? String(body.recurring) : null
    const dueDate = new Date(body.dueDate)
    if (isNaN(dueDate.getTime())) {
      return NextResponse.json({ error: 'invalid_value', message: 'تاريخ الإنجاز المطلوب غير صالح' }, { status: 400 })
    }

    // التأكد من وجود الموظف المستهدف
    const assignee = await db.user.findUnique({ where: { id: String(body.assigneeId) }, select: { id: true, name: true, active: true } })
    if (!assignee) {
      return NextResponse.json({ error: 'invalid_reference', message: 'الموظف المسؤول غير موجود' }, { status: 400 })
    }

    const createResult = await safeDbOp(
      () => db.task.create({
        data: {
          title: String(body.title).trim(),
          description: body.description ? String(body.description).trim() : null,
          category: body.category ? String(body.category).trim() : null,
          priority,
          size,
          status: 'new',
          dueDate,
          assigneeId: String(body.assigneeId),
          creatorId: user.id,
          recurring,
          lastUpdatedById: user.id,
        },
        include: {
          assignee: { select: { id: true, name: true, nameEn: true } },
          creator: { select: { id: true, name: true, nameEn: true } },
        },
      }),
      'إنشاء المهمة'
    )
    if (!createResult.success) return createResult.response

    const task = createResult.data

    // حدث الإنشاء في سجل المهمة
    await safeDbOp(
      () => db.taskEvent.create({
        data: {
          taskId: task.id,
          actorId: user.id,
          type: 'created',
          toStatus: 'new',
          note: body.description ? String(body.description).trim() : null,
        },
      }),
      'حدث إنشاء المهمة'
    )

    // تنبيه الموظف بإسناد مهمة جديدة (ما لم يسند لنفسه)
    if (task.assigneeId !== user.id) {
      const recurringAr: Record<string, string> = { daily: 'يومية', weekly: 'أسبوعية', monthly: 'شهرية', yearly: 'سنوية' }
      await notifyUserDirect({
        userId: task.assigneeId,
        type: 'task_assigned',
        title: 'تم إسناد مهمة جديدة إليك',
        message: 'المهمة #' + task.taskNumber + ': ' + task.title + ' — موعد الإنجاز المطلوب ' + dueDate.toISOString().split('T')[0] + (recurring ? ' (مهمة ' + (recurringAr[recurring] || recurring) + ')' : ''),
        severity: 'info',
        entityId: 'assign:' + task.id,
      })
    }

    return NextResponse.json({ task, success: true })
  } catch (error: any) {
    return handleDbError(error, 'إنشاء المهمة')
  }
}
