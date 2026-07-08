'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet'
import { ShieldCheck, ShieldAlert, AlertTriangle, CheckCircle2, XCircle, Calendar, Plus, Loader2, Save } from 'lucide-react'
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
  { key: 'ppeAvailable', ar: 'معدات الوقاية متوفرة', en: 'PPE Available' },
  { key: 'helmetCheck', ar: 'خوذات الرأس', en: 'Helmets' },
  { key: 'bootsCheck', ar: 'أحذية السلامة', en: 'Safety Boots' },
  { key: 'glovesCheck', ar: 'القفازات', en: 'Gloves' },
  { key: 'glassesCheck', ar: 'النظارات الواقية', en: 'Safety Glasses' },
  { key: 'workAreaCheck', ar: 'منطقة العمل منظمة', en: 'Work Area Organized' },
  { key: 'barriersCheck', ar: 'الحواجز والتحذيرات', en: 'Barriers & Warnings' },
  { key: 'shaftCheck', ar: 'سلامة البئر', en: 'Shaft Safety' },
  { key: 'ventilationCheck', ar: 'التهوية', en: 'Ventilation' },
  { key: 'electricalCheck', ar: 'التوصيلات الكهربائية', en: 'Electrical Connections' },
  { key: 'craneCheck', ar: 'الرافعة', en: 'Crane' },
  { key: 'hydraulicCheck', ar: 'النظام الهيدروليكي', en: 'Hydraulic System' },
  { key: 'fireExtinguishers', ar: 'طفايات الحريق', en: 'Fire Extinguishers' },
  { key: 'workPermit', ar: 'تصريح العمل', en: 'Work Permit' },
  { key: 'toolboxTalk', ar: 'إحاطة السلامة', en: 'Toolbox Talk' },
]

