// ============================================================
// v121 — «خطة عمل الماكينات» — مخطط زمني تفاعلي (Gantt)
// صفحة واحدة واضحة يجيب عن: أين تعمل كل ماكينة الآن؟ ما العمل التالي؟
// متى يبدأ وينتهي كل نفق؟ ما متوسط الإنتاج المطلوب؟ ما درجة الثقة فيه؟
// هل العمل يسير حسب الخطة أم يوجد تأخير؟
//
// الصلاحيات (الخادم هو المصدر):
//   • المشاهدة: الجميع — الموظفون والزائر (لا بيانات مالية في القسم أصلاً).
//   • الإدارة (إنشاء/تعديل/حذف/إزاحة/ألوان/استرجاع): حساب مدير الخطة فقط
//     — صلاحية machine_plans_edit مرتبطة بحسابه (User ID) لا باسمه المكتوب.
//
// عرض المخطط: أعمدة البيانات مثبتة في الجهة اليسرى (مطابقة لملف Excel المرفق)
// والزمن أفقي من اليسار إلى اليمين بالأيام والأسابيع مع تكبير/تصغير وتبديل
// بين العرض اليومي والأسبوعي، وخط رأسي أحمر لتاريخ اليوم، ولكل ماكينة لون خاص
// بدليل ألوان واضح، ودرجة ثقة مستقلة عن لون الماكينة وحالة التنفيذ.
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Separator } from '@/components/ui/separator'
import {
  GanttChart, Plus, Pencil, Trash2, History, Loader2, ZoomIn, ZoomOut, RefreshCw,
  CalendarDays, CalendarRange, Timer, TriangleAlert, ChevronDown, ChevronRight,
  Palette, LayoutList, Rows3, Info, X, Undo2, Search,
} from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { authedFetch } from '@/lib/api-client'
import { toast } from 'sonner'
import {
  ACTIVITY_TYPES, CONFIDENCE_LEVELS, PLAN_STATUSES, DEFAULT_HOLIDAYS,
  parseDateOnly, parseHolidayConfig, toISODate, addDaysUTC, diffCalendarDays,
  computePlanning,
  type HolidayConfig,
} from '@/lib/machine-plan-math'

// ─── أنواع البيانات ──────────────────────────────────────────────

interface PlanProgressT {
  status: 'not_started' | 'on_track' | 'at_risk' | 'late' | 'completed' | 'suspended'
  elapsedWorkingDays: number
  expectedToDate: number
  actualMeters: number
  metersBehind: number
  remaining: number
  pct: number
  actualRate: number
  requiredToFinish: number
  projectedEnd: Date | null
  delayDays: number
}

interface PlanRow {
  id: string
  machineName: string
  machineColor: string
  projectName: string
  location: string | null
  chainage: string | null
  tunnelLength: number
  pipeDiameter: string | null
  sleeveDiameter: string | null
  remarks: string | null
  activityType: string
  activityLabel: string
  startDate: string
  endDate: string
  planningMode: string
  avgRate: number | null
  requiredRate: number | null
  diggingDays: number | null
  confidence: string
  holidayConfig: string | null
  driveLineId: string | null
  driveLine: { lineNumber: string; projectName: string; completedLength: number } | null
  actualMeters: number
  actualWindowNote: string
  progress: PlanProgressT | null
  status: string
  statusOverride: string | null
  sortIndex: number
  currentVersion: number
  createdByName: string | null
  updatedByName: string | null
  lastUpdatedAt: string
}

interface MachineInfo { name: string; color: string; count: number }
interface ConflictRow { id: string; machineName: string; projectName: string; location: string | null; activityLabel: string; startDate: string; endDate: string }
interface FollowUpRow { id: string; machineName: string; projectName: string; location: string | null; activityLabel: string; startDate: string; endDate: string; suggestedStartDate: string; suggestedEndDate: string }
interface VersionRow {
  id: string; version: number; note: string | null; changedByName: string | null; changedAt: string
  snapshot: { projectName: string; location: string | null; chainage: string | null; tunnelLength: number; activityType: string; activityName: string | null; startDate: string; endDate: string; planningMode: string; avgRate: number | null; requiredRate: number | null; diggingDays: number | null; confidence: string }
}

interface FormState {
  id: string | null // null = إنشاء جديد
  machineName: string
  machineColor: string
  projectName: string
  location: string
  chainage: string
  tunnelLength: string
  pipeDiameter: string
  sleeveDiameter: string
  remarks: string
  activityType: string
  activityName: string
  startDate: string
  endDate: string // في وضع by_rate يُحسب تلقائياً
  planningMode: 'by_rate' | 'by_end_date'
  avgRate: string
  confidence: string
  holidays: HolidayConfig
  driveLineId: string
  statusOverride: boolean
  sortIndex: string
  changeNote: string
}

const WEEKDAY_NAMES_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
const WEEKDAY_SHORT_AR = ['ح', 'ن', 'ث', 'ر', 'خ', 'ج', 'س']
const MONTH_NAMES_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']

// عرض أعمدة البيانات المثبتة (بكسل) — مطابقة لترتيب ملف Excel المرفق
const COLS = [
  { key: 'machine', ar: 'الماكينة', w: 96, hide: '' },
  { key: 'project', ar: 'المشروع', w: 150, hide: 'hidden min-[480px]:flex' },
  { key: 'location', ar: 'الموقع / التقاطع والخط', w: 132, hide: '' },
  { key: 'chainage', ar: 'Chainage', w: 86, hide: 'hidden min-[900px]:flex' },
  { key: 'length', ar: 'الطول (م)', w: 76, hide: '' },
  { key: 'pipe', ar: 'الأنبوب', w: 68, hide: 'hidden min-[640px]:flex' },
  { key: 'sleeve', ar: 'Sleeve', w: 68, hide: 'hidden min-[720px]:flex' },
  { key: 'activity', ar: 'النشاط', w: 132, hide: '' },
  { key: 'remarks', ar: 'الملاحظات', w: 140, hide: 'hidden min-[1000px]:flex' },
  { key: 'actions', ar: '', w: 88, hide: '' },
]
const ROW_H = 40
const EMPTY_FORM: FormState = {
  id: null, machineName: '', machineColor: '#2563eb', projectName: '', location: '', chainage: '',
  tunnelLength: '', pipeDiameter: '', sleeveDiameter: '', remarks: '', activityType: 'digging',
  activityName: '', startDate: '', endDate: '', planningMode: 'by_rate', avgRate: '',
  confidence: 'gray', holidays: { ...DEFAULT_HOLIDAYS, dates: [] }, driveLineId: '', statusOverride: false,
  sortIndex: '0', changeNote: '',
}

function fmtNum(n: number | null | undefined, digits?: number): string {
  if (n === null || n === undefined || isNaN(n)) return '—'
  return n.toLocaleString('en-US', { maximumFractionDigits: digits === undefined ? 2 : digits })
}
function fmtDateAr(iso: string): string {
  var d = parseDateOnly(iso)
  if (!d) return '—'
  return d.getUTCDate() + ' ' + MONTH_NAMES_AR[d.getUTCMonth()] + ' ' + d.getUTCFullYear()
}
function worstStatus(statuses: string[]): string {
  var order = ['late', 'suspended', 'at_risk', 'not_started', 'on_track', 'completed']
  for (var i = 0; i < order.length; i++) if (statuses.indexOf(order[i]) !== -1) return order[i]
  return 'on_track'
}

