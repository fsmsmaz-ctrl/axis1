import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const projectId = searchParams.get('projectId')

  const where: any = { status: 'approved' }
  if (projectId) where.projectId = projectId

  const safetyWhere: any = {}
  if (projectId) safetyWhere.projectId = projectId

  const costWhere: any = {}
  if (projectId) costWhere.projectId = projectId

  // Run all 3 queries in parallel (with limits to prevent loading all data)
  const [reports, safetyReports, costs] = await Promise.all([
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

  // Group reports by project
  const projectStats = new Map<string, any>()

  for (const r of reports) {
    const key = r.projectId
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
    const stat = projectStats.get(key)!
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

  const projectStatsArr = Array.from(projectStats.values()).map((s: any) => {
    s.avgDaily = s.daysCount > 0 ? s.totalMeters / s.daysCount : 0
    s.worstDay = s.worstDay === Infinity ? 0 : s.worstDay
    return s
  })

  // Process safety data
  const safetyByProject = new Map<string, { total: number; passed: number }>()
  for (const s of safetyReports) {
    if (!safetyByProject.has(s.projectId)) safetyByProject.set(s.projectId, { total: 0, passed: 0 })
    const stat = safetyByProject.get(s.projectId)!
    stat.total += 15
    const checks = [s.ppeAvailable, s.helmetCheck, s.bootsCheck, s.glovesCheck, s.glassesCheck, s.workAreaCheck, s.barriersCheck, s.shaftCheck, s.ventilationCheck, s.electricalCheck, s.craneCheck, s.hydraulicCheck, s.fireExtinguishers, s.workPermit, s.toolboxTalk]
    stat.passed += checks.filter(Boolean).length
  }

  // Process cost data
  const costByProject = new Map<string, number>()
  for (const c of costs) {
    costByProject.set(c.projectId, (costByProject.get(c.projectId) || 0) + c.amount)
  }

  const performance = projectStatsArr.map((p: any) => {
    const safety = safetyByProject.get(p.projectId)
    const safetyRate = safety && safety.total > 0 ? (safety.passed / safety.total) * 100 : 100
    const totalCost = costByProject.get(p.projectId) || 0
    const costPerMeter = p.totalMeters > 0 ? totalCost / p.totalMeters : 0
    const profitMargin = p.totalRevenue > 0 ? ((p.totalRevenue - totalCost) / p.totalRevenue) * 100 : 0
    const avgWorkers = p.daysCount > 0 ? p.totalWorkers / p.daysCount : 0

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
}
