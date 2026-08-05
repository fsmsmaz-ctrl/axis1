import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { safeDbOp, buildAuditDetails, handleDbError } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  var user = await getAuthUser(req)
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  var { id } = await params
  var result = await safeDbOp(
    () => db.equipment.findUnique({
      where: { id },
      include: {
        project: { select: { id: true, name: true, code: true } },
        maintenance: { orderBy: { date: 'desc' }, take: 10 },
        createdBy: { select: { id: true, name: true } },
      },
    }),
    'جلب بيانات المعدة'
  )

  if (!result.success) return result.response
  if (!result.data) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  return NextResponse.json({ equipment: result.data })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  var user = await getAuthUser(req)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  var rl = checkRateLimit(req, RateLimitPresets.write)
  if (rl.limited) {
    return NextResponse.json(
      { error: 'too_many_requests', message: 'طلبات كثيرة جداً' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    )
  }

  var { id } = await params

  try {
    var body = await req.json()

    var ADMIN_EMAIL = 'admin@axis.om'
    var isAdmin = user.email.toLowerCase().trim() === ADMIN_EMAIL
    if (!isAdmin) {
      var ownerCheck = await safeDbOp(
        () => db.equipment.findUnique({ where: { id }, select: { createdById: true } }),
        'فحص ملكية المعدة'
      )
      if (!ownerCheck.success || !ownerCheck.data || ownerCheck.data.createdById !== user.id) {
        return NextResponse.json({ error: 'forbidden', message: 'يمكنك فقط تعديل المعدات التي أنشأتها' }, { status: 403 })
      }
    }

    var oldEq = await safeDbOp(
      () => db.equipment.findUnique({ where: { id } }),
      'جلب بيانات المعدة القديمة'
    )

    var updateResult = await safeDbOp(
      () => db.equipment.update({
        where: { id },
        data: {
          name: body.name,
          number: body.number,
          type: body.type,
          status: body.status,
          dailyHours: parseFloat(body.dailyHours) || 0,
          lastMaintenance: body.lastMaintenance ? new Date(body.lastMaintenance) : null,
          nextMaintenance: body.nextMaintenance ? new Date(body.nextMaintenance) : null,
          notes: body.notes,
          projectId: body.projectId || null,
        },
      }),
      'تحديث المعدة'
    )
    if (!updateResult.success) return updateResult.response

    var equipment = updateResult.data
    var oldForCompare = oldEq.success && oldEq.data ? {
      name: oldEq.data.name, number: oldEq.data.number, type: oldEq.data.type, status: oldEq.data.status,
      dailyHours: oldEq.data.dailyHours,
      lastMaintenance: oldEq.data.lastMaintenance && oldEq.data.lastMaintenance.toISOString ? oldEq.data.lastMaintenance.toISOString().split('T')[0] : oldEq.data.lastMaintenance,
      nextMaintenance: oldEq.data.nextMaintenance && oldEq.data.nextMaintenance.toISOString ? oldEq.data.nextMaintenance.toISOString().split('T')[0] : oldEq.data.nextMaintenance,
      notes: oldEq.data.notes,
    } : null

    var details = oldForCompare
      ? buildAuditDetails(oldForCompare, body, 'تعديل المعدة: ' + equipment.number + ' - ' + equipment.name, { skipFields: ['id', 'createdAt', 'updatedAt', 'projectId', 'breakdowns', 'spareParts'] })
      : 'تعديل المعدة: ' + equipment.number + ' - ' + equipment.name

    Promise.all([
      safeDbOp(() => db.auditLog.create({ data: { userId: user.id, projectId: equipment.projectId, action: 'update', entity: 'equipment', entityId: id, details } }), 'سجل التدقيق'),
      safeDbOp(() => db.notification.create({ data: { projectId: equipment.projectId, type: 'equipment_breakdown', title: 'تعديل معدة', message: 'تم تعديل بيانات المعدة: ' + equipment.number + ' - ' + equipment.name + ' بواسطة ' + user.name, severity: 'info' } }), 'إشعار التعديل'),
    ]).catch(function() {})

    return NextResponse.json({ equipment })
  } catch (error) {
    return handleDbError(error, 'تحديث المعدة')
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  var user = await getAuthUser(req)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  var rl = checkRateLimit(req, RateLimitPresets.write)
  if (rl.limited) {
    return NextResponse.json(
      { error: 'too_many_requests', message: 'طلبات كثيرة جداً' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    )
  }

  var { id } = await params

  try {
    var ADMIN_EMAIL = 'admin@axis.om'
    var isAdmin = user.email.toLowerCase().trim() === ADMIN_EMAIL
    if (!isAdmin) {
      var ownerCheck = await safeDbOp(
        () => db.equipment.findUnique({ where: { id }, select: { createdById: true } }),
        'فحص ملكية المعدة'
      )
      if (!ownerCheck.success || !ownerCheck.data || ownerCheck.data.createdById !== user.id) {
        return NextResponse.json({ error: 'forbidden', message: 'يمكنك فقط حذف المعدات التي أنشأتها' }, { status: 403 })
      }
    }

    await safeDbOp(
      () => db.equipmentMaintenance.deleteMany({ where: { equipmentId: id } }),
      'حذف سجلات الصيانة'
    )

    var eqInfo = await safeDbOp(
      () => db.equipment.findUnique({ where: { id }, select: { projectId: true, name: true, number: true } }),
      'جلب بيانات المعدة'
    )

    var deleteResult = await safeDbOp(
      () => db.equipment.delete({ where: { id } }),
      'حذف المعدة'
    )
    if (!deleteResult.success) return deleteResult.response

    var projectId = eqInfo.success ? eqInfo.data?.projectId : null
    var eqDesc = eqInfo.success && eqInfo.data ? eqInfo.data.number + ' - ' + eqInfo.data.name : id

    Promise.all([
      safeDbOp(() => db.auditLog.create({ data: { userId: user.id, projectId, action: 'delete', entity: 'equipment', entityId: id, details: 'حذف معدة: ' + eqDesc } }), 'سجل التدقيق'),
      safeDbOp(() => db.notification.create({ data: { projectId, type: 'equipment_breakdown', title: 'حذف معدة', message: 'تم حذف: ' + eqDesc + ' بواسطة ' + user.name, severity: 'warning' } }), 'إشعار الحذف'),
    ]).catch(function() {})

    return NextResponse.json({ success: true })
  } catch (error) {
    return handleDbError(error, 'حذف المعدة')
  }
}
