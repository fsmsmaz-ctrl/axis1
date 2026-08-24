import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'

export async function GET(req: NextRequest) {
  try {
  const user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
  const fourteenDaysAgo = new Date(today)
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14)

  const [
    activeProjects,
    todayAgg,
    monthAgg,
    monthCostsResult,
    totalCostsResult,
    totalRevenueResult,
    stoppedEquipment,
    unreadNotifications,
    trendReports,
    trendCostsGrouped,
    projects,
    recentReports,
    notifications,
    equipment,
    costsByCategoryRaw,
  ] = await Promise.all([
    db.project.count({ where: { status: 'in_progress' } }),

    db.dailyReport.aggregate({
      where: { reportDate: { gte: today, lt: tomorrow }, status: 'approved' },
      _sum: { dailyMeters: true, dailyRevenue: true, workersCount: true },
      _count: true,
    }),

    db.dailyReport.aggregate({
      where: { reportDate: { gte: monthStart }, status: 'approved' },
      _sum: { dailyMeters: true, dailyRevenue: true },
    }),

    db.cost.aggregate({
      where: { date: { gte: monthStart } },
      _sum: { amount: true },
    }),

    db.cost.aggregate({
      _sum: { amount: true },
    }),

    db.dailyReport.aggregate({
      where: { status: 'approved' },
      _sum: { dailyRevenue: true },
    }),

    db.equipment.count({
      where: { status: { in: ['stopped', 'maintenance_needed'] } },
    }),

    db.notification.count({ where: { read: false } }),

    db.dailyReport.findMany({
      where: { reportDate: { gte: fourteenDaysAgo }, status: 'approved' },
      orderBy: { reportDate: 'asc' },
      select: { reportDate: true, dailyMeters: true, dailyRevenue: true },
    }),

    db.cost.groupBy({
      by: ['date'],
      where: { date: { gte: fourteenDaysAgo } },
      _sum: { amount: true },
    }),

    db.project.findMany({
      select: {
        id: true, name: true, code: true, status: true,
        progress: true, totalLength: true, pricePerMeter: true, client: true,
      },
      take: 50,
      orderBy: { status: 'desc' },
    }),

    db.dailyReport.findMany({
      take: 10,
      orderBy: { reportDate: 'desc' },
      include: {
        project: { select: { name: true, code: true } },
        driveLine: { select: { lineNumber: true } },
      },
    }),

    db.notification.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: { project: { select: { name: true } } },
    }),

    db.equipment.findMany({
      take: 30,
      orderBy: { name: 'asc' },
      include: { project: { select: { name: true } } },
    }),

    db.cost.groupBy({
      by: ['category'],
      where: { date: { gte: monthStart } },
      _sum: { amount: true },
    }),
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

  const trend = Array.from(trendMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, vals]) => ({ date, ...vals }))

  const costsByCategory = costsByCategoryRaw.map((c) => ({
    category: c.category,
    amount: c._sum.amount || 0,
  }))

  const totalRevenue = totalRevenueResult._sum.dailyRevenue || 0
  const totalCostAmount = totalCostsResult._sum.amount || 0
  const monthCostAmount = monthCostsResult._sum.amount || 0
  const netProfit = totalRevenue - totalCostAmount

  return NextResponse.json({
    stats: {
      activeProjects,
      totalProjects: projects.length,
      metersToday,
      metersThisMonth,
      revenueToday,
      revenueThisMonth,
      totalRevenue,
      totalCosts: totalCostAmount,
      costsTotal: totalCostAmount,
      monthCosts: monthCostAmount,
      netProfit,
      stoppedEquipment,
      presentWorkers,
      unreadNotifications,
    },
    trend,
    projects,
    recentReports,
    notifications,
    equipment,
    costsByCategory,
  })
  } catch (error: any) {
    console.error('[Dashboard API] Error:', error)
    return NextResponse.json(
      { error: 'dashboard_error', details: error?.message || 'Unknown error' },
      { status: 500 }
    )
  }
}
