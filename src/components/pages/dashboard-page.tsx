'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import {
  Activity, TrendingUp, TrendingDown, DollarSign, Wallet,
  Users, AlertTriangle, Wrench, FolderKanban, ArrowLeft,
  Trophy, AlertCircle, Calendar, Cpu
} from 'lucide-react'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, BarChart, Bar, PieChart, Pie, Cell, Legend
} from 'recharts'
import { useAppStore } from '@/lib/store'
import { authedFetch } from '@/lib/api-client'

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
  const language = useAppStore((s) => s.language)
  const token = useAppStore((s) => s.token)
  const isRtl = language === 'ar'

  useEffect(() => {
    if (!token) return
    authedFetch('/api/dashboard')
      .then(r => r.json())
      .then(d => setData(d))
      .catch(e => console.error(e))
      .finally(() => setLoading(false))
  }, [token])

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map(i => (
          <Card key={i}>
            <CardContent className="p-6">
              <div className="h-32 bg-muted animate-pulse rounded" />
            </CardContent>
          </Card>
        ))}
      </div>
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

  const fmt = (n: number) => (n || 0).toLocaleString(isRtl ? 'ar-EG' : 'en-US', { maximumFractionDigits: 1 })
  const fmtCurrency = (n: number) => `${fmt(n || 0)} ${isRtl ? 'ر.ع' : 'OMR'}`

  // Sort projects for best/worst
  const sortedByProgress = [...projects].sort((a, b) => (b.progress || 0) - (a.progress || 0))
  const bestProject = sortedByProgress[0]
  const worstProject = sortedByProgress[sortedByProgress.length - 1]

  // Format trend for chart
  const trendData = trend.map(t => ({
    ...t,
    date: new Date(t.date).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US', { month: 'short', day: 'numeric' }),
    profit: (t.revenue || 0) - (t.cost || 0),
  }))

  return (
    <div className="space-y-6">
      {/* Page title */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">{isRtl ? 'لوحة التحكم' : 'Dashboard'}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isRtl ? 'نظرة عامة على جميع المشاريع والعمليات' : 'Overview of all projects and operations'}
          </p>
        </div>
        <Button variant="outline" onClick={() => onNavigate('reports')}>
          <Calendar className="h-4 w-4 ml-2" />
          {isRtl ? 'التقارير' : 'Reports'}
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={FolderKanban}
          label={isRtl ? 'المشاريع النشطة' : 'Active Projects'}
          value={`${stats.activeProjects}`}
          subtext={`${isRtl ? 'من إجمالي' : 'of'} ${stats.totalProjects}`}
          color="text-orange-600"
          bgColor="bg-orange-50"
        />
        <StatCard
          icon={Activity}
          label={isRtl ? 'الأمتار اليوم' : 'Meters Today'}
          value={`${fmt(stats.metersToday)} ${isRtl ? 'م' : 'm'}`}
          subtext={`${fmt(stats.metersThisMonth)} ${isRtl ? 'م هذا الشهر' : 'm this month'}`}
          color="text-blue-600"
          bgColor="bg-blue-50"
        />
        <StatCard
          icon={DollarSign}
          label={isRtl ? 'الإيرادات' : 'Revenue'}
          value={fmtCurrency(stats.totalRevenue)}
          subtext={`${fmtCurrency(stats.revenueThisMonth)} ${isRtl ? 'هذا الشهر' : 'this month'}`}
          color="text-emerald-600"
          bgColor="bg-emerald-50"
        />
        <StatCard
          icon={Wallet}
          label={isRtl ? 'صافي الربح' : 'Net Profit'}
          value={fmtCurrency(stats.netProfit)}
          subtext={stats.netProfit >= 0 ? `+${((stats.netProfit / Math.max(stats.totalRevenue, 1)) * 100).toFixed(1)}% ${isRtl ? 'هامش' : 'margin'}` : ''}
          color={stats.netProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}
          bgColor={stats.netProfit >= 0 ? 'bg-emerald-50' : 'bg-red-50'}
        />
      </div>

      {/* Secondary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <MiniStat
          icon={Users}
          label={isRtl ? 'العمال اليوم' : 'Workers Today'}
          value={`${stats.presentWorkers}`}
          color="text-blue-600"
        />
        <MiniStat
          icon={Wrench}
          label={isRtl ? 'معدات متوقفة' : 'Stopped Eq.'}
          value={`${stats.stoppedEquipment}`}
          color="text-red-600"
        />
        <MiniStat
          icon={AlertTriangle}
          label={isRtl ? 'تنبيهات' : 'Alerts'}
          value={`${stats.unreadNotifications}`}
          color="text-orange-600"
        />
        <MiniStat
          icon={TrendingUp}
          label={isRtl ? 'الإيراد اليوم' : "Today's Rev."}
          value={fmtCurrency(stats.revenueToday)}
          color="text-emerald-600"
        />
        <MiniStat
          icon={TrendingDown}
          label={isRtl ? 'تكاليف الشهر' : 'Month Costs'}
          value={fmtCurrency(stats.monthCosts)}
          color="text-purple-600"
        />
        <MiniStat
          icon={Activity}
          label={isRtl ? 'أمتار الشهر' : 'Month Meters'}
          value={`${fmt(stats.metersThisMonth)} م`}
          color="text-cyan-600"
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Production trend */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" />
              {isRtl ? 'اتجاه الإنتاج (آخر 14 يوم)' : 'Production Trend (Last 14 days)'}
            </CardTitle>
            <CardDescription>
              {isRtl ? 'الأمتار المنجزة والإيرادات اليومية' : 'Daily meters drilled and revenue'}
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
                  formatter={(value: any, name: any) => {
                    if (name === 'meters') return [`${fmt(value)} ${isRtl ? 'م' : 'm'}`, isRtl ? 'الأمتار' : 'Meters']
                    if (name === 'revenue') return [fmtCurrency(value), isRtl ? 'الإيراد' : 'Revenue']
                    if (name === 'profit') return [fmtCurrency(value), isRtl ? 'الربح' : 'Profit']
                    return [value, name]
                  }}
                />
                <Area type="monotone" dataKey="meters" stroke="#f97316" fillOpacity={1} fill="url(#colorMeters)" strokeWidth={2} />
                <Area type="monotone" dataKey="revenue" stroke="#10b981" fillOpacity={1} fill="url(#colorRevenue)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Cost breakdown pie */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5 text-primary" />
              {isRtl ? 'توزيع التكاليف' : 'Cost Breakdown'}
            </CardTitle>
            <CardDescription>{isRtl ? 'حسب الفئة - هذا الشهر' : 'By category - this month'}</CardDescription>
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
                    {costsByCategory.map((entry, idx) => (
                      <Cell key={idx} fill={categoryColors[entry.category] || '#94a3b8'} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ direction: isRtl ? 'rtl' : 'ltr', borderRadius: 8, fontSize: 12 }}
                    formatter={(value: any, _name: any, props: any) => [fmtCurrency(value), categoryLabelsAr[props.payload.category] || props.payload.category]}
                  />
                  <Legend
                    formatter={(value) => categoryLabelsAr[value] || value}
                    wrapperStyle={{ fontSize: 11 }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Projects progress + Best/Worst */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <FolderKanban className="h-5 w-5 text-primary" />
                {isRtl ? 'تقدم المشاريع' : 'Project Progress'}
              </span>
              <Button variant="ghost" size="sm" onClick={() => onNavigate('projects')}>
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
              projects.map((p) => (
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
              ))
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
                    <Button variant="link" size="sm" className="p-0 h-auto text-xs" onClick={() => onNavigate('equipment')}>
                      {isRtl ? 'عرض التفاصيل' : 'View details'}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Recent reports + Equipment status */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Calendar className="h-5 w-5 text-primary" />
                {isRtl ? 'التقارير الأخيرة' : 'Recent Reports'}
              </span>
              <Button variant="ghost" size="sm" onClick={() => onNavigate('dailyReports')}>
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
              recentReports.slice(0, 8).map((r) => (
                <div key={r.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <Calendar className="h-4 w-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{r.project?.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(r.reportDate).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US')} • {r.driveLine?.lineNumber || '-'}
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
              ))
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
              <Button variant="ghost" size="sm" onClick={() => onNavigate('equipment')}>
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
              equipment.map((eq) => (
                <div key={eq.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                    eq.status === 'operational' ? 'bg-emerald-100' :
                    eq.status === 'stopped' ? 'bg-red-100' : 'bg-orange-100'
                  }`}>
                    <Wrench className={`h-4 w-4 ${
                      eq.status === 'operational' ? 'text-emerald-600' :
                      eq.status === 'stopped' ? 'text-red-600' : 'text-orange-600'
                    }`} />
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
              ))
            )}
          </CardContent>
        </Card>
      </div>
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
          <div className={`w-10 h-10 rounded-lg ${bgColor} flex items-center justify-center shrink-0`}>
            <Icon className={`h-5 w-5 ${color}`} />
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
          <Icon className={`h-4 w-4 ${color} shrink-0`} />
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground truncate">{label}</p>
            <p className="font-semibold text-sm truncate">{value}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
