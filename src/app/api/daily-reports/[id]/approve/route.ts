import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  var user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (user.role !== 'project_manager' && user.role !== 'top_management') {
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
    // Get the report first to recalculate revenue on approval
    var existingReport = await db.dailyReport.findUnique({
      where: { id },
      include: {
        project: { select: { pricePerMeter: true } },
      },
    })

    if (!existingReport) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 })
    }

    // Only submitted reports can be approved
    if (existingReport.status !== 'submitted') {
      return NextResponse.json(
        { error: 'invalid_status', message: 'لا يمكن اعتماد تقرير لم يتم تسليمه' },
        { status: 400 }
      )
    }

    // Recalculate dailyRevenue on approval using latest project price
    var pricePerMeter = existingReport.project?.pricePerMeter || 0
    var dailyMeters = Math.max(0, (existingReport.endReading || 0) - (existingReport.startReading || 0))
    var dailyRevenue = dailyMeters * pricePerMeter

    var report = await db.dailyReport.update({
      where: { id },
      data: {
        status: 'approved',
        approvedById: user.id,
        approvedAt: new Date(),
        dailyRevenue: dailyRevenue,
      },
    })

    await db.auditLog.create({
      data: {
        userId: user.id,
        dailyReportId: id,
        projectId: report.projectId,
        action: 'approve',
        entity: 'daily_report',
        entityId: id,
        details: 'Approved daily report (revenue: ' + dailyRevenue + ' OMR)',
      },
    })

    return NextResponse.json({ report })
  } catch (error) {
    console.error('Approve report error:', error)
    return NextResponse.json({ error: 'Failed to update report status' }, { status: 500 })
  }
}
