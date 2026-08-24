import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, validateRequired, parseNumber, safeDbOp } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { canWrite } from '@/lib/auth'

// M-3 FIX: Max base64 image size (500KB = ~670K chars)
var MAX_IMAGE_SIZE = 700000

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })

  const searchParams = new URL(req.url).searchParams
  const projectId = searchParams.get('projectId')
  const ownership = searchParams.get('ownership')
  const where: any = {}
  if (projectId) where.projectId = projectId
  if (ownership) where.ownership = ownership

  const result = await safeDbOp(
    () => db.companyAsset.findMany({
      where, orderBy: { createdAt: 'desc' }, take: 200,
      include: { project: { select: { id: true, name: true, code: true } }, responsible: { select: { id: true, name: true, nameEn: true } }, createdBy: { select: { id: true, name: true } } },
    }), 'جلب الأصول والمستأجرات'
  )
  if (!result.success) return result.response

  const assets = result.data
  const ownedCount = assets.filter(function(a: any) { return a.ownership === 'owned' }).length
  const rentedCount = assets.filter(function(a: any) { return a.ownership === 'rented' }).length
  const borrowedCount = assets.filter(function(a: any) { return a.ownership === 'borrowed' }).length
  const totalRentalCost = assets.reduce(function(s: number, a: any) { return s + (a.rentalCost || 0) }, 0)

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

    // M-3 FIX: Validate image size
    var image = body.image ? String(body.image) : null
    if (image && image.length > MAX_IMAGE_SIZE) {
      return NextResponse.json({ error: 'invalid_value', message: 'حجم الصورة كبير جداً. الحد الأقصى 500 كيلوبايت.' }, { status: 400 })
    }
    if (image && !image.startsWith('data:image/')) {
      return NextResponse.json({ error: 'invalid_value', message: 'صيغة الصورة غير صحيحة' }, { status: 400 })
    }

    const createResult = await safeDbOp(
      () => db.companyAsset.create({
        data: { projectId: body.projectId || null, name: String(body.name).trim(), itemType: String(body.itemType), quantity: parseInt(body.quantity) || 1, ownership: String(body.ownership), supplier: body.supplier ? String(body.supplier).trim() : null, rentalCost: body.rentalCost ? parseFloat(body.rentalCost) : null, rentalStart: body.rentalStart ? new Date(body.rentalStart) : null, rentalEnd: body.rentalEnd ? new Date(body.rentalEnd) : null, responsibleId: body.responsibleId || null, status: String(body.status || 'available'), image, notes: body.notes ? String(body.notes) : null, createdById: user.id },
        include: { createdBy: { select: { id: true, name: true } } },
      }), 'إنشاء الأصل'
    )
    if (!createResult.success) return createResult.response

    safeDbOp(() => db.auditLog.create({ data: { userId: user.id, projectId: body.projectId, action: 'create', entity: 'company_asset', entityId: createResult.data.id, details: 'Added asset: ' + body.name } }), 'سجل التدقيق').catch(() => {})

    return NextResponse.json({ asset: createResult.data, success: true })
  } catch (error: any) {
    return handleDbError(error, 'إنشاء الأصل')
  }
}
