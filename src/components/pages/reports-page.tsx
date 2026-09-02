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
  { id: 'daily_site', labelAr: 'التقرير اليومي للموقع', labelEn: 'Daily Site Report', icon: FileText, color: 'text-blue-600', description: 'تقرير شامل لكل ما يحدث في الموقع يومياً' },
  { id: 'production', labelAr: 'تقرير الإنتاج اليومي', labelEn: 'Production Report', icon: TrendingUp, color: 'text-emerald-600', description: 'تفاصيل الإنتاج اليومي والأمتار المنجزة' },
  { id: 'safety', labelAr: 'تقرير السلامة اليومي', labelEn: 'Safety Report', icon: Shield, color: 'text-orange-600', description: 'فحوصات السلامة والمخالحات' },
  { id: 'attendance', labelAr: 'تقرير الحضور', labelEn: 'Attendance Report', icon: Users, color: 'text-purple-600', description: 'حضور العمال والغرائب' },
  { id: 'revenue', labelAr: 'تقرير الإيرادات', labelEn: 'Revenue Report', icon: DollarSign, color: 'text-emerald-600', description: 'الإيرادات اليومية والشهرية' },
  { id: 'costs', labelAr: 'تقرير التكاليف', labelEn: 'Cost Report', icon: DollarSign, color: 'text-red-600', description: 'التكاليف حسب الفئة' },
  { id: 'profit', labelAr: 'تقرير صافي الربح', labelEn: 'Profit Report', icon: DollarSign, color: 'text-blue-600', description: 'صافي الربح وهامش الربحية' },
  { id: 'equipment', labelAr: 'تقرير المعدات', labelEn: 'Equipment Report', icon: Wrench, color: 'text-cyan-600', description: 'حالة المعدات والصيانة' },
  { id: 'weekly', labelAr: 'تقرير الإنجاز الأسبوعي', labelEn: 'Weekly Progress', icon: Calendar, color: 'text-indigo-600', description: 'ملخص أسبوعي لجميع الأعمال' },
  { id: 'monthly', labelAr: 'تقرير شهري للإدارة', labelEn: 'Monthly Management', icon: FileBarChart, color: 'text-purple-600', description: 'تقرير شهري للإدارة العليا' },
  { id: 'handover', labelAr: 'تقرير تسليم الأعمال', labelEn: 'Handover Report', icon: CheckCircle2, color: 'text-emerald-600', description: 'تقارير التشطيب والتسليم' },
]

// ── Shared label maps (Arabic-first UI) ──
const reportStatusLabels: Record<string, { ar: string; en: string }> = {
  draft: { ar: 'مسودة', en: 'Draft' },
  submitted: { ar: 'مرسل', en: 'Submitted' },
  pending_approval: { ar: 'بانتظار الاعتماد', en: 'Pending Approval' },
  approved: { ar: 'معتمد', en: 'Approved' },
  rejected: { ar: 'مرفوض', en: 'Rejected' },
}

const incidentLabels: Record<string, { ar: string; en: string }> = {
  none: { ar: 'لا يوجد', en: 'None' },
  near_miss: { ar: 'شبه حادث', en: 'Near Miss' },
  incident: { ar: 'حادث', en: 'Incident' },
  accident: { ar: 'حادث مع إصابة', en: 'Accident' },
}

const handoverStatusLabels: Record<string, { ar: string; en: string }> = {
  pending: { ar: 'بانتظار القبول', en: 'Pending' },
  accepted: { ar: 'مقبول', en: 'Accepted' },
  needs_revision: { ar: 'يحتاج تعديل', en: 'Needs Revision' },
  rejected: { ar: 'مرفوض', en: 'Rejected' },
}

const equipmentStatusLabels: Record<string, { ar: string; en: string }> = {
  operational: { ar: 'تعمل', en: 'Operational' },
  maintenance_needed: { ar: 'تحتاج صيانة', en: 'Maintenance Needed' },
  stopped: { ar: 'متوقفة', en: 'Stopped' },
}

