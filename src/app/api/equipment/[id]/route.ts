import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { safeDbOp, handleDbError } from '@/lib/api-helpers'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  const equipment = await db.equipment.findUnique({
    where: { id },
    include: {
      project: true,
      maintenance: {
        include: { performedBy: { select: { name: true, nameEn: true } } },
        orderBy: { date: 'desc' },
      },
    },
  })

  if (!equipment) {
    return NextResponse.json({ error: 'Equipment not found' }, { status: 404 })
  }

  return NextResponse.json({ equipment })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const body = await req.json()

  try {
    const equipment = await db.equipment.update({
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
      },
    })

    // Audit log + notification (non-critical, fire-and-forget)
    Promise.all([
      safeDbOp(
        () => db.auditLog.create({
          data: {
            userId: user.id,
            projectId: equipment.projectId,
            action: 'update',
            entity: 'equipment',
            entityId: id,
            details: `Updated equipment: ${equipment.number} - ${equipment.name}`,
          },
        }),
        'سجل التدقيق'
      ),
      safeDbOp(
        () => db.notification.create({
          data: {
            projectId: equipment.projectId,
            type: 'equipment_breakdown',
            title: 'تعديل معدة',
            message: `تم تعديل بيانات المعدة: ${equipment.number} - ${equipment.name} بواسطة ${user.name}`,
            severity: 'info',
          },
        }),
        'إشعار التعديل'
      ),
    ]).catch(() => {})

    return NextResponse.json({ equipment })
  } catch (error) {
    console.error('Update equipment error:', error)
    return NextResponse.json({ error: 'Failed to update equipment' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  try {
    // Get equipment info before deleting
    const equipInfo = await safeDbOp(
      () => db.equipment.findUnique({ where: { id }, select: { projectId: true, number: true, name: true } }),
      'جلب بيانات المعدة'
    )

    await db.equipment.delete({ where: { id } })

    const equipDesc = equipInfo.success && equipInfo.data
      ? `${equipInfo.data.number} - ${equipInfo.data.name}`
      : id
    const projectId = equipInfo.success ? equipInfo.data?.projectId : null

    // Audit log + delete notification (non-critical, fire-and-forget)
    Promise.all([
      safeDbOp(
        () => db.auditLog.create({
          data: {
            userId: user.id,
            projectId,
            action: 'delete',
            entity: 'equipment',
            entityId: id,
            details: `Deleted equipment: ${equipDesc}`,
          },
        }),
        'سجل التدقيق'
      ),
      safeDbOp(
        () => db.notification.create({
          data: {
            projectId,
            type: 'equipment_breakdown',
            title: 'حذف معدة',
            message: `تم حذف المعدة: ${equipDesc} بواسطة ${user.name}`,
            severity: 'warning',
          },
        }),
        'إشعار الحذف'
      ),
    ]).catch(() => {})

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete equipment error:', error)
    return NextResponse.json({ error: 'Failed to delete equipment' }, { status: 500 })
  }
}
