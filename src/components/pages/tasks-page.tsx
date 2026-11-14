'use client'

import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle
} from '@/components/ui/dialog'
import {
  ListChecks, Plus, Paperclip, History, Play, PauseCircle, Send, CheckCircle2,
  Undo2, XCircle, Loader2, Clock, AlertTriangle, Filter, BarChart3, Download, ShieldCheck,
  Search, BellRing, CalendarClock, ArrowUpDown, NotebookPen, Pencil, Trash2, FileText
} from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { authedFetch } from '@/lib/api-client'
import { toast } from 'sonner'

// ─── ثوابت العرض ────────────────────────────────────────────────

const STATUS: Record<string, { ar: string; en: string; chip: string; dot: string }> = {
  new:          { ar: 'جديدة',              en: 'New',              chip: 'bg-slate-100 text-slate-700 border-slate-300',        dot: 'bg-slate-400' },
  in_progress:  { ar: 'قيد التنفيذ',        en: 'In Progress',      chip: 'bg-blue-50 text-blue-700 border-blue-300',            dot: 'bg-blue-500' },
  waiting:      { ar: 'بانتظار جهة أخرى',   en: 'Waiting (3rd party)', chip: 'bg-amber-50 text-amber-700 border-amber-300',      dot: 'bg-amber-500' },
  ready_review: { ar: 'جاهزة للمراجعة',     en: 'Ready for Review', chip: 'bg-violet-50 text-violet-700 border-violet-300',      dot: 'bg-violet-500' },
  returned:     { ar: 'معادة للتعديل',      en: 'Returned',         chip: 'bg-orange-50 text-orange-700 border-orange-300',      dot: 'bg-orange-500' },
  closed:       { ar: 'مغلقة نهائياً',      en: 'Closed',           chip: 'bg-emerald-50 text-emerald-700 border-emerald-300',   dot: 'bg-emerald-500' },
  cancelled:    { ar: 'ملغاة',              en: 'Cancelled',        chip: 'bg-gray-100 text-gray-500 border-gray-300 line-through', dot: 'bg-gray-400' },
}

const PRIORITY: Record<string, { ar: string; en: string; chip: string }> = {
  urgent: { ar: 'عاجلة',  en: 'Urgent', chip: 'bg-red-600 text-white' },
  high:   { ar: 'عالية',  en: 'High',   chip: 'bg-red-100 text-red-700' },
  normal: { ar: 'عادية',  en: 'Normal', chip: 'bg-slate-100 text-slate-700' },
  low:    { ar: 'منخفضة', en: 'Low',    chip: 'bg-gray-100 text-gray-500' },
}

const SIZE: Record<string, { ar: string; en: string }> = {
  small:  { ar: 'صغيرة', en: 'Small' },
  medium: { ar: 'متوسطة', en: 'Medium' },
  large:  { ar: 'كبيرة', en: 'Large' },
}

const RECURRING: Record<string, { ar: string; en: string }> = {
  daily:   { ar: 'يومياً',  en: 'Daily' },
  weekly:  { ar: 'أسبوعياً', en: 'Weekly' },
  monthly: { ar: 'شهرياً',  en: 'Monthly' },
  yearly:  { ar: 'سنوياً',  en: 'Yearly' },
}

const EVENT_LABELS: Record<string, { ar: string; en: string }> = {
  created:          { ar: 'إنشاء المهمة',            en: 'Task created' },
  status_change:    { ar: 'تغيير الحالة',            en: 'Status changed' },
  due_date_change:  { ar: 'تغيير موعد الإنجاز',      en: 'Due date changed' },
  assignee_change:  { ar: 'تغيير الموظف المسؤول',    en: 'Assignee changed' },
  note:             { ar: 'ملاحظة',                  en: 'Note' },
  attachment:       { ar: 'مرفق',                    en: 'Attachment' },
  review:           { ar: 'إرسال للمراجعة',          en: 'Sent for review' },
  approved:         { ar: 'اعتماد وإغلاق',           en: 'Approved & closed' },
  returned:         { ar: 'إعادة للتعديل',           en: 'Returned for revision' },
  cancelled:        { ar: 'إلغاء المهمة',            en: 'Cancelled' },
  recurring_spawn:  { ar: 'مهمة دورية مولّدة',       en: 'Recurring task spawned' },
}

const STATUS_FROM_TO: Record<string, { ar: string; en: string }> = {
  new: STATUS.new.ar ? { ar: 'جديدة', en: 'New' } : { ar: 'جديدة', en: 'New' },
  in_progress: { ar: 'قيد التنفيذ', en: 'In Progress' },
  waiting: { ar: 'بانتظار جهة أخرى', en: 'Waiting' },
  ready_review: { ar: 'جاهزة للمراجعة', en: 'Ready for Review' },
  returned: { ar: 'معادة للتعديل', en: 'Returned' },
  closed: { ar: 'مغلقة', en: 'Closed' },
  cancelled: { ar: 'ملغاة', en: 'Cancelled' },
}

// v119: الحالات التي يُسمح فيها للموظف بإعادة ترتيب موعد مهمته (نفس قواعد API reschedule)
const RESCHEDULABLE_STATUSES = ['new', 'in_progress', 'waiting', 'returned']
const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 }

/** فرق أيام التقويم بين تاريخين (0 = نفس اليوم، 1 = غداً) */
function dayDiff(d: Date, now: Date): number {
  const a = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const b = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  return Math.round((b - a) / 86400000)
}

// ─── أدوات مساعدة ───────────────────────────────────────────────

function pad2(n: number) { return String(n).padStart(2, '0') }
function toLocalInput(d: Date) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + 'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes())
}

/** نموذج إنشاء مهمة جديد فارغ (موعد افتراضي: غداً 9:00 صباحاً) */
function emptyTaskForm() {
  const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0)
  return { title: '', assigneeId: '', dueDate: toLocalInput(d), priority: 'normal', size: 'medium', category: '', description: '', recurring: '' }
}

/** v120: نموذج مهمة شخصية فارغ (تذكيراتي) — موعد افتراضي: غداً 9:00 صباحاً */
function emptyPersonalForm() {
  const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0)
  return { title: '', details: '', dueDate: toLocalInput(d), priority: 'normal' }
}

/** v120: تنزيل التقرير الشخصي بصيغة CSV (يدعم العربية في Excel عبر BOM) */
function downloadPersonalCsv(rows: any[]) {
  const P: Record<string, string> = { urgent: 'عاجلة', high: 'عالية', normal: 'عادية', low: 'منخفضة' }
  const head = ['العنوان', 'الضرورة', 'تاريخ النهاية', 'الحالة', 'أُنجزت في', 'سُجلت في', 'التفاصيل']
  const esc = (v: any) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'
  const lines = [head.map(esc).join(',')]
  for (const r of rows) {
    const st = r.done ? 'منجزة' : (new Date(r.dueDate).getTime() < Date.now() ? 'متأخرة' : 'قيد الانتظار')
    lines.push([
      r.title,
      P[r.priority] || r.priority,
      new Date(r.dueDate).toLocaleString('ar-EG'),
      st,
      r.doneAt ? new Date(r.doneAt).toLocaleString('ar-EG') : '',
      new Date(r.createdAt).toLocaleString('ar-EG'),
      r.details || '',
    ].map(esc).join(','))
  }
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'تقرير-تذكيراتي-' + new Date().toISOString().split('T')[0] + '.csv'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(a.href)
}

