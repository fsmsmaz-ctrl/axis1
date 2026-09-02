import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, safeDbOp } from '@/lib/api-helpers'

export async function GET(req: NextRequest) {
  var user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  var today = new Date()
  today.setHours(0, 0, 0, 0)
  var tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  var monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
  var monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999)

  // === 1. Active projects ===
  var apResult = await safeDbOp(
    () => db.project.count({ where: { status: 'in_progress' } }),
    'المشاريع النشطة'
  )
  var activeProjects = apResult.success ? apResult.data : 0

  // === 2. Today's reports ===
  var todayReportsResult = await safeDbOp(
    () => db.dailyReport.findMany({
      where: { reportDate: { gte: today, lt: tomorrow }, status: 'approved' },
    }),
    'تقارير اليوم'
  )
  var todayReports = todayReportsResult.success ? todayReportsResult.data : []

  var metersToday = todayReports.reduce(function(sum: number, r: any) { return sum + (r.dailyMeters || 0) }, 0)
  var revenueToday = todayReports.reduce(function(sum: number, r: any) { return sum + (r.dailyRevenue || 0) }, 0)
  var presentWorkers = todayReports.reduce(function(sum: number, r: any) { return sum + (r.workersCount || 0) }, 0)

  // === 3. This month reports ===
  var monthReportsResult = await safeDbOp(
    () => db.dailyReport.findMany({
      where: { reportDate: { gte: monthStart }, status: 'approved' },
    }),
    'تقارير الشهر'
  )
  var monthReports = monthReportsResult.success ? monthReportsResult.data : []

  var metersThisMonth = monthReports.reduce(function(sum: number, r: any) { return sum + (r.dailyMeters || 0) }, 0)
  var revenueThisMonth = monthReports.reduce(function(sum: number, r: any) { return sum + (r.dailyRevenue || 0) }, 0)

  // === 4. Monthly costs ===
  var monthCostsResult = await safeDbOp(
    () => db.cost.aggregate({ where: { date: { gte: monthStart } }, _sum: { amount: true } }),
    'تكاليف الشهر'
  )
  var monthCostsSum = monthCostsResult.success ? (monthCostsResult.data._sum.amount || 0) : 0

  // === 5. Total costs ===
  var totalCostsResult = await safeDbOp(
    () => db.cost.aggregate({ _sum: { amount: true } }),
    'إجمالي التكاليف'
  )
  var totalCostsSum = totalCostsResult.success ? (totalCostsResult.data._sum.amount || 0) : 0

  // === 6. Total revenue ===
  var totalRevResult = await safeDbOp(
    () => db.dailyReport.aggregate({ where: { status: 'approved' }, _sum: { dailyRevenue: true } }),
    'إجمالي الإيرادات'
  )
  var totalRevenue = totalRevResult.success ? (totalRevResult.data._sum.dailyRevenue || 0) : 0

  // === 7. Stopped equipment ===
  var stoppedResult = await safeDbOp(
    () => db.equipment.count({ where: { status: { in: ['stopped', 'maintenance_needed'] } } }),
    'المعدات المتوقفة'
  )
  var stoppedEquipment = stoppedResult.success ? stoppedResult.data : 0

  // === 8. Unread notifications ===
  var unreadResult = await safeDbOp(
    () => db.notification.count({ where: { read: false } }),
    'التنبيهات'
  )
  var unreadNotifications = unreadResult.success ? unreadResult.data : 0

  // === 9. Production trend (last 14 days) ===
  var fourteenDaysAgo = new Date(today)
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14)

  var trendReportsResult = await safeDbOp(
    () => db.dailyReport.findMany({
      where: { reportDate: { gte: fourteenDaysAgo }, status: 'approved' },
      orderBy: { reportDate: 'asc' },
      select: { reportDate: true, dailyMeters: true, dailyRevenue: true, projectId: true },
    }),
    'تاريخ الإنتاج'
  )
  var trendReports = trendReportsResult.success ? trendReportsResult.data : []

  var trendCostsResult = await safeDbOp(
    () => db.cost.findMany({
      where: { date: { gte: fourteenDaysAgo } },
      select: { date: true, amount: true },
    }),
    'تكاليف الفترة'
  )
  var trendCosts = trendCostsResult.success ? trendCostsResult.data : []

  var trendMap = new Map<string, { meters: number; revenue: number; cost: number }>()
  for (var ri = 0; ri < trendReports.length; ri++) {
    var r = trendReports[ri]
    var key = r.reportDate.toISOString().split('T')[0]
    if (!trendMap.has(key)) trendMap.set(key, { meters: 0, revenue: 0, cost: 0 })
    var item = trendMap.get(key)
    if (item) { item.meters += r.dailyMeters || 0; item.revenue += r.dailyRevenue || 0 }
  }
  for (var ci = 0; ci < trendCosts.length; ci++) {
    var c = trendCosts[ci]
    var cKey = c.date.toISOString().split('T')[0]
    if (!trendMap.has(cKey)) trendMap.set(cKey, { meters: 0, revenue: 0, cost: 0 })
    var cItem = trendMap.get(cKey)
    if (cItem) { cItem.cost += c.amount || 0 }
  }
  var trend = Array.from(trendMap.entries())
    .sort(function(a, b) { return a[0].localeCompare(b[0]) })
    .map(function(entry) { return { date: entry[0], meters: entry[1].meters, revenue: entry[1].revenue, cost: entry[1].cost } })

  // === 10. Projects ===
  var projectsResult = await safeDbOp(
    () => db.project.findMany({
      select: { id: true, name: true, code: true, status: true, progress: true, totalLength: true, pricePerMeter: true, client: true },
    }),
    'المشاريع'
  )
  var projects = projectsResult.success ? projectsResult.data : []

  // === 11. Recent reports ===
  var recentResult = await safeDbOp(
    () => db.dailyReport.findMany({
      take: 10, orderBy: { reportDate: 'desc' },
      include: { project: { select: { name: true, code: true } }, driveLine: { select: { lineNumber: true } } },
    }),
    'آخر التقارير'
  )
  var recentReports = recentResult.success ? recentResult.data : []

  // === 12. Notifications ===
  var notifsResult = await safeDbOp(
    () => db.notification.findMany({
      take: 5, orderBy: { createdAt: 'desc' },
      include: { project: { select: { name: true } } },
    }),
    'التنبيهات'
  )
  var notifications = notifsResult.success ? notifsResult.data : []

  // === 13. Equipment ===
  var equipResult = await safeDbOp(
    () => db.equipment.findMany({ include: { project: { select: { name: true } } } }),
    'المعدات'
  )
  var equipment = equipResult.success ? equipResult.data : []

  // === 14. Rental assets (monthly) ===
  var activeRentalsResult = await safeDbOp(
    () => db.companyAsset.findMany({
      where: {
        ownership: 'rented', rentalCost: { gt: 0 },
        status: { notIn: ['returned', 'damaged'] },
        OR: [
          { rentalStart: null, rentalEnd: null },
          { rentalStart: null, rentalEnd: { gte: monthStart } },
          { rentalStart: { lte: monthEnd }, rentalEnd: null },
          { rentalStart: { lte: monthEnd }, rentalEnd: { gte: monthStart } },
        ],
      },
      select: { rentalCost: true, name: true, supplier: true, project: { select: { name: true } } },
    }),
    'الأصول المستأجرة'
  )
  var activeRentals = activeRentalsResult.success ? activeRentalsResult.data : []
  var monthlyRentalCost = activeRentals.reduce(function(sum: number, a: any) { return sum + (a.rentalCost || 0) }, 0)

  // === 15. Cost breakdown by category ===
  var catResult = await safeDbOp(
    () => db.cost.groupBy({
      by: ['category'], where: { date: { gte: monthStart } }, _sum: { amount: true },
    }),
    'تصنيف التكاليف'
  )
  var costsByCategory = catResult.success
    ? catResult.data.map(function(c: any) { return { category: c.category, amount: c._sum.amount || 0 } })
    : []
  if (monthlyRentalCost > 0) {
    var existingRental = costsByCategory.find(function(c) { return c.category === 'rental' })
    if (existingRental) { existingRental.amount += monthlyRentalCost }
    else { costsByCategory.push({ category: 'rental', amount: monthlyRentalCost }) }
  }

  // === 16. All-time rental total ===
  var allRentalsResult = await safeDbOp(
    () => db.companyAsset.findMany({
      where: { ownership: 'rented', rentalCost: { gt: 0 }, status: { notIn: ['returned', 'damaged'] } },
      select: { rentalCost: true },
    }),
    'إجمالي الإيجارات'
  )
  var allTimeRentalTotal = allRentalsResult.success
    ? allRentalsResult.data.reduce(function(sum: number, a: any) { return sum + (a.rentalCost || 0) }, 0)
    : 0

  var totalWithRentals = totalCostsSum + allTimeRentalTotal
  var netProfit = totalRevenue - totalWithRentals

  return NextResponse.json({
    stats: {
      activeProjects,
      totalProjects: projects.length,
      metersToday,
      metersThisMonth,
      revenueToday,
      revenueThisMonth,
      totalRevenue,
      totalCosts: totalWithRentals,
      monthCosts: monthCostsSum + monthlyRentalCost,
      monthlyRentalCost,
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
    rentalAssets: activeRentals.map(function(a: any) {
      return { name: a.name, supplier: a.supplier || '-', rentalCost: a.rentalCost || 0, projectName: a.project ? a.project.name : '-' }
    }),
  })
}
