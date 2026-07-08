'use client'

import { useEffect, useState } from 'react'
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
import { ShieldCheck, ShieldAlert, AlertTriangle, CheckCircle2, XCircle, Calendar, Plus, Loader2 } from 'lucide-react'
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
  reportDate: new Date().toISOString().split('T')[0],
  signedBy: '',
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
  const [loading, setLoading] = useState(true)
  const [selectedProject, setSelectedProject] = useState<string>('all')
  const [sheetOpen, setSheetOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ ...emptyForm })
  const language = useAppStore((s) => s.language)
  const token = useAppStore((s) => s.token)
  const isRtl = language === 'ar'

  async function fetchReports() {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (selectedProject !== 'all') params.set('projectId', selectedProject)
      params.set('limit', '100')
      const res = await authedFetch('/api/daily-reports?' + params.toString())
      if (!res.ok) throw new Error('Failed to fetch')
      const data = await res.json()
      const withSafety = (data.reports || []).filter((r: any) => r.safety)
      setReports(withSafety)
    } catch {
      toast.error(isRtl ? 'خطأ في تحميل التقارير' : 'Failed to load reports')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!token) return
    fetchReports()
    authedFetch('/api/projects/list').then(r => r.json()).then(d => setProjects(d.projects || []))
  }, [selectedProject, token])

  async function handleSave() {
    if (!form.projectId || !form.reportDate || !form.signedBy) {
      toast.error(isRtl ? 'يرجى ملء جميع الحقول المطلوبة' : 'Please fill all required fields')
      return
    }

    setSaving(true)
    try {
      // Find or create a daily report for this project+date
      const reportsRes = await authedFetch(`/api/daily-reports?projectId=${form.projectId}&date=${form.reportDate}&limit=1`)
      const reportsData = await reportsRes.json()
      let reportId = reportsData.reports?.[0]?.id

      if (!reportId) {
        // Create a minimal daily report
        const createRes = await authedFetch('/api/daily-reports', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: form.projectId,
            reportDate: form.reportDate,
            status: 'draft',
          }),
        })
        if (!createRes.ok) throw new Error('Failed to create report')
        const createData = await createRes.json()
        reportId = createData.report?.id
      }

      if (!reportId) throw new Error('No report ID')

      // Create safety report
      const safetyData: any = { signedBy: form.signedBy }
      for (const item of checklistItems) {
        safetyData[item.key] = form[item.key as keyof typeof form]
      }
      safetyData.observations = form.observations || null
      safetyData.violations = form.violations || null
      safetyData.incidentType = form.incidentType
      safetyData.incidentDescription = form.incidentType !== 'none' ? form.incidentDescription || null : null

      const safetyRes = await authedFetch(`/api/daily-reports/${reportId}/safety`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(safetyData),
      })

      if (!safetyRes.ok) throw new Error('Failed to save safety report')

      toast.success(isRtl ? 'تم حفظ تقرير السلامة' : 'Safety report saved')
      setSheetOpen(false)
      setForm({ ...emptyForm, reportDate: new Date().toISOString().split('T')[0] })
      fetchReports()
    } catch (e: any) {
      toast.error(e.message || (isRtl ? 'حدث خطأ' : 'Error'))
    } finally {
      setSaving(false)
    }
  }

  // Calculate stats
  const total = reports.length
  const incidents = reports.filter(r => r.safety?.incidentType && r.safety.incidentType !== 'none').length
  const avgCompliance = total > 0
    ? reports.reduce((sum, r) => {
        const checks = checklistItems.map(item => r.safety?.[item.key as keyof any])
        const passed = checks.filter(Boolean).length
        return sum + (passed / 15) * 100
      }, 0) / total
    : 0

  // Form compliance
  const formPassed = checklistItems.filter(item => form[item.key as keyof typeof form]).length
  const formCompliance = (formPassed / 15) * 100

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">{isRtl ? 'السلامة' : 'Safety'}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isRtl ? 'تقارير السلامة اليومية والمخاطر' : 'Daily safety reports and hazards'}
          </p>
        </div>
        <Button onClick={() => {
          setForm({ ...emptyForm, reportDate: new Date().toISOString().split('T')[0] })
          setSheetOpen(true)
        }}>
          <Plus className="h-4 w-4 ml-2" />
          {isRtl ? 'إضافة تقرير سلامة' : 'Add Safety Report'}
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
            const checks = checklistItems.map(item => r.safety?.[item.key as keyof any])
            const passed = checks.filter(Boolean).length
            const compliance = (passed / 15) * 100
            const incident = incidentLabels[r.safety.incidentType || 'none']
            const hasIncident = r.safety.incidentType && r.safety.incidentType !== 'none'

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
                        <Badge variant="outline" className="text-xs">{r.driveLine?.lineNumber || '-'}</Badge>
                        {hasIncident && (
                          <Badge variant={incident.color as any} className="text-xs">
                            {isRtl ? incident.ar : incident.en}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mb-2">
                        {new Date(r.reportDate).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                        {' • '}
                        {isRtl ? 'موقّع من' : 'Signed by'}: {r.safety.signedBy || '-'}
                      </p>
                      <div className="flex items-center gap-2 mb-2">
                        <Progress value={compliance} className="h-1.5 flex-1" />
                        <span className="text-xs font-medium">{passed}/15</span>
                      </div>
                      {r.safety.observations && (
                        <p className="text-xs text-muted-foreground">{r.safety.observations}</p>
                      )}
                      {r.safety.violations && (
                        <p className="text-xs text-orange-600 mt-1">⚠ {r.safety.violations}</p>
                      )}
                      {r.safety.incidentDescription && (
                        <p className="text-xs text-destructive mt-1">🚨 {r.safety.incidentDescription}</p>
                      )}
                    </div>
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
              {isRtl ? 'ملء بيانات تقرير السلامة اليومي' : 'Fill in the daily safety report details'}
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-5">
            {/* Project & Date */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{isRtl ? 'المشروع' : 'Project'} *</Label>
                <Select value={form.projectId} onValueChange={(v) => setForm({ ...form, projectId: v })}>
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
                <Input type="date" value={form.reportDate} onChange={(e) => setForm({ ...form, reportDate: e.target.value })} />
              </div>
            </div>

            {/* Signed by */}
            <div className="space-y-1.5">
              <Label>{isRtl ? 'موقّع من' : 'Signed by'} *</Label>
              <Input
                value={form.signedBy}
                onChange={(e) => setForm({ ...form, signedBy: e.target.value })}
                placeholder={isRtl ? 'اسم المسؤول' : 'Officer name'}
              />
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
                {checklistItems.map((item) => (
                  <label
                    key={item.key}
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 cursor-pointer transition"
                  >
                    <Checkbox
                      checked={form[item.key as keyof typeof form] as boolean}
                      onCheckedChange={(checked) =>
                        setForm({ ...form, [item.key]: !!checked })
                      }
                    />
                    <span className="text-sm">{isRtl ? item.ar : item.en}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Observations & Violations */}
            <div className="space-y-1.5">
              <Label>{isRtl ? 'الملاحظات' : 'Observations'}</Label>
              <Textarea
                value={form.observations}
                onChange={(e) => setForm({ ...form, observations: e.target.value })}
                rows={3}
                placeholder={isRtl ? 'ملاحظات عامة...' : 'General observations...'}
              />
            </div>

            <div className="space-y-1.5">
              <Label>{isRtl ? 'المخالفات' : 'Violations'}</Label>
              <Textarea
                value={form.violations}
                onChange={(e) => setForm({ ...form, violations: e.target.value })}
                rows={2}
                placeholder={isRtl ? 'أي مخالفات مرصودة...' : 'Any violations noted...'}
              />
            </div>

            {/* Incident type */}
            <div className="space-y-1.5">
              <Label>{isRtl ? 'نوع الحادث' : 'Incident Type'}</Label>
              <Select value={form.incidentType} onValueChange={(v) => setForm({ ...form, incidentType: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(incidentLabels).map(([key, val]) => (
                    <SelectItem key={key} value={key}>{isRtl ? val.ar : val.en}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {form.incidentType !== 'none' && (
              <div className="space-y-1.5">
                <Label>{isRtl ? 'وصف الحادث' : 'Incident Description'}</Label>
                <Textarea
                  value={form.incidentDescription}
                  onChange={(e) => setForm({ ...form, incidentDescription: e.target.value })}
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
