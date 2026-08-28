// TEMPORARY: Remove after debugging
import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'

export async function GET() {
  try {
    var user = await getAuthUser({} as any)
    if (!user || user.role !== 'top_management') {
      return NextResponse.json({ error: 'debug only for admin' }, { status: 403 })
    }

    var projects = await db.project.findMany({
      select: { id: true, name: true, code: true, totalLength: true, progress: true, pricePerMeter: true },
      orderBy: { createdAt: 'desc' }, take: 20,
    })

    var reportCounts = await db.dailyReport.groupBy({
      by: ['projectId', 'status'],
      _sum: { dailyMeters: true, dailyRevenue: true },
      _count: true,
    })

    var driveLines = await db.driveLine.findMany({
      select: { id: true, projectId: true, lineNumber: true, totalLength: true, completedLength: true, progress: true },
    })

    var sampleReports = await db.dailyReport.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      select: { id: true, projectId: true, driveLineId: true, reportDate: true, status: true, startReading: true, endReading: true, dailyMeters: true, dailyRevenue: true },
    })

    var debugProjects = projects.map(function(p: any) {
      var allMeters = 0
      var reportCount = 0
      var statusBreakdown: Record<string, number> = {}

      for (var i = 0; i < reportCounts.length; i++) {
        var rc = reportCounts[i]
        if (rc.projectId === p.id) {
          allMeters += rc._sum.dailyMeters || 0
          reportCount += rc._count || 0
          statusBreakdown[rc.status] = (statusBreakdown[rc.status] || 0) + (rc._count || 0)
        }
      }

      var calcProgress = p.totalLength > 0 ? Math.min((allMeters / p.totalLength) * 100, 100) : 0

      return {
        id: p.id,
        name: p.name,
        code: p.code,
        totalLength: p.totalLength,
        storedProgress: p.progress,
        calculatedProgress: Math.round(calcProgress * 10) / 10,
        totalDailyMeters: Math.round(allMeters * 100) / 100,
        reportCount: reportCount,
        statusBreakdown: statusBreakdown,
      }
    })

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      projects: debugProjects,
      driveLinesCount: driveLines.length,
      sampleReports: sampleReports,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message, stack: err.stack }, { status: 500 })
  }
}
