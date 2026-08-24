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

  // === ALL QUERIES PARALLELIZED WITH Promise.all ===
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
    // 1. Active projects count
    db.project.count({ where: { status: 'in_progress' } }),

    // 2. Today's aggregates (single query instead of findMany + reduce)
    db.dailyReport.aggregate({
      where: { reportDate: { gte: today, lt: tomorrow }, status: 'approved' },
      _sum: { dailyMeters: true, dailyRevenue: true, workersCount: true },
      _count: true,
    }),

    // 3. This month aggregates (single query instead of findMany + reduce)
    db.dailyReport.aggregate({
      where: { reportDate: { gte: monthStart }, status: 'approved' },
      _sum: { dailyMeters: true, dailyRevenue: true },
    }),

    // 4. Total costs this month
    db.cost.aggregate({
      where: { date: { gte: monthStart } },
      _sum: { amount: true },
    }),

    // 5. All costs total
    db.cost.aggregate({
      _sum: { amount: true },
    }),

    // 6. Total revenue (all approved reports)
    db.dailyReport.aggregate({
      where: { status: 'approved' },
      _sum: { dailyRevenue: true },
    }),

    // 7. Stopped equipment count
    db.equipment.count({
      where: { status: { in: ['stopped', 'maintenance_needed'] } },
    }),

    // 8. Unread notifications count
    db.notification.count({ where: { read: false } }),

    // 9. Trend reports (last 14 days, select only needed fields)
    db.dailyReport.findMany({
      where: { reportDate: { gte: fourteenDaysAgo }, status: 'approved' },
      orderBy: { reportDate: 'asc' },
      select: { reportDate: true, dailyMeters: true, dailyRevenue: true },
    }),

    // 10. Trend costs grouped by date (aggregate in DB instead of JS reduce)
    db.cost.groupBy({
      by: ['date'],
      where: { date: { gte: fourteenDaysAgo } },
      _sum: { amount: true },
    }),

    // 11. Projects with progress (limited)
    db.project.findMany({
      select: {
        id: true, name: true, code: true, status: true,
        progress: true, totalLength: true, pricePerMeter: true, client: true,
      },
      take: 50,
      orderBy: { status: 'desc' },
    }),

    // 12. Recent reports (already has take: 10)
    db.dailyReport.findMany({
      take: 10,
      orderBy: { reportDate: 'desc' },
      include: {
        project: { select: { name: true, code: true } },
        driveLine: { select: { lineNumber: true } },
      },
    }),

    // 13. Notifications (already has take: 5)
    db.notification.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: { project: { select: { name: true } } },
    }),

    // 14. Equipment list (PAGINATED - was unbounded before)
    db.equipment.findMany({
      take: 30,
      orderBy: { name: 'asc' },
      include: { project: { select: { name: true } } },
    }),

    // 15. Cost breakdown by category (this month)
    db.cost.groupBy({
      by: ['category'],
      where: { date: { gte: monthStart } },
      _sum: { amount: true },
    }),
  ])

  // Extract aggregated values
  const metersToday = todayAgg._sum.dailyMeters || 0
  const revenueToday = todayAgg._sum.dailyRevenue || 0
  const presentWorkers = todayAgg._sum.workersCount || 0
  const metersThisMonth = monthAgg._sum.dailyMeters || 0
  const revenueThisMonth = monthAgg._sum.dailyRevenue || 0

  // Build trend map from reports
  const trendMap = new Map<string, { meters: number; revenue: number; cost: number }>()
  for (const r of trendReports) {
    const key = r.reportDate.toISOString().split('T')[0]
    if (!trendMap.has(key)) trendMap.set(key, { meters: 0, revenue: 0, cost: 0 })
    const item = trendMap.get(key)!
    item.meters += r.dailyMeters
    item.revenue += r.dailyRevenue
  }

  // Add grouped costs to trend (already aggregated by DB)
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
