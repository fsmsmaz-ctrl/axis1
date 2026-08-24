import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'

export async function GET(req: NextRequest) {
  try {
  const user = await getAuthUser(req)
  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
  const fourteenDaysAgo = new Date(today)
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14)

  // F-4 FIX: Role-based project filtering
  var projectWhere: any = {}
  if (user.role === 'foreman') {
    projectWhere = { OR: [{ managerId: user.id }, { engineerId: user.id }] }
  } else if (user.role === 'site_engineer') {
    projectWhere = { engineerId: user.id }
  } else if (user.role === 'project_manager') {
    projectWhere = { managerId: user.id }
  }

  // Build filtered where clauses for reports and costs
  var userProjectIds: string[] | null = null
  if (user.role === 'foreman' || user.role === 'site_engineer' || user.role === 'project_manager') {
    var userProjects = await db.project.findMany({ where: projectWhere, select: { id: true } })
    userProjectIds = userProjects.map(function(p: any) { return p.id })
  }

  var todayReportWhere: any = { reportDate: { gte: today, lt: tomorrow }, status: 'approved' }
  var monthReportWhere: any = { reportDate: { gte: monthStart }, status: 'approved' }
  var trendReportWhere: any = { reportDate: { gte: fourteenDaysAgo }, status: 'approved' }
  var costMonthWhere: any = { date: { gte: monthStart } }
  var costTotalWhere: any = {}
  var costTrendWhere: any = { date: { gte: fourteenDaysAgo } }

  if (userProjectIds) {
    todayReportWhere.projectId = { in: userProjectIds }
    monthReportWhere.projectId = { in: userProjectIds }
    trendReportWhere.projectId = { in: userProjectIds }
    costMonthWhere.projectId = { in: userProjectIds }
    costTotalWhere.projectId = { in: userProjectIds }
    costTrendWhere.projectId = { in: userProjectIds }
  }

  const [
    activeProjects, todayAgg, monthAgg, monthCostsResult,
    totalCostsResult, totalRevenueResult, stoppedEquipment,
    unreadNotifications, trendReports, trendCostsGrouped,
    projects, recentReports, notifications, equipment, costsByCategoryRaw,
  ] = await Promise.all([
    db.project.count({ where: { ...projectWhere, status: 'in_progress' } }),
    db.dailyReport.aggregate({ where: todayReportWhere, _sum: { dailyMeters: true, dailyRevenue: true, workersCount: true }, _count: true }),
    db.dailyReport.aggregate({ where: monthReportWhere, _sum: { dailyMeters: true, dailyRevenue: true } }),
    db.cost.aggregate({ where: costMonthWhere, _sum: { amount: true } }),
    db.cost.aggregate({ where: costTotalWhere, _sum: { amount: true } }),
    db.dailyReport.aggregate({ where: { status: 'approved', ...(userProjectIds ? { projectId: { in: userProjectIds } } : {}) }, _sum: { dailyRevenue: true } }),
    db.equipment.count({ where: { status: { in: ['stopped', 'maintenance_needed'] } } }),
    db.notification.count({ where: { read: false } }),
    db.dailyReport.findMany({ where: trendReportWhere, orderBy: { reportDate: 'asc' }, select: { reportDate: true, dailyMeters: true, dailyRevenue: true } }),
    db.cost.groupBy({ by: ['date'], where: costTrendWhere, _sum: { amount: true } }),
    db.project.findMany({ where: projectWhere, select: { id: true, name: true, code: true, status: true, progress: true, totalLength: true, pricePerMeter: true, client: true }, take: 50, orderBy: { status: 'desc' } }),
    db.dailyReport.findMany({ where: userProjectIds ? { projectId: { in: userProjectIds } } : {}, take: 10, orderBy: { reportDate: 'desc' }, include: { project: { select: { name: true, code: true } }, driveLine: { select: { lineNumber: true } } } }),
    db.notification.findMany({ take: 5, orderBy: { createdAt: 'desc' }, include: { project: { select: { name: true } } } }),
    db.equipment.findMany({ take: 30, orderBy: { name: 'asc' }, include: { project: { select: { name: true } } } }),
    db.cost.groupBy({ by: ['category'], where: costMonthWhere, _sum: { amount: true } }),
  ])

  const metersToday = todayAgg._sum.dailyMeters || 0
  const revenueToday = todayAgg._sum.dailyRevenue || 0
  const presentWorkers = todayAgg._sum.workersCount || 0
  const metersThisMonth = monthAgg._sum.dailyMeters || 0
  const revenueThisMonth = monthAgg._sum.dailyRevenue || 0

  const trendMap = new Map<string, { meters: number; revenue: number; cost: number }>()
  for (const r of trendReports) {
    const key = r.reportDate.toISOString().split('T')[0]
    if (!trendMap.has(key)) trendMap.set(key, { meters: 0, revenue: 0, cost: 0 })
    const item = trendMap.get(key)!
    item.meters += r.dailyMeters
    item.revenue += r.dailyRevenue
  }
  for (const c of trendCostsGrouped) {
    const key = c.date.toISOString().split('T')[0]
    if (!trendMap.has(key)) trendMap.set(key, { meters: 0, revenue: 0, cost: 0 })
    trendMap.get(key)!.cost += (c._sum.amount || 0)
  }
  const trend = Array.from(trendMap.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([date, vals]) => ({ date, ...vals }))
  const costsByCategory = costsByCategoryRaw.map((c) => ({ category: c.category, amount: c._sum.amount || 0 }))

  const totalRevenue = totalRevenueResult._sum.dailyRevenue || 0
  const totalCostAmount = totalCostsResult._sum.amount || 0
  const monthCostAmount = monthCostsResult._sum.amount || 0
  const netProfit = totalRevenue - totalCostAmount

  return NextResponse.json({
    stats: {
      activeProjects, totalProjects: projects.length, metersToday, metersThisMonth,
      revenueToday, revenueThisMonth, totalRevenue, totalCosts: totalCostAmount,
      costsTotal: totalCostAmount, monthCosts: monthCostAmount, netProfit,
      stoppedEquipment, presentWorkers, unreadNotifications,
    },
    trend, projects, recentReports, notifications, equipment, costsByCategory,
  })
  } catch (error: any) {
    console.error('[Dashboard API] Error:', error)
    return NextResponse.json(
      { error: 'dashboard_error', message: 'فشل في تحميل بيانات لوحة المعلومات' },
      { status: 500 }
    )
  }
}
