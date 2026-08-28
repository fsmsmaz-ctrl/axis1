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

    // SIMPLE progress: sum of ALL dailyMeters per project (not just approved)
    var projectIds = projects.map(function(p: any) { return p.id })
    var projectMetersMap: Record<string, number> = {}
    if (projectIds.length > 0) {
      try {
        var allMeters = await db.dailyReport.findMany({
          where: { projectId: { in: projectIds } },
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
      var totalLen = p.totalLength || 0
      var completedMeters = projectMetersMap[p.id] || 0
      if (totalLen > 0) {
        p.progress = Math.min((completedMeters / totalLen) * 100, 100)
      } else {
        p.progress = 0
      }
    }

    return NextResponse.json({ projects: projects })
  } catch (error: any) {
    return handleDbError(error, 'جلب قائمة المشاريع')
  }
}
