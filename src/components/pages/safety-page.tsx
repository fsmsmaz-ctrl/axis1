'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle
} from '@/components/ui/dialog'
import { ShieldCheck, ShieldAlert, AlertTriangle, CheckCircle2, XCircle, Calendar, Plus, Eye, Check, X } from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { authedFetch } from '@/lib/api-client'
import { toast } from 'sonner'

const incidentLabels: Record<string, { ar: string; en: string; color: string }> = {
  none: { ar: 'لا يوجد', en: 'None', color: 'secondary' },
  near_miss: { ar: 'Near miss', en: 'Near miss', color: 'default' },
  incident: { ar: 'حادث', en: 'Incident', color: 'destructive' },
  accident: { ar: 'إصابة', en: 'Accident', color: 'destructive' },
}

const weatherLabels: Record<string, { ar: string; en: string }> = {
  sunny: { ar: 'مشمس', en: 'Sunny' },
  cloudy: { ar: 'غائم', en: 'Cloudy' },
  rainy: { ar: 'ممطر', en: 'Rainy' },
  windy: { ar: 'عاصف', en: 'Windy' },
}

export default function SafetyPage() {
  const [reports, setReports] = useState<any[]>([])
  const [projects, setProjects] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedProject, setSelectedProject] = useState<string>('all')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [viewDialogOpen, setViewDialogOpen] = useState(false)
  const [viewReport, setViewReport] = useState<any | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const language = useAppStore((s) => s.language)
  const token = useAppStore((s) => s.token)
  const isRtl = language === 'ar'

  // Form state
  const [formData, setFormData] = useState({
    projectId: '',
    reportDate: new Date().toISOString().split('T')[0],
    weather: 'sunny',
  })

  const [safety, setSafety] = useState({
    ppeAvailable: false, helmetCheck: false, bootsCheck: false, glovesCheck: false,
    glassesCheck: false, workAreaCheck: false, barriersCheck: false, shaftCheck: false,
    ventilationCheck: false, electricalCheck: false, craneCheck: false, hydraulicCheck: false,
    fireExtinguishers: false, workPermit: false, toolboxTalk: false,
    hazards: '', observations: '', violations: '', incidentType: 'none', incidentDescription: '',
  })

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

  async function fetchReports() {
    setLoading(true)
    const params = new URLSearchParams()
    if (selectedProject !== 'all') params.set('projectId', selectedProject)
    params.set('limit', '100')
    const res = await authedFetch('/api/safety-inspection?' + params.toString())
    const data = await res.json()
    setReports(data.safetyReports || [])
    setLoading(false)
  }

  useEffect(() => {
    if (!token) return
    fetchReports()
    authedFetch('/api/projects/list').then(r => r.json()).then(d => setProjects(d.projects || []))
  }, [selectedProject, token])

  function openCreate() {
    setFormData({
      projectId: projects[0]?.id || '',
      reportDate: new Date().toISOString().split('T')[0],
      weather: 'sunny',
    })
    setSafety({
      ppeAvailable: false, helmetCheck: false, bootsCheck: false, glovesCheck: false,
      glassesCheck: false, workAreaCheck: false, barriersCheck: false, shaftCheck: false,
      ventilationCheck: false, electricalCheck: false, craneCheck: false, hydraulicCheck: false,
      fireExtinguishers: false, workPermit: false, toolboxTalk: false,
      hazards: '', observations: '', violations: '', incidentType: 'none', incidentDescription: '',
    })
    setDialogOpen(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!allSafetyPassed) {
      toast.error(isRtl ? 'يجب إكمال جميع فحوصات السلامة أولاً' : 'Complete all safety checks first')
      return
    }

    if (!formData.projectId) {
      toast.error(isRtl ? 'يجب اختيار المشروع' : 'Select a project')
      return
    }

    setSubmitting(true)
    try {
      const res = await authedFetch('/api/safety-inspection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formData, ...safety }),
      })

      const data = await res.json()

      if (!res.ok) {
        if (data.error === 'duplicate') {
          toast.error(isRtl ? 'يوجد بالفعل فحص سلامة لهذا المشروع في هذا التاريخ' : 'Safety inspection already exists for this project and date')
        } else {
          toast.error(data.message || (isRtl ? 'فشل إنشاء فحص السلامة' : 'Failed to create safety inspection'))
        }
        return
      }

      toast.success(isRtl ? 'تم إنشاء فحص السلامة بنجاح' : 'Safety inspection created successfully')
      setDialogOpen(false)
      fetchReports()
    } catch {
      toast.error(isRtl ? 'حدث خطأ' : 'Error')
    } finally {
      setSubmitting(false)
    }
  }

  function viewDetails(report: any) {
    setViewReport(report)
    setViewDialogOpen(true)
  }

  // Calculate stats
  const total = reports.length
  const incidents = reports.filter(r => r.incidentType && r.incidentType !== 'none').length
  const avgCompliance = total > 0
    ? reports.reduce((sum, r) => {
        const checks = [
          r.ppeAvailable, r.helmetCheck, r.bootsCheck,
          r.glovesCheck, r.glassesCheck, r.workAreaCheck,
          r.barriersCheck, r.shaftCheck, r.ventilationCheck,
          r.electricalCheck, r.craneCheck, r.hydraulicCheck,
          r.fireExtinguishers, r.workPermit, r.toolboxTalk,
        ]
        const passed = checks.filter(Boolean).length
        return sum + (passed / 15) * 100
      }, 0) / total
    : 0

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">{isRtl ? 'السلامة' : 'Safety'}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isRtl ? 'تقارير فحص السلامة اليومية والمخاطر' : 'Daily safety inspection reports and hazards'}
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 ml-2" />
          {isRtl ? 'إنشاء فحص سلامة' : 'New Safety Inspection'}
        </Button>
      </div>

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
            <ShieldCheck className="h-12 w-12 mx-auto text-muted-foreground/50" />
            <p className="mt-3 text-muted-foreground">{isRtl ? 'لا توجد تقارير سلامة' : 'No safety reports'}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {reports.map((r) => {
            const checks = [
              r.ppeAvailable, r.helmetCheck, r.bootsCheck,
              r.glovesCheck, r.glassesCheck, r.workAreaCheck,
              r.barriersCheck, r.shaftCheck, r.ventilationCheck,
              r.electricalCheck, r.craneCheck, r.hydraulicCheck,
              r.fireExtinguishers, r.workPermit, r.toolboxTalk,
            ]
            const passed = checks.filter(Boolean).length
            const compliance = (passed / 15) * 100
            const incident = incidentLabels[r.incidentType || 'none']
            const hasIncident = r.incidentType && r.incidentType !== 'none'
            const hasDailyData = r.dailyReport && r.dailyReport.status !== 'draft'

            return (
              <Card key={r.id} className={hasIncident ? 'border-destructive/30' : ''}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                      hasIncident ? 'bg-destructive/10' : compliance === 100 ? 'bg-emerald-50' : 'bg-orange-50'
                    }`}>
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
                        <p className="font-semibold text-sm">{r.project?.name}</p>
                        {hasIncident && (
                          <Badge variant={incident.color as any} className="text-xs">
                            {isRtl ? incident.ar : incident.en}
                          </Badge>
                        )}
                        {hasDailyData ? (
                          <Badge variant="default" className="text-xs bg-emerald-600">
                            {isRtl ? 'تقرير مكتمل' : 'Report Complete'}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs text-orange-600 border-orange-300">
                            {isRtl ? 'في انتظار بيانات التقرير' : 'Awaiting Report Data'}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mb-2">
                        {new Date(r.reportDate).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                        {' • '}
                        {isRtl ? 'موقّع من' : 'Signed by'}: {r.signedByUser?.name || r.signedBy || '-'}
                      </p>
                      <div className="flex items-center gap-2 mb-2">
                        <Progress value={compliance} className="h-1.5 flex-1" />
                        <span className="text-xs font-medium">{passed}/15</span>
                      </div>
                      {r.observations && (
                        <p className="text-xs text-muted-foreground">{r.observations}</p>
                      )}
                      {r.violations && (
                        <p className="text-xs text-orange-600 mt-1">{isRtl ? 'مخالفات: ' : 'Violations: '}{r.violations}</p>
                      )}
                      {r.incidentDescription && (
                        <p className="text-xs text-destructive mt-1">{isRtl ? 'حادث: ' : 'Incident: '}{r.incidentDescription}</p>
                      )}
                    </div>
                    <Button variant="outline" size="sm" onClick={() => viewDetails(r)}>
                      <Eye className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Create Safety Inspection Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isRtl ? 'إنشاء فحص سلامة جديد' : 'New Safety Inspection'}</DialogTitle>
            <DialogDescription>
              {isRtl ? 'أكمل جميع فحوصات السلامة ثم احفظ التقرير. يجب إنشاء فحص السلامة قبل تعبئة بيانات التقرير اليومي.' : 'Complete all safety checks then save. Safety inspection must be done before filling daily report data.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Project & Date Selection */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>{isRtl ? 'المشروع' : 'Project'} *</Label>
                <Select value={formData.projectId} onValueChange={(v) => setFormData({ ...formData, projectId: v })}>
                  <SelectTrigger><SelectValue placeholder={isRtl ? 'اختر' : 'Select'} /></SelectTrigger>
                  <SelectContent>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
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
            </div>

            {/* Safety progress banner */}
            <div className={`p-3 rounded-lg border-2 ${allSafetyPassed ? 'bg-emerald-50 border-emerald-200' : 'bg-orange-50 border-orange-200'}`}>
              <div className="flex items-center gap-2">
                {allSafetyPassed ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                ) : (
                  <ShieldCheck className="h-5 w-5 text-orange-600 shrink-0" />
                )}
                <div className="flex-1">
                  <p className={`font-medium text-sm ${allSafetyPassed ? 'text-emerald-700' : 'text-orange-700'}`}>
                    {allSafetyPassed
                      ? (isRtl ? 'اكتمل فحص السلامة - يمكنك حفظ التقرير' : 'Safety check complete - you can save')
                      : (isRtl ? `فحص السلامة: ${safetyPassedCount}/${safetyChecklistItems.length}` : `Safety checklist: ${safetyPassedCount}/${safetyChecklistItems.length}`)
                    }
                  </p>
                </div>
                <Progress value={(safetyPassedCount / safetyChecklistItems.length) * 100} className="w-24 h-2 shrink-0" />
              </div>
            </div>

            {/* Safety Checklist */}
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
                    checked={safety[item.key as keyof typeof safety]}
                    onCheckedChange={(checked) => {
                      setSafety({ ...safety, [item.key]: !!checked })
                    }}
                  />
                  <span className="text-sm">{item.label}</span>
                </label>
              ))}
            </div>

            {/* Additional fields */}
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

            {safety.incidentType !== 'none' && (
              <div className="space-y-1.5">
                <Label>{isRtl ? 'وصف الحادث' : 'Incident Description'}</Label>
                <Textarea
                  value={safety.incidentDescription}
                  onChange={(e) => setSafety({ ...safety, incidentDescription: e.target.value })}
                  rows={3}
                  placeholder={isRtl ? 'صف الحادث بالتفصيل' : 'Describe the incident in detail'}
                />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
              {isRtl ? 'إلغاء' : 'Cancel'}
            </Button>
            <Button type="button" onClick={handleSubmit} disabled={!allSafetyPassed || !formData.projectId || submitting}>
              {submitting
                ? (isRtl ? 'جاري الحفظ...' : 'Saving...')
                : (isRtl ? 'حفظ فحص السلامة' : 'Save Safety Inspection')
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Safety Details Dialog */}
      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isRtl ? 'تفاصيل فحص السلامة' : 'Safety Inspection Details'}</DialogTitle>
          </DialogHeader>
          {viewReport && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">{isRtl ? 'المشروع' : 'Project'}</p>
                  <p className="font-medium">{viewReport.project?.name || '-'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{isRtl ? 'التاريخ' : 'Date'}</p>
                  <p className="font-medium">{new Date(viewReport.reportDate).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US')}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{isRtl ? 'موقّع من' : 'Signed by'}</p>
                  <p className="font-medium">{viewReport.signedByUser?.name || viewReport.signedBy || '-'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{isRtl ? 'وقع في' : 'Signed at'}</p>
                  <p className="font-medium">{viewReport.signedAt ? new Date(viewReport.signedAt).toLocaleString(isRtl ? 'ar-EG' : 'en-US') : '-'}</p>
                </div>
              </div>

              <div>
                <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-emerald-600" />
                  {isRtl ? 'قائمة فحص السلامة' : 'Safety Checklist'}
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                  {safetyChecklistItems.map((item) => {
                    const ok = viewReport[item.key as keyof typeof viewReport] as boolean
                    return (
                      <div key={item.key} className="flex items-center gap-1.5 text-xs p-1.5 rounded bg-muted/30">
                        {ok ? (
                          <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                        ) : (
                          <X className="h-3.5 w-3.5 text-red-500 shrink-0" />
                        )}
                        <span className={ok ? '' : 'text-red-500 line-through'}>{item.label}</span>
                      </div>
                    )
                  })}
                </div>
              </div>

              {viewReport.observations && (
                <div>
                  <p className="text-xs text-muted-foreground">{isRtl ? 'الملاحظات' : 'Observations'}</p>
                  <p className="text-sm mt-1">{viewReport.observations}</p>
                </div>
              )}
              {viewReport.violations && (
                <div>
                  <p className="text-xs text-muted-foreground">{isRtl ? 'المخالفات' : 'Violations'}</p>
                  <p className="text-sm mt-1 text-orange-600">{viewReport.violations}</p>
                </div>
              )}
              {viewReport.incidentType && viewReport.incidentType !== 'none' && (
                <div>
                  <p className="text-xs text-muted-foreground">{isRtl ? 'الحادث' : 'Incident'}</p>
                  <Badge variant="destructive" className="text-xs mt-1">
                    {isRtl ? incidentLabels[viewReport.incidentType].ar : incidentLabels[viewReport.incidentType].en}
                  </Badge>
                  {viewReport.incidentDescription && (
                    <p className="text-sm mt-1 text-destructive">{viewReport.incidentDescription}</p>
                  )}
                </div>
              )}

              {viewReport.dailyReport?.status === 'draft' && (
                <div className="p-3 bg-orange-50 border border-orange-200 rounded-lg">
                  <p className="text-sm text-orange-700 font-medium">
                    {isRtl ? 'الحالة: فحص السلامة مكتمل - في انتظار تعبئة بيانات التقرير اليومي' : 'Status: Safety inspection complete - awaiting daily report data'}
                  </p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
