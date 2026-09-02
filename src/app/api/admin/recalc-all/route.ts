import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db, invalidateCachePrefix } from '@/lib/db'

// Admin/Manager endpoint to recalculate ALL progress data.
// Call via: POST /api/admin/recalc-all
// This fixes:
// 1. Daily report dailyMeters for all reports
// 2. DriveLine completedLength and progress
// 3. Project progress
// 4. Invalidates the dashboard cache so the new numbers show up immediately.

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser(req)
    if (!user) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    if (user.role !== 'top_management' && user.role !== 'project_manager') {
      return NextResponse.json(
        { error: 'forbidden', message: 'صلاحية المدير مطلوبة' },
        { status: 403 }
      )
    }

    const results = {
      projectsFixed: 0,
      driveLinesFixed: 0,
      reportsFixed: 0,
      errors: [] as string[],
    }

    // Step 1: Get ALL projects
    const projects = await db.project.findMany({
      select: { id: true, totalLength: true },
    })

    // Process projects sequentially to avoid connection pool exhaustion.
    for (const project of projects) {
      try {
        // Step 2: Get all daily reports for this project
        const reports = await db.dailyReport.findMany({
          where: { projectId: project.id },
          select: {
            id: true,
            startReading: true,
            endReading: true,
            dailyMeters: true,
            driveLineId: true,
            status: true,
          },
        })

        // Step 3: Fix each report's dailyMeters.
        // For draft/submitted reports, only recompute if values are clearly wrong.
        for (const r of reports) {
          const startReading = r.startReading || 0
          const endReading = r.endReading || 0
          const correctDailyMeters = Math.max(0, endReading - startReading)

          const needsUpdate =
            Math.abs((r.dailyMeters || 0) - correctDailyMeters) > 0.001 ||
            r.dailyMeters === null

          if (needsUpdate) {
            await db.dailyReport.update({
              where: { id: r.id },
              data: {
                dailyMeters: correctDailyMeters,
              },
            })
            results.reportsFixed++
          }
        }

        // Step 4: Recalculate drive line progress
        const driveLines = await db.driveLine.findMany({
          where: { projectId: project.id },
          select: { id: true, totalLength: true },
        })

        for (const dl of driveLines) {
          // Use MAX endReading (cumulative progress) as the canonical
          // "completedLength" — this matches how field crews measure
          // pipe jacking progress.
          const maxResult = await db.dailyReport.aggregate({
            where: { driveLineId: dl.id },
            _max: { endReading: true },
          })
          // Also compute SUM dailyMeters as a fallback for the case where
          // endReading was never set but dailyMeters was.
          const sumResult = await db.dailyReport.aggregate({
            where: { driveLineId: dl.id },
            _sum: { dailyMeters: true },
          })
          const completedLength = Math.max(
            maxResult._max.endReading || 0,
            sumResult._sum.dailyMeters || 0
          )
          const progress = dl.totalLength > 0 ? (completedLength / dl.totalLength) * 100 : 0
          const newStatus =
            progress >= 100 ? 'completed'
            : completedLength > 0 ? 'in_progress'
            : 'not_started'

          await db.driveLine.update({
            where: { id: dl.id },
            data: {
              completedLength,
              progress: Math.min(progress, 100),
              status: newStatus,
            },
          })
          results.driveLinesFixed++
        }

        // Step 5: Recalculate project progress.
        // Use SUM(dailyMeters) across all reports for this project divided
        // by project.totalLength. This is the SIMPLE approach documented
        // in api-helpers.ts:recalcProgress.
        const metersAgg = await db.dailyReport.aggregate({
          where: { projectId: project.id },
          _sum: { dailyMeters: true },
        })
        const totalMeters = metersAgg._sum.dailyMeters || 0
        const totalLen = project.totalLength || 0
        const projectProgress = totalLen > 0 ? Math.min((totalMeters / totalLen) * 100, 100) : 0

        await db.project.update({
          where: { id: project.id },
          data: { progress: projectProgress },
        })
        results.projectsFixed++
      } catch (err: any) {
        results.errors.push(`Project ${project.id}: ${err.message || String(err)}`)
      }
    }

    // Invalidate dashboard cache so fresh data shows up immediately.
    invalidateCachePrefix('dashboard:')

    return NextResponse.json({
      success: true,
      message: 'اكتملت إعادة الحساب. تحديث لوحة التحكم الآن.',
      results,
    })
  } catch (error: any) {
    console.error('[recalc-all] Error:', error)
    return NextResponse.json({ error: 'server_error', message: error.message }, { status: 500 })
  }
}

