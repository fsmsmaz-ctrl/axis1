'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import {
  Activity, TrendingUp, TrendingDown, DollarSign, Wallet,
  Users, AlertTriangle, Wrench, FolderKanban, ArrowLeft,
  Trophy, AlertCircle, Calendar, Cpu, RefreshCw, Receipt, Check, X, Loader2
} from 'lucide-react'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, BarChart, Bar, PieChart, Pie, Cell, Legend
} from 'recharts'
import { useAppStore } from '@/lib/store'
import { authedFetch } from '@/lib/api-client'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { canViewPricing, canAccessDashboard } from '@/lib/auth'
import { reportDayName } from '@/lib/day-name'

interface DashboardData {
  stats: {
    activeProjects: number
    totalProjects: number
    metersToday: number
    metersThisMonth: number
    revenueToday: number
    revenueThisMonth: number
    totalRevenue: number
    totalCosts: number
    monthCosts: number
    netProfit: number
    stoppedEquipment: number
    presentWorkers: number
    unreadNotifications: number
  }
  trend: Array<{ date: string; meters: number; revenue: number; cost: number }>
  projects: Array<{ id: string; name: string; code: string; status: string; progress: number; totalLength: number; pricePerMeter: number; client: string }>
  recentReports: any[]
  notifications: any[]
  equipment: any[]
  costsByCategory: Array<{ category: string; amount: number }>
}

const categoryColors: Record<string, string> = {
  labor: '#f97316',
  fuel: '#06b6d4',
  maintenance: '#8b5cf6',
  transport: '#10b981',
  housing: '#f59e0b',
  parts: '#ec4899',
  oil: '#6366f1',
  safety: '#ef4444',
  rental: '#14b8a6',
  other: '#64748b',
}

const categoryLabelsAr: Record<string, string> = {
  labor: 'أجور العمال',
  fuel: 'ديزل',
  maintenance: 'صيانة',
  transport: 'نقل',
  housing: 'سكن',
  parts: 'قطع غيار',
  oil: 'زيوت',
  safety: 'سلامة',
  rental: 'إيجار',
  other: 'أخرى',
}

