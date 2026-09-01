'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import {
  Activity, TrendingUp, TrendingDown, DollarSign, Wallet,
  Users, AlertTriangle, Wrench, FolderKanban, ArrowLeft,
  Trophy, AlertCircle, Calendar, HardHat, Timer, Gauge,
  CircleDollarSign, Ruler, ChevronRight, Construction
} from 'lucide-react'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, PieChart, Pie, Cell, Legend
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
    totalEquipment: number
    presentWorkers: number
    unreadNotifications: number
    totalMeters: number
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
  labor: '\u0623\u062c\u0648\u0631 \u0627\u0644\u0639\u0645\u0627\u0644',
  fuel: '\u062f\u064a\u0632\u0644',
  maintenance: '\u0635\u064a\u0627\u0646\u0629',
  transport: '\u0646\u0642\u0644',
  housing: '\u0633\u0643\u0646',
  parts: '\u0642\u0637\u0639 \u063a\u064a\u0627\u0631',
  oil: '\u0632\u064a\u0648\u062a',
  safety: '\u0633\u0644\u0627\u0645\u0629',
  rental: '\u0625\u064a\u062c\u0627\u0631',
  other: '\u0623\u062e\u0631\u0649',
}

export default function DashboardPage({ onNavigate }: { onNavigate: (page: any) => void }) {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const language = useAppStore((s) => s.language)
  const token = useAppStore((s) => s.token)
  const isRtl = language === 'ar'

  async function fetchDashboard() {
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      const r = await authedFetch('/api/dashboard')
      if (!r.ok) {
        const body = await r.json().catch(function() { return {} })
        throw new Error(body.details || body.error || 'Error ' + r.status)
      }
      const d = await r.json()
      if (d.error) {
        throw new Error(d.details || d.error)
      }
      setData(d)
    } catch (e: any) {
      console.error('[Dashboard]', e)
      setError(e.message || (isRtl ? '\u062e\u0637\u0623 \u0641\u064a \u062a\u062d\u0645\u064a\u0644 \u0627\u0644\u0628\u064a\u0627\u0646\u0627\u062a' : 'Failed to load data'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(function() {
    fetchDashboard()
  }, [token])

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map(function(i) {
          return (
            <Card key={i} className="overflow-hidden">
              <CardContent className="p-6">
                <div className="h-36 bg-muted/60 animate-pulse rounded-xl" />
              </CardContent>
            </Card>
          )
        })}
      </div>
    )
  }

  if (error) {
    return (
      <Card className="border-red-200 bg-red-50/50">
        <CardContent className="flex flex-col items-center justify-center py-12 gap-4">
          <div className="w-14 h-14 rounded-2xl bg-red-100 flex items-center justify-center">
            <AlertCircle className="h-7 w-7 text-red-600" />
          </div>
          <div className="text-center">
            <p className="font-semibold text-red-800">{isRtl ? '\u0641\u0634\u0644 \u062a\u062d\u0645\u064a\u0644 \u0644\u0648\u062d\u0629 \u0627\u0644\u062a\u062d\u0643\u0645' : 'Failed to load dashboard'}</p>
            <p className="text-sm text-red-600/80 mt-1 max-w-md">{error}</p>
          </div>
          <Button variant="outline" onClick={fetchDashboard}>
            {isRtl ? '\u0625\u0639\u0627\u062f\u0629 \u0627\u0644\u0645\u062d\u0627\u0648\u0644\u0629' : 'Retry'}
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (!data) return null

  const stats = data.stats || {
    activeProjects: 0, totalProjects: 0, metersToday: 0, metersThisMonth: 0,
    revenueToday: 0, revenueThisMonth: 0, totalRevenue: 0, totalCosts: 0,
    monthCosts: 0, netProfit: 0, stoppedEquipment: 0, totalEquipment: 0,
    presentWorkers: 0, unreadNotifications: 0, totalMeters: 0,
  }
  const projects = Array.isArray(data.projects) ? data.projects : []
  const trend = Array.isArray(data.trend) ? data.trend : []
  const recentReports = Array.isArray(data.recentReports) ? data.recentReports : []
  const equipment = Array.isArray(data.equipment) ? data.equipment : []
  const costsByCategory = Array.isArray(data.costsByCategory) ? data.costsByCategory : []

  const fmt = function(n: number) { return (n || 0).toLocaleString(isRtl ? 'ar-EG' : 'en-US', { maximumFractionDigits: 1 }) }
  const fmtInt = function(n: number) { return (n || 0).toLocaleString(isRtl ? 'ar-EG' : 'en-US', { maximumFractionDigits: 0 }) }
  const fmtCurrency = function(n: number) { return fmt(n || 0) + ' ' + (isRtl ? '\u0631.\u0639' : 'OMR') }

  var sortedByProgress = projects.slice().sort(function(a, b) { return (b.progress || 0) - (a.progress || 0) })
  var bestProject = sortedByProgress[0]
  var worstProject = sortedByProgress[sortedByProgress.length - 1]

  var trendData = trend.map(function(t) {
    return {
      ...t,
      date: new Date(t.date + 'T00:00:00').toLocaleDateString(isRtl ? 'ar-EG' : 'en-US', { month: 'short', day: 'numeric' }),
      profit: (t.revenue || 0) - (t.cost || 0),
    }
  })

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{isRtl ? '\u0644\u0648\u062d\u0629 \u0627\u0644\u062a\u062d\u0643\u0645' : 'Dashboard'}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {isRtl ? '\u0646\u0638\u0631\u0629 \u0639\u0627\u0645\u0629 \u0639\u0644\u0649 \u062c\u0645\u064a\u0639 \u0627\u0644\u0645\u0634\u0627\u0631\u064a\u0639 \u0648\u0627\u0644\u0639\u0645\u0644\u064a\u0627\u062a' : 'Overview of all projects and operations'}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={function() { onNavigate('reports') }}>
          <Calendar className="h-4 w-4 ml-2" />
          {isRtl ? '\u0627\u0644\u062a\u0642\u0627\u0631\u064a\u0631' : 'Reports'}
        </Button>
      </div>

      {/* === Primary KPI Cards === */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          icon={FolderKanban}
          label={isRtl ? '\u0627\u0644\u0645\u0634\u0627\u0631\u064a\u0639 \u0627\u0644\u0646\u0634\u0637\u0629' : 'Active Projects'}
          value={fmtInt(stats.activeProjects)}
          subtext={(isRtl ? '\u0645\u0646 \u0625\u062c\u0645\u0627\u0644\u064a ' : 'of ') + stats.totalProjects}
          gradient="from-blue-500 to-blue-600"
          iconBg="bg-white/20"
        />
        <KpiCard
          icon={TrendingUp}
          label={isRtl ? '\u0627\u0644\u0625\u064a\u0631\u0627\u062f\u0627\u062a' : 'Revenue'}
          value={fmtCurrency(stats.totalRevenue)}
          subtext={fmtCurrency(stats.revenueThisMonth) + ' ' + (isRtl ? '\u0647\u0630\u0627 \u0627\u0644\u0634\u0647\u0631' : 'this month')}
          gradient="from-emerald-500 to-emerald-600"
          iconBg="bg-white/20"
        />
        <KpiCard
          icon={Wallet}
          label={isRtl ? '\u0635\u0627\u0641\u064a \u0627\u0644\u0631\u0628\u062d' : 'Net Profit'}
          value={fmtCurrency(stats.netProfit)}
          subtext={stats.totalRevenue > 0 ? (((stats.netProfit / stats.totalRevenue) * 100).toFixed(1) + '% ' + (isRtl ? '\u0647\u0627\u0645\u0634' : 'margin')) : ''}
          gradient={stats.netProfit >= 0 ? 'from-violet-500 to-violet-600' : 'from-red-500 to-red-600'}
          iconBg="bg-white/20"
        />
        <KpiCard
          icon={Ruler}
          label={isRtl ? '\u0625\u062c\u0645\u0627\u0644\u064a \u0627\u0644\u0623\u0645\u062a\u0627\u0631' : 'Total Meters'}
          value={fmt(stats.totalMeters) + ' ' + (isRtl ? '\u0645' : 'm')}
          subtext={fmt(stats.metersThisMonth) + ' ' + (isRtl ? '\u0645 \u0647\u0630\u0627 \u0627\u0644\u0634\u0647\u0631' : 'm this month')}
          gradient="from-amber-500 to-orange-500"
          iconBg="bg-white/20"
        />
      </div>

      {/* === Secondary Stats Row === */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <MiniCard
          icon={HardHat}
          label={isRtl ? '\u0639\u0645\u0627\u0644 \u0627\u0644\u064a\u0648\u0645' : 'Workers Today'}
          value={fmtInt(stats.presentWorkers)}
          color="text-sky-600"
          bg="bg-sky-50"
          border="border-sky-100"
        />
        <MiniCard
          icon={Wrench}
          label={isRtl ? '\u0645\u0639\u062f\u0627\u062a \u0645\u062a\u0648\u0642\u0641\u0629' : 'Stopped Eq.'}
          value={fmtInt(stats.stoppedEquipment) + '/' + fmtInt(stats.totalEquipment)}
          color="text-red-600"
          bg="bg-red-50"
          border="border-red-100"
        />
        <MiniCard
          icon={CircleDollarSign}
          label={isRtl ? '\u0627\u0644\u0625\u064a\u0631\u0627\u062f \u0627\u0644\u064a\u0648\u0645' : "Today's Rev."}
          value={fmtCurrency(stats.revenueToday)}
          color="text-emerald-600"
          bg="bg-emerald-50"
          border="border-emerald-100"
        />
        <MiniCard
          icon={Timer}
          label={isRtl ? '\u062a\u0643\u0627\u0644\u064a\u0641 \u0627\u0644\u0634\u0647\u0631' : 'Month Costs'}
          value={fmtCurrency(stats.monthCosts)}
          color="text-purple-600"
          bg="bg-purple-50"
          border="border-purple-100"
        />
        <MiniCard
          icon={Gauge}
          label={isRtl ? '\u0623\u0645\u062a\u0627\u0631 \u0627\u0644\u0634\u0647\u0631' : 'Month Meters'}
          value={fmt(stats.metersThisMonth) + ' ' + (isRtl ? '\u0645' : 'm')}
          color="text-cyan-600"
          bg="bg-cyan-50"
          border="border-cyan-100"
        />
      </div>

      {/* === Charts Row === */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-5 w-5 text-blue-600" />
              {isRtl ? '\u0627\u062a\u062c\u0627\u0647 \u0627\u0644\u0625\u0646\u062a\u0627\u062c (\u0622\u062e\u0631 14 \u064a\u0648\u0645)' : 'Production Trend (Last 14 days)'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={trendData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <defs>
                  <linearGradient id="gMeters" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gRevenue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} reversed={isRtl} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} orientation={isRtl ? 'right' : 'left'} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ direction: isRtl ? 'rtl' : 'ltr', borderRadius: 12, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)', fontSize: 12, padding: '10px 14px' }}
                  formatter={function(value: any, name: any) {
                    if (name === 'meters') return [fmt(value) + ' ' + (isRtl ? '\u0645' : 'm'), isRtl ? '\u0627\u0644\u0623\u0645\u062a\u0627\u0631' : 'Meters']
                    if (name === 'revenue') return [fmtCurrency(value), isRtl ? '\u0627\u0644\u0625\u064a\u0631\u0627\u062f' : 'Revenue']
                    return [value, name]
                  }}
                />
                <Area type="monotone" dataKey="meters" stroke="#3b82f6" fillOpacity={1} fill="url(#gMeters)" strokeWidth={2.5} dot={false} />
                <Area type="monotone" dataKey="revenue" stroke="#10b981" fillOpacity={1} fill="url(#gRevenue)" strokeWidth={2.5} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <div className="w-2 h-2 rounded-full bg-purple-500" />
              {isRtl ? '\u062a\u0648\u0632\u064a\u0639 \u0627\u0644\u062a\u0643\u0627\u0644\u064a\u0641' : 'Cost Breakdown'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {costsByCategory.length === 0 ? (
              <div className="h-[280px] flex items-center justify-center text-muted-foreground text-sm">
                {isRtl ? '\u0644\u0627 \u062a\u0648\u062c\u062f \u0628\u064a\u0627\u0646\u0627\u062a' : 'No data'}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={costsByCategory}
                    dataKey="amount"
                    nameKey="category"
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={3}
                    strokeWidth={0}
                  >
                    {costsByCategory.map(function(entry, idx) {
                      return <Cell key={idx} fill={categoryColors[entry.category] || '#94a3b8'} />
                    })}
                  </Pie>
                  <Tooltip
                    contentStyle={{ direction: isRtl ? 'rtl' : 'ltr', borderRadius: 12, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)', fontSize: 12 }}
                    formatter={function(value: any, _name: any, props: any) { return [fmtCurrency(value), categoryLabelsAr[props.payload.category] || props.payload.category] }}
                  />
                  <Legend
                    formatter={function(value) { return categoryLabelsAr[value] || value }}
                    wrapperStyle={{ fontSize: 10 }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* === Projects + Highlights === */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-base">
                <Construction className="h-5 w-5 text-amber-600" />
                {isRtl ? '\u062a\u0642\u062f\u0645 \u0627\u0644\u0645\u0634\u0627\u0631\u064a\u0639' : 'Project Progress'}
              </span>
              <Button variant="ghost" size="sm" className="text-xs" onClick={function() { onNavigate('projects') }}>
                {isRtl ? '\u0639\u0631\u0636 \u0627\u0644\u0643\u0644' : 'View all'}
                <ChevronRight className="h-3.5 w-3.5 mr-1 rtl:rotate-180" />
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 max-h-72 overflow-y-auto">
            {projects.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                {isRtl ? '\u0644\u0627 \u062a\u0648\u062c\u062f \u0645\u0634\u0627\u0631\u064a\u0639' : 'No projects'}
              </div>
            ) : (
              projects.map(function(p) {
                var progressColor = p.progress >= 75 ? 'bg-emerald-500' : p.progress >= 40 ? 'bg-blue-500' : 'bg-amber-500'
                return (
                  <div key={p.id} className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{p.name}</p>
                        <p className="text-xs text-muted-foreground">{p.code} {'\u2022'} {p.client}</p>
                      </div>
                      <span className="font-bold text-sm tabular-nums">{p.progress.toFixed(1)}%</span>
                    </div>
                    <div className="relative h-2 bg-muted rounded-full overflow-hidden">
                      <div className={"absolute inset-y-0 " + progressColor + " rounded-full transition-all duration-500"} style={{ width: Math.min(p.progress, 100) + '%' }} />
                    </div>
                  </div>
                )
              })
            )}
          </CardContent>
        </Card>

        <div className="space-y-3">
          {bestProject && (
            <Card className="border-emerald-200 bg-gradient-to-br from-emerald-50 to-white">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
                    <Trophy className="h-5 w-5 text-emerald-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-emerald-700 font-medium">{isRtl ? '\u0623\u0641\u0636\u0644 \u0645\u0634\u0631\u0648\u0639' : 'Best Project'}</p>
                    <p className="font-semibold text-sm truncate mt-0.5">{bestProject.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{bestProject.progress.toFixed(1)}% {isRtl ? '\u0625\u0646\u062c\u0627\u0632' : 'complete'}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {worstProject && worstProject.id !== bestProject?.id && (
            <Card className="border-orange-200 bg-gradient-to-br from-orange-50 to-white">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center shrink-0">
                    <AlertCircle className="h-5 w-5 text-orange-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-orange-700 font-medium">{isRtl ? '\u0623\u0642\u0644 \u0645\u0634\u0631\u0648\u0639 \u0623\u062f\u0627\u0621\u064b' : 'Worst Project'}</p>
                    <p className="font-semibold text-sm truncate mt-0.5">{worstProject.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{worstProject.progress.toFixed(1)}% {isRtl ? '\u0625\u0646\u062c\u0627\u0632' : 'complete'}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {stats.stoppedEquipment > 0 && (
            <Card className="border-red-200 bg-gradient-to-br from-red-50 to-white">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
                    <Wrench className="h-5 w-5 text-red-600" />
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-sm">{stats.stoppedEquipment} {isRtl ? '\u0645\u0639\u062f\u0629 \u0645\u062a\u0648\u0642\u0641\u0629' : 'Stopped Equipment'}</p>
                    <Button variant="link" size="sm" className="p-0 h-auto text-xs" onClick={function() { onNavigate('equipment') }}>
                      {isRtl ? '\u0639\u0631\u0636 \u0627\u0644\u062a\u0641\u0627\u0635\u064a\u0644' : 'View details'}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* === Recent Reports + Equipment === */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-base">
                <Calendar className="h-5 w-5 text-blue-600" />
                {isRtl ? '\u0627\u0644\u062a\u0642\u0627\u0631\u064a\u0631 \u0627\u0644\u0623\u062e\u064a\u0631\u0629' : 'Recent Reports'}
              </span>
              <Button variant="ghost" size="sm" className="text-xs" onClick={function() { onNavigate('dailyReports') }}>
                {isRtl ? '\u0639\u0631\u0636 \u0627\u0644\u0643\u0644' : 'View all'}
                <ChevronRight className="h-3.5 w-3.5 mr-1 rtl:rotate-180" />
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 max-h-72 overflow-y-auto">
            {recentReports.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                {isRtl ? '\u0644\u0627 \u062a\u0648\u062c\u062f \u062a\u0642\u0627\u0631\u064a\u0631' : 'No reports'}
              </div>
            ) : (
              recentReports.slice(0, 8).map(function(r) {
                return (
                  <div key={r.id} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-muted/50 transition">
                    <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
                      <Calendar className="h-4 w-4 text-blue-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{r.project ? r.project.name : '-'}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(r.reportDate).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US')} {'\u2022'} {r.driveLine ? r.driveLine.lineNumber : '-'}
                      </p>
                    </div>
                    <div className="text-left shrink-0">
                      <p className="font-semibold text-sm tabular-nums">{r.dailyMeters} {isRtl ? '\u0645' : 'm'}</p>
                      <Badge variant={r.status === 'approved' ? 'default' : r.status === 'rejected' ? 'destructive' : 'secondary'} className="text-[10px] px-1.5">
                        {r.status === 'approved' ? (isRtl ? '\u0645\u0639\u062a\u0645\u062f' : 'Approved') :
                         r.status === 'submitted' ? (isRtl ? '\u0645\u0631\u0633\u0644' : 'Submitted') :
                         r.status === 'rejected' ? (isRtl ? '\u0645\u0631\u0641\u0648\u0636' : 'Rejected') :
                         (isRtl ? '\u0645\u0633\u0648\u062f\u0629' : 'Draft')}
                      </Badge>
                    </div>
                  </div>
                )
              })
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-base">
                <Construction className="h-5 w-5 text-amber-600" />
                {isRtl ? '\u062d\u0627\u0644\u0629 \u0627\u0644\u0645\u0639\u062f\u0627\u062a' : 'Equipment Status'}
              </span>
              <Button variant="ghost" size="sm" className="text-xs" onClick={function() { onNavigate('equipment') }}>
                {isRtl ? '\u0639\u0631\u0636 \u0627\u0644\u0643\u0644' : 'View all'}
                <ChevronRight className="h-3.5 w-3.5 mr-1 rtl:rotate-180" />
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 max-h-72 overflow-y-auto">
            {equipment.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                {isRtl ? '\u0644\u0627 \u062a\u0648\u062c\u062f \u0645\u0639\u062f\u0627\u062a' : 'No equipment'}
              </div>
            ) : (
              equipment.map(function(eq) {
                var isOperational = eq.status === 'operational'
                var isStopped = eq.status === 'stopped'
                return (
                  <div key={eq.id} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-muted/50 transition">
                    <div className={"w-9 h-9 rounded-lg flex items-center justify-center shrink-0 " + (isOperational ? 'bg-emerald-50' : isStopped ? 'bg-red-50' : 'bg-amber-50')}>
                      <Wrench className={"h-4 w-4 " + (isOperational ? 'text-emerald-600' : isStopped ? 'text-red-600' : 'text-amber-600')} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{eq.name}</p>
                      <p className="text-xs text-muted-foreground">{eq.number} {'\u2022'} {eq.project ? eq.project.name : '-'}</p>
                    </div>
                    <div className={"w-2 h-2 rounded-full shrink-0 " + (isOperational ? 'bg-emerald-500' : isStopped ? 'bg-red-500' : 'bg-amber-500')} />
                  </div>
                )
              })
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

/* === Modern KPI Card with gradient === */
function KpiCard({
  icon: Icon, label, value, subtext, gradient, iconBg,
}: {
  icon: any; label: string; value: string; subtext?: string; gradient: string; iconBg: string
}) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <div className={"bg-gradient-to-br " + gradient + " p-5 text-white"}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-white/80 text-sm font-medium">{label}</p>
              <p className="text-2xl font-bold mt-1.5 truncate tracking-tight">{value}</p>
              {subtext && <p className="text-white/70 text-xs mt-1 truncate">{subtext}</p>}
            </div>
            <div className={"w-11 h-11 rounded-xl " + iconBg + " flex items-center justify-center shrink-0"}>
              <Icon className="h-5.5 w-5.5" />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

/* === Clean Mini Stat Card === */
function MiniCard({
  icon: Icon, label, value, color, bg, border,
}: {
  icon: any; label: string; value: string; color: string; bg: string; border: string
}) {
  return (
    <Card className={border + " bg-white"}>
      <CardContent className="p-3.5">
        <div className="flex items-center gap-3">
          <div className={"w-9 h-9 rounded-lg " + bg + " flex items-center justify-center shrink-0"}>
            <Icon className={"h-4.5 w-4.5 " + color} />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] text-muted-foreground truncate leading-tight">{label}</p>
            <p className={"font-bold text-sm truncate mt-0.5 " + color}>{value}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
