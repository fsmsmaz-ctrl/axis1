import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { safeDbOp, handleDbError, buildAuditDetails } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  var user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  var rl = checkRateLimit(req, RateLimitPresets.write)
  if (rl.limited) {
    return NextResponse.json(
      { error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار قليلاً' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    )
  }

  var { id } = await params

  try {
    var body = await req.json()

    // Check ownership: only creator or system admin can edit
    var ADMIN_EMAIL = 'admin@axis.om'
    var isAdmin = user.email.toLowerCase().trim() === ADMIN_EMAIL
    if (!isAdmin) {
      var ownerCheck = await safeDbOp(
        () => db.companyAsset.findUnique({ where: { id }, select: { createdById: true } }),
        'فحص ملكية الأصل'
      )
      if (!ownerCheck.success || !ownerCheck.data || ownerCheck.data.createdById !== user.id) {
        return NextResponse.json({ error: 'forbidden', message: 'يمكنك فقط تعديل الأصول التي أنشأتها' }, { status: 403 })
      }
    }

    var oldAsset = await safeDbOp(
      () => db.companyAsset.findUnique({ where: { id } }),
      'جلب الأصل القديم'
    )

    var updateResult = await safeDbOp(
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

    var details = oldAsset.success && oldAsset.data
      ? buildAuditDetails(
          {
            ...oldAsset.data,
            rentalStart: oldAsset.data.rentalStart && oldAsset.data.rentalStart.toISOString ? oldAsset.data.rentalStart.toISOString().split('T')[0] : oldAsset.data.rentalStart,
            rentalEnd: oldAsset.data.rentalEnd && oldAsset.data.rentalEnd.toISOString ? oldAsset.data.rentalEnd.toISOString().split('T')[0] : oldAsset.data.rentalEnd,
          },
          body,
          'تعديل أصل: ' + updateResult.data.name,
          { skipFields: ['id', 'createdAt', 'updatedAt', 'projectId', 'responsibleId'] }
        )
      : 'تعديل أصل: ' + updateResult.data.name

    Promise.all([
      safeDbOp(
        () => db.auditLog.create({
          data: { userId: user.id, projectId: updateResult.data.projectId, action: 'update', entity: 'company_asset', entityId: id, details },
        }),
        'سجل التدقيق'
      ),
    ]).catch(function() {})

    return NextResponse.json({ asset: updateResult.data, success: true })
  } catch (error: any) {
    return handleDbError(error, 'تحديث الأصل')
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

  var rl = checkRateLimit(req, RateLimitPresets.write)
  if (rl.limited) {
    return NextResponse.json(
      { error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار قليلاً' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    )
  }

  var { id } = await params

  try {
    // Check ownership: only creator or system admin can delete
    var ADMIN_EMAIL = 'admin@axis.om'
    var isAdmin = user.email.toLowerCase().trim() === ADMIN_EMAIL
    if (!isAdmin) {
      var ownerCheck = await safeDbOp(
        () => db.companyAsset.findUnique({ where: { id }, select: { createdById: true } }),
        'فحص ملكية الأصل'
      )
      if (!ownerCheck.success || !ownerCheck.data || ownerCheck.data.createdById !== user.id) {
        return NextResponse.json({ error: 'forbidden', message: 'يمكنك فقط حذف الأصول التي أنشأتها' }, { status: 403 })
      }
    }

    var assetInfo = await safeDbOp(
      () => db.companyAsset.findUnique({ where: { id }, select: { projectId: true, name: true, ownership: true } }),
      'جلب بيانات الأصل'
    )

    var deleteResult = await safeDbOp(
      () => db.companyAsset.delete({ where: { id } }),
      'حذف الأصل'
    )
    if (!deleteResult.success) return deleteResult.response

    var projectId = assetInfo.success ? assetInfo.data?.projectId : null
    var assetDesc = assetInfo.success && assetInfo.data
      ? assetInfo.data.name + ' (' + assetInfo.data.ownership + ')'
      : id

    Promise.all([
      safeDbOp(
        () => db.auditLog.create({
          data: { userId: user.id, projectId, action: 'delete', entity: 'company_asset', entityId: id, details: 'حذف أصل: ' + assetDesc },
        }),
        'سجل التدقيق'
      ),
      safeDbOp(
        () => db.notification.create({
          data: { projectId, type: 'equipment_breakdown', title: 'حذف أصل/مستأجر', message: 'تم حذف: ' + assetDesc + ' بواسطة ' + user.name, severity: 'warning' },
        }),
        'إشعار الحذف'
      ),
    ]).catch(function() {})

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return handleDbError(error, 'حذف الأصل')
  }
}
