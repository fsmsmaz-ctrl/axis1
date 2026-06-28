'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Progress } from '@/components/ui/progress'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle
} from '@/components/ui/dialog'
import {
  Plus, FileText, Calendar, Users, Ruler, AlertTriangle,
  ShieldCheck, CheckCircle2, Clock, DollarSign, Eye, Check, X, ShieldAlert
} from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { authedFetch } from '@/lib/api-client'
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
  const [selectedProject, setSelectedProject] = useState<string>('all')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [viewReport, setViewReport] = useState<any | null>(null)
  const [viewDialogOpen, setViewDialogOpen] = useState(false)
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

  // Track draft reports (safety completed but no data yet) for each project+date
  const [draftReports, setDraftReports] = useState<any[]>([])

  async function fetchReports() {
    setLoading(true)
    const params = new URLSearchParams()
    if (selectedProject !== 'all') params.set('projectId', selectedProject)
    params.set('limit', '100')
    const res = await authedFetch('/api/daily-reports?' + params.toString())
    const data = await res.json()
    setReports(data.reports || [])
    setLoading(false)
  }

  async function fetchProjects() {
    const res = await authedFetch('/api/projects/list')
    const data = await res.json()
    setProjects(data.projects || [])
  }

  useEffect(() => {
    if (!token) return
    fetchReports()
    fetchProjects()
  }, [selectedProject, token])

  useEffect(() => {
    if (formData.projectId) {
      authedFetch(`/api/drive-lines?projectId=${formData.projectId}`)
        .then(r => r.json())
        .then(d => setDriveLines(d.driveLines || []))
    }
  }, [formData.projectId])

  // When project or date changes in the form, check if there's a draft report with safety
  useEffect(() => {
    if (!formData.projectId || !formData.reportDate) return
    const dateStart = new Date(formData.reportDate)
    dateStart.setHours(0, 0, 0, 0)
    const dateEnd = new Date(formData.reportDate)
    dateEnd.setHours(23, 59, 59, 999)

    authedFetch('/api/daily-reports?' + new URLSearchParams({
      projectId: formData.projectId,
      limit: '200',
    }).toString())
      .then(r => r.json())
      .then(data => {
        const drafts = (data.reports || []).filter((r: any) => {
          const d = new Date(r.reportDate)
          return r.status === 'draft' && r.safety && d >= dateStart && d <= dateEnd
        })
        setDraftReports(drafts)
      })
      .catch(() => setDraftReports([]))
  }, [formData.projectId, formData.reportDate, token])

  const activeDraft = draftReports.length > 0 ? draftReports[0] : null

  function openCreate() {
    setFormData({
      projectId: projects[0]?.id || '', driveLineId: '', reportDate: new Date().toISOString().split('T')[0],
      weather: 'sunny', workStartTime: '06:30', workEndTime: '17:00',
      operatingHours: '8.5', stoppageHours: '0', stoppageReason: '',
      workersCount: '12', attendees: '', startReading: '', endReading: '',
      soilExcavated: 'mixed', pipesInstalled: '0', productionNotes: '',
      problems: '',
    })
    setDraftReports([])
    setDialogOpen(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    // Check if there's a completed safety inspection for this project+date
    if (!activeDraft || !activeDraft.safety) {
      toast.error(isRtl ? 'يجب إكمال فحص السلامة أولاً من قسم السلامة قبل إنشاء التقرير' : 'Complete safety inspection from the Safety section first')
      return
    }

    try {
      // Update the existing draft report with data
      const res = await authedFetch(`/api/daily-reports/${activeDraft.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formData, status: 'submitted' }),
      })
      const data = await res.json()

      if (!res.ok) {
        toast.error(isRtl ? 'فشل حفظ التقرير' : 'Failed to save report')
        return
      }

      toast.success(isRtl ? 'تم حفظ التقرير بنجاح' : 'Report saved successfully')
      setDialogOpen(false)
      fetchReports()
    } catch {
      toast.error(isRtl ? 'حدث خطأ' : 'Error')
    }
  }

  async function approveReport(id: string, action: 'approve' | 'reject') {
    const res = await fetch(`/api/daily-reports/${id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    if (res.ok) {
      toast.success(action === 'approve' ? (isRtl ? 'تم الاعتماد' : 'Approved') : (isRtl ? 'تم الرفض' : 'Rejected'))
      fetchReports()
    }
  }

  async function viewReportDetails(report: any) {
    setViewReport(report)
    setViewDialogOpen(true)
    const res = await fetch(`/api/daily-reports/${report.id}`)
    const data = await res.json()
    setViewReport(data.report)
  }

  const canApprove = user?.role === 'project_manager' || user?.role === 'top_management'

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">{isRtl ? 'التقارير اليومية' : 'Daily Reports'}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isRtl ? `${reports.length} تقرير` : `${reports.length} reports`}
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 ml-2" />
          {isRtl ? 'تقرير جديد' : 'New Report'}
        </Button>
      </div>

      {/* Info banner */}
      <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 flex items-center gap-2">
        <ShieldAlert className="h-5 w-5 text-blue-600 shrink-0" />
        <p className="text-sm text-blue-700">
          {isRtl
            ? 'ملاحظة: يجب إنشاء فحص السلامة أولاً من قسم السلامة قبل تعبئة بيانات التقرير اليومي.'
            : 'Note: Safety inspection must be completed first from the Safety section before filling daily report data.'
          }
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
          {reports.map((r) => {
            const status = statusLabels[r.status]
            const isDraftOnly = r.status === 'draft' && r.safety && !r.workStartTime
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
                        {isDraftOnly && (
                          <Badge variant="outline" className="text-xs text-orange-600 border-orange-300">
                            {isRtl ? 'سلامة فقط' : 'Safety Only'}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {new Date(r.reportDate).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                        {r.workStartTime && (
                          <>
                            {' • '}
                            {r.workStartTime} - {r.workEndTime}
                            {' • '}
                            {r.workersCount} {isRtl ? 'عامل' : 'workers'}
                          </>
                        )}
                      </p>
                    </div>
                    {!isDraftOnly && (
                      <div className="flex items-center gap-4 text-sm">
                        <div className="text-center">
                          <p className="text-xs text-muted-foreground">{isRtl ? 'الإنتاج' : 'Production'}</p>
                          <p className="font-semibold">{r.dailyMeters} {isRtl ? 'م' : 'm'}</p>
                        </div>
                        <div className="text-center">
                          <p className="text-xs text-muted-foreground">{isRtl ? 'الإيراد' : 'Revenue'}</p>
                          <p className="font-semibold text-emerald-600">{r.dailyRevenue} {isRtl ? 'ر.ع' : 'OMR'}</p>
                        </div>
                      </div>
                    )}
                    <div className="flex gap-1">
                      <Button variant="outline" size="sm" onClick={() => viewReportDetails(r)}>
                        <Eye className="h-4 w-4" />
                      </Button>
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

      {/* Create/Update Report Dialog - NO safety tab */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isRtl ? 'بيانات التقرير اليومي' : 'Daily Report Data'}</DialogTitle>
            <DialogDescription>
              {isRtl
                ? 'تعبئة بيانات الإنتاج والعمل. يجب إكمال فحص السلامة من قسم السلامة أولاً.'
                : 'Fill in production and work data. Safety inspection must be completed from the Safety section first.'
              }
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Safety status indicator */}
            {activeDraft && activeDraft.safety ? (
              <div className="p-3 rounded-lg bg-emerald-50 border-2 border-emerald-200">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                  <p className="text-sm font-medium text-emerald-700">
                    {isRtl ? 'فحص السلامة مكتمل - يمكنك تعبئة بيانات التقرير' : 'Safety inspection complete - you can fill report data'}
                  </p>
                </div>
              </div>
            ) : (
              <div className="p-3 rounded-lg bg-orange-50 border-2 border-orange-200">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-orange-600 shrink-0" />
                  <p className="text-sm font-medium text-orange-700">
                    {isRtl
                      ? 'لم يتم إنشاء فحص السلامة بعد. يجب إنشاؤه من قسم السلامة لهذا المشروع والتاريخ.'
                      : 'Safety inspection not yet created. It must be created from the Safety section for this project and date.'
                    }
                  </p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{isRtl ? 'المشروع' : 'Project'} *</Label>
                <Select value={formData.projectId} onValueChange={(v) => setFormData({ ...formData, projectId: v, driveLineId: '' })}>
                  <SelectTrigger><SelectValue placeholder={isRtl ? 'اختر' : 'Select'} /></SelectTrigger>
                  <SelectContent>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'خط الحفر' : 'Drive Line'}</Label>
                <Select value={formData.driveLineId} onValueChange={(v) => setFormData({ ...formData, driveLineId: v })}>
                  <SelectTrigger><SelectValue placeholder={isRtl ? 'اختر' : 'Select'} /></SelectTrigger>
                  <SelectContent>
                    {driveLines.map((l) => (
                      <SelectItem key={l.id} value={l.id}>{l.lineNumber} - {l.startPoint} → {l.endPoint}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'التاريخ' : 'Date'} *</Label>
                <Input type="date" value={formData.reportDate} onChange={(e) => setFormData({ ...formData, reportDate: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'الطقس' : 'Weather'}</Label>
                <Select value={formData.weather} onValueChange={(v) => setFormData({ ...formData, weather: v })}>
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
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
              {isRtl ? 'إلغاء' : 'Cancel'}
            </Button>
            <Button type="button" onClick={handleSubmit} disabled={!activeDraft || !activeDraft.safety}>
              {isRtl ? 'حفظ التقرير' : 'Save Report'}
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
      <div className="grid grid-cols-2 gap-3 text-sm">
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

      <div className="grid grid-cols-3 gap-2">
        <Stat label={isRtl ? 'إنتاج اليوم' : 'Daily Meters'} value={`${report.dailyMeters} م`} color="text-blue-600" />
        <Stat label={isRtl ? 'إجمالي الأمتار' : 'Total Meters'} value={`${report.totalMeters.toFixed(1)} م`} color="text-purple-600" />
        <Stat label={isRtl ? 'الإيراد اليومي' : 'Daily Revenue'} value={`${report.dailyRevenue} ر.ع`} color="text-emerald-600" />
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
