import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, validateRequired, parseNumber, safeDbOp } from '@/lib/api-helpers'

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const projectId = searchParams.get('projectId')
  const ownership = searchParams.get('ownership')

  const where: any = {}
  if (projectId) where.projectId = projectId
  if (ownership) where.ownership = ownership

  const result = await safeDbOp(
    () => db.companyAsset.findMany({
      where,
      include: {
        project: { select: { id: true, name: true, code: true } },
        responsible: { select: { id: true, name: true, nameEn: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
    'جلب الأصول والمستأجرات'
  )

  if (!result.success) return result.response

  // Stats
  const assets = result.data
  const ownedCount = assets.filter((a: any) => a.ownership === 'owned').length
  const rentedCount = assets.filter((a: any) => a.ownership === 'rented').length
  const borrowedCount = assets.filter((a: any) => a.ownership === 'borrowed').length
  const totalRentalCost = assets.reduce((s: number, a: any) => s + (a.rentalCost || 0), 0)

  return NextResponse.json({
    assets,
    stats: { ownedCount, rentedCount, borrowedCount, totalRentalCost },
  })
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  try {
    const body = await req.json()

    const validationError = validateRequired(body, ['name', 'itemType', 'ownership'])
    if (validationError) return validationError

    const createResult = await safeDbOp(
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
        },
      }),
      'إنشاء الأصل'
    )
    if (!createResult.success) return createResult.response

    // Audit log + notification
    const ownershipLabels: Record<string, string> = {
      owned: 'ملك الشركة',
      rented: 'مستأجر',
      borrowed: 'معار',
    }
    const ownershipLabel = ownershipLabels[body.ownership] || body.ownership

    Promise.all([
      safeDbOp(
        () => db.auditLog.create({
          data: {
            userId: user.id,
            projectId: body.projectId,
            action: 'create',
            entity: 'company_asset',
            entityId: createResult.data.id,
            details: `Added asset: ${body.name} (${ownershipLabel}) x${body.quantity || 1}`,
          },
        }),
        'سجل التدقيق'
      ),
      safeDbOp(
        () => db.notification.create({
          data: {
            projectId: body.projectId,
            type: 'equipment_breakdown',
            title: `إضافة ${ownershipLabel}`,
            message: `تم إضافة: ${body.name} (${ownershipLabel}) ×${body.quantity || 1} بواسطة ${user.name}`,
            severity: body.ownership === 'rented' ? 'warning' : 'info',
          },
        }),
        'إشعار الإضافة'
      ),
    ]).catch(() => {})

    return NextResponse.json({ asset: createResult.data, success: true })
  } catch (error: any) {
    return handleDbError(error, 'إنشاء الأصل')
  }
}