function fmtDT(v: any, ar: boolean) {
  if (!v) return '—'
  const d = new Date(v)
  return d.toLocaleString(ar ? 'ar-EG' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' })
}

/** مدة readable من دقائق: «3 أيام و4 ساعات» */
function fmtDur(mins: number, ar: boolean): string {
  if (!isFinite(mins) || mins <= 0) return ar ? '0' : '0'
  const neg = mins < 0
  let m = Math.abs(Math.floor(mins))
  const days = Math.floor(m / 1440); m -= days * 1440
  const hours = Math.floor(m / 60); m -= hours * 60
  const parts: string[] = []
  if (days > 0) parts.push(ar ? days + ' يوم' : days + 'd')
  if (hours > 0) parts.push(ar ? hours + ' ساعة' : hours + 'h')
  if (parts.length === 0 && m > 0) parts.push(ar ? m + ' دقيقة' : m + 'm')
  const s = parts.slice(0, 2).join(ar ? ' و' : ' ')
  return (neg ? '-' : '') + (s || (ar ? '0' : '0'))
}

export default function TasksPage() {
  const language = useAppStore((s) => s.language)
  const user = useAppStore((s) => s.user)
  const isAr = language === 'ar'

  const [tab, setTab] = useState<'tasks' | 'perf' | 'reminders'>('tasks')
  const [tasks, setTasks] = useState<any[]>([])
  const [users, setUsers] = useState<any[]>([])
  const [viewer, setViewer] = useState<{ isManager: boolean; userId: string; email?: string; role?: string }>({ isManager: false, userId: '' })
  // خطأ تحميل المهام (يُعرض كإشعار عادي عند فشل الطلب فقط)
  const [apiError, setApiError] = useState<{ status: number | string; message: string } | null>(null)
  const [loading, setLoading] = useState(true)

  // فلاتر العرض (تُطبَّق محلياً على القائمة المجلوبة)
  const [f, setF] = useState({
    assigneeId: '', status: '', priority: '', category: '',
    createdFrom: '', createdTo: '', dueFrom: '', dueTo: '', lateOnly: false,
  })
  const [showFilters, setShowFilters] = useState(false)

  // v119: البحث السريع + الفلاتر السريعة + الترتيب — تسهيل الاستخدام
  const [q, setQ] = useState('')
  const [quick, setQuick] = useState<'all' | 'today' | 'week' | 'late' | 'done'>('all')
  const [sortBy, setSortBy] = useState<'due' | 'created' | 'priority'>('due')

  // v119: قسم «تذكيراتي» — تصنيف العرض + تنبيهات مهامي + نافذة تعديل الموعد
  const [remBucket, setRemBucket] = useState<'all' | 'overdue' | 'today' | 'tomorrow' | 'week' | 'later'>('all')
  const [myNotifs, setMyNotifs] = useState<any[]>([])
  const [notifsLoading, setNotifsLoading] = useState(false)
  const [resched, setResched] = useState<{ id: string; title: string; taskNumber: number; dueDate: string; note: string } | null>(null)

  // v120: مهامي الخاصة «تذكيراتي» — جدول مستقل لا يراه أحد غير صاحبه
  const [personal, setPersonal] = useState<any[]>([])
  const [personalLoading, setPersonalLoading] = useState(false)
  const [pFilter, setPFilter] = useState<'all' | 'overdue' | 'today' | 'week' | 'done'>('all')
  const [showPersonalForm, setShowPersonalForm] = useState(false)
  const [pForm, setPForm] = useState(emptyPersonalForm)
  const [pEditing, setPEditing] = useState<any>(null)
  const [pDeletingId, setPDeletingId] = useState<string | null>(null)
  const [pBusy, setPBusy] = useState(false)
  // v120: التقرير الشخصي من تذكيراتي (يومي / أسبوعي / شهري)
  const [showPReport, setShowPReport] = useState(false)
  const [pReportPeriod, setPReportPeriod] = useState<'day' | 'week' | 'month'>('week')

  // نافذة إنشاء مهمة جديدة (للإدارة ومدير النظام فقط)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState(emptyTaskForm)
  const [saving, setSaving] = useState(false)

  // التفاصيل
  const [detailId, setDetailId] = useState<string | null>(null)
  const [detail, setDetail] = useState<any>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  // نافذة الإجراء (سبب الانتظار / ملاحظة الإنجاز / سبب الإعادة / سبب الإلغاء)
  const [act, setAct] = useState<{ mode: 'wait' | 'ready' | 'return' | 'cancel' | null; note: string }>({ mode: null, note: '' })
  const [busy, setBusy] = useState(false)

  // تعديل المدير
  const [edit, setEdit] = useState<any>(null)

  // رفع مرفق
  const [uploading, setUploading] = useState(false)

  // تقرير الأداء
  const [perfMonth, setPerfMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const [perf, setPerf] = useState<any>(null)
  const [perfLoading, setPerfLoading] = useState(false)

  const nowTick = useState(0) // لإعادة حساب المتأخر عند فتح الصفحة فقط

  async function fetchTasks() {
    setLoading(true)
    setApiError(null)
    try {
      // noCache: منع أي استجابة قديمة مخزنة من نشر سابق
      const res = await authedFetch('/api/tasks', { noCache: true })
      const data = await res.json().catch(() => ({} as any))
      if (!res.ok) {
        // الخطأ الحقيقي من الخادم — كان يُبتلع سابقاً وتظهر قائمة فارغة صامتة
        setApiError({ status: res.status, message: String(data?.message || data?.error || 'خطأ غير معروف') })
        setTasks([])
        setViewer({ isManager: false, userId: '' })
      } else {
        setTasks(data.tasks || [])
        if (data.viewer) setViewer(data.viewer)
        else setViewer({ isManager: false, userId: '' })
      }
    } catch {
      setApiError({ status: 'شبكة', message: 'تعذر الوصول إلى الخادم إطلاقاً' })
      toast.error(isAr ? 'فشل جلب المهام' : 'Failed to load tasks')
    }
    setLoading(false)
  }

  async function fetchUsers() {
    try {
      const res = await authedFetch('/api/users/list')
      const data = await res.json()
      setUsers(data.users || [])
    } catch {}
  }

  // ─── v120: تذكيراتي — المهام الشخصية (جلب / إنشاء / تعديل / إنجاز / حذف) ───
  async function fetchPersonal() {
    setPersonalLoading(true)
    try {
      const res = await authedFetch('/api/my-reminders', { noCache: true })
      const data = await res.json().catch(() => ({} as any))
      if (res.ok) setPersonal(data.reminders || [])
    } catch {}
    setPersonalLoading(false)
  }

  async function submitPersonal(e: React.FormEvent) {
    e.preventDefault()
    if (!pForm.title.trim() || !pForm.dueDate) {
      toast.error(isAr ? 'أكمل: العنوان وتاريخ النهاية' : 'Title and end date are required')
      return
    }
    setPBusy(true)
    try {
      const res = await authedFetch('/api/my-reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: pForm.title,
          details: pForm.details || undefined,
          priority: pForm.priority,
          dueDate: new Date(pForm.dueDate).toISOString(),
        }),
      })
      const data = await res.json().catch(() => ({} as any))
      if (!res.ok) {
        toast.error(data.message || (isAr ? 'فشل إنشاء المهمة الشخصية' : 'Failed to create personal task'))
        return
      }
      toast.success(isAr ? 'سُجّلت مهمتك الشخصية — ستصل تنبيهاتها تلقائياً حتى موعد النهاية' : 'Personal task saved — automatic reminders are on')
      setPForm(emptyPersonalForm())
      setShowPersonalForm(false)
      fetchPersonal()
    } catch {
      toast.error(isAr ? 'تعذر الوصول للخادم — تحقق من الاتصال' : 'Network error — check connection')
    } finally {
      setPBusy(false)
    }
  }

  async function savePersonalEdit() {
    if (!pEditing || !String(pEditing.title || '').trim() || !pEditing.dueDate) return
    setPBusy(true)
    try {
      const res = await authedFetch('/api/my-reminders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: pEditing.id,
          title: pEditing.title,
          details: pEditing.details || undefined,
          priority: pEditing.priority,
          dueDate: new Date(pEditing.dueDate).toISOString(),
        }),
      })
      const data = await res.json().catch(() => ({} as any))
      if (!res.ok) {
        toast.error(data.message || (isAr ? 'فشل حفظ التعديل' : 'Update failed'))
        return
      }
      toast.success(isAr ? 'تم حفظ التعديل' : 'Changes saved')
      setPEditing(null)
      fetchPersonal()
    } catch {
      toast.error(isAr ? 'تعذر الوصول للخادم — تحقق من الاتصال' : 'Network error — check connection')
    } finally {
      setPBusy(false)
    }
  }

  async function togglePersonalDone(r: any) {
    setPBusy(true)
    try {
      const res = await authedFetch('/api/my-reminders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: r.id, done: !r.done }),
      })
      const data = await res.json().catch(() => ({} as any))
      if (!res.ok) {
        toast.error(data.message || (isAr ? 'فشل تحديث الحالة' : 'Update failed'))
        return
      }
      toast.success(r.done ? (isAr ? 'أُعيد فتح المهمة' : 'Task reopened') : (isAr ? 'أُنجزت المهمة — أحسنت!' : 'Task completed — well done!'))
      fetchPersonal()
    } catch {
      toast.error(isAr ? 'تعذر الوصول للخادم — تحقق من الاتصال' : 'Network error — check connection')
    } finally {
      setPBusy(false)
    }
  }

  // حذف بضغطتين: الأولى تسلّح التأكيد، والثانية تحذف فعلٍ (حماية من الحذف الخاطئ)
  async function deletePersonal(id: string) {
    if (pDeletingId !== id) { setPDeletingId(id); return }
    setPBusy(true)
    try {
      const res = await authedFetch('/api/my-reminders?id=' + encodeURIComponent(id), { method: 'DELETE' })
      const data = await res.json().catch(() => ({} as any))
      if (!res.ok) {
        toast.error(data.message || (isAr ? 'فشل الحذف' : 'Delete failed'))
        return
      }
      toast.success(isAr ? 'حُذف التذكير' : 'Reminder deleted')
      setPDeletingId(null)
      fetchPersonal()
    } catch {
      toast.error(isAr ? 'تعذر الوصول للخادم — تحقق من الاتصال' : 'Network error — check connection')
    } finally {
      setPBusy(false)
    }
  }

  useEffect(() => {
    fetchTasks()
    // v120: جلب مهامي الخاصة عند الفتح — يفعّل أيضاً فحص التنبيهات المستمرة على الخادم
    fetchPersonal()
  }, [])

  // v77: قائمة الموظفين تُجلب للمديرين فقط —
  // تستخدم في فلتر الإسناد ونوافذ الإنشاء/التعديل، والموظف لا يحتاجها
  useEffect(() => { if (viewer.isManager) fetchUsers() }, [viewer.isManager])

  useEffect(() => { if (tab === 'perf') fetchPerf(perfMonth) }, [tab])

  // v119: آخر التنبيهات الشخصية المتعلقة بالمهام — تُجلب عند فتح تبويب «تذكيراتي» فقط
  // v120: مهامي الخاصة تُجلب أولاً (يفعّل فحص التنبيهات المستمرة على الخادم)، ثم تنبيهاتي،
  // مع تحديث خفيف كل 60 ثانية طوال فتح التبويب — تنبيهات حية بلا إعادة تحميل يدوي
  // (المنطق داخل التأثير نفسه لتفادي تحذير تبعيات react-hooks — نفس نمط بقية التأثيرات)
  useEffect(() => {
    if (tab !== 'reminders' || !viewer.userId) return
    let cancelled = false
    ;(async () => {
      setNotifsLoading(true)
      try {
        await fetchPersonal()
        const res = await authedFetch('/api/notifications', { noCache: true })
        const data = await res.json().catch(() => ({} as any))
        if (!cancelled && res.ok) {
          const mine = (data.notifications || []).filter((n: any) => n.userId === viewer.userId && (String(n.type || '').startsWith('task_') || String(n.type || '').startsWith('personal_reminder_')))
          setMyNotifs(mine.slice(0, 8))
        }
      } catch {}
      if (!cancelled) setNotifsLoading(false)
    })()
    const iv = setInterval(() => { fetchPersonal() }, 60000)
    return () => { cancelled = true; clearInterval(iv) }
  }, [tab, viewer.userId])

  async function fetchPerf(month: string) {
    setPerfLoading(true)
    try {
      const res = await authedFetch('/api/tasks/performance?month=' + month, { noCache: true })
      const data = await res.json()
      setPerf(data.report || null)
    } catch {
      toast.error(isAr ? 'فشل جلب تقرير الأداء' : 'Failed to load performance report')
    }
    setPerfLoading(false)
  }

  // ─── فلاتر محلية ───
  const filtered = useMemo(() => {
    const now = Date.now()
    const list = tasks.filter((t) => {
      // v77: نظام حماية عرض المهام — طبقة دفاعية ثانية في الواجهة:
      // للموظف (غير المدير) لا تُعرض أبداً مهام غير المسندة إليه،
      // حتى لو أرجع الخادم قائمة أوسع بسبب أي خلل مستقبلي.
      if (!viewer.isManager && viewer.userId && t.assigneeId !== viewer.userId) return false
      if (f.assigneeId && t.assigneeId !== f.assigneeId) return false
      if (f.status && t.status !== f.status) return false
      if (f.priority && t.priority !== f.priority) return false
      if (f.category && !(t.category || '').toLowerCase().includes(f.category.toLowerCase())) return false
      if (f.createdFrom && new Date(t.createdAt) < new Date(f.createdFrom + 'T00:00:00')) return false
      if (f.createdTo && new Date(t.createdAt) > new Date(f.createdTo + 'T23:59:59')) return false
      if (f.dueFrom && new Date(t.dueDate) < new Date(f.dueFrom + 'T00:00:00')) return false
      if (f.dueTo && new Date(t.dueDate) > new Date(f.dueTo + 'T23:59:59')) return false
      if (f.lateOnly) {
        const open = !['closed', 'cancelled'].includes(t.status)
        if (!(open && new Date(t.dueDate).getTime() < now)) return false
      }
      // v119: البحث السريع — عنوان المهمة أو رقمها (#12) أو التصنيف أو الوصف
      const needle = q.trim().toLowerCase()
      if (needle) {
        const qn = needle.replace(/^#/, '')
        const hit = (t.title || '').toLowerCase().includes(needle)
          || (t.category || '').toLowerCase().includes(needle)
          || (t.description || '').toLowerCase().includes(needle)
          || (!!qn && /^\d+$/.test(qn) && t.taskNumber === Number(qn))
        if (!hit) return false
      }
      // v119: الفلاتر السريعة (اليوم / هذا الأسبوع / متأخرة / المنجزة)
      const openQ = !['closed', 'cancelled'].includes(t.status)
      const dueT = new Date(t.dueDate)
      if (quick === 'today' && !(openQ && dayDiff(dueT, new Date(now)) === 0)) return false
      if (quick === 'week' && !(openQ && dueT.getTime() >= now && dueT.getTime() <= now + 7 * 86400000)) return false
      if (quick === 'late' && !(openQ && dueT.getTime() < now)) return false
      if (quick === 'done' && openQ) return false
      return true
    })
    // v119: الترتيب — الأقرب موعداً (الافتراضي) / الأولوية / الأحدث إنشاءً
    const sorted = [...list]
    if (sortBy === 'created') sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    else if (sortBy === 'priority') sorted.sort((a, b) => ((PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2)) || (new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()))
    else sorted.sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
    return sorted
  }, [tasks, f, viewer, q, quick, sortBy])

  // ─── الملخص السريع ───
  const summary = useMemo(() => {
    const now = Date.now()
    const monthKey = new Date().toISOString().slice(0, 7)
    const s = { new: 0, in_progress: 0, late: 0, waiting: 0, ready_review: 0, closedMonth: 0 }
    for (const t of tasks) {
      if (t.status === 'new') s.new += 1
      if (t.status === 'in_progress') s.in_progress += 1
      if (t.status === 'waiting') s.waiting += 1
      if (t.status === 'ready_review') s.ready_review += 1
      if (!['closed', 'cancelled'].includes(t.status) && new Date(t.dueDate).getTime() < now) s.late += 1
      if (t.status === 'closed' && t.closedAt && new Date(t.closedAt).toISOString().slice(0, 7) === monthKey) s.closedMonth += 1
    }
    return s
  }, [tasks])

  // ─── v119: تذكيراتي — مهامي الشخصية وتصنيفات المواعيد ───
  // (للموظف: الخادم يعيد مهامه فقط، وللمدير: تُصفّى هنا لمهامه هو — القسم شخصي دائماً)
  const myTasks = useMemo(() => tasks.filter((t) => !viewer.userId || t.assigneeId === viewer.userId), [tasks, viewer])
  const remCounts = useMemo(() => {
    const now = Date.now()
    const c = { overdue: 0, today: 0, tomorrow: 0, week: 0, later: 0, done: 0 }
    for (const t of myTasks) {
      if (['closed', 'cancelled'].includes(t.status)) { c.done += 1; continue }
      const dueT = new Date(t.dueDate)
      if (dueT.getTime() < now) { c.overdue += 1; continue }
      const dd = dayDiff(dueT, new Date(now))
      if (dd === 0) { c.today += 1 }
      else if (dd === 1) { c.tomorrow += 1 }
      else if (dueT.getTime() <= now + 7 * 86400000) { c.week += 1 }
      else { c.later += 1 }
    }
    return c
  }, [myTasks])
  const remList = useMemo(() => {
    const open = myTasks.filter((t) => !['closed', 'cancelled'].includes(t.status))
    open.sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
    return open
  }, [myTasks])

  // ─── v120: تذكيراتي — مهامي الخاصة (جدول مستقل لا يراه أحد غيري) ───
  const pCounts = useMemo(() => {
    const now = Date.now()
    const c = { overdue: 0, today: 0, week: 0, later: 0, done: 0 }
    for (const r of personal) {
      if (r.done) { c.done += 1; continue }
      const dueT = new Date(r.dueDate)
      if (dueT.getTime() < now) { c.overdue += 1; continue }
      const dd = dayDiff(dueT, new Date(now))
      if (dd === 0) c.today += 1
      else if (dueT.getTime() <= now + 7 * 86400000) c.week += 1
      else c.later += 1
    }
    return c
  }, [personal])

  const personalList = useMemo(() => {
    const now = Date.now()
    const list = personal.filter((r) => {
      if (pFilter === 'done') return r.done
      if (r.done) return false
      const dueT = new Date(r.dueDate)
      if (pFilter === 'overdue') return dueT.getTime() < now
      if (pFilter === 'today') return dayDiff(dueT, new Date(now)) === 0 && dueT.getTime() >= now
      if (pFilter === 'week') return dueT.getTime() >= now && dueT.getTime() <= now + 7 * 86400000
      return true
    })
    return [...list].sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
  }, [personal, pFilter])

  /** تصنيف المهمة زمنياً: متأخرة / اليوم / غداً / خلال أسبوع / أبعد */
  function bucketOf(t: any): 'overdue' | 'today' | 'tomorrow' | 'week' | 'later' {
    const now = Date.now()
    const dueT = new Date(t.dueDate)
    if (dueT.getTime() < now) return 'overdue'
    const dd = dayDiff(dueT, new Date(now))
    if (dd === 0) return 'today'
    if (dd === 1) return 'tomorrow'
    if (dueT.getTime() <= now + 7 * 86400000) return 'week'
    return 'later'
  }

  // ─── إنشاء مهمة ───
  async function submitNew(e: React.FormEvent) {
    e.preventDefault()
    if (!form.title.trim() || !form.assigneeId || !form.dueDate) {
      toast.error(isAr ? 'أكمل: العنوان والمسؤول وموعد الإنجاز' : 'Title, assignee and due date are required')
      return
    }
    setSaving(true)
    try {
      const res = await authedFetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title,
          assigneeId: form.assigneeId,
          dueDate: new Date(form.dueDate).toISOString(),
          priority: form.priority,
          size: form.size,
          category: form.category || undefined,
          description: form.description || undefined,
          recurring: form.recurring || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.message || (isAr ? 'فشل إنشاء المهمة' : 'Failed to create task'))
        return
      }
      toast.success(isAr ? 'تم إنشاء المهمة #' + data.task.taskNumber : 'Task #' + data.task.taskNumber + ' created')
      setForm(emptyTaskForm())
      setShowCreate(false)
      fetchTasks()
    } catch (err: any) {
      toast.error(isAr ? 'تعذر الوصول للخادم — تحقق من الاتصال' : 'Network error — check connection')
    } finally {
      setSaving(false)
    }
  }

  // ─── التفاصيل ───
  async function openDetail(id: string) {
    setDetailId(id)
    setDetailLoading(true)
    setDetail(null)
    setEdit(null)
    try {
      const res = await authedFetch('/api/tasks/' + id, { noCache: true })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.message || (isAr ? 'فشل جلب التفاصيل' : 'Failed to load details'))
        setDetailId(null)
        return
      }
      setDetail(data.task)
      if (data.viewer?.isManager) {
        setEdit({
          title: data.task.title, assigneeId: data.task.assigneeId,
          dueDate: toLocalInput(new Date(data.task.dueDate)),
          priority: data.task.priority, size: data.task.size,
          category: data.task.category || '', description: data.task.description || '',
        })
      }
    } catch {
      // v80 إصلاح: فشل الشبكة كان unhandled rejection والنافذة تبقى عالقة
      toast.error(isAr ? 'فشل الاتصال — تعذر فتح التفاصيل' : 'Connection failed — could not open details')
      setDetailId(null)
    } finally {
      setDetailLoading(false)
    }
  }

  async function refreshDetail(id: string) {
    try {
      const res = await authedFetch('/api/tasks/' + id, { noCache: true })
      const data = await res.json()
      if (res.ok) {
        setDetail(data.task)
        if (data.viewer?.isManager && data.task) {
          setEdit({
            title: data.task.title, assigneeId: data.task.assigneeId,
            dueDate: toLocalInput(new Date(data.task.dueDate)),
            priority: data.task.priority, size: data.task.size,
            category: data.task.category || '', description: data.task.description || '',
          })
        }
      }
    } catch {
      // v80 إصلاح: لا try على الإطلاق — فشل الشبكة كان unhandled rejection
      toast.error(isAr ? 'فشل تحديث التفاصيل' : 'Failed to refresh details')
    }
    fetchTasks()
  }

  // ─── إجراءات الحالة ───
  async function doAction(action: string, extra: Record<string, any> = {}) {
    if (!detailId) return
    setBusy(true)
    try {
      const res = await authedFetch('/api/tasks/' + detailId + '/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.message || (isAr ? 'فشل تنفيذ الإجراء' : 'Action failed'))
        return
      }
      const okMsgs: Record<string, { ar: string; en: string }> = {
        start: { ar: 'بدأ التنفيذ', en: 'Started' },
        wait: { ar: 'حالة الانتظار مسجلة', en: 'Marked as waiting' },
        resume: { ar: 'تم استئناف التنفيذ', en: 'Resumed' },
        ready: { ar: 'أُرسلت للمراجعة', en: 'Sent for review' },
        approve: { ar: 'اعتُمدت وأُغلقت نهائياً' + (data.spawnedTask ? ' — وأُنشئت المهمة الدورية التالية #' + data.spawnedTask.taskNumber : ''), en: 'Approved & closed' + (data.spawnedTask ? ' — next recurring task spawned' : '') },
        return: { ar: 'أُعيدت للتعديل', en: 'Returned for revision' },
        cancel: { ar: 'أُلغيت المهمة', en: 'Task cancelled' },
      }
      toast.success(isAr ? (okMsgs[action]?.ar || 'تم') : (okMsgs[action]?.en || 'Done'))
      setAct({ mode: null, note: '' })
      refreshDetail(detailId)
    } catch (err: any) {
      toast.error(isAr ? 'تعذر الوصول للخادم — تحقق من الاتصال' : 'Network error — check connection')
    } finally {
      setBusy(false)
    }
  }

  // ─── تعديل المدير ───
  async function saveEdit() {
    if (!detailId || !edit) return
    setBusy(true)
    try {
      const res = await authedFetch('/api/tasks/' + detailId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: edit.title,
          assigneeId: edit.assigneeId,
          dueDate: edit.dueDate ? new Date(edit.dueDate).toISOString() : undefined,
          priority: edit.priority,
          size: edit.size,
          category: edit.category,
          description: edit.description,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.message || (isAr ? 'فشل التعديل' : 'Update failed'))
        return
      }
      toast.success(isAr ? 'تم حفظ التعديلات (مسجلة في سجل المهمة)' : 'Changes saved (logged in task history)')
      refreshDetail(detailId)
    } catch (err: any) {
      toast.error(isAr ? 'تعذر الوصول للخادم — تحقق من الاتصال' : 'Network error — check connection')
    } finally {
      setBusy(false)
    }
  }

  // ─── المرفقات ───
  async function uploadAttachment(file: File) {
    if (!detailId) return
    if (file.size > 3 * 1024 * 1024) {
      toast.error(isAr ? 'حجم الملف يتجاوز 3 ميغابايت' : 'File exceeds 3MB')
      return
    }
    setUploading(true)
    try {
      const url: string = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
      const ext = (file.name.split('.').pop() || '').toLowerCase()
      const fileType = ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext) ? 'image' : (ext === 'pdf' ? 'pdf' : 'doc')
      const res = await authedFetch('/api/tasks/' + detailId + '/attachments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: file.name, fileType, url, size: file.size }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.message || (isAr ? 'فشل رفع المرفق' : 'Upload failed'))
        return
      }
      toast.success(isAr ? 'تم إرفاق الملف' : 'File attached')
      refreshDetail(detailId)
    } catch (err: any) {
      toast.error(isAr ? 'تعذر الوصول للخادم — تحقق من الاتصال' : 'Network error — check connection')
    } finally {
      setUploading(false)
    }
  }

  // ─── v119: تعديل موعد المهمة (الموظف المسؤول من «تذكيراتي» أو من التفاصيل) ───
  function openResched(task: any) {
    setResched({
      id: task.id,
      title: task.title,
      taskNumber: task.taskNumber,
      dueDate: toLocalInput(new Date(task.dueDate)),
      note: '',
    })
  }

  async function submitResched() {
    if (!resched || !resched.dueDate) return
    setBusy(true)
    try {
      const res = await authedFetch('/api/tasks/' + resched.id + '/reschedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dueDate: new Date(resched.dueDate).toISOString(), note: resched.note || undefined }),
      })
      const data = await res.json().catch(() => ({} as any))
      if (!res.ok) {
        toast.error(data.message || (isAr ? 'فشل تعديل الموعد' : 'Reschedule failed'))
        return
      }
      toast.success(isAr ? 'تم تعديل موعد الإنجاز — التعديل مسجل في سجل المهمة' : 'Due date updated — change logged in task history')
      setResched(null)
      fetchTasks()
      if (detailId) refreshDetail(detailId)
    } catch {
      toast.error(isAr ? 'تعذر الوصول للخادم — تحقق من الاتصال' : 'Network error — check connection')
    } finally {
      setBusy(false)
    }
  }

  // ─── ألوان الصفوف: متأخرة/قرب الموعد/الحالة ───
  function rowTone(t: any): { border: string; bg: string } {
    const now = Date.now()
    const open = !['closed', 'cancelled'].includes(t.status)
    const due = new Date(t.dueDate).getTime()
    if (t.status === 'cancelled') return { border: 'border-s-gray-300', bg: 'opacity-60' }
    if (t.status === 'closed') return { border: 'border-s-emerald-500', bg: '' }
    if (open && due < now) return { border: 'border-s-red-500', bg: 'bg-red-50/40' }
    if (open && due - now < 24 * 3600 * 1000) return { border: 'border-s-orange-400', bg: 'bg-orange-50/30' }
    if (t.status === 'in_progress') return { border: 'border-s-blue-500', bg: '' }
    if (t.status === 'waiting') return { border: 'border-s-amber-400', bg: 'bg-amber-50/30' }
    if (t.status === 'ready_review') return { border: 'border-s-violet-500', bg: '' }
    return { border: 'border-s-slate-300', bg: '' }
  }

  function Chip({ id }: { id: string }) {
    // v80 إصلاح: حالة غير متوقعة كانت تكسر الجدول والنافذة (s.chip على undefined) — بديل آمن
    const s = STATUS[id] || { chip: 'border-slate-200 bg-slate-50 text-slate-600', dot: 'bg-slate-400', ar: id, en: id }
    return (
      <span className={'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ' + s.chip}>
        <span className={'h-1.5 w-1.5 rounded-full ' + s.dot} />
        {isAr ? s.ar : s.en}
      </span>
    )
  }

  function userName(u: any) {
    if (!u) return '—'
    return (isAr ? u.name : (u.nameEn || u.name)) || '—'
  }

  const t = (ar: string, en: string) => (isAr ? ar : en)

  // v119: شارة الوقت النسبي لموعد الإنجاز (متأخرة / اليوم / غداً / متبقٍ)
  function relDueLabel(task: any): { text: string; cls: string } {
    const now = Date.now()
    const dueT = new Date(task.dueDate)
    const diffMs = dueT.getTime() - now
    if (diffMs < 0) return { text: t('متأخرة ', 'Late ') + fmtDur(-diffMs / 60000, isAr), cls: 'bg-red-100 text-red-700' }
    const dd = dayDiff(dueT, new Date(now))
    if (dd === 0) return { text: t('تستحق اليوم', 'Due today'), cls: 'bg-orange-100 text-orange-700' }
    if (dd === 1) return { text: t('تستحق غداً', 'Due tomorrow'), cls: 'bg-amber-100 text-amber-700' }
    return { text: t('متبقٍ ', 'Remaining ') + fmtDur(diffMs / 60000, isAr), cls: 'bg-blue-50 text-blue-700' }
  }

  // ─── الواجهة ───
  return (
    <div className="p-4 lg:p-6 space-y-5 max-w-[1600px] mx-auto">
      {/* الرأس + التبويبات */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
            <ListChecks className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl lg:text-2xl font-bold">
              {t('إدارة المهام', 'Task Management')}
              <span className="ms-2 align-middle text-[10px] font-mono font-normal text-muted-foreground border border-border rounded px-1.5 py-0.5" title="Build version marker">v14.0</span>
            </h1>
            <p className="text-xs text-muted-foreground">{t('تنظيم مهام الموظفين ومتابعة الإنجاز والتأخير', 'Assign, track and evaluate employee tasks')}</p>
          </div>
        </div>
        {/* v119: تبويب «تذكيراتي» متاح لكل الموظفين مع شارة عدد المستحق — بقية التبويبات للإدارة */}
        <div className="flex flex-wrap items-center gap-1.5">
          <Button variant={tab === 'reminders' ? 'default' : 'outline'} size="sm" onClick={() => setTab('reminders')}>
            <BellRing className="h-4 w-4 ms-1" /> {t('تذكيراتي', 'My Reminders')}
            {(remCounts.overdue + remCounts.today + pCounts.overdue + pCounts.today) > 0 && (
              <span className="ms-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-bold">{remCounts.overdue + remCounts.today + pCounts.overdue + pCounts.today}</span>
            )}
          </Button>
          {viewer.isManager && (
            <>
              <Button variant={tab === 'tasks' ? 'default' : 'outline'} size="sm" onClick={() => setTab('tasks')}>
                <ListChecks className="h-4 w-4 ms-1" /> {t('المهام', 'Tasks')}
              </Button>
              <Button variant={tab === 'perf' ? 'default' : 'outline'} size="sm" onClick={() => setTab('perf')}>
                <BarChart3 className="h-4 w-4 ms-1" /> {t('تقرير الأداء', 'Performance')}
              </Button>
              <Button size="sm" className="shadow-sm" onClick={() => setShowCreate(true)}>
                <Plus className="h-4 w-4 ms-1" /> {t('إنشاء مهمة جديدة', 'New Task')}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* إشعار خطأ تحميل المهام — يظهر فقط عند فشل الطلب (لا عناصر تشخيصية في الوضع الطبيعي) */}
      {!loading && apiError && (
        <div className="flex items-start gap-2.5 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2.5 text-xs leading-relaxed text-red-700 dark:text-red-400">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold">{t('تعذر تحميل المهام', 'Failed to load tasks')}</p>
            <p>
              {t('الحالة', 'Status')}{': '}
              <span className="font-mono font-semibold" dir="ltr">HTTP {apiError.status}</span>
              {' — '}{t('رسالة الخادم', 'Server message')}{': '}
              <span className="font-mono" dir="ltr">{apiError.message}</span>
            </p>
            <p>{t('حاول تحديث الصفحة، وإن تكرر الخطأ تواصل مع مسؤول النظام', 'Try refreshing the page; if the error persists contact the system administrator')}</p>
          </div>
        </div>
      )}

      {/* v77: نظام حماية عرض المهام — لافتة للموظف: يرى المهام الموكّلة إليه فقط */}
      {!loading && !viewer.isManager && (
        <div className="flex items-start gap-2.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2.5 text-xs leading-relaxed text-emerald-800 dark:text-emerald-300">
          <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="font-semibold">{t('خصوصية المهام مفعّلة', 'Task privacy is active')}</p>
            <p>{t('تُعرض عليك المهام الموكّلة إليك فقط، ومهام الموظفين الآخرين مخفية عنك — يراها المسؤولون والإدارة فقط. الحماية مطبقة على الخادم نفسه.', 'You only see tasks assigned to you — tasks of other employees are hidden and visible to supervisors and management only. Enforced on the server itself.')}</p>
          </div>
        </div>
      )}

      {tab === 'tasks' && (
        <>
          {/* الملخص السريع */}
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2.5">
            {([
              { k: 'new', label: t('جديدة', 'New'), v: summary.new, cls: 'bg-slate-100 text-slate-700', act: () => setF(p => ({ ...p, status: p.status === 'new' ? '' : 'new' })) },
              { k: 'prog', label: t('قيد التنفيذ', 'In Progress'), v: summary.in_progress, cls: 'bg-blue-50 text-blue-700', act: () => setF(p => ({ ...p, status: p.status === 'in_progress' ? '' : 'in_progress' })) },
              { k: 'late', label: t('متأخرة', 'Late'), v: summary.late, cls: 'bg-red-50 text-red-700', act: () => setF(p => ({ ...p, lateOnly: !p.lateOnly })) },
              { k: 'wait', label: t('بانتظار جهة', 'Waiting'), v: summary.waiting, cls: 'bg-amber-50 text-amber-700', act: () => setF(p => ({ ...p, status: p.status === 'waiting' ? '' : 'waiting' })) },
              { k: 'rev', label: t('جاهزة للمراجعة', 'Ready for Review'), v: summary.ready_review, cls: 'bg-violet-50 text-violet-700', act: () => setF(p => ({ ...p, status: p.status === 'ready_review' ? '' : 'ready_review' })) },
              { k: 'closed', label: t('مغلقة هذا الشهر', 'Closed this Month'), v: summary.closedMonth, cls: 'bg-emerald-50 text-emerald-700', act: () => setF(p => ({ ...p, status: p.status === 'closed' ? '' : 'closed' })) },
            ] as any[]).map((c) => (
              <button key={c.k} onClick={c.act} className={'text-start rounded-xl border p-3 transition-shadow hover:shadow-sm ' + c.cls}>
                <div className="text-2xl font-bold leading-none">{c.v}</div>
                <div className="text-xs mt-1.5 opacity-80">{c.label}</div>
              </button>
            ))}
          </div>

          {/* نموذج الإضافة السريع استُبدل بنافذة إنشاء كاملة تُفتح من زر الرأس */}

          {/* v119: البحث السريع + الفلاتر السريعة + الترتيب — تسهيل الاستخدام */}
          <div className="space-y-2.5">
            <div className="relative">
              <Search className="h-4 w-4 absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('بحث سريع: عنوان المهمة أو رقمها #12 أو التصنيف...', 'Quick search: title, #12 or category...')} className="ps-9" />
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {([
                { k: 'all', label: t('الكل', 'All') },
                { k: 'today', label: t('تستحق اليوم', 'Due today') },
                { k: 'week', label: t('هذا الأسبوع', 'This week') },
                { k: 'late', label: t('متأخرة', 'Late') },
                { k: 'done', label: t('المنجزة', 'Completed') },
              ] as const).map((c) => (
                <button key={c.k} onClick={() => setQuick(c.k)} className={'rounded-full border px-3 py-1 text-xs font-medium transition-colors ' + (quick === c.k ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-muted-foreground border-border hover:bg-muted/50')}>
                  {c.label}
                </button>
              ))}
              <span className="w-px h-5 bg-border mx-1 hidden sm:block" />
              <Select value={sortBy} onValueChange={(v) => setSortBy(v as any)}>
                <SelectTrigger className="h-8 w-[180px] text-xs"><ArrowUpDown className="h-3.5 w-3.5 me-1" /><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="due">{t('الترتيب: الأقرب موعداً', 'Sort: soonest due')}</SelectItem>
                  <SelectItem value="priority">{t('الترتيب: الأولوية', 'Sort: priority')}</SelectItem>
                  <SelectItem value="created">{t('الترتيب: الأحدث إنشاءً', 'Sort: newest first')}</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={() => setShowFilters(!showFilters)}>
                <Filter className="h-4 w-4 ms-1" /> {t('فلاتر متقدمة', 'Advanced filters')}
                {(f.assigneeId || f.status || f.priority || f.category || f.createdFrom || f.createdTo || f.dueFrom || f.dueTo || f.lateOnly) && (
                  <span className="h-2 w-2 rounded-full bg-primary ms-1" />
                )}
              </Button>
              {(q || quick !== 'all' || f.assigneeId || f.status || f.priority || f.category || f.createdFrom || f.createdTo || f.dueFrom || f.dueTo || f.lateOnly) && (
                <Button variant="ghost" size="sm" onClick={() => { setQ(''); setQuick('all'); setF({ assigneeId: '', status: '', priority: '', category: '', createdFrom: '', createdTo: '', dueFrom: '', dueTo: '', lateOnly: false }) }}>
                  <XCircle className="h-4 w-4 ms-1" /> {t('مسح الكل', 'Clear all')}
                </Button>
              )}
              <span className="text-xs text-muted-foreground">{filtered.length} / {tasks.length} {t('مهمة', 'tasks')}</span>
            </div>
          </div>

          {showFilters && (
            <Card>
              <CardContent className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                {viewer.isManager && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">{t('الموظف', 'Employee')}</Label>
                    <Select value={f.assigneeId || 'all'} onValueChange={(v) => setF({ ...f, assigneeId: v === 'all' ? '' : v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t('الكل', 'All')}</SelectItem>
                        {users.map((u) => (<SelectItem key={u.id} value={u.id}>{userName(u)}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('الحالة', 'Status')}</Label>
                  <Select value={f.status || 'all'} onValueChange={(v) => setF({ ...f, status: v === 'all' ? '' : v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t('الكل', 'All')}</SelectItem>
                      {Object.entries(STATUS).map(([k, s]) => (<SelectItem key={k} value={k}>{isAr ? s.ar : s.en}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('الأولوية', 'Priority')}</Label>
                  <Select value={f.priority || 'all'} onValueChange={(v) => setF({ ...f, priority: v === 'all' ? '' : v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t('الكل', 'All')}</SelectItem>
                      {Object.entries(PRIORITY).map(([k, p]) => (<SelectItem key={k} value={k}>{isAr ? p.ar : p.en}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('القسم / النوع', 'Category')}</Label>
                  <Input placeholder={t('بحث بالتصنيف', 'Search category')} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('تاريخ الإنشاء من', 'Created from')}</Label>
                  <Input type="date" value={f.createdFrom} onChange={(e) => setF({ ...f, createdFrom: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('إلى', 'to')}</Label>
                  <Input type="date" value={f.createdTo} onChange={(e) => setF({ ...f, createdTo: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('موعد الإنجاز من', 'Due from')}</Label>
                  <Input type="date" value={f.dueFrom} onChange={(e) => setF({ ...f, dueFrom: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('إلى', 'to')}</Label>
                  <Input type="date" value={f.dueTo} onChange={(e) => setF({ ...f, dueTo: e.target.value })} />
                </div>
                <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-4">
                  <Switch checked={f.lateOnly} onCheckedChange={(v) => setF({ ...f, lateOnly: v })} id="lateOnly" />
                  <Label htmlFor="lateOnly" className="text-xs cursor-pointer">{t('المهام المتأخرة فقط', 'Late tasks only')}</Label>
                </div>
              </CardContent>
            </Card>
          )}

          {/* القائمة: جدول للحاسوب + بطاقات للهاتف */}
          {loading ? (
            <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
          ) : filtered.length === 0 ? (
            <Card><CardContent className="py-16 text-center text-muted-foreground">{viewer.isManager ? t('لا توجد مهام مطابقة', 'No matching tasks') : t('لا توجد مهام موكّلة إليك حالياً — ستظهر هنا فور إسناد مهمة جديدة إليك', 'No tasks assigned to you yet — new assignments will appear here')}</CardContent></Card>
          ) : (
            <>
              {/* جدول الحاسوب */}
              <Card className="hidden lg:block overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50 text-muted-foreground text-xs">
                        <th className="p-3 text-start font-medium">#</th>
                        <th className="p-3 text-start font-medium">{t('عنوان المهمة', 'Title')}</th>
                        <th className="p-3 text-start font-medium">{t('الموظف', 'Assignee')}</th>
                        <th className="p-3 text-start font-medium">{t('الأولوية', 'Priority')}</th>
                        <th className="p-3 text-start font-medium">{t('الحالة', 'Status')}</th>
                        <th className="p-3 text-start font-medium">{t('موعد الإنجاز', 'Due')}</th>
                        <th className="p-3 text-start font-medium">{t('المنقضي', 'Elapsed')}</th>
                        <th className="p-3 text-start font-medium">{t('التأخير', 'Delay')}</th>
                        <th className="p-3 text-start font-medium">{t('آخر تحديث', 'Last update')}</th>
                        <th className="p-3"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((task) => {
                        const tone = rowTone(task)
                        const open = !['closed', 'cancelled'].includes(task.status)
                        const due = new Date(task.dueDate).getTime()
                        const endMs = task.closedAt ? new Date(task.closedAt).getTime() : Date.now()
                        const elapsedMin = (endMs - new Date(task.createdAt).getTime()) / 60000
                        const rawDelayMin = open ? (Date.now() - due) / 60000 : (task.closedAt ? (new Date(task.closedAt).getTime() - due) / 60000 : 0)
                        const effDelayMin = Math.max(0, rawDelayMin - (task.waitingMinutes || 0))
                        return (
                          <tr key={task.id} className={'border-b border-s-4 last:border-b-0 hover:bg-muted/30 ' + tone.border + ' ' + tone.bg}>
                            <td className="p-3 font-mono text-xs text-muted-foreground">#{task.taskNumber}</td>
                            <td className="p-3 max-w-[280px]">
                              <div className="font-medium truncate">{task.title}</div>
                              <div className="flex items-center gap-1.5 mt-1">
                                {task.recurring && <Badge variant="outline" className="text-[10px] px-1.5 py-0">{t('متكررة', 'Recurring')}</Badge>}
                                {(task._count?.attachments || 0) > 0 && <span className="text-[10px] text-muted-foreground inline-flex items-center gap-0.5"><Paperclip className="h-3 w-3" />{task._count.attachments}</span>}
                                {task.category && <span className="text-[10px] text-muted-foreground">{task.category}</span>}
                              </div>
                            </td>
                            <td className="p-3 whitespace-nowrap">{userName(task.assignee)}</td>
                            <td className="p-3"><span className={'inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ' + PRIORITY[task.priority]?.chip}>{isAr ? PRIORITY[task.priority]?.ar : PRIORITY[task.priority]?.en}</span></td>
                            <td className="p-3"><Chip id={task.status} /></td>
                            <td className="p-3 whitespace-nowrap">{fmtDT(task.dueDate, isAr)}</td>
                            <td className="p-3 whitespace-nowrap text-xs">{fmtDur(elapsedMin, isAr)}</td>
                            <td className="p-3 whitespace-nowrap text-xs">
                              {effDelayMin > 0 ? <span className="text-red-600 font-semibold inline-flex items-center gap-1"><AlertTriangle className="h-3 w-3" />{fmtDur(effDelayMin, isAr)}</span> : <span className="text-emerald-600">—</span>}
                            </td>
                            <td className="p-3 whitespace-nowrap text-xs text-muted-foreground">{fmtDT(task.updatedAt, isAr)}</td>
                            <td className="p-3">
                              <Button variant="outline" size="sm" onClick={() => openDetail(task.id)}>{t('التفاصيل', 'Details')}</Button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>

              {/* بطاقات الهاتف */}
              <div className="lg:hidden space-y-2.5">
                {filtered.map((task) => {
                  const tone = rowTone(task)
                  const open = !['closed', 'cancelled'].includes(task.status)
                  const due = new Date(task.dueDate).getTime()
                  const rawDelayMin = open ? (Date.now() - due) / 60000 : (task.closedAt ? (new Date(task.closedAt).getTime() - due) / 60000 : 0)
                  const effDelayMin = Math.max(0, rawDelayMin - (task.waitingMinutes || 0))
                  return (
                    <button key={task.id} onClick={() => openDetail(task.id)} className={'w-full text-start rounded-xl border border-s-4 bg-card p-3.5 shadow-sm active:bg-muted/40 ' + tone.border + ' ' + tone.bg}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-medium text-[15px] leading-snug">#{task.taskNumber} {task.title}</div>
                          <div className="text-xs text-muted-foreground mt-1">{userName(task.assignee)} · {fmtDT(task.dueDate, isAr)}</div>
                        </div>
                        <Chip id={task.status} />
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2.5 text-xs">
                        <span className={'rounded-full px-2 py-0.5 font-medium ' + PRIORITY[task.priority]?.chip}>{isAr ? PRIORITY[task.priority]?.ar : PRIORITY[task.priority]?.en}</span>
                        {effDelayMin > 0 ? (
                          <span className="text-red-600 font-semibold inline-flex items-center gap-1"><AlertTriangle className="h-3 w-3" />{t('متأخرة', 'Late')} {fmtDur(effDelayMin, isAr)}</span>
                        ) : (
                          <span className="text-muted-foreground inline-flex items-center gap-1"><Clock className="h-3 w-3" />{fmtDur((Date.now() - new Date(task.createdAt).getTime()) / 60000, isAr)}</span>
                        )}
                        {(task._count?.attachments || 0) > 0 && <span className="text-muted-foreground inline-flex items-center gap-0.5"><Paperclip className="h-3 w-3" />{task._count.attachments}</span>}
                      </div>
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </>
      )}

      {/* ── v119: تذكيراتي — منظم مهامي ومواعيدي (شخصي لكل موظف) ── */}
      {tab === 'reminders' && (
        <div className="space-y-4">
          {/* لافتة التنبيه اليومية — v120: تشمل المهام الموكّلة والمهام الشخصية معاً */}
          {(() => {
            const urgent = remCounts.overdue + pCounts.overdue
            const todayN = remCounts.today + pCounts.today
            if (urgent > 0 || todayN > 0) {
              const parts: string[] = []
              if (urgent > 0) parts.push(isAr ? (urgent === 1 ? 'مهمة واحدة متأخرة عن موعدها' : urgent + ' مهام متأخرة عن مواعيدها') : (urgent === 1 ? '1 overdue task' : urgent + ' overdue tasks'))
              if (todayN > 0) parts.push(isAr ? (todayN === 1 ? 'مهمة واحدة تستحق اليوم' : todayN + ' مهام تستحق اليوم') : (todayN === 1 ? '1 task due today' : todayN + ' tasks due today'))
              const msg = isAr ? 'لديك ' + parts.join(' و') + ' — رتّب أولوياتك وابدأ بها الآن.' : 'You have ' + parts.join(' and ') + ' — prioritize and start now.'
              return (
                <div className="flex items-start gap-2.5 rounded-lg border border-orange-500/40 bg-orange-500/10 px-3 py-2.5 text-xs leading-relaxed text-orange-800 dark:text-orange-300">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <p className="font-semibold">{msg}</p>
                </div>
              )
            }
            return (
              <div className="flex items-start gap-2.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2.5 text-xs leading-relaxed text-emerald-800 dark:text-emerald-300">
                <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                <p className="font-semibold">{t('لا توجد مهام متأخرة أو مستحقة اليوم — مواعيدك تحت السيطرة، وتابع مهامك القادمة أدناه.', 'No overdue or due-today tasks — you are on track. Your upcoming tasks are listed below.')}</p>
              </div>
            )
          })()}

          {/* ── v120: مهامي الخاصة — ينشئها الموظف لنفسه ولا يراها أي شخص آخر ── */}
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold inline-flex flex-wrap items-center gap-1.5">
                    <NotebookPen className="h-4 w-4 shrink-0" /> {t('مهامي الخاصة', 'My personal tasks')}
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-emerald-50 text-emerald-700 border-emerald-300">{t('خصوصية كاملة — لا تظهر لأي شخص آخر', 'Fully private — visible to you only')}</Badge>
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1">{t('سجّل مهامك وأعمالك الخاصة مع تاريخ نهاية لكل منها — يصلك تنبيه يومي حتى تنجزها. محفوظة لك وحدك: لا تراها الإدارة ولا الموظفون الآخرون.', 'Record your own tasks with an end date — you get daily reminders until done. Stored for you alone: management and other employees never see them.')}</div>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button variant="outline" size="sm" onClick={() => setShowPReport(true)}>
                    <FileText className="h-3.5 w-3.5 ms-1" /> {t('تقريري', 'My report')}
                  </Button>
                  <Button size="sm" className="shadow-sm" onClick={() => { setPForm(emptyPersonalForm()); setShowPersonalForm(true) }}>
                    <Plus className="h-4 w-4 ms-1" /> {t('مهمة شخصية جديدة', 'New personal task')}
                  </Button>
                </div>
              </div>

              {/* فلاتر سريعة للمهام الشخصية */}
              <div className="flex flex-wrap items-center gap-1.5">
                {([
                  { k: 'all', label: t('الكل', 'All'), v: personal.length, hot: false },
                  { k: 'overdue', label: t('متأخرة', 'Overdue'), v: pCounts.overdue, hot: true },
                  { k: 'today', label: t('اليوم', 'Today'), v: pCounts.today, hot: true },
                  { k: 'week', label: t('هذا الأسبوع', 'This week'), v: pCounts.week, hot: false },
                  { k: 'done', label: t('منجزة', 'Completed'), v: pCounts.done, hot: false },
                ] as any[]).map((c) => (
                  <button key={c.k} onClick={() => setPFilter(pFilter === c.k ? 'all' : (c.k as any))} className={'rounded-full border px-2.5 py-1 text-xs transition-colors ' + (pFilter === c.k ? 'bg-primary text-primary-foreground border-primary' : (c.hot && c.v > 0 ? 'border-red-300 bg-red-50 text-red-700' : 'border-border hover:bg-muted'))}>
                    {c.label} <span className="font-bold">{c.v}</span>
                  </button>
                ))}
              </div>

              {/* قائمة المهام الشخصية — مرتبة بالأقرب موعداً */}
              {personalLoading && personal.length === 0 ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
              ) : personalList.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  {personal.length === 0
                    ? t('لا مهام شخصية بعد — اضغط «مهمة شخصية جديدة» لترتيب عملك ومواعيدك، وسيصلك تنبيه يومي لكل مهمة حتى موعد نهايتها.', 'No personal tasks yet — tap "New personal task" to organize your work and deadlines; you will get a daily reminder for each task until its end date.')
                    : t('لا توجد تذكيرات في هذا التصنيف.', 'Nothing in this filter.')}
                </div>
              ) : (
                <div className="space-y-2">
                  {personalList.map((r) => {
                    const rel = relDueLabel(r)
                    const dueMs = new Date(r.dueDate).getTime()
                    const tone = r.done
                      ? ' border-s-emerald-500'
                      : (dueMs < Date.now() ? ' border-s-red-500 bg-red-50/40' : (dueMs - Date.now() < 24 * 3600 * 1000 ? ' border-s-orange-400 bg-orange-50/30' : ' border-s-slate-300'))
                    return (
                      <div key={r.id} className={'rounded-xl border border-s-4 bg-card p-3 shadow-sm' + tone + (r.done ? ' opacity-70' : '')}>
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className={'font-medium text-[15px] leading-snug break-words' + (r.done ? ' line-through text-muted-foreground' : '')}>{r.title}</div>
                            {r.details && <div className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap break-words">{r.details}</div>}
                            <div className="text-xs text-muted-foreground mt-1">{t('تاريخ النهاية', 'End date')}: {fmtDT(r.dueDate, isAr)}</div>
                          </div>
                          <div className="flex flex-col items-end gap-1.5 shrink-0">
                            {r.done ? (
                              <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold bg-emerald-100 text-emerald-700">{t('منجزة', 'Completed')}</span>
                            ) : (
                              <span className={'rounded-full px-2 py-0.5 text-[11px] font-semibold ' + rel.cls}>{rel.text}</span>
                            )}
                            <span className={'rounded-full px-2 py-0.5 text-[11px] font-medium ' + (PRIORITY[r.priority]?.chip || 'bg-slate-100 text-slate-700')}>{isAr ? (PRIORITY[r.priority]?.ar || r.priority) : (PRIORITY[r.priority]?.en || r.priority)}</span>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 mt-2.5">
                          <Button variant={r.done ? 'outline' : 'default'} size="sm" className={r.done ? '' : 'bg-emerald-600 hover:bg-emerald-600'} onClick={() => togglePersonalDone(r)} disabled={pBusy}>
                            {r.done ? <Undo2 className="h-3.5 w-3.5 ms-1" /> : <CheckCircle2 className="h-3.5 w-3.5 ms-1" />}
                            {r.done ? t('إعادة فتح', 'Reopen') : t('تم الإنجاز', 'Mark done')}
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => setPEditing({ id: r.id, title: r.title, details: r.details || '', priority: r.priority, dueDate: toLocalInput(new Date(r.dueDate)) })} disabled={pBusy}>
                            <Pencil className="h-3.5 w-3.5 ms-1" /> {t('تعديل', 'Edit')}
                          </Button>
                          <Button variant={pDeletingId === r.id ? 'destructive' : 'ghost'} size="sm" onClick={() => deletePersonal(r.id)} disabled={pBusy}>
                            <Trash2 className="h-3.5 w-3.5 ms-1" /> {pDeletingId === r.id ? t('اضغط مجدداً للتأكيد', 'Click again to confirm') : t('حذف', 'Delete')}
                          </Button>
                          {r.done && r.doneAt && <span className="text-[11px] text-emerald-700 ms-auto">{t('أُنجزت في', 'Completed at')} {fmtDT(r.doneAt, isAr)}</span>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* بطاقات تصنيف المواعيد — تعمل كفلاتر */}
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2.5">
            {([
              { k: 'overdue', label: t('متأخرة', 'Overdue'), v: remCounts.overdue, cls: 'bg-red-50 text-red-700' },
              { k: 'today', label: t('اليوم', 'Today'), v: remCounts.today, cls: 'bg-orange-50 text-orange-700' },
              { k: 'tomorrow', label: t('غداً', 'Tomorrow'), v: remCounts.tomorrow, cls: 'bg-amber-50 text-amber-700' },
              { k: 'week', label: t('خلال أسبوع', 'Within a week'), v: remCounts.week, cls: 'bg-blue-50 text-blue-700' },
              { k: 'later', label: t('أبعد من ذلك', 'Later'), v: remCounts.later, cls: 'bg-slate-100 text-slate-700' },
              { k: 'done', label: t('منجزة', 'Completed'), v: remCounts.done, cls: 'bg-emerald-50 text-emerald-700' },
            ] as any[]).map((c) => (
              <button key={c.k} onClick={() => setRemBucket(remBucket === c.k ? 'all' : c.k)} className={'text-start rounded-xl border p-3 transition-shadow hover:shadow-sm ' + c.cls + (remBucket === c.k ? ' ring-2 ring-primary/40' : '')}>
                <div className="text-2xl font-bold leading-none">{c.v}</div>
                <div className="text-xs mt-1.5 opacity-80">{c.label}</div>
              </button>
            ))}
          </div>

          {/* قائمة التذكيرات مرتبة بالأقرب موعداً — مع تعديل الموعد مباشرة */}
          {(() => {
            const list = remBucket === 'all' ? remList : remList.filter((tk) => bucketOf(tk) === remBucket)
            if (list.length === 0) {
              return <Card><CardContent className="py-14 text-center text-muted-foreground">{t('لا توجد تذكيرات في هذا التصنيف — كل شيء تحت السيطرة.', 'Nothing in this bucket — all clear.')}</CardContent></Card>
            }
            return (
              <div className="space-y-2">
                {list.map((task) => {
                  const tone = rowTone(task)
                  const rel = relDueLabel(task)
                  return (
                    <div key={task.id} className={'rounded-xl border border-s-4 bg-card p-3.5 shadow-sm ' + tone.border + ' ' + tone.bg}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <button onClick={() => openDetail(task.id)} className="text-start min-w-0 flex-1">
                          <div className="font-medium text-[15px] leading-snug hover:underline">#{task.taskNumber} {task.title}</div>
                          <div className="text-xs text-muted-foreground mt-1">{fmtDT(task.dueDate, isAr)}{task.category ? ' · ' + task.category : ''}</div>
                        </button>
                        <Chip id={task.status} />
                      </div>
                      <div className="flex flex-wrap items-center gap-2 mt-2.5">
                        <span className={'rounded-full px-2 py-0.5 text-[11px] font-semibold ' + rel.cls}>{rel.text}</span>
                        <span className={'rounded-full px-2 py-0.5 text-[11px] font-medium ' + PRIORITY[task.priority]?.chip}>{isAr ? PRIORITY[task.priority]?.ar : PRIORITY[task.priority]?.en}</span>
                        {task.recurring && <Badge variant="outline" className="text-[10px] px-1.5 py-0">{t('متكررة', 'Recurring')}</Badge>}
                        <span className="flex-1" />
                        {RESCHEDULABLE_STATUSES.includes(task.status) && (
                          <Button variant="outline" size="sm" onClick={() => openResched(task)}>
                            <CalendarClock className="h-3.5 w-3.5 ms-1" /> {t('تعديل الموعد', 'Reschedule')}
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => openDetail(task.id)}>{t('التفاصيل', 'Details')}</Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })()}

          {/* آخر التنبيهات المتعلقة بمهامي (صفوف شخصية موجّهة لي فقط) */}
          <Card>
            <CardContent className="p-4 space-y-2.5">
              <div className="text-sm font-semibold inline-flex items-center gap-1.5"><BellRing className="h-4 w-4" />{t('آخر التنبيهات المتعلقة بمهامي', 'Recent task notifications')}</div>
              {notifsLoading ? (
                <div className="flex justify-center py-6"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
              ) : myNotifs.length === 0 ? (
                <div className="text-xs text-muted-foreground">{t('لا تنبيهات بعد — ستظهر هنا إشعارات إسناد المهام وتذكيرات المواعيد المتعلقة بمهامك أنت.', 'No notifications yet — task assignments and deadline reminders for your own tasks will appear here.')}</div>
              ) : (
                <div className="space-y-1.5">
                  {myNotifs.map((n) => (
                    <div key={n.id} className={'flex items-start gap-2 rounded-lg border px-2.5 py-2 text-xs ' + (n.read ? 'opacity-70' : 'bg-muted/30')}>
                      <span className={'h-2 w-2 rounded-full mt-1.5 shrink-0 ' + (n.severity === 'critical' ? 'bg-red-500' : n.severity === 'warning' ? 'bg-amber-500' : 'bg-blue-500')} />
                      <div className="min-w-0">
                        <div className="font-medium">{n.title}</div>
                        <div className="text-muted-foreground break-words">{n.message}</div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">{fmtDT(n.createdAt, isAr)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-[11px] text-muted-foreground">{t('كل التنبيهات تجدها في جرس الإشعارات أعلى الشاشة.', 'All notifications live in the bell icon at the top of the screen.')}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── تقرير الأداء ── */}
      {tab === 'perf' && viewer.isManager && (
        <div className="space-y-4">
          <Card>
            <CardContent className="p-4 flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">{t('الشهر', 'Month')}</Label>
                <Input type="month" value={perfMonth} onChange={(e) => { setPerfMonth(e.target.value); fetchPerf(e.target.value) }} className="w-44" />
              </div>
              <Button variant="outline" size="sm" onClick={() => fetchPerf(perfMonth)} disabled={perfLoading}>
                {perfLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <BarChart3 className="h-4 w-4 ms-1" />} {t('تحديث', 'Refresh')}
              </Button>
              <p className="text-xs text-muted-foreground flex-1 min-w-[220px]">
                {t('التقييم يجمع منذ اليوم الأول — المعروض مؤشر مبدئي: 50% التزام بالموعد + 30% اعتماد من أول مراجعة + 20% إغلاق المستحق. الملغاة مستبعدة، ومدد الانتظار بسبب جهات خارجية لا تحسب تأخيراً.', 'Data is collected from day one; the score is a preliminary indicator: 50% on-time + 30% first-review approval + 20% closure. Cancelled excluded; external-party waiting not counted as employee delay.')}
              </p>
            </CardContent>
          </Card>

          {perf && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2.5">
                {([
                  { label: t('مستحقة', 'Due'), v: perf.totals.dueTasks, cls: 'bg-slate-100 text-slate-700' },
                  { label: t('مغلقة', 'Closed'), v: perf.totals.closedTasks, cls: 'bg-emerald-50 text-emerald-700' },
                  { label: t('متأخرة', 'Late'), v: perf.totals.lateTasks, cls: 'bg-red-50 text-red-700' },
                  { label: t('مفتوحة', 'Open'), v: perf.totals.openTasks, cls: 'bg-blue-50 text-blue-700' },
                  { label: t('موقوفة لجهة خارجية', 'Blocked (3rd party)'), v: perf.totals.blockedByExternal, cls: 'bg-amber-50 text-amber-700' },
                  { label: t('ملغاة (خارج التقييم)', 'Cancelled (excluded)'), v: perf.totals.cancelledExcluded, cls: 'bg-gray-100 text-gray-500' },
                ] as any[]).map((c, i) => (
                  <div key={i} className={'rounded-xl border p-3 ' + c.cls}>
                    <div className="text-2xl font-bold leading-none">{c.v}</div>
                    <div className="text-xs mt-1.5 opacity-80">{c.label}</div>
                  </div>
                ))}
              </div>

              <Card className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50 text-muted-foreground text-xs">
                        <th className="p-3 text-start font-medium">{t('الموظف', 'Employee')}</th>
                        <th className="p-3 text-start font-medium">{t('المستحقة', 'Due')}</th>
                        <th className="p-3 text-start font-medium">{t('المغلقة', 'Closed')}</th>
                        <th className="p-3 text-start font-medium">{t('في الموعد %', 'On-time %')}</th>
                        <th className="p-3 text-start font-medium">{t('متأخرة', 'Late')}</th>
                        <th className="p-3 text-start font-medium">{t('متوسط التأخير', 'Avg delay')}</th>
                        <th className="p-3 text-start font-medium">{t('متوسط الإنجاز', 'Avg completion')}</th>
                        <th className="p-3 text-start font-medium">{t('معادة', 'Returned')}</th>
                        <th className="p-3 text-start font-medium">{t('أول مراجعة %', 'First-review %')}</th>
                        <th className="p-3 text-start font-medium">{t('مفتوحة', 'Open')}</th>
                        <th className="p-3 text-start font-medium">{t('انتظار جهة', 'Waiting 3rd')}</th>
                        <th className="p-3 text-start font-medium">{t('المؤشر', 'Score')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {perf.employees.length === 0 ? (
                        <tr><td colSpan={12} className="p-8 text-center text-muted-foreground">{t('لا بيانات لهذا الشهر', 'No data for this month')}</td></tr>
                      ) : perf.employees.map((e: any) => (
                        <tr key={e.userId} className="border-b last:border-b-0">
                          <td className="p-3 font-medium whitespace-nowrap">{userName(e)}</td>
                          <td className="p-3">{e.dueTasks}</td>
                          <td className="p-3">{e.closedTasks}</td>
                          <td className="p-3">{e.onTimeRate.toFixed(0)}%</td>
                          <td className="p-3">{e.lateTasks}</td>
                          <td className="p-3 whitespace-nowrap">{fmtDur(e.avgDelayHours * 60, isAr)}</td>
                          <td className="p-3 whitespace-nowrap">{fmtDur(e.avgCompletionHours * 60, isAr)}</td>
                          <td className="p-3">{e.returnedCount}</td>
                          <td className="p-3">{e.firstReviewRate.toFixed(0)}%</td>
                          <td className="p-3">{e.openTasks}</td>
                          <td className="p-3">{e.blockedByExternal}</td>
                          <td className="p-3">
                            <span className={'rounded-full px-2 py-0.5 text-xs font-bold ' + (e.score >= 80 ? 'bg-emerald-100 text-emerald-700' : e.score >= 60 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700')}>
                              {e.score.toFixed(0)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              <div className="text-[11px] text-muted-foreground">
                {t('توزيع الأحجام ضمن المهام المستحقة: ', 'Size breakdown within due tasks: ')}
                {perf.employees.map((e: any) => e.sizeBreakdown).filter((sb: any) => Object.keys(sb).length > 0).length === 0 ? t('—', '—') : ''}
                {perf.employees.map((e: any) => (
                  Object.entries(e.sizeBreakdown as Record<string, any>).map(([sz, v]: any) => (
                    <span key={e.userId + sz} className="inline-block me-3">{userName(e)}: {isAr ? SIZE[sz]?.ar : SIZE[sz]?.en} {v.due}/{v.closed}</span>
                  ))
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── نافذة إنشاء مهمة جديدة (للإدارة ومدير النظام فقط) ── */}
      <Dialog open={showCreate} onOpenChange={(o) => { if (!o) setShowCreate(false) }}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-start flex items-center gap-2">
              <Plus className="h-4 w-4" /> {t('إنشاء مهمة جديدة', 'Create New Task')}
            </DialogTitle>
            <DialogDescription className="text-start">
              {t('يُسجَّل تلقائياً عند الحفظ: رقم المهمة، المُنشئ، وقت الإنشاء، والحالة «جديدة». التفاصيل والمرفقات اختيارية ويمكن إضافتها لاحقاً من تفاصيل المهمة.', 'Auto-recorded on save: task number, creator, creation time and status "New". Details and attachments are optional and can be added later from the task details.')}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitNew} className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">{t('عنوان المهمة *', 'Task title *')}</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={t('اكتب عنواناً واضحاً ومختصراً', 'Clear, short title')} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div className="space-y-1.5">
                <Label className="text-xs">{t('الموظف المسؤول *', 'Assignee *')}</Label>
                <Select value={form.assigneeId} onValueChange={(v) => setForm({ ...form, assigneeId: v })}>
                  <SelectTrigger><SelectValue placeholder={t('اختر الموظف', 'Choose employee')} /></SelectTrigger>
                  <SelectContent>
                    {users.map((u) => (<SelectItem key={u.id} value={u.id}>{userName(u)}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t('موعد الإنجاز المطلوب *', 'Due date & time *')}</Label>
                <Input type="datetime-local" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t('الأولوية', 'Priority')}</Label>
                <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(PRIORITY).map(([k, p]) => (<SelectItem key={k} value={k}>{isAr ? p.ar : p.en}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t('حجم المهمة', 'Task size')}</Label>
                <Select value={form.size} onValueChange={(v) => setForm({ ...form, size: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(SIZE).map(([k, s]) => (<SelectItem key={k} value={k}>{isAr ? s.ar : s.en}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t('القسم / نوع المهمة (اختياري)', 'Category / type (optional)')}</Label>
                <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder={t('مثال: متابعات، مستندات', 'e.g. follow-ups, documents')} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t('مهمة دورية (اختياري)', 'Recurrence (optional)')}</Label>
                <Select value={form.recurring || 'none'} onValueChange={(v) => setForm({ ...form, recurring: v === 'none' ? '' : v })}>
                  <SelectTrigger><SelectValue placeholder={t('بدون تكرار', 'No recurrence')} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t('بدون تكرار', 'No recurrence')}</SelectItem>
                    {Object.entries(RECURRING).map(([k, r]) => (<SelectItem key={k} value={k}>{isAr ? r.ar : r.en}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t('التفاصيل (اختياري)', 'Details (optional)')}</Label>
              <Textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder={t('شرح المطلوب من الموظف...', 'Describe what is required...')} />
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>{t('إلغاء', 'Cancel')}</Button>
              <Button type="submit" disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : (<><Plus className="h-4 w-4 ms-1" />{t('حفظ المهمة', 'Save Task')}</>)}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── نافذة التفاصيل ── */}
      <Dialog open={!!detailId} onOpenChange={(o) => { if (!o) { setDetailId(null); setDetail(null); setEdit(null) } }}>
        <DialogContent className="sm:max-w-[760px] max-h-[90vh] overflow-y-auto">
          {detailLoading || !detail ? (
            <div className="flex justify-center py-14"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="space-y-4">
              <DialogHeader>
                <DialogTitle className="text-start flex flex-wrap items-center gap-2">
                  <span className="font-mono text-muted-foreground">#{detail.taskNumber}</span>
                  <span>{detail.title}</span>
                  <Chip id={detail.status} />
                </DialogTitle>
                <DialogDescription className="text-start">
                  {detail.category ? detail.category + ' · ' : ''}
                  {isAr ? SIZE[detail.size]?.ar : SIZE[detail.size]?.en} · {isAr ? PRIORITY[detail.priority]?.ar : PRIORITY[detail.priority]?.en}
                  {detail.recurring ? ' · ' + t('متكررة ', 'Recurring: ') + (isAr ? RECURRING[detail.recurring]?.ar : RECURRING[detail.recurring]?.en) : ''}
                </DialogDescription>
              </DialogHeader>

              {/* معلومات المهمة */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2.5 text-sm rounded-xl border p-3.5 bg-muted/20">
                <div><div className="text-[11px] text-muted-foreground">{t('الموظف المسؤول', 'Assignee')}</div><div className="font-medium">{userName(detail.assignee)}</div></div>
                <div><div className="text-[11px] text-muted-foreground">{t('أضافها', 'Created by')}</div><div className="font-medium">{userName(detail.creator)}</div></div>
                <div><div className="text-[11px] text-muted-foreground">{t('موعد الإنجاز المطلوب', 'Due date')}</div><div className="font-medium">{fmtDT(detail.dueDate, isAr)}</div></div>
                <div><div className="text-[11px] text-muted-foreground">{t('تاريخ الإنشاء', 'Created at')}</div><div>{fmtDT(detail.createdAt, isAr)}</div></div>
                <div><div className="text-[11px] text-muted-foreground">{t('بدء التنفيذ', 'Started at')}</div><div>{fmtDT(detail.startedAt, isAr)}</div></div>
                <div><div className="text-[11px] text-muted-foreground">{t('أُرسلت للمراجعة', 'Sent for review')}</div><div>{fmtDT(detail.reviewRequestedAt, isAr)}</div></div>
                <div><div className="text-[11px] text-muted-foreground">{t('الإغلاق النهائي', 'Closed at')}</div><div>{fmtDT(detail.closedAt, isAr)}{detail.closedBy ? ' (' + userName(detail.closedBy) + ')' : ''}</div></div>
                <div>
                  <div className="text-[11px] text-muted-foreground">{t('مدة الانتظار (جهة خارجية)', 'Waiting time (3rd party)')}</div>
                  <div>{fmtDur((detail.waitingMinutes || 0) + (detail.status === 'waiting' && detail.waitingSince ? (Date.now() - new Date(detail.waitingSince).getTime()) / 60000 : 0), isAr)}</div>
                </div>
                <div>
                  <div className="text-[11px] text-muted-foreground">{t('التأخير بعد استبعاد الانتظار', 'Delay excluding waiting')}</div>
                  {(() => {
                    const open = !['closed', 'cancelled'].includes(detail.status)
                    const due = new Date(detail.dueDate).getTime()
                    const raw = open ? (Date.now() - due) / 60000 : (detail.closedAt ? (new Date(detail.closedAt).getTime() - due) / 60000 : 0)
                    const eff = Math.max(0, raw - (detail.waitingMinutes || 0))
                    return eff > 0 ? <div className="text-red-600 font-semibold">{fmtDur(eff, isAr)}</div> : <div className="text-emerald-600">{t('لا يوجد', 'None')}</div>
                  })()}
                </div>
                {detail.description && <div className="col-span-2 sm:col-span-3"><div className="text-[11px] text-muted-foreground">{t('التفاصيل', 'Details')}</div><div className="whitespace-pre-wrap">{detail.description}</div></div>}
                {detail.status === 'waiting' && detail.waitingReason && (
                  <div className="col-span-2 sm:col-span-3 rounded-lg bg-amber-50 border border-amber-200 p-2.5 text-amber-800 text-xs">
                    <span className="font-semibold">{t('سبب الانتظار: ', 'Waiting reason: ')}</span>{detail.waitingReason}
                  </div>
                )}
                {detail.reviewNote && (
                  <div className="col-span-2 sm:col-span-3 rounded-lg bg-violet-50 border border-violet-200 p-2.5 text-violet-800 text-xs">
                    <span className="font-semibold">{t('الإجراء المنفذ (من الموظف): ', 'Action taken (by employee): ')}</span>{detail.reviewNote}
                  </div>
                )}
                {detail.status === 'cancelled' && detail.cancelReason && (
                  <div className="col-span-2 sm:col-span-3 rounded-lg bg-gray-100 border p-2.5 text-xs">
                    <span className="font-semibold">{t('سبب الإلغاء: ', 'Cancel reason: ')}</span>{detail.cancelReason}
                  </div>
                )}
              </div>

              {/* أزرار الإجراءات */}
              {(() => {
                const st = detail.status
                const mine = viewer.userId === detail.assigneeId
                const canEmployeeAct = mine || viewer.isManager
                const open = !['closed', 'cancelled'].includes(st)
                if (!open && st !== 'ready_review') return null
                return (
                  <div className="flex flex-wrap gap-2">
                    {canEmployeeAct && ['new', 'returned'].includes(st) && (
                      <Button size="sm" onClick={() => doAction('start')} disabled={busy}><Play className="h-4 w-4 ms-1" />{st === 'returned' ? t('بدء التنفيذ بعد التعديل', 'Start (after revision)') : t('بدء التنفيذ', 'Start')}</Button>
                    )}
                    {canEmployeeAct && st === 'waiting' && (
                      <Button size="sm" onClick={() => doAction('resume')} disabled={busy}><Play className="h-4 w-4 ms-1" />{t('استئناف', 'Resume')}</Button>
                    )}
                    {canEmployeeAct && RESCHEDULABLE_STATUSES.includes(st) && (
                      <Button size="sm" variant="outline" onClick={() => openResched(detail)} disabled={busy}><CalendarClock className="h-4 w-4 ms-1" />{t('تعديل موعد الإنجاز', 'Reschedule')}</Button>
                    )}
                    {canEmployeeAct && ['new', 'in_progress', 'returned', 'waiting'].includes(st) && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => setAct({ mode: 'wait', note: '' })} disabled={busy}><PauseCircle className="h-4 w-4 ms-1" />{t('بانتظار جهة أخرى', 'Waiting (3rd party)')}</Button>
                        <Button size="sm" variant="outline" onClick={() => setAct({ mode: 'ready', note: '' })} disabled={busy}><Send className="h-4 w-4 ms-1" />{t('إرسال للمراجعة', 'Send for review')}</Button>
                      </>
                    )}
                    {viewer.isManager && st === 'ready_review' && (
                      <>
                        <Button size="sm" className="bg-emerald-600 hover:bg-emerald-600" onClick={() => doAction('approve')} disabled={busy}><CheckCircle2 className="h-4 w-4 ms-1" />{t('اعتماد وإغلاق نهائي', 'Approve & close')}</Button>
                        <Button size="sm" variant="outline" onClick={() => setAct({ mode: 'return', note: '' })} disabled={busy}><Undo2 className="h-4 w-4 ms-1" />{t('إعادة للتعديل', 'Return for revision')}</Button>
                      </>
                    )}
                    {viewer.isManager && open && (
                      <Button size="sm" variant="destructive" onClick={() => setAct({ mode: 'cancel', note: '' })} disabled={busy}><XCircle className="h-4 w-4 ms-1" />{t('إلغاء المهمة', 'Cancel task')}</Button>
                    )}
                  </div>
                )
              })()}

              {/* تعديل المدير */}
              {viewer.isManager && edit && !['closed', 'cancelled'].includes(detail.status) && (
                <div className="rounded-xl border p-3.5 space-y-2.5">
                  <div className="text-sm font-semibold">{t('تعديل بيانات المهمة (يُسجل في السجل)', 'Edit task (logged in history)')}</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div className="space-y-1"><Label className="text-xs">{t('العنوان', 'Title')}</Label><Input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></div>
                    <div className="space-y-1"><Label className="text-xs">{t('الموظف المسؤول', 'Assignee')}</Label>
                      <Select value={edit.assigneeId} onValueChange={(v) => setEdit({ ...edit, assigneeId: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{users.map((u) => (<SelectItem key={u.id} value={u.id}>{userName(u)}</SelectItem>))}</SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1"><Label className="text-xs">{t('موعد الإنجاز', 'Due date')}</Label><Input type="datetime-local" value={edit.dueDate} onChange={(e) => setEdit({ ...edit, dueDate: e.target.value })} /></div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1"><Label className="text-xs">{t('الأولوية', 'Priority')}</Label>
                        <Select value={edit.priority} onValueChange={(v) => setEdit({ ...edit, priority: v })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>{Object.entries(PRIORITY).map(([k, p]) => (<SelectItem key={k} value={k}>{isAr ? p.ar : p.en}</SelectItem>))}</SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1"><Label className="text-xs">{t('الحجم', 'Size')}</Label>
                        <Select value={edit.size} onValueChange={(v) => setEdit({ ...edit, size: v })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>{Object.entries(SIZE).map(([k, s]) => (<SelectItem key={k} value={k}>{isAr ? s.ar : s.en}</SelectItem>))}</SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-1 sm:col-span-2"><Label className="text-xs">{t('القسم / النوع', 'Category')}</Label><Input value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })} /></div>
                  </div>
                  <Button size="sm" onClick={saveEdit} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t('حفظ التعديلات', 'Save changes')}</Button>
                </div>
              )}

              {/* المرفقات */}
              <div className="rounded-xl border p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold inline-flex items-center gap-1.5"><Paperclip className="h-4 w-4" />{t('المرفقات', 'Attachments')} ({detail.attachments?.length || 0})</div>
                  {!['cancelled'].includes(detail.status) && (viewer.userId === detail.assigneeId || viewer.isManager) && (
                    <label className="cursor-pointer">
                      <input type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadAttachment(f); (e.target as HTMLInputElement).value = '' }} />
                      <span className="inline-flex items-center gap-1 text-xs rounded-md border px-2.5 py-1.5 hover:bg-muted">
                        {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}{t('إرفاق ملف', 'Attach file')}
                      </span>
                    </label>
                  )}
                </div>
                {(detail.attachments || []).length === 0 ? (
                  <div className="text-xs text-muted-foreground">{t('لا مرفقات', 'No attachments')}</div>
                ) : (
                  <div className="space-y-1.5">
                    {detail.attachments.map((a: any) => (
                      <a key={a.id} href={a.url} download={a.fileName} target="_blank" rel="noreferrer" className="flex items-center justify-between text-xs rounded-lg border px-2.5 py-2 hover:bg-muted/50">
                        <span className="truncate">{a.fileName}</span>
                        <span className="text-muted-foreground whitespace-nowrap ms-2 inline-flex items-center gap-1"><Download className="h-3 w-3" />{userName(a.uploader)} · {fmtDT(a.createdAt, isAr)}</span>
                      </a>
                    ))}
                  </div>
                )}
              </div>

              {/* سجل المهمة */}
              <div className="rounded-xl border p-3.5">
                <div className="text-sm font-semibold inline-flex items-center gap-1.5 mb-2.5"><History className="h-4 w-4" />{t('سجل المهمة الكامل', 'Full task history')}</div>
                <div className="space-y-0">
                  {(detail.events || []).map((ev: any, i: number) => (
                    <div key={ev.id} className="flex gap-2.5">
                      <div className="flex flex-col items-center">
                        <div className="h-2 w-2 rounded-full bg-primary/60 mt-1.5 shrink-0" />
                        {i < (detail.events.length - 1) && <div className="w-px flex-1 bg-border min-h-[26px]" />}
                      </div>
                      <div className="pb-3 min-w-0">
                        <div className="text-xs font-medium">{isAr ? EVENT_LABELS[ev.type]?.ar || ev.type : EVENT_LABELS[ev.type]?.en || ev.type}
                          {ev.fromStatus && ev.toStatus && ev.fromStatus !== ev.toStatus && (
                            <span className="text-muted-foreground font-normal"> — {isAr ? STATUS_FROM_TO[ev.fromStatus]?.ar : STATUS_FROM_TO[ev.fromStatus]?.en} ← {isAr ? STATUS_FROM_TO[ev.toStatus]?.ar : STATUS_FROM_TO[ev.toStatus]?.en}</span>
                          )}
                        </div>
                        {ev.type === 'due_date_change' && ev.oldDueDate && ev.newDueDate && (
                          <div className="text-[11px] text-muted-foreground">{fmtDT(ev.oldDueDate, isAr)} ← {fmtDT(ev.newDueDate, isAr)}</div>
                        )}
                        {ev.note && <div className="text-xs text-muted-foreground mt-0.5 break-words">{ev.note}</div>}
                        <div className="text-[11px] text-muted-foreground mt-0.5">{userName(ev.actor)} · {fmtDT(ev.createdAt, isAr)}</div>
                      </div>
                    </div>
                  ))}
                  {(detail.events || []).length === 0 && <div className="text-xs text-muted-foreground">—</div>}
                </div>
              </div>

              <div className="text-[11px] text-muted-foreground">
                {t('آخر تحديث: ', 'Last update: ')}{fmtDT(detail.updatedAt, isAr)}{detail.lastUpdatedBy ? ' — ' + userName(detail.lastUpdatedBy) : ''}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── نافذة الإجراء (سبب/ملاحظة) ── */}
      <Dialog open={!!act.mode} onOpenChange={(o) => { if (!o) setAct({ mode: null, note: '' }) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-start">
              {act.mode === 'wait' && t('سبب الانتظار (إلزامي)', 'Waiting reason (required)')}
              {act.mode === 'ready' && t('الإجراء المنفذ (ملاحظة إلزامية)', 'Action taken (required note)')}
              {act.mode === 'return' && t('سبب الإعادة للتعديل (إلزامي)', 'Revision reason (required)')}
              {act.mode === 'cancel' && t('سبب إلغاء المهمة (إلزامي — لا تُحذف)', 'Cancel reason (required — task is never deleted)')}
            </DialogTitle>
            <DialogDescription className="text-start">
              {act.mode === 'ready' ? t('اكتب ملاحظة مختصرة عن الإجراء الذي تم، وأرفق الإثبات إن توفر.', 'Write a brief note on what was done; attach proof if available.') : t('سيُسجَّل السبب في سجل المهمة مع اسمك والتاريخ.', 'The reason will be logged in the task history with your name and date.')}
            </DialogDescription>
          </DialogHeader>
          <Textarea value={act.note} onChange={(e) => setAct({ ...act, note: e.target.value })} rows={4} placeholder={t('اكتب هنا...', 'Write here...')} />
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setAct({ mode: null, note: '' })}>{t('إلغاء', 'Cancel')}</Button>
            <Button
              onClick={() => act.mode && doAction(act.mode, act.mode === 'ready' ? { note: act.note } : { reason: act.note })}
              disabled={busy || !act.note.trim()}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t('تأكيد', 'Confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── v119: نافذة تعديل موعد الإنجاز (تذكيراتي) ── */}
      <Dialog open={!!resched} onOpenChange={(o) => { if (!o) setResched(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-start flex items-center gap-2">
              <CalendarClock className="h-4 w-4" /> {t('تعديل موعد الإنجاز', 'Reschedule task')}
            </DialogTitle>
            <DialogDescription className="text-start">
              {resched ? '#' + resched.taskNumber + ' — ' + resched.title : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">{t('موعد الإنجاز الجديد *', 'New due date *')}</Label>
              <Input type="datetime-local" value={resched?.dueDate || ''} onChange={(e) => setResched(resched ? { ...resched, dueDate: e.target.value } : resched)} />
              <p className="text-[11px] text-muted-foreground">{t('اختر تاريخاً ووقتاً في المستقبل. التعديل يُسجَّل في سجل المهمة باسمك ويصل تنبيه للإدارة.', 'Pick a future date & time. The change is logged in the task history under your name and management is notified.')}</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t('سبب التعديل (اختياري)', 'Reason (optional)')}</Label>
              <Input value={resched?.note || ''} onChange={(e) => setResched(resched ? { ...resched, note: e.target.value } : resched)} placeholder={t('مثال: انتظار توريد مواد', 'e.g. waiting for material delivery')} />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setResched(null)}>{t('إلغاء', 'Cancel')}</Button>
            <Button onClick={submitResched} disabled={busy || !resched?.dueDate}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t('حفظ الموعد الجديد', 'Save new date')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── v120: نافذة إنشاء مهمة شخصية (تذكيراتي) ── */}
      <Dialog open={showPersonalForm} onOpenChange={(o) => { if (!o) setShowPersonalForm(false) }}>
        <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-start flex items-center gap-2">
              <NotebookPen className="h-4 w-4" /> {t('مهمة شخصية جديدة', 'New personal task')}
            </DialogTitle>
            <DialogDescription className="text-start">
              {t('تُسجّل لنفسك فقط: عنوان المهمة، تاريخ نهايتها، ضرورتها، وتفاصيلها. يصلك تنبيه يومي حتى موعد النهاية حتى تنجزها — ولا يراها أي شخص آخر.', 'Recorded for you only: task title, end date, priority and details. You get daily reminders until done — nobody else can see them.')}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitPersonal} className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">{t('عنوان المهمة *', 'Task title *')}</Label>
              <Input value={pForm.title} onChange={(e) => setPForm({ ...pForm, title: e.target.value })} placeholder={t('مثال: متابعة توريد المواد مع المورد', 'e.g. follow up material delivery with supplier')} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div className="space-y-1.5">
                <Label className="text-xs">{t('تاريخ نهاية المهمة *', 'End date & time *')}</Label>
                <Input type="datetime-local" value={pForm.dueDate} onChange={(e) => setPForm({ ...pForm, dueDate: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t('ضرورة المهمة', 'Priority')}</Label>
                <Select value={pForm.priority} onValueChange={(v) => setPForm({ ...pForm, priority: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(PRIORITY).map(([k, p]) => (<SelectItem key={k} value={k}>{isAr ? p.ar : p.en}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t('تفاصيل المهمة (اختياري)', 'Details (optional)')}</Label>
              <Textarea rows={3} value={pForm.details} onChange={(e) => setPForm({ ...pForm, details: e.target.value })} placeholder={t('اكتب ما يتعلق بالمهمة: جهات الاتصال، الأرقام، الملاحظات...', 'Write anything related: contacts, numbers, notes...')} />
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setShowPersonalForm(false)}>{t('إلغاء', 'Cancel')}</Button>
              <Button type="submit" disabled={pBusy}>
                {pBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : (<><Plus className="h-4 w-4 ms-1" />{t('حفظ التذكير', 'Save reminder')}</>)}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── v120: نافذة تعديل مهمة شخصية ── */}
      <Dialog open={!!pEditing} onOpenChange={(o) => { if (!o) setPEditing(null) }}>
        <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-start flex items-center gap-2">
              <Pencil className="h-4 w-4" /> {t('تعديل المهمة الشخصية', 'Edit personal task')}
            </DialogTitle>
            <DialogDescription className="text-start">
              {t('تعديل بيانات تذكيرك الخاص: العنوان، تاريخ النهاية، الضرورة والتفاصيل. تغيير الموعد يوقف تنبيهات التأخير القديمة ويعيد الحساب على الموعد الجديد.', 'Edit your private reminder: title, end date, priority and details. Changing the date stops old overdue alerts and recalculates on the new date.')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">{t('عنوان المهمة *', 'Task title *')}</Label>
              <Input value={pEditing?.title || ''} onChange={(e) => setPEditing(pEditing ? { ...pEditing, title: e.target.value } : pEditing)} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div className="space-y-1.5">
                <Label className="text-xs">{t('تاريخ نهاية المهمة *', 'End date & time *')}</Label>
                <Input type="datetime-local" value={pEditing?.dueDate || ''} onChange={(e) => setPEditing(pEditing ? { ...pEditing, dueDate: e.target.value } : pEditing)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t('ضرورة المهمة', 'Priority')}</Label>
                <Select value={pEditing?.priority || 'normal'} onValueChange={(v) => setPEditing(pEditing ? { ...pEditing, priority: v } : pEditing)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(PRIORITY).map(([k, p]) => (<SelectItem key={k} value={k}>{isAr ? p.ar : p.en}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t('تفاصيل المهمة (اختياري)', 'Details (optional)')}</Label>
              <Textarea rows={3} value={pEditing?.details || ''} onChange={(e) => setPEditing(pEditing ? { ...pEditing, details: e.target.value } : pEditing)} />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPEditing(null)}>{t('إلغاء', 'Cancel')}</Button>
            <Button onClick={savePersonalEdit} disabled={pBusy || !String(pEditing?.title || '').trim() || !pEditing?.dueDate}>
              {pBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : t('حفظ التعديل', 'Save changes')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── v120: التقرير الشخصي (يومي / أسبوعي / شهري) من تذكيراتي ── */}
      <Dialog open={showPReport} onOpenChange={(o) => { if (!o) setShowPReport(false) }}>
        <DialogContent className="sm:max-w-[680px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-start flex items-center gap-2">
              <FileText className="h-4 w-4" /> {t('تقريري الشخصي — تذكيراتي', 'My personal report')}
            </DialogTitle>
            <DialogDescription className="text-start">
              {t('تقرير خاص بمهامك الشخصية المسجلة في تذكيراتي فقط — لا يشمل المهام الموكّلة إليك من الإدارة ولا أي بيانات لموظف آخر. يمكن طباعته أو تنزيله بصيغة CSV.', 'A report of your personal tasks recorded in My Reminders only — excludes management-assigned tasks and any other employee data. Print it or download as CSV.')}
            </DialogDescription>
          </DialogHeader>
          {(() => {
            const now = new Date()
            let start: Date
            let labelAr = ''
            if (pReportPeriod === 'day') { start = new Date(now.getFullYear(), now.getMonth(), now.getDate()); labelAr = 'تقرير اليوم' }
            else if (pReportPeriod === 'week') { start = new Date(now.getTime() - 7 * 86400000); labelAr = 'تقرير آخر 7 أيام' }
            else { start = new Date(now.getFullYear(), now.getMonth(), 1); labelAr = 'تقرير هذا الشهر' }
            const rows = personal.filter((r) => new Date(r.createdAt).getTime() >= start.getTime())
            const doneN = rows.filter((r) => r.done).length
            const openRows = rows.filter((r) => !r.done)
            const lateN = openRows.filter((r) => new Date(r.dueDate).getTime() < Date.now()).length
            const P: Record<string, string> = { urgent: 'عاجلة', high: 'عالية', normal: 'عادية', low: 'منخفضة' }
            return (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  {([
                    { k: 'day', label: t('يومي', 'Daily') },
                    { k: 'week', label: t('أسبوعي', 'Weekly') },
                    { k: 'month', label: t('شهري', 'Monthly') },
                  ] as any[]).map((p) => (
                    <Button key={p.k} size="sm" variant={pReportPeriod === p.k ? 'default' : 'outline'} onClick={() => setPReportPeriod(p.k)}>{p.label}</Button>
                  ))}
                  <span className="text-xs text-muted-foreground ms-auto">{t('الفترة', 'Period')}: {labelAr}</span>
                </div>
                <div className="pr-print-area space-y-3">
                  <div className="text-center space-y-1 border-b pb-2">
                    <div className="font-bold">{t('تقرير المهام الشخصية', 'Personal Tasks Report')} — {labelAr}</div>
                    <div className="text-xs text-muted-foreground">{userName(user)} · {fmtDT(now, isAr)}</div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {([
                      { label: t('سُجلت', 'Recorded'), v: rows.length, cls: 'bg-slate-100 text-slate-700' },
                      { label: t('منجزة', 'Completed'), v: doneN, cls: 'bg-emerald-50 text-emerald-700' },
                      { label: t('قيد الانتظار', 'Pending'), v: openRows.length - lateN, cls: 'bg-blue-50 text-blue-700' },
                      { label: t('متأخرة', 'Overdue'), v: lateN, cls: 'bg-red-50 text-red-700' },
                    ] as any[]).map((c, i) => (
                      <div key={i} className={'rounded-xl border p-3 ' + c.cls}>
                        <div className="text-2xl font-bold leading-none">{c.v}</div>
                        <div className="text-xs mt-1.5 opacity-80">{c.label}</div>
                      </div>
                    ))}
                  </div>
                  <div className="overflow-x-auto rounded-xl border">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/50 text-muted-foreground text-xs">
                          <th className="p-2.5 text-start font-medium">{t('المهمة', 'Task')}</th>
                          <th className="p-2.5 text-start font-medium">{t('الضرورة', 'Priority')}</th>
                          <th className="p-2.5 text-start font-medium">{t('تاريخ النهاية', 'End date')}</th>
                          <th className="p-2.5 text-start font-medium">{t('الحالة', 'Status')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.length === 0 ? (
                          <tr><td colSpan={4} className="p-6 text-center text-muted-foreground">{t('لا مهام شخصية مسجلة خلال هذه الفترة', 'No personal tasks recorded in this period')}</td></tr>
                        ) : rows.map((r) => {
                          const late = !r.done && new Date(r.dueDate).getTime() < Date.now()
                          return (
                            <tr key={r.id} className="border-b last:border-b-0 align-top">
                              <td className="p-2.5">
                                <div className={'font-medium' + (r.done ? ' line-through text-muted-foreground' : '')}>{r.title}</div>
                                {r.details && <div className="text-[11px] text-muted-foreground mt-0.5 whitespace-pre-wrap break-words max-w-[280px]">{r.details}</div>}
                              </td>
                              <td className="p-2.5 whitespace-nowrap">{P[r.priority] || r.priority}</td>
                              <td className="p-2.5 whitespace-nowrap">{fmtDT(r.dueDate, isAr)}</td>
                              <td className="p-2.5 whitespace-nowrap">
                                {r.done ? (
                                  <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold bg-emerald-100 text-emerald-700">{t('منجزة', 'Completed')}</span>
                                ) : late ? (
                                  <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold bg-red-100 text-red-700">{t('متأخرة', 'Overdue')}</span>
                                ) : (
                                  <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold bg-blue-50 text-blue-700">{t('قيد الانتظار', 'Pending')}</span>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-[10px] text-muted-foreground">{t('ملاحظة: هذا التقرير شخصي ويُستخرج من مهامك الخاصة في تذكيراتي فقط، ولا يراه أي شخص آخر غيرك.', 'Note: this report is personal and comes from your own tasks in My Reminders only — nobody else can see it.')}</p>
                </div>
                <div className="flex flex-wrap gap-2 justify-end">
                  <Button variant="outline" size="sm" onClick={() => downloadPersonalCsv(rows)} disabled={rows.length === 0}>
                    <Download className="h-3.5 w-3.5 ms-1" /> {t('تنزيل CSV', 'Download CSV')}
                  </Button>
                  <Button size="sm" onClick={() => window.print()} disabled={rows.length === 0}>
                    <FileText className="h-3.5 w-3.5 ms-1" /> {t('طباعة التقرير', 'Print report')}
                  </Button>
                </div>
              </div>
            )
          })()}
        </DialogContent>
      </Dialog>

      {/* v120: أنماط الطباعة — عند الطباعة يُخرج محتوى التقرير الشخصي وحده */}
      <style>{'@media print { body * { visibility: hidden !important; } .pr-print-area, .pr-print-area * { visibility: visible !important; } .pr-print-area { position: absolute !important; top: 0 !important; left: 0 !important; width: 100% !important; max-height: none !important; overflow: visible !important; } }'}</style>
    </div>
  )
}