const emptyForm = {
  projectId: '',
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
  const [loading, setLoading] = useState(true)
  const [selectedProject, setSelectedProject] = useState<string>('all')
  const [sheetOpen, setSheetOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(emptyForm)
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
      const data = await res.json()
      const withSafety = (data.reports || []).filter((r: any) => r.safety)
      setReports(withSafety)
    } catch (e) {
      console.error(e)
    }
    setLoading(false)
  }

  useEffect(() => {
    if (!token) return
    fetchReports()
    authedFetch('/api/projects/list').then(r => r.json()).then(d => setProjects(d.projects || [])).catch(() => {})
  }, [selectedProject, token])

  function toggleCheck(key: string) {
    setForm(prev => ({ ...prev, [key]: !prev[key as keyof typeof prev] }))
  }

  async function handleSave() {
    if (!form.projectId) {
      toast.error(isRtl ? 'يرجى اختيار المشروع' : 'Please select a project')
      return
    }

    setSaving(true)
    try {
      // 1) Find or create a daily report for this project + date
      const dateStr = form.reportDate
      const todayStart = new Date(dateStr + 'T00:00:00.000Z')
      const todayEnd = new Date(dateStr + 'T23:59:59.999Z')

      // Search for existing daily report
      const searchParams = new URLSearchParams({
        projectId: form.projectId,
        limit: '100',
      })
      const listRes = await authedFetch('/api/daily-reports?' + searchParams.toString())
      const listData = await listRes.json()
      const existing = (listData.reports || []).find((r: any) => {
        const d = new Date(r.reportDate)
        return d >= todayStart && d <= todayEnd
      })

      let reportId = existing?.id

      if (!reportId) {
        // Create a minimal daily report (draft)
        const createRes = await authedFetch('/api/daily-reports', {
          method: 'POST',
          body: JSON.stringify({
            projectId: form.projectId,
            reportDate: dateStr,
            status: 'draft',
          }),
        })
        const createData = await createRes.json()
        if (!createRes.ok || !createData.report) {
          throw new Error(createData.error || createData.details || (isRtl ? 'فشل إنشاء التقرير اليومي' : 'Failed to create daily report'))
        }
        reportId = createData.report.id
      }

      // 2) Save safety report
      const safetyRes = await authedFetch(`/api/daily-reports/${reportId}/safety`, {
        method: 'POST',
        body: JSON.stringify({
          ...form,
        }),
      })
      const safetyData = await safetyRes.json()
      if (!safetyRes.ok) {
        throw new Error(safetyData.error || (isRtl ? 'فشل حفظ تقرير السلامة' : 'Failed to save safety report'))
      }

      toast.success(isRtl ? 'تم حفظ تقرير السلامة بنجاح' : 'Safety report saved successfully')
      setSheetOpen(false)
      setForm(emptyForm)
      fetchReports()
    } catch (e: any) {
      console.error(e)
      toast.error(e.message || (isRtl ? 'حدث خطأ' : 'An error occurred'))
    } finally {
      setSaving(false)
    }
  }

  // Calculate stats
  const total = reports.length
  const incidents = reports.filter(r => r.safety?.incidentType && r.safety.incidentType !== 'none').length
  const avgCompliance = total > 0
    ? reports.reduce((sum, r) => {
        const checks = [
          r.safety?.ppeAvailable, r.safety?.helmetCheck, r.safety?.bootsCheck,
          r.safety?.glovesCheck, r.safety?.glassesCheck, r.safety?.workAreaCheck,
          r.safety?.barriersCheck, r.safety?.shaftCheck, r.safety?.ventilationCheck,
          r.safety?.electricalCheck, r.safety?.craneCheck, r.safety?.hydraulicCheck,
          r.safety?.fireExtinguishers, r.safety?.workPermit, r.safety?.toolboxTalk,
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
            {isRtl ? 'تقارير السلامة اليومية والمخاطر' : 'Daily safety reports and hazards'}
          </p>
        </div>
        <Button onClick={() => { setForm({ ...emptyForm, reportDate: new Date().toISOString().split('T')[0] }); setSheetOpen(true) }}>
          <Plus className="h-4 w-4" />
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
            const checks = [
              r.safety.ppeAvailable, r.safety.helmetCheck, r.safety.bootsCheck,
              r.safety.glovesCheck, r.safety.glassesCheck, r.safety.workAreaCheck,
              r.safety.barriersCheck, r.safety.shaftCheck, r.safety.ventilationCheck,
              r.safety.electricalCheck, r.safety.craneCheck, r.safety.hydraulicCheck,
              r.safety.fireExtinguishers, r.safety.workPermit, r.safety.toolboxTalk,
            ]
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
        <SheetContent side={isRtl ? 'left' : 'right'} className="sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{isRtl ? 'إضافة تقرير سلامة' : 'Add Safety Report'}</SheetTitle>
            <SheetDescription>
              {isRtl ? 'ملء قائمة فحص السلامة اليومية' : 'Fill the daily safety checklist'}
            </SheetDescription>
          </SheetHeader>

          <div className="px-4 space-y-5 pb-4">
            {/* Project selector */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">{isRtl ? 'المشروع' : 'Project'} *</Label>
              <Select value={form.projectId} onValueChange={(v) => setForm(p => ({ ...p, projectId: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder={isRtl ? 'اختر المشروع' : 'Select project'} />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Date */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">{isRtl ? 'التاريخ' : 'Date'}</Label>
              <Input
                type="date"
                value={form.reportDate}
                onChange={(e) => setForm(p => ({ ...p, reportDate: e.target.value }))}
              />
            </div>

            {/* Checklist */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">{isRtl ? 'قائمة الفحص' : 'Checklist'}</Label>
              <div className="grid grid-cols-1 gap-2">
                {checklistItems.map((item) => (
                  <label
                    key={item.key}
                    className="flex items-center gap-3 p-2.5 rounded-lg border hover:bg-muted/50 cursor-pointer transition"
                  >
                    <Checkbox
                      checked={form[item.key as keyof typeof form] as boolean}
                      onCheckedChange={() => toggleCheck(item.key)}
                    />
                    <span className="text-sm">{isRtl ? item.ar : item.en}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Observations */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">{isRtl ? 'الملاحظات' : 'Observations'}</Label>
              <Textarea
                value={form.observations}
                onChange={(e) => setForm(p => ({ ...p, observations: e.target.value }))}
                placeholder={isRtl ? 'أضف ملاحظاتك...' : 'Add your observations...'}
                rows={3}
              />
            </div>

            {/* Violations */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">{isRtl ? 'المخالفات' : 'Violations'}</Label>
              <Textarea
                value={form.violations}
                onChange={(e) => setForm(p => ({ ...p, violations: e.target.value }))}
                placeholder={isRtl ? 'سجّل أي مخالفات...' : 'Record any violations...'}
                rows={2}
              />
            </div>

            {/* Incident type */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">{isRtl ? 'نوع الحادث' : 'Incident Type'}</Label>
              <Select value={form.incidentType} onValueChange={(v) => setForm(p => ({ ...p, incidentType: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{isRtl ? 'لا يوجد' : 'None'}</SelectItem>
                  <SelectItem value="near_miss">Near Miss</SelectItem>
                  <SelectItem value="incident">{isRtl ? 'حادث' : 'Incident'}</SelectItem>
                  <SelectItem value="accident">{isRtl ? 'إصابة' : 'Accident'}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Incident description */}
            {form.incidentType !== 'none' && (
              <div className="space-y-2">
                <Label className="text-sm font-medium">{isRtl ? 'وصف الحادث' : 'Incident Description'}</Label>
                <Textarea
                  value={form.incidentDescription}
                  onChange={(e) => setForm(p => ({ ...p, incidentDescription: e.target.value }))}
                  placeholder={isRtl ? 'صف الحادث بالتفصيل...' : 'Describe the incident in detail...'}
                  rows={3}
                />
              </div>
            )}

            {/* Compliance summary */}
            <div className="bg-muted/50 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">{isRtl ? 'نسبة الالتزام' : 'Compliance'}</span>
                <span className="text-sm font-bold">
                  {checklistItems.filter(i => form[i.key as keyof typeof form]).length}/15
                  {' '}({((checklistItems.filter(i => form[i.key as keyof typeof form]).length / 15) * 100).toFixed(0)}%)
                </span>
              </div>
              <Progress
                value={(checklistItems.filter(i => form[i.key as keyof typeof form]).length / 15) * 100}
                className="h-2"
              />
            </div>
          </div>

          <SheetFooter>
            <Button variant="outline" onClick={() => setSheetOpen(false)} disabled={saving}>
              {isRtl ? 'إلغاء' : 'Cancel'}
            </Button>
            <Button onClick={handleSave} disabled={saving || !form.projectId}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {!saving && <Save className="h-4 w-4" />}
              {saving ? (isRtl ? 'جاري الحفظ...' : 'Saving...') : (isRtl ? 'حفظ التقرير' : 'Save Report')}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  )
}
