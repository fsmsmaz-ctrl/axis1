import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, safeDbOp } from '@/lib/api-helpers'

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthUser(req)
    if (!user) {
      return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status')

    const where: any = {}
    if (status && status !== 'all') {
      where.status = status
    }

    const result = await safeDbOp(
      () => db.project.findMany({
        where,
        include: {
          manager: { select: { name: true, nameEn: true } },
          engineer: { select: { name: true, nameEn: true } },
          driveLines: { select: { id: true, totalLength: true, completedLength: true, progress: true } },
          _count: {
            select: { driveLines: true, dailyReports: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      'جلب قائمة المشاريع'
    )

    if (!result.success) return result.response

    var projects = result.data

    // Dynamic progress with fallback to dailyMeters
    var projectIds = projects.map(function(p: any) { return p.id })
    var projectMetersMap: Record<string, number> = {}
    if (projectIds.length > 0) {
      try {
        var allMeters = await db.dailyReport.findMany({
          where: { projectId: { in: projectIds }, status: 'approved' },
          select: { projectId: true, dailyMeters: true },
        })
        for (var m = 0; m < allMeters.length; m++) {
          var pm = allMeters[m]
          if (!projectMetersMap[pm.projectId]) projectMetersMap[pm.projectId] = 0
          projectMetersMap[pm.projectId] += pm.dailyMeters || 0
        }
      } catch (e) { /* ignore */ }
    }

    for (var i = 0; i < projects.length; i++) {
      var p = projects[i]
      var dls = p.driveLines || []
      var totalLen = 0
      var completedLen = 0
      for (var j = 0; j < dls.length; j++) {
        totalLen += dls[j].totalLength || 0
        completedLen += dls[j].completedLength || 0
      }
      var dlProgress = totalLen > 0 ? Math.min((completedLen / totalLen) * 100, 100) : 0
      if (dlProgress === 0 && (projectMetersMap[p.id] || 0) > 0) {
        p.progress = Math.min(((projectMetersMap[p.id] || 0) / (p.totalLength || totalLen || 1)) * 100, 100)
      } else {
        p.progress = dlProgress
      }
    }

    return NextResponse.json({ projects: projects })
  } catch (error: any) {
    return handleDbError(error, 'جلب قائمة المشاريع')
  }
}
