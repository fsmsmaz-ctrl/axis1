import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, safeDbOp } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  var user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  // Rate limit write operations
  var rl = checkRateLimit(req, RateLimitPresets.write)
  if (rl.limited) {
    return NextResponse.json(
      { error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار قليلاً' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    )
  }

  var { id } = await params

  // Only creator or system admin can record maintenance for this equipment
  var ADMIN_EMAIL = 'admin@axis.om'
  var isAdmin = user.email.toLowerCase().trim() === ADMIN_EMAIL
  if (!isAdmin) {
    var eqOwner = await safeDbOp(
      () => db.equipment.findUnique({ where: { id }, select: { createdById: true } }),
      'فحص ملكية المعدة'
    )
    if (!eqOwner.success || !eqOwner.data || eqOwner.data.createdById !== user.id) {
      return NextResponse.json({ error: 'forbidden', message: 'يمكنك فقط تسجيل صيانة للمعدات التي أنشأتها' }, { status: 403 })
    }
  }

  var body = await req.json()

  try {
    var maintenance = await safeDbOp(
      () => db.equipmentMaintenance.create({
        data: {
          equipmentId: id,
          date: new Date(body.date),
          type: body.type,
          description: body.description,
          cost: parseFloat(body.cost) || 0,
          partsUsed: body.partsUsed,
          performedById: user.id,
        },
      }),
      'إنشاء سجل الصيانة'
    )
    if (!maintenance.success) return maintenance.response

    var updateResult = await safeDbOp(
      () => db.equipment.update({
        where: { id },
        data: {
          lastMaintenance: new Date(body.date),
          status: body.setStatus || 'operational',
        },
      }),
      'تحديث حالة المعدة'
    )
    if (!updateResult.success) return updateResult.response

    return NextResponse.json({ maintenance: maintenance.data })
  } catch (error) {
    return handleDbError(error, 'إنشاء سجل الصيانة')
  }
}
