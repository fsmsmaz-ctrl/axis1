import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError } from '@/lib/api-helpers'

export async function GET(req: NextRequest) {
  try {
  var user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  var today = new Date()
  today.setHours(0, 0, 0, 0)
  var tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  var monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
  var weekStart = new Date(today)
  weekStart.setDate(weekStart.getDate() - 7)

  // Active projects count
  var activeProjects = await db.project.count({
    where: { status: 'in_progress' },
  })

  // Today's reports
  var todayReports = await db.dailyReport.findMany({
    where: {
      reportDate: { gte: today, lt: tomorrow },
      status: 'approved',
    },
  })

  var metersToday = todayReports.reduce(function(sum: number, r: any) { return sum + r.dailyMeters }, 0)
  var revenueToday = todayReports.reduce(function(sum: number, r: any) { return sum + r.dailyRevenue }, 0)

  // This month reports
  var monthReports = await db.dailyReport.findMany({
    where: {
      reportDate: { gte: monthStart },
      status: 'approved',
    },
  })

  var metersThisMonth = monthReports.reduce(function(sum: number, r: any) { return sum + r.dailyMeters }, 0)
  var revenueThisMonth = monthReports.reduce(function(sum: number, r: any) { return sum + r.dailyRevenue }, 0)

  // Total costs this month
  var monthCosts = await db.cost.aggregate({
    where: { date: { gte: monthStart } },
    _sum: { amount: true },
  })

  // All costs (total)
  var totalCosts = await db.cost.aggregate({
    _sum: { amount: true },
  })

  // Total revenue (all approved reports)
  var totalRevenueResult = await db.dailyReport.aggregate({
    where: { status: 'approved' },
    _sum: { dailyRevenue: true },
  })

  // Stopped equipment
  var stoppedEquipment = await db.equipment.count({
    where: { status: { in: ['stopped', 'maintenance_needed'] } },
  })

  // Today's workers
  var presentWorkers = todayReports.reduce(function(sum: number, r: any) { return sum + r.workersCount }, 0)

  // Unread notifications
  var unreadNotifications = await db.notification.count({
    where: { read: false },
  })

  // Production trend (last 14 days)
  var fourteenDaysAgo = new Date(today)
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14)

  var trendReports = await db.dailyReport.findMany({
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
  var trendMap = new Map<string, { meters: number; revenue: number; cost: number }>()
  var trendCosts = await db.cost.findMany({
    where: { date: { gte: fourteenDaysAgo } },
    select: { date: true, amount: true },
  })

  for (var ri = 0; ri < trendReports.length; ri++) {
    var r = trendReports[ri]
    var key = r.reportDate.toISOString().split('T')[0]
    if (!trendMap.has(key)) trendMap.set(key, { meters: 0, revenue: 0, cost: 0 })
    var item = trendMap.get(key)
    if (item) {
      item.meters += r.dailyMeters
      item.revenue += r.dailyRevenue
    }
  }

  for (var ci = 0; ci < trendCosts.length; ci++) {
    var c = trendCosts[ci]
    var cKey = c.date.toISOString().split('T')[0]
    if (!trendMap.has(cKey)) trendMap.set(cKey, { meters: 0, revenue: 0, cost: 0 })
    var cItem = trendMap.get(cKey)
    if (cItem) {
      cItem.cost += c.amount
    }
  }

  var trend = Array.from(trendMap.entries())
    .sort(function(a, b) { return a[0].localeCompare(b[0]) })
    .map(function(entry) { return { date: entry[0], meters: entry[1].meters, revenue: entry[1].revenue, cost: entry[1].cost } })

  // Projects with progress
  var projects = await db.project.findMany({
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
  var recentReports = await db.dailyReport.findMany({
    take: 10,
    orderBy: { reportDate: 'desc' },
    include: {
      project: { select: { name: true, code: true } },
      driveLine: { select: { lineNumber: true } },
    },
  })

  // Notifications
  var notifications = await db.notification.findMany({
    take: 5,
    orderBy: { createdAt: 'desc' },
    include: { project: { select: { name: true } } },
  })

  // Equipment list
  var equipment = await db.equipment.findMany({
    include: { project: { select: { name: true } } },
  })

  // Cost breakdown by category (this month)
  var costsByCategoryRaw = await db.cost.groupBy({
    by: ['category'],
    where: { date: { gte: monthStart } },
    _sum: { amount: true },
  })

  var costsByCategory = costsByCategoryRaw.map(function(c: any) {
    return { category: c.category, amount: c._sum.amount || 0 }
  })

  // Calculate net profit
  var netProfit = (totalRevenueResult._sum.dailyRevenue || 0) - (totalCosts._sum.amount || 0)

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
    return handleDbError(error, 'لوحة التحكم')
  }
}
