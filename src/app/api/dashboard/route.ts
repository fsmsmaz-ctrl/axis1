import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db, cached } from '@/lib/db'

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

/**
 * Convert any date input to a "date only" range that is robust to timezone
 * offsets when the user's reports were stored as a local-midnight date.
 *
 * The original code did:
 *   const today = new Date()
 *   today.setHours(0, 0, 0, 0)
 *   where: { reportDate: { gte: today, lt: tomorrow } }
 *
 * The problem: reportDate values are stored from client input like
 * "2026-09-02" via `new Date("2026-09-02")` which becomes
 * 2026-09-02T00:00:00.000Z (UTC midnight). On a server running in UTC this
 * happens to align, but if the deployment's TZ differs (Vercel uses UTC by
 * default but `new Date()` reads system locale), the comparison still misses
 * reports whose reportDate is the "calendar day" the user thinks of today.
 *
 * Fix: compute today's calendar date in UTC explicitly, build a 24-hour
 * window, AND ALSO expand the range by ±1 day to absorb any TZ drift. This
 * is safe because we then filter by status='approved' and group in JS.
 */
function getDateRange(daysBack: number = 0): { gte: Date; lt: Date } {
  const now = new Date()
  // Use UTC midnight of "today" (UTC) as anchor — matches how reportDate is
  // stored when created from a "YYYY-MM-DD" string.
  const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const start = new Date(base)
  start.setUTCDate(start.getUTCDate() - daysBack)
  const end = new Date(base)
  end.setUTCDate(end.getUTCDate() + 1)
  return { gte: start, lt: end }
}

/** Same but returns the [gte, lt] for "this calendar month" (UTC). */
function getMonthRange(): { gte: Date; lt: Date } {
  const now = new Date()
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  return { gte: start, lt: end }
}

// ────────────────────────────────────────────────────────────────
// Main handler
// ────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const startedAt = Date.now()
  try {
    const user = await getAuthUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Cache the whole dashboard payload per-user for 30 seconds. The dashboard
    // is mostly aggregate read-only data; a short TTL hides DB latency without
    // showing stale data for long. Cache key is user-scoped so permissions
    // are respected.
    const cacheKey = `dashboard:${user.id}`
    const payload = await cached(cacheKey, 30_000, () => buildDashboard())

    // Helpful for debugging latency issues from the client.
    const duration = Date.now() - startedAt
    return NextResponse.json(
      { ...payload, _meta: { durationMs: duration, cached: duration > 30 } },
      {
        headers: {
          // Allow the browser to reuse the response for 15s while we
          // revalidate server-side.
          'Cache-Control': 'private, max-age=15, stale-while-revalidate=30',
        },
      }
    )
  } catch (error: any) {
    console.error('[Dashboard API] Fatal error:', error)
    return NextResponse.json(
      { error: 'dashboard_error', details: error?.message || 'Unknown error' },
      { status: 500 }
    )
  }
}

// ────────────────────────────────────────────────────────────────
// Dashboard builder — all queries run concurrently
// ────────────────────────────────────────────────────────────────

