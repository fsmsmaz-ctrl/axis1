import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { SYSTEM_ADMIN_EMAIL, canWrite } from '@/lib/auth'
import { db } from '@/lib/db'
import { handleDbError, safeDbOp } from '@/lib/api-helpers'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser(req)
    if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
    const { id } = await params
    const result = await safeDbOp(
      () => db.finishing.findUnique({
        where: { id },
        include: { project: { select: { id: true, name: true, code: true, client: true } }, signedByUser: { select: { name: true, nameEn: true } }, submitter: { select: { name: true, nameEn: true } }, approver: { select: { name: true, nameEn: true } } },
      }),
      'جلب التشطيب'
    )
    if (!result.success) return result.response
    if (!result.data) return NextResponse.json({ error: 'not_found', message: 'التشطيب غير موجود' }, { status: 404 })
    return NextResponse.json({ finishing: result.data })
  } catch (error) {
    return handleDbError(error, 'جلب التشطيب')
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser(req)
    if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
    if (!canWrite(user.role, 'finishings', user.permissions)) {
      return NextResponse.json({ error: 'forbidden', message: 'لا تملك صلاحية لتعديل التشطيبات' }, { status: 403 })
    }
    const { id } = await params

    // جلب الحالة الحالية لفرض قواعد دورة الاعتماد
    const existingResult = await safeDbOp(
      () => db.finishing.findUnique({
        where: { id },
        select: { status: true, submittedById: true },
      }),
      'البحث عن التشطيب'
    )
    if (!existingResult.success) return existingResult.response
    const existing = existingResult.data
    if (!existing) return NextResponse.json({ error: 'not_found', message: 'التشطيب غير موجود' }, { status: 404 })

    var isSystemAdmin = (user.email || '').toLowerCase().trim() === SYSTEM_ADMIN_EMAIL
    var isSupervisor = user.role === 'foreman'

    // قواعد دورة الاعتماد الإدارية:
    //  - مرفوع للإدارة (submitted): مقفل بانتظار قرار الإدارة — لمدير النظام فقط
    //  - معتمد (approved): مقفل — لمدير النظام فقط
    //  - مرفوض (rejected): يفتح للمشرف (أو من رفعه) ليعدل ثم يعيد رفعه
    if (existing.status === 'submitted' && !isSystemAdmin) {
      return NextResponse.json({ error: 'locked', message: 'التشطيب مرفوع للإدارة وهو بانتظار الاعتماد أو الرفض — لا يمكن تعديله الآن' }, { status: 403 })
    }
    if (existing.status === 'approved' && !isSystemAdmin) {
      return NextResponse.json({ error: 'locked', message: 'التشطيب معتمد من الإدارة — التعديل متاح لمدير النظام فقط' }, { status: 403 })
    }
    if (existing.status === 'rejected' && !isSystemAdmin && !isSupervisor && existing.submittedById !== user.id) {
      return NextResponse.json({ error: 'forbidden', message: 'تعديل التشطيب المرفوع متاح للمشرف (الفورمان) الذي رفعه' }, { status: 403 })
    }

    const body = await req.json()
    const result = await safeDbOp(
      () => db.finishing.update({
        where: { id },
        data: {
          siteCleaned: !!body.siteCleaned, wasteRemoved: !!body.wasteRemoved, shaftClosed: !!body.shaftClosed,
          siteRestored: !!body.siteRestored, lineHandover: !!body.lineHandover,
          clientNotes: body.clientNotes, handoverStatus: body.handoverStatus,
          // التشطيب المرفوض يعود مسودة لدى المشرف بعد التعديل — يرفعه مجدداً بقرار الإدارة لاحقاً
          status: existing.status === 'rejected' ? 'draft' : existing.status,
        },
      }),
      'تحديث التشطيب'
    )
    if (!result.success) return result.response
    return NextResponse.json({ finishing: result.data })
  } catch (error) {
    return handleDbError(error, 'تحديث التشطيب')
  }
}

