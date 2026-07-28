import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (user.role !== 'project_manager' && user.role !== 'top_management') {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json()
  const action = body.action

  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json({ error: 'Invalid action. Must be "approve" or "reject"' }, { status: 400 })
  }

  const finalStatus = action === 'approve' ? 'approved' : 'rejected'

  try {
    // Get the report first to recalculate revenue on approval
    const existingReport = await db.dailyReport.findUnique({
      where: { id },
      include: {
        project: { select: { pricePerMeter: true } },
      },
    })

    if (!existingReport) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 })
    }

    // Recalculate dailyRevenue on approval using latest project price
    let dailyRevenue = existingReport.dailyRevenue
    if (action === 'approve') {
      const pricePerMeter = existingReport.project?.pricePerMeter || 0
      const dailyMeters = Math.max(0, (existingReport.endReading || 0) - (existingReport.startReading || 0))
      dailyRevenue = dailyMeters * pricePerMeter
    }

    const report = await db.dailyReport.update({
      where: { id },
      data: {
        status: finalStatus,
        approvedById: user.id,
        approvedAt: new Date(),
        // Update revenue with latest price on approval
        ...(action === 'approve' ? { dailyRevenue } : {}),
      },
    })

    await db.auditLog.create({
      data: {
        userId: user.id,
        dailyReportId: id,
        projectId: report.projectId,
        action: finalStatus,
        entity: 'daily_report',
        entityId: id,
        details: (action === 'approve' ? 'Approved' : 'Rejected') + ' daily report' + (action === 'approve' ? ' (revenue: ' + dailyRevenue + ' OMR)' : ''),
      },
    })

    return NextResponse.json({ report })
  } catch (error) {
    console.error('Approve report error:', error)
    return NextResponse.json({ error: 'Failed to update report status' }, { status: 500 })
  }
}