export default function MachinesPlanPage() {
  const language = useAppStore((s) => s.language)
  const isAr = language === 'ar'
  const t = useCallback(function (ar: string, en: string) { return isAr ? ar : en }, [isAr])

  // ─── البيانات ───
  const [plans, setPlans] = useState<PlanRow[]>([])
  const [machines, setMachines] = useState<MachineInfo[]>([])
  const [lastUpdate, setLastUpdate] = useState<{ at: string; by: string } | null>(null)
  const [canManage, setCanManage] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([])
  const [lines, setLines] = useState<{ id: string; label: string }[]>([])

  // ─── العرض والفلاتر ───
  const [viewMode, setViewMode] = useState<'machine' | 'project'>('machine')
  const [scale, setScale] = useState<'day' | 'week'>('day')
  const [zoom, setZoom] = useState(1)
  const [fMachine, setFMachine] = useState('all')
  const [fProject, setFProject] = useState('all')
  const [fStatus, setFStatus] = useState('all')
  const [fFrom, setFFrom] = useState('')
  const [fTo, setFTo] = useState('')
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [today] = useState<string>(() => toISODate(new Date()))

  // ─── النوافذ ───
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [conflictDlg, setConflictDlg] = useState<{ conflicts: ConflictRow[]; body: Record<string, unknown>; isCreate: boolean } | null>(null)
  const [shiftDlg, setShiftDlg] = useState<{ followUps: FollowUpRow[]; deltaDays: number; sourceId: string } | null>(null)
  const [detailsFor, setDetailsFor] = useState<PlanRow | null>(null)
  const [versionsFor, setVersionsFor] = useState<PlanRow | null>(null)
  const [versions, setVersions] = useState<VersionRow[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [colorsDlg, setColorsDlg] = useState(false)
  const [colorDraft, setColorDraft] = useState<Record<string, string>>({})
  const [deleteFor, setDeleteFor] = useState<PlanRow | null>(null)
  const [busyId, setBusyId] = useState('')

  // ─── السحب بالفأرة/اللمس ───
  const dragRef = useRef<{ id: string; mode: 'move' | 'resizeL' | 'resizeR'; startX: number; origStart: string; origEnd: string } | null>(null)
  const [dragPreview, setDragPreview] = useState<{ id: string; start: string; end: string } | null>(null)

  // ─── الجلب ───
  const load = useCallback(async function () {
    setLoading(true); setLoadError('')
    try {
      const res = await authedFetch('/api/machine-plans', { noCache: true })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setPlans(data.plans || [])
        setMachines(data.machines || [])
        setLastUpdate(data.lastUpdate || null)
        setCanManage(!!(data.viewer && data.viewer.canManage))
      } else {
        setLoadError(data.message || t('تعذر تحميل خطة الماكينات', 'Failed to load machines plan'))
      }
    } catch {
      setLoadError(t('تعذر الاتصال بالخادم', 'Server connection failed'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(function () { load() }, [load])

  // قوائم المشاريع وخطوط الحفر (للربط في نموذج الإضافة/التعديل)
  useEffect(function () {
    ; (async function () {
      try {
        var pr = await authedFetch('/api/projects', { noCache: true })
        var prData = await pr.json().catch(() => ({}))
        if (pr.ok) setProjects((prData.projects || []).map(function (p: { id: string; name: string }) { return { id: p.id, name: p.name } }))
        var dl = await authedFetch('/api/drive-lines', { noCache: true })
        var dlData = await dl.json().catch(() => ({}))
        if (dl.ok) {
          var raw = dlData.driveLines || dlData.lines || []
          setLines(raw.map(function (l: { id: string; lineNumber: string; project?: { name?: string } }) {
            return { id: l.id, label: (l.project && l.project.name ? l.project.name + ' — ' : '') + l.lineNumber }
          }))
        }
      } catch { /* القوائم تحسينية — فشلها لا يمنع الصفحة */ }
    })()
  }, [])

  // ─── الفلترة ───
  const filtered = useMemo(function () {
    var q = query.trim().toLowerCase()
    return plans.filter(function (p) {
      if (fMachine !== 'all' && p.machineName !== fMachine) return false
      if (fProject !== 'all' && p.projectName !== fProject) return false
      if (fStatus !== 'all' && p.status !== fStatus) return false
      if (fFrom || fTo) {
        var s = parseDateOnly(p.startDate) as Date
        var e = parseDateOnly(p.endDate) as Date
        var from = fFrom ? parseDateOnly(fFrom) : null
        var to = fTo ? parseDateOnly(fTo) : null
        if (from && e.getTime() < from.getTime()) return false
        if (to && s.getTime() > to.getTime()) return false
      }
      if (q) {
        var hay = (p.machineName + ' ' + p.projectName + ' ' + (p.location || '') + ' ' + (p.chainage || '') + ' ' + (p.remarks || '') + ' ' + p.activityLabel).toLowerCase()
        if (hay.indexOf(q) === -1) return false
      }
      return true
    })
  }, [plans, fMachine, fProject, fStatus, fFrom, fTo, query])

  // ─── نطاق المحور الزمني ───
  const axis = useMemo(function () {
    var todayD = parseDateOnly(today) as Date
    var min: Date | null = null
    var max: Date | null = null
    for (var i = 0; i < filtered.length; i++) {
      var s = parseDateOnly(filtered[i].startDate)
      var e = parseDateOnly(filtered[i].endDate)
      var pr = filtered[i].progress
      var pe = pr && pr.projectedEnd ? pr.projectedEnd : null
      if (pe && e) e = pe.getTime() > e.getTime() ? pe : e
      if (s && (!min || s.getTime() < min.getTime())) min = s
      if (e && (!max || e.getTime() > max.getTime())) max = e
    }
    var start = min && min.getTime() < addDaysUTC(todayD, -3).getTime() ? min : addDaysUTC(todayD, -3)
    var end = max && max.getTime() > addDaysUTC(todayD, 7).getTime() ? max : addDaysUTC(todayD, 7)
    start = addDaysUTC(start, -1)
    end = addDaysUTC(end, 2)
    var days: Date[] = []
    var cur = new Date(start.getTime())
    var guard = 0
    while (cur.getTime() <= end.getTime() && guard < 800) { days.push(new Date(cur.getTime())); cur = addDaysUTC(cur, 1); guard++ }
    return { start: start, end: end, days: days, todayIndex: diffCalendarDays(start, todayD) }
  }, [filtered, today])

  const pxPerDay = (scale === 'day' ? 40 : 13) * zoom
  const timelineW = axis.days.length * pxPerDay
  const dayIndex = useCallback(function (iso: string) {
    var d = parseDateOnly(iso)
    return d ? diffCalendarDays(axis.start, d) : 0
  }, [axis.start])

  // ─── التجميع ───
  const groups = useMemo(function () {
    var map: Record<string, PlanRow[]> = {}
    for (var i = 0; i < filtered.length; i++) {
      var key = viewMode === 'machine' ? filtered[i].machineName : filtered[i].projectName
      if (!map[key]) map[key] = []
      map[key].push(filtered[i])
    }
    return Object.keys(map).sort().map(function (k) {
      var rows = map[k].slice().sort(function (a, b) { return a.sortIndex - b.sortIndex || (parseDateOnly(a.startDate) as Date).getTime() - (parseDateOnly(b.startDate) as Date).getTime() })
      var color = viewMode === 'machine' ? (map[k][0].machineColor) : '#475569'
      return { key: k, rows: rows, color: color }
    })
  }, [filtered, viewMode])

  // ─── ملخص الماكينات: أين الآن؟ ما التالي؟ ───
  const machineSummaries = useMemo(function () {
    var todayD = parseDateOnly(today) as Date
    var map: Record<string, { name: string; color: string; rows: PlanRow[] }> = {}
    for (var i = 0; i < plans.length; i++) {
      var m = plans[i].machineName
      if (!map[m]) map[m] = { name: m, color: plans[i].machineColor, rows: [] }
      map[m].rows.push(plans[i])
    }
    return Object.keys(map).sort().map(function (k) {
      var g = map[k]
      var current: PlanRow | null = null
      var next: PlanRow | null = null
      for (var j = 0; j < g.rows.length; j++) {
        var r = g.rows[j]
        var s = parseDateOnly(r.startDate) as Date
        var e = parseDateOnly(r.endDate) as Date
        if (!current && s.getTime() <= todayD.getTime() && e.getTime() >= todayD.getTime()) current = r
        if (!next && s.getTime() > todayD.getTime()) next = r
      }
      // الأقرب تاريخياً إن لم يوجد «قادم»
      if (!next) {
        for (var n = 0; n < g.rows.length; n++) {
          if (!next || (parseDateOnly(g.rows[n].startDate) as Date).getTime() > (parseDateOnly(next.startDate) as Date).getTime()) next = g.rows[n]
        }
      }
      return { name: g.name, color: g.color, current: current, next: next, status: worstStatus(g.rows.map(function (r) { return r.status })) }
    })
  }, [plans, today])

  // ─── الحساب الحي في النموذج ───
  const liveCalc = useMemo(function () {
    var length = parseFloat(form.tunnelLength)
    var rate = form.avgRate.trim() !== '' ? parseFloat(form.avgRate) : NaN
    return computePlanning({
      mode: form.planningMode,
      lengthM: isNaN(length) ? 0 : length,
      start: form.startDate || null,
      end: form.planningMode === 'by_end_date' ? (form.endDate || null) : null,
      rate: isNaN(rate) ? null : rate,
      holidays: form.holidays,
    })
  }, [form])

  // ─── فتح النماذج ───
  function openCreate() {
    setForm({ ...EMPTY_FORM })
    setFormOpen(true)
  }
  function openEdit(row: PlanRow) {
    var cfg = parseHolidayConfig(row.holidayConfig)
    setForm({
      id: row.id, machineName: row.machineName, machineColor: row.machineColor, projectName: row.projectName,
      location: row.location || '', chainage: row.chainage || '', tunnelLength: String(row.tunnelLength || ''),
      pipeDiameter: row.pipeDiameter || '', sleeveDiameter: row.sleeveDiameter || '', remarks: row.remarks || '',
      activityType: row.activityType, activityName: row.activityType === 'custom' && row.activityLabel !== ACTIVITY_TYPES.custom.ar ? row.activityLabel : '',
      startDate: row.startDate, endDate: row.endDate,
      planningMode: row.planningMode === 'by_end_date' ? 'by_end_date' : 'by_rate',
      avgRate: row.avgRate === null ? '' : String(row.avgRate), confidence: row.confidence,
      holidays: cfg, driveLineId: row.driveLineId || '', statusOverride: row.statusOverride === 'suspended',
      sortIndex: String(row.sortIndex || '0'), changeNote: '',
    })
    setFormOpen(true)
  }
  function openEditFromDrag(row: PlanRow, newStart: string, newEnd: string) {
    openEdit(row)
    setForm(function (f) { return { ...f, startDate: newStart, endDate: newEnd, changeNote: t('سحب الشريط الزمني على المخطط', 'Dragged on the timeline') } })
  }

  // ─── الحفظ ───
  async function saveForm(confirmConflicts?: boolean) {
    var length = parseFloat(form.tunnelLength)
    if (!form.machineName.trim()) { toast.error(t('رقم/اسم الماكينة مطلوب', 'Machine name is required')); return }
    if (!form.projectName.trim()) { toast.error(t('اسم المشروع مطلوب', 'Project name is required')); return }
    if (!form.startDate) { toast.error(t('تاريخ البداية مطلوب', 'Start date is required')); return }
    if (form.activityType === 'digging' && !(length > 0)) { toast.error(t('عمل الحفر يتطلب طول نفق أكبر من صفر', 'Digging requires tunnel length > 0')); return }
    var body: Record<string, unknown> = {
      machineName: form.machineName.trim(),
      machineColor: form.machineColor,
      projectName: form.projectName.trim(),
      location: form.location.trim(),
      chainage: form.chainage.trim(),
      tunnelLength: isNaN(length) ? 0 : length,
      pipeDiameter: form.pipeDiameter.trim(),
      sleeveDiameter: form.sleeveDiameter.trim(),
      remarks: form.remarks.trim(),
      activityType: form.activityType,
      activityName: form.activityName.trim(),
      startDate: form.startDate,
      endDate: form.endDate,
      planningMode: form.planningMode,
      avgRate: form.avgRate.trim() === '' ? null : parseFloat(form.avgRate),
      confidence: form.confidence,
      holidayConfig: JSON.stringify(form.holidays),
      driveLineId: form.driveLineId || null,
      statusOverride: form.statusOverride ? 'suspended' : null,
      sortIndex: parseInt(form.sortIndex || '0', 10) || 0,
    }
    if (!form.id && form.activityType === 'digging' && form.planningMode === 'by_rate') {
      // التاريخ النهائي يُحسب من أيام الحفر — نرسل النهاية المحسوبة والخادم يعيد التحقق
      body.endDate = liveCalc.computedEnd ? toISODate(liveCalc.computedEnd) : form.endDate
      if (!(liveCalc.ok)) { toast.error(liveCalc.issues.join(' — ')); return }
    }
    if (!form.id && !body.endDate) { toast.error(t('تاريخ النهاية مطلوب', 'End date is required')); return }
    if (confirmConflicts) body.confirmConflicts = true
    if (form.id) body.changeNote = form.changeNote.trim() || (t('تعديل الخطة', 'Plan edit'))

    setSaving(true)
    try {
      var res = await authedFetch(form.id ? '/api/machine-plans/' + form.id : '/api/machine-plans', {
        method: form.id ? 'PATCH' : 'POST',
        noCache: true,
        body: JSON.stringify(body),
      })
      var data = await res.json().catch(() => ({}))
      if (res.status === 409 && data.conflicts) {
        setConflictDlg({ conflicts: data.conflicts, body: body, isCreate: !form.id })
        setFormOpen(false)
        return
      }
      if (!res.ok) { toast.error(data.message || t('تعذر الحفظ', 'Save failed')); return }
      toast.success(data.message || t('حُفظ', 'Saved'))
      setFormOpen(false)
      // اقتراح إزاحة الأعمال التالية — بعد تأكيد صريح
      if (data.followUps && data.followUps.length > 0 && typeof data.endDeltaDays === 'number' && data.endDeltaDays !== 0 && data.plan) {
        setShiftDlg({ followUps: data.followUps, deltaDays: data.endDeltaDays, sourceId: data.plan.id })
      }
      await load()
    } catch {
      toast.error(t('تعذر الاتصال بالخادم', 'Server connection failed'))
    } finally {
      setSaving(false)
    }
  }

  async function confirmConflictsSave() {
    if (!conflictDlg) return
    var body = { ...conflictDlg.body, confirmConflicts: true }
    setSaving(true)
    try {
      var res = await authedFetch(conflictDlg.isCreate ? '/api/machine-plans' : '/api/machine-plans/' + (conflictDlg.body.id as string), {
        method: conflictDlg.isCreate ? 'POST' : 'PATCH', noCache: true, body: JSON.stringify(body),
      })
      var data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.message || t('تعذر الحفظ', 'Save failed')); return }
      toast.success(data.message || t('حُفظ رغم التعارض — موثّق في السجل', 'Saved with documented conflict'))
      setConflictDlg(null)
      if (data.followUps && data.followUps.length > 0 && typeof data.endDeltaDays === 'number' && data.endDeltaDays !== 0 && data.plan) {
        setShiftDlg({ followUps: data.followUps, deltaDays: data.endDeltaDays, sourceId: data.plan.id })
      }
      await load()
    } catch {
      toast.error(t('تعذر الاتصال بالخادم', 'Server connection failed'))
    } finally { setSaving(false) }
  }

  async function applyShift() {
    if (!shiftDlg) return
    setBusyId('shift')
    try {
      var res = await authedFetch('/api/machine-plans/shift', {
        method: 'POST', noCache: true,
        body: JSON.stringify({ sourceId: shiftDlg.sourceId, deltaDays: shiftDlg.deltaDays }),
      })
      var data = await res.json().catch(() => ({}))
      if (!res.ok) toast.error(data.message || t('تعذر تنفيذ الإزاحة', 'Shift failed'))
      else toast.success(data.message || t('أُزحت الأعمال التالية', 'Following works shifted'))
      setShiftDlg(null)
      await load()
    } catch {
      toast.error(t('تعذر الاتصال بالخادم', 'Server connection failed'))
    } finally { setBusyId('') }
  }

  async function doDelete() {
    if (!deleteFor) return
    setBusyId(deleteFor.id)
    try {
      var res = await authedFetch('/api/machine-plans/' + deleteFor.id, { method: 'DELETE', noCache: true })
      var data = await res.json().catch(() => ({}))
      if (!res.ok) toast.error(data.message || t('تعذر الحذف', 'Delete failed'))
      else toast.success(data.message || t('حُذف العمل من الخطة', 'Work deleted'))
      setDeleteFor(null); setDetailsFor(null)
      await load()
    } catch {
      toast.error(t('تعذر الاتصال بالخادم', 'Server connection failed'))
    } finally { setBusyId('') }
  }

  async function openVersions(row: PlanRow) {
    setVersionsFor(row); setVersions([]); setVersionsLoading(true)
    try {
      var res = await authedFetch('/api/machine-plans/' + row.id + '/versions', { noCache: true })
      var data = await res.json().catch(() => ({}))
      if (res.ok) setVersions(data.versions || [])
      else toast.error(data.message || t('تعذر جلب الإصدارات', 'Failed to load versions'))
    } catch {
      toast.error(t('تعذر الاتصال بالخادم', 'Server connection failed'))
    } finally { setVersionsLoading(false) }
  }

  async function restoreVersion(v: number) {
    if (!versionsFor) return
    setBusyId('restore')
    try {
      var res = await authedFetch('/api/machine-plans/' + versionsFor.id + '/versions', {
        method: 'POST', noCache: true, body: JSON.stringify({ version: v }),
      })
      var data = await res.json().catch(() => ({}))
      if (!res.ok) toast.error(data.message || t('تعذر الاسترجاع', 'Restore failed'))
      else { toast.success(data.message || t('استُرجع الإصدار', 'Version restored')); setVersionsFor(null); await load() }
    } catch {
      toast.error(t('تعذر الاتصال بالخادم', 'Server connection failed'))
    } finally { setBusyId('') }
  }

  async function saveMachineColor(name: string) {
    var color = colorDraft[name]
    if (!color) return
    setBusyId('color-' + name)
    try {
      var res = await authedFetch('/api/machine-plans/machine-colors', {
        method: 'PUT', noCache: true, body: JSON.stringify({ machineName: name, color: color }),
      })
      var data = await res.json().catch(() => ({}))
      if (!res.ok) toast.error(data.message || t('تعذر حفظ اللون', 'Color save failed'))
      else toast.success(data.message || t('حُفظ لون الماكينة', 'Machine color saved'))
      setColorsDlg(false); setColorDraft({})
      await load()
    } catch {
      toast.error(t('تعذر الاتصال بالخادم', 'Server connection failed'))
    } finally { setBusyId('') }
  }

  // ─── السحب ───
  function onBarPointerDown(e: React.PointerEvent, row: PlanRow, mode: 'move' | 'resizeL' | 'resizeR') {
    if (!canManage) return
    e.stopPropagation()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    dragRef.current = { id: row.id, mode: mode, startX: e.clientX, origStart: row.startDate, origEnd: row.endDate }
    setDragPreview({ id: row.id, start: row.startDate, end: row.endDate })
  }
  function onBarPointerMove(e: React.PointerEvent) {
    var d = dragRef.current
    if (!d) return
    var delta = Math.round((e.clientX - d.startX) / pxPerDay)
    var s = parseDateOnly(d.origStart) as Date
    var en = parseDateOnly(d.origEnd) as Date
    var minLen = 1
    if (d.mode === 'move') { s = addDaysUTC(s, delta); en = addDaysUTC(en, delta) }
    else if (d.mode === 'resizeL') { s = addDaysUTC(s, delta); if (diffCalendarDays(s, en) < minLen - 1) s = addDaysUTC(en, -(minLen - 1)) }
    else { en = addDaysUTC(en, delta); if (diffCalendarDays(s, en) < minLen - 1) en = addDaysUTC(s, minLen - 1) }
    setDragPreview({ id: d.id, start: toISODate(s), end: toISODate(en) })
  }
  function onBarPointerUp() {
    const d = dragRef.current
    const pv = dragPreview
    dragRef.current = null
    setDragPreview(null)
    if (!d || !pv) return
    if (pv.start === d.origStart && pv.end === d.origEnd) return
    var row = plans.find(function (p) { return p.id === d.id })
    if (row) openEditFromDrag(row, pv.start, pv.end)
  }

  // ─── خلايا الرأس الزمنية ───
  const headerMonths = useMemo(function () {
    var cells: { label: string; span: number }[] = []
    var curKey = ''
    for (var i = 0; i < axis.days.length; i++) {
      var d = axis.days[i]
      var key = d.getUTCFullYear() + '-' + d.getUTCMonth()
      if (key === curKey) cells[cells.length - 1].span++
      else { curKey = key; cells.push({ label: MONTH_NAMES_AR[d.getUTCMonth()] + ' ' + d.getUTCFullYear(), span: 1 }) }
    }
    return cells
  }, [axis.days])

  const headerScale = useMemo(function () {
    var cells: { label: string; sub: string; span: number }[] = []
    if (scale === 'week') {
      var i = 0
      var weekNo = 1
      while (i < axis.days.length) {
        var span = Math.min(7, axis.days.length - i)
        var d0 = axis.days[i]
        var d1 = axis.days[i + span - 1]
        cells.push({ label: t('أسبوع', 'Week') + ' ' + weekNo, sub: d0.getUTCDate() + '/' + (d0.getUTCMonth() + 1) + ' - ' + d1.getUTCDate() + '/' + (d1.getUTCMonth() + 1), span: span })
        weekNo++; i += span
      }
    } else {
      for (var j = 0; j < axis.days.length; j++) {
        var d = axis.days[j]
        cells.push({ label: String(d.getUTCDate()), sub: WEEKDAY_SHORT_AR[d.getUTCDay()], span: 1 })
      }
    }
    return cells
  }, [axis.days, scale, t])

  const infoTotalW = COLS.reduce(function (acc, c) { return acc + c.w }, 0)

  // ─── صف المخطط ───
  function renderRow(row: PlanRow) {
    var isDragging = dragPreview && dragPreview.id === row.id
    var sIdx = dayIndex(isDragging ? dragPreview!.start : row.startDate)
    var eIdx = dayIndex(isDragging ? dragPreview!.end : row.endDate)
    var left = sIdx * pxPerDay
    var width = Math.max((eIdx - sIdx + 1) * pxPerDay - 2, 6)
    var prog = row.progress
    var doneW = prog && row.tunnelLength > 0 ? Math.min(1, prog.actualMeters / row.tunnelLength) * width : 0
    var extLeft = eIdx * pxPerDay
    var extW = 0
    if (prog && prog.projectedEnd) {
      var peIdx = diffCalendarDays(axis.start, prog.projectedEnd)
      if (peIdx > eIdx) extW = Math.max((peIdx - eIdx) * pxPerDay - 2, 4)
    }
    var st = PLAN_STATUSES[row.status] || PLAN_STATUSES.on_track
    var conf = CONFIDENCE_LEVELS[row.confidence] || CONFIDENCE_LEVELS.gray
    var isDigging = row.activityType === 'digging'
    var actShort = row.activityLabel.length > 18 ? row.activityLabel.slice(0, 17) + '…' : row.activityLabel

    return (
      <div key={row.id} className="flex border-t border-border/60" style={{ height: ROW_H }}>
        {/* أعمدة البيانات المثبتة — الجهة اليسرى (مثبتة أثناء التمرير الأفقي) */}
        <div className="flex shrink-0 sticky left-0 z-20 bg-background border-r-2 border-border" style={{ width: infoTotalW }}>
          {COLS.map(function (c) {
            if (c.hide) return <div key={c.key} className={c.hide} style={{ width: c.w }} />
            var content: React.ReactNode = null
            if (c.key === 'machine') content = <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: row.machineColor }} /><span className="truncate text-xs font-semibold">{row.machineName}</span></span>
            else if (c.key === 'project') content = <span className="truncate text-xs">{row.projectName}</span>
            else if (c.key === 'location') content = <span className="truncate text-xs text-muted-foreground" title={row.location || ''}>{row.location || '—'}</span>
            else if (c.key === 'chainage') content = <span className="truncate text-[11px] text-muted-foreground" title={row.chainage || ''}>{row.chainage || '—'}</span>
            else if (c.key === 'length') content = <span className="text-xs font-medium">{fmtNum(row.tunnelLength, 2)}</span>
            else if (c.key === 'pipe') content = <span className="text-[11px] text-muted-foreground">{row.pipeDiameter || '—'}</span>
            else if (c.key === 'sleeve') content = <span className="text-[11px] text-muted-foreground">{row.sleeveDiameter || '—'}</span>
            else if (c.key === 'activity') content = (
              <span className="inline-flex items-center gap-1 min-w-0">
                <span className="truncate text-xs" title={row.activityLabel}>{actShort}</span>
                {isDigging && <span className={'h-2 w-2 rounded-full shrink-0 border ' + conf.dot} title={t('درجة الثقة في الإنتاج: ', 'Productivity confidence: ') + (isAr ? conf.ar : conf.en)} />}
                {row.statusOverride === 'suspended' && <span className="h-2 w-2 rounded-full bg-gray-500 shrink-0" title={t('متوقف', 'Suspended')} />}
              </span>
            )
            else if (c.key === 'remarks') content = <span className="truncate text-[11px] text-muted-foreground" title={row.remarks || ''}>{row.remarks || '—'}</span>
            else if (c.key === 'actions') content = canManage ? (
              <span className="inline-flex items-center gap-0.5">
                <button className="p-1 rounded hover:bg-muted" title={t('تعديل', 'Edit')} onClick={function () { openEdit(row) }}><Pencil className="h-3.5 w-3.5" /></button>
                <button className="p-1 rounded hover:bg-muted" title={t('الإصدارات', 'Versions')} onClick={function () { openVersions(row) }}><History className="h-3.5 w-3.5" /></button>
                <button className="p-1 rounded hover:bg-red-50 text-red-600" title={t('حذف', 'Delete')} onClick={function () { setDeleteFor(row) }}><Trash2 className="h-3.5 w-3.5" /></button>
              </span>
            ) : (
              <button className="p-1 rounded hover:bg-muted" title={t('التفاصيل', 'Details')} onClick={function () { setDetailsFor(row) }}><Info className="h-3.5 w-3.5" /></button>
            )
            return (
              <div key={c.key} className={'shrink-0 flex items-center px-1.5 overflow-hidden ' + (c.hide || '')} style={{ width: c.w }}>
                {content}
              </div>
            )
          })}
        </div>
        {/* المخطط الزمني */}
        <div className="relative shrink-0" style={{ width: timelineW, height: ROW_H }}>
          {/* خط تاريخ اليوم */}
          {axis.todayIndex >= 0 && axis.todayIndex < axis.days.length && (
            <div className="absolute top-0 bottom-0 w-0.5 bg-red-500/80 z-10" style={{ left: axis.todayIndex * pxPerDay + pxPerDay / 2 }}>
              <span className="absolute -top-0 text-[9px] font-bold text-red-600 bg-red-50 border border-red-300 rounded px-0.5 -translate-x-1/2 whitespace-nowrap">{t('اليوم', 'Today')}</span>
            </div>
          )}
          {/* الشريط */}
          <div
            className={'absolute rounded-md border shadow-sm overflow-hidden transition-shadow ' + (canManage ? 'cursor-grab active:cursor-grabbing ' : 'cursor-pointer ') + (st.dot === 'bg-red-500' ? 'ring-1 ring-red-400 ' : '')}
            style={{ left: left, width: width, top: 6, height: ROW_H - 14, background: row.machineColor, borderColor: row.machineColor }}
            onPointerDown={function (e) { onBarPointerDown(e, row, 'move') }}
            onPointerMove={onBarPointerMove}
            onPointerUp={onBarPointerUp}
            onClick={function () { if (!canManage || !dragRef.current) setDetailsFor(row) }}
            title={row.machineName + ' — ' + row.activityLabel + ' | ' + row.startDate + ' → ' + row.endDate}
          >
            {/* الجزء المتبقي (فاتح) */}
            {isDigging && doneW > 0 && doneW < width && (
              <div className="absolute inset-y-0 bg-white/25" style={{ left: doneW, width: width - doneW }} />
            )}
            {/* الجزء المنجز فعلياً (غامق) */}
            {isDigging && doneW > 0 && (
              <div className="absolute inset-y-0 left-0 bg-black/35" style={{ width: doneW }} />
            )}
            <div className="absolute inset-0 flex items-center px-1.5 pointer-events-none">
              <span className="text-[10px] font-semibold text-white drop-shadow-sm truncate">{actShort}</span>
            </div>
            {/* مقابض تغيير الطول */}
            {canManage && width > 24 && (
              <>
                <div className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize bg-white/40 hover:bg-white/70" onPointerDown={function (e) { onBarPointerDown(e, row, 'resizeL') }} onPointerMove={onBarPointerMove} onPointerUp={onBarPointerUp} />
                <div className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize bg-white/40 hover:bg-white/70" onPointerDown={function (e) { onBarPointerDown(e, row, 'resizeR') }} onPointerMove={onBarPointerMove} onPointerUp={onBarPointerUp} />
              </>
            )}
          </div>
          {/* امتداد التأخير الأحمر */}
          {extW > 0 && (
            <div className="absolute z-[5] rounded-sm border border-red-500 bg-red-500/80" style={{ left: extLeft, width: extW, top: 6, height: ROW_H - 14 }}
              title={t('امتداد متوقع للتأخير', 'Projected delay extension')}>
              <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-white whitespace-nowrap">{t('متأخر', 'Late')} {prog && prog.delayDays > 0 ? prog.delayDays + ' ' + t('يوم', 'd') : ''}</span>
            </div>
          )}
          {/* عدد أيام التأخير بجانب العمل */}
          {row.status === 'late' && prog && prog.delayDays > 0 && (
            <span className="absolute text-[10px] font-bold text-red-600 whitespace-nowrap z-10" style={{ left: extW > 0 ? extLeft + extW + 4 : left + width + 4, top: 12 }}>
              −{prog.delayDays} {t('يوم', 'd')}
            </span>
          )}
        </div>
      </div>
    )
  }

  function renderGroupHeader(key: string, color: string, rows: PlanRow[]) {
    var isOpen = !collapsed[key]
    var st = PLAN_STATUSES[worstStatus(rows.map(function (r) { return r.status }))] || PLAN_STATUSES.on_track
    return (
      <div key={'g-' + key} className="flex border-t border-border bg-muted/40" style={{ height: ROW_H }}>
        <div className="flex shrink-0 sticky left-0 z-20 bg-muted/40 border-r-2 border-border items-center gap-2 px-2" style={{ width: infoTotalW }}>
          <button className="p-0.5 rounded hover:bg-muted" onClick={function () { setCollapsed(function (c) { return { ...c, [key]: isOpen } }) }}>
            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
          <span className="h-3 w-3 rounded-full shrink-0 border border-white shadow" style={{ background: color }} />
          <span className="text-xs font-bold truncate">{viewMode === 'machine' ? t('ماكينة', 'Machine') + ' ' + key : key}</span>
          <Badge variant="outline" className="h-4 px-1 text-[10px]">{rows.length}</Badge>
        </div>
        <div className="flex-1 flex items-center gap-2 px-2 min-w-0" style={{ width: timelineW }}>
          <span className={'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ' + st.chip}><span className={'h-1.5 w-1.5 rounded-full ' + st.dot} />{isAr ? st.ar : st.en}</span>
          <span className="text-[10px] text-muted-foreground truncate">
            {t('من', 'From')} {fmtDateAr(rows[0].startDate)} — {t('إلى', 'To')} {fmtDateAr(rows[rows.length - 1].endDate)}
          </span>
        </div>
      </div>
    )
  }

  // ─── الرأس الزمني ───
  function renderTimelineHeader() {
    return (
      <div className="flex border-b-2 border-border bg-muted/60 sticky top-0 z-30">
        {/* رأس أعمدة البيانات */}
        <div className="flex shrink-0 sticky left-0 z-40 bg-muted/60 border-r-2 border-border" style={{ width: infoTotalW }}>
          {COLS.map(function (c) {
            return (
              <div key={c.key} className={'shrink-0 flex items-center justify-center px-1 text-[10px] font-bold text-muted-foreground ' + (c.hide || '')} style={{ width: c.w, height: 34 }}>
                {c.ar}
              </div>
            )
          })}
        </div>
        {/* رأس الزمن: شهور + أسابيع/أيام + تواريخ */}
        <div className="relative shrink-0" style={{ width: timelineW }}>
          <div className="flex border-b border-border/60" style={{ height: 18 }}>
            {headerMonths.map(function (m, i) {
              return <div key={i} className="shrink-0 text-[10px] font-bold text-center border-e border-border/60 bg-muted/30 truncate px-1" style={{ width: m.span * pxPerDay }}>{m.label}</div>
            })}
          </div>
          <div className="flex border-b border-border/60" style={{ height: 18 }}>
            {headerScale.map(function (c, i) {
              return (
                <div key={i} className={'shrink-0 text-[10px] text-center border-e border-border/60 leading-tight ' + (scale === 'week' ? 'bg-muted/20 font-semibold' : '')} style={{ width: c.span * pxPerDay }}>
                  <div className="truncate px-0.5">{c.label}</div>
                  {scale === 'week' && <div className="text-[8px] text-muted-foreground truncate px-0.5">{c.sub}</div>}
                </div>
              )
            })}
          </div>
          {scale === 'day' && (
            <div className="flex" style={{ height: 16 }}>
              {axis.days.map(function (d, i) {
                var isToday = i === axis.todayIndex
                var isWeekend = d.getUTCDay() === 5
                return (
                  <div key={i} className={'shrink-0 text-[9px] text-center border-e border-border/40 ' + (isToday ? 'bg-red-100 text-red-700 font-bold' : isWeekend ? 'bg-muted/40 text-muted-foreground' : '')} style={{ width: pxPerDay }}>
                    {d.getUTCDate()}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    )
  }

  const hasData = plans.length > 0

  return (
    <div className="space-y-4">
      {/* ─── العنوان ─── */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <GanttChart className="h-5 w-5 text-primary" />
              <div>
                <h1 className="text-base font-bold">{t('خطة عمل الماكينات', 'Machines Work Plan')}</h1>
                <p className="text-xs text-muted-foreground">
                  {t('مخطط زمني تفاعلي لأعمال الحفر — مشاهدة للجميع، والإدارة محصورة بحساب مدير الخطة', 'Interactive tunneling schedule — visible to everyone, managed by the plan manager only')}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {lastUpdate && (
                <span className="text-[11px] text-muted-foreground">
                  {t('آخر تحديث:', 'Last update:')} {lastUpdate.by ? lastUpdate.by + ' — ' : ''}{new Date(lastUpdate.at).toLocaleString(isAr ? 'ar' : 'en', { dateStyle: 'short', timeStyle: 'short' })}
                </span>
              )}
              <Button variant="outline" size="sm" onClick={function () { load() }} disabled={loading}>
                <RefreshCw className={'h-4 w-4' + (loading ? ' animate-spin' : '')} /> {t('تحديث', 'Refresh')}
              </Button>
              {canManage && (
                <>
                  <Button variant="outline" size="sm" onClick={function () { setColorDraft(Object.fromEntries(machines.map(function (m) { return [m.name, m.color] }))); setColorsDlg(true) }}>
                    <Palette className="h-4 w-4" /> {t('ألوان الماكينات', 'Machine colors')}
                  </Button>
                  <Button size="sm" onClick={openCreate}>
                    <Plus className="h-4 w-4" /> {t('إنشاء عمل جديد', 'New work item')}
                  </Button>
                </>
              )}
            </div>
          </div>
          {loadError && (
            <Alert variant="destructive" className="mt-3"><AlertDescription>{loadError}</AlertDescription></Alert>
          )}
        </CardContent>
      </Card>

      {/* ─── ملخص الماكينات: أين الآن؟ ما التالي؟ ─── */}
      {machineSummaries.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {machineSummaries.map(function (m) {
            var st = PLAN_STATUSES[m.status] || PLAN_STATUSES.on_track
            return (
              <Card key={m.name} className="shrink-0 w-56">
                <CardContent className="p-3 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold"><span className="h-2.5 w-2.5 rounded-full" style={{ background: m.color }} />{t('ماكينة', 'Machine')} {m.name}</span>
                    <span className={'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] ' + st.chip}><span className={'h-1.5 w-1.5 rounded-full ' + st.dot} />{isAr ? st.ar : st.en}</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {m.current ? (
                      <span><span className="font-medium text-foreground">{t('تعمل الآن في:', 'Now at:')}</span> {m.current.projectName}{m.current.location ? ' — ' + m.current.location : ''}</span>
                    ) : (
                      <span>{t('لا تعمل حالياً', 'Idle now')}</span>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {m.next && (parseDateOnly(m.next.startDate) as Date).getTime() > (parseDateOnly(today) as Date).getTime() ? (
                      <span><span className="font-medium text-foreground">{t('التالي:', 'Next:')}</span> {m.next.projectName} — {t('تبدأ', 'starts')} {fmtDateAr(m.next.startDate)}</span>
                    ) : (
                      <span>{t('لا أعمال قادمة مبرمجة', 'No scheduled upcoming works')}</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* ─── الفلاتر وأدوات العرض ─── */}
      <Card>
        <CardContent className="p-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border overflow-hidden">
              <button className={'px-3 py-1.5 text-xs font-medium inline-flex items-center gap-1 ' + (viewMode === 'machine' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')} onClick={function () { setViewMode('machine') }}><Rows3 className="h-3.5 w-3.5" /> {t('حسب الماكينة', 'By machine')}</button>
              <button className={'px-3 py-1.5 text-xs font-medium inline-flex items-center gap-1 ' + (viewMode === 'project' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')} onClick={function () { setViewMode('project') }}><LayoutList className="h-3.5 w-3.5" /> {t('حسب المشروع', 'By project')}</button>
            </div>
            <div className="flex rounded-lg border overflow-hidden">
              <button className={'px-3 py-1.5 text-xs font-medium inline-flex items-center gap-1 ' + (scale === 'day' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')} onClick={function () { setScale('day') }}><CalendarDays className="h-3.5 w-3.5" /> {t('يومي', 'Daily')}</button>
              <button className={'px-3 py-1.5 text-xs font-medium inline-flex items-center gap-1 ' + (scale === 'week' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')} onClick={function () { setScale('week') }}><CalendarRange className="h-3.5 w-3.5" /> {t('أسبوعي', 'Weekly')}</button>
            </div>
            <div className="flex items-center rounded-lg border overflow-hidden">
              <button className="px-2 py-1.5 hover:bg-muted" title={t('تصغير', 'Zoom out')} onClick={function () { setZoom(function (z) { return Math.max(0.6, +(z - 0.2).toFixed(1)) }) }}><ZoomOut className="h-3.5 w-3.5" /></button>
              <span className="px-1.5 text-[10px] text-muted-foreground">{Math.round(zoom * 100)}%</span>
              <button className="px-2 py-1.5 hover:bg-muted" title={t('تكبير', 'Zoom in')} onClick={function () { setZoom(function (z) { return Math.min(2.6, +(z + 0.2).toFixed(1)) }) }}><ZoomIn className="h-3.5 w-3.5" /></button>
            </div>
            <Separator orientation="vertical" className="h-6" />
            <Select value={fMachine} onValueChange={setFMachine}>
              <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('كل الماكينات', 'All machines')}</SelectItem>
                {machines.map(function (m) { return <SelectItem key={m.name} value={m.name}>{m.name}</SelectItem> })}
              </SelectContent>
            </Select>
            <Select value={fProject} onValueChange={setFProject}>
              <SelectTrigger className="h-8 w-[170px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('كل المشاريع', 'All projects')}</SelectItem>
                {Array.from(new Set(plans.map(function (p) { return p.projectName }))).map(function (n) { return <SelectItem key={n} value={n}>{n}</SelectItem> })}
              </SelectContent>
            </Select>
            <Select value={fStatus} onValueChange={setFStatus}>
              <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('كل الحالات', 'All statuses')}</SelectItem>
                {Object.keys(PLAN_STATUSES).map(function (k) { return <SelectItem key={k} value={k}>{isAr ? PLAN_STATUSES[k].ar : PLAN_STATUSES[k].en}</SelectItem> })}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1">
              <Input type="date" value={fFrom} onChange={function (e) { setFFrom(e.target.value) }} className="h-8 w-[135px] text-xs" title={t('من تاريخ', 'From date')} />
              <span className="text-[10px] text-muted-foreground">→</span>
              <Input type="date" value={fTo} onChange={function (e) { setFTo(e.target.value) }} className="h-8 w-[135px] text-xs" title={t('إلى تاريخ', 'To date')} />
            </div>
            <div className="relative">
              <Search className="h-3.5 w-3.5 absolute start-2 top-2 text-muted-foreground" />
              <Input value={query} onChange={function (e) { setQuery(e.target.value) }} placeholder={t('بحث: ماكينة، مشروع، موقع…', 'Search: machine, project, site…')} className="h-8 w-[180px] text-xs ps-7" />
            </div>
            {(fMachine !== 'all' || fProject !== 'all' || fStatus !== 'all' || fFrom || fTo || query) && (
              <Button variant="ghost" size="sm" className="h-8" onClick={function () { setFMachine('all'); setFProject('all'); setFStatus('all'); setFFrom(''); setFTo(''); setQuery('') }}>
                <X className="h-3.5 w-3.5" /> {t('مسح الفلاتر', 'Clear filters')}
              </Button>
            )}
          </div>

          {/* دليل الألوان والحالات */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border bg-muted/20 p-2">
            <span className="text-[10px] font-bold text-muted-foreground">{t('دليل الألوان:', 'Legend:')}</span>
            {machines.slice(0, 12).map(function (m) {
              return (
                <span key={m.name} className="inline-flex items-center gap-1 text-[10px]">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: m.color }} />{t('ماكينة', 'Machine')} {m.name}
                </span>
              )
            })}
            <span className="text-[10px] text-muted-foreground">|</span>
            {Object.keys(CONFIDENCE_LEVELS).map(function (k) {
              var c = CONFIDENCE_LEVELS[k]
              return (
                <span key={k} className="inline-flex items-center gap-1 text-[10px]">
                  <span className={'h-2.5 w-2.5 rounded-full border ' + c.dot} />{isAr ? c.ar.split(' — ')[0] : c.en.split(' — ')[0]}
                </span>
              )
            })}
            <span className="text-[10px] text-muted-foreground">|</span>
            <span className="inline-flex items-center gap-1 text-[10px]"><span className="h-2.5 w-10 rounded bg-black/35 inline-block" />{t('المنجز فعلياً', 'Actual done')}</span>
            <span className="inline-flex items-center gap-1 text-[10px]"><span className="h-2.5 w-10 rounded bg-red-500/80 inline-block" />{t('امتداد التأخير المتوقع', 'Projected delay')}</span>
            <span className="inline-flex items-center gap-1 text-[10px]"><span className="h-3 w-0.5 bg-red-500 inline-block" />{t('تاريخ اليوم', 'Today')}</span>
          </div>
        </CardContent>
      </Card>

      {/* ─── المخطط ─── */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-24"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
          ) : !hasData ? (
            <div className="py-16 text-center space-y-2">
              <GanttChart className="h-10 w-10 mx-auto text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">{t('لا توجد أعمال في الخطة بعد', 'No works in the plan yet')}</p>
              {canManage && <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4" /> {t('إنشاء أول عمل', 'Create the first work item')}</Button>}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-14 text-center text-sm text-muted-foreground">{t('لا نتائج مطابقة للفلاتر', 'No results match the filters')}</div>
          ) : (
            <div className="overflow-auto max-h-[62vh]" dir="ltr">
              <div style={{ width: infoTotalW + timelineW }}>
                {renderTimelineHeader()}
                {groups.map(function (g) {
                  return (
                    <div key={g.key}>
                      {renderGroupHeader(g.key, g.color, g.rows)}
                      {!collapsed[g.key] && g.rows.map(function (r) { return renderRow(r) })}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── ملاحظة الصلاحيات ─── */}
      <p className="text-[11px] text-muted-foreground px-1">
        {canManage
          ? t('أنت مدير الخطة: يمكنك إنشاء الأعمال وتعديلها وحذفها وسحب الأشرطة الزمنية وتغيير الألوان والرجوع للإصدارات السابقة — كل تعديل يحفظ الإصدار السابق باسمك وتاريخه تلقائياً.', 'You are the plan manager: create/edit/delete works, drag bars, change colors and restore versions — every edit auto-saves the previous version under your name and time.')
          : t('لديك صلاحية المشاهدة فقط — إنشاء وتعديل الخطة محصور بحساب مدير الخطة الممنوح له من إدارة المستخدمين.', 'View-only access — plan management is restricted to the plan manager account granted from user management.')}
      </p>

      {/* ═══ نافذة الإنشاء / التعديل ═══ */}
      <Dialog open={formOpen} onOpenChange={function (o) { if (!o) setFormOpen(false) }}>
        <DialogContent className="sm:max-w-2xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-start flex items-center gap-2">
              <GanttChart className="h-4 w-4" />
              {form.id ? t('تعديل عمل في الخطة', 'Edit plan work item') : t('إنشاء عمل جديد في الخطة', 'Create new plan work item')}
            </DialogTitle>
            <DialogDescription className="text-start">
              {t('بيانات العمل الكاملة: الماكينة، المشروع، الموقع، Chainage، الأطوال والأقطار، النشاط، الملاحظات — والحساب الهندسي يربط الطول بالوقت ومتوسط الإنتاج.', 'Full work details with engineering math linking length, time and expected productivity.')}
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">{t('رقم/اسم الماكينة *', 'Machine name/No. *')}</Label>
              <Input value={form.machineName} onChange={function (e) { setForm({ ...form, machineName: e.target.value }) }} placeholder={t('مثال: 36', 'e.g. 36')} list="mp-machines" />
              <datalist id="mp-machines">{machines.map(function (m) { return <option key={m.name} value={m.name} /> })}</datalist>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t('لون الماكينة', 'Machine color')}</Label>
              <div className="flex items-center gap-2">
                <input type="color" value={form.machineColor} onChange={function (e) { setForm({ ...form, machineColor: e.target.value }) }} className="h-9 w-12 rounded border cursor-pointer" />
                <span className="text-[11px] text-muted-foreground">{t('يظهر على شريط هذا العمل — توحيد لون الماكينة كاملة من «ألوان الماكينات»', 'Shown on this bar — unify the machine color from "Machine colors"')}</span>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t('اسم المشروع *', 'Project name *')}</Label>
              <Input value={form.projectName} onChange={function (e) { setForm({ ...form, projectName: e.target.value }) }} placeholder={t('اسم المشروع', 'Project name')} list="mp-projects" />
              <datalist id="mp-projects">{projects.map(function (p) { return <option key={p.id} value={p.name} /> })}</datalist>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t('الموقع / رقم التقاطع والخط', 'Site / intersection & line')}</Label>
              <Input value={form.location} onChange={function (e) { setForm({ ...form, location: e.target.value }) }} placeholder={t('مثال: Branch M-3', 'e.g. Branch M-3')} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Chainage</Label>
              <Input value={form.chainage} onChange={function (e) { setForm({ ...form, chainage: e.target.value }) }} placeholder={t('مثال: 8+857', 'e.g. 8+857')} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t('طول النفق (متر)', 'Tunnel length (m)')}</Label>
              <Input type="number" min="0" step="0.01" value={form.tunnelLength} onChange={function (e) { setForm({ ...form, tunnelLength: e.target.value }) }} placeholder={t('مثال: 30', 'e.g. 30')} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t('قطر الأنبوب (مم)', 'Pipe diameter (mm)')}</Label>
              <Input value={form.pipeDiameter} onChange={function (e) { setForm({ ...form, pipeDiameter: e.target.value }) }} placeholder={t('مثال: 630', 'e.g. 630')} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t('قطر Sleeve Pipe (مم)', 'Sleeve pipe diameter (mm)')}</Label>
              <Input value={form.sleeveDiameter} onChange={function (e) { setForm({ ...form, sleeveDiameter: e.target.value }) }} placeholder={t('مثال: 1000', 'e.g. 1000')} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t('نوع النشاط *', 'Activity type *')}</Label>
              <Select value={form.activityType} onValueChange={function (v) { setForm({ ...form, activityType: v }) }}>
                <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.keys(ACTIVITY_TYPES).map(function (k) { return <SelectItem key={k} value={k}>{isAr ? ACTIVITY_TYPES[k].ar : ACTIVITY_TYPES[k].en}</SelectItem> })}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{form.activityType === 'custom' ? t('اسم النشاط المخصص *', 'Custom activity name *') : t('تسمية معروضة بديلة (اختياري)', 'Alternative display label (optional)')}</Label>
              <Input value={form.activityName} onChange={function (e) { setForm({ ...form, activityName: e.target.value }) }} placeholder={form.activityType === 'custom' ? t('مثال: تجارب ضغط', 'e.g. Pressure tests') : ''} />
            </div>
          </div>

          {/* ── الحساب الهندسي — شريط الحفر فقط ── */}
          {form.activityType === 'digging' && (
            <div className="rounded-lg border bg-muted/20 p-3 space-y-3">
              <div className="flex items-center gap-2">
                <Timer className="h-4 w-4 text-primary" />
                <span className="text-xs font-bold">{t('الربط الحسابي: الطول × الوقت × متوسط الإنتاج', 'Engineering link: length × time × productivity')}</span>
              </div>
              <div className="flex gap-2">
                <button className={'flex-1 rounded-lg border px-3 py-2 text-start ' + (form.planningMode === 'by_rate' ? 'border-primary bg-primary/5' : '')} onClick={function () { setForm({ ...form, planningMode: 'by_rate' }) }}>
                  <div className="text-xs font-semibold">{t('أ) حسب متوسط الإنتاج', 'A) By productivity rate')}</div>
                  <div className="text-[10px] text-muted-foreground">{t('أدخل الطول + البداية + الإنتاج المتوقع — يحسب النظام أيام الحفر وتاريخ النهاية', 'Enter length + start + rate — days and end date auto-calculated')}</div>
                </button>
                <button className={'flex-1 rounded-lg border px-3 py-2 text-start ' + (form.planningMode === 'by_end_date' ? 'border-primary bg-primary/5' : '')} onClick={function () { setForm({ ...form, planningMode: 'by_end_date' }) }}>
                  <div className="text-xs font-semibold">{t('ب) حسب تاريخ الانتهاء', 'B) By end date')}</div>
                  <div className="text-[10px] text-muted-foreground">{t('أدخل الطول + البداية + النهاية — يحسب النظام الإنتاج المطلوب يومياً', 'Enter length + start + end — required daily rate auto-calculated')}</div>
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('بداية الحفر *', 'Digging start *')}</Label>
                  <Input type="date" value={form.startDate} onChange={function (e) { setForm({ ...form, startDate: e.target.value }) }} />
                </div>
                {form.planningMode === 'by_rate' ? (
                  <div className="space-y-1.5">
                    <Label className="text-xs">{t('متوسط الإنتاج المتوقع (م/يوم) *', 'Expected avg rate (m/day) *')}</Label>
                    <Input type="number" min="0.01" step="0.01" value={form.avgRate} onChange={function (e) { setForm({ ...form, avgRate: e.target.value }) }} placeholder={t('مثال: 1.5', 'e.g. 1.5')} />
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label className="text-xs">{t('نهاية الحفر المخططة *', 'Planned digging end *')}</Label>
                    <Input type="date" value={form.endDate} onChange={function (e) { setForm({ ...form, endDate: e.target.value }) }} />
                  </div>
                )}
              </div>
              {form.planningMode === 'by_rate' && (
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('تاريخ النهاية — محسوب تلقائياً', 'End date — auto-calculated')}</Label>
                  <Input value={liveCalc.computedEnd ? fmtDateAr(toISODate(liveCalc.computedEnd)) : '—'} readOnly className="bg-muted/40" />
                </div>
              )}
              {liveCalc.ok && (
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg border bg-background p-2">
                    <div className="text-[10px] text-muted-foreground">{form.planningMode === 'by_rate' ? t('عدد أيام الحفر', 'Digging days') : t('أيام العمل بالفترة', 'Working days in period')}</div>
                    <div className="text-sm font-bold">{liveCalc.diggingDays}</div>
                  </div>
                  <div className="rounded-lg border bg-background p-2">
                    <div className="text-[10px] text-muted-foreground">{t('الإنتاج المطلوب (م/يوم)', 'Required rate (m/day)')}</div>
                    <div className="text-sm font-bold">{fmtNum(liveCalc.requiredRate > 0 ? liveCalc.requiredRate : null, 2)}</div>
                  </div>
                  <div className="rounded-lg border bg-background p-2">
                    <div className="text-[10px] text-muted-foreground">{t('الفرق: المدخل − المطلوب', 'Gap: entered − required')}</div>
                    <div className="text-sm font-bold">{liveCalc.feasible === null ? '—' : (liveCalc.rateGap >= 0 ? '+' : '') + fmtNum(liveCalc.rateGap, 2)}</div>
                  </div>
                </div>
              )}
              {form.planningMode === 'by_end_date' && liveCalc.feasible !== null && (
                <Alert variant={liveCalc.feasible ? 'default' : 'destructive'}>
                  <TriangleAlert className="h-4 w-4" />
                  <AlertDescription className="text-xs">
                    {liveCalc.feasible
                      ? t('الخطة قابلة للتحقيق: متوسط الإنتاج المدخل يغطي المطلوب (مثال الاختبار: 30 م ÷ 1.5 م/يوم = 20 يوم عمل).', 'Plan is achievable: the entered rate covers the required rate (test case: 30 m ÷ 1.5 m/day = 20 working days).')
                      : t('الخطة تحتاج تعديل: متوسط الإنتاج المدخل أقل من المطلوب لإنهاء العمل في التاريخ المحدد وفق أيام العمل الفعلية.', 'Plan needs adjustment: the entered rate is below the rate required to finish on time per actual working days.')}
                    {' '}{t('المطلوب:', 'Required:')} {fmtNum(liveCalc.requiredRate, 2)} — {t('المدخل:', 'Entered:')} {fmtNum(liveCalc.enteredRate, 2)}
                  </AlertDescription>
                </Alert>
              )}

              {/* تقويم العمل: الإجازات والورديات */}
              <div className="space-y-2 border-t pt-2">
                <Label className="text-xs">{t('تقويم المشروع لهذا العمل — أيام الإجازة والورديات', 'Work calendar — holidays & shifts')}</Label>
                <div className="flex flex-wrap gap-1">
                  {WEEKDAY_NAMES_AR.map(function (d, i) {
                    var on = form.holidays.weekdays.indexOf(i) !== -1
                    return (
                      <button key={i} className={'rounded-full border px-2 py-0.5 text-[10px] ' + (on ? 'bg-red-100 border-red-300 text-red-700' : 'hover:bg-muted')}
                        onClick={function () {
                          setForm(function (f) {
                            var wd = f.holidays.weekdays.slice()
                            var idx = wd.indexOf(i)
                            if (idx === -1) wd.push(i); else wd.splice(idx, 1)
                            return { ...f, holidays: { ...f.holidays, weekdays: wd } }
                          })
                        }}>
                        {d}
                      </button>
                    )
                  })}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Select value={form.holidays.shift} onValueChange={function (v) { setForm({ ...form, holidays: { ...form.holidays, shift: v as 'single' | 'day_night' } }) }}>
                    <SelectTrigger className="h-8 w-[180px] text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="single">{t('وردية نهارية واحدة', 'Single day shift')}</SelectItem>
                      <SelectItem value="day_night">{t('حفر نهاري وليلي (Day+Night)', 'Day + Night digging')}</SelectItem>
                    </SelectContent>
                  </Select>
                  <span className="text-[10px] text-muted-foreground">{t('أيام التجهيز والرفع لا تدخل في أيام إنتاج الحفر — تُسجل كأعمال مستقلة', 'Mobilization/demobilization days never count as digging production days')}</span>
                </div>
              </div>

              {/* درجة الثقة */}
              <div className="space-y-1.5 border-t pt-2">
                <Label className="text-xs">{t('درجة الثقة في متوسط الإنتاج المتوقع', 'Confidence in expected productivity')}</Label>
                <div className="flex flex-wrap gap-1.5">
                  {Object.keys(CONFIDENCE_LEVELS).map(function (k) {
                    var c = CONFIDENCE_LEVELS[k]
                    var on = form.confidence === k
                    return (
                      <button key={k} className={'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ' + (on ? c.chip + ' font-semibold' : 'hover:bg-muted')}
                        onClick={function () { setForm({ ...form, confidence: k }) }}>
                        <span className={'h-2 w-2 rounded-full ' + c.dot} />{isAr ? c.ar : c.en}
                      </button>
                    )
                  })}
                </div>
                <p className="text-[10px] text-muted-foreground">{t('شارة مستقلة بجانب متوسط الإنتاج — منفصلة بصرياً عن لون الماكينة وحالة التنفيذ.', 'Independent badge next to the rate — visually separate from machine color and execution status.')}</p>
              </div>
            </div>
          )}

          {form.activityType !== 'digging' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">{t('بداية العمل', 'Start date')}</Label>
                <Input type="date" value={form.startDate} onChange={function (e) { setForm({ ...form, startDate: e.target.value }) }} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t('نهاية العمل', 'End date')}</Label>
                <Input type="date" value={form.endDate} onChange={function (e) { setForm({ ...form, endDate: e.target.value }) }} />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">{t('ربط بخط الحفر (لسحب الإنجاز تلقائياً)', 'Link to drive line (auto progress)')}</Label>
              <Select value={form.driveLineId || 'none'} onValueChange={function (v) { setForm({ ...form, driveLineId: v === 'none' ? '' : v }) }}>
                <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('بدون ربط', 'No link')}</SelectItem>
                  {lines.map(function (l) { return <SelectItem key={l.id} value={l.id}>{l.label}</SelectItem> })}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground">{t('الربط يسحب الأمتار المنجزة من التقارير اليومية المعتمدة تلقائياً — بلا إعادة إدخال.', 'The link pulls completed meters from approved daily reports automatically — no re-entry.')}</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t('ترتيب العمل داخل الماكينة', 'Sort order within machine')}</Label>
              <Input type="number" min="0" max="999" value={form.sortIndex} onChange={function (e) { setForm({ ...form, sortIndex: e.target.value }) }} />
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label className="text-xs">{t('الملاحظات', 'Remarks')}</Label>
              <Textarea rows={2} value={form.remarks} onChange={function (e) { setForm({ ...form, remarks: e.target.value }) }} placeholder={t('مثال: SEDE Scope', 'e.g. SEDE Scope')} />
            </div>
            {form.id && (
              <div className="space-y-1.5 col-span-2">
                <Label className="text-xs">{t('سبب التعديل (يُحفظ مع الإصدار)', 'Change reason (saved with the version)')}</Label>
                <Input value={form.changeNote} onChange={function (e) { setForm({ ...form, changeNote: e.target.value }) }} placeholder={t('مثال: تعديل الإنتاج بعد تجارب الحفر', 'e.g. rate revised after trials')} />
              </div>
            )}
            <div className="flex items-center justify-between rounded-lg border p-2.5 col-span-2">
              <div>
                <div className="text-xs font-medium">{t('إيقاف مؤقت (حالة متوقف)', 'Suspend (suspended status)')}</div>
                <div className="text-[10px] text-muted-foreground">{t('تعليق يدوي — يظهر بشارة «متوقف» حتى إلغائه', 'Manual flag — shows "Suspended" badge until cleared')}</div>
              </div>
              <Switch checked={form.statusOverride} onCheckedChange={function (v) { setForm({ ...form, statusOverride: v }) }} />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={function () { setFormOpen(false) }}>{t('إلغاء', 'Cancel')}</Button>
            <Button onClick={function () { saveForm(false) }} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {form.id ? t('حفظ التعديل', 'Save changes') : t('إنشاء العمل', 'Create work item')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ نافذة تعارض الماكينة ═══ */}
      <Dialog open={!!conflictDlg} onOpenChange={function (o) { if (!o) setConflictDlg(null) }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-start flex items-center gap-2 text-red-600">
              <TriangleAlert className="h-4 w-4" /> {t('تعارض في جدولة الماكينة', 'Machine scheduling conflict')}
            </DialogTitle>
            <DialogDescription className="text-start">
              {t('الماكينة نفسها مبرمجة في مشروع أو موقع آخر خلال الفترة الزمنية نفسها:', 'The same machine is scheduled on another project or site within the same period:')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {(conflictDlg ? conflictDlg.conflicts : []).map(function (c) {
              return (
                <div key={c.id} className="rounded-lg border border-red-200 bg-red-50/60 p-2.5 text-xs space-y-0.5">
                  <div className="font-semibold">{t('ماكينة', 'Machine')} {c.machineName} — {c.activityLabel}</div>
                  <div className="text-muted-foreground">{c.projectName}{c.location ? ' — ' + c.location : ''}</div>
                  <div className="text-muted-foreground">{fmtDateAr(c.startDate)} ← {fmtDateAr(c.endDate)}</div>
                </div>
              )
            })}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={function () { setConflictDlg(null) }}>{t('رجوع للتعديل', 'Back to edit')}</Button>
            <Button variant="destructive" onClick={confirmConflictsSave} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t('تأكيد الحفظ رغم التعارض', 'Save despite conflict')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ نافذة إزاحة الأعمال التالية ═══ */}
      <Dialog open={!!shiftDlg} onOpenChange={function (o) { if (!o) setShiftDlg(null) }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-start flex items-center gap-2">
              <CalendarRange className="h-4 w-4" /> {t('تحديث الأعمال التالية للماكينة', 'Update following machine works')}
            </DialogTitle>
            <DialogDescription className="text-start">
              {t('تغيُّر مدة العمل المصدر بمقدار', 'The source work duration changed by')} <b>{shiftDlg ? (shiftDlg.deltaDays > 0 ? '+' : '') + shiftDlg.deltaDays : 0} {t('يوم', 'days')}</b>.
              {t('هل تريد إزاحة الأعمال التالية المرتبطة بنفس الماكينة بنفس المقدار؟ كل إزاحة تُحفظ في سجل الإصدارات.', 'Shift the following works of the same machine by the same amount? Every shift is saved in the versions log.')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-56 overflow-y-auto">
            {(shiftDlg ? shiftDlg.followUps : []).map(function (f) {
              return (
                <div key={f.id} className="rounded-lg border p-2.5 text-xs space-y-0.5">
                  <div className="font-semibold">{f.activityLabel} — {f.projectName}{f.location ? ' (' + f.location + ')' : ''}</div>
                  <div className="text-muted-foreground">
                    {fmtDateAr(f.startDate)} ← {fmtDateAr(f.endDate)}
                    {' '}⇐ {fmtDateAr(f.suggestedStartDate)} ← {fmtDateAr(f.suggestedEndDate)}
                  </div>
                </div>
              )
            })}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={function () { setShiftDlg(null) }}>{t('لا، أبقيها كما هي', 'No, keep as is')}</Button>
            <Button onClick={applyShift} disabled={busyId === 'shift'}>
              {busyId === 'shift' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t('نعم، أزح الأعمال التالية', 'Yes, shift following works')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ نافذة التفاصيل ═══ */}
      <Dialog open={!!detailsFor} onOpenChange={function (o) { if (!o) setDetailsFor(null) }}>
        <DialogContent className="sm:max-w-xl max-h-[92vh] overflow-y-auto">
          {detailsFor && (
            <>
              <DialogHeader>
                <DialogTitle className="text-start flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full" style={{ background: detailsFor.machineColor }} />
                  {t('ماكينة', 'Machine')} {detailsFor.machineName} — {detailsFor.activityLabel}
                </DialogTitle>
                <DialogDescription className="text-start">{detailsFor.projectName}</DialogDescription>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                <div className="flex flex-wrap gap-1.5">
                  {(() => {
                    var st = PLAN_STATUSES[detailsFor.status] || PLAN_STATUSES.on_track
                    var cf = CONFIDENCE_LEVELS[detailsFor.confidence] || CONFIDENCE_LEVELS.gray
                    return (
                      <>
                        <span className={'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs ' + st.chip}><span className={'h-2 w-2 rounded-full ' + st.dot} />{isAr ? st.ar : st.en}</span>
                        {detailsFor.activityType === 'digging' && <span className={'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs ' + cf.chip}><span className={'h-2 w-2 rounded-full ' + cf.dot} />{t('الثقة:', 'Confidence:')} {isAr ? cf.ar : cf.en}</span>}
                      </>
                    )
                  })()}
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg border p-2"><div className="text-muted-foreground text-[10px]">{t('الموقع / التقاطع', 'Site / intersection')}</div><div>{detailsFor.location || '—'}</div></div>
                  <div className="rounded-lg border p-2"><div className="text-muted-foreground text-[10px]">Chainage</div><div>{detailsFor.chainage || '—'}</div></div>
                  <div className="rounded-lg border p-2"><div className="text-muted-foreground text-[10px]">{t('طول النفق', 'Tunnel length')}</div><div>{fmtNum(detailsFor.tunnelLength, 2)} {t('م', 'm')}</div></div>
                  <div className="rounded-lg border p-2"><div className="text-muted-foreground text-[10px]">{t('الأقطار (أنبوب / Sleeve)', 'Diameters (pipe / sleeve)')}</div><div>{detailsFor.pipeDiameter || '—'} / {detailsFor.sleeveDiameter || '—'}</div></div>
                  <div className="rounded-lg border p-2"><div className="text-muted-foreground text-[10px]">{t('الفترة المخططة', 'Planned period')}</div><div>{fmtDateAr(detailsFor.startDate)} ← {fmtDateAr(detailsFor.endDate)}</div></div>
                  <div className="rounded-lg border p-2"><div className="text-muted-foreground text-[10px]">{t('عدد أيام الحفر المخططة', 'Planned digging days')}</div><div>{detailsFor.diggingDays || '—'}</div></div>
                  {detailsFor.activityType === 'digging' && (
                    <>
                      <div className="rounded-lg border p-2"><div className="text-muted-foreground text-[10px]">{t('متوسط الإنتاج (متوقع / مطلوب)', 'Avg rate (expected / required)')}</div><div>{fmtNum(detailsFor.avgRate, 2)} / {fmtNum(detailsFor.requiredRate, 2)} {t('م/يوم', 'm/day')}</div></div>
                      <div className="rounded-lg border p-2"><div className="text-muted-foreground text-[10px]">{t('خط الحفر المرتبط', 'Linked drive line')}</div><div>{detailsFor.driveLine ? detailsFor.driveLine.projectName + ' — ' + detailsFor.driveLine.lineNumber : t('غير مرتبط', 'Not linked')}</div></div>
                    </>
                  )}
                </div>
                {detailsFor.progress && detailsFor.activityType === 'digging' && (
                  <div>
                    <div className="text-xs font-bold mb-1.5">{t('متابعة الإنجاز (سحب تلقائي من التقارير اليومية)', 'Progress (auto-pulled from daily reports)')}</div>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div className="rounded-lg border p-2"><div className="text-muted-foreground text-[10px]">{t('المتوقع حتى اليوم', 'Expected to date')}</div><div className="font-semibold">{fmtNum(detailsFor.progress.expectedToDate, 1)} {t('م', 'm')}</div></div>
                      <div className="rounded-lg border p-2"><div className="text-muted-foreground text-[10px]">{t('الفعلي', 'Actual')}</div><div className="font-semibold">{fmtNum(detailsFor.progress.actualMeters, 1)} {t('م', 'm')}</div></div>
                      <div className="rounded-lg border p-2"><div className="text-muted-foreground text-[10px]">{t('الفرق (متأخر)', 'Gap (behind)')}</div><div className="font-semibold">{fmtNum(detailsFor.progress.metersBehind, 1)} {t('م', 'm')}</div></div>
                      <div className="rounded-lg border p-2"><div className="text-muted-foreground text-[10px]">{t('نسبة الإنجاز', 'Completion %')}</div><div className="font-semibold">{fmtNum(detailsFor.progress.pct, 0)}%</div></div>
                      <div className="rounded-lg border p-2"><div className="text-muted-foreground text-[10px]">{t('النهاية المتوقعة', 'Projected end')}</div><div className="font-semibold">{detailsFor.progress.projectedEnd ? fmtDateAr(toISODate(detailsFor.progress.projectedEnd)) : '—'}</div></div>
                      <div className="rounded-lg border p-2"><div className="text-muted-foreground text-[10px]">{t('أيام التأخير', 'Delay days')}</div><div className="font-semibold">{detailsFor.progress.delayDays > 0 ? detailsFor.progress.delayDays : '—'}</div></div>
                    </div>
                    {detailsFor.progress.pct > 0 && (
                      <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: Math.min(100, detailsFor.progress.pct) + '%', background: detailsFor.machineColor }} />
                      </div>
                    )}
                    <p className="text-[10px] text-muted-foreground mt-1">{detailsFor.actualWindowNote || t('اربط العمل بخط حفر لسحب إنجازه تلقائياً', 'Link the work to a drive line to auto-pull its progress')}</p>
                    <p className="text-[10px] text-muted-foreground">{t('الخطة الأصلية لا تتغير تلقائياً عند التأخير — النهاية المتوقعة معروضة للمقارنة فقط.', 'The original plan never auto-changes on delay — the projected end is shown for comparison only.')}</p>
                  </div>
                )}
                {detailsFor.remarks && <p className="text-xs text-muted-foreground">{t('الملاحظات:', 'Remarks:')} {detailsFor.remarks}</p>}
                <Separator />
                <p className="text-[11px] text-muted-foreground">
                  {t('آخر تحديث:', 'Last update:')} {detailsFor.updatedByName || detailsFor.createdByName || '—'} — {new Date(detailsFor.lastUpdatedAt).toLocaleString(isAr ? 'ar' : 'en', { dateStyle: 'short', timeStyle: 'short' })}
                  {' '}· {t('الإصدار الحالي:', 'Current version:')} {detailsFor.currentVersion}
                </p>
              </div>
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={function () { setDetailsFor(null) }}>{t('إغلاق', 'Close')}</Button>
                <Button variant="outline" onClick={function () { var r = detailsFor; setDetailsFor(null); openVersions(r) }}><History className="h-4 w-4" /> {t('الإصدارات', 'Versions')}</Button>
                {canManage && (
                  <>
                    <Button variant="destructive" onClick={function () { setDeleteFor(detailsFor) }}><Trash2 className="h-4 w-4" /> {t('حذف', 'Delete')}</Button>
                    <Button onClick={function () { var r = detailsFor; setDetailsFor(null); openEdit(r) }}><Pencil className="h-4 w-4" /> {t('تعديل', 'Edit')}</Button>
                  </>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ═══ نافذة الإصدارات ═══ */}
      <Dialog open={!!versionsFor} onOpenChange={function (o) { if (!o) setVersionsFor(null) }}>
        <DialogContent className="sm:max-w-xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-start flex items-center gap-2">
              <History className="h-4 w-4" /> {t('سجل الإصدارات — الحالة قبل كل تعديل', 'Versions — state before every change')}
            </DialogTitle>
            <DialogDescription className="text-start">
              {t('حفظ الإصدار السابق تلقائياً يمنع تغيير التواريخ من إخفاء التأخير السابق — والعرض الافتراضي دائماً للخطة الحالية.', 'Auto-saving the previous version prevents date edits from hiding past delays — the current plan is always the default view.')}
            </DialogDescription>
          </DialogHeader>
          {versionsLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : versions.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">{t('لا إصدارات محفوظة بعد — تُنشأ تلقائياً مع كل تعديل', 'No saved versions yet — created automatically with every edit')}</p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {versions.map(function (v) {
                return (
                  <div key={v.id} className="rounded-lg border p-2.5 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold">{t('الإصدار', 'Version')} {v.version}</span>
                      {canManage && (
                        <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={function () { restoreVersion(v.version) }} disabled={busyId === 'restore'}>
                          {busyId === 'restore' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3" />}
                          {t('استرجاع', 'Restore')}
                        </Button>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {v.changedByName || '—'} — {new Date(v.changedAt).toLocaleString(isAr ? 'ar' : 'en', { dateStyle: 'short', timeStyle: 'short' })}
                      {v.note ? ' · ' + v.note : ''}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {v.snapshot.projectName} — {v.snapshot.startDate} ← {v.snapshot.endDate}
                      {' '}· {t('الطول:', 'Length:')} {fmtNum(v.snapshot.tunnelLength, 2)} {t('م', 'm')}
                      {v.snapshot.diggingDays ? ' · ' + t('أيام الحفر:', 'Digging days:') + ' ' + v.snapshot.diggingDays : ''}
                      {v.snapshot.avgRate ? ' · ' + t('الإنتاج:', 'Rate:') + ' ' + fmtNum(v.snapshot.avgRate, 2) : ''}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ═══ نافذة ألوان الماكينات ═══ */}
      <Dialog open={colorsDlg} onOpenChange={function (o) { if (!o) setColorsDlg(false) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-start flex items-center gap-2"><Palette className="h-4 w-4" /> {t('ألوان الماكينات', 'Machine colors')}</DialogTitle>
            <DialogDescription className="text-start">{t('لكل ماكينة لون خاص يظهر على كل أعمالها في المخطط وفي الدليل — التغيير يطبق على كل أعمال الماكينة فوراً.', 'Each machine has its own color applied to all its bars and the legend — changes apply to all its works instantly.')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {machines.map(function (m) {
              return (
                <div key={m.name} className="flex items-center justify-between gap-2 rounded-lg border p-2">
                  <span className="text-xs font-semibold">{t('ماكينة', 'Machine')} {m.name} <span className="text-[10px] text-muted-foreground">({m.count} {t('عمل', 'works')})</span></span>
                  <div className="flex items-center gap-1.5">
                    <input type="color" value={colorDraft[m.name] || m.color} onChange={function (e) { setColorDraft(function (d) { return { ...d, [m.name]: e.target.value } }) }} className="h-8 w-10 rounded border cursor-pointer" />
                    <Button size="sm" variant="outline" className="h-8 text-[11px]" onClick={function () { saveMachineColor(m.name) }} disabled={busyId === 'color-' + m.name}>
                      {busyId === 'color-' + m.name ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                      {t('حفظ', 'Save')}
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        </DialogContent>
      </Dialog>

      {/* ═══ تأكيد الحذف ═══ */}
      <Dialog open={!!deleteFor} onOpenChange={function (o) { if (!o) setDeleteFor(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-start flex items-center gap-2 text-red-600"><Trash2 className="h-4 w-4" /> {t('حذف عمل من الخطة', 'Delete plan work item')}</DialogTitle>
            <DialogDescription className="text-start">
              {deleteFor ? t('ماكينة', 'Machine') + ' ' + deleteFor.machineName + ' — ' + deleteFor.activityLabel + ' (' + deleteFor.projectName + ')' : ''}
              {' — '}{t('سيُسجل الحذف في سجل التدقيق باسمك.', 'Deletion is logged in the audit log under your name.')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={function () { setDeleteFor(null) }}>{t('إلغاء', 'Cancel')}</Button>
            <Button variant="destructive" onClick={doDelete} disabled={busyId === (deleteFor ? deleteFor.id : '')}>
              {busyId === (deleteFor ? deleteFor.id : '') ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t('تأكيد الحذف', 'Confirm delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
