import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  const project = await db.project.findUnique({
    where: { id },
    include: {
      manager: { select: { id: true, name: true, nameEn: true } },
      engineer: { select: { id: true, name: true, nameEn: true } },
      driveLines: {
        orderBy: { lineNumber: 'asc' },
      },
      equipments: true,
      _count: {
        select: { dailyReports: true, costs: true, finishings: true },
      },
    },
  })

  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  // Calculate aggregate stats
  const reports = await db.dailyReport.findMany({
    where: { projectId: id, status: 'approved' },
    select: { dailyMeters: true, dailyRevenue: true, reportDate: true },
  })

  const totalMeters = reports.reduce((s, r) => s + r.dailyMeters, 0)
  const totalRevenue = reports.reduce((s, r) => s + r.dailyRevenue, 0)

  const costsAgg = await db.cost.aggregate({
    where: { projectId: id },
    _sum: { amount: true },
  })

  const totalCost = costsAgg._sum.amount || 0

  return NextResponse.json({
    project: {
      ...project,
      totalMetersDrilled: totalMeters,
      totalRevenue,
      totalCost,
      netProfit: totalRevenue - totalCost,
    },
  })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (user.role !== 'top_management' && user.role !== 'project_manager') {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json()

  try {
    const project = await db.project.update({
      where: { id },
      data: {
        code: body.code,
        name: body.name,
        client: body.client,
        location: body.location,
        contractNumber: body.contractNumber,
        workType: body.workType,
        pipeDiameter: body.pipeDiameter,
        totalLength: parseFloat(body.totalLength),
        pricePerMeter: parseFloat(body.pricePerMeter),
        soilType: body.soilType,
        startDate: new Date(body.startDate),
        expectedEnd: new Date(body.expectedEnd),
        status: body.status,
        notes: body.notes,
      },
    })

    await db.auditLog.create({
      data: {
        userId: user.id,
        projectId: id,
        action: 'update',
        entity: 'project',
        entityId: id,
        details: `Updated project ${project.code}`,
      },
    })

    return NextResponse.json({ project })
  } catch (error) {
    console.error('Update project error:', error)
    return NextResponse.json({ error: 'Failed to update project' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (user.role !== 'top_management' && user.role !== 'project_manager') {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const { id } = await params

  try {
    await db.project.delete({ where: { id } })

    await db.auditLog.create({
      data: {
        userId: user.id,
        action: 'delete',
        entity: 'project',
        entityId: id,
        details: 'Deleted project',
      },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete project error:', error)
    return NextResponse.json({ error: 'Failed to delete project' }, { status: 500 })
  }
}
