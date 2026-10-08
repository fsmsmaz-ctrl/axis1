import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, validateRequired, parseNumber, safeDbOp, validImageDataUrl } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { canWrite, hasPermission, normalizeRole } from '@/lib/auth'
import { ensureCompanyAssetFk, ensureCompanyAssetRestoreMeta, ensureMediaSupport, ensureEquipmentLogSupport } from '@/lib/db-selfheal'
import { logAssetChange } from '@/lib/api-helpers'

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })

  // SECURITY FIX: القائمة تتضمن تكاليف الإيجار والموردين (بيانات مالية) — بوابة قراءة
  var canRead = hasPermission(user.role, 'equipment', user.permissions, user.email)
    || hasPermission(user.role, 'costs', user.permissions, user.email)
  if (!canRead) {
    return NextResponse.json({ error: 'forbidden', message: 'لا تملك صلاحية عرض أصول الشركة' }, { status: 403 })
  }

  // v42: شفاء ذاتي — تأكد أن أصول الشركة تنجو من حذف المشاريع (نمط v32 للفواتير)
  await ensureCompanyAssetFk()

  // v44: شفاء ذاتي — تأكد من وجود أعمدة الاستعادة قبل أي قراءة (restoredBy في include)
  // يعالج خطأ «قاعدة البيانات غير مهيأة» عندما لا تكون التراخيم مطبقة بعد
  await ensureCompanyAssetRestoreMeta()

  const searchParams = new URL(req.url).searchParams
  const projectId = searchParams.get('projectId')
  const ownership = searchParams.get('ownership')
  const where: any = {}
  // v42: projectId=none → الأصول اليتيمة التي فقدت مشروعها بحذف المشروع
  if (projectId === 'none') where.projectId = null
  else if (projectId) where.projectId = projectId
  if (ownership) where.ownership = ownership

  // v74: إصلاح قنبلة الحمولة — القائمة كانت تُرسل صور الأصول (base64) مع كل سجل
  // (حتى 200 سجل × نحو 150KB ≈ عشرات الميغابايت). الآن: القائمة خفيفة بلا صور
  // + علم hasImage، والصورة تُجلب عند الطلب من GET /api/company-assets/[id]
  const result = await safeDbOp(
    () => db.companyAsset.findMany({
      where, orderBy: { createdAt: 'desc' }, take: 200,
      select: {
        id: true, projectId: true, name: true, itemType: true, quantity: true,
        ownership: true, supplier: true, rentalCost: true, rentalStart: true,
        rentalEnd: true, responsibleId: true, status: true, notes: true,
        createdById: true, restoredById: true, restoredAt: true,
        createdAt: true, updatedAt: true,
        project: { select: { id: true, name: true, code: true } },
        responsible: { select: { id: true, name: true, nameEn: true } },
        createdBy: { select: { id: true, name: true } },
        restoredBy: { select: { id: true, name: true } },
      },
    }), 'جلب الأصول والمستأجرات'
  )
  if (!result.success) return result.response

  // v74: أي الأصول تملك صورة؟ — استعلام خفيف بالمعرفات فقط
  var rows: any[] = (result.data as any[]) || []
  var imgRows = rows.length > 0 ? await db.companyAsset.findMany({
    where: { id: { in: rows.map(function(a) { return a.id }) }, image: { not: null } },
    select: { id: true },
  }) : []
  var imgSet = new Set(imgRows.map(function(r) { return r.id }))
  const assets = rows.map(function(a) {
    return Object.assign({}, a, { hasImage: imgSet.has(a.id) })
  })
  const ownedCount = assets.filter(function(a: any) { return a.ownership === 'owned' }).length
  const rentedCount = assets.filter(function(a: any) { return a.ownership === 'rented' }).length
  const borrowedCount = assets.filter(function(a: any) { return a.ownership === 'borrowed' }).length
  var totalRentalCost = assets.reduce(function(s: number, a: any) { return s + (a.rentalCost || 0) }, 0)

  // v83: أُلغي تعقيم قيم الإيجار عن مسؤول السلامة — قرار صاحب الموقع:
  // مَن يسجّل معدة/أصلاً يُدخل كافة بياناتها ومن ضمنها الأسعار، والمساءلة عبر المفكرة

  return NextResponse.json({ assets, stats: { ownedCount, rentedCount, borrowedCount, totalRentalCost } })
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  if (!canWrite(user.role, 'company_assets', user.permissions)) {
    return NextResponse.json({ error: 'forbidden', message: 'لا تملك صلاحية لإضافة أصول' }, { status: 403 })
  }

  var rl = checkRateLimit(req, RateLimitPresets.write)
  if (rl.limited) return NextResponse.json({ error: 'too_many_requests', message: 'طلبات كثيرة جداً' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })

  try {
    const body = await req.json()
    const validationError = validateRequired(body, ['name', 'itemType', 'ownership'])
    if (validationError) return validationError

    // v83: أُلغي شطب حقول الإيجار من طلبات أدوار «الإنشاء فقط» — قرار صاحب الموقع:
    // مَن يسجّل الأصل يُدخل كافة بياناته ومن ضمنها الأسعار، والمساءلة عبر المفكرة

    // v43: الاستعادة تحافظ على هوية الأصل الأصلي — نفس تاريخ التسجيل واسم منشئه الأصلي،
    // ومن أجرى الاستعادة يُسجَّل في حقول منفصلة (restoredBy/restoredAt) لا تحل محل المنشئ الأصلي أبداً.
    var restoreMeta: { createdAt: Date; createdById: string | null } | null = null
    var isRestorer = normalizeRole(user.role) === 'top_management' || normalizeRole(user.role) === 'project_manager' || user.isSystemAdmin === true
    if (isRestorer && body.restore && typeof body.restore === 'object') {
      var origDate = new Date(String(body.restore.originalCreatedAt || ''))
      if (!isNaN(origDate.getTime()) && origDate.getTime() < Date.now()) {
        restoreMeta = { createdAt: origDate, createdById: null }
        var origCreatorId = body.restore.originalCreatedById ? String(body.restore.originalCreatedById) : ''
        if (origCreatorId) {
          var origCreator = await safeDbOp(() => db.user.findUnique({ where: { id: origCreatorId }, select: { id: true } }), 'التحقق من المنشئ الأصلي')
          if (origCreator.success && origCreator.data) restoreMeta.createdById = origCreatorId
        }
      }
    }

    // v44: شفاء ذاتي قبل الإنشاء — الأعمدة restoredById/restoredAt يجب أن تكون موجودة
    await ensureCompanyAssetRestoreMeta()
    // v70: عمود الصورة إن لم يوجد
    await ensureMediaSupport()
    // v83: شفاء جدول المفكرة الموحدة قبل أي كتابة فيها
    await ensureEquipmentLogSupport()

    const createResult = await safeDbOp(
      () => db.companyAsset.create({
        data: { projectId: body.projectId || null, name: String(body.name).trim(), itemType: String(body.itemType), quantity: parseInt(body.quantity) || 1, ownership: String(body.ownership), supplier: body.supplier ? String(body.supplier).trim() : null, rentalCost: body.rentalCost ? parseFloat(body.rentalCost) : null, rentalStart: body.rentalStart ? new Date(body.rentalStart) : null, rentalEnd: body.rentalEnd ? new Date(body.rentalEnd) : null, responsibleId: body.responsibleId || null, status: String(body.status || 'available'), notes: body.notes ? String(body.notes).slice(0, 2000) : null, createdAt: restoreMeta ? restoreMeta.createdAt : undefined, createdById: restoreMeta ? restoreMeta.createdById : user.id, restoredById: restoreMeta ? user.id : null, restoredAt: restoreMeta ? new Date() : null, image: validImageDataUrl(body.image) },
        include: { createdBy: { select: { id: true, name: true } }, restoredBy: { select: { id: true, name: true } } },
      }), 'إنشاء الأصل'
    )
    if (!createResult.success) return createResult.response

    safeDbOp(() => db.auditLog.create({ data: { userId: user.id, projectId: body.projectId, action: 'create', entity: 'company_asset', entityId: createResult.data.id, details: 'Added asset: ' + body.name } }), 'سجل التدقيق').catch(() => {})

    // v83: الأصل الجديد في مفكرة المعدات الموحدة — باسم مَن سجّله وتوقيته
    var v83OwnAr = String(body.ownership) === 'owned' ? 'ملك الشركة' : String(body.ownership) === 'rented' ? 'مستأجر' : 'معار'
    var v83OwnEn = String(body.ownership) === 'owned' ? 'Company Owned' : String(body.ownership) === 'rented' ? 'Rented' : 'Borrowed'
    if (restoreMeta) {
      await logAssetChange({
        assetId: createResult.data.id, assetName: createResult.data.name, user,
        action: 'restore',
        changesAr: 'أعاد إنشاء الأصل «' + createResult.data.name + '» من سجل التدقيق (نوع الملكية: ' + v83OwnAr + ') — حُفظ تاريخ التسجيل واسم المنشئ الأصلي',
        changesEn: 'Re-created asset "' + createResult.data.name + '" from the audit log (' + v83OwnEn + ') — original date and creator preserved',
      })
    } else {
      await logAssetChange({
        assetId: createResult.data.id, assetName: createResult.data.name, user,
        action: 'create',
        changesAr: 'سجّل أصلاً جديداً «' + createResult.data.name + '» (نوع الملكية: ' + v83OwnAr + ')',
        changesEn: 'Registered new asset "' + createResult.data.name + '" (' + v83OwnEn + ')',
      })
    }

    return NextResponse.json({ asset: createResult.data, success: true })
  } catch (error: any) {
    return handleDbError(error, 'إنشاء الأصل')
  }
}
