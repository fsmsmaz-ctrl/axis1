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
  Undo2, XCircle, Loader2, Clock, AlertTriangle, Filter, ChevronDown, ChevronUp, BarChart3, Download
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

// ─── أدوات مساعدة ───────────────────────────────────────────────

function pad2(n: number) { return String(n).padStart(2, '0') }
function toLocalInput(d: Date) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + 'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes())
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

  const [tab, setTab] = useState<'tasks' | 'perf'>('tasks')
  const [tasks, setTasks] = useState<any[]>([])
  const [users, setUsers] = useState<any[]>([])
  const [viewer, setViewer] = useState<{ isManager: boolean; userId: string }>({ isManager: false, userId: '' })
  const [loading, setLoading] = useState(true)

  // فلاتر العرض (تُطبَّق محلياً على القائمة المجلوبة)
  const [f, setF] = useState({
    assigneeId: '', status: '', priority: '', category: '',
    createdFrom: '', createdTo: '', dueFrom: '', dueTo: '', lateOnly: false,
  })
  const [showFilters, setShowFilters] = useState(false)

  // نموذج الإضافة السريع (للمدير)
  const [form, setForm] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0)
    return { title: '', assigneeId: '', dueDate: toLocalInput(d), priority: 'normal', size: 'medium', category: '', description: '', recurring: '' }
  })
  const [showAdvanced, setShowAdvanced] = useState(false)
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
    try {
      const res = await authedFetch('/api/tasks')
      const data = await res.json()
      setTasks(data.tasks || [])
      if (data.viewer) setViewer(data.viewer)
    } catch {
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

  useEffect(() => {
    fetchTasks()
    fetchUsers()
  }, [])

  useEffect(() => { if (tab === 'perf') fetchPerf(perfMonth) }, [tab])

  async function fetchPerf(month: string) {
    setPerfLoading(true)
    try {
      const res = await authedFetch('/api/tasks/performance?month=' + month)
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
    return tasks.filter((t) => {
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
      return true
    })
  }, [tasks, f])

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
      setForm((p) => ({ ...p, title: '', description: '', category: '', recurring: '' }))
      fetchTasks()
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
      const res = await authedFetch('/api/tasks/' + id)
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
    } finally {
      setDetailLoading(false)
    }
  }

  async function refreshDetail(id: string) {
    const res = await authedFetch('/api/tasks/' + id)
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
    } finally {
      setUploading(false)
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
    const s = STATUS[id]
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
            <h1 className="text-xl lg:text-2xl font-bold">{t('إدارة المهام', 'Task Management')}</h1>
            <p className="text-xs text-muted-foreground">{t('تنظيم مهام الموظفين ومتابعة الإنجاز والتأخير', 'Assign, track and evaluate employee tasks')}</p>
          </div>
        </div>
        {viewer.isManager && (
          <div className="flex gap-1.5">
            <Button variant={tab === 'tasks' ? 'default' : 'outline'} size="sm" onClick={() => setTab('tasks')}>
              <ListChecks className="h-4 w-4 ms-1" /> {t('المهام', 'Tasks')}
            </Button>
            <Button variant={tab === 'perf' ? 'default' : 'outline'} size="sm" onClick={() => setTab('perf')}>
              <BarChart3 className="h-4 w-4 ms-1" /> {t('تقرير الأداء', 'Performance')}
            </Button>
          </div>
        )}
      </div>

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

          {/* نموذج الإضافة السريع — للمدير فقط */}
          {viewer.isManager && (
            <Card>
              <CardContent className="p-4">
                <form onSubmit={submitNew} className="space-y-3">
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-2.5">
                    <div className="lg:col-span-4">
                      <Input placeholder={t('عنوان المهمة *', 'Task title *')} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
                    </div>
                    <div className="lg:col-span-3">
                      <Select value={form.assigneeId} onValueChange={(v) => setForm({ ...form, assigneeId: v })}>
                        <SelectTrigger><SelectValue placeholder={t('الموظف المسؤول *', 'Assignee *')} /></SelectTrigger>
                        <SelectContent>
                          {users.map((u) => (
                            <SelectItem key={u.id} value={u.id}>{userName(u)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="lg:col-span-2">
                      <Input type="datetime-local" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
                    </div>
                    <div className="lg:col-span-1">
                      <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
                        <SelectTrigger aria-label={t('الأولوية', 'Priority')}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(PRIORITY).map(([k, p]) => (
                            <SelectItem key={k} value={k}>{isAr ? p.ar : p.en}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="lg:col-span-1">
                      <Select value={form.size} onValueChange={(v) => setForm({ ...form, size: v })}>
                        <SelectTrigger aria-label={t('الحجم', 'Size')}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(SIZE).map(([k, s]) => (
                            <SelectItem key={k} value={k}>{isAr ? s.ar : s.en}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="lg:col-span-1">
                      <Button type="submit" disabled={saving} className="w-full">
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : (<><Plus className="h-4 w-4 ms-1" />{t('حفظ', 'Save')}</>)}
                      </Button>
                    </div>
                  </div>
                  <button type="button" className="text-xs text-muted-foreground inline-flex items-center gap-1 hover:text-foreground" onClick={() => setShowAdvanced(!showAdvanced)}>
                    {showAdvanced ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    {t('خيارات إضافية (تصنيف، تفاصيل، تكرار) — اختيارية', 'More options (category, details, recurrence) — optional')}
                  </button>
                  {showAdvanced && (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-2.5 pt-1">
                      <Input placeholder={t('القسم / نوع المهمة', 'Category / type')} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
                      <Select value={form.recurring || 'none'} onValueChange={(v) => setForm({ ...form, recurring: v === 'none' ? '' : v })}>
                        <SelectTrigger><SelectValue placeholder={t('التكرار', 'Recurrence')} /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">{t('بدون تكرار', 'No recurrence')}</SelectItem>
                          {Object.entries(RECURRING).map(([k, r]) => (
                            <SelectItem key={k} value={k}>{isAr ? r.ar : r.en}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input placeholder={t('تفاصيل (اختياري)', 'Details (optional)')} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                    </div>
                  )}
                </form>
              </CardContent>
            </Card>
          )}

          {/* شريط الفلاتر */}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowFilters(!showFilters)}>
              <Filter className="h-4 w-4 ms-1" /> {t('فلاتر', 'Filters')}
              {(f.assigneeId || f.status || f.priority || f.category || f.createdFrom || f.createdTo || f.dueFrom || f.dueTo || f.lateOnly) && (
                <span className="h-2 w-2 rounded-full bg-primary ms-1" />
              )}
            </Button>
            {(f.assigneeId || f.status || f.priority || f.category || f.createdFrom || f.createdTo || f.dueFrom || f.dueTo || f.lateOnly) && (
              <Button variant="ghost" size="sm" onClick={() => setF({ assigneeId: '', status: '', priority: '', category: '', createdFrom: '', createdTo: '', dueFrom: '', dueTo: '', lateOnly: false })}>
                <XCircle className="h-4 w-4 ms-1" /> {t('مسح الفلاتر', 'Clear')}
              </Button>
            )}
            <span className="text-xs text-muted-foreground">{filtered.length} / {tasks.length} {t('مهمة', 'tasks')}</span>
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
            <Card><CardContent className="py-16 text-center text-muted-foreground">{t('لا توجد مهام مطابقة', 'No matching tasks')}</CardContent></Card>
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
                        <th className="p-3 text-start font-medium">{t('بال موعد %', 'On-time %')}</th>
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
    </div>
  )
}
