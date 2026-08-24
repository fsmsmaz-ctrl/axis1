import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, validateRequired, parseNumber, safeDbOp } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { canWrite } from '@/lib/auth'

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  if (!canWrite(user.role, 'costs', user.permissions)) {
    return NextResponse.json({ error: 'forbidden', message: 'لا تملك صلاحية لتعديل التكاليف' }, { status: 403 })
  }

  var rl = checkRateLimit(req, RateLimitPresets.write)
  if (rl.limited) return NextResponse.json({ error: 'too_many_requests', message: 'طلبات كثيرة جداً' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })

  try {
    var { id } = await params
    const body = await req.json()
    const validationError = validateRequired(body, ['date', 'category', 'description', 'amount'])
    if (validationError) return validationError

    // FIX-4.5: Wrapped in safeDbOp to prevent crash
    var existingResult = await safeDbOp(
      () => db.cost.findUnique({ where: { id }, select: { recordedById: true, projectId: true } }),
      'البحث عن التكلفة'
    )
    if (!existingResult.success) return existingResult.response
    var existing = existingResult.data
    if (!existing) return NextResponse.json({ error: 'not_found', message: 'التكلفة غير موجودة' }, { status: 404 })
    if (existing.recordedById !== user.id && user.role !== 'top_management' && user.role !== 'project_manager') {
      return NextResponse.json({ error: 'forbidden', message: 'يمكنك فقط تعديل التكاليف التي أنشأتها' }, { status: 403 })
    }

    var updateResult = await safeDbOp(
      () => db.cost.update({ where: { id }, data: { date: new Date(body.date), category: String(body.category), description: String(body.description), amount: parseNumber(body.amount, 0), notes: body.notes ? String(body.notes) : null, projectId: body.projectId ? String(body.projectId) : undefined } }),
      'تحديث التكلفة'
    )
    if (!updateResult.success) return updateResult.response
    return NextResponse.json({ cost: updateResult.data, success: true })
  } catch (error) {
    return handleDbError(error, 'تحديث التكلفة')
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  if (!canWrite(user.role, 'costs', user.permissions)) {
    return NextResponse.json({ error: 'forbidden', message: 'لا تملك صلاحية لحذف التكاليف' }, { status: 403 })
  }

  var rl = checkRateLimit(req, RateLimitPresets.write)
  if (rl.limited) return NextResponse.json({ error: 'too_many_requests', message: 'طلبات كثيرة جداً' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })

  try {
    var { id } = await params
    // FIX-4.5: Wrapped in safeDbOp to prevent crash
    var existingResult = await safeDbOp(
      () => db.cost.findUnique({ where: { id }, select: { recordedById: true, projectId: true, category: true, description: true, amount: true } }),
      'البحث عن التكلفة'
    )
    if (!existingResult.success) return existingResult.response
    var existing = existingResult.data
    if (!existing) return NextResponse.json({ error: 'not_found', message: 'التكلفة غير موجودة' }, { status: 404 })
    if (existing.recordedById !== user.id && user.role !== 'top_management' && user.role !== 'project_manager') {
      return NextResponse.json({ error: 'forbidden', message: 'يمكنك فقط حذف التكاليف التي أنشأتها' }, { status: 403 })
    }

    var deleteResult = await safeDbOp(() => db.cost.delete({ where: { id } }), 'حذف التكلفة')
    if (!deleteResult.success) return deleteResult.response

    Promise.all([
      safeDbOp(() => db.auditLog.create({ data: { userId: user.id, projectId: existing.projectId, action: 'delete', entity: 'cost', entityId: id, details: 'حذف: ' + existing.category + ' - ' + existing.description } }), 'سجل التدقيق'),
    ]).catch(function() {})

    return NextResponse.json({ success: true })
  } catch (error) {
    return handleDbError(error, 'حذف التكلفة')
  }
}
