import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, validateRequired, parseNumber, safeDbOp } from '@/lib/api-helpers'
import { canWrite } from '@/lib/auth'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'

var COST_CATEGORIES = ['labor', 'housing', 'transport', 'fuel', 'maintenance', 'parts', 'oil', 'safety', 'rental', 'other']

function validateAmount(raw: any): { ok: true; amount: number } | { ok: false; error: NextResponse } {
  var amount = parseNumber(raw, NaN)
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10000000) {
    return { ok: false, error: NextResponse.json(
      { error: 'invalid_amount', message: 'المبلغ يجب أن يكون رقماً موجباً ومعقولاً (أقل من 10,000,000)' },
      { status: 400 }
    ) }
  }
  return { ok: true, amount: amount }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  // v13.1 SECURITY: تعديل التكاليف للإدارة والمحاسب فقط
  if (!canWrite(user.role, 'costs', user.permissions)) {
    return NextResponse.json({ error: 'forbidden', message: 'تعديل التكاليف متاح للإدارة والمحاسب فقط' }, { status: 403 })
  }

  var rl = checkRateLimit(req, RateLimitPresets.write)
  if (rl.limited) {
    return NextResponse.json(
      { error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار قليلاً' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    )
  }

  try {
    const { id } = await params
    const body = await req.json()

    const validationError = validateRequired(body, ['date', 'category', 'description', 'amount'])
    if (validationError) return validationError

    // SECURITY FIX: التحقق من صحة المبلغ + قائمة سماح للتصنيف
    var amountCheck = validateAmount(body.amount)
    if (!amountCheck.ok) return amountCheck.error
    var validAmount = amountCheck.amount

    var category = String(body.category)
    if (COST_CATEGORIES.indexOf(category) === -1) category = 'other'

    // SECURITY FIX: جلب القيمة القديمة أولاً لتوثيق التغيير في سجل التدقيق
    var existing = await safeDbOp(() => db.cost.findUnique({ where: { id } }), 'جلب التكلفة')
    if (!existing.success) return existing.response
    if (!existing.data) {
      return NextResponse.json({ error: 'not_found', message: 'التكلفة غير موجودة' }, { status: 404 })
    }

    const updateResult = await safeDbOp(
      () => db.cost.update({
        where: { id },
        data: {
          date: new Date(body.date),
          category: category,
          description: String(body.description).slice(0, 1000),
          amount: validAmount,
          notes: body.notes ? String(body.notes).slice(0, 2000) : null,
          projectId: body.projectId ? String(body.projectId) : undefined,
        },
      }),
      'تحديث التكلفة'
    )
    if (!updateResult.success) return updateResult.response

    // SECURITY FIX: كان التعديل صامتاً كلياً — أُضيف سجل تدقيق يوثق القيم قبل/بعد
    await safeDbOp(
      () => db.auditLog.create({
        data: {
          userId: user!.id,
          projectId: updateResult.data!.projectId,
          action: 'update',
          entity: 'cost',
          entityId: id,
          details: JSON.stringify({
            summary: 'تعديل تكلفة: ' + category + ' - ' + String(body.description).slice(0, 100),
            changes: [
              { field: 'المبلغ', fieldEn: 'Amount', old: String(existing.data!.amount), new: String(validAmount) },
              { field: 'التصنيف', fieldEn: 'Category', old: String(existing.data!.category), new: category },
              { field: 'الوصف', fieldEn: 'Description', old: String(existing.data!.description), new: String(body.description).slice(0, 100) },
            ],
          }),
        },
      }),
      'سجل التدقيق'
    )

    return NextResponse.json({ cost: updateResult.data, success: true })
  } catch (error: any) {
    return handleDbError(error, 'تحديث التكلفة')
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  // v13.1 SECURITY: حذف التكاليف للإدارة والمحاسب فقط
  if (!canWrite(user.role, 'costs', user.permissions)) {
    return NextResponse.json({ error: 'forbidden', message: 'حذف التكاليف متاح للإدارة والمحاسب فقط' }, { status: 403 })
  }

  var rl = checkRateLimit(req, RateLimitPresets.write)
  if (rl.limited) {
    return NextResponse.json(
      { error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار قليلاً' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    )
  }

  try {
    const { id } = await params

    // SECURITY FIX: توثيق التكلفة المحذوفة في سجل التدقيق قبل الحذف
    var existing = await safeDbOp(() => db.cost.findUnique({ where: { id } }), 'جلب التكلفة')
    if (!existing.success) return existing.response
    if (!existing.data) {
      return NextResponse.json({ error: 'not_found', message: 'التكلفة غير موجودة' }, { status: 404 })
    }

    const deleteResult = await safeDbOp(
      () => db.cost.delete({ where: { id } }),
      'حذف التكلفة'
    )
    if (!deleteResult.success) return deleteResult.response

    await safeDbOp(
      () => db.auditLog.create({
        data: {
          userId: user!.id,
          projectId: existing.data!.projectId,
          action: 'delete',
          entity: 'cost',
          entityId: id,
          details: 'حذف تكلفة: ' + existing.data!.category + ' - ' + existing.data!.description + ' (' + existing.data!.amount + ' OMR)',
        },
      }),
      'سجل التدقيق'
    )

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return handleDbError(error, 'حذف التكلفة')
  }
}