function localized(map: Record<string, { ar: string; en: string }>, key: any, isRtl: boolean): string {
  const item = key ? map[String(key)] : undefined
  if (!item) return key ? String(key) : '-'
  return isRtl ? item.ar : item.en
}

function fmtNum(n: any): string {
  const v = Number(n)
  return isNaN(v) ? '0' : v.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

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
  const isRtl = language === 'ar'

  useEffect(() => {
    authedFetch('/api/projects/list')
      .then(r => r.json())
      .then(d => setProjects(d.projects || []))
      .catch(() => setProjects([]))
    // Default to last 30 days
    const today = new Date()
    const thirtyAgo = new Date()
    thirtyAgo.setDate(thirtyAgo.getDate() - 30)
    setToDate(today.toISOString().split('T')[0])
    setFromDate(thirtyAgo.toISOString().split('T')[0])
  }, [])

  async function generateReport() {
    if (!selectedReport) {
      toast.error(isRtl ? 'اختر نوع التقرير' : 'Select report type')
      return
    }

    setGenerating(true)
    try {
      // Fetch data based on report type
      const params = new URLSearchParams()
      if (selectedProject !== 'all') params.set('projectId', selectedProject)
      if (fromDate) params.set('from', fromDate)
      if (toDate) params.set('to', toDate)
      // Ask for a larger batch so period reports cover the whole range
      params.set('limit', '500')
      const qs = params.toString()

      let data: any = {}

      if (
        selectedReport === 'production' || selectedReport === 'daily_site' ||
        selectedReport === 'safety' || selectedReport === 'attendance' ||
        selectedReport === 'revenue'
      ) {
        // All of these come from the daily reports log (filters: project + period)
        const res = await authedFetch('/api/daily-reports?' + qs)
        data = await res.json()
      } else if (selectedReport === 'costs') {
        const res = await authedFetch('/api/costs?' + qs)
        data = await res.json()
      } else if (selectedReport === 'profit') {
        // Profit = revenue (approved daily reports) − costs for the same period
        const [revRes, costRes] = await Promise.all([
          authedFetch('/api/daily-reports?' + qs),
          authedFetch('/api/costs?' + qs),
        ])
        const rev = await revRes.json()
        const cost = await costRes.json()
        const reports = rev.reports || []
        const totalRevenue = reports.reduce((s: number, r: any) => s + (Number(r.dailyRevenue) || 0), 0)
        const totalCosts = Number(cost.grandTotal) || 0
        data = { reports, byCategory: cost.byCategory || [], totalRevenue, totalCosts, netProfit: totalRevenue - totalCosts }
      } else if (selectedReport === 'equipment') {
        const res = await authedFetch('/api/equipment?' + params.toString())
        data = await res.json()
      } else if (selectedReport === 'handover') {
        const res = await authedFetch('/api/finishings?' + qs)
        data = await res.json()
      } else if (selectedReport === 'monthly' || selectedReport === 'weekly') {
        // Period aggregates (meters/revenue/costs) computed from the filtered
        // data itself — NOT from /api/dashboard which ignores project/date filters.
        const [revRes, costRes] = await Promise.all([
          authedFetch('/api/daily-reports?' + qs),
          authedFetch('/api/costs?' + qs),
        ])
        const rev = await revRes.json()
        const cost = await costRes.json()
        const reports = rev.reports || []
        const totalMeters = reports.reduce((s: number, r: any) => s + (Number(r.dailyMeters) || 0), 0)
        const totalRevenue = reports.reduce((s: number, r: any) => s + (Number(r.dailyRevenue) || 0), 0)
        const totalCosts = Number(cost.grandTotal) || 0
        const progressProjects = selectedProject !== 'all'
          ? projects.filter((p: any) => p.id === selectedProject)
          : projects
        data = {
          reports,
          byCategory: cost.byCategory || [],
          totalMeters,
          totalRevenue,
          totalCosts,
          netProfit: totalRevenue - totalCosts,
          projects: progressProjects.map((p: any) => ({ id: p.id, name: p.name, progress: p.progress || 0 })),
        }
      } else {
        // Fallback (shouldn't happen — every type is handled above)
        const res = await authedFetch('/api/dashboard')
        data = await res.json()
      }

      setReportData({ type: selectedReport, data, project: projects.find(p => p.id === selectedProject), fromDate, toDate })
      toast.success(isRtl ? 'تم توليد التقرير' : 'Report generated')
    } catch (err) {
      toast.error(isRtl ? 'فشل توليد التقرير' : 'Failed to generate')
    } finally {
      setGenerating(false)
    }
  }

  function exportPDF() {
    if (!reportData) return
    // Open print dialog
    window.print()
  }

  function exportExcel() {
    if (!reportData) return
    const rows = buildCsvRows()
    if (!rows.length) {
      toast.error(isRtl ? 'لا توجد بيانات للتصدير' : 'No data to export')
      return
    }
    // Escape cells and prepend UTF-8 BOM so Excel opens Arabic correctly
    const csv = '\uFEFF' + rows
      .map(row => row.map(cell => '"' + String(cell ?? '').replace(/"/g, '""') + '"').join(','))
      .join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `axis-${reportData.type}-${reportData.fromDate}_${reportData.toDate}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast.success(isRtl ? 'تم تصدير الملف' : 'File exported')
  }

  // Build table rows for the CSV export, matching what the preview shows
  function buildCsvRows(): string[][] {
    const d = reportData?.data || {}
    const H = (ar: string, en: string) => (isRtl ? ar : en)
    const reports = d.reports || []

    switch (reportData.type) {
      case 'daily_site':
      case 'production':
        return [
          [H('التاريخ', 'Date'), H('المشروع', 'Project'), H('الخط', 'Line'), H('أمتار', 'Meters'), H('العمال', 'Workers'), H('الحالة', 'Status')],
          ...reports.map((r: any) => [
            new Date(r.reportDate).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US'),
            r.project?.name || '-',
            r.driveLine?.lineNumber || '-',
            r.dailyMeters ?? 0,
            r.workersCount ?? 0,
            localized(reportStatusLabels, r.status, isRtl),
          ]),
        ]
      case 'attendance':
        return [
          [H('التاريخ', 'Date'), H('المشروع', 'Project'), H('عدد العمال', 'Workers'), H('الغائبون', 'Absentees'), H('ملاحظات', 'Notes')],
          ...reports.map((r: any) => [
            new Date(r.reportDate).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US'),
            r.project?.name || '-',
            r.workersCount ?? 0,
            r.absentees || '-',
            r.attendanceNotes || '-',
          ]),
        ]
      case 'revenue':
        return [
          [H('التاريخ', 'Date'), H('المشروع', 'Project'), H('أمتار اليوم', 'Daily Meters'), H('الإيراد (ر.ع)', 'Revenue (OMR)')],
          ...reports.map((r: any) => [
            new Date(r.reportDate).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US'),
            r.project?.name || '-',
            r.dailyMeters ?? 0,
            r.dailyRevenue ?? 0,
          ]),
          ['', '', H('إجمالي الإيراد', 'Total Revenue'), fmtNum(reports.reduce((s: number, r: any) => s + (Number(r.dailyRevenue) || 0), 0))],
        ]
      case 'safety':
        return [
          [H('التاريخ', 'Date'), H('المشروع', 'Project'), H('المخالفات', 'Violations'), H('الحوادث', 'Incidents'), H('موقّع من', 'Signed by')],
          ...reports.filter((r: any) => r.safety).map((r: any) => [
            new Date(r.reportDate).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US'),
            r.project?.name || '-',
            r.safety.violations || '-',
            localized(incidentLabels, r.safety.incidentType, isRtl),
            r.safety.signedBy || '-',
          ]),
        ]
      case 'costs':
        return [
          [H('الفئة', 'Category'), H('المبلغ (ر.ع)', 'Amount (OMR)')],
          ...(d.byCategory || []).map((c: any) => [c.category, c.amount ?? 0]),
          [H('إجمالي التكاليف', 'Total Costs'), d.total ?? 0],
          [H('تكاليف الإيجارات', 'Rental Costs'), d.totalRentalCost ?? 0],
          [H('الإجمالي الشامل', 'Grand Total'), d.grandTotal ?? 0],
        ]
      case 'profit':
        return [
          [H('البند', 'Item'), H('القيمة (ر.ع)', 'Value (OMR)')],
          [H('إجمالي الإيراد', 'Total Revenue'), d.totalRevenue ?? 0],
          [H('إجمالي التكاليف', 'Total Costs'), d.totalCosts ?? 0],
          [H('صافي الربح', 'Net Profit'), d.netProfit ?? 0],
          [H('هامش الربحية %', 'Margin %'), (Number(d.totalRevenue) > 0 ? ((d.netProfit / d.totalRevenue) * 100).toFixed(1) : '0')],
        ]
      case 'equipment':
        return [
          [H('المعدة', 'Equipment'), H('الرقم', 'Number'), H('الحالة', 'Status')],
          ...(d.equipment || []).map((eq: any) => [eq.name, eq.number, localized(equipmentStatusLabels, eq.status, isRtl)]),
        ]
      case 'weekly':
      case 'monthly':
        return [
          [H('البند', 'Item'), H('القيمة', 'Value')],
          [H('إجمالي الأمتار', 'Total Meters'), d.totalMeters ?? 0],
          [H('إجمالي الإيراد (ر.ع)', 'Total Revenue (OMR)'), d.totalRevenue ?? 0],
          [H('إجمالي التكاليف (ر.ع)', 'Total Costs (OMR)'), d.totalCosts ?? 0],
          [H('صافي الربح (ر.ع)', 'Net Profit (OMR)'), d.netProfit ?? 0],
          [],
          [H('المشروع', 'Project'), H('نسبة التقدم %', 'Progress %')],
          ...(d.projects || []).map((p: any) => [p.name, Number(p.progress || 0).toFixed(1)]),
        ]
      case 'handover':
        return [
          [H('المشروع', 'Project'), H('التاريخ', 'Date'), H('حالة التسليم', 'Handover Status'), H('موقّع من', 'Signed by')],
          ...(d.finishings || []).map((f: any) => [
            f.project?.name || '-',
            new Date(f.date).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US'),
            localized(handoverStatusLabels, f.handoverStatus, isRtl),
            f.signedBy || '-',
          ]),
        ]
      default:
        return []
    }
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
            .filter((r) => user && hasReportPermission(user.role, 'rpt_' + r.id, user.permissions))
            .map((r) => {
            const Icon = r.icon
            const isSelected = selectedReport === r.id
            return (
              <button
                key={r.id}
                onClick={() => setSelectedReport(r.id)}
                className={`flex items-start gap-3 p-3 rounded-lg border-2 text-right transition ${
                  isSelected
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/30 hover:bg-muted/30'
                }`}
              >
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${isSelected ? 'bg-primary/10' : 'bg-muted'}`}>
                  <Icon className={`h-5 w-5 ${isSelected ? r.color : 'text-muted-foreground'}`} />
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
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{isRtl ? 'من تاريخ' : 'From Date'}</Label>
              <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{isRtl ? 'إلى تاريخ' : 'To Date'}</Label>
              <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </div>
          </div>

          <div className="flex gap-2 flex-wrap">
            <Button onClick={generateReport} disabled={!selectedReport || generating}>
              <FileBarChart className="h-4 w-4 ml-2" />
              {generating ? (isRtl ? 'جاري التوليد...' : 'Generating...') : (isRtl ? 'توليد التقرير' : 'Generate Report')}
            </Button>
            {reportData && (
              <>
                <Button variant="outline" onClick={exportPDF}>
                  <FileText className="h-4 w-4 ml-2" />
                  {isRtl ? 'تصدير PDF' : 'Export PDF'}
                </Button>
                <Button variant="outline" onClick={exportExcel}>
                  <FileSpreadsheet className="h-4 w-4 ml-2" />
                  {isRtl ? 'تصدير Excel' : 'Export Excel'}
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Report preview */}
      {reportData && (
        <Card className="no-print">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>{isRtl ? 'معاينة التقرير' : 'Report Preview'}</span>
              <Button variant="ghost" size="sm" onClick={() => window.print()}>
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

  const reportType = reportTypes.find(r => r.id === data.type)
  if (!reportType) return null

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

      {/* Render based on report type */}
      {data.type === 'daily_site' || data.type === 'production' ? (
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
                  <th className="p-2">{isRtl ? 'العمال' : 'Workers'}</th>
                  <th className="p-2">{isRtl ? 'الحالة' : 'Status'}</th>
                </tr>
              </thead>
              <tbody>
                {(data.data.reports || []).slice(0, 50).map((r: any) => (
                  <tr key={r.id} className="border-b">
                    <td className="p-2">{new Date(r.reportDate).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US')}</td>
                    <td className="p-2">{r.project?.name}</td>
                    <td className="p-2">{r.driveLine?.lineNumber || '-'}</td>
                    <td className="p-2">{fmtNum(r.dailyMeters)}</td>
                    <td className="p-2">{r.workersCount}</td>
                    <td className="p-2">{localized(reportStatusLabels, r.status, isRtl)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(data.data.reports || []).length === 0 && (
            <p className="text-center text-xs text-muted-foreground py-4">{isRtl ? 'لا توجد تقارير في هذه الفترة' : 'No reports in this period'}</p>
          )}
        </div>
      ) : data.type === 'attendance' ? (
        <div className="space-y-3">
          <h3 className="font-semibold text-sm">{isRtl ? 'سجل الحضور والغياب' : 'Attendance Log'}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-right">
                  <th className="p-2">{isRtl ? 'التاريخ' : 'Date'}</th>
                  <th className="p-2">{isRtl ? 'المشروع' : 'Project'}</th>
                  <th className="p-2">{isRtl ? 'عدد العمال' : 'Workers'}</th>
                  <th className="p-2">{isRtl ? 'الغائبون' : 'Absentees'}</th>
                  <th className="p-2">{isRtl ? 'ملاحظات' : 'Notes'}</th>
                </tr>
              </thead>
              <tbody>
                {(data.data.reports || []).slice(0, 50).map((r: any) => (
                  <tr key={r.id} className="border-b">
                    <td className="p-2">{new Date(r.reportDate).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US')}</td>
                    <td className="p-2">{r.project?.name}</td>
                    <td className="p-2">{r.workersCount}</td>
                    <td className="p-2">{r.absentees || '-'}</td>
                    <td className="p-2">{r.attendanceNotes || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(data.data.reports || []).length === 0 && (
            <p className="text-center text-xs text-muted-foreground py-4">{isRtl ? 'لا توجد سجلات حضور في هذه الفترة' : 'No attendance records in this period'}</p>
          )}
        </div>
      ) : data.type === 'safety' ? (
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
                {(data.data.reports || []).filter((r: any) => r.safety).slice(0, 50).map((r: any) => (
                  <tr key={r.id} className="border-b">
                    <td className="p-2">{new Date(r.reportDate).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US')}</td>
                    <td className="p-2">{r.project?.name}</td>
                    <td className="p-2">{r.safety.violations || '-'}</td>
                    <td className="p-2">{localized(incidentLabels, r.safety.incidentType, isRtl)}</td>
                    <td className="p-2">{r.safety.signedBy || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : data.type === 'revenue' ? (
        <div className="space-y-3">
          <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200">
            <p className="text-sm font-medium">
              {isRtl ? 'إجمالي إيراد الفترة' : 'Period Total Revenue'}:
              <span className="text-emerald-700 font-bold">
                {' '}{fmtNum((data.data.reports || []).reduce((s: number, r: any) => s + (Number(r.dailyRevenue) || 0), 0))} ر.ع
              </span>
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-right">
                  <th className="p-2">{isRtl ? 'التاريخ' : 'Date'}</th>
                  <th className="p-2">{isRtl ? 'المشروع' : 'Project'}</th>
                  <th className="p-2">{isRtl ? 'أمتار اليوم' : 'Daily Meters'}</th>
                  <th className="p-2">{isRtl ? 'الإيراد' : 'Revenue'}</th>
                </tr>
              </thead>
              <tbody>
                {(data.data.reports || []).slice(0, 50).map((r: any) => (
                  <tr key={r.id} className="border-b">
                    <td className="p-2">{new Date(r.reportDate).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US')}</td>
                    <td className="p-2">{r.project?.name}</td>
                    <td className="p-2">{fmtNum(r.dailyMeters)}</td>
                    <td className="p-2">{fmtNum(r.dailyRevenue)} ر.ع</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(data.data.reports || []).length === 0 && (
            <p className="text-center text-xs text-muted-foreground py-4">{isRtl ? 'لا توجد بيانات إيراد في هذه الفترة' : 'No revenue data in this period'}</p>
          )}
        </div>
      ) : data.type === 'costs' ? (
        <div className="space-y-3">
          <h3 className="font-semibold text-sm">{isRtl ? 'التكاليف حسب الفئة' : 'Costs by Category'}</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {(data.data.byCategory || []).map((c: any) => (
              <div key={c.category} className="p-3 rounded-lg border">
                <p className="text-xs text-muted-foreground">{c.category}</p>
                <p className="font-bold text-sm">{fmtNum(c.amount)} ر.ع</p>
              </div>
            ))}
          </div>
          <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 space-y-1">
            <p className="text-sm font-medium">
              {isRtl ? 'إجمالي التكاليف' : 'Total Costs'}: <span className="text-red-600">{fmtNum(data.data.total)} ر.ع</span>
            </p>
            {Number(data.data.totalRentalCost) > 0 && (
              <p className="text-sm font-medium">
                {isRtl ? 'تكاليف الإيجارات' : 'Rental Costs'}: <span className="text-amber-600">{fmtNum(data.data.totalRentalCost)} ر.ع</span>
              </p>
            )}
            <p className="text-sm font-semibold">
              {isRtl ? 'الإجمالي الشامل' : 'Grand Total'}: <span className="text-red-700">{fmtNum(data.data.grandTotal)} ر.ع</span>
            </p>
          </div>
        </div>
      ) : data.type === 'profit' ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 rounded-lg border">
              <p className="text-xs text-muted-foreground">{isRtl ? 'إجمالي الإيراد' : 'Total Revenue'}</p>
              <p className="font-bold text-lg text-emerald-600">{fmtNum(data.data.totalRevenue)} ر.ع</p>
            </div>
            <div className="p-3 rounded-lg border">
              <p className="text-xs text-muted-foreground">{isRtl ? 'إجمالي التكاليف' : 'Total Costs'}</p>
              <p className="font-bold text-lg text-red-600">{fmtNum(data.data.totalCosts)} ر.ع</p>
            </div>
            <div className="p-3 rounded-lg border">
              <p className="text-xs text-muted-foreground">{isRtl ? 'صافي الربح' : 'Net Profit'}</p>
              <p className={`font-bold text-lg ${(Number(data.data.netProfit) || 0) >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                {fmtNum(data.data.netProfit)} ر.ع
              </p>
            </div>
            <div className="p-3 rounded-lg border">
              <p className="text-xs text-muted-foreground">{isRtl ? 'هامش الربحية' : 'Profit Margin'}</p>
              <p className="font-bold text-lg">
                {Number(data.data.totalRevenue) > 0 ? ((Number(data.data.netProfit) / Number(data.data.totalRevenue)) * 100).toFixed(1) : '0.0'}%
              </p>
            </div>
          </div>
          {(data.data.byCategory || []).length > 0 && (
            <>
              <h3 className="font-semibold text-sm pt-2">{isRtl ? 'تفصيل التكاليف حسب الفئة' : 'Costs Breakdown'}</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {(data.data.byCategory || []).map((c: any) => (
                  <div key={c.category} className="p-3 rounded-lg border">
                    <p className="text-xs text-muted-foreground">{c.category}</p>
                    <p className="font-bold text-sm">{fmtNum(c.amount)} ر.ع</p>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      ) : data.type === 'equipment' ? (
        <div className="space-y-3">
          <h3 className="font-semibold text-sm">{isRtl ? 'قائمة المعدات' : 'Equipment List'}</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {(data.data.equipment || []).map((eq: any) => (
              <div key={eq.id} className="p-3 rounded-lg border">
                <p className="font-medium text-sm">{eq.name}</p>
                <p className="text-xs text-muted-foreground font-mono">{eq.number}</p>
                <p className="text-xs mt-1">
                  <span className={`inline-block px-1.5 py-0.5 rounded text-xs ${
                    eq.status === 'operational' ? 'bg-emerald-50 text-emerald-700' :
                    eq.status === 'stopped' ? 'bg-red-50 text-red-700' : 'bg-orange-50 text-orange-700'
                  }`}>
                    {localized(equipmentStatusLabels, eq.status, isRtl)}
                  </span>
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : data.type === 'monthly' || data.type === 'weekly' ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 rounded-lg border">
              <p className="text-xs text-muted-foreground">{isRtl ? 'أمتار الفترة' : 'Period Meters'}</p>
              <p className="font-bold text-lg">{fmtNum(data.data.totalMeters)}</p>
            </div>
            <div className="p-3 rounded-lg border">
              <p className="text-xs text-muted-foreground">{isRtl ? 'إيرادات الفترة' : 'Period Revenue'}</p>
              <p className="font-bold text-lg text-emerald-600">{fmtNum(data.data.totalRevenue)} ر.ع</p>
            </div>
            <div className="p-3 rounded-lg border">
              <p className="text-xs text-muted-foreground">{isRtl ? 'تكاليف الفترة' : 'Period Costs'}</p>
              <p className="font-bold text-lg text-red-600">{fmtNum(data.data.totalCosts)} ر.ع</p>
            </div>
            <div className="p-3 rounded-lg border">
              <p className="text-xs text-muted-foreground">{isRtl ? 'صافي الربح' : 'Net Profit'}</p>
              <p className={`font-bold text-lg ${(Number(data.data.netProfit) || 0) >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                {fmtNum(data.data.netProfit)} ر.ع
              </p>
            </div>
          </div>
          <h3 className="font-semibold text-sm pt-3">{isRtl ? 'تقدم المشاريع' : 'Projects Progress'}</h3>
          <div className="space-y-2">
            {(data.data.projects || []).map((p: any) => (
              <div key={p.id} className="flex items-center justify-between p-2 rounded border">
                <span className="text-sm">{p.name}</span>
                <span className="font-semibold text-sm">{Number(p.progress || 0).toFixed(1)}%</span>
              </div>
            ))}
            {(data.data.projects || []).length === 0 && (
              <p className="text-center text-xs text-muted-foreground py-4">{isRtl ? 'لا توجد مشاريع' : 'No projects'}</p>
            )}
          </div>
        </div>
      ) : data.type === 'handover' ? (
        <div className="space-y-3">
          <h3 className="font-semibold text-sm">{isRtl ? 'سجلات التسليم' : 'Handover Records'}</h3>
          <div className="space-y-2">
            {(data.data.finishings || []).map((f: any) => (
              <div key={f.id} className="p-3 rounded-lg border">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">{f.project?.name}</span>
                  <span className="text-xs px-2 py-0.5 rounded bg-muted">{localized(handoverStatusLabels, f.handoverStatus, isRtl)}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {new Date(f.date).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US')}
                  {f.signedBy ? ` — ${isRtl ? 'موقّع من' : 'Signed by'}: ${f.signedBy}` : ''}
                </p>
              </div>
            ))}
            {(data.data.finishings || []).length === 0 && (
              <p className="text-center text-xs text-muted-foreground py-4">{isRtl ? 'لا توجد سجلات تسليم في هذه الفترة' : 'No handover records in this period'}</p>
            )}
          </div>
        </div>
      ) : (
        <div className="text-center py-8 text-muted-foreground text-sm">
          {isRtl ? 'اضغط "توليد التقرير" لعرض المعاينة' : 'Press "Generate Report" to see preview'}
        </div>
      )}
    </div>
  )
}

