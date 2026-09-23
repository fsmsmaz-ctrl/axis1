'use client'

import { useEffect, useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell
} from 'recharts'
import { TrendingUp, Award, AlertTriangle, Clock, ShieldCheck, DollarSign, Activity, Flame, PiggyBank, Medal } from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { authedFetch } from '@/lib/api-client'

const tooltipStyle = { borderRadius: 8, fontSize: 12 }

export default function PerformancePage() {
  const [performance, setPerformance] = useState<any[]>([])
  // v40: إحصاءات خطوط الحفر من الخادم (مرتبة بالمؤشر تنازلياً)
  const [lineStats, setLineStats] = useState<any[]>([])
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
    setLoading(true)
    Promise.all([
      authedFetch('/api/performance' + (selectedProject !== 'all' ? `?projectId=${selectedProject}` : '')),
      authedFetch('/api/projects/list'),
    ]).then(async ([perfRes, projRes]) => {
      const perfData = await perfRes.json()
      const projData = await projRes.json()
      setPerformance(perfData.performance || [])
      setLineStats(perfData.driveLines || [])
      setProjects(projData.projects || [])
    }).finally(() => setLoading(false))
  }, [selectedProject])

  // Memoize all derived computations
  const { totals, avgDailyMeters, overallProfitMargin, avgSafety, avgWorkHours } = useMemo(() => {
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
      // v41 FIX: كفاءة ساعات العمل الحقيقية بدل «نسبة الحضور» الشكلية (كانت 100% دائمًا)
      avgWorkHours: performance.length > 0 ? performance.reduce((s, p) => s + (p.workHoursRate || 0), 0) / performance.length : 0,
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
    { metric: isRtl ? 'ساعات العمل' : 'Work Hours', value: Math.max(0, Math.min(100, performance[0].workHoursRate || 0)) },
    { metric: isRtl ? 'الربحية' : 'Profitability', value: Math.max(0, performance[0].profitMargin) },
    { metric: isRtl ? 'كفاءة المعدات' : 'Equipment', value: 85 },
    { metric: isRtl ? 'الالتزام' : 'Compliance', value: 90 },
  ] : [], [performance, isRtl])

  // v40: بطاقات التميّز — أفضل وأسوأ خط، الأكثر والأقل تكلفة، الأكثر إيراداً، الأعلى ربحية
  const lineSuper = useMemo(() => {
    const withData = lineStats.filter((l: any) => l.reportDays > 0)
    if (lineStats.length === 0) return null
    const byScore = [...withData].sort((a: any, b: any) => b.score - a.score)
    const byCostDesc = [...withData].sort((a: any, b: any) => b.cost - a.cost)
    const byCostAsc = [...withData].filter((l: any) => l.cost > 0).sort((a: any, b: any) => a.cost - b.cost)
    const byRevenue = [...withData].sort((a: any, b: any) => b.revenue - a.revenue)
    const byMargin = [...withData].filter((l: any) => l.revenue > 0).sort((a: any, b: any) => b.profitMargin - a.profitMargin)
    return {
      best: byScore[0] || null,
      worst: byScore.length >= 2 ? byScore[byScore.length - 1] : null,
      mostCostly: byCostDesc[0] || null,
      leastCostly: byCostAsc[0] || null,
      mostRevenue: byRevenue[0] || null,
      mostProfitable: byMargin[0] || null,
    }
  }, [lineStats])

  const lineFinancialData = useMemo(() => lineStats.filter((l: any) => l.reportDays > 0).slice(0, 12).map((l: any) => ({
    name: l.lineNumber,
    revenue: Number(l.revenue.toFixed(0)),
    cost: Number(l.cost.toFixed(0)),
  })), [lineStats])

  const lineScoreData = useMemo(() => lineStats.filter((l: any) => l.reportDays > 0).slice(0, 12).map((l: any) => ({
    name: l.lineNumber,
    score: l.score,
  })), [lineStats])

  const scoreColor = (v: number) => (v >= 70 ? '#10b981' : v >= 40 ? '#f59e0b' : '#ef4444')
  const lineStatusLabel = (s: string) => isRtl
    ? (s === 'completed' ? 'مكتمل' : s === 'in_progress' ? 'قيد التنفيذ' : s === 'suspended' ? 'متوقف' : 'لم تبدأ')
    : (s === 'completed' ? 'Completed' : s === 'in_progress' ? 'In Progress' : s === 'suspended' ? 'Suspended' : 'Not Started')

  // v40: بطاقة تفوّق لخط حفر
  function LineSuperCard(props: { icon: any; title: string; tone: string; line: any; valueText: string; subText: string }) {
    const { icon: Icon, title, tone, line, valueText, subText } = props
    return (
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <Icon className={`h-4 w-4 ${tone}`} />
            <span className="text-xs text-muted-foreground">{title}</span>
          </div>
          {line ? (
            <>
              <p className="text-lg font-bold font-mono">{line.lineNumber}</p>
              <p className="text-sm font-semibold">{valueText}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{subText}</p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground mt-1">{isRtl ? 'غير متوفر' : 'N/A'}</p>
          )}
        </CardContent>
      </Card>
    )
  }

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
              <Clock className="h-4 w-4 text-purple-600" />
              <span className="text-xs text-muted-foreground">{isRtl ? 'كفاءة ساعات العمل' : 'Work Hours Efficiency'}</span>
            </div>
            <p className="text-xl font-bold text-purple-700">{avgWorkHours.toFixed(1)}%</p>
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

      {/* v40: تحليل أداء خطوط الحفر */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          {isRtl ? 'تحليل أداء خطوط الحفر' : 'Drive Lines Performance'}
        </h2>
        <Badge variant="outline" className="text-xs">{isRtl ? `${lineStats.length} خط` : `${lineStats.length} lines`}</Badge>
      </div>

      {lineStats.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground text-sm">
            {isRtl ? 'لا توجد خطوط حفر — أضف خطوطاً من قسم خطوط الحفر لتظهر التحليلات هنا' : 'No drive lines yet — add lines in the Drive Lines section'}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <LineSuperCard icon={Award} tone="text-emerald-600" title={isRtl ? 'أفضل خط حفر' : 'Best Drive Line'} line={lineSuper?.best}
              valueText={`${lineSuper?.best ? lineSuper.best.score : 0}/100`}
              subText={lineSuper?.best ? (isRtl ? `${Math.round(lineSuper.best.meters)} متر خلال ${lineSuper.best.reportDays} يوم عمل` : `${Math.round(lineSuper.best.meters)} m over ${lineSuper.best.reportDays} work days`) : ''} />
            <LineSuperCard icon={AlertTriangle} tone="text-red-600" title={isRtl ? 'أسوأ خط حفر' : 'Worst Drive Line'} line={lineSuper?.worst}
              valueText={`${lineSuper?.worst ? lineSuper.worst.score : 0}/100`}
              subText={lineSuper?.worst ? (isRtl ? `${Math.round(lineSuper.worst.meters)} متر — يحتاج خطة تحسين` : `${Math.round(lineSuper.worst.meters)} m — needs improvement`) : ''} />
            <LineSuperCard icon={Flame} tone="text-orange-600" title={isRtl ? 'أكثر خط مكلفاً' : 'Most Costly Line'} line={lineSuper?.mostCostly}
              valueText={lineSuper?.mostCostly ? `${Math.round(lineSuper.mostCostly.cost).toLocaleString()} ر.ع` : '—'}
              subText={lineSuper?.mostCostly ? (isRtl ? `تكلفة المتر: ${lineSuper.mostCostly.costPerMeter.toFixed(2)} ر.ع` : `Cost/m: ${lineSuper.mostCostly.costPerMeter.toFixed(2)} OMR`) : ''} />
            <LineSuperCard icon={PiggyBank} tone="text-emerald-600" title={isRtl ? 'أقل خط مكلفاً' : 'Least Costly Line'} line={lineSuper?.leastCostly}
              valueText={lineSuper?.leastCostly ? `${Math.round(lineSuper.leastCostly.cost).toLocaleString()} ر.ع` : '—'}
              subText={lineSuper?.leastCostly ? (isRtl ? `تكلفة المتر: ${lineSuper.leastCostly.costPerMeter.toFixed(2)} ر.ع` : `Cost/m: ${lineSuper.leastCostly.costPerMeter.toFixed(2)} OMR`) : ''} />
            <LineSuperCard icon={TrendingUp} tone="text-blue-600" title={isRtl ? 'أكثر خط إيراداً' : 'Highest Revenue Line'} line={lineSuper?.mostRevenue}
              valueText={lineSuper?.mostRevenue ? `${Math.round(lineSuper.mostRevenue.revenue).toLocaleString()} ر.ع` : '—'}
              subText={lineSuper?.mostRevenue ? (isRtl ? `ربح: ${Math.round(lineSuper.mostRevenue.profit).toLocaleString()} ر.ع` : `Profit: ${Math.round(lineSuper.mostRevenue.profit).toLocaleString()} OMR`) : ''} />
            <LineSuperCard icon={Medal} tone="text-amber-600" title={isRtl ? 'أعلى خط ربحية' : 'Best Margin Line'} line={lineSuper?.mostProfitable}
              valueText={lineSuper?.mostProfitable ? `${lineSuper.mostProfitable.profitMargin.toFixed(1)}%` : '—'}
              subText={lineSuper?.mostProfitable ? (isRtl ? `ربح: ${Math.round(lineSuper.mostProfitable.profit).toLocaleString()} ر.ع` : `Profit: ${Math.round(lineSuper.mostProfitable.profit).toLocaleString()} OMR`) : ''} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-primary" />
                  {isRtl ? 'الإيرادات مقابل التكاليف لكل خط' : 'Revenue vs Cost per Line'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {lineFinancialData.length === 0 ? (
                  <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
                    {isRtl ? 'لا توجد تقارير معتمدة بعد' : 'No approved reports yet'}
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={lineFinancialData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip contentStyle={tooltipContentStyle} />
                      <Bar dataKey="revenue" fill="#10b981" name={isRtl ? 'الإيراد' : 'Revenue'} radius={[4, 4, 0, 0]} />
                      <Bar dataKey="cost" fill="#ef4444" name={isRtl ? 'التكلفة' : 'Cost'} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Activity className="h-4 w-4 text-primary" />
                  {isRtl ? 'مؤشر الأداء لكل خط (0-100)' : 'Performance Score per Line'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {lineScoreData.length === 0 ? (
                  <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
                    {isRtl ? 'لا توجد تقارير معتمدة بعد' : 'No approved reports yet'}
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={lineScoreData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                      <Tooltip contentStyle={tooltipContentStyle} />
                      <Bar dataKey="score" name={isRtl ? 'المؤشر' : 'Score'} radius={[4, 4, 0, 0]}>
                        {lineScoreData.map((entry: any, i: number) => (
                          <Cell key={i} fill={scoreColor(entry.score)} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{isRtl ? 'لوحة ترتيب خطوط الحفر' : 'Drive Lines Leaderboard'}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-right">
                      <th className="p-2 font-medium text-muted-foreground">#</th>
                      <th className="p-2 font-medium text-muted-foreground">{isRtl ? 'الخط' : 'Line'}</th>
                      <th className="p-2 font-medium text-muted-foreground">{isRtl ? 'الحالة' : 'Status'}</th>
                      <th className="p-2 font-medium text-muted-foreground">{isRtl ? 'الإنجاز' : 'Progress'}</th>
                      <th className="p-2 font-medium text-muted-foreground">{isRtl ? 'الأمتار' : 'Meters'}</th>
                      <th className="p-2 font-medium text-muted-foreground">{isRtl ? 'الإيراد' : 'Revenue'}</th>
                      <th className="p-2 font-medium text-muted-foreground">{isRtl ? 'التكلفة' : 'Cost'}</th>
                      <th className="p-2 font-medium text-muted-foreground">{isRtl ? 'الربح' : 'Profit'}</th>
                      <th className="p-2 font-medium text-muted-foreground">{isRtl ? 'الهامش' : 'Margin'}</th>
                      <th className="p-2 font-medium text-muted-foreground">{isRtl ? 'تكلفة/م' : 'Cost/m'}</th>
                      <th className="p-2 font-medium text-muted-foreground">{isRtl ? 'حوادث' : 'Incidents'}</th>
                      <th className="p-2 font-medium text-muted-foreground">{isRtl ? 'المؤشر' : 'Score'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineStats.map((l: any, idx: number) => (
                      <tr key={l.id} className="border-b hover:bg-muted/30">
                        <td className="p-2 text-xs font-bold">{idx + 1}</td>
                        <td className="p-2">
                          <p className="font-medium text-xs font-mono">{l.lineNumber}</p>
                          {selectedProject === 'all' && <p className="text-[11px] text-muted-foreground">{l.projectName}</p>}
                        </td>
                        <td className="p-2">
                          <Badge variant={l.status === 'completed' ? 'default' : l.status === 'suspended' ? 'destructive' : 'secondary'} className="text-[10px]">
                            {lineStatusLabel(l.status)}
                          </Badge>
                        </td>
                        <td className="p-2">
                          <div className="flex items-center gap-1.5">
                            <Progress value={l.progress} className="h-1.5 w-12" />
                            <span className="text-xs">{Math.round(l.progress)}%</span>
                          </div>
                        </td>
                        <td className="p-2 text-xs">{Math.round(l.meters)}<span className="text-muted-foreground"> / {Math.round(l.totalLength)}</span></td>
                        <td className="p-2 text-xs text-emerald-700 font-medium">{Math.round(l.revenue).toLocaleString()}</td>
                        <td className="p-2 text-xs text-red-700 font-medium">{Math.round(l.cost).toLocaleString()}</td>
                        <td className={`p-2 text-xs font-medium ${l.profit >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{Math.round(l.profit).toLocaleString()}</td>
                        <td className="p-2">
                          <Badge variant={l.profitMargin >= 20 ? 'default' : l.profitMargin >= 0 ? 'secondary' : 'destructive'} className="text-xs">
                            {l.profitMargin.toFixed(1)}%
                          </Badge>
                        </td>
                        <td className="p-2 text-xs">{l.costPerMeter > 0 ? l.costPerMeter.toFixed(2) : '—'}</td>
                        <td className="p-2">
                          {(l.nearMiss + l.minorIncidents + l.majorAccidents) > 0 ? (
                            <Badge variant="destructive" className="text-[10px]">{l.nearMiss + l.minorIncidents + l.majorAccidents}</Badge>
                          ) : (
                            <span className="text-emerald-600 text-xs">0</span>
                          )}
                        </td>
                        <td className="p-2">
                          <Badge variant="outline" className="text-xs font-bold" style={{ color: scoreColor(l.score), borderColor: scoreColor(l.score) }}>
                            {l.score}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-muted-foreground mt-3">
                {isRtl ? 'المؤشر المركب = 35% الإنتاج + 25% الربحية + 25% كفاءة التكلفة + 15% السلامة — يُحسب من التقارير المعتمدة لكامل عمر الخط' : 'Composite score = 35% production + 25% profitability + 25% cost efficiency + 15% safety — from approved reports over the line lifetime'}
              </p>
            </CardContent>
          </Card>
        </>
      )}

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
