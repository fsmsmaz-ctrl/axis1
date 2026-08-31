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
import { ShieldCheck, ShieldAlert, AlertTriangle, CheckCircle2, XCircle, Calendar, Plus, Loader2, Trash2, GitBranch, Users, Phone, Building2, Pencil } from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { authedFetch } from '@/lib/api-client'
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

const emptyForm = {
  projectId: '',
  driveLineId: '',
  reportDate: new Date().toISOString().split('T')[0],
  signedBy': '',
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
  const [driveLines, setDriveLines] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedProject, setSelectedProject] = useState<string>('all')
  const [sheetOpen, setSheetOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ ...emptyForm })

  // Workers state
  const [workers, setWorkers] = useState<any[]>([])
  const [workersLoading, setWorkersLoading] = useState(false)
  const [workerDialogOpen, setWorkerDialogOpen] = useState(false)
  const [editingWorker, setEditingWorker] = useState<any>(null)
  const [workerForm, setWorkerForm] = useState({ name: '', phone: '', contractorName: '', projectId: '', notes: '' })
  const driveLinesLoaded = useRef<string | null>(null)
  const language = useAppStore((s) => s.language)
  const setPage = useAppStore((s) => s.setPage)
  const isRtl = language === 'ar'
  const isAdmin = useAppStore((s) => s.user)?.email?.toLowerCase().trim() === 'admin@axis.om'

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

  async function fetchProjects() {
    try {
      var res = await authedFetch('/api/projects/list?_t=' + Date.now(), { cache: 'no-store' })
      if (!res.ok) { setProjects([]); return }
      var data = await res.json()
      setProjects(data.projects || [])
    } catch {
      setProjects([])
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

  useEffect(() => {
    fetchReports()
    fetchWorkers()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProject])

  // Load drive lines when project changes in the form
  useEffect(() => {
    if (!form.projectId) {
      setDriveLines([])
      driveLinesLoaded.current = null
      return
    }
    if (driveLinesLoaded.current === form.projectId) return
    driveLinesLoaded.current = form.projectId
    authedFetch('/api/drive-lines?projectId=' + form.projectId)
      .then(function(r) { return r.json() })
      .then(function(d) { setDriveLines(d.driveLines || []) })
      .catch(function() { setDriveLines([]) })
  }, [form.projectId])

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
        safetyData[item.key] = form[item.key as keyof typeof form]
      }
      safetyData.observations = form.observations || null
      safetyData.violations = form.violations || null
      safetyData.incidentType = form.incidentType
      safetyData.incidentDescription = form.incidentType !== 'none' ? (form.incidentDescription || null) : null

      var safetyRes = await authedFetch('/api/safety-inspection', {
        method: 'POST',
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

      toast.success(isRtl ? 'تم حفظ تقرير السلامة بنجاح' : 'Safety report saved successfully')
      setSheetOpen(false)
      setForm({ ...emptyForm, reportDate: new Date().toISOString().split('T')[0] })
      fetchReports()
    } catch (e: any) {
      toast.error(e.message || (isRtl ? 'حدث خطأ' : 'Error'))
    } finally {
      setSaving(false)
    }
  }

  function goToDailyReports() {
    setPage('dailyReports')
  }

  // Calculate stats
  var total = reports.length
  var incidents = reports.filter(function(r) { return r.incidentType && r.incidentType !== 'none' }).length

  // Calculate compliance average from unique dates only (avoid duplicates)
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

  // Form compliance
  var formPassed = checklistItems.filter(function(item) { return form[item.key as keyof typeof form] }).length
  var formCompliance = (formPassed / 15) * 100

  // Check if user already created a safety report today for the selected project
  // Only check when a specific project is selected (not 'all')
  var today = new Date().toISOString().split('T')[0]
  var todayReportExists = selectedProject !== 'all' && reports.some(function(r) {
    return r.projectId === selectedProject && r.reportDate && r.reportDate.split('T')[0] === today
  })

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
          driveLinesLoaded.current = null
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

      {loading ? (
        <div className="h-32 bg-muted animate-pulse rounded" />
      ) : reports.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <ShieldCheck className="h-12 w-12 mx-auto text-muted-foreground/50" />
            <p className="mt-3 text-muted-foreground">{isRtl ? 'لا توجد تقارير سلامة' : 'No safety reports'}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {reports.map(function(r) {
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
                    {isAdmin && (
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
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
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
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side={isRtl ? 'left' : 'right'} className="overflow-y-auto w-full sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>{isRtl ? 'إضافة تقرير سلامة جديد' : 'New Safety Report'}</SheetTitle>
            <SheetDescription>
              {isRtl ? 'بعد حفظ تقرير السلامة، يمكنك إكمال باقي البيانات من قسم التقارير اليومية' : 'After saving, complete the rest in Daily Reports section'}
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-5">
            {/* Project & Date */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{isRtl ? 'المشروع' : 'Project'} *</Label>
                <Select value={form.projectId} onValueChange={function(v) { setForm({ ...form, projectId: v, driveLineId: '' }) }}>
                  <SelectTrigger><SelectValue placeholder={isRtl ? 'اختر' : 'Select'} /></SelectTrigger>
                  <SelectContent>
                    {projects.map(function(p) {
                      return <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    })}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'التاريخ' : 'Date'} *</Label>
                <Input type="date" value={form.reportDate} onChange={function(e) { setForm({ ...form, reportDate: e.target.value }) }} />
              </div>
            </div>

            {/* Drive Line */}
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <GitBranch className="h-3.5 w-3.5" />
                {isRtl ? 'خط الحفر' : 'Drive Line'}
              </Label>
              <select
                value={form.driveLineId}
                onChange={function(e) { setForm({ ...form, driveLineId: e.target.value }) }}
                className={"w-full h-9 rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:border-ring transition-[color,box-shadow] " + (isRtl ? 'dir-rtl' : '')}
              >
                <option value="">{isRtl ? 'اختر' : 'Select'}</option>
                {driveLines.map(function(l) {
                  return <option key={l.id} value={l.id}>{(l.lineNumber || '-') + ' - ' + (l.startPoint || '-') + ' → ' + (l.endPoint || '-')}</option>
                })}
              </select>
            </div>

            {/* Checklist */}
            <div className="space-y-2">
              <Label className="text-base font-semibold">
                {isRtl ? 'قائمة التحقق' : 'Safety Checklist'}
              </Label>
              <div className="flex items-center gap-2 mb-2">
                <Progress value={formCompliance} className="h-2 flex-1" />
                <span className="text-sm font-medium">{formPassed}/15</span>
              </div>
              <div className="grid grid-cols-1 gap-1.5">
                {checklistItems.map(function(item) {
                  return (
                    <label
                      key={item.key}
                      className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 cursor-pointer transition"
                    >
                      <Checkbox
                        checked={form[item.key as keyof typeof form] as boolean}
                        onCheckedChange={function(checked) {
                          var updated = Object.assign({}, form)
                          updated[item.key] = !!checked
                          setForm(updated)
                        }}
                      />
                      <span className="text-sm">{isRtl ? item.ar : item.en}</span>
                    </label>
                  )
                })}
              </div>
            </div>

            {/* Observations & Violations */}
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

            {/* Incident type */}
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

            {/* Save button */}
            <Button onClick={handleSave} disabled={saving} className="w-full h-11">
              {saving ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  <ShieldCheck className="h-4 w-4 ml-2" />
                  {isRtl ? 'حفظ تقرير السلامة' : 'Save Safety Report'}
                </>
              )}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
