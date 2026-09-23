'use client'

import { useEffect, useState, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ShieldCheck, ShieldAlert, AlertTriangle, CheckCircle2, XCircle, Calendar, Plus, Loader2, Trash2, GitBranch, Users, Phone, Building2, Pencil, Lock } from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { authedFetch } from '@/lib/api-client'
import { canWrite } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

const incidentLabels: Record<string, { ar: string; en: string; color: string }> = {
  none: { ar: 'لا يوجد', en: 'None', color: 'secondary' },
  near_miss: { ar: 'Near miss', en: 'Near miss', color: 'default' },
  incident: { ar: 'حادث', en: 'Incident', color: 'destructive' },
  accident: { ar: 'إصابة', en: 'Accident', color: 'destructive' },
}

const checklistItems = [
  { key: 'ppeAvailable', ar: 'معدات الحماية متوفرة', en: 'PPE Available' },
  { key: 'helmetCheck', ar: 'خوذات السلامة', en: 'Safety Helmets' },
  { key: 'bootsCheck', ar: 'أحذية السلامة', en: 'Safety Boots' },
  { key: 'glovesCheck', ar: 'القفازات', en: 'Gloves' },
  { key: 'glassesCheck', ar: 'النظارات الواقية', en: 'Safety Glasses' },
  { key: 'workAreaCheck', ar: 'تنظيم منطقة العمل', en: 'Work Area Organized' },
  { key: 'barriersCheck', ar: 'الحواجز والتحذيرات', en: 'Barriers & Warnings' },
  { key: 'shaftCheck', ar: 'سلامة البئر', en: 'Shaft Safety' },
  { key: 'ventilationCheck', ar: 'التهوية', en: 'Ventilation' },
  { key: 'electricalCheck', ar: 'السلامة الكهربائية', en: 'Electrical Safety' },
  { key: 'craneCheck', ar: 'سلامة الرافعة', en: 'Crane Safety' },
  { key: 'hydraulicCheck', ar: 'سلامة النظام الهيدروليكي', en: 'Hydraulic Safety' },
  { key: 'fireExtinguishers', ar: 'طفايات الحريق', en: 'Fire Extinguishers' },
  { key: 'workPermit', ar: 'تصريح العمل', en: 'Work Permit' },
  { key: 'toolboxTalk', ar: 'Toolbox Talk', en: 'Toolbox Talk' },
]

// v27: تنسيق خط الحفر «خط N: بداية → نهاية» — نفس صيغة صفحة التقارير اليومية
function reassignLineLabel(dl: any, isRtl: boolean): string {
  if (!dl) return ''
  var num = dl.lineNumber != null && String(dl.lineNumber) !== '' ? String(dl.lineNumber) : '-'
  var label = isRtl ? 'خط ' + num : 'Line ' + num
  var sp = dl.startPoint ? String(dl.startPoint) : ''
  var ep = dl.endPoint ? String(dl.endPoint) : ''
  if (sp && ep) return label + ': ' + sp + ' \u2192 ' + ep
  if (sp || ep) return label + ': ' + (sp || ep)
  return label
}

const emptyForm = {
  projectId: '',
  driveLineId: '',
  reportDate: new Date().toISOString().split('T')[0],
  ppeAvailable: false,
  helmetCheck: false,
  bootsCheck: false,
  glovesCheck: false,
  glassesCheck: false,
  workAreaCheck: false,
  barriersCheck: false,
  shaftCheck: false,
  ventilationCheck: false,
  electricalCheck: false,
  craneCheck: false,
  hydraulicCheck: false,
  fireExtinguishers: false,
  workPermit: false,
  toolboxTalk: false,
  observations: '',
  violations: '',
  incidentType: 'none',
  incidentDescription: '',
}

