import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, validateRequired, safeDbOp } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { hasPermission, isTaskManager } from '@/lib/auth'

const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024 // 4MB حد أقصى للمرفق (base64 في قاعدة البيانات)

const VALID_FILE_TYPES = ['image', 'pdf', 'doc']

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

    const task = await db.task.findUnique({ where: { id }, select: { id: true, assigneeId: true, status: true, taskNumber: true } })
    if (!task) return NextResponse.json({ error: 'not_found', message: 'المهمة غير موجودة' }, { status: 404 })

    // الموظف يرفق على مهامه فقط؛ المدير على الجميع. الملغاة تُغلق أمام المرفقات.
    if (!isTaskManager(user) && task.assigneeId !== user.id) {
      return NextResponse.json({ error: 'forbidden', message: 'يمكنك إضافة مرفقات لمهامك المسندة فقط' }, { status: 403 })
    }
    if (task.status === 'cancelled') {
      return NextResponse.json({ error: 'locked', message: 'لا يمكن إضافة مرفقات لمهمة ملغاة' }, { status: 409 })
    }

    const body = await req.json()
    const validationError = validateRequired(body, ['fileName', 'url'])
    if (validationError) return validationError

    const url = String(body.url)
    // حد الحجم: طول base64 ≈ 4/3 الحجم الفعلي — نفحص طول النص مباشرة
    if (url.length > MAX_ATTACHMENT_BYTES * 1.4) {
      return NextResponse.json({ error: 'too_large', message: 'حجم المرفق يتجاوز الحد الأقصى (4 ميغابايت)' }, { status: 413 })
    }

    const fileType = VALID_FILE_TYPES.includes(String(body.fileType)) ? String(body.fileType) : 'doc'

    const result = await safeDbOp(
      () => db.taskAttachment.create({
        data: {
          taskId: id,
          uploaderId: user.id,
          fileName: String(body.fileName).slice(0, 255),
          fileType,
          url,
          size: typeof body.size === 'number' ? body.size : url.length,
        },
        include: { uploader: { select: { id: true, name: true, nameEn: true } } },
      }),
      'إضافة مرفق المهمة'
    )
    if (!result.success) return result.response

    // أثر المرفق في سجل المهمة
    await safeDbOp(
      () => db.taskEvent.create({
        data: { taskId: id, actorId: user.id, type: 'attachment', note: 'إرفاق: ' + String(body.fileName).slice(0, 200) },
      }),
      'حدث إرفاق ملف'
    )

    return NextResponse.json({ attachment: result.data, success: true })
  } catch (error: any) {
    return handleDbError(error, 'إضافة مرفق المهمة')
  }
}
