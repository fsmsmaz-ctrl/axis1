'use client'

import { useEffect, useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip
} from 'recharts'
import { TrendingUp, Award, AlertTriangle, Clock, Users, ShieldCheck, DollarSign, Activity } from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { authedFetch } from '@/lib/api-client'

const tooltipStyle = { borderRadius: 8, fontSize: 12 }

export default function PerformancePage() {
  const [performance, setPerformance] = useState<any[]>([])
  const [projects, setProjects] = useState<any[]>([])
  const [selectedProject, setSelectedProject] = useState<string>('all')
  const [loading, setLoading] = useState(true)
  const language = useAppStore((s) => s.language)
  const token = useAppStore((s) => s.token)
  const isRtl = language === 'ar'

  const tooltipContentStyle = useMemo(() => ({
    ...tooltipStyle,
    direction: isRtl ? 'rtl' as const : 'ltr' as const,
  }), [isRtl])

  useEffect(() => {
    if (!token) return
    setLoading(true)
    Promise.all([
      authedFetch('/api/performance' + (selectedProject !== 'all' ? `?projectId=${selectedProject}` : '')),
      authedFetch('/api/projects/list'),
    ]).then(async ([perfRes, projRes]) => {
      const perfData = await perfRes.json()
      const projData = await projRes.json()
      setPerformance(perfData.performance || [])
      setProjects(projData.projects || [])
    }).finally(() => setLoading(false))
  }, [selectedProject, token])

  // Memoize all derived computations
  const { totals, avgDailyMeters, overallProfitMargin, avgSafety, avgAttendance } = useMemo(() => {
    const t = performance.reduce((acc, p) => ({
      totalMeters: acc.totalMeters + p.totalMeters,
      totalRevenue: acc.totalRevenue + p.totalRevenue,
      totalCost: acc.totalCost + p.totalCost,
      totalProfit: acc.totalProfit + (p.totalRevenue - p.totalCost),
      totalDays: acc.totalDays + p.daysCount,
      totalWorkers: acc.totalWorkers + p.totalWorkers,
    }), { totalMeters: 0, totalRevenue: 0, totalCost: 0, totalProfit: 0, totalDays: 0, totalWorkers: 0 })

    return {
      totals: t,
      avgDailyMeters: t.totalDays > 0 ? t.totalMeters / t.totalDays : 0,
      overallProfitMargin: t.totalRevenue > 0 ? (t.totalProfit / t.totalRevenue) * 100 : 0,
      avgSafety: performance.length > 0 ? performance.reduce((s, p) => s + p.safetyRate, 0) / performance.length : 0,
      avgAttendance: performance.length > 0 ? performance.reduce((s, p) => s + p.attendanceRate, 0) / performance.length : 0,
    }
  }, [performance])

  const comparisonData = useMemo(() => performance.map(p => ({
    name: p.projectCode,
    meters: Number(p.totalMeters.toFixed(0)),
    revenue: Number(p.totalRevenue.toFixed(0)),
    profit: Number((p.totalRevenue - p.totalCost).toFixed(0)),
    safety: Number(p.safetyRate.toFixed(0)),
  })), [performance])

  const radarData = useMemo(() => performance[0] ? [
    { metric: isRtl ? 'الإنتاج' : 'Production', value: Math.min(100, (performance[0].avgDaily / 10) * 100) },
    { metric: isRtl ? 'السلامة' : 'Safety', value: performance[0].safetyRate },
    { metric: isRtl ? 'الحضور' : 'Attendance', value: performance[0].attendanceRate },
    { metric: isRtl ? 'الربحية' : 'Profitability', value: Math.max(0, performance[0].profitMargin) },
    { metric: isRtl ? 'كفاءة المعدات' : 'Equipment', value: 85 },
    { metric: isRtl ? 'الالتزام' : 'Compliance', value: 90 },
  ] : [], [performance, isRtl])

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{isRtl ? 'تقييم الأداء' : 'Performance'}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {isRtl ? 'مؤشرات الأداء الرئيسية للمشاريع والفرق' : 'KPIs for projects and teams'}
        </p>
      </div>

      <Select value={selectedProject} onValueChange={setSelectedProject}>
        <SelectTrigger className="w-full sm:w-[300px]">
          <SelectValue placeholder={isRtl ? 'اختر المشروع' : 'Select project'} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{isRtl ? 'كل المشاريع' : 'All Projects'}</SelectItem>
          {projects.map((p) => (
            <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Overall KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Activity className="h-4 w-4 text-blue-600" />
              <span className="text-xs text-muted-foreground">{isRtl ? 'متوسط الحفر اليومي' : 'Avg Daily Meters'}</span>
            </div>
            <p className="text-xl font-bold">{avgDailyMeters.toFixed(1)} <span className="text-sm font-normal">{isRtl ? 'م/يوم' : 'm/day'}</span></p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              <span className="text-xs text-muted-foreground">{isRtl ? 'الالتزام بالسلامة' : 'Safety Compliance'}</span>
            </div>
            <p className="text-xl font-bold text-emerald-700">{avgSafety.toFixed(1)}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Users className="h-4 w-4 text-purple-600" />
              <span className="text-xs text-muted-foreground">{isRtl ? 'نسبة الحضور' : 'Attendance Rate'}</span>
            </div>
            <p className="text-xl font-bold text-purple-700">{avgAttendance.toFixed(1)}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="h-4 w-4 text-orange-600" />
              <span className="text-xs text-muted-foreground">{isRtl ? 'هامش الربح' : 'Profit Margin'}</span>
            </div>
            <p className={`text-xl font-bold ${overallProfitMargin >= 0 ? 'text-orange-700' : 'text-red-700'}`}>
              {overallProfitMargin.toFixed(1)}%
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              {isRtl ? 'مقارنة المشاريع' : 'Projects Comparison'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {comparisonData.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
                {isRtl ? 'لا توجد بيانات' : 'No data'}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={comparisonData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip contentStyle={tooltipContentStyle} />
                  <Bar dataKey="meters" fill="#f97316" name={isRtl ? 'أمتار' : 'Meters'} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="profit" fill="#10b981" name={isRtl ? 'ربح' : 'Profit'} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{isRtl ? 'تحليل أداء شامل' : 'Performance Radar'}</CardTitle>
          </CardHeader>
          <CardContent>
            {radarData.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
                {isRtl ? 'لا توجد بيانات' : 'No data'}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <RadarChart data={radarData}>
                  <PolarGrid stroke="#e5e7eb" />
                  <PolarAngleAxis dataKey="metric" tick={{ fontSize: 11 }} />
                  <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fontSize: 10 }} />
                  <Radar name="Performance" dataKey="value" stroke="#f97316" fill="#f97316" fillOpacity={0.4} />
                  <Tooltip contentStyle={tooltipContentStyle} />
                </RadarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Detailed table */}
      <Card>
        <CardHeader>
          <CardTitle>{isRtl ? 'تفاصيل أداء المشاريع' : 'Project Performance Details'}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="h-32 bg-muted animate-pulse rounded" />
          ) : performance.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm">
              {isRtl ? 'لا توجد بيانات' : 'No data'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-right">
                    <th className="p-2 font-medium text-muted-foreground">{isRtl ? 'المشروع' : 'Project'}</th>
                    <th className="p-2 font-medium text-muted-foreground">{isRtl ? 'متوسط يومي' : 'Avg Daily'}</th>
                    <th className="p-2 font-medium text-muted-foreground">{isRtl ? 'أعلى يوم' : 'Best Day'}</th>
                    <th className="p-2 font-medium text-muted-foreground">{isRtl ? 'أقل يوم' : 'Worst Day'}</th>
                    <th className="p-2 font-medium text-muted-foreground">{isRtl ? 'أيام التوقف' : 'Stop Days'}</th>
                    <th className="p-2 font-medium text-muted-foreground">{isRtl ? 'السلامة' : 'Safety'}</th>
                    <th className="p-2 font-medium text-muted-foreground">{isRtl ? 'تكلفة/م' : 'Cost/m'}</th>
                    <th className="p-2 font-medium text-muted-foreground">{isRtl ? 'هامش الربح' : 'Margin'}</th>
                  </tr>
                </thead>
                <tbody>
                  {performance.map((p) => (
                    <tr key={p.projectId} className="border-b hover:bg-muted/30">
                      <td className="p-2">
                        <div>
                          <p className="font-medium text-xs">{p.projectName}</p>
                          <p className="text-xs text-muted-foreground font-mono">{p.projectCode}</p>
                        </div>
                      </td>
                      <td className="p-2 text-xs">{p.avgDaily.toFixed(1)} م</td>
                      <td className="p-2 text-xs text-emerald-600 font-medium">{p.bestDay} م</td>
                      <td className="p-2 text-xs text-orange-600 font-medium">{p.worstDay} م</td>
                      <td className="p-2 text-xs">
                        {p.stoppageDays > 0 ? (
                          <Badge variant="secondary" className="text-xs">{p.stoppageDays}</Badge>
                        ) : (
                          <span className="text-emerald-600">0</span>
                        )}
                      </td>
                      <td className="p-2">
                        <div className="flex items-center gap-1.5">
                          <Progress value={p.safetyRate} className="h-1.5 w-12" />
                          <span className="text-xs">{p.safetyRate.toFixed(0)}%</span>
                        </div>
                      </td>
                      <td className="p-2 text-xs">{p.costPerMeter.toFixed(1)} ر.ع</td>
                      <td className="p-2">
                        <Badge variant={p.profitMargin >= 20 ? 'default' : p.profitMargin >= 0 ? 'secondary' : 'destructive'} className="text-xs">
                          {p.profitMargin.toFixed(1)}%
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
