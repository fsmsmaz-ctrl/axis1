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

  // === Run each query independently so one failure doesn't break everything ===

  // Active projects count
  let activeProjects = 0
  try { activeProjects = await db.project.count({ where: { status: 'in_progress' } }) } catch (e: any) { console.error('[Dashboard] activeProjects:', e.message) }

  // Today's approved reports
  let todayReports: any[] = []
  try {
    todayReports = await db.dailyReport.findMany({
      where: { reportDate: { gte: today, lt: tomorrow }, status: 'approved' },
    })
  } catch (e: any) { console.error('[Dashboard] todayReports:', e.message) }

  const metersToday = todayReports.reduce((sum: number, r: any) => sum + (r.dailyMeters || 0), 0)
  const revenueToday = todayReports.reduce((sum: number, r: any) => sum + (r.dailyRevenue || 0), 0)
  const presentWorkers = todayReports.reduce((sum: number, r: any) => sum + (r.workersCount || 0), 0)

  // This month reports
  let monthReports: any[] = []
  try {
    monthReports = await db.dailyReport.findMany({
      where: { reportDate: { gte: monthStart }, status: 'approved' },
    })
  } catch (e: any) { console.error('[Dashboard] monthReports:', e.message) }

  const metersThisMonth = monthReports.reduce((sum: number, r: any) => sum + (r.dailyMeters || 0), 0)
  const revenueThisMonth = monthReports.reduce((sum: number, r: any) => sum + (r.dailyRevenue || 0), 0)

  // Total costs this month
  let monthCosts = 0
  try {
    const mc = await db.cost.aggregate({ where: { date: { gte: monthStart } }, _sum: { amount: true } })
    monthCosts = mc._sum.amount || 0
  } catch (e: any) { console.error('[Dashboard] monthCosts:', e.message) }

  // All costs (total)
  let totalCosts = 0
  try {
    const tc = await db.cost.aggregate({ _sum: { amount: true } })
    totalCosts = tc._sum.amount || 0
  } catch (e: any) { console.error('[Dashboard] totalCosts:', e.message) }

  // Total revenue (all approved reports)
  let totalRevenue = 0
  try {
    const tr = await db.dailyReport.aggregate({ where: { status: 'approved' }, _sum: { dailyRevenue: true } })
    totalRevenue = tr._sum.dailyRevenue || 0
  } catch (e: any) { console.error('[Dashboard] totalRevenue:', e.message) }

  // Stopped equipment
  let stoppedEquipment = 0
  try {
    stoppedEquipment = await db.equipment.count({ where: { status: { in: ['stopped', 'maintenance_needed'] } } })
  } catch (e: any) { console.error('[Dashboard] stoppedEquipment:', e.message) }

  // Unread notifications
  let unreadNotifications = 0
  try {
    unreadNotifications = await db.notification.count({ where: { read: false } })
  } catch (e: any) { console.error('[Dashboard] unreadNotifications:', e.message) }

  // Production trend (last 14 days)
  let trend: Array<{ date: string; meters: number; revenue: number; cost: number }> = []
  try {
    const trendReports = await db.dailyReport.findMany({
      where: { reportDate: { gte: fourteenDaysAgo }, status: 'approved' },
      orderBy: { reportDate: 'asc' },
      select: { reportDate: true, dailyMeters: true, dailyRevenue: true },
    })
    const trendCosts = await db.cost.findMany({
      where: { date: { gte: fourteenDaysAgo } },
      select: { date: true, amount: true },
    })
    const trendMap = new Map<string, { meters: number; revenue: number; cost: number }>()
    for (const r of trendReports) {
      const key = r.reportDate.toISOString().split('T')[0]
      if (!trendMap.has(key)) trendMap.set(key, { meters: 0, revenue: 0, cost: 0 })
      const item = trendMap.get(key)!
      item.meters += r.dailyMeters || 0
      item.revenue += r.dailyRevenue || 0
    }
    for (const c of trendCosts) {
      const key = c.date.toISOString().split('T')[0]
      if (!trendMap.has(key)) trendMap.set(key, { meters: 0, revenue: 0, cost: 0 })
      trendMap.get(key)!.cost += c.amount || 0
    }
    trend = Array.from(trendMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, vals]) => ({ date, ...vals }))
  } catch (e: any) { console.error('[Dashboard] trend:', e.message) }

  // Projects
  let projects: any[] = []
  try {
    projects = await db.project.findMany({
      select: { id: true, name: true, code: true, status: true, progress: true, totalLength: true, pricePerMeter: true, client: true },
    })
  } catch (e: any) { console.error('[Dashboard] projects:', e.message) }

  // Recent reports
  let recentReports: any[] = []
  try {
    recentReports = await db.dailyReport.findMany({
      take: 10, orderBy: { reportDate: 'desc' },
      include: { project: { select: { name: true, code: true } }, driveLine: { select: { lineNumber: true } } },
    })
  } catch (e: any) { console.error('[Dashboard] recentReports:', e.message) }

  // Notifications
  let notifications: any[] = []
  try {
    notifications = await db.notification.findMany({
      take: 5, orderBy: { createdAt: 'desc' },
      include: { project: { select: { name: true } } },
    })
  } catch (e: any) { console.error('[Dashboard] notifications:', e.message) }

  // Equipment
  let equipment: any[] = []
  try {
    equipment = await db.equipment.findMany({
      include: { project: { select: { name: true } } },
    })
  } catch (e: any) { console.error('[Dashboard] equipment:', e.message) }

  // Cost breakdown by category (this month)
  let costsByCategory: Array<{ category: string; amount: number }> = []
  try {
    const raw = await db.cost.groupBy({ by: ['category'], where: { date: { gte: monthStart } }, _sum: { amount: true } })
    costsByCategory = raw.map((c) => ({ category: c.category, amount: c._sum.amount || 0 }))
  } catch (e: any) { console.error('[Dashboard] costsByCategory:', e.message) }

  // Calculate net profit
  const netProfit = totalRevenue - totalCosts

  return NextResponse.json({
    stats: {
      activeProjects,
      totalProjects: projects.length,
      metersToday,
      metersThisMonth,
      revenueToday,
      revenueThisMonth,
      totalRevenue,
      totalCosts,
      monthCosts,
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
