import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { buildAuditDetails, getChangesDiff, safeDbOp, handleDbError, validImageDataUrl, logAssetChange } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { hasPermission, canModifyCompanyAsset, canEditAnyCompanyAsset } from '@/lib/auth'
import { ensureEquipmentLogSupport } from '@/lib/db-selfheal'

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
    // v84: سجل هذا الأصل الكامل يُعاد مع تفاصيله — نقاط التغييرات باسم أصحابها
    // متاحة لكل من يعرض الأصل (ضمان حقوق الجميع) بينما المفكرة الموحدة لمدير النظام
    var v84Logs: any[] = []
    try {
      await ensureEquipmentLogSupport()
      v84Logs = await db.equipmentLog.findMany({
        where: { assetId: id },
        orderBy: { createdAt: 'desc' },
        take: 15,
        select: { id: true, action: true, changesAr: true, changesEn: true, userName: true, userNameEn: true, createdAt: true },
      })
    } catch { v84Logs = [] }
    return NextResponse.json({ asset: result.data, logs: v84Logs })
  } catch (error) {
    return handleDbError(error, 'جلب الأصل')
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })

  var { id } = await params

  // v84 (قرار صاحب الموقع): أي أصل سجّله أي موظف يمكن لأي موظف آخر تعديل
  // بياناته — كل من يجتاز فحص الكتابة على أصول الشركة يعدّل أي أصل، وكل تعديل
  // يُسجَّل على الأصل نفسه (السجل المصغر بنقاط صغيرة) وباسم صاحبه وتوقيته
  if (!canEditAnyCompanyAsset(user)) {
    return NextResponse.json({ error: 'forbidden', message: 'لا تملك صلاحية لتعديل أصول الشركة' }, { status: 403 })
  }

  var rl = checkRateLimit(req, RateLimitPresets.write)
  if (rl.limited) return NextResponse.json({ error: 'too_many_requests', message: 'طلبات كثيرة جداً' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })

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
    // v83: أُلغي شطب حقول الإيجار من طلبات أدوار «الإنشاء فقط» — قرار صاحب الموقع:
    // مَن سجّل الأصل يُدخل كافة بياناته ومن ضمنها الأسعار، والمساءلة عبر المفكرة
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

    // v83: التعديل في مفكرة المعدات الموحدة — «أي تغيّر يظهر في السجل في الأسفل»
    if (oldAsset) {
      var v83Diff = getChangesDiff(oldAsset as unknown as Record<string, any>, updateData, { skipFields: ['id', 'createdAt', 'updatedAt', 'projectId', 'cuid', 'image', 'responsibleId'] })
      if (v83Diff.changes.length > 0) {
        var v83ArParts = v83Diff.changes.map(function(c) { return c.field + ': من «' + c.old + '» إلى «' + c.new + '»' })
        var v83EnParts = v83Diff.changes.map(function(c) { return c.fieldEn + ': from "' + c.old + '" to "' + c.new + '"' })
        await logAssetChange({
          assetId: id, assetName: updateResult.data.name, user,
          action: 'update',
          changesAr: 'عدّل بيانات الأصل «' + updateResult.data.name + '» — ' + v83ArParts.join('؛ '),
          changesEn: 'Updated asset "' + updateResult.data.name + '" — ' + v83EnParts.join('; '),
        })
      }
    }

    return NextResponse.json({ asset: updateResult.data, success: true })
  } catch (error: any) {
    return handleDbError(error, 'تحديث الأصل')
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  // v82: الحذف محجوب عن أدوار «الإنشاء فقط» — v83: بوابة المُنشئ تخوّل التعديل فقط، والحذف للإدارة حصراً
  if (!canModifyCompanyAsset(user)) {
    return NextResponse.json({ error: 'forbidden', message: 'لا تملك صلاحية لحذف الأصول — الحذف متاح للإدارة فقط' }, { status: 403 })
  }

  var rl = checkRateLimit(req, RateLimitPresets.write)
  if (rl.limited) return NextResponse.json({ error: 'too_many_requests', message: 'طلبات كثيرة جداً' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })

  var { id } = await params

  try {
    // v70: فحص الوجود — 404 صادقة بدل 500 مضلل
    // v83: الاسم يُجلب أيضاً لتسجيل الحذف في المفكرة
    var delTarget = await safeDbOp(() => db.companyAsset.findUnique({ where: { id }, select: { id: true, name: true, projectId: true } }), 'فحص الأصل')
    if (!delTarget.success) return delTarget.response
    if (!delTarget.data) return NextResponse.json({ error: 'not_found', message: 'الأصل غير موجود' }, { status: 404 })
    var deleteResult = await safeDbOp(() => db.companyAsset.delete({ where: { id } }), 'حذف الأصل')
    if (!deleteResult.success) return deleteResult.response

    // v83: حذف الأصل لم يكن يُسجل إطلاقاً — الآن في المفكرة الموحدة وسجل التدقيق
    // باسم مَن حذفه وتوقيته («أي تغيّر يظهر في السجل في الأسفل»)
    await ensureEquipmentLogSupport()
    var v83DelName = (delTarget.data as any).name || '—'
    await logAssetChange({
      assetId: id, assetName: v83DelName, user,
      action: 'delete',
      changesAr: 'حذف الأصل «' + v83DelName + '» نهائياً من النظام',
      changesEn: 'Permanently deleted asset "' + v83DelName + '"',
    })
    safeDbOp(() => db.auditLog.create({ data: { userId: user.id, projectId: (delTarget.data as any).projectId || null, action: 'delete', entity: 'company_asset', entityId: id, details: 'Deleted asset: ' + v83DelName } }), 'سجل التدقيق').catch(() => {})

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return handleDbError(error, 'حذف الأصل')
  }
}
