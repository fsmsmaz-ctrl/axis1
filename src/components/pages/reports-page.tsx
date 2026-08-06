'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import {
  FileText, FileSpreadsheet, FileBarChart, Calendar, DollarSign,
  Shield, Users, Wrench, CheckCircle2, TrendingUp, Download
} from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { authedFetch } from '@/lib/api-client'
import { hasReportPermission } from '@/lib/auth'
import { toast } from 'sonner'

interface ReportType {
  id: string
  labelAr: string
  labelEn: string
  icon: any
  color: string
  description: string
}

const reportTypes: ReportType[] = [
  { id: 'rpt_daily_site', labelAr: 'التقرير اليومي للموقع', labelEn: 'Daily Site Report', icon: FileText, color: 'text-blue-600', description: 'تقرير شامل لكل ما يحدث في الموقع يومياً' },
  { id: 'rpt_production', labelAr: 'تقرير الإنتاج اليومي', labelEn: 'Production Report', icon: TrendingUp, color: 'text-emerald-600', description: 'تفاصيل الإنتاج اليومي والأمتار المنجزة' },
  { id: 'rpt_safety', labelAr: 'تقرير السلامة اليومي', labelEn: 'Safety Report', icon: Shield, color: 'text-orange-600', description: 'فحوصات السلامة والمخالفات' },
  { id: 'rpt_attendance', labelAr: 'تقرير الحضور', labelEn: 'Attendance Report', icon: Users, color: 'text-purple-600', description: 'حضور العمال والغياب' },
  { id: 'rpt_revenue', labelAr: 'تقرير الإيرادات', labelEn: 'Revenue Report', icon: DollarSign, color: 'text-emerald-600', description: 'الإيرادات اليومية والشهرية من التقارير المعتمدة' },
  { id: 'rpt_costs', labelAr: 'تقرير التكاليف', labelEn: 'Cost Report', icon: DollarSign, color: 'text-red-600', description: 'التكاليف حسب الفئة والمشروع' },
  { id: 'rpt_profit', labelAr: 'تقرير صافي الربح', labelEn: 'Profit Report', icon: DollarSign, color: 'text-blue-600', description: 'صافي الربح وهامش الربحية التفصيلي' },
  { id: 'rpt_equipment', labelAr: 'تقرير المعدات', labelEn: 'Equipment Report', icon: Wrench, color: 'text-cyan-600', description: 'حالة المعدات والصيانة' },
  { id: 'rpt_weekly', labelAr: 'تقرير الإنجاز الأسبوعي', labelEn: 'Weekly Progress', icon: Calendar, color: 'text-indigo-600', description: 'ملخص أسبوعي لجميع الأعمال' },
  { id: 'rpt_monthly', labelAr: 'تقرير شهري للإدارة', labelEn: 'Monthly Management', icon: FileBarChart, color: 'text-purple-600', description: 'تقرير شهري للإدارة العليا' },
  { id: 'rpt_handover', labelAr: 'تقرير تسليم الأعمال', labelEn: 'Handover Report', icon: CheckCircle2, color: 'text-emerald-600', description: 'تقارير التشطيب والتسليم' },
]

