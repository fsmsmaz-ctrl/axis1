import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  const report = await db.dailyReport.findUnique({
    where: { id },
    include: {
      project: true,
      driveLine: true,
      safety: true,
      costs: true,
      attachments: true,
      createdBy: { select: { name: true, nameEn: true } },
      approver: { select: { name: true, nameEn: true } },
    },
  })

  if (!report) {
    return NextResponse.json({ error: 'Report not found' }, { status: 404 })
  }

  return NextResponse.json({ report })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const body = await req.json()

  try {
    const startReading = parseFloat(body.startReading) || 0
    const endReading = parseFloat(body.endReading) || 0
    const dailyMeters = Math.max(0, endReading - startReading)

    const driveLine = body.driveLineId
      ? await db.driveLine.findUnique({ where: { id: body.driveLineId } })
      : null

    const totalLength = driveLine?.totalLength || 0
    const totalMeters = endReading
    const remainingMeters = Math.max(0, totalLength - totalMeters)
    const progressPercent = totalLength > 0 ? (totalMeters / totalLength) * 100 : 0

    const project = await db.project.findUnique({
      where: { id: body.projectId },
      select: { pricePerMeter: true },
    })

    const dailyRevenue = dailyMeters * (project?.pricePerMeter || 0)

    const report = await db.dailyReport.update({
      where: { id },
      data: {
        projectId: body.projectId,
        driveLineId: body.driveLineId || null,
        reportDate: new Date(body.reportDate),
        weather: body.weather,
        workStartTime: body.workStartTime,
        workEndTime: body.workEndTime,
        operatingHours: parseFloat(body.operatingHours) || 0,
        stoppageHours: parseFloat(body.stoppageHours) || 0,
        stoppageReason: body.stoppageReason,
        workersCount: parseInt(body.workersCount) || 0,
        attendees: body.attendees,
        startReading,
        endReading,
        dailyMeters,
        totalMeters,
        remainingMeters,
        progressPercent,
        soilExcavated: body.soilExcavated,
        pipesInstalled: parseInt(body.pipesInstalled) || 0,
        productionNotes: body.productionNotes,
        problems: body.problems,
        dailyRevenue,
        status: body.status,
      },
    })

    await db.auditLog.create({
      data: {
        userId: user.id,
        projectId: body.projectId,
        dailyReportId: id,
        action: 'update',
        entity: 'daily_report',
        entityId: id,
        details: `Updated daily report`,
      },
    })

    return NextResponse.json({ report })
  } catch (error) {
    console.error('Update daily report error:', error)
    return NextResponse.json({ error: 'Failed to update daily report' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Only top management can delete approved reports
  if (user.role !== 'top_management') {
    const report = await db.dailyReport.findUnique({ where: { id: (await params).id } })
    if (report?.status === 'approved') {
      return NextResponse.json({ error: 'Cannot delete approved report' }, { status: 403 })
    }
  }

  const { id } = await params

  try {
    await db.dailyReport.delete({ where: { id } })

    await db.auditLog.create({
      data: {
        userId: user.id,
        action: 'delete',
        entity: 'daily_report',
        entityId: id,
        details: 'Deleted daily report',
      },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete report error:', error)
    return NextResponse.json({ error: 'Failed to delete report' }, { status: 500 })
  }
}
