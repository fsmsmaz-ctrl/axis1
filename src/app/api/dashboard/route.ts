import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthUser(req)

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // === Fix: Use Oman timezone (UTC+4) for all date calculations ===
    function getOmanNow() {
      var now = new Date()
      // Convert to Oman time (UTC+4)
      var utcMs = now.getTime() + now.getTimezoneOffset() * 60000
      return new Date(utcMs + 4 * 60 * 60000)
    }

    var omanNow = getOmanNow()
    var todayStr = omanNow.toISOString().split('T')[0] // "2026-09-02"

    // Today boundaries in UTC (to match how dates are stored)
    var todayStart = new Date(todayStr + 'T00:00:00.000Z')
    var todayEnd = new Date(todayStr + 'T23:59:59.999Z')

    // Month boundaries
    var monthStr = todayStr.substring(0, 7) + '-01' // "2026-09-01"
    var monthStart = new Date(monthStr + 'T00:00:00.000Z')

    // 14 days ago
    var fourteenDaysAgo = new Date(todayStart)
    fourteenDaysAgo.setUTCDate(fourteenDaysAgo.getUTCDate() - 14)

    // Active projects count
    var activeProjects = await db.project.count({
      where: { status: 'in_progress' },
    })

    // === Fix: Today's reports - include ALL non-rejected statuses ===
    var todayReports = await db.dailyReport.findMany({
      where: {
        reportDate: { gte: todayStart, lte: todayEnd },
        status: { in: ['approved', 'submitted', 'draft'] },
      },
    })

    var metersToday = todayReports.reduce(function(sum, r) { return sum + r.dailyMeters }, 0)
    var revenueToday = todayReports.reduce(function(sum, r) { return sum + r.dailyRevenue }, 0)
    var workersToday = todayReports.reduce(function(sum, r) { return sum + r.workersCount }, 0)

    // Approved reports only for official stats
    var approvedTodayReports = todayReports.filter(function(r) { return r.status === 'approved' })
    var approvedRevenueToday = approvedTodayReports.reduce(function(sum, r) { return sum + r.dailyRevenue }, 0)

    // === Fix: This month reports - include ALL non-rejected statuses ===
    var monthReports = await db.dailyReport.findMany({
      where: {
        reportDate: { gte: monthStart },
        status: { in: ['approved', 'submitted', 'draft'] },
      },
    })

    var metersThisMonth = monthReports.reduce(function(sum, r) { return sum + r.dailyMeters }, 0)
    var revenueThisMonth = monthReports.reduce(function(sum, r) { return sum + r.dailyRevenue }, 0)

    // Approved this month for revenue
    var approvedMonthReports = monthReports.filter(function(r) { return r.status === 'approved' })
    var approvedRevenueThisMonth = approvedMonthReports.reduce(function(sum, r) { return sum + r.dailyRevenue }, 0)

    // Total costs this month
    var monthCostsResult = await db.cost.aggregate({
      where: { date: { gte: monthStart } },
      _sum: { amount: true },
    })

    // All costs (total)
    var totalCostsResult = await db.cost.aggregate({
      _sum: { amount: true },
    })

    // Total revenue (all approved reports)
    var totalRevenueResult = await db.dailyReport.aggregate({
      where: { status: 'approved' },
      _sum: { dailyRevenue: true },
    })

    // === Fix: Stopped equipment - also include maintenance_needed ===
    var stoppedEquipment = await db.equipment.count({
      where: { status: { in: ['stopped', 'maintenance_needed'] } },
    })

    // Total equipment count
    var totalEquipment = await db.equipment.count()

    // Unread notifications
    var unreadNotifications = await db.notification.count({
      where: { read: false },
    })

    // === Production trend (last 14 days) ===
    var trendReports = await db.dailyReport.findMany({
      where: {
        reportDate: { gte: fourteenDaysAgo },
        status: { in: ['approved', 'submitted', 'draft'] },
      },
      orderBy: { reportDate: 'asc' },
      select: {
        reportDate: true,
        dailyMeters: true,
        dailyRevenue: true,
        projectId: true,
        status: true,
      },
    })

    // Group by date
    var trendMap: Record<string, { meters: number; revenue: number; cost: number }> = {}
    var trendCosts = await db.cost.findMany({
      where: { date: { gte: fourteenDaysAgo } },
      select: { date: true, amount: true },
    })

    for (var i = 0; i < trendReports.length; i++) {
      var r = trendReports[i]
      var key = r.reportDate.toISOString().split('T')[0]
      if (!trendMap[key]) trendMap[key] = { meters: 0, revenue: 0, cost: 0 }
      trendMap[key].meters += r.dailyMeters
      trendMap[key].revenue += r.dailyRevenue
    }

    for (var j = 0; j < trendCosts.length; j++) {
      var c = trendCosts[j]
      var cKey = c.date.toISOString().split('T')[0]
      if (!trendMap[cKey]) trendMap[cKey] = { meters: 0, revenue: 0, cost: 0 }
      trendMap[cKey].cost += c.amount
    }

    var trend = Object.keys(trendMap)
      .sort()
      .map(function(date) { return { date: date, meters: trendMap[date].meters, revenue: trendMap[date].revenue, cost: trendMap[date].cost } })

    // Projects with progress
    var projects = await db.project.findMany({
      select: {
        id: true, name: true, code: true, status: true,
        progress: true, totalLength: true, pricePerMeter: true, client: true,
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

    var costsByCategory = costsByCategoryRaw.map(function(c) {
      return { category: c.category, amount: c._sum.amount || 0 }
    })

    // Calculate net profit
    var totalRevenue = totalRevenueResult._sum.dailyRevenue || 0
    var totalCosts = totalCostsResult._sum.amount || 0
    var monthCosts = monthCostsResult._sum.amount || 0
    var netProfit = totalRevenue - totalCosts

    // Total meters all time (from approved)
    var totalMetersResult = await db.dailyReport.aggregate({
      where: { status: 'approved' },
      _sum: { dailyMeters: true },
    })
    var totalMeters = totalMetersResult._sum.dailyMeters || 0

    return NextResponse.json({
      stats: {
        activeProjects: activeProjects,
        totalProjects: projects.length,
        metersToday: metersToday,
        metersThisMonth: metersThisMonth,
        revenueToday: approvedRevenueToday,
        revenueThisMonth: approvedRevenueThisMonth,
        totalRevenue: totalRevenue,
        totalCosts: totalCosts,
        monthCosts: monthCosts,
        netProfit: netProfit,
        stoppedEquipment: stoppedEquipment,
        totalEquipment: totalEquipment,
        presentWorkers: workersToday,
        unreadNotifications: unreadNotifications,
        totalMeters: totalMeters,
      },
      trend: trend,
      projects: projects,
      recentReports: recentReports,
      notifications: notifications,
      equipment: equipment,
      costsByCategory: costsByCategory,
    })
  } catch (error: any) {
    console.error('[Dashboard API] Error:', error)
    return NextResponse.json(
      { error: 'dashboard_error', details: error?.message || 'Unknown error' },
      { status: 500 }
    )
  }
}
