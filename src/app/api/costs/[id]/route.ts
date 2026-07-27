import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, validateRequired, parseNumber, safeDbOp } from '@/lib/api-helpers'

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

    // Audit log + notification (non-critical, fire-and-forget)
    Promise.all([
      safeDbOp(
        () => db.auditLog.create({
          data: {
            userId: user.id,
            projectId: updateResult.data.projectId,
            action: 'update',
            entity: 'cost',
            entityId: id,
            details: `Updated cost: ${body.category} - ${body.description} (${body.amount} OMR)`,
          },
        }),
        'سجل التدقيق'
      ),
      safeDbOp(
        () => db.notification.create({
          data: {
            projectId: updateResult.data.projectId,
            type: 'cost_overrun',
            title: 'تعديل تكلفة',
            message: `تم تعديل تكلفة: ${body.category} - ${body.description} بمبلغ ${body.amount} ريال عماني`,
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

    // Get cost info before deleting
    const costInfo = await safeDbOp(
      () => db.cost.findUnique({ where: { id }, select: { projectId: true, category: true, description: true, amount: true } }),
      'جلب بيانات التكلفة'
    )

    const deleteResult = await safeDbOp(
      () => db.cost.delete({ where: { id } }),
      'حذف التكلفة'
    )
    if (!deleteResult.success) return deleteResult.response

    // Audit log + delete notification (non-critical, fire-and-forget)
    const projectId = costInfo.success ? costInfo.data?.projectId : null
    const costDesc = costInfo.success && costInfo.data
      ? `${costInfo.data.category} - ${costInfo.data.description} (${costInfo.data.amount} OMR)`
      : id

    Promise.all([
      safeDbOp(
        () => db.auditLog.create({
          data: {
            userId: user.id,
            projectId,
            action: 'delete',
            entity: 'cost',
            entityId: id,
            details: `Deleted cost: ${costDesc}`,
          },
        }),
        'سجل التدقيق'
      ),
      safeDbOp(
        () => db.notification.create({
          data: {
            projectId,
            type: 'cost_overrun',
            title: 'حذف تكلفة',
            message: `تم حذف تكلفة: ${costDesc} بواسطة ${user.name}`,
            severity: 'warning',
          },
        }),
        'إشعار الحذف'
      ),
    ]).catch(() => {})

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return handleDbError(error, 'حذف التكلفة')
  }
}
