import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, validateRequired, parseNumber, safeDbOp, buildAuditDetails } from '@/lib/api-helpers'

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  try {
    const { id } = await params
    const body = await req.json()

    const validationError = validateRequired(body, ['date', 'category', 'description', 'amount'])
    if (validationError) return validationError

    // Fetch old data before update
    const oldCost = await safeDbOp(
      () => db.cost.findUnique({ where: { id } }),
      'جلب التكلفة القديمة'
    )

    const updateResult = await safeDbOp(
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
    const details = oldCost.success && oldCost.data
      ? buildAuditDetails(
          { ...oldCost.data, date: oldCost.data.date?.toISOString?.()?.split('T')[0] || oldCost.data.date },
          { ...body, amount: parseNumber(body.amount, 0) },
          `تعديل تكلفة: ${body.category} - ${body.description}`,
          { skipFields: ['id', 'createdAt', 'updatedAt', 'projectId', 'dailyReportId', 'recordedById'] }
        )
      : `تعديل تكلفة: ${body.category} - ${body.description} (${body.amount} ر.ع)`

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
            message: `تم تعديل تكلفة: ${body.category} - ${body.description} بمبلغ ${body.amount} ر.ع`,
            severity: 'info',
          },
        }),
        'إشعار التعديل'
      ),
    ]).catch(() => {})

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

  try {
    const { id } = await params

    const costInfo = await safeDbOp(
      () => db.cost.findUnique({ where: { id }, select: { projectId: true, category: true, description: true, amount: true } }),
      'جلب بيانات التكلفة'
    )

    const deleteResult = await safeDbOp(
      () => db.cost.delete({ where: { id } }),
      'حذف التكلفة'
    )
    if (!deleteResult.success) return deleteResult.response

    const projectId = costInfo.success ? costInfo.data?.projectId : null
    const costDesc = costInfo.success && costInfo.data
      ? `${costInfo.data.category} - ${costInfo.data.description} (${costInfo.data.amount} ر.ع)`
      : id

    Promise.all([
      safeDbOp(
        () => db.auditLog.create({
          data: { userId: user.id, projectId, action: 'delete', entity: 'cost', entityId: id, details: `حذف تكلفة: ${costDesc}` },
        }),
        'سجل التدقيق'
      ),
      safeDbOp(
        () => db.notification.create({
          data: { projectId, type: 'cost_overrun', title: 'حذف تكلفة', message: `تم حذف: ${costDesc} بواسطة ${user.name}`, severity: 'warning' },
        }),
        'إشعار الحذف'
      ),
    ]).catch(() => {})

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return handleDbError(error, 'حذف التكلفة')
  }
}
