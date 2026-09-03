'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Progress } from '@/components/ui/progress'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  FileText, Calendar, Users, Ruler, AlertTriangle,
  ShieldCheck, CheckCircle2, Clock, DollarSign, Eye, Check, X, Pencil, Trash2,
  AlertCircle, RefreshCw, Loader2, Send, Lock
} from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { authedFetch } from '@/lib/api-client'
import { canAccessDashboard, SYSTEM_ADMIN_EMAIL } from '@/lib/auth'
import { toast } from 'sonner'

const statusLabels: Record<string, { ar: string; en: string; color: string }> = {
  draft: { ar: 'مسودة', en: 'Draft', color: 'secondary' },
  submitted: { ar: 'مرسل', en: 'Submitted', color: 'default' },
  approved: { ar: 'معتمد', en: 'Approved', color: 'default' },
  rejected: { ar: 'مرفوض', en: 'Rejected', color: 'destructive' },
}

const weatherLabels: Record<string, { ar: string; en: string }> = {
  sunny: { ar: 'مشمس', en: 'Sunny' },
  cloudy: { ar: 'غائم', en: 'Cloudy' },
  rainy: { ar: 'ممطر', en: 'Rainy' },
  windy: { ar: 'عاصف', en: 'Windy' },
}

export default function DailyReportsPage() {
  const [reports, setReports] = useState<any[]>([])
  const [projects, setProjects] = useState<any[]>([])
  const [driveLines, setDriveLines] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedProject, setSelectedProject] = useState<string>('all')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingReportId, setEditingReportId] = useState<string | null>(null)
  const [viewReport, setViewReport] = useState<any | null>(null)
  const [viewDialogOpen, setViewDialogOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  // حالة التقرير الجاري تعديله + نوع الحفظ (مسودة أم حفظ وتسليم)
  const [editingStatus, setEditingStatus] = useState<string>('draft')
  const [saveMode, setSaveMode] = useState<'draft' | 'submit'>('draft')
  const language = useAppStore((s) => s.language)
  const token = useAppStore((s) => s.token)
  const user = useAppStore((s) => s.user)
  const isRtl = language === 'ar'

  const [formData, setFormData] = useState({
    projectId: '', driveLineId: '', reportDate: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0],
    weather: 'sunny', workStartTime: '06:30', workEndTime: '17:00',
    operatingHours: '8.5', stoppageHours: '0', stoppageReason: '',
    workersCount: '12', attendees: '', startReading: '', endReading: '',
    soilExcavated: 'mixed', pipesInstalled: '0', productionNotes: '',
    problems: '',
  })

  // Safety checklist state
  const [safety, setSafety] = useState({
    ppeAvailable: false, helmetCheck: false, bootsCheck: false, glovesCheck: false,
    glassesCheck: false, workAreaCheck: false, barriersCheck: false, shaftCheck: false,
    ventilationCheck: false, electricalCheck: false, craneCheck: false, hydraulicCheck: false,
    fireExtinguishers: false, workPermit: false, toolboxTalk: false,
    hazards: '', observations: '', violations: '', incidentType: 'none', incidentDescription: '',
  })

  // لقطات بيانات السلامة عند فتح التعديل — تُعرض للقراءة فقط
  // (بديل موثوق إذا لم تكن قوائم المشاريع/الخطوط محملة بعد)
  const [editProjectNameFallback, setEditProjectNameFallback] = useState('')
  const [editDriveLineFallback, setEditDriveLineFallback] = useState('')


  // Track the in-flight request so we don't fire duplicates when StrictMode
  // double-invokes effects in dev, and so the cancel logic works cleanly.
  const inflightRef = useRef<AbortController | null>(null)

  const fetchReports = useCallback(async function fetchReports() {
    // Cancel any previous in-flight request to avoid races.
    if (inflightRef.current) {
      inflightRef.current.abort()
    }
    const controller = new AbortController()
    inflightRef.current = controller

    setLoading(true)
    setLoadError(null)
    try {
      // 15-second timeout — show a retry button rather than hanging forever.
      const timeout = setTimeout(() => controller.abort(), 15000)
      const params = new URLSearchParams()
      if (selectedProject !== 'all') params.set('projectId', selectedProject)
      params.set('limit', '200')
      // Cache-buster: ensures we always get fresh data even if a CDN
      // or the Next.js fetch cache is holding an older copy.
      params.set('_t', String(Date.now()))
      const res = await authedFetch('/api/daily-reports?' + params.toString(), {
        signal: controller.signal,
      })
      clearTimeout(timeout)

      if (res.status === 401) {
        // Session expired — surface a friendly error and let the user
        // re-login. We DO NOT auto-clear the session here (that would
        // hide the page); the user can click "Retry" or log in again.
        setLoadError(isRtl ? 'انتهت الجلسة - يرجى إعادة تسجيل الدخول' : 'Session expired - please login again')
        setReports([])
        return
      }

      let data: any = {}
      try { data = await res.json() } catch { /* empty body */ }

      if (!res.ok) {
        const msg = data?.message || data?.error || ('Error ' + res.status)
        setLoadError(msg)
        toast.error(msg)
        return
      }

      // Ensure we always have an array even if the API returns null/undefined.
      const list = Array.isArray(data.reports) ? data.reports : []
      setReports(list)
      if (list.length === 0) {
        console.info('[DailyReports] No reports found — list is empty')
      }
    } catch (e: any) {
      // Ignore AbortError from our own cancellation — that's expected.
      if (e?.name === 'AbortError') {
        // Only show timeout UI if this was the latest request (not cancelled by a newer one).
        if (inflightRef.current === controller) {
          setLoadError(isRtl ? 'انتهت مهلة الطلب - تحقق من سرعة الإنترنت' : 'Request timed out')
        }
        return
      }
      const msg = e?.message || (isRtl ? 'فشل تحميل التقارير' : 'Failed to load reports')
      setLoadError(msg)
      toast.error(msg)
    } finally {
      // Only clear loading if this is still the active request.
      if (inflightRef.current === controller) {
        setLoading(false)
        inflightRef.current = null
      }
    }
  }, [selectedProject, isRtl])

  const fetchProjects = useCallback(async function fetchProjects() {
    try {
      const res = await authedFetch('/api/projects/list')
      if (!res.ok) return
      const data = await res.json().catch(() => ({}))
      setProjects(Array.isArray(data.projects) ? data.projects : [])
    } catch {
      // Silent — projects list is non-critical for showing reports.
    }
  }, [])

  useEffect(() => {
    if (!token) {
      // No token = nothing to fetch. Don't leave loading=true forever.
      setLoading(false)
      return
    }
    fetchReports()
    fetchProjects()
    return () => {
      // Cancel any in-flight request on unmount / dep change.
      if (inflightRef.current) {
        inflightRef.current.abort()
        inflightRef.current = null
      }
    }
  }, [token, fetchReports, fetchProjects])

  // Fetch drive lines for selected project in form (used in dialog).
  useEffect(() => {
    if (!formData.projectId) {
      setDriveLines([])
      return
    }
    let cancelled = false
    authedFetch(`/api/drive-lines?projectId=${encodeURIComponent(formData.projectId)}`)
      .then((r) => r.json().catch(() => ({})))
      .then((d) => {
        // لا تُعرض خطوط الحفر التي لم تبدأ بعد عند إنشاء تقرير جديد
        // (وضع التحرير لا يستخدم هذه القائمة أصلاً — خط الحفر مقفل للقراءة فقط)
        const all: any[] = Array.isArray(d.driveLines) ? d.driveLines : []
        const started = all.filter((l: any) => l.status !== 'not_started')
        if (!cancelled) setDriveLines(started)
      })
      .catch(() => {
        if (!cancelled) setDriveLines([])
      })
    return () => { cancelled = true }
  }, [formData.projectId])

  async function openEditReport(report: any) {
    setEditingReportId(report.id)
    setEditingStatus(report.status || 'draft')
    setSaveMode('draft')
    // لقطات للقراءة فقط: المشروع وخط الحفر قادمان من قسم السلامة ولا يمكن تغييرهما
    setEditProjectNameFallback(report.project?.name || '')
    setEditDriveLineFallback(report.driveLine ? String(report.driveLine.lineNumber) : '')
    setFormData({
      projectId: report.projectId || '',
      driveLineId: report.driveLineId || '',
      reportDate: report.reportDate ? report.reportDate.split('T')[0] : new Date().toISOString().split('T')[0],
      weather: report.weather || 'sunny',
      workStartTime: report.workStartTime || '06:30',
      workEndTime: report.workEndTime || '17:00',
      operatingHours: String(report.operatingHours || '8.5'),
      stoppageHours: String(report.stoppageHours || '0'),
      stoppageReason: report.stoppageReason || '',
      workersCount: String(report.workersCount || '12'),
      attendees: report.attendees || '',
      startReading: String(report.startReading || ''),
      endReading: String(report.endReading || ''),
      soilExcavated: report.soilExcavated || 'mixed',
      pipesInstalled: String(report.pipesInstalled || '0'),
      productionNotes: report.productionNotes || '',
      problems: report.problems || '',
    })
    setDialogOpen(true)
  }

  async function deleteReport(id: string) {
    if (!window.confirm(isRtl ? 'هل أنت متأكد من حذف هذا التقرير؟' : 'Delete this report?')) return
    const res = await authedFetch(`/api/daily-reports/${id}`, { method: 'DELETE' })
    if (res.ok) {
      toast.success(isRtl ? 'تم حذف التقرير' : 'Report deleted')
        fetchReports()
    } else {
      const data = await res.json().catch(() => ({}))
      toast.error(data.error || (isRtl ? 'فشل الحذف' : 'Delete failed'))
    }
  }

  const safetyChecklistItems = [
    { key: 'ppeAvailable', label: isRtl ? 'توفر PPE لجميع العمال' : 'PPE available for all workers' },
    { key: 'helmetCheck', label: isRtl ? 'فحص الخوذة' : 'Helmet check' },
    { key: 'bootsCheck', label: isRtl ? 'فحص الحذاء' : 'Boots check' },
    { key: 'glovesCheck', label: isRtl ? 'فحص القفازات' : 'Gloves check' },
    { key: 'glassesCheck', label: isRtl ? 'فحص النظارات' : 'Glasses check' },
    { key: 'workAreaCheck', label: isRtl ? 'فحص منطقة العمل' : 'Work area check' },
    { key: 'barriersCheck', label: isRtl ? 'وجود حواجز وتحذيرات' : 'Barriers & warnings' },
    { key: 'shaftCheck', label: isRtl ? 'فحص الحفرة / shaft' : 'Shaft check' },
    { key: 'ventilationCheck', label: isRtl ? 'فحص التهوية' : 'Ventilation check' },
    { key: 'electricalCheck', label: isRtl ? 'فحص الكهرباء والكابلات' : 'Electrical check' },
    { key: 'craneCheck', label: isRtl ? 'فحص الرافعة' : 'Crane check' },
    { key: 'hydraulicCheck', label: isRtl ? 'فحص نظام الهيدروليك' : 'Hydraulic system check' },
    { key: 'fireExtinguishers', label: isRtl ? 'توفر طفايات الحريق' : 'Fire extinguishers' },
    { key: 'workPermit', label: isRtl ? 'وجود تصريح العمل' : 'Work permit' },
    { key: 'toolboxTalk', label: isRtl ? 'اجتماع toolbox talk' : 'Toolbox talk' },
  ]

  const safetyPassedCount = safetyChecklistItems.filter(item => safety[item.key as keyof typeof safety]).length
  const allSafetyPassed = safetyPassedCount === safetyChecklistItems.length

  async function handleSubmit(e: React.FormEvent, opts?: { submitAfter?: boolean }) {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setSaveMode(opts?.submitAfter ? 'submit' : 'draft')

    if (!editingReportId && !allSafetyPassed) {
      toast.error(isRtl ? 'يجب إكمال جميع فحوصات السلامة أولاً' : 'Complete all safety checks first')
      setSubmitting(false)
      return
    }

    try {
      const url = editingReportId ? `/api/daily-reports/${editingReportId}` : '/api/daily-reports'
      const method = editingReportId ? 'PUT' : 'POST'
      // الإنشاء: تُحفظ كمسودة — عند التعديل: الخادم يحافظ على الحالة الحالية
      // إلا مع "حفظ وتسليم" للمسودة فتصبح مرسلة
      const body: Record<string, unknown> = { ...formData }
      if (!editingReportId) {
        body.status = 'draft'
      } else {
        // بيانات السلامة (المشروع/خط الحفر/التاريخ/الطقس) للقراءة فقط — لا تُرسل عند التعديل
        delete body.projectId
        delete body.driveLineId
        delete body.reportDate
        delete body.weather
        if (opts?.submitAfter && editingStatus === 'draft') body.status = 'submitted'
      }

      const res = await authedFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        const msg = data?.message || data?.error || (editingReportId
          ? (isRtl ? 'فشل تحديث التقرير' : 'Failed to update report')
          : (isRtl ? 'فشل إنشاء التقرير' : 'Failed to create report'))
        toast.error(msg)
        setSubmitting(false)
        return
      }

      // Only save safety checklist for new reports — use authedFetch
      // (the previous version used plain fetch which silently failed with 401).
      if (!editingReportId) {
        try {
          await authedFetch(`/api/daily-reports/${data.report.id}/safety`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(safety),
          })
        } catch {
          // Safety save failure is not critical — report is already created.
          console.warn('[DailyReports] Safety save failed for', data.report.id)
        }
        toast.success(isRtl ? 'تم إنشاء التقرير كمسودة — راجع البيانات ثم سلّم التقرير' : 'Report created as draft — review then submit')
      } else if (opts?.submitAfter && editingStatus === 'draft') {
        toast.success(isRtl ? 'تم حفظ التقرير وتسليمه للاعتماد' : 'Report saved & submitted for approval')
      } else {
        toast.success(isRtl ? 'تم تحديث التقرير' : 'Report updated successfully')
      }

      setDialogOpen(false)
      setEditingReportId(null)
      fetchReports()
    } catch (e: any) {
      toast.error(e?.message || (isRtl ? 'حدث خطأ' : 'Error'))
    } finally {
      setSubmitting(false)
    }
  }

  // تسليم التقرير: من مسودة إلى مرسل — يظهر بعد تعديل البيانات
  async function submitReport(id: string) {
    if (!window.confirm(isRtl ? 'تسليم التقرير للاعتماد؟ لا يمكنك تعديله بعد التسليم' : 'Submit for approval? You cannot edit it after submission')) return
    try {
      const res = await authedFetch(`/api/daily-reports/${id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (res.ok) {
        toast.success(isRtl ? 'تم تسليم التقرير — بانتظار الاعتماد' : 'Report submitted — awaiting approval')
        fetchReports()
      } else {
        const body = await res.json().catch(() => ({}))
        toast.error(body?.message || body?.error || (isRtl ? 'فشل تسليم التقرير' : 'Submit failed'))
      }
    } catch (e: any) {
      toast.error(e?.message || (isRtl ? 'فشل الاتصال' : 'Network error'))
    }
  }

  async function approveReport(id: string, action: 'approve' | 'reject') {
    try {
      // FIX: was plain `fetch` — replaced with authedFetch so the JWT
      // token is sent. Without auth, the approve endpoint returns 401
      // and the action silently fails.
      const res = await authedFetch(`/api/daily-reports/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (res.ok) {
        toast.success(action === 'approve'
          ? (isRtl ? 'تم الاعتماد' : 'Approved')
          : (isRtl ? 'تم الرفض' : 'Rejected'))
        fetchReports()
      } else {
        const body = await res.json().catch(() => ({}))
        toast.error(body?.message || body?.error || (isRtl ? 'فشل العملية' : 'Action failed'))
      }
    } catch (e: any) {
      toast.error(e?.message || (isRtl ? 'فشل الاتصال' : 'Network error'))
    }
  }

  async function viewReportDetails(report: any) {
    setViewReport(report)
    setViewDialogOpen(true)
    try {
      // FIX: was plain `fetch`. Use authedFetch to avoid 401.
      const res = await authedFetch(`/api/daily-reports/${report.id}`)
      if (res.ok) {
        const data = await res.json().catch(() => ({}))
        if (data.report) setViewReport(data.report)
      }
    } catch {
      // Keep the basic report data already set above.
    }
  }

  // مدير النظام (admin@axis.om) — يرى زر الحذف والتعديل دائماً
  const isAdmin = (user?.email || '').toLowerCase().trim() === SYSTEM_ADMIN_EMAIL
  // المشرف (foreman) — هو الوحيد (مع مدير النظام) الذي يعدّل ويسلّم التقارير
  // التقارير تأتي من قسم السلامة، والمشرف يراجع بياناتها ويسلّمها للاعتماد
  const isSupervisor = user?.role === 'foreman'
  // الاعتماد — مدير النظام أو من لديه صلاحية الوصول للوحة التحكم فقط
  const canApprove = canAccessDashboard(user)

  // تسميات القراءة فقط لبيانات السلامة في وضع التعديل
  const editProjectName = projects.find((p) => p.id === formData.projectId)?.name || editProjectNameFallback
  const editDriveLine = driveLines.find((l) => l.id === formData.driveLineId)
  const editDriveLineLabel = editDriveLine
    ? `${editDriveLine.lineNumber} - ${editDriveLine.startPoint} → ${editDriveLine.endPoint}`
    : editDriveLineFallback
  const editWeatherLabel = weatherLabels[formData.weather]
    ? (isRtl ? weatherLabels[formData.weather].ar : weatherLabels[formData.weather].en)
    : (formData.weather || '—')
  // رسالة القفل الموحدة لبيانات السلامة
  const safetyLockHint = (
    <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-1">
      <Lock className="h-3 w-3 shrink-0" />
      {isRtl ? 'بيانات من قسم السلامة — للقراءة فقط' : 'From Safety section — read-only'}
    </p>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">{isRtl ? 'التقارير اليومية' : 'Daily Reports'}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isRtl ? `${reports.length} تقرير` : `${reports.length} reports`}
          </p>
        </div>
        <div className="flex gap-2">
          {/* Quick refresh button so the user can reload without changing
              the project filter. Helps when the previous load failed. */}
          <Button variant="outline" size="icon" onClick={fetchReports} title={isRtl ? 'تحديث' : 'Refresh'}>
            <RefreshCw className={'h-4 w-4 ' + (loading ? 'animate-spin' : '')} />
          </Button>
        </div>
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

      {loading ? (
        // Skeleton: shows the approximate shape of a report row so the
        // user sees immediate structure rather than a blank pulse.
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-muted animate-pulse" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3.5 bg-muted animate-pulse rounded w-1/3" />
                    <div className="h-3 bg-muted animate-pulse rounded w-1/2" />
                  </div>
                  <div className="h-7 bg-muted animate-pulse rounded w-32" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : loadError ? (
        // Error state with retry button — replaces the old silent-empty
        // behaviour where any API failure just showed "No reports".
        <Card className="border-red-200 bg-red-50/50">
          <CardContent className="flex flex-col items-center justify-center py-12 gap-4">
            <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center">
              <AlertCircle className="h-7 w-7 text-red-600" />
            </div>
            <div className="text-center">
              <p className="font-semibold text-red-800">{isRtl ? 'فشل تحميل التقارير' : 'Failed to load reports'}</p>
              <p className="text-sm text-red-600/80 mt-1 max-w-md">{loadError}</p>
            </div>
            <Button variant="outline" onClick={fetchReports}>
              <RefreshCw className="h-4 w-4 ml-2" />
              {isRtl ? 'إعادة المحاولة' : 'Retry'}
            </Button>
          </CardContent>
        </Card>
      ) : reports.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="h-12 w-12 mx-auto text-muted-foreground/50" />
            <p className="mt-3 text-muted-foreground">{isRtl ? 'لا توجد تقارير' : 'No reports'}</p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              {isRtl ? 'تأتي التقارير اليومية من قسم السلامة' : 'Daily reports come from the Safety section'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {reports.map((r) => {
            const status = statusLabels[r.status]
            return (
              <Card key={r.id} className="hover:shadow-sm transition">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Calendar className="h-5 w-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-sm truncate">{r.project?.name}</p>
                        <Badge variant="outline" className="text-xs">{r.driveLine?.lineNumber || '-'}</Badge>
                        <Badge variant={status.color as any} className="text-xs">
                          {isRtl ? status.ar : status.en}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {new Date(r.reportDate).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                        {' • '}
                        {r.workStartTime} - {r.workEndTime}
                        {' • '}
                        {r.workersCount} {isRtl ? 'عامل' : 'workers'}
                      </p>
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      <div className="text-center">
                        <p className="text-xs text-muted-foreground">{isRtl ? 'الإنتاج' : 'Production'}</p>
                        <p className="font-semibold">{r.dailyMeters} {isRtl ? 'م' : 'm'}</p>
                      </div>
                      {r.safety && (
                        <div className="text-center">
                          <p className="text-xs text-muted-foreground">{isRtl ? 'السلامة' : 'Safety'}</p>
                          <ShieldCheck className="h-5 w-5 text-emerald-600 mx-auto" />
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1">
                      {/* التعديل: المشرف للمسودات فقط — وبعد التسليم/الاعتماد لمدير النظام فقط */}
                      {(isAdmin || (isSupervisor && r.status === 'draft')) && (
                        <Button variant="ghost" size="sm" title={isRtl ? 'تعديل — المشرف ومدير النظام فقط' : 'Edit — supervisor & admin only'} onClick={() => openEditReport(r)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                      {/* تسليم التقرير: المشرف ومدير النظام فقط — للمسودة بعد تعديل البيانات */}
                      {(isSupervisor || isAdmin) && r.status === 'draft' && (
                        <Button variant="outline" size="sm" className="text-emerald-600" title={isRtl ? 'تسليم التقرير للاعتماد' : 'Submit for approval'} onClick={() => submitReport(r.id)}>
                          <Send className="h-4 w-4" />
                        </Button>
                      )}
                      {/* الحذف: مدير النظام (admin@axis.om) فقط */}
                      {isAdmin && (
                        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" title={isRtl ? 'حذف — مدير النظام فقط' : 'Delete — admin only'} onClick={() => deleteReport(r.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                      <Button variant="outline" size="sm" title={isRtl ? 'عرض التفاصيل' : 'View details'} onClick={() => viewReportDetails(r)}>
                        <Eye className="h-4 w-4" />
                      </Button>
                      {/* الاعتماد/الرفض: بعد التسليم — لمدير النظام أو أصحاب صلاحية لوحة التحكم فقط */}
                      {canApprove && r.status === 'submitted' && (
                        <>
                          <Button variant="outline" size="sm" className="text-emerald-600" onClick={() => approveReport(r.id, 'approve')}>
                            <Check className="h-4 w-4" />
                          </Button>
                          <Button variant="outline" size="sm" className="text-destructive" onClick={() => approveReport(r.id, 'reject')}>
                            <X className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Create/Edit Dialog with tabs */}
      <Dialog open={dialogOpen} onOpenChange={(open) => {
        setDialogOpen(open)
        if (!open) setEditingReportId(null)
      }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingReportId
                ? (isRtl ? 'تعديل التقرير اليومي' : 'Edit Daily Report')
                : (isRtl ? 'تقرير يومي جديد' : 'New Daily Report')}
            </DialogTitle>
            <DialogDescription>
              {editingReportId
                ? (isRtl ? 'عدّل بيانات التقرير' : 'Edit report details')
                : (isRtl ? 'يجب إكمال فحص السلامة قبل حفظ التقرير' : 'Safety checklist must be completed first')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Safety checklist warning banner - only for new reports */}
            {!editingReportId && (
              <div className={`p-3 rounded-lg border-2 ${allSafetyPassed ? 'bg-emerald-50 border-emerald-200' : 'bg-orange-50 border-orange-200'}`}>
                <div className="flex items-center gap-2">
                  {allSafetyPassed ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                  ) : (
                    <ShieldCheck className="h-5 w-5 text-orange-600" />
                  )}
                  <div className="flex-1">
                    <p className={`font-medium text-sm ${allSafetyPassed ? 'text-emerald-700' : 'text-orange-700'}`}>
                      {allSafetyPassed
                        ? (isRtl ? 'اكتمل فحص السلامة - يمكنك حفظ التقرير' : 'Safety check complete - you can save the report')
                        : (isRtl ? `فحص السلامة: ${safetyPassedCount}/${safetyChecklistItems.length}` : `Safety checklist: ${safetyPassedCount}/${safetyChecklistItems.length}`)
                      }
                    </p>
                  </div>
                  <Progress value={(safetyPassedCount / safetyChecklistItems.length) * 100} className="w-24 h-2" />
                </div>
              </div>
            )}

            <Tabs defaultValue={!editingReportId ? 'safety' : 'report'}>
              {!editingReportId && (
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="safety" className="gap-1.5">
                    <ShieldCheck className="h-4 w-4" />
                    {isRtl ? 'فحص السلامة' : 'Safety'}
                  </TabsTrigger>
                  <TabsTrigger value="report" className="gap-1.5">
                    <FileText className="h-4 w-4" />
                    {isRtl ? 'بيانات التقرير' : 'Report'}
                  </TabsTrigger>
                </TabsList>
              )}

              {/* Safety Tab - only for new reports */}
              {!editingReportId && (
                <TabsContent value="safety" className="space-y-4 mt-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {safetyChecklistItems.map((item) => (
                      <label
                        key={item.key}
                        className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition ${
                          safety[item.key as keyof typeof safety]
                            ? 'bg-emerald-50 border-emerald-200'
                            : 'bg-card border-border hover:bg-muted/50'
                        }`}
                      >
                        <Checkbox
                          checked={!!safety[item.key as keyof typeof safety]}
                          onCheckedChange={(checked) => {
                            setSafety({ ...safety, [item.key]: !!checked })
                          }}
                        />
                        <span className="text-sm">{item.label}</span>
                      </label>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>{isRtl ? 'المخاطر' : 'Hazards'}</Label>
                      <Textarea
                        value={safety.hazards}
                        onChange={(e) => setSafety({ ...safety, hazards: e.target.value })}
                        rows={2}
                        placeholder={isRtl ? 'اذكر أي مخاطر ملاحظة' : 'Any hazards observed'}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>{isRtl ? 'الملاحظات' : 'Observations'}</Label>
                      <Textarea
                        value={safety.observations}
                        onChange={(e) => setSafety({ ...safety, observations: e.target.value })}
                        rows={2}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>{isRtl ? 'المخالفات' : 'Violations'}</Label>
                      <Textarea
                        value={safety.violations}
                        onChange={(e) => setSafety({ ...safety, violations: e.target.value })}
                        rows={2}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>{isRtl ? 'نوع الحادث' : 'Incident Type'}</Label>
                      <Select value={safety.incidentType} onValueChange={(v) => setSafety({ ...safety, incidentType: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">{isRtl ? 'لا يوجد' : 'None'}</SelectItem>
                          <SelectItem value="near_miss">{isRtl ? 'Near miss' : 'Near miss'}</SelectItem>
                          <SelectItem value="incident">{isRtl ? 'حادث' : 'Incident'}</SelectItem>
                          <SelectItem value="accident">{isRtl ? 'إصابة' : 'Accident'}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </TabsContent>
              )}

              {/* Report Tab */}
              <div className={editingReportId ? '' : ''}>
                <div className={!editingReportId ? '' : ''}>
                  <TabsContent value="report" className={`space-y-4 ${editingReportId ? 'mt-0' : 'mt-4'}`}>
                    <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label>{isRtl ? 'المشروع' : 'Project'} *</Label>
                        {editingReportId ? (
                          <div>
                            <Input value={editProjectName || '—'} disabled readOnly dir="ltr" className="bg-muted/60 text-muted-foreground cursor-not-allowed" />
                            {safetyLockHint}
                          </div>
                        ) : (
                          <Select value={formData.projectId} onValueChange={(v) => setFormData({ ...formData, projectId: v, driveLineId: '' })}>
                            <SelectTrigger><SelectValue placeholder={isRtl ? 'اختر' : 'Select'} /></SelectTrigger>
                            <SelectContent>
                              {projects.map((p) => (
                                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <Label>{isRtl ? 'خط الحفر' : 'Drive Line'}</Label>
                        {editingReportId ? (
                          <div>
                            <Input value={editDriveLineLabel || '—'} disabled readOnly dir="ltr" className="bg-muted/60 text-muted-foreground cursor-not-allowed" />
                            {safetyLockHint}
                          </div>
                        ) : (
                          <Select value={formData.driveLineId} onValueChange={(v) => setFormData({ ...formData, driveLineId: v })}>
                            <SelectTrigger><SelectValue placeholder={isRtl ? 'اختر' : 'Select'} /></SelectTrigger>
                            <SelectContent>
                              {driveLines.map((l) => (
                                <SelectItem key={l.id} value={l.id}>{l.lineNumber} - {l.startPoint} → {l.endPoint}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <Label>{isRtl ? 'التاريخ' : 'Date'} *</Label>
                        {editingReportId ? (
                          <div>
                            <Input type="date" value={formData.reportDate} disabled readOnly className="bg-muted/60 text-muted-foreground cursor-not-allowed" />
                            {safetyLockHint}
                          </div>
                        ) : (
                          <Input type="date" value={formData.reportDate} onChange={(e) => setFormData({ ...formData, reportDate: e.target.value })} />
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <Label>{isRtl ? 'الطقس' : 'Weather'}</Label>
                        {editingReportId ? (
                          <div>
                            <Input value={editWeatherLabel} disabled readOnly className="bg-muted/60 text-muted-foreground cursor-not-allowed" />
                            {safetyLockHint}
                          </div>
                        ) : (
                          <Select value={formData.weather} onValueChange={(v) => setFormData({ ...formData, weather: v })}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="sunny">{isRtl ? 'مشمس' : 'Sunny'}</SelectItem>
                              <SelectItem value="cloudy">{isRtl ? 'غائم' : 'Cloudy'}</SelectItem>
                              <SelectItem value="rainy">{isRtl ? 'ممطر' : 'Rainy'}</SelectItem>
                              <SelectItem value="windy">{isRtl ? 'عاصف' : 'Windy'}</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <Label>{isRtl ? 'بداية العمل' : 'Work Start'}</Label>
                        <Input type="time" value={formData.workStartTime} onChange={(e) => setFormData({ ...formData, workStartTime: e.target.value })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>{isRtl ? 'نهاية العمل' : 'Work End'}</Label>
                        <Input type="time" value={formData.workEndTime} onChange={(e) => setFormData({ ...formData, workEndTime: e.target.value })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>{isRtl ? 'ساعات التشغيل' : 'Operating Hours'}</Label>
                        <Input type="number" step="0.1" value={formData.operatingHours} onChange={(e) => setFormData({ ...formData, operatingHours: e.target.value })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>{isRtl ? 'ساعات التوقف' : 'Stoppage Hours'}</Label>
                        <Input type="number" step="0.1" value={formData.stoppageHours} onChange={(e) => setFormData({ ...formData, stoppageHours: e.target.value })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>{isRtl ? 'عدد العمال' : 'Workers Count'}</Label>
                        <Input type="number" value={formData.workersCount} onChange={(e) => setFormData({ ...formData, workersCount: e.target.value })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>{isRtl ? 'سبب التوقف' : 'Stoppage Reason'}</Label>
                        <Input value={formData.stoppageReason} onChange={(e) => setFormData({ ...formData, stoppageReason: e.target.value })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>{isRtl ? 'قراءة البداية (م)' : 'Start Reading (m)'}</Label>
                        <Input type="number" step="0.01" value={formData.startReading} onChange={(e) => setFormData({ ...formData, startReading: e.target.value })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>{isRtl ? 'قراءة النهاية (م)' : 'End Reading (m)'}</Label>
                        <Input type="number" step="0.01" value={formData.endReading} onChange={(e) => setFormData({ ...formData, endReading: e.target.value })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>{isRtl ? 'التربة المحفورة' : 'Soil Excavated'}</Label>
                        <Select value={formData.soilExcavated} onValueChange={(v) => setFormData({ ...formData, soilExcavated: v })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="soft">{isRtl ? 'طرية' : 'Soft'}</SelectItem>
                            <SelectItem value="hard">{isRtl ? 'صلبة' : 'Hard'}</SelectItem>
                            <SelectItem value="rocky">{isRtl ? 'صخرية' : 'Rocky'}</SelectItem>
                            <SelectItem value="mixed">{isRtl ? 'مختلطة' : 'Mixed'}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label>{isRtl ? 'الأنابيب المركبة' : 'Pipes Installed'}</Label>
                        <Input type="number" value={formData.pipesInstalled} onChange={(e) => setFormData({ ...formData, pipesInstalled: e.target.value })} />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label>{isRtl ? 'ملاحظات الإنتاج' : 'Production Notes'}</Label>
                      <Textarea value={formData.productionNotes} onChange={(e) => setFormData({ ...formData, productionNotes: e.target.value })} rows={2} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>{isRtl ? 'المشاكل' : 'Problems'}</Label>
                      <Textarea value={formData.problems} onChange={(e) => setFormData({ ...formData, problems: e.target.value })} rows={2} />
                    </div>
                  </TabsContent>
                </div>
              </div>
            </Tabs>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { setDialogOpen(false); setEditingReportId(null) }} disabled={submitting}>
              {isRtl ? 'إلغاء' : 'Cancel'}
            </Button>
            {/* حفظ وتسليم: لتسليم المسودة بعد تعديل البيانات مباشرة */}
            {editingReportId && editingStatus === 'draft' && (
              <Button type="button" variant="outline" className="text-emerald-600 border-emerald-300 hover:bg-emerald-50" onClick={(e) => handleSubmit(e, { submitAfter: true })} disabled={submitting}>
                {submitting && saveMode === 'submit' && <Loader2 className="h-4 w-4 ml-2 animate-spin" />}
                <Send className="h-4 w-4 ml-2" />
                {isRtl ? 'حفظ وتسليم' : 'Save & Submit'}
              </Button>
            )}
            <Button type="button" onClick={(e) => handleSubmit(e)} disabled={submitting || (!editingReportId && !allSafetyPassed)}>
              {submitting && saveMode === 'draft' && <Loader2 className="h-4 w-4 ml-2 animate-spin" />}
              {editingReportId ? (isRtl ? 'تحديث التقرير' : 'Update Report') : (isRtl ? 'حفظ كمسودة' : 'Save as Draft')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Dialog */}
      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isRtl ? 'تفاصيل التقرير' : 'Report Details'}</DialogTitle>
          </DialogHeader>
          {viewReport && <ReportDetails report={viewReport} />}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ReportDetails({ report }: { report: any }) {
  const language = useAppStore((s) => s.language)
  const token = useAppStore((s) => s.token)
  const isRtl = language === 'ar'

  const safetyChecks = report.safety ? [
    { label: isRtl ? 'PPE' : 'PPE', ok: report.safety.ppeAvailable },
    { label: isRtl ? 'الخوذة' : 'Helmet', ok: report.safety.helmetCheck },
    { label: isRtl ? 'الحذاء' : 'Boots', ok: report.safety.bootsCheck },
    { label: isRtl ? 'القفازات' : 'Gloves', ok: report.safety.glovesCheck },
    { label: isRtl ? 'النظارات' : 'Glasses', ok: report.safety.glassesCheck },
    { label: isRtl ? 'منطقة العمل' : 'Work Area', ok: report.safety.workAreaCheck },
    { label: isRtl ? 'الحواجز' : 'Barriers', ok: report.safety.barriersCheck },
    { label: isRtl ? 'الحفرة' : 'Shaft', ok: report.safety.shaftCheck },
    { label: isRtl ? 'التهوية' : 'Ventilation', ok: report.safety.ventilationCheck },
    { label: isRtl ? 'الكهرباء' : 'Electrical', ok: report.safety.electricalCheck },
    { label: isRtl ? 'الرافعة' : 'Crane', ok: report.safety.craneCheck },
    { label: isRtl ? 'الهيدروليك' : 'Hydraulic', ok: report.safety.hydraulicCheck },
    { label: isRtl ? 'طفايات الحريق' : 'Fire Ext.', ok: report.safety.fireExtinguishers },
    { label: isRtl ? 'تصريح العمل' : 'Work Permit', ok: report.safety.workPermit },
    { label: isRtl ? 'Toolbox Talk' : 'Toolbox Talk', ok: report.safety.toolboxTalk },
  ] : []

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3 text-sm">
        <Detail label={isRtl ? 'المشروع' : 'Project'} value={report.project?.name || '-'} />
        <Detail label={isRtl ? 'خط الحفر' : 'Drive Line'} value={report.driveLine?.lineNumber || '-'} />
        <Detail label={isRtl ? 'التاريخ' : 'Date'} value={new Date(report.reportDate).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US')} />
        <Detail label={isRtl ? 'الطقس' : 'Weather'} value={report.weather || '-'} />
        <Detail label={isRtl ? 'بداية العمل' : 'Start'} value={report.workStartTime || '-'} />
        <Detail label={isRtl ? 'نهاية العمل' : 'End'} value={report.workEndTime || '-'} />
        <Detail label={isRtl ? 'ساعات التشغيل' : 'Operating'} value={`${report.operatingHours}h`} />
        <Detail label={isRtl ? 'ساعات التوقف' : 'Stoppage'} value={`${report.stoppageHours}h`} />
        <Detail label={isRtl ? 'عدد العمال' : 'Workers'} value={String(report.workersCount)} />
        <Detail label={isRtl ? 'الأنابيب' : 'Pipes'} value={String(report.pipesInstalled)} />
        <Detail label={isRtl ? 'قراءة البداية' : 'Start Reading'} value={`${report.startReading} م`} />
        <Detail label={isRtl ? 'قراءة النهاية' : 'End Reading'} value={`${report.endReading} م`} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Stat label={isRtl ? 'إنتاج اليوم' : 'Daily Meters'} value={`${report.dailyMeters} م`} color="text-blue-600" />
        <Stat label={isRtl ? 'إجمالي الأمتار' : 'Total Meters'} value={`${report.totalMeters.toFixed(1)} م`} color="text-purple-600" />
      </div>

      {report.stoppageReason && (
        <div className="p-3 bg-orange-50 border border-orange-200 rounded-lg text-sm">
          <p className="font-medium text-orange-700">{isRtl ? 'سبب التوقف' : 'Stoppage Reason'}</p>
          <p className="text-orange-600 mt-1">{report.stoppageReason}</p>
        </div>
      )}

      {report.productionNotes && (
        <div>
          <h4 className="font-semibold text-sm mb-1">{isRtl ? 'ملاحظات الإنتاج' : 'Production Notes'}</h4>
          <p className="text-sm text-muted-foreground">{report.productionNotes}</p>
        </div>
      )}

      {report.problems && (
        <div>
          <h4 className="font-semibold text-sm mb-1">{isRtl ? 'المشاكل' : 'Problems'}</h4>
          <p className="text-sm text-orange-600">{report.problems}</p>
        </div>
      )}

      {report.safety && (
        <div>
          <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            {isRtl ? 'قائمة السلامة' : 'Safety Checklist'}
          </h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
            {safetyChecks.map((c, i) => (
              <div key={i} className="flex items-center gap-1.5 text-xs p-1.5 rounded bg-muted/30">
                {c.ok ? (
                  <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                ) : (
                  <X className="h-3.5 w-3.5 text-red-500 shrink-0" />
                )}
                <span className={c.ok ? '' : 'text-red-500 line-through'}>{c.label}</span>
              </div>
            ))}
          </div>
          {report.safety.observations && (
            <p className="text-xs text-muted-foreground mt-2">{report.safety.observations}</p>
          )}
        </div>
      )}

      {report.costs?.length > 0 && (
        <div>
          <h4 className="font-semibold text-sm mb-2">{isRtl ? 'التكاليف' : 'Costs'}</h4>
          <div className="space-y-1">
            {report.costs.map((c: any) => (
              <div key={c.id} className="flex justify-between text-sm p-2 rounded bg-muted/30">
                <span>{c.description}</span>
                <span className="font-medium">{c.amount} ر.ع</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="p-3 rounded-lg bg-muted/50 text-center">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`font-bold text-sm mt-0.5 ${color}`}>{value}</p>
    </div>
  )
}