export default function SafetyPage() {
  const [reports, setReports] = useState<any[]>([])
  const [projects, setProjects] = useState<any[]>([])
  // v18 FIX: حالة تحميل/خطأ قائمة المشاريع — كانت الفشل تُبتلع بصمت فتبدو القائمة فارغة بلا سبب ظاهر
  const [projectsLoading, setProjectsLoading] = useState(true)
  const [projectsError, setProjectsError] = useState(false)
  const [driveLines, setDriveLines] = useState<any[]>([])
  // v24: حالة فشل جلب خطوط الحفر — لعرض تنبيه وزر إعادة محاولة بدل قائمة صامتة فارغة
  const [driveLinesError, setDriveLinesError] = useState(false)
  // v26: التقرير قيد التعديل (null = وضع الإنشاء)
  const [editingSafety, setEditingSafety] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [selectedProject, setSelectedProject] = useState<string>('all')
  // v39: فلترة تقارير السلامة — من/إلى تاريخ، الحالة، نوع الحادث، بحث نصي
  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo, setFilterTo] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterIncident, setFilterIncident] = useState('all')
  const [filterSearch, setFilterSearch] = useState('')
  const [sheetOpen, setSheetOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ ...emptyForm })

  // v27: نافذة تعديل المشروع وخط الحفر — تنقل تقرير السلامة والتقرير اليومي المرتبط معاً
  const [reassignSafety, setReassignSafety] = useState<any>(null)
  const [reassignOpen, setReassignOpen] = useState(false)
  const [reassignProjectId, setReassignProjectId] = useState('')
  const [reassignLineId, setReassignLineId] = useState('')
  const [reassignLines, setReassignLines] = useState<any[]>([])
  const [reassignLinesLoading, setReassignLinesLoading] = useState(false)
  const [reassignSaving, setReassignSaving] = useState(false)

  // Workers state
  const [workers, setWorkers] = useState<any[]>([])
  const [workersLoading, setWorkersLoading] = useState(false)
  const [workerDialogOpen, setWorkerDialogOpen] = useState(false)
  const [editingWorker, setEditingWorker] = useState<any>(null)
  const [workerForm, setWorkerForm] = useState({ name: '', phone: '', contractorName: '', projectId: '', notes: '' })
  const driveLinesLoaded = useRef<string | null>(null)
  const language = useAppStore((s) => s.language)
  const isRtl = language === 'ar'
  const isAdmin = useAppStore((s) => s.user)?.email?.toLowerCase().trim() === 'admin@axis.om'
  // v26: صلاحية تعديل تقارير السلامة — لكل من يملك صلاحية قسم السلامة (مع تجاوز مدير النظام)
  const storeUser = useAppStore((s) => s.user)
  const canEditSafety = isAdmin || canWrite(storeUser?.role || '', 'safety', storeUser?.permissions)

  // v27: إعادة إسناد المشروع وخط الحفر — نفس صلاحيات القسم للمسودة/المُسلَّم،
  // والمعتمد/المرفوض للإدارة العليا ومدير النظام فقط
  const isTopManagement = String(storeUser?.role || '').toLowerCase().trim() === 'top_management'

  function canReassignSafety(r: any): boolean {
    var st = (r.dailyReport && r.dailyReport.status) || 'draft'
    if (isAdmin || isTopManagement) return true
    return canEditSafety && (st === 'draft' || st === 'submitted')
  }

  function openReassignSafety(r: any) {
    setReassignSafety(r)
    setReassignProjectId(r.projectId || '')
    setReassignLineId(r.dailyReport && r.dailyReport.driveLine ? r.dailyReport.driveLine.id : '')
    setReassignLines(r.dailyReport && r.dailyReport.driveLine ? [r.dailyReport.driveLine] : [])
    setReassignOpen(true)
    loadReassignLines(r.projectId || '')
  }

  // تحميل كل خطوط الحفر الخاصة بالمشروع (بلا تصفية «لم يبدأ») — إعادة الإسناد تصحيح إداري
  function loadReassignLines(pid: string) {
    if (!pid) {
      setReassignLines([])
      return
    }
    setReassignLinesLoading(true)
    authedFetch('/api/drive-lines?projectId=' + encodeURIComponent(pid))
      .then(function(res) { return res.json().catch(function() { return {} }) })
      .then(function(d) {
        if (d && d.error) throw new Error(String(d.error))
        var all: any[] = Array.isArray(d.driveLines) ? d.driveLines : []
        setReassignLines(all)
        setReassignLineId(function(prev: string) {
          return prev && all.some(function(l) { return l.id === prev }) ? prev : ''
        })
        setReassignLinesLoading(false)
      })
      .catch(function() {
        setReassignLines([])
        setReassignLinesLoading(false)
        toast.error(isRtl ? 'تعذّر تحميل خطوط الحفر — أعد المحاولة' : 'Failed to load drive lines')
      })
  }

  function saveReassignSafety() {
    if (!reassignSafety) return
    if (!reassignProjectId) {
      toast.error(isRtl ? 'يرجى اختيار المشروع' : 'Please select a project')
      return
    }
    var dailyId = reassignSafety.dailyReport ? reassignSafety.dailyReport.id : null
    if (!dailyId) {
      toast.error(isRtl ? 'لا يوجد تقرير يومي مرتبط بهذا التقرير' : 'No linked daily report')
      return
    }
    var currentLineId = reassignSafety.dailyReport && reassignSafety.dailyReport.driveLine ? reassignSafety.dailyReport.driveLine.id : ''
    var unchanged = reassignProjectId === reassignSafety.projectId && (reassignLineId || '') === (currentLineId || '')
    if (unchanged) {
      toast.error(isRtl ? 'لا يوجد تغيير — اختر مشروعاً أو خطاً مختلفاً' : 'Nothing changed — pick a different project or line')
      return
    }
    var msg = isRtl
      ? 'سيتم نقل تقرير السلامة والتقرير اليومي المرتبط به إلى المشروع/خط الحفر المختار وإعادة حساب الإيراد والتقدم تلقائياً. متابعة؟'
      : 'The safety report and its linked daily report will be moved to the selected project/drive line and revenue & progress recalculated. Continue?'
    if (!confirm(msg)) return
    setReassignSaving(true)
    authedFetch('/api/daily-reports/' + dailyId + '/reassign', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: reassignProjectId, driveLineId: reassignLineId || null }),
    })
      .then(function(res) {
        return res.json().catch(function() { return {} }).then(function(d) { return { ok: res.ok, data: d } })
      })
      .then(function(out) {
        if (!out.ok) {
          toast.error(out.data.message || out.data.error || (isRtl ? 'فشل تعديل الإسناد' : 'Failed to reassign'))
          return
        }
        toast.success(isRtl ? 'تم تعديل المشروع وخط الحفر وإعادة الحساب' : 'Project & drive line updated and recalculated')
        setReassignOpen(false)
        setReassignSafety(null)
        fetchReports()
      })
      .catch(function() {
        toast.error(isRtl ? 'فشل الاتصال' : 'Network error')
      })
      .finally(function() { setReassignSaving(false) })
  }

  async function deleteReport(reportId: string) {
    var msg = isRtl
      ? 'هل أنت متأكد من حذف تقرير السلامة؟ يمكن للموظف إنشاء تقرير جديد بعد الحذف.'
      : 'Are you sure you want to delete this safety report? The employee can create a new one after deletion.'
    if (!confirm(msg)) return
    try {
      var res = await authedFetch('/api/safety-inspection', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: reportId }),
      })
      if (res.ok) {
        toast.success(isRtl ? 'تم حذف تقرير السلامة' : 'Safety report deleted')
        fetchReports()
      } else {
        var data = await res.json().catch(function() { return {} })
        toast.error(data.message || (isRtl ? 'فشل الحذف' : 'Delete failed'))
      }
    } catch {
      toast.error(isRtl ? 'حدث خطأ' : 'Error')
    }
  }

  async function fetchReports() {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (selectedProject !== 'all') params.set('projectId', selectedProject)
      params.set('limit', '100')
      const res = await authedFetch('/api/safety-inspection?' + params.toString())
      if (!res.ok) throw new Error('Failed to fetch')
      const data = await res.json()
      setReports(data.safetyReports || [])
    } catch {
      toast.error(isRtl ? 'خطأ في تحميل التقارير' : 'Failed to load reports')
    } finally {
      setLoading(false)
    }
  }

  // v18 FIX: كان الجلب صامتاً تماماً — أي فشل (403/500/شبكة) يترك القائمة فارغة
  // إلى الأبد بلا رسالة ولا إعادة محاولة، فيبدو نموذج السلامة "بلا مشاريع".
  // الآن: رسالة خطأ واضحة تعرض سبب الخادم + حالة تحميل مرئية.
  async function fetchProjects() {
    setProjectsLoading(true)
    try {
      var res = await authedFetch('/api/projects/list?_t=' + Date.now())
      if (!res.ok) {
        setProjects([])
        setProjectsError(true)
        var errData = await res.json().catch(function() { return {} })
        toast.error(errData.message || (isRtl ? 'فشل تحميل قائمة المشاريع' : 'Failed to load projects'))
        return
      }
      var data = await res.json()
      setProjects(data.projects || [])
      setProjectsError(false)
    } catch {
      setProjects([])
      setProjectsError(true)
      toast.error(isRtl ? 'فشل تحميل قائمة المشاريع' : 'Failed to load projects')
    } finally {
      setProjectsLoading(false)
    }
  }

  async function fetchWorkers() {
    setWorkersLoading(true)
    try {
      var params = new URLSearchParams()
      if (selectedProject !== 'all') params.set('projectId', selectedProject)
      var res = await authedFetch('/api/workers?' + params.toString())
      var data = await res.json()
      setWorkers(data.workers || [])
    } catch {
      setWorkers([])
    }
    setWorkersLoading(false)
  }

  async function saveWorker(e: React.FormEvent) {
    e.preventDefault()
    try {
      var url = editingWorker ? '/api/workers/' + editingWorker.id : '/api/workers'
      var method = editingWorker ? 'PUT' : 'POST'
      var res = await authedFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(workerForm),
      })
      if (res.ok) {
        toast.success(editingWorker ? (isRtl ? 'تم تحديث بيانات العامل' : 'Worker updated') : (isRtl ? 'تم إضافة العامل' : 'Worker added'))
        setWorkerDialogOpen(false)
        setEditingWorker(null)
        setWorkerForm({ name: '', phone: '', contractorName: '', projectId: '', notes: '' })
        fetchWorkers()
      }
    } catch {
      toast.error(isRtl ? 'حدث خطأ' : 'Error')
    }
  }

  async function deleteWorker(id: string) {
    if (!confirm(isRtl ? 'هل أنت متأكد من حذف هذا العامل؟' : 'Delete this worker?')) return
    try {
      var res = await authedFetch('/api/workers/' + id, { method: 'DELETE' })
      if (res.ok) {
        toast.success(isRtl ? 'تم حذف العامل' : 'Worker deleted')
        fetchWorkers()
      }
    } catch {
      toast.error(isRtl ? 'حدث خطأ' : 'Error')
    }
  }

  useEffect(() => {
    fetchReports()
    fetchProjects()
    fetchWorkers()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // v18 FIX: كانت المشاريع تُجلب مرة واحدة عند فتح الصفحة فقط — أي فشل عابر
  // وقتها يعني قائمة فارغة إلى الأبد. نعيد المحاولة تلقائياً عند كل فتح
  // لنموذج التقرير أو نافذة العمال.
  useEffect(() => {
    if (sheetOpen || workerDialogOpen) fetchProjects()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetOpen, workerDialogOpen])

  useEffect(() => {
    fetchReports()
    fetchWorkers()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProject])

  // v24: جلب خطوط الحفر كدالة قابلة للاستدعاء — تسمح بإعادة المحاولة من الواجهة
  function loadDriveLines(pid: string) {
    if (!pid) return
    driveLinesLoaded.current = pid
    setDriveLinesError(false)
    authedFetch('/api/drive-lines?projectId=' + pid)
      .then(function(r) { return r.json() })
      .then(function(d) {
        // 401/403 أو أي خطأ من الخادم → مسار الخطأ المرئي بدل قائمة فارغة صامتة
        if (d && d.error) throw new Error(String(d.error || 'failed'))
        // إخفاء خطوط الحفر التي لم تبدأ بعد — لا يمكن تسجيل سلامة لخط لم يبدأ العمل عليه
        var list = (d.driveLines || []).filter(function(l: any) { return l.status !== 'not_started' })
        setDriveLines(list)
        // إذا كان الخط المختار سابقاً ضمن الخطوط المخفية نُفرغه
        setForm(function(f) {
          if (f.driveLineId && !list.some(function(l) { return l.id === f.driveLineId })) {
            return Object.assign({}, f, { driveLineId: '' })
          }
          return f
        })
      })
      .catch(function() {
        // لا نحتجز الطلب الفاشل في المرجع — تتيح إعادة المحاولة عند النقر أو إعادة الاختيار
        driveLinesLoaded.current = null
        setDriveLines([])
        setDriveLinesError(true)
      })
  }

  // Load drive lines when project changes in the form
  useEffect(() => {
    if (!form.projectId) {
      setDriveLines([])
      setDriveLinesError(false)
      driveLinesLoaded.current = null
      return
    }
    if (driveLinesLoaded.current === form.projectId) return
    loadDriveLines(form.projectId)
  }, [form.projectId])

  // v26: فتح نموذج تعديل تقرير السلامة — تعبئة المحتوى وبيانات التعريف تبقى للقراءة فقط
  function openEditSafety(r: any) {
    var f: any = { ...emptyForm }
    f.projectId = r.projectId || ''
    f.reportDate = r.reportDate ? String(r.reportDate).split('T')[0] : f.reportDate
    if (r.dailyReport && r.dailyReport.driveLine) f.driveLineId = r.dailyReport.driveLine.id
    for (var i = 0; i < checklistItems.length; i++) {
      var item = checklistItems[i]
      f[item.key] = !!r[item.key]
    }
    f.observations = r.observations || ''
    f.violations = r.violations || ''
    f.incidentType = r.incidentType || 'none'
    f.incidentDescription = r.incidentDescription || ''
    setForm(f)
    setEditingSafety(r)
    setSheetOpen(true)
  }

  async function handleSave() {
    if (!form.projectId || !form.reportDate) {
      toast.error(isRtl ? 'يرجى اختيار المشروع والتاريخ' : 'Please select project and date')
      return
    }

    setSaving(true)
    try {
      const safetyData: any = {
        projectId: form.projectId,
        driveLineId: form.driveLineId || null,
        reportDate: form.reportDate,
      }
      for (var i = 0; i < checklistItems.length; i++) {
        var item = checklistItems[i]
        safetyData[item.key] = !!form[item.key as keyof typeof form]
      }
      safetyData.observations = form.observations || null
      safetyData.violations = form.violations || null
      safetyData.incidentType = form.incidentType
      safetyData.incidentDescription = form.incidentType !== 'none' ? (form.incidentDescription || null) : null

      // v26: وضع التعديل — PUT إلى مسار تقرير السلامة نفسه، والخادم يقفل التعديل بعد إرسال التقرير اليومي
      var isEdit = !!editingSafety
      var safetyRes = await authedFetch(isEdit ? ('/api/safety-inspection/' + editingSafety.id) : '/api/safety-inspection', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(safetyData),
      })

      if (safetyRes.status === 409) {
        var errData = await safetyRes.json().catch(function() { return {} })
        toast.error(errData.message || (isRtl ? 'لقد أنشأت تقرير سلامة لهذا المشروع في هذا التاريخ بالفعل' : 'You already created a safety report for this project today'))
        setSaving(false)
        return
      }

      if (!safetyRes.ok) throw new Error('Failed to save safety report')

      toast.success(isRtl
        ? (isEdit ? 'تم حفظ التعديلات — ستظهر في قسم التقارير اليومية وقسم الرقابة' : 'تم حفظ تقرير السلامة بنجاح')
        : (isEdit ? 'Changes saved — visible in Daily Reports and Oversight' : 'Safety report saved successfully'))
      setSheetOpen(false)
      setEditingSafety(null)
      setForm({ ...emptyForm, reportDate: new Date().toISOString().split('T')[0] })
      fetchReports()
    } catch (e: any) {
      toast.error(e.message || (isRtl ? 'حدث خطأ' : 'Error'))
    } finally {
      setSaving(false)
    }
  }

  function goToDailyReports() {
    useAppStore.getState().setPage('dailyReports')
  }

  // Calculate stats
  var total = reports.length
  var incidents = reports.filter(function(r) { return r.incidentType && r.incidentType !== 'none' }).length

  var seenDates: Record<string, boolean> = {}
  var uniqueReports = reports.filter(function(r) {
    var dateKey = r.projectId + '_' + (r.reportDate ? r.reportDate.split('T')[0] : '')
    if (seenDates[dateKey]) return false
    seenDates[dateKey] = true
    return true
  })

  var avgCompliance = uniqueReports.length > 0
    ? uniqueReports.reduce(function(sum, r) {
        var passed = checklistItems.filter(function(item) { return r[item.key as keyof any] }).length
        return sum + (passed / 15) * 100
      }, 0) / uniqueReports.length
    : 0

  var formPassed = checklistItems.filter(function(item) { return !!form[item.key as keyof typeof form] }).length
  var formCompliance = (formPassed / 15) * 100

  var today = new Date().toISOString().split('T')[0]
  var todayReportExists = selectedProject !== 'all' && reports.some(function(r) {
    return r.projectId === selectedProject && r.reportDate && r.reportDate.split('T')[0] === today
  })

  // v39: حساب القائمة المفلترة — الفلترة على العناصر المحمّلة (حتى 100 تقرير)
  var safetyFilterActive = !!(filterFrom || filterTo || filterStatus !== 'all' || filterIncident !== 'all' || filterSearch.trim())
  var filteredReports = safetyFilterActive
    ? reports.filter(function(r) {
        var d = r.reportDate ? String(r.reportDate).split('T')[0] : ''
        if (filterFrom && (!d || d < filterFrom)) return false
        if (filterTo && (!d || d > filterTo)) return false
        var st = (r.dailyReport && r.dailyReport.status) || 'draft'
        if (filterStatus !== 'all' && st !== filterStatus) return false
        if (filterIncident !== 'all' && (r.incidentType || 'none') !== filterIncident) return false
        var q = filterSearch.trim().toLowerCase()
        if (q) {
          var hay = [r.project && r.project.name, r.incidentDescription].join(' ').toLowerCase()
          if (hay.indexOf(q) === -1) return false
        }
        return true
      })
    : reports
  function clearReportFilters() {
    setFilterFrom(''); setFilterTo(''); setFilterStatus('all'); setFilterIncident('all'); setFilterSearch('')
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">{isRtl ? 'السلامة والعمال' : 'Safety & Workers'}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isRtl ? 'تقارير السلامة اليومية وإدارة بيانات العمال' : 'Daily safety reports and worker management'}
          </p>
        </div>
        <Button onClick={function() {
          setForm({ ...emptyForm, reportDate: new Date().toISOString().split('T')[0] })
          setDriveLines([])
          setDriveLinesError(false)
          driveLinesLoaded.current = null
          setEditingSafety(null)
          setSheetOpen(true)
        }} disabled={todayReportExists}>
          <Plus className="h-4 w-4 ml-2" />
          {isRtl ? 'إضافة تقرير سلامة' : 'Add Safety Report'}
        </Button>
      </div>

      {todayReportExists && (
        <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 text-sm">
          <span className="text-blue-700">{isRtl ? 'لقد أنشأت تقرير سلامة لهذا اليوم بالفعل.' : 'You already created a safety report for today.'}</span>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-lg bg-blue-50 flex items-center justify-center">
                <Calendar className="h-6 w-6 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{total}</p>
                <p className="text-sm text-muted-foreground">{isRtl ? 'تقارير السلامة' : 'Safety reports'}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-lg bg-emerald-50 flex items-center justify-center">
                <ShieldCheck className="h-6 w-6 text-emerald-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{avgCompliance.toFixed(1)}%</p>
                <p className="text-sm text-muted-foreground">{isRtl ? 'متوسط الالتزام' : 'Avg compliance'}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-lg bg-orange-50 flex items-center justify-center">
                <AlertTriangle className="h-6 w-6 text-orange-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{incidents}</p>
                <p className="text-sm text-muted-foreground">{isRtl ? 'حوادث / near miss' : 'Incidents'}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Select value={selectedProject} onValueChange={setSelectedProject}>
        <SelectTrigger className="w-full sm:w-[300px]">
          <SelectValue placeholder={isRtl ? 'اختر المشروع' : 'Select project'} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{isRtl ? 'كل المشاريع' : 'All Projects'}</SelectItem>
          {projects.map(function(p) {
            return <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
          })}
        </SelectContent>
      </Select>

      {/* v39: شريط فلترة تقارير السلامة */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 p-3 rounded-lg border bg-muted/30">
        <div>
          <Label className="text-xs text-muted-foreground">{isRtl ? 'من تاريخ' : 'From date'}</Label>
          <Input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} className="h-9 mt-1" />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">{isRtl ? 'إلى تاريخ' : 'To date'}</Label>
          <Input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} className="h-9 mt-1" />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">{isRtl ? 'الحالة' : 'Status'}</Label>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="h-9 mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{isRtl ? 'كل الحالات' : 'All statuses'}</SelectItem>
              <SelectItem value="draft">{isRtl ? 'مسودة' : 'Draft'}</SelectItem>
              <SelectItem value="submitted">{isRtl ? 'مرسل' : 'Submitted'}</SelectItem>
              <SelectItem value="approved">{isRtl ? 'معتمد' : 'Approved'}</SelectItem>
              <SelectItem value="rejected">{isRtl ? 'مرفوض' : 'Rejected'}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">{isRtl ? 'نوع الحادث' : 'Incident type'}</Label>
          <Select value={filterIncident} onValueChange={setFilterIncident}>
            <SelectTrigger className="h-9 mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{isRtl ? 'كل الأنواع' : 'All types'}</SelectItem>
              <SelectItem value="none">{isRtl ? 'لا يوجد' : 'None'}</SelectItem>
              <SelectItem value="near_miss">Near miss</SelectItem>
              <SelectItem value="incident">{isRtl ? 'حادث' : 'Incident'}</SelectItem>
              <SelectItem value="accident">{isRtl ? 'إصابة' : 'Accident'}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">{isRtl ? 'بحث' : 'Search'}</Label>
          <Input type="search" value={filterSearch} onChange={(e) => setFilterSearch(e.target.value)} placeholder={isRtl ? 'مشروع أو حادث...' : 'project or incident...'} className="h-9 mt-1" />
        </div>
      </div>
      {safetyFilterActive && (
        <div className="flex items-center gap-2 flex-wrap -mt-1">
          <p className="text-xs text-muted-foreground">
            {isRtl ? `النتائج: ${filteredReports.length} من ${reports.length}` : `Showing ${filteredReports.length} of ${reports.length}`}
          </p>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={clearReportFilters}>
            {isRtl ? 'مسح الفلاتر' : 'Clear filters'}
          </Button>
        </div>
      )}

      {loading ? (
        <div className="h-32 bg-muted animate-pulse rounded" />
      ) : filteredReports.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <ShieldCheck className="h-12 w-12 mx-auto text-muted-foreground/50" />
            {safetyFilterActive ? (
              <>
                <p className="mt-3 text-muted-foreground">{isRtl ? 'لا توجد نتائج مطابقة للفلاتر' : 'No reports match the filters'}</p>
                <Button variant="outline" size="sm" className="mt-3" onClick={clearReportFilters}>
                  {isRtl ? 'مسح الفلاتر' : 'Clear filters'}
                </Button>
              </>
            ) : (
              <p className="mt-3 text-muted-foreground">{isRtl ? 'لا توجد تقارير سلامة' : 'No safety reports'}</p>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredReports.map(function(r) {
            var checks = checklistItems.map(function(item) { return r[item.key as keyof any] })
            var passed = checks.filter(Boolean).length
            var compliance = (passed / 15) * 100
            var incident = incidentLabels[r.incidentType || 'none']
            var hasIncident = r.incidentType && r.incidentType !== 'none'
            var reportStatus = (r.dailyReport && r.dailyReport.status) || 'draft'
            var isDraft = reportStatus === 'draft'

            return (
              <Card key={r.id} className={hasIncident ? 'border-destructive/30' : ''}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className={'w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ' +
                      (hasIncident ? 'bg-destructive/10' : compliance === 100 ? 'bg-emerald-50' : 'bg-orange-50')
                    }>
                      {hasIncident ? (
                        <ShieldAlert className="h-5 w-5 text-destructive" />
                      ) : compliance === 100 ? (
                        <ShieldCheck className="h-5 w-5 text-emerald-600" />
                      ) : (
                        <AlertTriangle className="h-5 w-5 text-orange-600" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <p className="font-semibold text-sm">{r.project ? r.project.name : '-'}</p>
                        {isDraft && (
                          <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200">
                            {isRtl ? 'بانتظار إكمال البيانات' : 'Awaiting data'}
                          </Badge>
                        )}
                        {!isDraft && (
                          <Badge variant="outline" className="text-xs">
                            {reportStatus === 'submitted' ? (isRtl ? 'مرسل' : 'Submitted') : reportStatus === 'approved' ? (isRtl ? 'معتمد' : 'Approved') : (isRtl ? 'مرفوض' : 'Rejected')}
                          </Badge>
                        )}
                        {hasIncident && (
                          <Badge variant={incident.color as any} className="text-xs">
                            {isRtl ? incident.ar : incident.en}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mb-2">
                        {new Date(r.reportDate).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                        {' \u2022 '}
                        {isRtl ? 'موقّع من' : 'Signed by'}: {r.signedByUser ? (r.signedByUser.name || r.signedByUser.nameEn || '-') : '-'}
                      </p>
                      <div className="flex items-center gap-2 mb-2">
                        <Progress value={compliance} className="h-1.5 flex-1" />
                        <span className="text-xs font-medium">{passed}/15</span>
                      </div>
                      {r.observations && (
                        <p className="text-xs text-muted-foreground">{r.observations}</p>
                      )}
                      {r.violations && (
                        <p className="text-xs text-orange-600 mt-1">{'\u26A0 '}{r.violations}</p>
                      )}
                      {r.incidentDescription && (
                        <p className="text-xs text-destructive mt-1">{'\uD83D\uDEA8 '}{r.incidentDescription}</p>
                      )}
                      {isDraft && (
                        <Button variant="link" size="sm" className="text-primary p-0 h-auto mt-2" onClick={goToDailyReports}>
                          {isRtl ? 'إكمال بيانات التقرير اليومي \u2192' : 'Complete daily report data \u2192'}
                        </Button>
                      )}
                    </div>
                    {/* v38: تعديل تقرير السلامة — الإدارة العليا ومدير النظام في أي حالة، والمصرّح لهم قبل الإرسال */}
                    {(isAdmin || isTopManagement || (canEditSafety && isDraft)) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 shrink-0"
                        title={isRtl ? 'تعديل تقرير السلامة' : 'Edit safety report'}
                        onClick={function() { openEditSafety(r) }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                    {/* v27: تعديل المشروع وخط الحفر — نقل التقرير مع التقرير اليومي المرتبط */}
                    {canReassignSafety(r) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 shrink-0"
                        title={isRtl ? 'تعديل المشروع وخط الحفر' : 'Change project & drive line'}
                        onClick={function() { openReassignSafety(r) }}
                      >
                        <GitBranch className="h-4 w-4" />
                      </Button>
                    )}
                    {/* v38: الحذف لمدير النظام والإدارة العليا */}
                    {(isAdmin || isTopManagement) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
                        onClick={function() { deleteReport(r.id) }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Workers Section */}
      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <div className="w-7 h-7 rounded-md bg-blue-100 text-blue-600 flex items-center justify-center">
                <Users className="h-4 w-4" />
              </div>
              {isRtl ? 'بيانات العمال' : 'Worker Data'}
              <Badge variant="secondary" className="text-xs font-normal">{workers.length}</Badge>
            </CardTitle>
            <Button size="sm" onClick={function() {
              setEditingWorker(null)
              setWorkerForm({ name: '', phone: '', contractorName: '', projectId: projects[0]?.id || '', notes: '' })
              setWorkerDialogOpen(true)
            }}>
              <Plus className="h-3.5 w-3.5 ml-1.5" />
              {isRtl ? 'إضافة عامل' : 'Add Worker'}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {workersLoading ? (
            <div className="h-24 bg-muted animate-pulse rounded-lg" />
          ) : workers.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground text-sm">
              <Users className="h-10 w-10 mx-auto mb-2 opacity-30" />
              {isRtl ? 'لا يوجد عمال مسجلين' : 'No workers registered'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="p-2.5 text-right font-medium text-xs uppercase tracking-wider text-muted-foreground w-8">#</th>
                    <th className="p-2.5 text-right font-medium text-xs uppercase tracking-wider text-muted-foreground">{isRtl ? 'الاسم' : 'Name'}</th>
                    <th className="p-2.5 text-right font-medium text-xs uppercase tracking-wider text-muted-foreground">{isRtl ? 'رقم التواصل' : 'Phone'}</th>
                    <th className="p-2.5 text-right font-medium text-xs uppercase tracking-wider text-muted-foreground">{isRtl ? 'المقاول' : 'Contractor'}</th>
                    <th className="p-2.5 text-right font-medium text-xs uppercase tracking-wider text-muted-foreground">{isRtl ? 'المشروع' : 'Project'}</th>
                    <th className="p-2.5 text-right font-medium text-xs uppercase tracking-wider text-muted-foreground w-20">{isRtl ? 'إجراءات' : 'Actions'}</th>
                  </tr>
                </thead>
                <tbody>
                  {workers.map(function(w, idx) {
                    return (
                      <tr key={w.id} className="border-b hover:bg-muted/20 transition-colors group">
                        <td className="p-2.5 text-muted-foreground text-xs">{idx + 1}</td>
                        <td className="p-2.5 font-medium">{w.name}</td>
                        <td className="p-2.5">
                          <span className="flex items-center gap-1.5 text-xs">
                            <Phone className="h-3 w-3 text-muted-foreground" />
                            {w.phone}
                          </span>
                        </td>
                        <td className="p-2.5">
                          {w.contractorName ? (
                            <span className="flex items-center gap-1.5 text-xs">
                              <Building2 className="h-3 w-3 text-muted-foreground" />
                              {w.contractorName}
                            </span>
                          ) : '-'}
                        </td>
                        <td className="p-2.5 text-xs text-muted-foreground">{w.project ? w.project.name : '-'}</td>
                        <td className="p-2.5">
                          {/* الأزرار ظاهرة دائماً على الهاتف (لا يوجد hover باللمس) */}
                          <div className="flex gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={function() {
                              setEditingWorker(w)
                              setWorkerForm({
                                name: w.name,
                                phone: w.phone,
                                contractorName: w.contractorName || '',
                                projectId: w.projectId || '',
                                notes: w.notes || '',
                              })
                              setWorkerDialogOpen(true)
                            }}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={function() { deleteWorker(w.id) }}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Worker Dialog */}
      <Dialog open={workerDialogOpen} onOpenChange={setWorkerDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingWorker ? (isRtl ? 'تعديل بيانات العامل' : 'Edit Worker') : (isRtl ? 'إضافة عامل جديد' : 'Add Worker')}</DialogTitle>
            <DialogDescription>
              {editingWorker ? (isRtl ? 'عدّل بيانات العامل' : 'Edit worker details') : (isRtl ? 'أدخل بيانات العامل الجديد' : 'Enter new worker details')}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={saveWorker} className="space-y-3">
            <div className="space-y-1.5">
              <Label>{isRtl ? 'اسم العامل' : 'Worker Name'} *</Label>
              <Input value={workerForm.name} onChange={function(e) { setWorkerForm(Object.assign({}, workerForm, { name: e.target.value })) }} required />
            </div>
            <div className="space-y-1.5">
              <Label>{isRtl ? 'رقم التواصل' : 'Phone Number'} *</Label>
              <Input value={workerForm.phone} onChange={function(e) { setWorkerForm(Object.assign({}, workerForm, { phone: e.target.value })) }} required />
            </div>
            <div className="space-y-1.5">
              <Label>{isRtl ? 'اسم المقاول' : 'Contractor Name'}</Label>
              <Input value={workerForm.contractorName} onChange={function(e) { setWorkerForm(Object.assign({}, workerForm, { contractorName: e.target.value })) }} />
            </div>
            <div className="space-y-1.5">
              <Label>{isRtl ? 'المشروع' : 'Project'}</Label>
              <Select value={workerForm.projectId} onValueChange={function(v) { setWorkerForm(Object.assign({}, workerForm, { projectId: v })) }}>
                <SelectTrigger><SelectValue placeholder={isRtl ? 'اختر' : 'Select'} /></SelectTrigger>
                <SelectContent>
                  {projects.map(function(p) {
                    return <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  })}
                </SelectContent>
              </Select>
              {/* v18 FIX: تنبيه فارغة أيضاً في نافذة العمال بنفس آلية الإصلاح */}
              {!projectsLoading && projects.length === 0 && (
                <p className="mt-1 text-xs leading-5 text-amber-700 dark:text-amber-400">
                  {projectsError
                    ? (isRtl ? 'لم تُحمّل قائمة المشاريع — ' : 'Projects list failed to load — ')
                    : (isRtl ? 'لا توجد مشاريع مسجّلة بعد. ' : 'No projects registered yet. ')}
                  {projectsError && (
                    <button type="button" onClick={fetchProjects} className="font-medium underline">
                      {isRtl ? 'إعادة المحاولة' : 'Retry'}
                    </button>
                  )}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>{isRtl ? 'ملاحظات' : 'Notes'}</Label>
              <Textarea value={workerForm.notes} onChange={function(e) { setWorkerForm(Object.assign({}, workerForm, { notes: e.target.value })) }} rows={2} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={function() { setWorkerDialogOpen(false) }}>{isRtl ? 'إلغاء' : 'Cancel'}</Button>
              <Button type="submit">{isRtl ? 'حفظ' : 'Save'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Add Safety Report Sheet */}
      <Sheet open={sheetOpen} onOpenChange={function(open) { setSheetOpen(open); if (!open) setEditingSafety(null) }}>
        <SheetContent side={isRtl ? 'left' : 'right'} className="overflow-y-auto w-full sm:max-w-lg pb-[max(0px,env(safe-area-inset-bottom))]">
          <SheetHeader>
            <SheetTitle>{editingSafety ? (isRtl ? 'تعديل تقرير السلامة' : 'Edit Safety Report') : (isRtl ? 'إضافة تقرير سلامة جديد' : 'New Safety Report')}</SheetTitle>
            <SheetDescription>
              {editingSafety
                ? (isRtl ? 'عدّل قائمة التحقق والملاحظات — تُطبَّق التغييرات على التقرير اليومي المرتبط وتظهر تفاصيلها في الرقابة' : 'Edit the checklist and notes — changes apply to the linked daily report and are logged in Oversight')
                : (isRtl ? 'بعد حفظ تقرير السلامة، يمكنك إكمال باقي البيانات من قسم التقارير اليومية' : 'After saving, complete the rest in Daily Reports section')}
            </SheetDescription>
          </SheetHeader>

          {/* حشوة أفقية فعلية: كانت الحقول ملتصقة بحافة الشاشة على الهاتف */}
          <div className="mt-1 px-4 sm:px-6 pb-6 space-y-5">
            <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{isRtl ? 'المشروع' : 'Project'} *</Label>
                <Select value={form.projectId} onValueChange={function(v) { setForm({ ...form, projectId: v, driveLineId: '' }) }} disabled={!!editingSafety}>
                  <SelectTrigger disabled={!!editingSafety}><SelectValue placeholder={isRtl ? 'اختر' : 'Select'} /></SelectTrigger>
                  <SelectContent>
                    {projects.map(function(p) {
                      return <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    })}
                  </SelectContent>
                </Select>
                {/* v18 FIX: حالة فارغة مرئية مع إعادة محاولة — بدل قائمة صامتة فارغة */}
                {!projectsLoading && projects.length === 0 && (
                  <div className="mt-2 space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
                    <p className="text-xs leading-5 text-amber-700 dark:text-amber-400">
                      {projectsError
                        ? (isRtl
                            ? 'لم تُحمّل قائمة المشاريع — قد يكون السبب خطأ مؤقتاً أو نقص صلاحية.'
                            : 'Projects list failed to load — this may be a temporary error or a missing permission.')
                        : (isRtl
                            ? 'لا توجد مشاريع مسجّلة في النظام بعد.'
                            : 'No projects registered in the system yet.')}
                    </p>
                    {projectsError && (
                      <Button type="button" variant="outline" size="sm" onClick={fetchProjects} className="h-8 w-full gap-1.5">
                        <Loader2 className="h-3.5 w-3.5" />
                        {isRtl ? 'إعادة المحاولة' : 'Retry'}
                      </Button>
                    )}
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'التاريخ' : 'Date'} *</Label>
                <Input type="date" value={form.reportDate} onChange={function(e) { setForm({ ...form, reportDate: e.target.value }) }} disabled={!!editingSafety} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <GitBranch className="h-3.5 w-3.5" />
                {isRtl ? 'خط الحفر' : 'Drive Line'}
              </Label>
              <select
                value={form.driveLineId}
                onChange={function(e) { setForm({ ...form, driveLineId: e.target.value }) }}
                disabled={!!editingSafety}
                className={"w-full h-11 rounded-md border border-input bg-transparent px-3 py-2 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:border-ring transition-[color,box-shadow] " + (isRtl ? 'dir-rtl' : '') + (editingSafety ? ' opacity-70' : '')}
              >
                <option value="">{isRtl ? 'اختر' : 'Select'}</option>
                {/* v26: في وضع التعديل — خط الحفر الحالي للقراءة فقط إن لم يكن ضمن القائمة المحمّلة */}
                {editingSafety && editingSafety.dailyReport && editingSafety.dailyReport.driveLine && !driveLines.some(function(l) { return l.id === editingSafety.dailyReport.driveLine.id }) && (
                  <option key="editing-line" value={editingSafety.dailyReport.driveLine.id}>{'خط ' + (editingSafety.dailyReport.driveLine.lineNumber || '-') + ' - ' + (editingSafety.dailyReport.driveLine.startPoint || '-') + ' \u2192 ' + (editingSafety.dailyReport.driveLine.endPoint || '-')}</option>
                )}
                {driveLines.map(function(l) {
                  return <option key={l.id} value={l.id}>{(l.lineNumber || '-') + ' - ' + (l.startPoint || '-') + ' \u2192 ' + (l.endPoint || '-')}</option>
                })}
              </select>
              {driveLinesError ? (
                <div className="mt-2 space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
                  <p className="text-xs leading-5 text-amber-700 dark:text-amber-400">
                    {isRtl
                      ? 'تعذّر تحميل خطوط الحفر لهذا المشروع — يرجى إعادة المحاولة.'
                      : 'Failed to load drive lines for this project — please retry.'}
                  </p>
                  <Button type="button" variant="outline" size="sm" onClick={function() { if (form.projectId) loadDriveLines(form.projectId) }} className="h-8 w-full gap-1.5">
                    <Loader2 className="h-3.5 w-3.5" />
                    {isRtl ? 'إعادة المحاولة' : 'Retry'}
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground mt-1">
                  {!form.projectId
                    ? (isRtl
                        ? 'اختر المشروع أولاً لعرض خطوط الحفر الخاصة به'
                        : 'Select a project first to list its drive lines')
                    : driveLines.length === 0
                      ? (isRtl
                          ? 'لا توجد خطوط حفر بدأ العمل عليها في هذا المشروع بعد'
                          : 'No started drive lines in this project yet')
                      : (isRtl
                          ? 'تظهر هنا فقط خطوط الحفر التي بدأ العمل عليها فعلياً'
                          : 'Only drive lines that have actually started are listed')}
                </p>
              )}
              {editingSafety && (
                <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                  <Lock className="h-3 w-3 shrink-0" />
                  {isRtl ? 'بيانات التعريف (المشروع/التاريخ/خط الحفر) للقراءة فقط في وضع التعديل' : 'Identity fields (project/date/drive line) are read-only when editing'}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-base font-semibold">
                {isRtl ? 'قائمة التحقق' : 'Safety Checklist'}
              </Label>
              <div className="flex items-center gap-2 mb-2">
                <Progress value={formCompliance} className="h-2 flex-1" />
                <span className="text-sm font-medium">{formPassed}/15</span>
              </div>
              {/* مربعات تحديد كبيرة وصفوف نقر واسعة (60px) — مريحة في الميدان */}
              <div className="grid grid-cols-1 min-[480px]:grid-cols-2 gap-2">
                {checklistItems.map(function(item) {
                  var isChecked = !!form[item.key as keyof typeof form]
                  return (
                    <label
                      key={item.key}
                      className={cn(
                        'checklist-row flex items-center gap-3.5 lg:gap-3 p-3.5 lg:p-3 min-h-[60px] lg:min-h-0 rounded-xl border-2 cursor-pointer transition-all',
                        isChecked
                          ? 'border-primary bg-accent/50 shadow-sm'
                          : 'border-border bg-card hover:bg-muted/60 active:bg-muted'
                      )}
                    >
                      <Checkbox
                        className="checkbox-lg shrink-0"
                        checked={isChecked}
                        onCheckedChange={function(checked) {
                          var updated = Object.assign({}, form)
                          updated[item.key] = !!checked
                          setForm(updated)
                        }}
                      />
                      <span className={cn('text-[15px] leading-snug font-medium flex-1', isChecked ? 'text-foreground' : 'text-foreground/80')}>
                        {isRtl ? item.ar : item.en}
                      </span>
                      {isChecked && <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />}
                    </label>
                  )
                })}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>{isRtl ? 'الملاحظات' : 'Observations'}</Label>
              <Textarea
                value={form.observations}
                onChange={function(e) { setForm({ ...form, observations: e.target.value }) }}
                rows={3}
                placeholder={isRtl ? 'ملاحظات عامة...' : 'General observations...'}
              />
            </div>

            <div className="space-y-1.5">
              <Label>{isRtl ? 'المخالفات' : 'Violations'}</Label>
              <Textarea
                value={form.violations}
                onChange={function(e) { setForm({ ...form, violations: e.target.value }) }}
                rows={2}
                placeholder={isRtl ? 'أي مخالفات مرصودة...' : 'Any violations noted...'}
              />
            </div>

            <div className="space-y-1.5">
              <Label>{isRtl ? 'نوع الحادث' : 'Incident Type'}</Label>
              <Select value={form.incidentType} onValueChange={function(v) { setForm({ ...form, incidentType: v }) }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.keys(incidentLabels).map(function(key) {
                    var val = incidentLabels[key]
                    return <SelectItem key={key} value={key}>{isRtl ? val.ar : val.en}</SelectItem>
                  })}
                </SelectContent>
              </Select>
            </div>

            {form.incidentType !== 'none' && (
              <div className="space-y-1.5">
                <Label>{isRtl ? 'وصف الحادث' : 'Incident Description'}</Label>
                <Textarea
                  value={form.incidentDescription}
                  onChange={function(e) { setForm({ ...form, incidentDescription: e.target.value }) }}
                  rows={3}
                  placeholder={isRtl ? 'وصف تفصيلي للحادث...' : 'Detailed incident description...'}
                />
              </div>
            )}

            {/* زر الحفظ ثابت أسفل النافذة أثناء التمرير — سهل الوصول بالإبهام */}
            <div className="sticky bottom-0 -mx-4 sm:-mx-6 px-4 sm:px-6 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] bg-background/95 backdrop-blur border-t border-border/60 rounded-b-lg">
              <Button onClick={handleSave} disabled={saving} className="w-full h-12 text-[15px]">
                {saving ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <>
                    <ShieldCheck className="h-5 w-5 ml-2" />
                    {editingSafety ? (isRtl ? 'حفظ التعديلات' : 'Save Changes') : (isRtl ? 'حفظ تقرير السلامة' : 'Save Safety Report')}
                  </>
                )}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* v27: نافذة تعديل المشروع وخط الحفر — تنقل تقرير السلامة والتقرير اليومي المرتبط معاً */}
      <Dialog open={reassignOpen} onOpenChange={function(open) { setReassignOpen(open); if (!open) setReassignSafety(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-primary" />
              {isRtl ? 'تعديل المشروع وخط الحفر' : 'Change Project & Drive Line'}
            </DialogTitle>
            <DialogDescription>
              {isRtl
                ? 'انقل تقرير السلامة والتقرير اليومي المرتبط به إلى مشروع أو خط حفر آخر — يُعاد حساب الإيراد والتقدم تلقائياً وتُوثَّق التغييرات في الرقابة'
                : 'Move the safety report and its linked daily report to another project or drive line — revenue and progress are recalculated and logged'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="p-3 rounded-lg bg-muted/50 text-sm space-y-1">
              <p className="text-xs text-muted-foreground">{isRtl ? 'الإسناد الحالي' : 'Current assignment'}</p>
              <p className="font-medium">{reassignSafety && reassignSafety.project ? reassignSafety.project.name : '-'}</p>
              <p className="text-xs text-muted-foreground">
                {reassignSafety && reassignSafety.dailyReport && reassignSafety.dailyReport.driveLine
                  ? reassignLineLabel(reassignSafety.dailyReport.driveLine, isRtl)
                  : (isRtl ? 'بدون خط حفر' : 'No drive line')}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>{isRtl ? 'المشروع الجديد' : 'New Project'} *</Label>
              <Select value={reassignProjectId} onValueChange={function(v) { setReassignProjectId(v); setReassignLineId(''); loadReassignLines(v) }}>
                <SelectTrigger><SelectValue placeholder={isRtl ? 'اختر' : 'Select'} /></SelectTrigger>
                <SelectContent>
                  {projects.map(function(p) {
                    return <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  })}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{isRtl ? 'خط الحفر الجديد' : 'New Drive Line'}</Label>
              {reassignLinesLoading ? (
                <div className="h-10 flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {isRtl ? 'جارٍ التحميل...' : 'Loading...'}
                </div>
              ) : (
                <Select value={reassignLineId || 'none'} onValueChange={function(v) { setReassignLineId(v === 'none' ? '' : v) }}>
                  <SelectTrigger><SelectValue placeholder={isRtl ? 'اختر' : 'Select'} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{isRtl ? 'بدون خط حفر' : 'No drive line'}</SelectItem>
                    {reassignLines.map(function(l) {
                      return <SelectItem key={l.id} value={l.id}>{reassignLineLabel(l, isRtl)}</SelectItem>
                    })}
                  </SelectContent>
                </Select>
              )}
              <p className="text-[11px] text-muted-foreground">
                {isRtl
                  ? 'تُعرض هنا كل خطوط المشروع (حتى غير المبدوءة) — إعادة الإسناد تصحيح إداري'
                  : 'All project lines are listed (even not started) — reassignment is an administrative correction'}
              </p>
            </div>
            {reassignSafety && reassignSafety.dailyReport && reassignSafety.dailyReport.status !== 'draft' && reassignSafety.dailyReport.status !== 'submitted' && (
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-700">
                {isRtl
                  ? 'هذا التقرير معتمد/مرفوض — تعديل الإسناد متاح للإدارة العليا ومدير النظام فقط ويُوثَّق في سجل الرقابة.'
                  : 'This report is approved/rejected — reassignment is restricted to top management & system admin and is fully audited.'}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={function() { setReassignOpen(false); setReassignSafety(null) }} disabled={reassignSaving}>
              {isRtl ? 'إلغاء' : 'Cancel'}
            </Button>
            <Button onClick={saveReassignSafety} disabled={reassignSaving || !reassignProjectId}>
              {reassignSaving && <Loader2 className="h-4 w-4 ml-2 animate-spin" />}
              {isRtl ? 'حفظ الإسناد الجديد' : 'Save New Assignment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

