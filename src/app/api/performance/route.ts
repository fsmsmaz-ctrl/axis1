import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError } from '@/lib/api-helpers'

export async function GET(req: NextRequest) {
  var user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    var searchParams = new URL(req.url).searchParams
    var projectId = searchParams.get('projectId')

    var where: any = { status: 'approved' }
    if (projectId) where.projectId = projectId

    var safetyWhere: any = {}
    if (projectId) safetyWhere.projectId = projectId

    var costWhere: any = {}
    if (projectId) costWhere.projectId = projectId

    var results = await Promise.all([
      db.dailyReport.findMany({
        where,
        include: {
          project: { select: { id: true, name: true, code: true } },
          driveLine: { select: { lineNumber: true } },
        },
        orderBy: { reportDate: 'asc' },
        take: 500,
      }),
      db.safetyReport.findMany({
        where: safetyWhere,
        select: { projectId: true, ppeAvailable: true, helmetCheck: true, bootsCheck: true, glovesCheck: true, glassesCheck: true, workAreaCheck: true, barriersCheck: true, shaftCheck: true, ventilationCheck: true, electricalCheck: true, craneCheck: true, hydraulicCheck: true, fireExtinguishers: true, workPermit: true, toolboxTalk: true },
        take: 500,
      }),
      db.cost.findMany({
        where: costWhere,
        select: { projectId: true, amount: true },
        take: 1000,
      }),
    ])

    var reports = results[0]
    var safetyReports = results[1]
    var costs = results[2]

    var projectStats = new Map<string, any>()

    for (var ri = 0; ri < reports.length; ri++) {
      var r = reports[ri]
      var key = r.projectId
      if (!projectStats.has(key)) {
        projectStats.set(key, {
          projectId: r.projectId,
          projectName: r.project?.name || '',
          projectCode: r.project?.code || '',
          reports: [],
          totalMeters: 0,
          totalRevenue: 0,
          avgDaily: 0,
          bestDay: 0,
          worstDay: Infinity,
          stoppageDays: 0,
          stoppageReasons: [] as string[],
          totalWorkers: 0,
          daysCount: 0,
        })
      }
      var stat = projectStats.get(key)
      if (stat) {
        stat.reports.push(r)
        stat.totalMeters += r.dailyMeters
        stat.totalRevenue += r.dailyRevenue
        stat.bestDay = Math.max(stat.bestDay, r.dailyMeters)
        stat.worstDay = Math.min(stat.worstDay, r.dailyMeters)
        if (r.stoppageHours > 2) {
          stat.stoppageDays++
          if (r.stoppageReason) stat.stoppageReasons.push(r.stoppageReason)
        }
        stat.totalWorkers += r.workersCount
        stat.daysCount++
      }
    }

    var projectStatsArr = Array.from(projectStats.values()).map(function(s: any) {
      s.avgDaily = s.daysCount > 0 ? s.totalMeters / s.daysCount : 0
      s.worstDay = s.worstDay === Infinity ? 0 : s.worstDay
      return s
    })

    var safetyByProject = new Map<string, { total: number; passed: number }>()
    for (var si = 0; si < safetyReports.length; si++) {
      var s = safetyReports[si]
      if (!safetyByProject.has(s.projectId)) safetyByProject.set(s.projectId, { total: 0, passed: 0 })
      var sStat = safetyByProject.get(s.projectId)
      if (sStat) {
        sStat.total += 15
        var checks = [s.ppeAvailable, s.helmetCheck, s.bootsCheck, s.glovesCheck, s.glassesCheck, s.workAreaCheck, s.barriersCheck, s.shaftCheck, s.ventilationCheck, s.electricalCheck, s.craneCheck, s.hydraulicCheck, s.fireExtinguishers, s.workPermit, s.toolboxTalk]
        sStat.passed += checks.filter(Boolean).length
      }
    }

    var costByProject = new Map<string, number>()
    for (var ci = 0; ci < costs.length; ci++) {
      var cost = costs[ci]
      costByProject.set(cost.projectId, (costByProject.get(cost.projectId) || 0) + cost.amount)
    }

    var performance = projectStatsArr.map(function(p: any) {
      var safety = safetyByProject.get(p.projectId)
      var safetyRate = safety && safety.total > 0 ? (safety.passed / safety.total) * 100 : 100
      var totalCost = costByProject.get(p.projectId) || 0
      var costPerMeter = p.totalMeters > 0 ? totalCost / p.totalMeters : 0
      var profitMargin = p.totalRevenue > 0 ? ((p.totalRevenue - totalCost) / p.totalRevenue) * 100 : 0
      var avgWorkers = p.daysCount > 0 ? p.totalWorkers / p.daysCount : 0

      return {
        ...p,
        safetyRate,
        totalCost,
        costPerMeter,
        profit: p.totalRevenue - totalCost,
        profitMargin,
        avgWorkers,
        attendanceRate: avgWorkers > 0 ? 100 : 0,
      }
    })

    return NextResponse.json({ performance })
  } catch (error) {
    console.error('Performance data error:', error)
    return handleDbError(error, 'بيانات الأداء')
  }
}
