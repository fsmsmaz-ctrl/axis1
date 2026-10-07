import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { buildAuditDetails, safeDbOp, handleDbError, validImageDataUrl } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { canWrite, hasPermission } from '@/lib/auth'

var MAX_IMAGE_SIZE = 700000

// v74: جلب الأصل الكامل مع الصورة عند الطلب — القائمة خفيفة بلا صور (نمط v73)
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  var canRead = hasPermission(user.role, 'equipment', user.permissions, user.email)
    || hasPermission(user.role, 'costs', user.permissions, user.email)
  if (!canRead) {
    return NextResponse.json({ error: 'forbidden', message: 'لا تملك صلاحية عرض أصول الشركة' }, { status: 403 })
  }
  try {
    var { id } = await params
    var result = await safeDbOp(
      () => db.companyAsset.findUnique({
        where: { id },
        include: {
          project: { select: { id: true, name: true, code: true } },
          responsible: { select: { id: true, name: true, nameEn: true } },
          createdBy: { select: { id: true, name: true } },
          restoredBy: { select: { id: true, name: true } },
        },
      }), 'جلب الأصل'
    )
    if (!result.success) return result.response
    if (!result.data) return NextResponse.json({ error: 'not_found', message: 'الأصل غير موجود' }, { status: 404 })
    return NextResponse.json({ asset: result.data })
  } catch (error) {
    return handleDbError(error, 'جلب الأصل')
  }
}

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

    // v70: فحوصات الإدخال — الحقول الغائبة كانت تُخزن كنص «undefined» والأرقام السالبة تُقبل
    if (body.name !== undefined && !String(body.name).trim()) {
      return NextResponse.json({ error: 'invalid_input', message: 'اسم الأصل مطلوب' }, { status: 400 })
    }
    if (body.quantity !== undefined && body.quantity !== null && body.quantity !== '') {
      var qCheck = parseInt(body.quantity)
      if (!Number.isFinite(qCheck) || qCheck < 0) {
        return NextResponse.json({ error: 'invalid_input', message: 'الكمية يجب أن تكون رقماً غير سالب' }, { status: 400 })
      }
    }
    if (body.rentalCost !== undefined && body.rentalCost !== null && body.rentalCost !== '') {
      var rcCheck = parseFloat(body.rentalCost)
      if (!Number.isFinite(rcCheck) || rcCheck < 0) {
        return NextResponse.json({ error: 'invalid_input', message: 'تكلفة الإيجار يجب أن تكون رقماً غير سالب' }, { status: 400 })
      }
    }

    var updateData: any = {
      name: body.name !== undefined ? String(body.name).trim().slice(0, 200) : undefined, itemType: body.itemType !== undefined ? String(body.itemType).slice(0, 100) : undefined,
      quantity: body.quantity !== undefined ? parseInt(body.quantity) : undefined,
      ownership: body.ownership !== undefined ? String(body.ownership).slice(0, 50) : undefined, supplier: body.supplier ? String(body.supplier).trim() : null,
      rentalCost: body.rentalCost !== undefined && body.rentalCost !== '' ? parseFloat(body.rentalCost) : null,
      rentalStart: body.rentalStart ? new Date(body.rentalStart) : null,
      rentalEnd: body.rentalEnd ? new Date(body.rentalEnd) : null,
      responsibleId: body.responsibleId || null, projectId: body.projectId || null,
      status: body.status !== undefined ? String(body.status).slice(0, 50) : undefined, notes: body.notes ? String(body.notes).slice(0, 2000) : null,
    }
    if (body.hasOwnProperty('image')) {
      // v70: نفس فحص الصورة المعتاد — العمود أصبح موجوداً فعلاً الآن
      updateData.image = body.image ? validImageDataUrl(body.image) : null
    }

    // v22: جلب القيم القديمة لتوثيق التغييرات قبل ← الآن
    var oldAssetResult = await safeDbOp(() => db.companyAsset.findUnique({ where: { id } }), 'جلب الأصل قبل التعديل')
    var oldAsset = oldAssetResult.success && oldAssetResult.data ? oldAssetResult.data : null

    var updateResult = await safeDbOp(() => db.companyAsset.update({ where: { id }, data: updateData }), 'تحديث الأصل')
    if (!updateResult.success) return updateResult.response

    // v22: توثيق دقيق — القيمة قبل ← القيمة الآن
    safeDbOp(() => db.auditLog.create({ data: { userId: user.id, projectId: updateResult.data.projectId, action: 'update', entity: 'company_asset', entityId: id, details: oldAsset ? buildAuditDetails(oldAsset as unknown as Record<string, any>, updateData, 'تعديل أصل شركة: ' + updateResult.data.name, { skipFields: ['id', 'createdAt', 'updatedAt', 'projectId', 'cuid', 'image', 'responsibleId'] }) : ('تعديل أصل شركة: ' + updateResult.data.name) } }), 'سجل التدقيق').catch(() => {})

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
    // v70: فحص الوجود — 404 صادقة بدل 500 مضلل
    var delTarget = await safeDbOp(() => db.companyAsset.findUnique({ where: { id }, select: { id: true } }), 'فحص الأصل')
    if (!delTarget.success) return delTarget.response
    if (!delTarget.data) return NextResponse.json({ error: 'not_found', message: 'الأصل غير موجود' }, { status: 404 })
    var deleteResult = await safeDbOp(() => db.companyAsset.delete({ where: { id } }), 'حذف الأصل')
    if (!deleteResult.success) return deleteResult.response
    return NextResponse.json({ success: true })
  } catch (error: any) {
    return handleDbError(error, 'حذف الأصل')
  }
}