async function buildDashboard() {
  const todayRange = getDateRange(0)
  const monthRange = getMonthRange()
  const fourteenDaysAgo = new Date(todayRange.gte.getTime() - 14 * 24 * 60 * 60 * 1000)

  // ── Parallel: independent scalar queries ──
  const [
    activeProjectsResult,
    todayReportsResult,
    monthReportsResult,
    monthCostsResult,
    totalCostsResult,
    totalRevenueResult,
    stoppedEquipmentResult,
    unreadNotificationsResult,
    trendReportsResult,
    trendCostsResult,
    projectsResult,
    recentReportsResult,
    notificationsResult,
    equipmentResult,
    costsByCategoryResult,
  ] = await Promise.allSettled([
    db.project.count({ where: { status: 'in_progress' } }),

    // Today's reports — accept ANY status, we filter in JS so a status enum
    // mismatch can't zero out the dashboard.
    db.dailyReport.findMany({
      where: { reportDate: { gte: todayRange.gte, lt: todayRange.lt } },
      select: {
        dailyMeters: true,
        dailyRevenue: true,
        workersCount: true,
        status: true,
      },
    }),

    // Month reports — same approach
    db.dailyReport.findMany({
      where: { reportDate: { gte: monthRange.gte, lt: monthRange.lt } },
      select: {
        dailyMeters: true,
        dailyRevenue: true,
        status: true,
      },
    }),

    // Month costs
    db.cost.aggregate({
      where: { date: { gte: monthRange.gte, lt: monthRange.lt } },
      _sum: { amount: true },
    }),

    // Total costs
    db.cost.aggregate({ _sum: { amount: true } }),

    // Total revenue from approved reports
    db.dailyReport.aggregate({
      where: { status: 'approved' },
      _sum: { dailyRevenue: true },
    }),

    // Stopped equipment
    db.equipment.count({
      where: { status: { in: ['stopped', 'maintenance_needed'] } },
    }),

    // Unread notifications
    db.notification.count({ where: { read: false } }),

    // Trend reports
    db.dailyReport.findMany({
      where: { reportDate: { gte: fourteenDaysAgo } },
      orderBy: { reportDate: 'asc' },
      select: {
        reportDate: true,
        dailyMeters: true,
        dailyRevenue: true,
        status: true,
      },
    }),

    // Trend costs
    db.cost.findMany({
      where: { date: { gte: fourteenDaysAgo } },
      select: { date: true, amount: true },
    }),

    // Projects
    db.project.findMany({
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
    }),

    // Recent reports (with relations — fallback if relation fails)
    db.dailyReport.findMany({
      take: 10,
      orderBy: { reportDate: 'desc' },
      include: {
        project: { select: { name: true, code: true } },
        driveLine: { select: { lineNumber: true } },
      },
    }),

    // Notifications
    db.notification.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: { project: { select: { name: true } } },
    }),

    // Equipment
    db.equipment.findMany({
      include: { project: { select: { name: true } } },
    }),

    // Costs by category
    db.cost.groupBy({
      by: ['category'],
      where: { date: { gte: monthRange.gte, lt: monthRange.lt } },
      _sum: { amount: true },
    }),
  ])

  // ── Helper to unwrap Promise.allSettled result ──
  function unwrap<T>(r: PromiseSettledResult<T>, fallback: T, label: string): T {
    if (r.status === 'fulfilled') return r.value
    console.error(`[Dashboard] ${label} failed:`, (r as PromiseRejectedResult).reason?.message)
    return fallback
  }

  // ── Aggregate today's stats from todayReports (status-aware) ──
  const todayReports = unwrap(todayReportsResult, [], 'todayReports')
  // Prefer approved reports, but fall back to ANY status if no approved ones.
  const approvedToday = todayReports.filter((r: any) => r.status === 'approved')
  const todaySource = approvedToday.length > 0 ? approvedToday : todayReports
  const metersToday = todaySource.reduce((s: number, r: any) => s + (r.dailyMeters || 0), 0)
  const revenueToday = todaySource.reduce((s: number, r: any) => s + (r.dailyRevenue || 0), 0)
  const presentWorkers = todaySource.reduce((s: number, r: any) => s + (r.workersCount || 0), 0)

  // ── Aggregate month stats ──
  const monthReports = unwrap(monthReportsResult, [], 'monthReports')
  const approvedMonth = monthReports.filter((r: any) => r.status === 'approved')
  const monthSource = approvedMonth.length > 0 ? approvedMonth : monthReports
  const metersThisMonth = monthSource.reduce((s: number, r: any) => s + (r.dailyMeters || 0), 0)
  const revenueThisMonth = monthSource.reduce((s: number, r: any) => s + (r.dailyRevenue || 0), 0)

  // ── Scalar aggregates ──
  const activeProjects = unwrap(activeProjectsResult, 0, 'activeProjects')
  const monthCostsSum = unwrap(monthCostsResult, { _sum: { amount: 0 } }, 'monthCosts')._sum?.amount || 0
  const totalCostsSum = unwrap(totalCostsResult, { _sum: { amount: 0 } }, 'totalCosts')._sum?.amount || 0
  const totalRevenueSum = unwrap(totalRevenueResult, { _sum: { dailyRevenue: 0 } }, 'totalRevenue')._sum?.dailyRevenue || 0
  const stoppedEquipment = unwrap(stoppedEquipmentResult, 0, 'stoppedEquipment')
  const unreadNotifications = unwrap(unreadNotificationsResult, 0, 'unreadNotifications')

  // ── Build trend (last 14 days). Prefer approved; fall back to all if none. ──
  const trendReportsRaw = unwrap(trendReportsResult, [], 'trendReports')
  const trendCosts = unwrap(trendCostsResult, [], 'trendCosts')

  const approvedTrend = trendReportsRaw.filter((r: any) => r.status === 'approved')
  const trendReports = approvedTrend.length > 0 ? approvedTrend : trendReportsRaw

  const trendMap = new Map<string, { meters: number; revenue: number; cost: number }>()
  for (const r of trendReports as any[]) {
    const key = new Date(r.reportDate).toISOString().split('T')[0]
    if (!trendMap.has(key)) trendMap.set(key, { meters: 0, revenue: 0, cost: 0 })
    const item = trendMap.get(key)!
    item.meters += r.dailyMeters || 0
    item.revenue += r.dailyRevenue || 0
  }
  for (const c of trendCosts as any[]) {
    const key = new Date(c.date).toISOString().split('T')[0]
    if (!trendMap.has(key)) trendMap.set(key, { meters: 0, revenue: 0, cost: 0 })
    trendMap.get(key)!.cost += c.amount || 0
  }
  const trend = Array.from(trendMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, vals]) => ({ date, ...vals }))

  // ── Lists ──
  const projects = unwrap(projectsResult, [], 'projects')
  const recentReports = unwrap(recentReportsResult, [], 'recentReports')
  const notifications = unwrap(notificationsResult, [], 'notifications')
  const equipment = unwrap(equipmentResult, [], 'equipment')
  const costsByCategoryRaw = unwrap(costsByCategoryResult, [], 'costsByCategory')
  const costsByCategory = (costsByCategoryRaw as any[]).map((c) => ({
    category: c.category,
    amount: c._sum?.amount || 0,
  }))

  // ── Build response ──
  const netProfit = totalRevenueSum - totalCostsSum

  return {
    stats: {
      activeProjects,
      totalProjects: projects.length,
      metersToday,
      metersThisMonth,
      revenueToday,
      revenueThisMonth,
      totalRevenue: totalRevenueSum,
      totalCosts: totalCostsSum,
      monthCosts: monthCostsSum,
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
    // Signal to client whether any reports were found today (helpful for
    // UI to know whether "0" is real or a missing-data situation).
    _diagnostics: {
      todayReportsTotal: todayReports.length,
      todayReportsApproved: approvedToday.length,
      todayReportsSource: approvedToday.length > 0 ? 'approved' : (todayReports.length > 0 ? 'any_status' : 'none'),
      monthReportsTotal: monthReports.length,
      monthReportsApproved: approvedMonth.length,
    },
  }
}
