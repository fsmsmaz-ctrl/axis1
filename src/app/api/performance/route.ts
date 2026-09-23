import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { hasPermission } from '@/lib/auth'
import { db } from '@/lib/db'
import { handleDbError, safeDbOp } from '@/lib/api-helpers'

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  // v13.1 SECURITY: تقرير الأداء يجمع إيرادات وتكاليف وسلامة — للإدارة فقط
  // (كان متاحاً لأي مستخدم مسجل رغم إخفاء الصفحة في الواجهة)
  if (!hasPermission(user.role, 'performance', user.permissions, user.email)) {
    return NextResponse.json({ error: 'forbidden', message: 'تقرير الأداء متاح للإدارة فقط' }, { status: 403 })
  }

  try {
    const { searchParams } = new URL(req.url)
    const projectId = searchParams.get('projectId')

    const threeMonthsAgo = new Date()
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)

    const where: any = { status: 'approved', reportDate: { gte: threeMonthsAgo } }
    if (projectId) where.projectId = projectId

    const safetyWhere: any = { reportDate: { gte: threeMonthsAgo } }
    if (projectId) safetyWhere.projectId = projectId

    const costWhere: any = { date: { gte: threeMonthsAgo } }
    if (projectId) costWhere.projectId = projectId

    // v40: نطاق خطوط الحفر — كامل عمر الخط (بدون نافذة 3 أشهر) لأن الخط أصل فيزيائي دائم
    const lineWhere: any = {}
    if (projectId) lineWhere.projectId = projectId

    // FIX: Wrap in safeDbOp for consistent error handling
    const [reportsResult, safetyResult, costsResult, linesResult, lineReportsResult, lineCostsResult, lineSafetyResult, finishingsResult] = await Promise.all([
      safeDbOp(
        () => db.dailyReport.findMany({
          where,
          select: { projectId: true, reportDate: true, dailyMeters: true, dailyRevenue: true, stoppageHours: true, stoppageReason: true, workersCount: true, project: { select: { name: true, code: true } } },
          orderBy: { reportDate: 'asc' }, take: 200,
        }),
        'جلب التقارير للأداء'
      ),
      safeDbOp(
        () => db.safetyReport.findMany({
          where: safetyWhere,
          select: { projectId: true, ppeAvailable: true, helmetCheck: true, bootsCheck: true, glovesCheck: true, glassesCheck: true, workAreaCheck: true, barriersCheck: true, shaftCheck: true, ventilationCheck: true, electricalCheck: true, craneCheck: true, hydraulicCheck: true, fireExtinguishers: true, workPermit: true, toolboxTalk: true },
          take: 200,
        }),
        'جلب تقارير السلامة للأداء'
      ),
      safeDbOp(
        () => db.cost.findMany({
          where: costWhere,
          select: { projectId: true, amount: true },
          take: 500,
        }),
        'جلب التكاليف للأداء'
      ),
      // v40: بيانات خطوط الحفر — التحليل حسب كل خط
      safeDbOp(
        () => db.driveLine.findMany({
          where: lineWhere,
          select: { id: true, projectId: true, lineNumber: true, totalLength: true, diameter: true, status: true, completedLength: true, progress: true, pricePerMeter: true, project: { select: { name: true, code: true } } },
          orderBy: { lineNumber: 'asc' }, take: 500,
        }),
        'جلب خطوط الحفر للأداء'
      ),
      safeDbOp(
        () => db.dailyReport.findMany({
          where: { status: 'approved', driveLineId: { not: null }, ...(projectId ? { projectId } : {}) },
          select: { driveLineId: true, reportDate: true, dailyMeters: true, dailyRevenue: true, stoppageHours: true, stoppageReason: true, workersCount: true },
          orderBy: { reportDate: 'asc' }, take: 3000,
        }),
        'جلب تقارير خطوط الحفر'
      ),
      safeDbOp(
        () => db.cost.findMany({
          where: { dailyReportId: { not: null }, ...(projectId ? { projectId } : {}) },
          select: { amount: true, dailyReport: { select: { driveLineId: true } } },
          take: 3000,
        }),
        'جلب تكاليف خطوط الحفر'
      ),
      safeDbOp(
        () => db.safetyReport.findMany({
          where: projectId ? { projectId } : {},
          select: { incidentType: true, dailyReport: { select: { driveLineId: true } } },
          take: 3000,
        }),
        'جلب حوادث خطوط الحفر'
      ),
      safeDbOp(
        () => db.finishing.findMany({
          where: projectId ? { projectId } : {},
          select: { driveLineId: true, handoverStatus: true, status: true },
          take: 1000,
        }),
        'جلب التشطيبات للأداء'
      ),
    ])

    // FIX: Check all results for errors
    if (!reportsResult.success) return reportsResult.response
    if (!safetyResult.success) return safetyResult.response
    if (!costsResult.success) return costsResult.response

    const reports = reportsResult.data
    const safetyReports = safetyResult.data
    const costs = costsResult.data

    const projectStats = new Map<string, any>()

    for (const r of reports) {
      const key = r.projectId
      if (!projectStats.has(key)) {
        projectStats.set(key, {
          projectId: r.projectId, projectName: r.project?.name || '', projectCode: r.project?.code || '',
          reports: [], totalMeters: 0, totalRevenue: 0, avgDaily: 0, bestDay: 0, worstDay: Infinity,
          stoppageDays: 0, stoppageReasons: [] as string[], totalWorkers: 0, daysCount: 0,
        })
      }
      const stat = projectStats.get(key)!
      stat.reports.push(r)
      stat.totalMeters += r.dailyMeters
      stat.totalRevenue += r.dailyRevenue
      stat.bestDay = Math.max(stat.bestDay, r.dailyMeters)
      stat.worstDay = Math.min(stat.worstDay, r.dailyMeters)
      if (r.stoppageHours > 2) { stat.stoppageDays++; if (r.stoppageReason) stat.stoppageReasons.push(r.stoppageReason) }
      stat.totalWorkers += r.workersCount
      stat.daysCount++
    }

    const projectStatsArr = Array.from(projectStats.values()).map((s: any) => {
      s.avgDaily = s.daysCount > 0 ? s.totalMeters / s.daysCount : 0
      s.worstDay = s.worstDay === Infinity ? 0 : s.worstDay
      return s
    })

    const safetyByProject = new Map<string, { total: number; passed: number }>()
    for (const s of safetyReports) {
      if (!safetyByProject.has(s.projectId)) safetyByProject.set(s.projectId, { total: 0, passed: 0 })
      const stat = safetyByProject.get(s.projectId)!
      stat.total += 15
      const checks = [s.ppeAvailable, s.helmetCheck, s.bootsCheck, s.glovesCheck, s.glassesCheck, s.workAreaCheck, s.barriersCheck, s.shaftCheck, s.ventilationCheck, s.electricalCheck, s.craneCheck, s.hydraulicCheck, s.fireExtinguishers, s.workPermit, s.toolboxTalk]
      stat.passed += checks.filter(Boolean).length
    }

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

      return { ...p, safetyRate, totalCost, costPerMeter, profit: p.totalRevenue - totalCost, profitMargin, avgWorkers, attendanceRate: avgWorkers > 0 ? 100 : 0 }
    })

    // v40: تجميع إحصاءات كل خط حفر (إنتاج/إيراد/تكلفة/ربح/حوادث/تسليم)
    if (!linesResult.success) return linesResult.response
    if (!lineReportsResult.success) return lineReportsResult.response
    if (!lineCostsResult.success) return lineCostsResult.response
    if (!lineSafetyResult.success) return lineSafetyResult.response
    if (!finishingsResult.success) return finishingsResult.response

    const driveLinesRaw = linesResult.data
    const lineReports = lineReportsResult.data
    const lineCosts = lineCostsResult.data
    const lineSafety = lineSafetyResult.data
    const finishings = finishingsResult.data

    const lineStats = new Map<string, any>()
    for (const l of driveLinesRaw) {
      lineStats.set(l.id, {
        id: l.id, projectId: l.projectId, lineNumber: l.lineNumber, projectName: l.project?.name || '', projectCode: l.project?.code || '',
        totalLength: l.totalLength, diameter: l.diameter, status: l.status, completedLength: l.completedLength, progress: l.progress, pricePerMeter: l.pricePerMeter,
        meters: 0, revenue: 0, reportDays: 0, bestDay: 0, stoppageDays: 0, totalWorkers: 0, avgWorkers: 0,
        cost: 0, nearMiss: 0, minorIncidents: 0, majorAccidents: 0, incidentLoad: 0, handoverAccepted: 0,
      })
    }
    for (const r of lineReports) {
      if (!r.driveLineId) continue
      const s = lineStats.get(r.driveLineId)
      if (!s) continue
      s.meters += r.dailyMeters
      s.revenue += r.dailyRevenue
      s.reportDays++
      s.bestDay = Math.max(s.bestDay, r.dailyMeters)
      if (r.stoppageHours > 2) s.stoppageDays++
      s.totalWorkers += r.workersCount
    }
    for (const c of lineCosts) {
      const dl = c.dailyReport?.driveLineId
      if (!dl) continue
      const s = lineStats.get(dl)
      if (s) s.cost += c.amount
    }
    for (const sr of lineSafety) {
      const dl = sr.dailyReport?.driveLineId
      if (!dl) continue
      const s = lineStats.get(dl)
      if (!s) continue
      if (sr.incidentType === 'near_miss') { s.nearMiss++; s.incidentLoad += 5 }
      else if (sr.incidentType === 'incident') { s.minorIncidents++; s.incidentLoad += 15 }
      else if (sr.incidentType === 'accident') { s.majorAccidents++; s.incidentLoad += 25 }
    }
    for (const f of finishings) {
      if (!f.driveLineId) continue
      const s = lineStats.get(f.driveLineId)
      if (s && f.handoverStatus === 'accepted') s.handoverAccepted++
    }

    const driveLines = Array.from(lineStats.values()).map((s: any) => {
      s.avgDaily = s.reportDays > 0 ? s.meters / s.reportDays : 0
      s.avgWorkers = s.reportDays > 0 ? s.totalWorkers / s.reportDays : 0
      s.profit = s.revenue - s.cost
      s.profitMargin = s.revenue > 0 ? (s.profit / s.revenue) * 100 : 0
      s.costPerMeter = s.meters > 0 ? s.cost / s.meters : 0
      return s
    })

    // v40: مؤشر الأداء المركب 0-100 — الإنتاج 35% + الربحية 25% + كفاءة التكلفة 25% + السلامة 15%
    // أوزان الحوادث: وشاية near_miss=5، حادث incident=15، إصابة accident=25
    const linesWithData = driveLines.filter((s: any) => s.reportDays > 0)
    const maxAvgDaily = linesWithData.length ? Math.max(...linesWithData.map((s: any) => s.avgDaily)) : 0
    const maxMargin = linesWithData.length ? Math.max(...linesWithData.map((s: any) => Math.max(0, s.profitMargin))) : 0
    const positiveCostPerMeter = linesWithData.map((s: any) => s.costPerMeter).filter((v: number) => v > 0)
    const minCostPerMeter = positiveCostPerMeter.length ? Math.min(...positiveCostPerMeter) : 0
    for (const s of driveLines) {
      if (s.reportDays > 0) {
        const prodScore = maxAvgDaily > 0 ? (s.avgDaily / maxAvgDaily) * 100 : 0
        const profitScore = maxMargin > 0 ? (Math.max(0, s.profitMargin) / maxMargin) * 100 : 0
        const costScore = s.costPerMeter > 0 ? (minCostPerMeter > 0 ? Math.min(100, (minCostPerMeter / s.costPerMeter) * 100) : 100) : 100
        const safetyScore = Math.max(0, 100 - s.incidentLoad)
        s.prodScore = Math.round(prodScore)
        s.safetyScore = Math.round(safetyScore)
        s.score = Math.round(prodScore * 0.35 + profitScore * 0.25 + costScore * 0.25 + safetyScore * 0.15)
      } else {
        s.prodScore = 0
        s.safetyScore = 100
        s.score = 0
      }
    }
    driveLines.sort((a: any, b: any) => b.score - a.score || b.meters - a.meters)

    return NextResponse.json({ performance, driveLines })
  } catch (error) {
    // FIX: Use handleDbError for consistent Arabic error messages
    return handleDbError(error, 'جلب بيانات الأداء')
  }
}
