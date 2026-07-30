import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { safeDbOp, buildAuditDetails, handleDbError } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  var user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
  var body = await req.json()

  try {
    // Fetch old data before update
    var oldEq = await db.equipment.findUnique({ where: { id } })

    var equipment = await db.equipment.update({
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
    })

    // Build detailed changes diff
    var oldForCompare = oldEq ? {
      name: oldEq.name, number: oldEq.number, type: oldEq.type, status: oldEq.status,
      dailyHours: oldEq.dailyHours,
      lastMaintenance: oldEq.lastMaintenance && oldEq.lastMaintenance.toISOString ? oldEq.lastMaintenance.toISOString().split('T')[0] : oldEq.lastMaintenance,
      nextMaintenance: oldEq.nextMaintenance && oldEq.nextMaintenance.toISOString ? oldEq.nextMaintenance.toISOString().split('T')[0] : oldEq.nextMaintenance,
      notes: oldEq.notes,
    } : null

    var details = oldForCompare
      ? buildAuditDetails(oldForCompare, body, 'تعديل المعدة: ' + equipment.number + ' - ' + equipment.name, {
          skipFields: ['id', 'createdAt', 'updatedAt', 'projectId', 'breakdowns', 'spareParts'],
        })
      : 'تعديل المعدة: ' + equipment.number + ' - ' + equipment.name

    Promise.all([
      safeDbOp(
        () => db.auditLog.create({
          data: { userId: user.id, projectId: equipment.projectId, action: 'update', entity: 'equipment', entityId: id, details },
        }),
        'سجل التدقيق'
      ),
      safeDbOp(
        () => db.notification.create({
          data: {
            projectId: equipment.projectId,
            type: 'equipment_breakdown',
            title: 'تعديل معدة',
            message: 'تم تعديل بيانات المعدة: ' + equipment.number + ' - ' + equipment.name + ' بواسطة ' + user.name,
            severity: 'info',
          },
        }),
        'إشعار التعديل'
      ),
    ]).catch(function() {})

    return NextResponse.json({ equipment })
  } catch (error) {
    console.error('Update equipment error:', error)
    return handleDbError(error, 'تحديث المعدة')
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  var user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Only managers and top management can delete equipment
  if (user.role !== 'top_management' && user.role !== 'project_manager') {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
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

  try {
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
    var eqDesc = eqInfo.success && eqInfo.data
      ? eqInfo.data.number + ' - ' + eqInfo.data.name
      : id

    Promise.all([
      safeDbOp(
        () => db.auditLog.create({
          data: { userId: user.id, projectId, action: 'delete', entity: 'equipment', entityId: id, details: 'حذف معدة: ' + eqDesc },
        }),
        'سجل التدقيق'
      ),
      safeDbOp(
        () => db.notification.create({
          data: { projectId, type: 'equipment_breakdown', title: 'حذف معدة', message: 'تم حذف: ' + eqDesc + ' بواسطة ' + user.name, severity: 'warning' },
        }),
        'إشعار الحذف'
      ),
    ]).catch(function() {})

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete equipment error:', error)
    return handleDbError(error, 'حذف المعدة')
  }
}
