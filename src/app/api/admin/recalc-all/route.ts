import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'

// Admin-only endpoint to recalculate ALL progress and revenue data.
// Call once via: POST /api/admin/recalc-all
// This fixes:
// 1. Daily report dailyMeters and dailyRevenue for all reports
// 2. DriveLine completedLength and progress
// 3. Project progress

export async function POST(req: NextRequest) {
  try {
    var user = await getAuthUser(req)
    if (!user) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    if (user.role !== 'top_management') {
      return NextResponse.json({ error: 'forbidden', message: 'Admin only' }, { status: 403 })
    }

    var results = {
      projectsFixed: 0,
      driveLinesFixed: 0,
      reportsFixed: 0,
      errors: [] as string[],
    }

    // Step 1: Get ALL projects with their pricePerMeter
    var projects = await db.project.findMany({
      select: { id: true, pricePerMeter: true },
    })

    for (var pi = 0; pi < projects.length; pi++) {
      var project = projects[pi]
      var pricePerMeter = project.pricePerMeter || 0

      try {
        // Step 2: Get all daily reports for this project
        var reports = await db.dailyReport.findMany({
          where: { projectId: project.id },
          select: {
            id: true,
            startReading: true,
            endReading: true,
            dailyMeters: true,
            dailyRevenue: true,
            driveLineId: true,
          },
        })

        // Step 3: Fix each report's dailyMeters and dailyRevenue
        for (var ri = 0; ri < reports.length; ri++) {
          var r = reports[ri]
          var startReading = r.startReading || 0
          var endReading = r.endReading || 0
          var correctDailyMeters = Math.max(0, endReading - startReading)
          var correctRevenue = correctDailyMeters * pricePerMeter

          // Only update if values differ
          if (Math.abs(r.dailyMeters - correctDailyMeters) > 0.001 ||
              Math.abs(r.dailyRevenue - correctRevenue) > 0.001) {
            await db.dailyReport.update({
              where: { id: r.id },
              data: {
                dailyMeters: correctDailyMeters,
                dailyRevenue: correctRevenue,
              },
            })
            results.reportsFixed++
          }
        }

        // Step 4: Recalculate drive line progress
        var driveLines = await db.driveLine.findMany({
          where: { projectId: project.id },
          select: { id: true, totalLength: true },
        })

        for (var di = 0; di < driveLines.length; di++) {
          var dl = driveLines[di]

          // Get MAX endReading from all daily reports for this drive line
          var maxResult = await db.dailyReport.aggregate({
            where: { driveLineId: dl.id },
            _max: { endReading: true },
          })
          var completedLength = maxResult._max.endReading || 0
          var progress = dl.totalLength > 0 ? (completedLength / dl.totalLength) * 100 : 0
          var newStatus = progress >= 100 ? 'completed' : (completedLength > 0 ? 'in_progress' : 'not_started')

          await db.driveLine.update({
            where: { id: dl.id },
            data: {
              completedLength: completedLength,
              progress: Math.min(progress, 100),
              status: newStatus,
            },
          })
          results.driveLinesFixed++
        }

        // Step 5: Recalculate project progress from all drive lines
        var allDl = await db.driveLine.findMany({
          where: { projectId: project.id },
          select: { totalLength: true, completedLength: true },
        })
        var totalAll = 0
        var completedAll = 0
        for (var j = 0; j < allDl.length; j++) {
          totalAll += allDl[j].totalLength || 0
          completedAll += allDl[j].completedLength || 0
        }
        var projectProgress = totalAll > 0 ? (completedAll / totalAll) * 100 : 0

        await db.project.update({
          where: { id: project.id },
          data: { progress: Math.min(projectProgress, 100) },
        })
        results.projectsFixed++
      } catch (err: any) {
        results.errors.push('Project ' + project.id + ': ' + (err.message || String(err)))
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Recalculation complete',
      results,
    })
  } catch (error: any) {
    console.error('[recalc-all] Error:', error)
    return NextResponse.json({ error: 'server_error', message: error.message }, { status: 500 })
  }
}
