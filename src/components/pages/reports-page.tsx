'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
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
import { hasReportPermission, canViewPricing, normalizeRole } from '@/lib/auth'
import { reportDayName } from '@/lib/day-name'
import { toast } from 'sonner'
import {
  reportTypes, reportStatusLabels, incidentLabels, handoverStatusLabels,
  equipmentStatusLabels, costCategoryLabels, localized, fmtNum,
} from '@/lib/report-labels'
import { PrintableReport } from '@/components/reports/printable-report'

export default function ReportsPage() {
  const [projects, setProjects] = useState<any[]>([])
  const [selectedReport, setSelectedReport] = useState<string>('')
  const [selectedProject, setSelectedProject] = useState<string>('all')
  const user = useAppStore((s) => s.user)
  // v14.2: تقارير الإيراد والربح وأرقامها — سرية مالية (المسموح لهم حسب canViewPricing — v78 تشمل مدير النظام)
  const seePricing = !!(user && canViewPricing(user))
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [reportData, setReportData] = useState<any>(null)
  const [generating, setGenerating] = useState(false)
  const [mounted, setMounted] = useState(false)
  // v60: تقرير المتوسطات التشغيلية والمالية — سري للإدارة العليا ومدير النظام فقط
  // v65: المقارنة عبر normalizeRole — لا مقارنات دور حرفية (نفس علة v63)
  const isTopMgmt = !!(user && (user.isSystemAdmin || normalizeRole(user.role) === 'top_management'))
  const [driveLines, setDriveLines] = useState<any[]>([])
  const [selectedLine, setSelectedLine] = useState<string>('all')
  const language = useAppStore((s) => s.language)
  const isRtl = language === 'ar'

  // v60: تحميل خطوط الحفر للمشروع عند اختيار تقرير المتوسطات (فلتر الموقع/خط الحفر)
  useEffect(() => {
    if (selectedReport !== 'operational_averages' || selectedProject === 'all') {
      setDriveLines([])
      setSelectedLine('all')
      return
    }
    setSelectedLine('all')
    authedFetch('/api/drive-lines?projectId=' + selectedProject)
      .then(r => r.json())
      .then(d => setDriveLines(d.driveLines || []))
      .catch(() => setDriveLines([]))
  }, [selectedReport, selectedProject])

  useEffect(() => {
    setMounted(true)
  }, [])

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
    // v60: تقرير المتوسطات يُحسب لمشروع واحد محدد — ليس له معنى لكل المشاريع
    if (selectedReport === 'operational_averages' && selectedProject === 'all') {
      toast.error(isRtl ? 'اختر مشروعاً محدداً — تقرير المتوسطات يُحسب لكل مشروع على حدة' : 'Select a specific project — averages are computed per project')
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
        // تقرير الإيراد: التقارير المعتمدة فقط — الإيراد لا يُعترف به قبل الاعتماد
        if (selectedReport === 'revenue') {
          data.reports = (data.reports || []).filter((r: any) => r.status === 'approved')
        }
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
        // الإيراد في تقرير الربح: من التقارير المعتمدة فقط
        const approvedReports = reports.filter((r: any) => r.status === 'approved')
        const totalRevenue = approvedReports.reduce((s: number, r: any) => s + (Number(r.dailyRevenue) || 0), 0)
        const totalCosts = Number(cost.grandTotal) || 0
        data = { reports, byCategory: cost.byCategory || [], totalRevenue, totalCosts, netProfit: totalRevenue - totalCosts }
      } else if (selectedReport === 'operational_averages') {
        // v60: نقطة النهاية المخصصة — تحسب كل المتوسطات على الخادم (سري: 403 لغير الإدارة العليا)
        const p2 = new URLSearchParams()
        p2.set('projectId', selectedProject)
        if (fromDate) p2.set('from', fromDate)
        if (toDate) p2.set('to', toDate)
        if (selectedLine !== 'all') p2.set('driveLineId', selectedLine)
        const res = await authedFetch('/api/reports/operational-averages?' + p2.toString())
        // نمط v56: كشف ردود المنصة غير JSON برسالة واضحة
        const body = await res.json().catch(() => null)
        if (!res.ok || !body) throw new Error((body && body.message) || 'HTTP ' + res.status)
        if (body.error) throw new Error(body.message || body.error)
        data = body
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
        // الإيراد في التقرير الشهري/الأسبوعي: من التقارير المعتمدة فقط
        const totalRevenue = reports.filter((r: any) => r.status === 'approved')
          .reduce((s: number, r: any) => s + (Number(r.dailyRevenue) || 0), 0)
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
    } catch (err: any) {
      // v60: عرض سبب الفشل الحقيقي (403 سري / مهلة / تحقق) بدل رسالة عامة
      const detail = err?.message ? (isRtl ? ': ' + err.message : ': ' + err.message) : ''
      toast.error((isRtl ? 'فشل توليد التقرير' : 'Failed to generate') + detail)
    } finally {
      setGenerating(false)
    }
  }

  function exportPDF() {
    if (!reportData) {
      toast.error(isRtl ? 'قم بتوليد التقرير أولاً' : 'Generate the report first')
      return
    }
    // Give the saved PDF a meaningful default file name
    // (browsers use document.title as the suggested file name)
    const originalTitle = document.title
    document.title = `axis-${reportData.type}-${reportData.fromDate}_${reportData.toDate}`
    const restore = () => {
      document.title = originalTitle
      window.removeEventListener('afterprint', restore)
    }
    window.addEventListener('afterprint', restore)
    // The printable document lives in the .print-root portal (see PrintableReport);
    // print CSS hides the whole app and prints ONLY that document.
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
      case 'costs': {
        const rows: any[][] = [
          [H('الفئة', 'Category'), H('المبلغ (ر.ع)', 'Amount (OMR)')],
          ...(d.byCategory || []).map((c: any) => [localized(costCategoryLabels, c.category, isRtl), c.amount ?? 0]),
          [H('إجمالي التكاليف', 'Total Costs'), d.total ?? 0],
          [H('تكاليف الإيجارات', 'Rental Costs'), d.totalRentalCost ?? 0],
          [H('الإجمالي الشامل', 'Grand Total'), d.grandTotal ?? 0],
          [],
          [H('تفصيل الفواتير المسجلة', 'Recorded Invoices Detail')],
          [H('التاريخ', 'Date'), H('الفئة', 'Category'), H('البيان', 'Description'), H('المشروع', 'Project'), H('سجّلها', 'Recorded by'), H('ملاحظات', 'Notes'), H('المبلغ (ر.ع)', 'Amount (OMR)')],
          ...(d.costs || []).map((c: any) => [
            new Date(c.date).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US'),
            localized(costCategoryLabels, c.category, isRtl),
            c.description || '-',
            c.project?.name || '-',
            c.recordedBy ? (isRtl ? (c.recordedBy.name || '-') : (c.recordedBy.nameEn || c.recordedBy.name || '-')) : '-',
            c.notes || '-',
            c.amount ?? 0,
          ]),
        ]
        if ((d.rentalAssets || []).length > 0) {
          rows.push([])
          rows.push([H('الإيجارات الشهرية النشطة', 'Active Monthly Rentals')])
          rows.push([H('المعدة / الأصل', 'Asset'), H('المورد', 'Supplier'), H('المشروع', 'Project'), H('الإيجار الشهري (ر.ع)', 'Monthly Rent (OMR)')])
          for (const a of d.rentalAssets) rows.push([a.name, a.supplier || '-', a.projectName || '-', a.rentalCost ?? 0])
        }
        return rows
      }
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
      case 'operational_averages': {
        // v60: تصدير Excel/CSV — نفس قيم المعاينة والمطبوعة (null = لا توجد بيانات كافية)
        const rp = d.report || {}
        const m = rp.metrics || {}
        const NA = H('لا توجد بيانات كافية', 'Insufficient data')
        const n = (v: any) => (v === null || v === undefined ? NA : (Math.round(v * 100) / 100))
        const rows: any[][] = [
          [H('تقرير المتوسطات التشغيلية والمالية', 'Operational & Financial Averages')],
          [H('المشروع', 'Project'), rp.project?.name || '-'],
          [H('الموقع / خط الحفر', 'Site / Line'), rp.driveLine ? ('خط ' + (rp.driveLine.lineNumber || '-')) : H('جميع المواقع', 'All Sites')],
          [H('الفترة', 'Period'), (rp.period?.from || reportData.fromDate) + ' ← ' + (rp.period?.to || reportData.toDate)],
          [],
          [H('البيان', 'Metric'), H('القيمة', 'Value')],
          [H('إجمالي أمتار الحفر المنفذة (م)', 'Total drilled meters (m)'), n(m.totalMeters)],
          [H('عدد أيام العمل الفعلية', 'Actual working days'), m.workingDays ?? 0],
          [H('متوسط الحفر اليومي (م/يوم)', 'Avg daily drilling (m/day)'), n(m.avgDailyMeters)],
          [H('متوسط عدد العمال اليومي', 'Avg daily workers'), n(m.avgWorkers)],
          [H('إجمالي التكاليف المسجلة (ر.ع)', 'Total recorded costs (OMR)'), m.costTotal === null ? NA : n(m.costTotal)],
          [H('متوسط تكلفة المتر (ر.ع)', 'Avg cost per meter (OMR)'), n(m.avgCostPerMeter)],
          [H('متوسط الصرف اليومي (ر.ع)', 'Avg daily spend (OMR)'), n(m.avgDailySpend)],
          [H('إجمالي قيمة الأعمال المنفذة (ر.ع)', 'Total executed work value (OMR)'), n(m.workValue)],
          [H('صافي الربح (ر.ع)', 'Net profit (OMR)'), n(m.netProfit)],
          [H('متوسط الربح اليومي (ر.ع)', 'Avg daily profit (OMR)'), n(m.avgDailyProfit)],
          [H('متوسط ربح المتر (ر.ع)', 'Avg profit per meter (OMR)'), n(m.profitPerMeter)],
          [H('نسبة الربح من قيمة الأعمال (%)', 'Profit margin (% of work value)'), n(m.profitMarginPct)],
          [],
        ]
        if (rp.costsScope === 'project_only') rows.push([H('ملاحظة: عند اختيار خط محدد تُعرض قيمة أعمال الخط فقط، والتكاليف والأرباح تُحتسب على مستوى المشروع كاملاً', 'Note: with a specific line selected, costs & profit are project-level only')])
        rows.push(
          [H('تفصيل قيمة الأعمال حسب الخط', 'Work value by line')],
          [H('الخط', 'Line'), H('الأمتار (م)', 'Meters (m)'), H('سعر المتر (ر.ع)', 'Price per meter (OMR)'), H('القيمة (ر.ع)', 'Value (OMR)')],
          ...(rp.perLine || []).map((l: any) => [l.label, Math.round((l.meters || 0) * 100) / 100, l.price ?? 0, Math.round((l.value || 0) * 100) / 100])
        )
        return rows
      }
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

      {/* Report type selection (screen-only — never printed) */}
      <div className="no-print">
        <Label className="mb-2 block">{isRtl ? 'اختر نوع التقرير' : 'Select Report Type'}</Label>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {reportTypes
            .filter((r) => user && hasReportPermission(user.role, 'rpt_' + r.id, user.permissions))
            // v14.2 SECURITY: تقريرا الإيراد وصافي الربح مخفيان عن غير المصرح لهم مالياً
            .filter((r) => seePricing || (r.id !== 'revenue' && r.id !== 'profit'))
            // v60 SECURITY: تقرير المتوسطات التشغيلية والمالية سري — للإدارة العليا
            // ومدير النظام فقط، ولا يظهر في القائمة لأي حساب آخر (حتى لو امتلك صلاحية التقارير)
            .filter((r) => isTopMgmt || r.id !== 'operational_averages')
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

      {/* Filters (screen-only — never printed) */}
      <Card className="no-print">
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

          {/* v60: فلتر الموقع/خط الحفر — يظهر لتقرير المتوسطات فقط مع خيار جميع المواقع */}
          {selectedReport === 'operational_averages' && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">{isRtl ? 'الموقع / خط الحفر' : 'Site / Drive Line'}</Label>
                <Select value={selectedLine} onValueChange={setSelectedLine}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{isRtl ? 'جميع المواقع' : 'All Sites'}</SelectItem>
                    {driveLines.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {'خط ' + (l.lineNumber || '-') + (l.startPoint ? ' — ' + l.startPoint : '')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="sm:col-span-2 flex items-end">
                <p className="text-xs text-amber-600 flex items-center gap-1.5">
                  <Shield className="h-3.5 w-3.5 shrink-0" />
                  {isRtl
                    ? 'تقرير سري — يظهر للإدارة العليا فقط، ولا يمكن لأي حساب آخر فتحه أو تصديره'
                    : 'Confidential — top management only; no other account can open or export it'}
                </p>
              </div>
            </div>
          )}

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

      {/* Report preview (screen-only; the PDF comes from PrintableReport portal) */}
      {reportData && (
        <Card className="no-print">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>{isRtl ? 'معاينة التقرير' : 'Report Preview'}</span>
              <Button variant="ghost" size="sm" onClick={exportPDF}>
                <Download className="h-4 w-4 ml-1" />
                {isRtl ? 'طباعة/حفظ PDF' : 'Print/Save PDF'}
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ReportPreview data={reportData} />
          </CardContent>
        </Card>
      )}

      {/* Dedicated print document — portal attached to <body>; hidden on screen,
          shown ONLY during printing (see @media print in globals.css) */}
      {mounted && reportData && createPortal(
        <div className="print-root">
          <PrintableReport data={reportData} generatedBy={user?.name || null} showRevenue={seePricing} />
        </div>,
        document.body
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
                {(data.data.reports || []).map((r: any) => (
                  <tr key={r.id} className="border-b">
                    <td className="p-2">
                      {new Date(r.reportDate).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US')}
                      {/* v46: يوم التقرير — سجل التقارير اليومية */}
                      {reportDayName(r.reportDate, isRtl) && (
                        <span className="block text-[10px] text-muted-foreground/80">{reportDayName(r.reportDate, isRtl)}</span>
                      )}
                    </td>
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
                {(data.data.reports || []).map((r: any) => (
                  <tr key={r.id} className="border-b">
                    <td className="p-2">
                      {new Date(r.reportDate).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US')}
                      {/* v46: يوم التقرير — سجل الحضور */}
                      {reportDayName(r.reportDate, isRtl) && (
                        <span className="block text-[10px] text-muted-foreground/80">{reportDayName(r.reportDate, isRtl)}</span>
                      )}
                    </td>
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
                {(data.data.reports || []).filter((r: any) => r.safety).map((r: any) => (
                  <tr key={r.id} className="border-b">
                    <td className="p-2">
                      {new Date(r.reportDate).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US')}
                      {/* v46: يوم التقرير — سجل السلامة */}
                      {reportDayName(r.reportDate, isRtl) && (
                        <span className="block text-[10px] text-muted-foreground/80">{reportDayName(r.reportDate, isRtl)}</span>
                      )}
                    </td>
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
            <p className="text-xs text-emerald-600/80 mt-0.5">
              {isRtl ? 'يُحسب من التقارير المعتمدة فقط (الأمتار المحفورة × سعر المتر)' : 'From approved reports only (meters × price per meter)'}
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
                {(data.data.reports || []).map((r: any) => (
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
        <div className="space-y-4">
          <h3 className="font-semibold text-sm">{isRtl ? 'التكاليف حسب الفئة' : 'Costs by Category'}</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {(data.data.byCategory || []).map((c: any) => (
              <div key={c.category} className="p-3 rounded-lg border">
                <p className="text-xs text-muted-foreground">{localized(costCategoryLabels, c.category, isRtl)}</p>
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

          {/* ─── تفصيل الفواتير المسجلة حسب الفئة ─── */}
          {(() => {
            const costs = data.data.costs || []
            const rentals = data.data.rentalAssets || []
            if (costs.length === 0 && rentals.length === 0) {
              return (
                <p className="text-center text-xs text-muted-foreground py-4">
                  {isRtl ? 'لا توجد فواتير مسجلة في هذه الفترة' : 'No invoices recorded in this period'}
                </p>
              )
            }
            const groups = new Map<string, any[]>()
            for (const c of costs) {
              const key = String(c.category || 'other')
              if (!groups.has(key)) groups.set(key, [])
              groups.get(key)!.push(c)
            }
            const groupList = Array.from(groups.entries()).sort((a, b) =>
              b[1].reduce((s: number, c: any) => s + (Number(c.amount) || 0), 0) -
              a[1].reduce((s: number, c: any) => s + (Number(c.amount) || 0), 0)
            )
            return (
              <div className="space-y-4">
                <h3 className="font-semibold text-sm pt-2">
                  {isRtl ? 'تفصيل الفواتير المسجلة حسب الفئة' : 'Recorded Invoices by Category'}
                </h3>
                {groupList.map(([cat, items]) => {
                  const subtotal = items.reduce((s: number, c: any) => s + (Number(c.amount) || 0), 0)
                  return (
                    <div key={cat} className="rounded-lg border overflow-hidden">
                      <div className="flex items-center justify-between px-3 py-2 bg-muted/50 border-b">
                        <p className="font-medium text-sm">
                          {localized(costCategoryLabels, cat, isRtl)}
                          <span className="text-xs text-muted-foreground mr-2">({items.length} {isRtl ? 'فاتورة' : 'invoices'})</span>
                        </p>
                        <p className="text-sm font-bold text-red-600">{fmtNum(subtotal)} ر.ع</p>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b bg-muted/20">
                              <th className="text-start p-2 font-medium">{isRtl ? 'التاريخ' : 'Date'}</th>
                              <th className="text-start p-2 font-medium">{isRtl ? 'البيان' : 'Description'}</th>
                              <th className="text-start p-2 font-medium">{isRtl ? 'المشروع' : 'Project'}</th>
                              <th className="text-start p-2 font-medium">{isRtl ? 'سجّلها' : 'Recorded by'}</th>
                              <th className="text-start p-2 font-medium">{isRtl ? 'ملاحظات' : 'Notes'}</th>
                              <th className="text-end p-2 font-medium">{isRtl ? 'المبلغ (ر.ع)' : 'Amount (OMR)'}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {items
                              .slice()
                              .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime())
                              .map((c: any) => (
                              <tr key={c.id} className="border-b last:border-0">
                                <td className="p-2 whitespace-nowrap">{new Date(c.date).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US')}</td>
                                <td className="p-2 font-medium">{c.description || '-'}</td>
                                <td className="p-2">{c.project?.name || '-'}</td>
                                <td className="p-2">{c.recordedBy ? (isRtl ? (c.recordedBy.name || '-') : (c.recordedBy.nameEn || c.recordedBy.name || '-')) : '-'}</td>
                                <td className="p-2 text-muted-foreground max-w-[180px] truncate" title={c.notes || ''}>{c.notes || '-'}</td>
                                <td className="p-2 text-end font-semibold">{fmtNum(c.amount)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )
                })}

                {/* الإيجارات الشهرية النشطة — جزء من الإجمالي الشامل وليست فواتير مسجلة */}
                {rentals.length > 0 && (
                  <div className="rounded-lg border border-amber-200 overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2 bg-amber-50 border-b border-amber-200">
                      <p className="font-medium text-sm">
                        {isRtl ? 'الإيجارات الشهرية النشطة (معدات وأصول مستأجرة)' : 'Active Monthly Rentals (rented equipment & assets)'}
                        <span className="text-xs text-muted-foreground mr-2">({rentals.length})</span>
                      </p>
                      <p className="text-sm font-bold text-amber-600">{fmtNum(data.data.totalRentalCost)} ر.ع</p>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b bg-muted/20">
                            <th className="text-start p-2 font-medium">{isRtl ? 'المعدة / الأصل' : 'Asset'}</th>
                            <th className="text-start p-2 font-medium">{isRtl ? 'المورد' : 'Supplier'}</th>
                            <th className="text-start p-2 font-medium">{isRtl ? 'المشروع' : 'Project'}</th>
                            <th className="text-end p-2 font-medium">{isRtl ? 'الإيجار الشهري (ر.ع)' : 'Monthly Rent (OMR)'}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rentals.map((a: any) => (
                            <tr key={a.id} className="border-b last:border-0">
                              <td className="p-2 font-medium">{a.name}</td>
                              <td className="p-2">{a.supplier || '-'}</td>
                              <td className="p-2">{a.projectName || '-'}</td>
                              <td className="p-2 text-end font-semibold">{fmtNum(a.rentalCost)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )
          })()}
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
      ) : data.type === 'operational_averages' ? (
        // v60: معاينة تقرير المتوسطات التشغيلية والمالية
        <OperationalAveragesPreview report={(data.data && data.data.report) || {}} isRtl={isRtl} />
      ) : (
        <div className="text-center py-8 text-muted-foreground text-sm">
          {isRtl ? 'اضغط "توليد التقرير" لعرض المعاينة' : 'Press "Generate Report" to see preview'}
        </div>
      )}
    </div>
  )
}

// v60: معاينة تقرير المتوسطات — تُستخدم في الشاشة، والمطبوعة لها قسم مطابق في PrintableReport
function OperationalAveragesPreview({ report, isRtl }: { report: any; isRtl: boolean }) {
  const m = report.metrics || {}
  const NA = isRtl ? 'لا توجد بيانات كافية' : 'Insufficient data'
  const fmt = (v: any) => (v === null || v === undefined ? NA : (Math.round(v * 100) / 100).toLocaleString(isRtl ? 'ar-EG' : 'en-US', { maximumFractionDigits: 2 }))
  const rows: Array<{ ar: string; en: string; value: any; strong?: boolean }> = [
    { ar: 'إجمالي أمتار الحفر المنفذة (م)', en: 'Total drilled meters (m)', value: fmt(m.totalMeters) },
    { ar: 'عدد أيام العمل الفعلية', en: 'Actual working days', value: m.workingDays ?? 0 },
    { ar: 'متوسط الحفر اليومي (م/يوم)', en: 'Avg daily drilling (m/day)', value: fmt(m.avgDailyMeters) },
    { ar: 'متوسط عدد العمال اليومي', en: 'Avg daily workers', value: fmt(m.avgWorkers) },
    { ar: 'إجمالي التكاليف المسجلة (ر.ع)', en: 'Total recorded costs (OMR)', value: m.costTotal === null || m.costTotal === undefined ? NA : fmt(m.costTotal) },
    { ar: 'متوسط تكلفة المتر (ر.ع)', en: 'Avg cost per meter (OMR)', value: fmt(m.avgCostPerMeter) },
    { ar: 'متوسط الصرف اليومي (ر.ع)', en: 'Avg daily spend (OMR)', value: fmt(m.avgDailySpend) },
    { ar: 'إجمالي قيمة الأعمال المنفذة (ر.ع)', en: 'Total executed work value (OMR)', value: fmt(m.workValue), strong: true },
    { ar: 'صافي الربح (ر.ع)', en: 'Net profit (OMR)', value: fmt(m.netProfit), strong: true },
    { ar: 'متوسط الربح اليومي (ر.ع)', en: 'Avg daily profit (OMR)', value: fmt(m.avgDailyProfit) },
    { ar: 'متوسط ربح المتر (ر.ع)', en: 'Avg profit per meter (OMR)', value: fmt(m.profitPerMeter) },
    { ar: 'نسبة الربح من قيمة الأعمال (%)', en: 'Profit margin (% of work value)', value: fmt(m.profitMarginPct) },
  ]
  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground">
        {isRtl ? 'الموقع: ' : 'Site: '}
        <span className="font-medium text-foreground">
          {report.driveLine ? ('خط ' + (report.driveLine.lineNumber || '-')) : (isRtl ? 'جميع المواقع' : 'All Sites')}
        </span>
        {' • '}{isRtl ? 'تقارير الفترة: ' : 'Period reports: '}{report.reportsCount ?? 0}
      </div>

      {report.insufficient ? (
        <div className="p-6 text-center border rounded-lg bg-amber-500/5">
          <p className="font-semibold text-amber-600">{isRtl ? 'لا توجد بيانات كافية' : 'Insufficient data'}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {isRtl ? 'لا توجد تقارير عمل يومي (مسلَّمة أو معتمدة) في هذه الفترة — لا تُحسب المتوسطات' : 'No submitted/approved daily reports in this period — averages are not computed'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-right">
                <th className="p-2">{isRtl ? 'البيان' : 'Metric'}</th>
                <th className="p-2">{isRtl ? 'القيمة' : 'Value'}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(function(row, idx) {
                return (
                  <tr key={idx} className={'border-b' + (row.strong ? ' bg-muted/40 font-semibold' : '')}>
                    <td className="p-2">{isRtl ? row.ar : row.en}</td>
                    <td className="p-2">{row.value}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {report.costsScope === 'project_only' && (
        <p className="text-xs text-amber-600">
          {isRtl
            ? 'ملاحظة: عند اختيار خط محدد تُعرض قيمة أعمال ذلك الخط فقط، بينما التكاليف والأرباح تُحتسب على مستوى المشروع كاملاً (المستندات المالية غير مرتبطة بخط بعينه) — اختر «جميع المواقع» للاطلاع على الأرباح'
            : 'Note: with a specific line selected, only that line\'s work value is shown; costs & profit remain project-level (financial records are not line-scoped) — choose "All Sites" for profit figures'}
        </p>
      )}

      {Array.isArray(report.perLine) && report.perLine.length > 0 && !report.insufficient && (
        <div>
          <h3 className="font-semibold text-sm mb-2">{isRtl ? 'تفصيل قيمة الأعمال حسب الخط' : 'Work Value by Line'}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-right">
                  <th className="p-2">{isRtl ? 'الخط' : 'Line'}</th>
                  <th className="p-2">{isRtl ? 'الأمتار (م)' : 'Meters (m)'}</th>
                  <th className="p-2">{isRtl ? 'سعر المتر (ر.ع)' : 'Price/m (OMR)'}</th>
                  <th className="p-2">{isRtl ? 'القيمة (ر.ع)' : 'Value (OMR)'}</th>
                </tr>
              </thead>
              <tbody>
                {report.perLine.map(function(l: any, idx: number) {
                  return (
                    <tr key={idx} className="border-b">
                      <td className="p-2">{l.label}</td>
                      <td className="p-2">{fmt(l.meters)}</td>
                      <td className="p-2">{fmt(l.price)}</td>
                      <td className="p-2">{fmt(l.value)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}


