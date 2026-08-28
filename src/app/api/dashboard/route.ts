import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, safeDbOp } from '@/lib/api-helpers'

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

  var projectWhere: any = {}
  if (user.role === 'foreman') {
    projectWhere = { OR: [{ managerId: user.id }, { engineerId: user.id }] }
  } else if (user.role === 'site_engineer') {
    projectWhere = { engineerId: user.id }
  } else if (user.role === 'project_manager') {
    projectWhere = { managerId: user.id }
  }

  var userProjectIds: string[] | null = null
  if (user.role === 'foreman' || user.role === 'site_engineer' || user.role === 'project_manager') {
    var userProjectsResult = await safeDbOp(
      () => db.project.findMany({ where: projectWhere, select: { id: true } }),
      'جلب مشاريع المستخدم'
    )
    if (!userProjectsResult.success) return userProjectsResult.response
    userProjectIds = userProjectsResult.data.map(function(p: any) { return p.id })
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

  var notifWhere: any = {}
  if (user.role !== 'top_management' && user.role !== 'project_manager') {
    notifWhere = { OR: [{ userId: user.id }, { userId: null }] }
  }

  const [
    activeProjectsResult, todayAggResult, monthAggResult, monthCostsResult,
    totalCostsResult, totalRevenueResult, stoppedEquipmentResult,
    unreadNotificationsResult, trendReportsResult, trendCostsGroupedResult,
    projectsResult, recentReportsResult, notificationsResult, equipmentResult, costsByCategoryRawResult,
  ] = await Promise.all([
    safeDbOp(() => db.project.count({ where: { ...projectWhere, status: 'in_progress' } }), 'عد المشاريع النشطة'),
    safeDbOp(() => db.dailyReport.aggregate({ where: todayReportWhere, _sum: { dailyMeters: true, dailyRevenue: true, workersCount: true }, _count: true }), 'إحصائيات اليوم'),
    safeDbOp(() => db.dailyReport.aggregate({ where: monthReportWhere, _sum: { dailyMeters: true, dailyRevenue: true } }), 'إحصائيات الشهر'),
    safeDbOp(() => db.cost.aggregate({ where: costMonthWhere, _sum: { amount: true } }), 'تكاليف الشهر'),
    safeDbOp(() => db.cost.aggregate({ where: costTotalWhere, _sum: { amount: true } }), 'إجمالي التكاليف'),
    safeDbOp(() => db.dailyReport.aggregate({ where: { status: 'approved', ...(userProjectIds ? { projectId: { in: userProjectIds } } : {}) }, _sum: { dailyRevenue: true } }), 'إجمالي الإيرادات'),
    safeDbOp(() => db.equipment.count({ where: { status: { in: ['stopped', 'maintenance_needed'] } } }), 'عد المعدات المتوقفة'),
    safeDbOp(() => db.notification.count({ where: { ...notifWhere, read: false } }), 'عد الإشعارات غير المقروءة'),
    safeDbOp(() => db.dailyReport.findMany({ where: trendReportWhere, orderBy: { reportDate: 'asc' }, select: { reportDate: true, dailyMeters: true, dailyRevenue: true } }), 'تقارير الاتجاه'),
    safeDbOp(() => db.cost.groupBy({ by: ['date'], where: costTrendWhere, _sum: { amount: true } }), 'تكاليف الاتجاه'),
    safeDbOp(() => db.project.findMany({ where: projectWhere, select: { id: true, name: true, code: true, status: true, totalLength: true, pricePerMeter: true, client: true }, take: 50, orderBy: { status: 'desc' } }), 'قائمة المشاريع'),
    safeDbOp(() => db.dailyReport.findMany({ where: userProjectIds ? { projectId: { in: userProjectIds } } : {}, take: 10, orderBy: { reportDate: 'desc' }, include: { project: { select: { name: true, code: true } }, driveLine: { select: { lineNumber: true } } } }), 'آخر التقارير'),
    safeDbOp(() => db.notification.findMany({ where: notifWhere, take: 5, orderBy: { createdAt: 'desc' }, include: { project: { select: { name: true } } } }), 'آخر الإشعارات'),
    safeDbOp(() => db.equipment.findMany({ take: 30, orderBy: { name: 'asc' }, include: { project: { select: { name: true } } } }), 'قائمة المعدات'),
    safeDbOp(() => db.cost.groupBy({ by: ['category'], where: costMonthWhere, _sum: { amount: true } }), 'تكاليف حسب التصنيف'),
  ])

  if (!activeProjectsResult.success) return activeProjectsResult.response
  if (!todayAggResult.success) return todayAggResult.response
  if (!monthAggResult.success) return monthAggResult.response
  if (!projectsResult.success) return projectsResult.response

  const activeProjects = activeProjectsResult.data
  const todayAgg = todayAggResult.data
  const monthAgg = monthAggResult.success ? monthAggResult.data : { _sum: { dailyMeters: 0, dailyRevenue: 0 } }
  const monthCostsResult_data = monthCostsResult.success ? monthCostsResult.data : { _sum: { amount: 0 } }
  const totalCostsResult_data = totalCostsResult.success ? totalCostsResult.data : { _sum: { amount: 0 } }
  const totalRevenueResult_data = totalRevenueResult.success ? totalRevenueResult.data : { _sum: { dailyRevenue: 0 } }
  const stoppedEquipment = stoppedEquipmentResult.success ? stoppedEquipmentResult.data : 0
  const unreadNotifications = unreadNotificationsResult.success ? unreadNotificationsResult.data : 0
  const trendReports = trendReportsResult.success ? trendReportsResult.data : []
  const trendCostsGrouped = trendCostsGroupedResult.success ? trendCostsGroupedResult.data : []
  const projects = projectsResult.data
  const recentReports = recentReportsResult.success ? recentReportsResult.data : []
  const notifications = notificationsResult.success ? notificationsResult.data : []
  const equipment = equipmentResult.success ? equipmentResult.data : []
  const costsByCategoryRaw = costsByCategoryRawResult.success ? costsByCategoryRawResult.data : []

  const metersToday = todayAgg._sum.dailyMeters || 0
  const revenueToday = todayAgg._sum.dailyRevenue || 0
  const presentWorkers = todayAgg._sum.workersCount || 0
  const metersThisMonth = monthAgg._sum.dailyMeters || 0
  const revenueThisMonth = monthAgg._sum.dailyRevenue || 0

  // ========== SIMPLE PROGRESS: sum of all dailyMeters per project ==========
  var dynamicProgress: Record<string, number> = {}
  var projectIds = projects.map(function(p: any) { return p.id })

  if (projectIds.length > 0) {
    try {
      // Fetch all dailyMeters for these projects (ALL statuses, not just approved)
      var allReports = await db.dailyReport.findMany({
        where: { projectId: { in: projectIds } },
        select: { projectId: true, dailyMeters: true },
      })

      var metersMap: Record<string, number> = {}
      for (var mi = 0; mi < allReports.length; mi++) {
        var mr = allReports[mi]
        if (!metersMap[mr.projectId]) metersMap[mr.projectId] = 0
        metersMap[mr.projectId] += mr.dailyMeters || 0
      }

      // Calculate progress for each project
      for (var pi = 0; pi < projects.length; pi++) {
        var p = projects[pi]
        var totalLen = p.totalLength || 0
        var completedMeters = metersMap[p.id] || 0
        if (totalLen > 0) {
          dynamicProgress[p.id] = Math.min((completedMeters / totalLen) * 100, 100)
        } else {
          dynamicProgress[p.id] = 0
        }
      }

      // Update stored progress in DB (fire-and-forget)
      var updatePromises: Promise<any>[] = []
      for (var ui = 0; ui < projectIds.length; ui++) {
        var upId = projectIds[ui]
        var newProg = dynamicProgress[upId]
        ;(function(pid: string, prog: number) {
          updatePromises.push(
            db.project.update({ where: { id: pid }, data: { progress: prog } }).catch(function() { return null })
          )
        })(upId, newProg)
      }
      Promise.all(updatePromises).catch(function() {})
    } catch (err) {
      console.error('[Dashboard] Progress calc error:', err)
    }
  }

  for (var pp = 0; pp < projects.length; pp++) {
    projects[pp].progress = dynamicProgress[projects[pp].id] || 0
  }

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
  const costsByCategory = costsByCategoryRaw.map((c: any) => ({ category: c.category, amount: c._sum.amount || 0 }))

  const totalRevenue = totalRevenueResult_data._sum.dailyRevenue || 0
  const totalCostAmount = totalCostsResult_data._sum.amount || 0
  const monthCostAmount = monthCostsResult_data._sum.amount || 0
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
    return handleDbError(error, 'لوحة المعلومات')
  }
}
