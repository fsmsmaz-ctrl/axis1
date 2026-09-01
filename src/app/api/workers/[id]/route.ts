import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, safeDbOp } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  var user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  var userId = user.id

  var rl = checkRateLimit(req, RateLimitPresets.write)
  if (rl.limited) {
    return NextResponse.json(
      { error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار قليلاً' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    )
  }

  try {
    var { id } = await params
    var body = await req.json()

    var existingResult = await safeDbOp(
      () => db.worker.findUnique({ where: { id } }),
      'البحث عن العامل'
    )

    if (!existingResult.success) return existingResult.response
    if (!existingResult.data) {
      return NextResponse.json({ error: 'not_found', message: 'العامل غير موجود' }, { status: 404 })
    }

    var updateData: any = {}
    if (body.name !== undefined) updateData.name = body.name
    if (body.phone !== undefined) updateData.phone = body.phone
    if (body.contractorName !== undefined) updateData.contractorName = body.contractorName || null
    if (body.projectId !== undefined) updateData.projectId = body.projectId || null
    if (body.notes !== undefined) updateData.notes = body.notes || null

    var updateResult = await safeDbOp(
      () => db.worker.update({
        where: { id },
        data: updateData,
        include: {
          project: { select: { id: true, name: true, code: true } },
        },
      }),
      'تحديث بيانات العامل'
    )

    if (!updateResult.success) return updateResult.response

    // Audit log
    await safeDbOp(
      () => db.auditLog.create({
        data: {
          userId: userId,
          projectId: body.projectId || existingResult.data.projectId || null,
          action: 'update',
          entity: 'worker',
          entityId: id,
          details: 'Updated worker: ' + (body.name || existingResult.data.name),
        },
      }),
      'سجل التدقيق'
    )

    return NextResponse.json({ worker: updateResult.data })
  } catch (error: any) {
    return handleDbError(error, 'تحديث بيانات العامل')
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  var user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  var userId = user.id

  var rl = checkRateLimit(req, RateLimitPresets.write)
  if (rl.limited) {
    return NextResponse.json(
      { error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار قليلاً' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    )
  }

  try {
    var { id } = await params

    var existingResult = await safeDbOp(
      () => db.worker.findUnique({ where: { id } }),
      'البحث عن العامل'
    )

    if (!existingResult.success) return existingResult.response
    if (!existingResult.data) {
      return NextResponse.json({ error: 'not_found', message: 'العامل غير موجود' }, { status: 404 })
    }

    var deleteResult = await safeDbOp(
      () => db.worker.delete({ where: { id } }),
      'حذف العامل'
    )

    if (!deleteResult.success) return deleteResult.response

    // Audit log
    await safeDbOp(
      () => db.auditLog.create({
        data: {
          userId: userId,
          projectId: existingResult.data.projectId || null,
          action: 'delete',
          entity: 'worker',
          entityId: id,
          details: 'Deleted worker: ' + existingResult.data.name,
        },
      }),
      'سجل التدقيق'
    )

    return NextResponse.json({ message: 'تم حذف العامل بنجاح' })
  } catch (error: any) {
    return handleDbError(error, 'حذف العامل')
  }
}
