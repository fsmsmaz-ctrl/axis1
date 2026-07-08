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
  const weekStart = new Date(today)
  weekStart.setDate(weekStart.getDate() - 7)

  // Active projects count
  const activeProjects = await db.project.count({
    where: { status: 'in_progress' },
  })

  // Today's reports
  const todayReports = await db.dailyReport.findMany({
    where: {
      reportDate: { gte: today, lt: tomorrow },
      status: 'approved',
    },
  })

  const metersToday = todayReports.reduce((sum, r) => sum + r.dailyMeters, 0)
  const revenueToday = todayReports.reduce((sum, r) => sum + r.dailyRevenue, 0)

  // This month reports
  const monthReports = await db.dailyReport.findMany({
    where: {
      reportDate: { gte: monthStart },
      status: 'approved',
    },
  })

  const metersThisMonth = monthReports.reduce((sum, r) => sum + r.dailyMeters, 0)
  const revenueThisMonth = monthReports.reduce((sum, r) => sum + r.dailyRevenue, 0)

  // Total costs this month
  const monthCosts = await db.cost.aggregate({
    where: { date: { gte: monthStart } },
    _sum: { amount: true },
  })

  // All costs (total)
  const totalCosts = await db.cost.aggregate({
    _sum: { amount: true },
  })

  // Total revenue (all approved reports)
  const totalRevenueResult = await db.dailyReport.aggregate({
    where: { status: 'approved' },
    _sum: { dailyRevenue: true },
  })

  // Stopped equipment
  const stoppedEquipment = await db.equipment.count({
    where: { status: { in: ['stopped', 'maintenance_needed'] } },
  })

  // Today's workers
  const presentWorkers = todayReports.reduce((sum, r) => sum + r.workersCount, 0)

  // Unread notifications
  const unreadNotifications = await db.notification.count({
    where: { read: false },
  })

  // Production trend (last 14 days)
  const fourteenDaysAgo = new Date(today)
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14)

  const trendReports = await db.dailyReport.findMany({
    where: {
      reportDate: { gte: fourteenDaysAgo },
      status: 'approved',
    },
    orderBy: { reportDate: 'asc' },
    select: {
      reportDate: true,
      dailyMeters: true,
      dailyRevenue: true,
      projectId: true,
    },
  })

  // Group by date
  const trendMap = new Map<string, { meters: number; revenue: number; cost: number }>()
  const trendCosts = await db.cost.findMany({
    where: { date: { gte: fourteenDaysAgo } },
    select: { date: true, amount: true },
  })

  for (const r of trendReports) {
    const key = r.reportDate.toISOString().split('T')[0]
    if (!trendMap.has(key)) trendMap.set(key, { meters: 0, revenue: 0, cost: 0 })
    const item = trendMap.get(key)!
    item.meters += r.dailyMeters
    item.revenue += r.dailyRevenue
  }

  for (const c of trendCosts) {
    const key = c.date.toISOString().split('T')[0]
    if (!trendMap.has(key)) trendMap.set(key, { meters: 0, revenue: 0, cost: 0 })
    trendMap.get(key)!.cost += c.amount
  }

  const trend = Array.from(trendMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, vals]) => ({ date, ...vals }))

  // Projects with progress
  const projects = await db.project.findMany({
    select: {
      id: true,
      name: true,
      code: true,
      status: true,
      progress: true,
      totalLength: true,
      pricePerMeter: true,
      client: true,
    },
  })

  // Recent reports
  const recentReports = await db.dailyReport.findMany({
    take: 10,
    orderBy: { reportDate: 'desc' },
    include: {
      project: { select: { name: true, code: true } },
      driveLine: { select: { lineNumber: true } },
    },
  })

  // Notifications
  const notifications = await db.notification.findMany({
    take: 5,
    orderBy: { createdAt: 'desc' },
    include: { project: { select: { name: true } } },
  })

  // Equipment list
  const equipment = await db.equipment.findMany({
    include: { project: { select: { name: true } } },
  })

  // Cost breakdown by category (this month)
  const costsByCategoryRaw = await db.cost.groupBy({
    by: ['category'],
    where: { date: { gte: monthStart } },
    _sum: { amount: true },
  })

  const costsByCategory = costsByCategoryRaw.map((c) => ({
    category: c.category,
    amount: c._sum.amount || 0,
  }))

  // Calculate net profit
  const netProfit = (totalRevenueResult._sum.dailyRevenue || 0) - (totalCosts._sum.amount || 0)

  return NextResponse.json({
    stats: {
      activeProjects,
      totalProjects: projects.length,
      metersToday,
      metersThisMonth,
      revenueToday,
      revenueThisMonth,
      totalRevenue: totalRevenueResult._sum.dailyRevenue || 0,
      totalCosts: totalCosts._sum.amount || 0,
      monthCosts: monthCosts._sum.amount || 0,
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
