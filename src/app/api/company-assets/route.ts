import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, validateRequired, parseNumber, safeDbOp } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'

export async function GET(req: NextRequest) {
  var user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  var searchParams = new URL(req.url).searchParams
  var projectId = searchParams.get('projectId')
  var ownership = searchParams.get('ownership')

  var where: any = {}
  if (projectId) where.projectId = projectId
  if (ownership) where.ownership = ownership

  var result = await safeDbOp(
    () => db.companyAsset.findMany({
      where,
      include: {
        project: { select: { id: true, name: true, code: true } },
        responsible: { select: { id: true, name: true, nameEn: true } },
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
    'جلب الأصول والمستأجرات'
  )

  if (!result.success) return result.response

  var assets = result.data
  var ownedCount = assets.filter(function(a: any) { return a.ownership === 'owned' }).length
  var rentedCount = assets.filter(function(a: any) { return a.ownership === 'rented' }).length
  var borrowedCount = assets.filter(function(a: any) { return a.ownership === 'borrowed' }).length
  var totalRentalCost = assets.reduce(function(s: number, a: any) { return s + (a.rentalCost || 0) }, 0)

  return NextResponse.json({
    assets,
    stats: { ownedCount, rentedCount, borrowedCount, totalRentalCost },
  })
}

export async function POST(req: NextRequest) {
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

  try {
    var body = await req.json()

    var validationError = validateRequired(body, ['name', 'itemType', 'ownership'])
    if (validationError) return validationError

    var createResult = await safeDbOp(
      () => db.companyAsset.create({
        data: {
          projectId: body.projectId || null,
          name: String(body.name).trim(),
          itemType: String(body.itemType),
          quantity: parseInt(body.quantity) || 1,
          ownership: String(body.ownership),
          supplier: body.supplier ? String(body.supplier).trim() : null,
          rentalCost: body.rentalCost ? parseFloat(body.rentalCost) : null,
          rentalStart: body.rentalStart ? new Date(body.rentalStart) : null,
          rentalEnd: body.rentalEnd ? new Date(body.rentalEnd) : null,
          responsibleId: body.responsibleId || null,
          status: String(body.status || 'available'),
          notes: body.notes ? String(body.notes) : null,
          createdById: user.id,
        },
        include: {
          createdBy: { select: { id: true, name: true } },
        },
      }),
      'إنشاء الأصل'
    )
    if (!createResult.success) return createResult.response

    var ownershipLabels: Record<string, string> = {
      owned: 'ملك الشركة',
      rented: 'مستأجر',
      borrowed: 'معار',
    }
    var ownershipLabel = ownershipLabels[body.ownership] || body.ownership

    Promise.all([
      safeDbOp(
        () => db.auditLog.create({
          data: {
            userId: user.id,
            projectId: body.projectId,
            action: 'create',
            entity: 'company_asset',
            entityId: createResult.data.id,
            details: 'Added asset: ' + body.name + ' (' + ownershipLabel + ') x' + (body.quantity || 1),
          },
        }),
        'سجل التدقيق'
      ),
      safeDbOp(
        () => db.notification.create({
          data: {
            projectId: body.projectId,
            type: 'equipment_breakdown',
            title: 'إضافة ' + ownershipLabel,
            message: 'تم إضافة: ' + body.name + ' (' + ownershipLabel + ') ×' + (body.quantity || 1) + ' بواسطة ' + user.name,
            severity: body.ownership === 'rented' ? 'warning' : 'info',
          },
        }),
        'إشعار الإضافة'
      ),
    ]).catch(function() {})

    return NextResponse.json({ asset: createResult.data, success: true })
  } catch (error: any) {
    return handleDbError(error, 'إنشاء الأصل')
  }
}
