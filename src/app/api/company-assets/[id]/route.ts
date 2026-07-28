import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { safeDbOp, handleDbError, buildAuditDetails } from '@/lib/api-helpers'

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

    // Fetch old data before update
    const oldAsset = await safeDbOp(
      () => db.companyAsset.findUnique({ where: { id } }),
      'جلب الأصل القديم'
    )

    const updateResult = await safeDbOp(
      () => db.companyAsset.update({
        where: { id },
        data: {
          name: String(body.name).trim(),
          itemType: String(body.itemType),
          quantity: body.quantity !== undefined ? parseInt(body.quantity) : undefined,
          ownership: String(body.ownership),
          supplier: body.supplier ? String(body.supplier).trim() : null,
          rentalCost: body.rentalCost !== undefined && body.rentalCost !== '' ? parseFloat(body.rentalCost) : null,
          rentalStart: body.rentalStart ? new Date(body.rentalStart) : null,
          rentalEnd: body.rentalEnd ? new Date(body.rentalEnd) : null,
          responsibleId: body.responsibleId || null,
          projectId: body.projectId || null,
          status: String(body.status),
          notes: body.notes ? String(body.notes) : null,
        },
      }),
      'تحديث الأصل'
    )
    if (!updateResult.success) return updateResult.response

    // Build detailed changes diff
    const details = oldAsset.success && oldAsset.data
      ? buildAuditDetails(
          {
            ...oldAsset.data,
            rentalStart: oldAsset.data.rentalStart?.toISOString?.()?.split('T')[0] || oldAsset.data.rentalStart,
            rentalEnd: oldAsset.data.rentalEnd?.toISOString?.()?.split('T')[0] || oldAsset.data.rentalEnd,
          },
          body,
          `تعديل أصل: ${updateResult.data.name}`,
          { skipFields: ['id', 'createdAt', 'updatedAt', 'projectId', 'responsibleId'] }
        )
      : `تعديل أصل: ${updateResult.data.name}`

    Promise.all([
      safeDbOp(
        () => db.auditLog.create({
          data: { userId: user.id, projectId: updateResult.data.projectId, action: 'update', entity: 'company_asset', entityId: id, details },
        }),
        'سجل التدقيق'
      ),
    ]).catch(() => {})

    return NextResponse.json({ asset: updateResult.data, success: true })
  } catch (error: any) {
    return handleDbError(error, 'تحديث الأصل')
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

    const assetInfo = await safeDbOp(
      () => db.companyAsset.findUnique({ where: { id }, select: { projectId: true, name: true, ownership: true } }),
      'جلب بيانات الأصل'
    )

    const deleteResult = await safeDbOp(
      () => db.companyAsset.delete({ where: { id } }),
      'حذف الأصل'
    )
    if (!deleteResult.success) return deleteResult.response

    const projectId = assetInfo.success ? assetInfo.data?.projectId : null
    const assetDesc = assetInfo.success && assetInfo.data
      ? `${assetInfo.data.name} (${assetInfo.data.ownership})`
      : id

    Promise.all([
      safeDbOp(
        () => db.auditLog.create({
          data: { userId: user.id, projectId, action: 'delete', entity: 'company_asset', entityId: id, details: `حذف أصل: ${assetDesc}` },
        }),
        'سجل التدقيق'
      ),
      safeDbOp(
        () => db.notification.create({
          data: { projectId, type: 'equipment_breakdown', title: 'حذف أصل/مستأجر', message: `تم حذف: ${assetDesc} بواسطة ${user.name}`, severity: 'warning' },
        }),
        'إشعار الحذف'
      ),
    ]).catch(() => {})

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return handleDbError(error, 'حذف الأصل')
  }
}
