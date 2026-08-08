'use client'

import { useEffect, useMemo, useState, useRef } from 'react'
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
  FileText, Calendar,
  ShieldCheck, CheckCircle2, Eye, Check, X, Pencil
} from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { authedFetch } from '@/lib/api-client'
import { toast } from 'sonner'

var statusLabels: Record<string, { ar: string; en: string; color: string }> = {
  draft: { ar: 'مسودة', en: 'Draft', color: 'secondary' },
  submitted: { ar: 'مرسل', en: 'Submitted', color: 'default' },
  approved: { ar: 'معتمد', en: 'Approved', color: 'default' },
}

var weatherLabels: Record<string, { ar: string; en: string }> = {
  sunny: { ar: 'مشمس', en: 'Sunny' },
  cloudy: { ar: 'غائم', en: 'Cloudy' },
  rainy: { ar: 'ممطر', en: 'Rainy' },
  windy: { ar: 'عاصف', en: 'Windy' },
}

function getStatusInfo(status: string) {
  return statusLabels[status] || { ar: status || '-', en: status || '-', color: 'secondary' }
}

export default function DailyReportsPage() {
  const [reports, setReports] = useState<any[]>([])
  const [projects, setProjects] = useState<any[]>([])
  const [driveLines, setDriveLines] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedProject, setSelectedProject] = useState<string>('all')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingReportId, setEditingReportId] = useState<string | null>(null)
  const [viewReport, setViewReport] = useState<any | null>(null)
  const [viewDialogOpen, setViewDialogOpen] = useState(false)
  const [existingSafetyLoaded, setExistingSafetyLoaded] = useState(false)
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const driveLinesLoaded = useRef<string | null>(null)
  const language = useAppStore((s) => s.language)
  const token = useAppStore((s) => s.token)
  const user = useAppStore((s) => s.user)
  const isRtl = language === 'ar'

  const [formData, setFormData] = useState({
    projectId: '', driveLineId: '', reportDate: new Date().toISOString().split('T')[0],
    weather: 'sunny', workStartTime: '06:30', workEndTime: '17:00',
    operatingHours: '8.5', stoppageHours: '0', stoppageReason: '',
    workersCount: '12', attendees: '', startReading: '', endReading: '',
    soilExcavated: 'mixed', pipesInstalled: '0', productionNotes: '',
    problems: '',
  })

  const [safety, setSafety] = useState({
    ppeAvailable: false, helmetCheck: false, bootsCheck: false, glovesCheck: false,
    glassesCheck: false, workAreaCheck: false, barriersCheck: false, shaftCheck: false,
    ventilationCheck: false, electricalCheck: false, craneCheck: false, hydraulicCheck: false,
    fireExtinguishers: false, workPermit: false, toolboxTalk: false,
    hazards: '', observations: '', violations: '', incidentType: 'none', incidentDescription: '',
  })

  async function fetchReports() {
    setLoading(true)
    try {
      var params = new URLSearchParams()
      if (selectedProject !== 'all') params.set('projectId', selectedProject)
      params.set('limit', '100')
      var res = await authedFetch('/api/daily-reports?' + params.toString())
      var data = await res.json()
      setReports(data.reports || [])
    } catch {
      setReports([])
    }
    setLoading(false)
  }

  async function fetchProjects() {
    try {
      var res = await authedFetch('/api/projects/list?_t=' + Date.now(), { cache: 'no-store' })
      var data = await res.json()
      setProjects(data.projects || [])
    } catch {
      setProjects([])
    }
  }

  useEffect(function() {
    if (!token) return
    fetchReports()
    fetchProjects()
  }, [selectedProject, token])

  useEffect(function() {
    if (!formData.projectId) {
      setDriveLines([])
      driveLinesLoaded.current = null
      return
    }
    // Skip if we already loaded drive lines for this project (e.g. from openEditReport)
    if (driveLinesLoaded.current === formData.projectId) return
    driveLinesLoaded.current = formData.projectId
    authedFetch('/api/drive-lines?projectId=' + formData.projectId)
      .then(function(r) { return r.json() })
      .then(function(d) { setDriveLines(d.driveLines || []) })
      .catch(function() { setDriveLines([]) })
  }, [formData.projectId])

  async function openEditReport(report: any) {
    setEditingReportId(report.id)
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

    // Load existing safety data if present
    if (report.safety) {
      setSafety({
        ppeAvailable: !!report.safety.ppeAvailable,
        helmetCheck: !!report.safety.helmetCheck,
        bootsCheck: !!report.safety.bootsCheck,
        glovesCheck: !!report.safety.glovesCheck,
        glassesCheck: !!report.safety.glassesCheck,
        workAreaCheck: !!report.safety.workAreaCheck,
        barriersCheck: !!report.safety.barriersCheck,
        shaftCheck: !!report.safety.shaftCheck,
        ventilationCheck: !!report.safety.ventilationCheck,
        electricalCheck: !!report.safety.electricalCheck,
        craneCheck: !!report.safety.craneCheck,
        hydraulicCheck: !!report.safety.hydraulicCheck,
        fireExtinguishers: !!report.safety.fireExtinguishers,
        workPermit: !!report.safety.workPermit,
        toolboxTalk: !!report.safety.toolboxTalk,
        hazards: report.safety.hazards || '',
        observations: report.safety.observations || '',
        violations: report.safety.violations || '',
        incidentType: report.safety.incidentType || 'none',
        incidentDescription: report.safety.incidentDescription || '',
      })
      setExistingSafetyLoaded(true)
    } else {
      setSafety({
        ppeAvailable: false, helmetCheck: false, bootsCheck: false, glovesCheck: false,
        glassesCheck: false, workAreaCheck: false, barriersCheck: false, shaftCheck: false,
        ventilationCheck: false, electricalCheck: false, craneCheck: false, hydraulicCheck: false,
        fireExtinguishers: false, workPermit: false, toolboxTalk: false,
        hazards: '', observations: '', violations: '', incidentType: 'none', incidentDescription: '',
      })
      setExistingSafetyLoaded(false)
    }

    // Load drive lines for the project (mark as loaded so useEffect skips)
    if (report.projectId) {
      driveLinesLoaded.current = report.projectId
      try {
        var dlRes = await authedFetch('/api/drive-lines?projectId=' + report.projectId)
        var dlData = await dlRes.json()
        setDriveLines(dlData.driveLines || [])
      } catch { setDriveLines([]) }
    }

    setDialogOpen(true)
  }

  var safetyChecklistItems = useMemo(function() {
    return [
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
      { key: 'hydraulicCheck', label: isRtl ? 'فحص نظام الهيدرولك' : 'Hydraulic system check' },
      { key: 'fireExtinguishers', label: isRtl ? 'توفر طفايات الحريق' : 'Fire extinguishers' },
      { key: 'workPermit', label: isRtl ? 'وجود تصريح العمل' : 'Work permit' },
      { key: 'toolboxTalk', label: isRtl ? 'اجتماع toolbox talk' : 'Toolbox talk' },
    ]
  }, [isRtl])

  var safetyPassedCount = safetyChecklistItems.filter(function(item) { return safety[item.key as keyof typeof safety] }).length
  var allSafetyPassed = safetyPassedCount === safetyChecklistItems.length

  async function handleSaveDraft() {
    if (!editingReportId || saving) return
    setSaving(true)
    try {
      var res = await authedFetch('/api/daily-reports/' + editingReportId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({}, formData, { status: 'draft' })),
      })
      if (res.ok) {
        toast.success(isRtl ? 'تم حفظ التقرير' : 'Report saved')
        setDialogOpen(false)
        setEditingReportId(null)
        setExistingSafetyLoaded(false)
        fetchReports()
      } else {
        var errData = await res.json().catch(function() { return {} })
        toast.error(errData.message || (isRtl ? 'فشل حفظ التقرير' : 'Failed to save report'))
      }
    } catch {
      toast.error(isRtl ? 'حدث خطأ' : 'Error')
    } finally {
      setSaving(false)
    }
  }

  function askSubmitReport() {
    setConfirmDialogOpen(true)
  }

  async function confirmSubmitReport() {
    setConfirmDialogOpen(false)
    if (!editingReportId || saving) return
    setSaving(true)
    try {
      var res = await authedFetch('/api/daily-reports/' + editingReportId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({}, formData, { status: 'submitted' })),
      })
      if (res.ok) {
        toast.success(isRtl ? 'تم رفع التقرير بنجاح' : 'Report submitted successfully')
        setDialogOpen(false)
        setEditingReportId(null)
        setExistingSafetyLoaded(false)
        fetchReports()
      } else {
        var errData = await res.json().catch(function() { return {} })
        toast.error(errData.message || (isRtl ? 'فشل رفع التقرير' : 'Failed to submit report'))
      }
    } catch {
      toast.error(isRtl ? 'حدث خطأ' : 'Error')
    } finally {
      setSaving(false)
    }
  }

  async function approveReport(id: string) {
    var res = await authedFetch('/api/daily-reports/' + id + '/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve' }),
    })
    if (res.ok) {
      toast.success(isRtl ? 'تم الاعتماد' : 'Approved')
      fetchReports()
    }
  }

  async function viewReportDetails(report: any) {
    setViewReport(report)
    setViewDialogOpen(true)
    try {
      var res = await authedFetch('/api/daily-reports/' + report.id)
      var data = await res.json()
      if (data.report) setViewReport(data.report)
    } catch {}
  }

  var canApprove = user?.role === 'project_manager' || user?.role === 'top_management'
  var canEditOthers = user?.role === 'top_management' || user?.role === 'project_manager' || user?.role === 'site_engineer'

  // Check if a report came from safety section (has safety but minimal production data)
  function isFromSafetySection(r: any) {
    return r.safety && r.status === 'draft' && r.dailyMeters === 0 && r.workersCount === 0
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">{isRtl ? 'التقارير اليومية' : 'Daily Reports'}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isRtl ? (reports.length + ' تقرير') : (reports.length + ' reports')}
          </p>
        </div>
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
            <FileText className="h-12 w-12 mx-auto text-muted-foreground/50" />
            <p className="mt-3 text-muted-foreground">{isRtl ? 'لا توجد تقارير' : 'No reports'}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {reports.map(function(r) {
            var status = getStatusInfo(r.status)
            var fromSafety = isFromSafetySection(r)
            var safetyCompliance = 0
            if (r.safety) {
              var sPassed = safetyChecklistItems.filter(function(item) { return r.safety[item.key as keyof any] }).length
              safetyCompliance = (sPassed / 15) * 100
            }
            return (
              <Card key={r.id} className="hover:shadow-sm transition">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Calendar className="h-5 w-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-sm truncate">{(r.project && r.project.name) || '-'}</p>
                        <Badge variant="outline" className="text-xs">{(r.driveLine && r.driveLine.lineNumber) || '-'}</Badge>
                        <Badge variant={status.color as any} className="text-xs">
                          {isRtl ? status.ar : status.en}
                        </Badge>
                        {fromSafety && (
                          <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200">
                            {isRtl ? 'بحاجة إكمال' : 'Needs data'}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {r.reportDate ? new Date(r.reportDate).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '-'}
                        {' \u2022 '}
                        {r.workStartTime || '-'} - {r.workEndTime || '-'}
                        {' \u2022 '}
                        {r.workersCount || '0'} {isRtl ? 'عامل' : 'workers'}
                      </p>
                      {r.safety && (
                        <div className="flex items-center gap-1.5 mt-1">
                          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                          <Progress value={safetyCompliance} className="h-1 w-16" />
                          <span className="text-xs text-muted-foreground">{safetyCompliance.toFixed(0)}%</span>
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1">
                      {(r.status === 'draft' || (r.status === 'submitted' && (canEditOthers || r.createdById === user?.id))) && (
                        <Button variant="ghost" size="sm" onClick={function() { openEditReport(r) }}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                      <Button variant="outline" size="sm" onClick={function() { viewReportDetails(r) }}>
                        <Eye className="h-4 w-4" />
                      </Button>
                      {canApprove && r.status === 'submitted' && (
                        <Button variant="outline" size="sm" className="text-emerald-600" onClick={function() { approveReport(r.id) }}>
                          <Check className="h-4 w-4" />
                        </Button>
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
      <Dialog open={dialogOpen} onOpenChange={function(open) {
        setDialogOpen(open)
        if (!open) { setEditingReportId(null); setExistingSafetyLoaded(false) }
      }}>
        <DialogContent className="max-w-3xl sm:max-h-[85vh] max-h-[88vh] sm:top-[50%] sm:translate-y-[-50%] top-[2vh] translate-y-0 overflow-y-auto p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle>
              {editingReportId
                ? (isRtl ? 'تعديل التقرير اليومي' : 'Edit Daily Report')
                : (isRtl ? 'تقرير يومي جديد' : 'New Daily Report')}
            </DialogTitle>
            <DialogDescription>
              {editingReportId
                ? (existingSafetyLoaded
                  ? (isRtl ? 'بيانات السلامة محملة - أكمل باقي البيانات وارفع' : 'Safety data loaded - complete the rest and submit')
                  : (isRtl ? 'عدل بيانات التقرير' : 'Edit report details'))
                : (isRtl ? 'يجب إكمال فحص السلامة قبل حفظ التقرير' : 'Safety checklist must be completed first')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Safety status banner */}
            {existingSafetyLoaded && editingReportId && (
              <div className="p-3 rounded-lg border-2 bg-emerald-50 border-emerald-200">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                  <p className="font-medium text-sm text-emerald-700">
                    {isRtl ? 'فحص السلامة مكتمل (' + safetyPassedCount + '/15) - أكمل باقي بيانات التقرير' : 'Safety complete (' + safetyPassedCount + '/15) - fill in report data'}
                  </p>
                </div>
              </div>
            )}

            {!editingReportId && (
              <div className={'p-3 rounded-lg border-2 ' + (allSafetyPassed ? 'bg-emerald-50 border-emerald-200' : 'bg-orange-50 border-orange-200')}>
                <div className="flex items-center gap-2">
                  {allSafetyPassed ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                  ) : (
                    <ShieldCheck className="h-5 w-5 text-orange-600" />
                  )}
                  <div className="flex-1">
                    <p className={'font-medium text-sm ' + (allSafetyPassed ? 'text-emerald-700' : 'text-orange-700')}>
                      {allSafetyPassed
                        ? (isRtl ? 'اكتمل فحص السلامة - يمكنك حفظ التقرير' : 'Safety check complete - you can save the report')
                        : (isRtl ? ('فحص السلامة: ' + safetyPassedCount + '/' + safetyChecklistItems.length) : ('Safety checklist: ' + safetyPassedCount + '/' + safetyChecklistItems.length))
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

              {!editingReportId && (
                <TabsContent value="safety" className="space-y-4 mt-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {safetyChecklistItems.map(function(item) {
                      return (
                        <label
                          key={item.key}
                          className={'flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition ' +
                            (safety[item.key as keyof typeof safety]
                              ? 'bg-emerald-50 border-emerald-200'
                              : 'bg-card border-border hover:bg-muted/50')
                          }
                        >
                          <Checkbox
                            checked={safety[item.key as keyof typeof safety]}
                            onCheckedChange={function(checked) {
                              var updated = Object.assign({}, safety)
                              updated[item.key] = !!checked
                              setSafety(updated)
                            }}
                          />
                          <span className="text-sm">{item.label}</span>
                        </label>
                      )
                    })}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>{isRtl ? 'المخاطر' : 'Hazards'}</Label>
                      <Textarea
                        value={safety.hazards}
                        onChange={function(e) { setSafety({ ...safety, hazards: e.target.value }) }}
                        rows={2}
                        placeholder={isRtl ? 'اذكر أي مخاطر ملاحظة' : 'Any hazards observed'}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>{isRtl ? 'الملاحظات' : 'Observations'}</Label>
                      <Textarea
                        value={safety.observations}
                        onChange={function(e) { setSafety({ ...safety, observations: e.target.value }) }}
                        rows={2}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>{isRtl ? 'المخالفات' : 'Violations'}</Label>
                      <Textarea
                        value={safety.violations}
                        onChange={function(e) { setSafety({ ...safety, violations: e.target.value }) }}
                        rows={2}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>{isRtl ? 'نوع الحادث' : 'Incident Type'}</Label>
                      <Select value={safety.incidentType} onValueChange={function(v) { setSafety({ ...safety, incidentType: v }) }}>
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

              {/* Report Tab / Edit mode */}
              <TabsContent value="report" className={'space-y-4 ' + (editingReportId ? 'mt-0' : 'mt-4')}>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label>{isRtl ? 'المشروع' : 'Project'} *</Label>
                        <Select value={formData.projectId} onValueChange={function(v) { setFormData({ ...formData, projectId: v, driveLineId: '' }) }}>
                          <SelectTrigger><SelectValue placeholder={isRtl ? 'اختر' : 'Select'} /></SelectTrigger>
                          <SelectContent>
                            {projects.map(function(p) {
                              return <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                            })}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label>{isRtl ? 'خط الحفر' : 'Drive Line'}</Label>
                        <select
                          value={formData.driveLineId}
                          onChange={function(e) { setFormData({ ...formData, driveLineId: e.target.value }) }}
                          className={"w-full h-9 rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:border-ring transition-[color,box-shadow] " + (isRtl ? 'dir-rtl' : '')}
                        >
                          <option value="">{isRtl ? 'اختر' : 'Select'}</option>
                          {driveLines.map(function(l) {
                            return <option key={l.id} value={l.id}>{(l.lineNumber || '-') + ' - ' + (l.startPoint || '-') + ' → ' + (l.endPoint || '-')}</option>
                          })}
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <Label>{isRtl ? 'التاريخ' : 'Date'} *</Label>
                        <Input type="date" value={formData.reportDate} onChange={function(e) { setFormData({ ...formData, reportDate: e.target.value }) }} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>{isRtl ? 'الطقس' : 'Weather'}</Label>
                        <Select value={formData.weather} onValueChange={function(v) { setFormData({ ...formData, weather: v }) }}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="sunny">{isRtl ? 'مشمس' : 'Sunny'}</SelectItem>
                            <SelectItem value="cloudy">{isRtl ? 'غائم' : 'Cloudy'}</SelectItem>
                            <SelectItem value="rainy">{isRtl ? 'ممطر' : 'Rainy'}</SelectItem>
                            <SelectItem value="windy">{isRtl ? 'عاصف' : 'Windy'}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label>{isRtl ? 'بداية العمل' : 'Work Start'}</Label>
                        <Input type="time" value={formData.workStartTime} onChange={function(e) { setFormData({ ...formData, workStartTime: e.target.value }) }} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>{isRtl ? 'نهاية العمل' : 'Work End'}</Label>
                        <Input type="time" value={formData.workEndTime} onChange={function(e) { setFormData({ ...formData, workEndTime: e.target.value }) }} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>{isRtl ? 'ساعات التشغيل' : 'Operating Hours'}</Label>
                        <Input type="number" step="0.1" value={formData.operatingHours} onChange={function(e) { setFormData({ ...formData, operatingHours: e.target.value }) }} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>{isRtl ? 'ساعات التوقف' : 'Stoppage Hours'}</Label>
                        <Input type="number" step="0.1" value={formData.stoppageHours} onChange={function(e) { setFormData({ ...formData, stoppageHours: e.target.value }) }} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>{isRtl ? 'عدد العمال' : 'Workers Count'}</Label>
                        <Input type="number" value={formData.workersCount} onChange={function(e) { setFormData({ ...formData, workersCount: e.target.value }) }} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>{isRtl ? 'سبب التوقف' : 'Stoppage Reason'}</Label>
                        <Input value={formData.stoppageReason} onChange={function(e) { setFormData({ ...formData, stoppageReason: e.target.value }) }} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>{isRtl ? 'قراءة البداية (م)' : 'Start Reading (m)'}</Label>
                        <Input type="number" step="0.01" value={formData.startReading} onChange={function(e) { setFormData({ ...formData, startReading: e.target.value }) }} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>{isRtl ? 'قراءة النهاية (م)' : 'End Reading (m)'}</Label>
                        <Input type="number" step="0.01" value={formData.endReading} onChange={function(e) { setFormData({ ...formData, endReading: e.target.value }) }} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>{isRtl ? 'التربة المحفورة' : 'Soil Excavated'}</Label>
                        <Select value={formData.soilExcavated} onValueChange={function(v) { setFormData({ ...formData, soilExcavated: v }) }}>
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
                        <Input type="number" value={formData.pipesInstalled} onChange={function(e) { setFormData({ ...formData, pipesInstalled: e.target.value }) }} />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label>{isRtl ? 'ملاحظات الإنتاج' : 'Production Notes'}</Label>
                      <Textarea value={formData.productionNotes} onChange={function(e) { setFormData({ ...formData, productionNotes: e.target.value }) }} rows={2} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>{isRtl ? 'المشاكل' : 'Problems'}</Label>
                      <Textarea value={formData.problems} onChange={function(e) { setFormData({ ...formData, problems: e.target.value }) }} rows={2} />
                    </div>
              </TabsContent>
            </Tabs>
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={function() { setDialogOpen(false); setEditingReportId(null); setExistingSafetyLoaded(false) }}>
              {isRtl ? 'إلغاء' : 'Cancel'}
            </Button>
            <Button type="button" variant="outline" onClick={handleSaveDraft} disabled={!editingReportId || saving}>
              {saving
                ? <span className="h-4 w-4 ml-2 animate-spin rounded-full border-2 border-current border-t-transparent" />
                : <Pencil className="h-4 w-4 ml-2" />}
              {saving ? (isRtl ? 'جارٍ الحفظ...' : 'Saving...') : (isRtl ? 'حفظ (تعديل)' : 'Save (Edit)')}
            </Button>
            <Button type="button" onClick={askSubmitReport} disabled={!editingReportId || saving}>
              <Check className="h-4 w-4 ml-2" />
              {isRtl ? 'تسليم التقرير' : 'Submit Report'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Submit Confirmation Dialog */}
      <Dialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{isRtl ? 'تأكيد تسليم التقرير' : 'Confirm Submit'}</DialogTitle>
            <DialogDescription>
              {isRtl ? 'هل أنت متأكد من تسليم التقرير؟ لا يمكنك تعديل التقرير بعد التسليم.' : 'Are you sure you want to submit? You cannot edit the report after submission.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={function() { setConfirmDialogOpen(false) }}>
              <Pencil className="h-4 w-4 ml-2" />
              {isRtl ? 'تعديل' : 'Edit'}
            </Button>
            <Button onClick={confirmSubmitReport}>
              <Check className="h-4 w-4 ml-2" />
              {isRtl ? 'تسليم' : 'Submit'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Dialog */}
      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent className="max-w-3xl sm:max-h-[85vh] max-h-[88vh] sm:top-[50%] sm:translate-y-[-50%] top-[2vh] translate-y-0 overflow-y-auto p-4 sm:p-6">
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
  const isRtl = language === 'ar'

  var safetyChecks = report.safety ? [
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
    { label: isRtl ? 'الهيدرولك' : 'Hydraulic', ok: report.safety.hydraulicCheck },
    { label: isRtl ? 'طفايات الحريق' : 'Fire Ext.', ok: report.safety.fireExtinguishers },
    { label: isRtl ? 'تصريح العمل' : 'Work Permit', ok: report.safety.workPermit },
    { label: isRtl ? 'Toolbox Talk' : 'Toolbox Talk', ok: report.safety.toolboxTalk },
  ] : []

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 text-sm">
        <Detail label={isRtl ? 'المشروع' : 'Project'} value={(report.project && report.project.name) || '-'} />
        <Detail label={isRtl ? 'خط الحفر' : 'Drive Line'} value={(report.driveLine && report.driveLine.lineNumber) || '-'} />
        <Detail label={isRtl ? 'التاريخ' : 'Date'} value={report.reportDate ? new Date(report.reportDate).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US') : '-'} />
        <Detail label={isRtl ? 'الطقس' : 'Weather'} value={report.weather || '-'} />
        <Detail label={isRtl ? 'بداية العمل' : 'Start'} value={report.workStartTime || '-'} />
        <Detail label={isRtl ? 'نهاية العمل' : 'End'} value={report.workEndTime || '-'} />
        <Detail label={isRtl ? 'ساعات التشغيل' : 'Operating'} value={String(report.operatingHours || '0') + 'h'} />
        <Detail label={isRtl ? 'ساعات التوقف' : 'Stoppage'} value={String(report.stoppageHours || '0') + 'h'} />
        <Detail label={isRtl ? 'عدد العمال' : 'Workers'} value={String(report.workersCount || '0')} />
        <Detail label={isRtl ? 'الأنابيب' : 'Pipes'} value={String(report.pipesInstalled || '0')} />
        <Detail label={isRtl ? 'قراءة البداية' : 'Start Reading'} value={String(report.startReading || '0') + ' م'} />
        <Detail label={isRtl ? 'قراءة النهاية' : 'End Reading'} value={String(report.endReading || '0') + ' م'} />
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
            {safetyChecks.map(function(c, i) {
              return (
                <div key={i} className="flex items-center gap-1.5 text-xs p-1.5 rounded bg-muted/30">
                  {c.ok ? (
                    <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                  ) : (
                    <X className="h-3.5 w-3.5 text-red-500 shrink-0" />
                  )}
                  <span className={c.ok ? '' : 'text-red-500 line-through'}>{c.label}</span>
                </div>
              )
            })}
          </div>
          {report.safety.observations && (
            <p className="text-xs text-muted-foreground mt-2">{report.safety.observations}</p>
          )}
          {report.safety.violations && (
            <p className="text-xs text-orange-600 mt-1">{'\u26A0 '}{report.safety.violations}</p>
          )}
        </div>
      )}

      {report.costs && report.costs.length > 0 && (
        <div>
          <h4 className="font-semibold text-sm mb-2">{isRtl ? 'التكاليف' : 'Costs'}</h4>
          <div className="space-y-1">
            {report.costs.map(function(c: any) {
              return (
                <div key={c.id} className="flex justify-between text-sm p-2 rounded bg-muted/30">
                  <span>{c.description}</span>
                  <span className="font-medium">{c.amount} ر.ع</span>
                </div>
              )
            })}
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
