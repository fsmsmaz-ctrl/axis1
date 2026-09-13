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
    // مدير النظام يتجاوز فحص الصلاحيات (حماية من سجل صلاحيات تالف)
    if (!hasPermission(user.role, 'tasks', user.permissions, user.email) && !isTaskManager(user)) {
      return NextResponse.json({ error: 'forbidden', message: 'لا تملك صلاحية الوصول' }, { status: 403 })
    }

    var rl = checkRateLimit(req, RateLimitPresets.write)
    if (rl.limited) return NextResponse.json({ error: 'too_many_requests', message: 'طلبات كثيرة جداً' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })

    const task = await db.task.findUnique({ where: { id }, select: { id: true, assigneeId: true, status: true, taskNumber: true } })
    if (!task) return NextResponse.json({ error: 'not_found', message: 'المهمة غير موجودة' }, { status: 404 })

    // الموظف يرفق على مهامه فقط؛ المدير على الجميع. الملغاة والمغلقة تُغلق أمام المرفقات.
    if (!isTaskManager(user) && task.assigneeId !== user.id) {
      return NextResponse.json({ error: 'forbidden', message: 'يمكنك إضافة مرفقات لمهامك المسندة فقط' }, { status: 403 })
    }
    // SECURITY FIX: المرفقات كانت مسموحة على المهمة المغلقة نهائياً (مخالفة منطق
    // "لا حركة على مهمة مغلقة" في مسار الحالة)
    if (task.status === 'cancelled' || task.status === 'closed') {
      return NextResponse.json({ error: 'locked', message: 'لا يمكن إضافة مرفقات لمهمة مغلقة أو ملغاة' }, { status: 409 })
    }

    // SECURITY FIX: حد أقصى لعدد المرفقات لكل مهمة — كانت بلا سقف فيمكن
    // تضخيم صفوف قاعدة البيانات بمئات الميغابايتات
    var attachmentCount = await db.taskAttachment.count({ where: { taskId: id } })
    if (attachmentCount >= 20) {
      return NextResponse.json({ error: 'too_many_attachments', message: 'بلغ المهمة الحد الأقصى للمرفقات (20)' }, { status: 400 })
    }

    const body = await req.json()
    const validationError = validateRequired(body, ['fileName', 'url'])
    if (validationError) return validationError

    const url = String(body.url)
    // حد الحجم: طول base64 ≈ 4/3 الحجم الفعلي — نفحص طول النص مباشرة
    if (url.length > MAX_ATTACHMENT_BYTES * 1.4) {
      return NextResponse.json({ error: 'too_large', message: 'حجم المرفق يتجاوز الحد الأقصى (4 ميغابايت)' }, { status: 413 })
    }

    // SECURITY FIX: قائمة سماح لصيغة المرفق — كان يقبل أي نص (روابط خارجية
    // لتصيّد مخزّن / data:text/html بسكربتات) وتُعرض في الواجهة كرابط قابل للنقر
    var isAllowedDataUrl = /^data:(image\/(png|jpe?g|gif|webp)|application\/pdf|application\/(vnd\.openxmlformats-officedocument\.wordprocessingml\.document|msword));base64,[A-Za-z0-9+/=]+$/.test(url)
    var isAllowedHttpsUrl = /^https:\/\/[A-Za-z0-9.-]+(\/[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]*)?$/.test(url)
    if (!isAllowedDataUrl && !isAllowedHttpsUrl) {
      return NextResponse.json(
        { error: 'invalid_url', message: 'المرفق يجب أن يكون ملفاً (صورة/PDF/Word) بصيغة data أو رابط https آمن' },
        { status: 400 }
      )
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
          // SECURITY FIX: الحجم يُحسب من الخادم دائماً — كان يُقبل من العميل (قيم مزورة)
          size: Buffer.byteLength(url, 'utf8'),
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