export default function DashboardPage({ onNavigate }: { onNavigate: (page: any) => void }) {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [recalculating, setRecalculating] = useState(false)
  // v36: نطاق توزيع التكاليف — الفواتير المسترجعة تحمل تواريخها الأصلية (قد تكون لأشهر سابقة)
  const [costsPeriod, setCostsPeriod] = useState<'month' | 'year' | 'all'>('month')
  const language = useAppStore((s) => s.language)
  const token = useAppStore((s) => s.token)
  const user = useAppStore((s) => s.user)
  // v16 (قرار صاحب الموقع): لوحة التحكم ببياناتها المالية الكاملة —
  // الإيرادات وصافي الربح والرسوم تعود لكل من يملك صلاحية الوصول إلى
  // اللوحة أصلاً: مدير النظام (admin@axis.om) والإدارة العليا.
  // استثناء المشرف العام من الأسعار يبقى سارياً في بقية الأقسام كما هو.
  const seePricing = !!(user && (canViewPricing(user) || canAccessDashboard(user)))
  // v48: مراجعو الفواتير — الإدارة العليا ومدير النظام فقط
  const canReviewInvoices = !!(user && (user.role === 'top_management' || user.isSystemAdmin))
  const isRtl = language === 'ar'

  async function fetchDashboard() {
    setLoading(true)
    setError(null)
    try {
      // Add a 15-second timeout — if the API is slower than that, the user
      // should see a retry button rather than staring at a spinner forever.
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 15000)
      const r = await authedFetch('/api/dashboard?costsPeriod=' + costsPeriod, { signal: controller.signal })
      clearTimeout(timeout)
      if (!r.ok) {
        const body = await r.json().catch(function() { return {} })
        throw new Error(body?.details || body?.error || 'Error ' + r.status)
      }
      const d = await r.json()
      if (d.error) {
        throw new Error(d.details || d.error)
      }
      setData(d)
      // Log diagnostics if there are 0 today-reports — helps the user
      // understand whether 0 is "no reports yet" vs "data problem".
      if (d._diagnostics && d._diagnostics.todayReportsTotal === 0) {
        console.info('[Dashboard] No reports found for today — values may legitimately be 0.')
      }
    } catch (e: any) {
      console.error('[Dashboard]', e)
      const msg = e?.name === 'AbortError'
        ? (isRtl ? 'انتهت مهلة الطلب — تحقق من سرعة الإنترنت' : 'Request timed out — check your connection')
        : (e.message || (isRtl ? 'خطأ في تحميل البيانات' : 'Failed to load data'))
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchDashboard()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, costsPeriod])

  // Recalculate all progress & revenue. Available to top_management and
  // project_manager. Useful when the dashboard shows 0 because some old
  // reports have stale dailyMeters / dailyRevenue values.
  async function recalcAll() {
    setRecalculating(true)
    try {
      const r = await authedFetch('/api/admin/recalc-all', { method: 'POST' })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) {
        throw new Error(body?.message || body?.error || ('Error ' + r.status))
      }
      // Refresh the dashboard with the freshly recomputed numbers.
      await fetchDashboard()
      // Use a console.info rather than toast to avoid importing sonner here.
      console.info('[Dashboard] Recalc done:', body.results)
    } catch (e: any) {
      console.error('[Dashboard] recalc failed:', e)
      setError(e.message || (isRtl ? 'فشل إعادة الحساب' : 'Recalc failed'))
    } finally {
      setRecalculating(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        {/* Quick-loading skeleton: show the layout structure so the user
            immediately sees what's coming instead of a blank page. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(function(i) {
            return (
              <Card key={i}>
                <CardContent className="p-5">
                  <div className="flex justify-between">
                    <div className="space-y-2 flex-1">
                      <div className="h-3 bg-muted animate-pulse rounded w-3/4" />
                      <div className="h-7 bg-muted animate-pulse rounded w-1/2" />
                      <div className="h-3 bg-muted animate-pulse rounded w-2/3" />
                    </div>
                    <div className="w-10 h-10 rounded-lg bg-muted animate-pulse" />
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-2">
            <CardContent className="p-6 h-[360px] bg-muted/30 animate-pulse rounded" />
          </Card>
          <Card>
            <CardContent className="p-6 h-[360px] bg-muted/30 animate-pulse rounded" />
          </Card>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <Card className="border-red-200 bg-red-50/50">
        <CardContent className="flex flex-col items-center justify-center py-12 gap-4">
          <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center">
            <AlertCircle className="h-7 w-7 text-red-600" />
          </div>
          <div className="text-center">
            <p className="font-semibold text-red-800">{isRtl ? 'فشل تحميل لوحة التحكم' : 'Failed to load dashboard'}</p>
            <p className="text-sm text-red-600/80 mt-1 max-w-md">{error}</p>
          </div>
          <Button variant="outline" onClick={fetchDashboard}>
            {isRtl ? 'إعادة المحاولة' : 'Retry'}
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (!data) return null

  const stats = data.stats || {
    activeProjects: 0, totalProjects: 0, metersToday: 0, metersThisMonth: 0,
    revenueToday: 0, revenueThisMonth: 0, totalRevenue: 0, totalCosts: 0,
    monthCosts: 0, netProfit: 0, stoppedEquipment: 0, presentWorkers: 0,
    unreadNotifications: 0,
  }
  const projects = Array.isArray(data.projects) ? data.projects : []
  const trend = Array.isArray(data.trend) ? data.trend : []
  const recentReports = Array.isArray(data.recentReports) ? data.recentReports : []
  const notifications = Array.isArray(data.notifications) ? data.notifications : []
  const equipment = Array.isArray(data.equipment) ? data.equipment : []
  const costsByCategory = Array.isArray(data.costsByCategory) ? data.costsByCategory : []

  const fmt = function(n: number) { return (n || 0).toLocaleString(isRtl ? 'ar-EG' : 'en-US', { maximumFractionDigits: 1 }) }
  const fmtCurrency = function(n: number) { return fmt(n || 0) + ' ' + (isRtl ? 'ر.ع' : 'OMR') }

  const sortedByProgress = [...projects].sort(function(a, b) { return (b.progress || 0) - (a.progress || 0) })
  const bestProject = sortedByProgress[0]
  const worstProject = sortedByProgress[sortedByProgress.length - 1]

  const trendData = trend.map(function(t) {
    return {
      ...t,
      date: new Date(t.date).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US', { month: 'short', day: 'numeric' }),
      profit: (t.revenue || 0) - (t.cost || 0),
    }
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">{isRtl ? 'لوحة التحكم' : 'Dashboard'}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isRtl ? 'نظرة عامة على جميع المشاريع والعمليات' : 'Overview of all projects and operations'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Recalculate button — fixes 0 values by recomputing dailyMeters
              and dailyRevenue from startReading/endReading for every report,
              then invalidates the dashboard cache. Visible to admins only. */}
          {(user?.role === 'top_management' || user?.role === 'project_manager') && (
            <Button
              variant="outline"
              size="sm"
              onClick={recalcAll}
              disabled={recalculating}
              title={isRtl ? 'إعادة حساب جميع البيانات (يصلح القيم 0)' : 'Recalculate all data (fixes 0 values)'}
            >
              <RefreshCw className={'h-4 w-4 ml-2 ' + (recalculating ? 'animate-spin' : '')} />
              {recalculating
                ? (isRtl ? 'جارٍ التحديث...' : 'Recalculating...')
                : (isRtl ? 'تحديث البيانات' : 'Recalc Data')}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={fetchDashboard}>
            <RefreshCw className="h-4 w-4 ml-2" />
            {isRtl ? 'تحديث' : 'Refresh'}
          </Button>
          <Button variant="outline" size="sm" onClick={function() { onNavigate('reports') }}>
            <Calendar className="h-4 w-4 ml-2" />
            {isRtl ? 'التقارير' : 'Reports'}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={FolderKanban}
          label={isRtl ? 'المشاريع النشطة' : 'Active Projects'}
          value={'' + stats.activeProjects}
          subtext={(isRtl ? 'من إجمالي ' : 'of ') + stats.totalProjects}
          color="text-orange-600"
          bgColor="bg-orange-50"
        />
        <StatCard
          icon={Activity}
          label={isRtl ? 'الأمتار اليوم' : 'Meters Today'}
          value={fmt(stats.metersToday) + ' ' + (isRtl ? 'م' : 'm')}
          subtext={fmt(stats.metersThisMonth) + ' ' + (isRtl ? 'م هذا الشهر' : 'm this month')}
          color="text-blue-600"
          bgColor="bg-blue-50"
        />
        {seePricing ? (
        <StatCard
          icon={DollarSign}
          label={isRtl ? 'الإيرادات' : 'Revenue'}
          value={fmtCurrency(stats.totalRevenue)}
          subtext={fmtCurrency(stats.revenueThisMonth) + ' ' + (isRtl ? 'هذا الشهر' : 'this month')}
          color="text-emerald-600"
          bgColor="bg-emerald-50"
        />
        ) : (
        // v14.2: بدل الإيرادات — التكاليف الكلية (الإيرادات سرية للمشرف وغيره)
        <StatCard
          icon={Wallet}
          label={isRtl ? 'التكاليف' : 'Costs'}
          value={fmtCurrency(stats.totalCosts)}
          subtext={fmtCurrency(stats.monthCosts) + ' ' + (isRtl ? 'هذا الشهر' : 'this month')}
          color="text-purple-600"
          bgColor="bg-purple-50"
        />
        )}
        {seePricing && (
        <StatCard
          icon={Wallet}
          label={isRtl ? 'صافي الربح' : 'Net Profit'}
          value={fmtCurrency(stats.netProfit)}
          subtext={stats.netProfit >= 0 ? ('+' + ((stats.netProfit / Math.max(stats.totalRevenue, 1)) * 100).toFixed(1) + '% ' + (isRtl ? 'هامش' : 'margin')) : ''}
          color={stats.netProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}
          bgColor={stats.netProfit >= 0 ? 'bg-emerald-50' : 'bg-red-50'}
        />
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <MiniStat icon={Users} label={isRtl ? 'العمال اليوم' : 'Workers Today'} value={'' + stats.presentWorkers} color="text-blue-600" />
        <MiniStat icon={Wrench} label={isRtl ? 'معدات متوقفة' : 'Stopped Eq.'} value={'' + stats.stoppedEquipment} color="text-red-600" />
        <MiniStat icon={AlertTriangle} label={isRtl ? 'تنبيهات' : 'Alerts'} value={'' + stats.unreadNotifications} color="text-orange-600" />
        {seePricing && (
        <MiniStat icon={TrendingUp} label={isRtl ? 'الإيراد اليوم' : "Today's Rev."} value={fmtCurrency(stats.revenueToday)} color="text-emerald-600" />
        )}
        <MiniStat icon={Wallet} label={isRtl ? 'إجمالي التكاليف' : 'Total Costs'} value={fmtCurrency(stats.totalCosts)} color="text-purple-700" />
        <MiniStat icon={TrendingDown} label={isRtl ? 'تكاليف الشهر' : 'Month Costs'} value={fmtCurrency(stats.monthCosts)} color="text-purple-600" />
        <MiniStat icon={Activity} label={isRtl ? 'أمتار الشهر' : 'Month Meters'} value={fmt(stats.metersThisMonth) + ' م'} color="text-cyan-600" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" />
              {isRtl ? 'اتجاه الإنتاج (آخر 14 يوم)' : 'Production Trend (Last 14 days)'}
            </CardTitle>
            <CardDescription>
              {seePricing
                ? (isRtl ? 'الأمتار المنجزة والإيرادات اليومية' : 'Daily meters drilled and revenue')
                : (isRtl ? 'الأمتار المنجزة يومياً' : 'Daily meters drilled')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={trendData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <defs>
                  <linearGradient id="colorMeters" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f97316" stopOpacity={0.8} />
                    <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.6} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#6b7280' }} reversed={isRtl} />
                <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} orientation={isRtl ? 'right' : 'left'} />
                <Tooltip
                  contentStyle={{ direction: isRtl ? 'rtl' : 'ltr', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12 }}
                  formatter={function(value: any, name: any) {
                    if (name === 'meters') return [fmt(value) + ' ' + (isRtl ? 'م' : 'm'), isRtl ? 'الأمتار' : 'Meters']
                    if (name === 'revenue') return [fmtCurrency(value), isRtl ? 'الإيراد' : 'Revenue']
                    if (name === 'cost') return [fmtCurrency(value), isRtl ? 'التكلفة' : 'Cost']
                    if (name === 'profit') return [fmtCurrency(value), isRtl ? 'الربح' : 'Profit']
                    return [value, name]
                  }}
                />
                <Area type="monotone" dataKey="meters" stroke="#f97316" fillOpacity={1} fill="url(#colorMeters)" strokeWidth={2} />
                {seePricing && (
                <Area type="monotone" dataKey="revenue" stroke="#10b981" fillOpacity={1} fill="url(#colorRevenue)" strokeWidth={2} />
                )}
                {/* v36: خط التكاليف اليومية في المنحنى */}
                {seePricing && (
                <Area type="monotone" dataKey="cost" stroke="#8b5cf6" fillOpacity={0} strokeWidth={2} strokeDasharray="4 3" />
                )}
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5 text-primary" />
              {isRtl ? 'توزيع التكاليف' : 'Cost Breakdown'}
            </CardTitle>
            <CardDescription>
              {isRtl
                ? (costsPeriod === 'month' ? 'حسب الفئة - هذا الشهر' : costsPeriod === 'year' ? 'حسب الفئة - هذا العام' : 'حسب الفئة - كل الفترات')
                : (costsPeriod === 'month' ? 'By category - this month' : costsPeriod === 'year' ? 'By category - this year' : 'By category - all time')}
            </CardDescription>
            {/* v36: الفواتير المسترجعة تحمل تواريخ تسجيلها الأصلية — بدّل النطاق لرؤيتها كلها */}
            <div className="flex gap-1.5 mt-1">
              <Button type="button" size="sm" variant={costsPeriod === 'month' ? 'default' : 'outline'} onClick={function() { setCostsPeriod('month') }}>
                {isRtl ? 'الشهر' : 'Month'}
              </Button>
              <Button type="button" size="sm" variant={costsPeriod === 'year' ? 'default' : 'outline'} onClick={function() { setCostsPeriod('year') }}>
                {isRtl ? 'العام' : 'Year'}
              </Button>
              <Button type="button" size="sm" variant={costsPeriod === 'all' ? 'default' : 'outline'} onClick={function() { setCostsPeriod('all') }}>
                {isRtl ? 'كل الفترات' : 'All time'}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {costsByCategory.length === 0 ? (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground text-sm">
                {isRtl ? 'لا توجد بيانات' : 'No data'}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={costsByCategory}
                    dataKey="amount"
                    nameKey="category"
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={2}
                  >
                    {costsByCategory.map(function(entry, idx) {
                      return <Cell key={idx} fill={categoryColors[entry.category] || '#94a3b8'} />
                    })}
                  </Pie>
                  <Tooltip
                    contentStyle={{ direction: isRtl ? 'rtl' : 'ltr', borderRadius: 8, fontSize: 12 }}
                    formatter={function(value: any, _name: any, props: any) { return [fmtCurrency(value), categoryLabelsAr[props.payload.category] || props.payload.category] }}
                  />
                  <Legend
                    formatter={function(value) { return categoryLabelsAr[value] || value }}
                    wrapperStyle={{ fontSize: 11 }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <FolderKanban className="h-5 w-5 text-primary" />
                {isRtl ? 'تقدم المشاريع' : 'Project Progress'}
              </span>
              <Button variant="ghost" size="sm" onClick={function() { onNavigate('projects') }}>
                {isRtl ? 'عرض الكل' : 'View all'}
                <ArrowLeft className="h-4 w-4 mr-1 rtl:rotate-180" />
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 max-h-80 overflow-y-auto">
            {projects.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                {isRtl ? 'لا توجد مشاريع' : 'No projects'}
              </div>
            ) : (
              projects.map(function(p) {
                return (
                  <div key={p.id} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{p.name}</p>
                        <p className="text-xs text-muted-foreground">{p.code} • {p.client}</p>
                      </div>
                      <div className="text-left shrink-0">
                        <span className="font-semibold text-sm">{p.progress.toFixed(1)}%</span>
                      </div>
                    </div>
                    <Progress value={p.progress} className="h-2" />
                  </div>
                )
              })
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          {bestProject && (
            <Card className="bg-gradient-to-br from-emerald-50 to-emerald-50/50 border-emerald-200">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0">
                    <Trophy className="h-5 w-5 text-emerald-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-emerald-700 font-medium">{isRtl ? 'أفضل مشروع' : 'Best Project'}</p>
                    <p className="font-semibold truncate mt-0.5">{bestProject.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{bestProject.progress.toFixed(1)}% {isRtl ? 'إنجاز' : 'complete'}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {worstProject && worstProject.id !== bestProject?.id && (
            <Card className="bg-gradient-to-br from-orange-50 to-orange-50/50 border-orange-200">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-orange-100 flex items-center justify-center shrink-0">
                    <AlertCircle className="h-5 w-5 text-orange-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-orange-700 font-medium">{isRtl ? 'أقل مشروع أداءً' : 'Worst Project'}</p>
                    <p className="font-semibold truncate mt-0.5">{worstProject.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{worstProject.progress.toFixed(1)}% {isRtl ? 'إنجاز' : 'complete'}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {stats.stoppedEquipment > 0 && (
            <Card className="bg-red-50/50 border-red-200">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-red-100 flex items-center justify-center shrink-0">
                    <Wrench className="h-5 w-5 text-red-600" />
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-sm">{stats.stoppedEquipment} {isRtl ? 'معدة متوقفة' : 'Stopped Equipment'}</p>
                    <Button variant="link" size="sm" className="p-0 h-auto text-xs" onClick={function() { onNavigate('equipment') }}>
                      {isRtl ? 'عرض التفاصيل' : 'View details'}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Calendar className="h-5 w-5 text-primary" />
                {isRtl ? 'التقارير الأخيرة' : 'Recent Reports'}
              </span>
              <Button variant="ghost" size="sm" onClick={function() { onNavigate('dailyReports') }}>
                {isRtl ? 'عرض الكل' : 'View all'}
                <ArrowLeft className="h-4 w-4 mr-1 rtl:rotate-180" />
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 max-h-80 overflow-y-auto">
            {recentReports.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                {isRtl ? 'لا توجد تقارير' : 'No reports'}
              </div>
            ) : (
              recentReports.slice(0, 8).map(function(r) {
                return (
                  <div key={r.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Calendar className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{r.project?.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(r.reportDate).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US')}
                        {/* v46: يوم التقرير — التقارير الأخيرة في لوحة التحكم */}
                        {reportDayName(r.reportDate, isRtl) && (
                          <span className="text-[10px] text-muted-foreground/80"> ({reportDayName(r.reportDate, isRtl)})</span>
                        )}
                        {' • '}{r.driveLine?.lineNumber || '-'}
                      </p>
                    </div>
                    <div className="text-left shrink-0">
                      <p className="font-semibold text-sm">{r.dailyMeters} {isRtl ? 'م' : 'm'}</p>
                      <Badge variant={r.status === 'approved' ? 'default' : r.status === 'rejected' ? 'destructive' : 'secondary'} className="text-xs">
                        {r.status === 'approved' ? (isRtl ? 'معتمد' : 'Approved') :
                         r.status === 'submitted' ? (isRtl ? 'مرسل' : 'Submitted') :
                         r.status === 'rejected' ? (isRtl ? 'مرفوض' : 'Rejected') :
                         (isRtl ? 'مسودة' : 'Draft')}
                      </Badge>
                    </div>
                  </div>
                )
              })
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Cpu className="h-5 w-5 text-primary" />
                {isRtl ? 'حالة المعدات' : 'Equipment Status'}
              </span>
              <Button variant="ghost" size="sm" onClick={function() { onNavigate('equipment') }}>
                {isRtl ? 'عرض الكل' : 'View all'}
                <ArrowLeft className="h-4 w-4 mr-1 rtl:rotate-180" />
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 max-h-80 overflow-y-auto">
            {equipment.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                {isRtl ? 'لا توجد معدات' : 'No equipment'}
              </div>
            ) : (
              equipment.map(function(eq) {
                return (
                  <div key={eq.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition">
                    <div className={'w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ' +
                      (eq.status === 'operational' ? 'bg-emerald-100' :
                       eq.status === 'stopped' ? 'bg-red-100' : 'bg-orange-100')}>
                      <Wrench className={'h-4 w-4 ' +
                        (eq.status === 'operational' ? 'text-emerald-600' :
                         eq.status === 'stopped' ? 'text-red-600' : 'text-orange-600')} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{eq.name}</p>
                      <p className="text-xs text-muted-foreground">{eq.number} • {eq.project?.name || '-'}</p>
                    </div>
                    <Badge variant={
                      eq.status === 'operational' ? 'default' :
                      eq.status === 'stopped' ? 'destructive' : 'secondary'
                    } className="text-xs">
                      {eq.status === 'operational' ? (isRtl ? 'تعمل' : 'Operational') :
                       eq.status === 'stopped' ? (isRtl ? 'متوقفة' : 'Stopped') :
                       (isRtl ? 'تحتاج صيانة' : 'Maintenance')}
                    </Badge>
                  </div>
                )
              })
            )}
          </CardContent>
        </Card>
      </div>

      {/* v48: مراجعة فواتير المشتريات — الإدارة العليا ومدير النظام فقط */}
      {canReviewInvoices && (
        <InvoicesReviewSection isRtl={isRtl} projects={(data && data.projects) || []} onChanged={fetchDashboard} />
      )}
    </div>
  )
}

function StatCard({
  icon: Icon, label, value, subtext, color, bgColor,
}: {
  icon: any; label: string; value: string; subtext?: string; color: string; bgColor: string
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm text-muted-foreground font-medium">{label}</p>
            <p className="text-2xl font-bold mt-1 truncate">{value}</p>
            {subtext && <p className="text-xs text-muted-foreground mt-1 truncate">{subtext}</p>}
          </div>
          <div className={'w-10 h-10 rounded-lg ' + bgColor + ' flex items-center justify-center shrink-0'}>
            <Icon className={'h-5 w-5 ' + color} />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function MiniStat({ icon: Icon, label, value, color }: { icon: any; label: string; value: string; color: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center gap-2">
          <Icon className={'h-4 w-4 ' + color + ' shrink-0'} />
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground truncate">{label}</p>
            <p className="font-semibold text-sm truncate">{value}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}



// v48: قسم مراجعة فواتير المشتريات — يظهر في لوحة التحكم للإدارة العليا ومدير النظام
// الاعتماد يسجل الفاتورة تلقائياً في التكاليف (اختيار المشروع والتصنيف عند الاعتماد)
function InvoicesReviewSection({ isRtl, projects, onChanged }: { isRtl: boolean; projects: any[]; onChanged: () => void }) {
  const [invoices, setInvoices] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [viewImg, setViewImg] = useState<string | null>(null)
  const [projSel, setProjSel] = useState<Record<string, string>>({})
  const [catSel, setCatSel] = useState<Record<string, string>>({})

  const catLabels: Record<string, string> = {
    labor: isRtl ? 'أجور العمال' : 'Labor', housing: isRtl ? 'إسكان' : 'Housing',
    transport: isRtl ? 'نقل' : 'Transport', fuel: isRtl ? 'وقود' : 'Fuel',
    maintenance: isRtl ? 'صيانة' : 'Maintenance', parts: isRtl ? 'قطع غيار' : 'Parts',
    oil: isRtl ? 'زيوت' : 'Oil', safety: isRtl ? 'سلامة' : 'Safety',
    rental: isRtl ? 'إيجار' : 'Rental', other: isRtl ? 'أخرى' : 'Other',
  }

  async function fetchInvoices() {
    setLoading(true)
    try {
      const r = await authedFetch('/api/invoices-review')
      const d = await r.json()
      if (r.ok) setInvoices(d.purchases || [])
    } catch {} finally {
      setLoading(false)
    }
  }

  useEffect(function() {
    fetchInvoices()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function review(inv: any, action: 'approve' | 'reject') {
    var note: string | null = null
    if (action === 'reject') {
      note = window.prompt(isRtl ? 'سبب الرفض (اختياري):' : 'Rejection reason (optional):')
      if (note === null) return
    }
    setBusyId(inv.id)
    try {
      const r = await authedFetch('/api/invoices-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: inv.id, action: action,
          note: note || undefined,
          projectId: projSel[inv.id] || undefined,
          category: catSel[inv.id] || undefined,
        }),
      })
      const d = await r.json()
      if (r.ok) {
        toast.success(action === 'approve'
          ? (isRtl ? 'اعتُمدت الفاتورة وسُجلت في التكاليف تلقائياً' : 'Approved and recorded in Costs')
          : (isRtl ? 'تم رفض الفاتورة' : 'Invoice rejected'))
        fetchInvoices()
        onChanged()
      } else {
        toast.error(d.message || (isRtl ? 'فشل تسجيل المراجعة' : 'Review failed'))
      }
    } catch {
      toast.error(isRtl ? 'خطأ في الاتصال' : 'Connection error')
    } finally {
      setBusyId(null)
    }
  }

  var pending = invoices.filter(function(p) { return p.status === 'submitted' })
  var reviewed = invoices.filter(function(p) { return p.status !== 'submitted' })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between flex-wrap gap-2">
          <span className="flex items-center gap-2">
            <Receipt className="h-5 w-5 text-primary" />
            {isRtl ? 'مراجعة فواتير المشتريات' : 'Purchase Invoices Review'}
            {pending.length > 0 && <Badge className="text-xs">{pending.length}</Badge>}
          </span>
          <Button variant="ghost" size="sm" onClick={fetchInvoices}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </CardTitle>
        <CardDescription>
          {isRtl ? 'مراجعة فواتير مشتريات الموظفين واعتمادها — الاعتماد يسجلها تلقائياً في قسم التكاليف' : 'Review employee purchase invoices — approval records them in Costs automatically'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 max-h-[500px] overflow-y-auto">
        {loading ? (
          <div className="h-20 bg-muted animate-pulse rounded-lg" />
        ) : invoices.length === 0 ? (
          <p className="text-center text-xs text-muted-foreground py-6">
            {isRtl ? 'لا توجد فواتير للمراجعة' : 'No invoices to review'}
          </p>
        ) : (
          <>
            {pending.map(function(p) {
              return (
                <div key={p.id} className="p-3 rounded-lg border border-amber-200 bg-amber-50/40">
                  <div className="flex items-center gap-3 flex-wrap">
                    {p.invoiceImage && (
                      <img src={p.invoiceImage} alt="invoice" className="h-14 w-14 rounded-lg object-cover border cursor-pointer shrink-0" onClick={function() { setViewImg(p.invoiceImage) }} />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm">
                        {p.title} — <span className="font-bold">{p.amount} ر.ع</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {isRtl ? 'الموظف' : 'Employee'}: {p.user ? (isRtl ? p.user.name : (p.user.nameEn || p.user.name)) : '-'}
                        {' • '}{p.submittedAt ? new Date(p.submittedAt).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US') : ''}
                        {p.notes ? (' • ' + p.notes) : ''}
                      </p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" disabled={busyId === p.id} onClick={function() { review(p, 'approve') }}>
                        {busyId === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4 ml-1" />}
                        {isRtl ? 'اعتماد' : 'Approve'}
                      </Button>
                      <Button size="sm" variant="destructive" disabled={busyId === p.id} onClick={function() { review(p, 'reject') }}>
                        <X className="h-4 w-4 ml-1" />
                        {isRtl ? 'رفض' : 'Reject'}
                      </Button>
                    </div>
                  </div>
                  {/* اختيار المشروع والتصنيف عند الاعتماد — يحدد سجل التكلفة */}
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <select
                      className="text-xs border rounded px-2 py-1 bg-background"
                      value={projSel[p.id] || ''}
                      onChange={function(e) { setProjSel(function(prev) { return { ...prev, [p.id]: e.target.value } }) }}
                    >
                      <option value="">{isRtl ? 'المشروع: بدون مشروع' : 'Project: none'}</option>
                      {projects.map(function(pr: any) {
                        return <option key={pr.id} value={pr.id}>{pr.name}</option>
                      })}
                    </select>
                    <select
                      className="text-xs border rounded px-2 py-1 bg-background"
                      value={catSel[p.id] || 'other'}
                      onChange={function(e) { setCatSel(function(prev) { return { ...prev, [p.id]: e.target.value } }) }}
                    >
                      {Object.keys(catLabels).map(function(k) {
                        return <option key={k} value={k}>{isRtl ? 'التصنيف: ' : 'Category: '}{catLabels[k]}</option>
                      })}
                    </select>
                    <button type="button" className="text-xs text-primary underline" onClick={function() { if (p.invoiceImage) setViewImg(p.invoiceImage) }}>
                      {isRtl ? 'عرض الفاتورة' : 'View invoice'}
                    </button>
                  </div>
                </div>
              )
            })}
            {reviewed.map(function(p) {
              return (
                <div key={p.id} className="p-2.5 rounded-lg border opacity-75">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium">{p.title} — {p.amount} ر.ع</p>
                    <Badge variant={p.status === 'approved' ? 'default' : 'destructive'} className="text-xs">
                      {p.status === 'approved' ? (isRtl ? 'معتمدة' : 'Approved') : (isRtl ? 'مرفوضة' : 'Rejected')}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {p.user ? (isRtl ? p.user.name : (p.user.nameEn || p.user.name)) : '-'}
                      {p.reviewedBy ? (isRtl ? ' • راجعها: ' : ' • reviewed by: ') + (isRtl ? p.reviewedBy.name : (p.reviewedBy.nameEn || p.reviewedBy.name)) : ''}
                    </span>
                  </div>
                </div>
              )
            })}
          </>
        )}
      </CardContent>
      {/* نافذة عرض الفاتورة */}
      <Dialog open={!!viewImg} onOpenChange={function(open) { if (!open) setViewImg(null) }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{isRtl ? 'صورة الفاتورة' : 'Invoice image'}</DialogTitle>
          </DialogHeader>
          {viewImg && <img src={viewImg} alt="invoice" className="w-full max-h-[70vh] object-contain rounded-lg" />}
        </DialogContent>
      </Dialog>
    </Card>
  )
}
