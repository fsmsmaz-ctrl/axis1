import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { safeDbOp, handleDbError } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { canWrite } from '@/lib/auth'

var MAX_IMAGE_SIZE = 700000

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  if (!canWrite(user.role, 'company_assets', user.permissions)) {
    return NextResponse.json({ error: 'forbidden', message: 'لا تملك صلاحية لتعديل الأصول' }, { status: 403 })
  }

  var rl = checkRateLimit(req, RateLimitPresets.write)
  if (rl.limited) return NextResponse.json({ error: 'too_many_requests', message: 'طلبات كثيرة جداً' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })

  var { id } = await params

  try {
    const body = await req.json()

    // M-3 FIX: Validate image size
    if (body.hasOwnProperty('image') && body.image) {
      var imageStr = String(body.image)
      if (imageStr.length > MAX_IMAGE_SIZE) {
        return NextResponse.json({ error: 'invalid_value', message: 'حجم الصورة كبير جداً. الحد الأقصى 500 كيلوبايت.' }, { status: 400 })
      }
      if (!imageStr.startsWith('data:image/')) {
        return NextResponse.json({ error: 'invalid_value', message: 'صيغة الصورة غير صحيحة' }, { status: 400 })
      }
    }

    var updateData: any = {
      name: String(body.name).trim(), itemType: String(body.itemType),
      quantity: body.quantity !== undefined ? parseInt(body.quantity) : undefined,
      ownership: String(body.ownership), supplier: body.supplier ? String(body.supplier).trim() : null,
      rentalCost: body.rentalCost !== undefined && body.rentalCost !== '' ? parseFloat(body.rentalCost) : null,
      rentalStart: body.rentalStart ? new Date(body.rentalStart) : null,
      rentalEnd: body.rentalEnd ? new Date(body.rentalEnd) : null,
      responsibleId: body.responsibleId || null, projectId: body.projectId || null,
      status: String(body.status), notes: body.notes ? String(body.notes) : null,
    }
    if (body.hasOwnProperty('image')) {
      updateData.image = body.image ? String(body.image) : null
    }

    var updateResult = await safeDbOp(() => db.companyAsset.update({ where: { id }, data: updateData }), 'تحديث الأصل')
    if (!updateResult.success) return updateResult.response

    safeDbOp(() => db.auditLog.create({ data: { userId: user.id, projectId: updateResult.data.projectId, action: 'update', entity: 'company_asset', entityId: id, details: 'Updated: ' + updateResult.data.name } }), 'سجل التدقيق').catch(() => {})

    return NextResponse.json({ asset: updateResult.data, success: true })
  } catch (error: any) {
    return handleDbError(error, 'تحديث الأصل')
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  if (!canWrite(user.role, 'company_assets', user.permissions)) {
    return NextResponse.json({ error: 'forbidden', message: 'لا تملك صلاحية لحذف الأصول' }, { status: 403 })
  }

  var rl = checkRateLimit(req, RateLimitPresets.write)
  if (rl.limited) return NextResponse.json({ error: 'too_many_requests', message: 'طلبات كثيرة جداً' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })

  var { id } = await params

  try {
    var deleteResult = await safeDbOp(() => db.companyAsset.delete({ where: { id } }), 'حذف الأصل')
    if (!deleteResult.success) return deleteResult.response
    return NextResponse.json({ success: true })
  } catch (error: any) {
    return handleDbError(error, 'حذف الأصل')
  }
}
