import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, validateRequired, parseNumber, safeDbOp, buildAuditDetails } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  var user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  // Rate limit write operations
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

    var validationError = validateRequired(body, ['date', 'category', 'description', 'amount'])
    if (validationError) return validationError

    // Fetch old data before update
    var oldCost = await safeDbOp(
      () => db.cost.findUnique({ where: { id } }),
      'جلب التكلفة القديمة'
    )

    var updateResult = await safeDbOp(
      () => db.cost.update({
        where: { id },
        data: {
          date: new Date(body.date),
          category: String(body.category),
          description: String(body.description),
          amount: parseNumber(body.amount, 0),
          notes: body.notes ? String(body.notes) : null,
          projectId: body.projectId ? String(body.projectId) : undefined,
        },
      }),
      'تحديث التكلفة'
    )
    if (!updateResult.success) return updateResult.response

    // Build detailed changes diff
    var details = oldCost.success && oldCost.data
      ? buildAuditDetails(
          { ...oldCost.data, date: oldCost.data.date && oldCost.data.date.toISOString ? oldCost.data.date.toISOString().split('T')[0] : oldCost.data.date },
          { ...body, amount: parseNumber(body.amount, 0) },
          'تعديل تكلفة: ' + body.category + ' - ' + body.description,
          { skipFields: ['id', 'createdAt', 'updatedAt', 'projectId', 'dailyReportId', 'recordedById'] }
        )
      : 'تعديل تكلفة: ' + body.category + ' - ' + body.description + ' (' + body.amount + ' ر.ع)'

    Promise.all([
      safeDbOp(
        () => db.auditLog.create({
          data: { userId: user.id, projectId: updateResult.data.projectId, action: 'update', entity: 'cost', entityId: id, details },
        }),
        'سجل التدقيق'
      ),
      safeDbOp(
        () => db.notification.create({
          data: {
            projectId: updateResult.data.projectId,
            type: 'cost_overrun',
            title: 'تعديل تكلفة',
            message: 'تم تعديل تكلفة: ' + body.category + ' - ' + body.description + ' بمبلغ ' + body.amount + ' ر.ع',
            severity: 'info',
          },
        }),
        'إشعار التعديل'
      ),
    ]).catch(function() {})

    return NextResponse.json({ cost: updateResult.data, success: true })
  } catch (error: any) {
    return handleDbError(error, 'تحديث التكلفة')
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  var user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  // Rate limit write operations
  var rl = checkRateLimit(req, RateLimitPresets.write)
  if (rl.limited) {
    return NextResponse.json(
      { error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار قليلاً' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    )
  }

  try {
    var { id } = await params

    var costInfo = await safeDbOp(
      () => db.cost.findUnique({ where: { id }, select: { projectId: true, category: true, description: true, amount: true } }),
      'جلب بيانات التكلفة'
    )

    var deleteResult = await safeDbOp(
      () => db.cost.delete({ where: { id } }),
      'حذف التكلفة'
    )
    if (!deleteResult.success) return deleteResult.response

    var projectId = costInfo.success ? costInfo.data?.projectId : null
    var costDesc = costInfo.success && costInfo.data
      ? costInfo.data.category + ' - ' + costInfo.data.description + ' (' + costInfo.data.amount + ' ر.ع)'
      : id

    Promise.all([
      safeDbOp(
        () => db.auditLog.create({
          data: { userId: user.id, projectId, action: 'delete', entity: 'cost', entityId: id, details: 'حذف تكلفة: ' + costDesc },
        }),
        'سجل التدقيق'
      ),
      safeDbOp(
        () => db.notification.create({
          data: { projectId, type: 'cost_overrun', title: 'حذف تكلفة', message: 'تم حذف: ' + costDesc + ' بواسطة ' + user.name, severity: 'warning' },
        }),
        'إشعار الحذف'
      ),
    ]).catch(function() {})

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return handleDbError(error, 'حذف التكلفة')
  }
}