export default function ReportsPage() {
  const [projects, setProjects] = useState<any[]>([])
  const [selectedReport, setSelectedReport] = useState<string>('')
  const [selectedProject, setSelectedProject] = useState<string>('all')
  const user = useAppStore((s) => s.user)
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [reportData, setReportData] = useState<any>(null)
  const [generating, setGenerating] = useState(false)
  const language = useAppStore((s) => s.language)
  const token = useAppStore((s) => s.token)
  const isRtl = language === 'ar'

  async function fetchProjectList() {
    try {
      var res = await authedFetch('/api/projects/list?_t=' + Date.now(), { cache: 'no-store' })
      if (!res.ok) { setProjects([]); return }
      var data = await res.json()
      setProjects(data.projects || [])
    } catch {
      setProjects([])
    }
  }

  useEffect(function() {
    if (!token) return
    fetchProjectList()
    var today = new Date()
    var thirtyAgo = new Date()
    thirtyAgo.setDate(thirtyAgo.getDate() - 30)
    setToDate(today.toISOString().split('T')[0])
    setFromDate(thirtyAgo.toISOString().split('T')[0])
  }, [token])

  async function generateReport() {
    if (!selectedReport) {
      toast.error(isRtl ? 'اختر نوع التقرير' : 'Select report type')
      return
    }

    setGenerating(true)
    try {
      var params = new URLSearchParams()
      if (selectedProject !== 'all') params.set('projectId', selectedProject)
      if (fromDate) params.set('from', fromDate)
      if (toDate) params.set('to', toDate)

      var endpoint = '/api/dashboard'
      if (selectedReport === 'rpt_production' || selectedReport === 'rpt_daily_site' || selectedReport === 'rpt_attendance') {
        endpoint = '/api/daily-reports?' + params.toString()
      } else if (selectedReport === 'rpt_safety') {
        endpoint = '/api/daily-reports?' + params.toString()
      } else if (selectedReport === 'rpt_costs' || selectedReport === 'rpt_profit' || selectedReport === 'rpt_revenue') {
        // Fetch both costs and daily reports for complete financial picture
        var costsRes = await authedFetch('/api/costs?' + params.toString())
        var costsData = await costsRes.json()
        var reportsRes = await authedFetch('/api/daily-reports?limit=500&' + params.toString())
        var reportsData = await reportsRes.json()
        var dashRes = await authedFetch('/api/dashboard')
        var dashData = await dashRes.json()
        setReportData({
          type: selectedReport,
          data: {
            costs: costsData.costs || [],
            byCategory: costsData.byCategory || [],
            totalCosts: costsData.grandTotal || costsData.total || 0,
            totalRentalCost: costsData.totalRentalCost || 0,
            rentalAssets: costsData.rentalAssets || [],
            reports: reportsData.reports || [],
            stats: dashData.stats || {},
          },
          project: projects.find(function(p) { return p.id === selectedProject }),
          fromDate, toDate
        })
        toast.success(isRtl ? 'تم توليد التقرير' : 'Report generated')
        setGenerating(false)
        return
      } else if (selectedReport === 'rpt_equipment') {
        endpoint = '/api/equipment?' + params.toString()
      } else if (selectedReport === 'rpt_handover') {
        endpoint = '/api/finishings?' + params.toString()
      } else if (selectedReport === 'rpt_monthly' || selectedReport === 'rpt_weekly') {
        endpoint = '/api/dashboard'
      }

      var res = await authedFetch(endpoint)
      var data = await res.json()
      setReportData({ type: selectedReport, data, project: projects.find(function(p) { return p.id === selectedProject }), fromDate, toDate })
      toast.success(isRtl ? 'تم توليد التقرير' : 'Report generated')
    } catch (err) {
      toast.error(isRtl ? 'فشل توليد التقرير' : 'Failed to generate')
    } finally {
      setGenerating(false)
    }
  }

  function exportPDF() {
    if (!reportData) return
    window.print()
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{isRtl ? 'التقارير' : 'Reports'}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {isRtl ? 'توليد التقارير بصيغة PDF و Excel' : 'Generate reports in PDF and Excel formats'}
        </p>
      </div>

      {/* Report type selection */}
      <div>
        <Label className="mb-2 block">{isRtl ? 'اختر نوع التقرير' : 'Select Report Type'}</Label>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {reportTypes
            .filter(function(r) { return user && hasReportPermission(user.role, r.id, user.permissions) })
            .map(function(r) {
            var Icon = r.icon
            var isSelected = selectedReport === r.id
            return (
              <button
                key={r.id}
                onClick={function() { setSelectedReport(r.id) }}
                className={"flex items-start gap-3 p-3 rounded-lg border-2 text-right transition " + (isSelected
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/30 hover:bg-muted/30'
                )}
              >
                <div className={"w-9 h-9 rounded-lg flex items-center justify-center shrink-0 " + (isSelected ? 'bg-primary/10' : 'bg-muted')}>
                  <Icon className={"h-5 w-5 " + (isSelected ? r.color : 'text-muted-foreground')} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{isRtl ? r.labelAr : r.labelEn}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{r.description}</p>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{isRtl ? 'خيارات التقرير' : 'Report Options'}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">{isRtl ? 'المشروع' : 'Project'}</Label>
              <Select value={selectedProject} onValueChange={setSelectedProject}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{isRtl ? 'كل المشاريع' : 'All Projects'}</SelectItem>
                  {projects.map(function(p) {
                    return <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  })}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{isRtl ? 'من تاريخ' : 'From Date'}</Label>
              <Input type="date" value={fromDate} onChange={function(e) { setFromDate(e.target.value) }} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{isRtl ? 'إلى تاريخ' : 'To Date'}</Label>
              <Input type="date" value={toDate} onChange={function(e) { setToDate(e.target.value) }} />
            </div>
          </div>

          <div className="flex gap-2 flex-wrap">
            <Button onClick={generateReport} disabled={!selectedReport || generating}>
              <FileBarChart className="h-4 w-4 ml-2" />
              {generating ? (isRtl ? 'جاري التوليد...' : 'Generating...') : (isRtl ? 'توليد التقرير' : 'Generate Report')}
            </Button>
            {reportData && (
              <Button variant="outline" onClick={exportPDF}>
                <FileText className="h-4 w-4 ml-2" />
                {isRtl ? 'تصدير PDF' : 'Export PDF'}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Report preview */}
      {reportData && (
        <Card>
          <CardHeader className="no-print">
            <CardTitle className="flex items-center justify-between">
              <span>{isRtl ? 'معاينة التقرير' : 'Report Preview'}</span>
              <Button variant="ghost" size="sm" onClick={function() { window.print() }}>
                <Download className="h-4 w-4 ml-1" />
                {isRtl ? 'طباعة/حفظ' : 'Print/Save'}
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ReportPreview data={reportData} />
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function ReportPreview({ data }: { data: any }) {
  const language = useAppStore((s) => s.language)
  const isRtl = language === 'ar'

  var reportType = reportTypes.find(function(r) { return r.id === data.type })
  if (!reportType) return null

  var fmt = function(n: number) { return (n || 0).toLocaleString(isRtl ? 'ar-EG' : 'en-US', { maximumFractionDigits: 0 }) }

  return (
    <div className="space-y-4">
      <div className="text-center pb-4 border-b">
        <h2 className="text-xl font-bold">AXIS - {isRtl ? reportType.labelAr : reportType.labelEn}</h2>
        <p className="text-sm text-muted-foreground mt-1">
          {data.project ? data.project.name : (isRtl ? 'كل المشاريع' : 'All Projects')}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          {isRtl ? 'الفترة' : 'Period'}: {data.fromDate} → {data.toDate}
        </p>
      </div>

      {/* Revenue Report - Complete */}
      {data.type === 'rpt_revenue' ? (
        <div className="space-y-4">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 rounded-lg border bg-emerald-50/50">
              <p className="text-xs text-muted-foreground">{isRtl ? 'إجمالي الإيرادات' : 'Total Revenue'}</p>
              <p className="font-bold text-lg text-emerald-700">{fmt(data.data.stats.totalRevenue)} ر.ع</p>
            </div>
            <div className="p-3 rounded-lg border">
              <p className="text-xs text-muted-foreground">{isRtl ? 'إيراد الشهر' : 'Month Revenue'}</p>
              <p className="font-bold text-lg">{fmt(data.data.stats.revenueThisMonth)} ر.ع</p>
            </div>
            <div className="p-3 rounded-lg border">
              <p className="text-xs text-muted-foreground">{isRtl ? 'إيراد اليوم' : 'Today Revenue'}</p>
              <p className="font-bold text-lg">{fmt(data.data.stats.revenueToday)} ر.ع</p>
            </div>
            <div className="p-3 rounded-lg border">
              <p className="text-xs text-muted-foreground">{isRtl ? 'أمتار الشهر' : 'Month Meters'}</p>
              <p className="font-bold text-lg">{fmt(data.data.stats.metersThisMonth)} م</p>
            </div>
          </div>

          {/* Revenue Table */}
          <h3 className="font-semibold text-sm">{isRtl ? 'تفاصيل الإيرادات من التقارير المعتمدة' : 'Revenue Details from Approved Reports'}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="p-2 text-right">{isRtl ? 'التاريخ' : 'Date'}</th>
                  <th className="p-2 text-right">{isRtl ? 'المشروع' : 'Project'}</th>
                  <th className="p-2 text-right">{isRtl ? 'خط الحفر' : 'Line'}</th>
                  <th className="p-2 text-right">{isRtl ? 'الأمتار' : 'Meters'}</th>
                  <th className="p-2 text-right">{isRtl ? 'سعر المتر' : 'Price/m'}</th>
                  <th className="p-2 text-right">{isRtl ? 'الإيراد' : 'Revenue'}</th>
                  <th className="p-2 text-right">{isRtl ? 'الحالة' : 'Status'}</th>
                </tr>
              </thead>
              <tbody>
                {(data.data.reports || []).filter(function(r: any) { return r.status === 'approved' }).map(function(r: any) {
                  return (
                    <tr key={r.id} className="border-b">
                      <td className="p-2">{r.reportDate ? new Date(r.reportDate).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US') : '-'}</td>
                      <td className="p-2">{r.project ? r.project.name : '-'}</td>
                      <td className="p-2">{r.driveLine ? r.driveLine.lineNumber : '-'}</td>
                      <td className="p-2">{r.dailyMeters || 0} م</td>
                      <td className="p-2">{r.project ? (r.project.pricePerMeter || 0) : 0} ر.ع</td>
                      <td className="p-2 font-semibold text-emerald-700">{(r.dailyRevenue || 0).toLocaleString()} ر.ع</td>
                      <td className="p-2"><span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 text-xs">{isRtl ? 'معتمد' : 'Approved'}</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : data.type === 'rpt_costs' ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-lg border bg-red-50/50">
              <p className="text-xs text-muted-foreground">{isRtl ? 'إجمالي التكاليف' : 'Total Costs'}</p>
              <p className="font-bold text-lg text-red-700">{fmt(data.data.totalCosts)} ر.ع</p>
              {data.data.totalRentalCost > 0 && (
                <p className="text-xs text-teal-600 mt-1">{isRtl ? 'شامل ' + fmt(data.data.totalRentalCost) + ' ر.ع إيجارات' : 'incl. ' + fmt(data.data.totalRentalCost) + ' OMR rentals'}</p>
              )}
            </div>
            <div className="p-3 rounded-lg border">
              <p className="text-xs text-muted-foreground">{isRtl ? 'عدد المصروفات' : 'Expenses Count'}</p>
              <p className="font-bold text-lg">{(data.data.costs || []).length}</p>
              {data.data.totalRentalCost > 0 && (
                <p className="text-xs text-teal-600 mt-1">+{(data.data.rentalAssets || []).length} {isRtl ? 'أصل مستأجر' : 'rented assets'}</p>
              )}
            </div>
          </div>
          <h3 className="font-semibold text-sm">{isRtl ? 'التكاليف حسب الفئة' : 'Costs by Category'}</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {(data.data.byCategory || []).map(function(c: any) {
              var catNames: Record<string, { ar: string; en: string }> = {
                labor: { ar: 'أجور العمال', en: 'Labor' }, housing: { ar: 'سكن', en: 'Housing' },
                transport: { ar: 'نقل', en: 'Transport' }, fuel: { ar: 'ديزل', en: 'Fuel' },
                maintenance: { ar: 'صيانة', en: 'Maintenance' }, parts: { ar: 'قطع غيار', en: 'Parts' },
                oil: { ar: 'زيوت', en: 'Oil' }, safety: { ar: 'سلامة', en: 'Safety' },
                rental: { ar: 'إيجار', en: 'Rental' }, other: { ar: 'أخرى', en: 'Other' },
              }
              var label = catNames[c.category] ? (isRtl ? catNames[c.category].ar : catNames[c.category].en) : c.category
              return (
                <div key={c.category} className="p-3 rounded-lg border">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="font-bold text-sm">{c.amount.toLocaleString()} ر.ع</p>
                </div>
              )
            })}
          </div>
          <h3 className="font-semibold text-sm">{isRtl ? 'تفاصيل المصروفات' : 'Expenses Details'}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="p-2 text-right">{isRtl ? 'التاريخ' : 'Date'}</th>
                  <th className="p-2 text-right">{isRtl ? 'الفئة' : 'Category'}</th>
                  <th className="p-2 text-right">{isRtl ? 'الوصف' : 'Description'}</th>
                  <th className="p-2 text-right">{isRtl ? 'المبلغ' : 'Amount'}</th>
                </tr>
              </thead>
              <tbody>
                {(data.data.costs || []).slice(0, 50).map(function(c: any) {
                  return (
                    <tr key={c.id} className="border-b">
                      <td className="p-2">{new Date(c.date).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US')}</td>
                      <td className="p-2">{c.category}</td>
                      <td className="p-2">{c.description}</td>
                      <td className="p-2 text-red-600">{c.amount.toLocaleString()} ر.ع</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {(data.data.rentalAssets || []).length > 0 && (
            <div>
              <h3 className="font-semibold text-sm">{isRtl ? 'تفاصيل الأصول المستأجرة (شهري)' : 'Rented Assets Details (Monthly)'}</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-teal-50">
                      <th className="p-2 text-right">{isRtl ? 'الأصل' : 'Asset'}</th>
                      <th className="p-2 text-right">{isRtl ? 'المورد' : 'Supplier'}</th>
                      <th className="p-2 text-right">{isRtl ? 'المشروع' : 'Project'}</th>
                      <th className="p-2 text-right">{isRtl ? 'الإيجار/شهر' : 'Rent/Month'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.data.rentalAssets || []).map(function(ra: any, idx: number) {
                      return (
                        <tr key={idx} className="border-b">
                          <td className="p-2">{ra.name}</td>
                          <td className="p-2">{ra.supplier}</td>
                          <td className="p-2">{ra.projectName}</td>
                          <td className="p-2 text-teal-700 font-semibold">{ra.rentalCost.toLocaleString()} ر.ع</td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 font-bold">
                      <td className="p-2" colSpan={3}>{isRtl ? 'الإجمالي' : 'Total'}</td>
                      <td className="p-2 text-teal-700">{fmt(data.data.totalRentalCost)} ر.ع/شهر</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </div>
      ) : data.type === 'rpt_profit' ? (
        <div className="space-y-4">
          {/* Profit Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 rounded-lg border bg-emerald-50/50">
              <p className="text-xs text-muted-foreground">{isRtl ? 'إجمالي الإيرادات' : 'Total Revenue'}</p>
              <p className="font-bold text-lg text-emerald-700">{fmt(data.data.stats.totalRevenue)} ر.ع</p>
            </div>
            <div className="p-3 rounded-lg border bg-red-50/50">
              <p className="text-xs text-muted-foreground">{isRtl ? 'إجمالي التكاليف' : 'Total Costs'}</p>
              <p className="font-bold text-lg text-red-700">{fmt(data.data.stats.totalCosts)} ر.ع</p>
            </div>
            <div className="p-3 rounded-lg border bg-blue-50/50">
              <p className="text-xs text-muted-foreground">{isRtl ? 'صافي الربح' : 'Net Profit'}</p>
              <p className={"font-bold text-lg " + ((data.data.stats.netProfit || 0) >= 0 ? 'text-blue-700' : 'text-red-700')}>{fmt(data.data.stats.netProfit)} ر.ع</p>
            </div>
            <div className="p-3 rounded-lg border">
              <p className="text-xs text-muted-foreground">{isRtl ? 'هامش الربح' : 'Profit Margin'}</p>
              <p className={"font-bold text-lg " + ((data.data.stats.netProfit || 0) >= 0 ? 'text-purple-700' : 'text-red-700')}>
                {(data.data.stats.totalRevenue || 0) > 0 ? (((data.data.stats.netProfit || 0) / (data.data.stats.totalRevenue || 1)) * 100).toFixed(1) : '0.0'}%
              </p>
            </div>
          </div>

          {/* Rental costs breakdown in profit report */}
          {(data.data.stats.monthlyRentalCost || 0) > 0 && (
            <div className="p-3 rounded-lg border bg-teal-50/50">
              <p className="text-xs text-muted-foreground">{isRtl ? 'الإيجارات الشهرية' : 'Monthly Rentals'}</p>
              <p className="font-bold text-lg text-teal-700">{fmt(data.data.stats.monthlyRentalCost)} ر.ع/شهر</p>
            </div>
          )}

          {/* Revenue breakdown */}
          <h3 className="font-semibold text-sm">{isRtl ? 'تفاصيل الإيرادات (التقارير المعتمدة)' : 'Revenue Details (Approved Reports)'}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="p-2 text-right">{isRtl ? 'التاريخ' : 'Date'}</th>
                  <th className="p-2 text-right">{isRtl ? 'المشروع' : 'Project'}</th>
                  <th className="p-2 text-right">{isRtl ? 'الأمتار' : 'Meters'}</th>
                  <th className="p-2 text-right">{isRtl ? 'الإيراد' : 'Revenue'}</th>
                </tr>
              </thead>
              <tbody>
                {(data.data.reports || []).filter(function(r: any) { return r.status === 'approved' }).map(function(r: any) {
                  return (
                    <tr key={r.id} className="border-b">
                      <td className="p-2">{r.reportDate ? new Date(r.reportDate).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US') : '-'}</td>
                      <td className="p-2">{r.project ? r.project.name : '-'}</td>
                      <td className="p-2">{r.dailyMeters || 0} م</td>
                      <td className="p-2 font-semibold text-emerald-700">{(r.dailyRevenue || 0).toLocaleString()} ر.ع</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Costs breakdown */}
          <h3 className="font-semibold text-sm">{isRtl ? 'تفاصيل التكاليف' : 'Costs Details'}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="p-2 text-right">{isRtl ? 'الفئة' : 'Category'}</th>
                  <th className="p-2 text-right">{isRtl ? 'المبلغ' : 'Amount'}</th>
                </tr>
              </thead>
              <tbody>
                {(data.data.byCategory || []).map(function(c: any) {
                  return (
                    <tr key={c.category} className="border-b">
                      <td className="p-2">{c.category}</td>
                      <td className="p-2 text-red-600">{c.amount.toLocaleString()} ر.ع</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : data.type === 'rpt_daily_site' || data.type === 'rpt_production' ? (
        <div className="space-y-3">
          <h3 className="font-semibold text-sm">{isRtl ? 'سجل التقارير' : 'Reports Log'}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-right">
                  <th className="p-2">{isRtl ? 'التاريخ' : 'Date'}</th>
                  <th className="p-2">{isRtl ? 'المشروع' : 'Project'}</th>
                  <th className="p-2">{isRtl ? 'الخط' : 'Line'}</th>
                  <th className="p-2">{isRtl ? 'أمتار' : 'Meters'}</th>
                  <th className="p-2">{isRtl ? 'إيراد' : 'Revenue'}</th>
                  <th className="p-2">{isRtl ? 'العمال' : 'Workers'}</th>
                  <th className="p-2">{isRtl ? 'الحالة' : 'Status'}</th>
                </tr>
              </thead>
              <tbody>
                {(data.data.reports || []).slice(0, 30).map(function(r: any) {
                  return (
                    <tr key={r.id} className="border-b">
                      <td className="p-2">{new Date(r.reportDate).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US')}</td>
                      <td className="p-2">{r.project?.name}</td>
                      <td className="p-2">{r.driveLine?.lineNumber || '-'}</td>
                      <td className="p-2">{r.dailyMeters} م</td>
                      <td className="p-2">{(r.dailyRevenue || 0).toLocaleString()} ر.ع</td>
                      <td className="p-2">{r.workersCount}</td>
                      <td className="p-2">{r.status}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : data.type === 'rpt_safety' ? (
        <div className="space-y-3">
          <h3 className="font-semibold text-sm">{isRtl ? 'تقارير السلامة' : 'Safety Reports'}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-right">
                  <th className="p-2">{isRtl ? 'التاريخ' : 'Date'}</th>
                  <th className="p-2">{isRtl ? 'المشروع' : 'Project'}</th>
                  <th className="p-2">{isRtl ? 'المخالفات' : 'Violations'}</th>
                  <th className="p-2">{isRtl ? 'الحوادث' : 'Incidents'}</th>
                  <th className="p-2">{isRtl ? 'موقّع من' : 'Signed by'}</th>
                </tr>
              </thead>
              <tbody>
                {(data.data.reports || []).filter(function(r: any) { return r.safety }).slice(0, 30).map(function(r: any) {
                  return (
                    <tr key={r.id} className="border-b">
                      <td className="p-2">{new Date(r.reportDate).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US')}</td>
                      <td className="p-2">{r.project?.name}</td>
                      <td className="p-2">{r.safety.violations || '-'}</td>
                      <td className="p-2">{r.safety.incidentType}</td>
                      <td className="p-2">{r.safety.signedBy}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : data.type === 'rpt_attendance' ? (
        <div className="space-y-3">
          <h3 className="font-semibold text-sm">{isRtl ? 'سجل الحضور' : 'Attendance Log'}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-right">
                  <th className="p-2">{isRtl ? 'التاريخ' : 'Date'}</th>
                  <th className="p-2">{isRtl ? 'المشروع' : 'Project'}</th>
                  <th className="p-2">{isRtl ? 'عدد العمال' : 'Workers'}</th>
                  <th className="p-2">{isRtl ? 'ساعات التشغيل' : 'Op. Hours'}</th>
                  <th className="p-2">{isRtl ? 'ساعات التوقف' : 'Stop. Hours'}</th>
                </tr>
              </thead>
              <tbody>
                {(data.data.reports || []).slice(0, 30).map(function(r: any) {
                  return (
                    <tr key={r.id} className="border-b">
                      <td className="p-2">{new Date(r.reportDate).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US')}</td>
                      <td className="p-2">{r.project?.name}</td>
                      <td className="p-2">{r.workersCount}</td>
                      <td className="p-2">{r.operatingHours}</td>
                      <td className="p-2">{r.stoppageHours}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : data.type === 'rpt_equipment' ? (
        <div className="space-y-3">
          <h3 className="font-semibold text-sm">{isRtl ? 'قائمة المعدات' : 'Equipment List'}</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {(data.data.equipment || []).map(function(eq: any) {
              return (
                <div key={eq.id} className="p-3 rounded-lg border">
                  <p className="font-medium text-sm">{eq.name}</p>
                  <p className="text-xs text-muted-foreground font-mono">{eq.number}</p>
                  <p className="text-xs mt-1">
                    <span className={"inline-block px-1.5 py-0.5 rounded text-xs " + (
                      eq.status === 'operational' ? 'bg-emerald-50 text-emerald-700' :
                      eq.status === 'stopped' ? 'bg-red-50 text-red-700' : 'bg-orange-50 text-orange-700'
                    )}>
                      {eq.status === 'operational' ? (isRtl ? 'تعمل' : 'Operational') :
                       eq.status === 'stopped' ? (isRtl ? 'متوقفة' : 'Stopped') :
                       (isRtl ? 'تحتاج صيانة' : 'Maintenance')}
                    </span>
                  </p>
                </div>
              )
            })}
          </div>
        </div>
      ) : data.type === 'rpt_monthly' || data.type === 'rpt_weekly' ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 rounded-lg border">
              <p className="text-xs text-muted-foreground">{isRtl ? 'مشاريع نشطة' : 'Active Projects'}</p>
              <p className="font-bold text-lg">{data.data.stats?.activeProjects || 0}</p>
            </div>
            <div className="p-3 rounded-lg border">
              <p className="text-xs text-muted-foreground">{isRtl ? 'إيرادات' : 'Revenue'}</p>
              <p className="font-bold text-lg text-emerald-600">{fmt(data.data.stats?.totalRevenue)} ر.ع</p>
            </div>
            <div className="p-3 rounded-lg border">
              <p className="text-xs text-muted-foreground">{isRtl ? 'تكاليف' : 'Costs'}</p>
              <p className="font-bold text-lg text-red-600">{fmt(data.data.stats?.totalCosts)} ر.ع</p>
            </div>
            <div className="p-3 rounded-lg border">
              <p className="text-xs text-muted-foreground">{isRtl ? 'صافي ربح' : 'Net Profit'}</p>
              <p className={"font-bold text-lg " + ((data.data.stats?.netProfit || 0) >= 0 ? 'text-blue-700' : 'text-red-700')}>{fmt(data.data.stats?.netProfit)} ر.ع</p>
            </div>
          </div>
          <h3 className="font-semibold text-sm pt-3">{isRtl ? 'تقدم المشاريع' : 'Projects Progress'}</h3>
          <div className="space-y-2">
            {(data.data.projects || []).map(function(p: any) {
              return (
                <div key={p.id} className="flex items-center justify-between p-2 rounded border">
                  <span className="text-sm">{p.name}</span>
                  <span className="font-semibold text-sm">{p.progress.toFixed(1)}%</span>
                </div>
              )
            })}
          </div>
        </div>
      ) : data.type === 'rpt_handover' ? (
        <div className="space-y-3">
          <h3 className="font-semibold text-sm">{isRtl ? 'سجلات التسليم' : 'Handover Records'}</h3>
          <div className="space-y-2">
            {(data.data.finishings || []).map(function(f: any) {
              return (
                <div key={f.id} className="p-3 rounded-lg border">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm">{f.project?.name}</span>
                    <span className="text-xs px-2 py-0.5 rounded bg-muted">{f.handoverStatus}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {new Date(f.date).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US')}
                  </p>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="text-center py-8 text-muted-foreground text-sm">
          {isRtl ? 'اختر نوع تقرير لعرض المعاينة' : 'Select a report type to see preview'}
        </div>
      )}
    </div>
  )
}
