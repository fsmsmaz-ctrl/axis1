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
import { ShieldCheck, ShieldAlert, AlertTriangle, CheckCircle2, XCircle, Calendar, Plus, Loader2, Trash2, GitBranch } from 'lucide-react'
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
      var res = await authedFetch('/api/projects/list?_t=' + Date.now())
      if (!res.ok) { setProjects([]); return }
      var data = await res.json()
      setProjects(data.projects || [])
    } catch {
      setProjects([])
    }
  }

  useEffect(() => {
    fetchReports()
    fetchProjects()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    fetchReports()
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
        safetyData[item.key] = !!form[item.key as keyof typeof form]
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
  var formPassed = checklistItems.filter(function(item) { return !!form[item.key as keyof typeof form] }).length
  var formCompliance = (formPassed / 15) * 100

  // Check if user already created a safety report today for the selected project
  var today = new Date().toISOString().split('T')[0]
  var todayReportExists = selectedProject !== 'all' && reports.some(function(r) {
    return r.projectId === selectedProject && r.reportDate && r.reportDate.split('T')[0] === today
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">{isRtl ? 'السلامة' : 'Safety'}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isRtl ? 'تقارير السلامة اليومية والمخاطر' : 'Daily safety reports and hazards'}
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
                  return <option key={l.id} value={l.id}>{(l.lineNumber || '-') + ' - ' + (l.startPoint || '-') + ' \u2192 ' + (l.endPoint || '-')}</option>
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
                        checked={!!form[item.key as keyof typeof form]}
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
