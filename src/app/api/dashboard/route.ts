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

    // ── Default values ──
    let activeProjects = 0
    let todayReports: any[] = []
    let monthReports: any[] = []
    let metersToday = 0
    let revenueToday = 0
    let metersThisMonth = 0
    let revenueThisMonth = 0
    let monthCostsSum = 0
    let totalCostsSum = 0
    let totalRevenueSum = 0
    let stoppedEquipment = 0
    let presentWorkers = 0
    let unreadNotifications = 0
    let trend: Array<{ date: string; meters: number; revenue: number; cost: number }> = []
    let projects: any[] = []
    let recentReports: any[] = []
    let notifications: any[] = []
    let equipment: any[] = []
    let costsByCategory: Array<{ category: string; amount: number }> = []
    const errors: string[] = []

    // ── 1. Active projects count ──
    try {
      activeProjects = await db.project.count({ where: { status: 'in_progress' } })
    } catch (e: any) {
      console.error('[Dashboard] activeProjects failed:', e?.message)
      errors.push('activeProjects')
    }

    // ── 2. Today's approved reports ──
    try {
      todayReports = await db.dailyReport.findMany({
        where: { reportDate: { gte: today, lt: tomorrow }, status: 'approved' },
      })
      metersToday = todayReports.reduce((sum, r) => sum + (r.dailyMeters || 0), 0)
      revenueToday = todayReports.reduce((sum, r) => sum + (r.dailyRevenue || 0), 0)
      presentWorkers = todayReports.reduce((sum, r) => sum + (r.workersCount || 0), 0)
    } catch (e: any) {
      console.error('[Dashboard] todayReports failed:', e?.message)
      errors.push('todayReports')
      // Fallback: try without status filter
      try {
        const allTodayReports = await db.dailyReport.findMany({
          where: { reportDate: { gte: today, lt: tomorrow } },
        })
        metersToday = allTodayReports.reduce((sum, r) => sum + (r.dailyMeters || 0), 0)
        revenueToday = allTodayReports.reduce((sum, r) => sum + (r.dailyRevenue || 0), 0)
        presentWorkers = allTodayReports.reduce((sum, r) => sum + (r.workersCount || 0), 0)
      } catch (e2: any) {
        console.error('[Dashboard] todayReports fallback also failed:', e2?.message)
      }
    }

    // ── 3. This month reports ──
    try {
      monthReports = await db.dailyReport.findMany({
        where: { reportDate: { gte: monthStart }, status: 'approved' },
      })
      metersThisMonth = monthReports.reduce((sum, r) => sum + (r.dailyMeters || 0), 0)
      revenueThisMonth = monthReports.reduce((sum, r) => sum + (r.dailyRevenue || 0), 0)
    } catch (e: any) {
      console.error('[Dashboard] monthReports failed:', e?.message)
      errors.push('monthReports')
      // Fallback: try without status filter
      try {
        const allMonthReports = await db.dailyReport.findMany({
          where: { reportDate: { gte: monthStart } },
        })
        metersThisMonth = allMonthReports.reduce((sum, r) => sum + (r.dailyMeters || 0), 0)
        revenueThisMonth = allMonthReports.reduce((sum, r) => sum + (r.dailyRevenue || 0), 0)
      } catch (e2: any) {
        console.error('[Dashboard] monthReports fallback also failed:', e2?.message)
      }
    }

    // ── 4. Month costs ──
    try {
      const mc = await db.cost.aggregate({
        where: { date: { gte: monthStart } },
        _sum: { amount: true },
      })
      monthCostsSum = mc._sum.amount || 0
    } catch (e: any) {
      console.error('[Dashboard] monthCosts failed:', e?.message)
      errors.push('monthCosts')
      // Fallback: try raw sum
      try {
        const allCosts = await db.cost.findMany({
          where: { date: { gte: monthStart } },
          select: { amount: true },
        })
        monthCostsSum = allCosts.reduce((sum, c) => sum + (c.amount || 0), 0)
      } catch (e2: any) {
        console.error('[Dashboard] monthCosts fallback also failed:', e2?.message)
      }
    }

    // ── 5. Total costs ──
    try {
      const tc = await db.cost.aggregate({ _sum: { amount: true } })
      totalCostsSum = tc._sum.amount || 0
    } catch (e: any) {
      console.error('[Dashboard] totalCosts failed:', e?.message)
      errors.push('totalCosts')
    }

    // ── 6. Total revenue ──
    try {
      const tr = await db.dailyReport.aggregate({
        where: { status: 'approved' },
        _sum: { dailyRevenue: true },
      })
      totalRevenueSum = tr._sum.dailyRevenue || 0
    } catch (e: any) {
      console.error('[Dashboard] totalRevenue failed:', e?.message)
      errors.push('totalRevenue')
      // Fallback: use monthReports + todayReports
      totalRevenueSum = revenueThisMonth
    }

    // ── 7. Stopped equipment ──
    try {
      stoppedEquipment = await db.equipment.count({
        where: { status: { in: ['stopped', 'maintenance_needed'] } },
      })
    } catch (e: any) {
      console.error('[Dashboard] stoppedEquipment failed:', e?.message)
      errors.push('stoppedEquipment')
    }

    // ── 8. Unread notifications ──
    try {
      unreadNotifications = await db.notification.count({ where: { read: false } })
    } catch (e: any) {
      console.error('[Dashboard] unreadNotifications failed:', e?.message)
      errors.push('unreadNotifications')
    }

    // ── 9. Production trend (last 14 days) ──
    try {
      const trendReports = await db.dailyReport.findMany({
        where: { reportDate: { gte: fourteenDaysAgo }, status: 'approved' },
        orderBy: { reportDate: 'asc' },
        select: { reportDate: true, dailyMeters: true, dailyRevenue: true, projectId: true },
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
    } catch (e: any) {
      console.error('[Dashboard] trend failed:', e?.message)
      errors.push('trend')
    }

    // ── 10. Projects list ──
    try {
      projects = await db.project.findMany({
        select: { id: true, name: true, code: true, status: true, progress: true, totalLength: true, pricePerMeter: true, client: true },
      })
    } catch (e: any) {
      console.error('[Dashboard] projects failed:', e?.message)
      errors.push('projects')
    }

    // ── 11. Recent reports ──
    try {
      recentReports = await db.dailyReport.findMany({
        take: 10,
        orderBy: { reportDate: 'desc' },
        include: {
          project: { select: { name: true, code: true } },
          driveLine: { select: { lineNumber: true } },
        },
      })
    } catch (e: any) {
      console.error('[Dashboard] recentReports failed:', e?.message)
      errors.push('recentReports')
      // Fallback: without relations
      try {
        recentReports = await db.dailyReport.findMany({
          take: 10,
          orderBy: { reportDate: 'desc' },
        })
      } catch (e2: any) {
        console.error('[Dashboard] recentReports fallback failed:', e2?.message)
      }
    }

    // ── 12. Notifications ──
    try {
      notifications = await db.notification.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: { project: { select: { name: true } } },
      })
    } catch (e: any) {
      console.error('[Dashboard] notifications failed:', e?.message)
      errors.push('notifications')
    }

    // ── 13. Equipment list ──
    try {
      equipment = await db.equipment.findMany({
        include: { project: { select: { name: true } } },
      })
    } catch (e: any) {
      console.error('[Dashboard] equipment failed:', e?.message)
      errors.push('equipment')
      // Fallback: without relation
      try {
        equipment = await db.equipment.findMany()
      } catch (e2: any) {
        console.error('[Dashboard] equipment fallback failed:', e2?.message)
      }
    }

    // ── 14. Cost breakdown by category ──
    try {
      const costsByCategoryRaw = await db.cost.groupBy({
        by: ['category'],
        where: { date: { gte: monthStart } },
        _sum: { amount: true },
      })
      costsByCategory = costsByCategoryRaw.map((c) => ({
        category: c.category,
        amount: c._sum.amount || 0,
      }))
    } catch (e: any) {
      console.error('[Dashboard] costsByCategory failed:', e?.message)
      errors.push('costsByCategory')
      // Fallback: manual grouping
      try {
        const allMonthCosts = await db.cost.findMany({
          where: { date: { gte: monthStart } },
          select: { category: true, amount: true },
        })
        const catMap = new Map<string, number>()
        for (const c of allMonthCosts) {
          const cat = c.category || 'other'
          catMap.set(cat, (catMap.get(cat) || 0) + (c.amount || 0))
        }
        costsByCategory = Array.from(catMap.entries()).map(([category, amount]) => ({ category, amount }))
      } catch (e2: any) {
        console.error('[Dashboard] costsByCategory fallback failed:', e2?.message)
      }
    }

    // ── Build response ──
    const netProfit = totalRevenueSum - totalCostsSum

    return NextResponse.json({
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
      ...(errors.length > 0 ? { _partialErrors: errors } : {}),
    })
  } catch (error: any) {
    console.error('[Dashboard API] Fatal error:', error)
    return NextResponse.json(
      { error: 'dashboard_error', details: error?.message || 'Unknown error' },
      { status: 500 }
    )
  }
}
