'use client'

// v53: صفحة «الإجازات» — طلباتي (تقديم ومتابعة) | الموافقات (المسؤول المباشر) | الإدارة (الموارد البشرية)
// • تقديم طلب: نوع الإجازة، التواريخ، حساب الأيام تلقائياً وفق أيام العمل والعطلات،
//   سبب اختياري، الموظف البديل، مرفق إلزامي للمرضية (وفق السياسة)
// • منع الرصيد غير الكافي للسنوية ومنع التداخل — تحقق مزدوج (عميل + خادم)
// • الموافقات: اعتماد يخصم الأيام من الرصيد، رفض يتطلب سبباً، إلغاء
// • الإدارة: حالة الموظفين، بانتظار الموافقة، تنبيهات المستندات، الأرصدة، العطلات، السياسة

import { useEffect, useState, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Plane, Plus, Loader2, CheckCircle2, XCircle, Clock, FileText, Ban,
  AlertTriangle, CalendarDays, Users, Wallet, ShieldAlert, Settings, Trash2, Eye, UserX
} from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { authedFetch } from '@/lib/api-client'
import { SystemDiagnosticsButton } from '@/components/system-diagnostics'
import { toast } from 'sonner'

const roleLabels: Record<string, { ar: string; en: string }> = {
  top_management: { ar: 'الإدارة العليا', en: 'Top Management' },
  project_manager: { ar: 'مدير المشروع', en: 'Project Manager' },
  site_engineer: { ar: 'مهندس الموقع', en: 'Site Engineer' },
  hse_officer: { ar: 'مسؤول السلامة', en: 'HSE Officer' },
  foreman: { ar: 'المشرف', en: 'Foreman' },
  accountant: { ar: 'المحاسب', en: 'Accountant' },
  visitor: { ar: 'زائر', en: 'Visitor' },
}

const leaveTypeLabels: Record<string, { ar: string; en: string }> = {
  annual: { ar: 'سنوية', en: 'Annual' },
  sick: { ar: 'مرضية', en: 'Sick' },
  emergency: { ar: 'طارئة', en: 'Emergency' },
  unpaid: { ar: 'بدون راتب', en: 'Unpaid' },
  other: { ar: 'أخرى', en: 'Other' },
}

const leaveStatus: Record<string, { ar: string; en: string; cls: string }> = {
  pending: { ar: 'بانتظار الموافقة', en: 'Pending', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
  approved: { ar: 'معتمد', en: 'Approved', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' },
  rejected: { ar: 'مرفوض', en: 'Rejected', cls: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300' },
  cancelled: { ar: 'ملغى', en: 'Cancelled', cls: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
}

const empStatus: Record<string, { ar: string; en: string; cls: string }> = {
  on_duty: { ar: 'على رأس العمل', en: 'On Duty', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' },
  on_leave: { ar: 'في إجازة', en: 'On Leave', cls: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300' },
  contract_ended: { ar: 'منتهي العقد', en: 'Contract Ended', cls: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300' },
  inactive: { ar: 'معطل', en: 'Inactive', cls: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
}

// أيام الأسبوع بترميز getDay
var WEEKDAYS = [
  { v: 0, ar: 'الأحد', en: 'Sunday' },
  { v: 1, ar: 'الاثنين', en: 'Monday' },
  { v: 2, ar: 'الثلاثاء', en: 'Tuesday' },
  { v: 3, ar: 'الأربعاء', en: 'Wednesday' },
  { v: 4, ar: 'الخميس', en: 'Thursday' },
  { v: 5, ar: 'الجمعة', en: 'Friday' },
  { v: 6, ar: 'السبت', en: 'Saturday' },
]

function fmtDate(v: any, isAr: boolean): string {
  if (!v) return '—'
  try { return new Date(v).toLocaleDateString(isAr ? 'ar-EG' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' }) }
  catch { return '—' }
}

function dayKeyOf(s: string): number {
  var d = new Date(s + 'T00:00:00.000Z')
  return Math.floor(d.getTime() / 86400000)
}

// حساب الأيام في العميل للمعاينة — نفس منطق الخادم (hr.ts)
function countWorkingDaysClient(start: string, end: string, weekend: Set<number>, holidayKeys: Set<number>): number {
  if (!start || !end) return 0
  var sK = dayKeyOf(start), eK = dayKeyOf(end)
  if (eK < sK) return 0
  var count = 0
  var guard = 0
  for (var k = sK; k <= eK && guard < 800; k++, guard++) {
    var d = new Date(k * 86400000)
    if (!weekend.has(d.getUTCDay()) && !holidayKeys.has(k)) count++
  }
  return count
}

function compressImage(file: File, maxSide: number, quality: number, cb: (dataUrl: string) => void, onErr: () => void) {
  var reader = new FileReader()
  reader.onload = function(ev) {
    var result = ev.target?.result as string
    var img = new Image()
    img.onload = function() {
      var w = img.width, h = img.height
      if (w > maxSide || h > maxSide) {
        if (w > h) { h = Math.round(h * maxSide / w); w = maxSide }
        else { w = Math.round(w * maxSide / h); h = maxSide }
      }
      var canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      var ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.drawImage(img, 0, 0, w, h)
        cb(canvas.toDataURL('image/jpeg', quality))
      } else onErr()
    }
    img.onerror = onErr
    img.src = result
  }
  reader.onerror = onErr
  reader.readAsDataURL(file)
}

function StatusBadge({ status, isAr }: { status: string; isAr: boolean }) {
  var st = leaveStatus[status] || leaveStatus.pending
  return <Badge className={st.cls + ' border-0'}>{isAr ? st.ar : st.en}</Badge>
}

export default function HRLeavePage() {
  const language = useAppStore((s) => s.language)
  const token = useAppStore((s) => s.token)
  const isAr = language === 'ar'
  const isRtl = isAr

  var [data, setData] = useState<any | null>(null)
  var [loading, setLoading] = useState(true)
  var [tab, setTab] = useState<'mine' | 'approvals' | 'admin'>('mine')
  var [adminData, setAdminData] = useState<any | null>(null)
  var [adminLoading, setAdminLoading] = useState(false)
  // v57: حالة الخطأ المرئية — كانت أخطاء الشبكة/الخادم تُبتلع صامتة فتبدو الصفحة "لا تفتح"
  var [loadError, setLoadError] = useState<string | null>(null)

  // نموذج طلب جديد
  var [newOpen, setNewOpen] = useState(false)
  var [newForm, setNewForm] = useState({ type: 'annual', startDate: '', endDate: '', reason: '', substituteName: '', attachmentName: '', attachmentData: '' })
  var [newSaving, setNewSaving] = useState(false)
  var attachInputRef = useRef<HTMLInputElement | null>(null)

  // رفض طلب (السبب إلزامي)
  var [rejectId, setRejectId] = useState<string | null>(null)
  var [rejectNote, setRejectNote] = useState('')
  var [decisionLoading, setDecisionLoading] = useState(false)

  // عرض مرفق
  var [viewAtt, setViewAtt] = useState<{ name: string; data: string } | null>(null)

  // الإدارة: أرصدة
  var [balEmpId, setBalEmpId] = useState('')
  var [balForm, setBalForm] = useState({ annualTotal: '', carriedOver: '' })
  var [adjForm, setAdjForm] = useState({ delta: '', reason: '' })
  var [balSaving, setBalSaving] = useState(false)

  // الإدارة: عطلات وسياسة
  var [holidayForm, setHolidayForm] = useState({ date: '', name: '' })
  var [policyForm, setPolicyForm] = useState({ weekend: [] as number[], defaultAnnualDays: '30', sickAttachRequired: true })
  var [policySaving, setPolicySaving] = useState(false)

  var weekendSet = new Set<number>()
  if (data?.policy?.weekendDays) {
    String(data.policy.weekendDays).split(',').forEach(function(s) {
      var n = parseInt(s.trim(), 10)
      if (!isNaN(n)) weekendSet.add(n)
    })
  }
  var holidayKeys = new Set<number>()
  if (data?.holidays) {
    for (var h of data.holidays) holidayKeys.add(dayKeyOf(h.date))
  }

  async function load() {
    setLoading(true)
    try {
      var r = await authedFetch('/api/hr/leave')
      // v57: كشف الردود غير JSON (502/504 HTML من المنصة) — نمط v56
      var ct = r.headers.get('content-type') || ''
      if (ct.indexOf('application/json') === -1) {
        var unexpected = isAr
          ? ('رد غير متوقع من الخادم (رمز ' + r.status + ') — قد تكون قاعدة البيانات أو منصة الاستضافة مشغولة مؤقتاً')
          : ('Unexpected server response (HTTP ' + r.status + ')')
        setLoadError(unexpected)
        setData(null)
        toast.error(unexpected)
        return
      }
      var d = await r.json()
      if (r.ok) { setData(d); setLoadError(null) }
      else {
        var msg = d.message || (isAr ? 'فشل جلب بيانات الإجازات' : 'Failed to load leaves')
        setLoadError(msg)
        toast.error(msg)
      }
    } catch {
      var netErr = isAr
        ? 'تعذر الاتصال بالخادم — تحقق من الاتصال بالإنترنت ثم أعد المحاولة'
        : 'Cannot reach the server — check your connection and retry'
      setLoadError(netErr)
      setData(null)
      toast.error(netErr)
    } finally {
      setLoading(false)
    }
  }

  async function loadAdmin() {
    setAdminLoading(true)
    try {
      var r = await authedFetch('/api/hr/admin')
      var d = await r.json()
      if (r.ok) {
        setAdminData(d)
        setPolicyForm({
          weekend: String(d.policy.weekendDays || '').split(',').map(function(s) { return parseInt(s.trim(), 10) }).filter(function(n) { return !isNaN(n) }),
          defaultAnnualDays: String(d.policy.defaultAnnualDays ?? 30),
          sickAttachRequired: d.policy.sickAttachRequired !== false,
        })
      } else {
        toast.error(d.message || (isAr ? 'فشل جلب لوحة الموارد البشرية' : 'Failed to load HR dashboard'))
      }
    } catch {} finally {
      setAdminLoading(false)
    }
  }

  // v64 إصلاح: نفس خلل hr-file-page — كان الشرط يمنع التحميل للأبد
  // (المتجر لا يحمل توكناً منذ v14 — كوكي httpOnly فقط)
  useEffect(() => {
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  useEffect(() => {
    if (tab === 'admin' && !adminData) loadAdmin()
  }, [tab])

  var canSeeApprovals = !!(data && (data.isHR || data.teamCount > 0))
  var canSeeAdmin = !!(data && data.isHR)
  var myRemaining = data?.balance ? (data.balance.annualTotal + data.balance.carriedOver - data.balance.used) : 0

  var previewDays = countWorkingDaysClient(newForm.startDate, newForm.endDate, weekendSet, holidayKeys)
  var sickNeedsAttach = !!(data?.policy?.sickAttachRequired && newForm.type === 'sick')

  function resetNewForm() {
    setNewForm({ type: 'annual', startDate: '', endDate: '', reason: '', substituteName: '', attachmentName: '', attachmentData: '' })
  }

  function onPickAttachment(e: React.ChangeEvent<HTMLInputElement>) {
    var picked = e.target.files && e.target.files[0]
    if (!picked) return
    var file: File = picked
    if (file.type === 'application/pdf') {
      if (file.size > 3.4 * 1024 * 1024) {
        toast.error(isAr ? 'حجم ملف PDF كبير جداً (الحد 3.4 ميغابايت)' : 'PDF too large (max 3.4MB)')
        return
      }
      var reader = new FileReader()
      reader.onload = function(ev) {
        setNewForm(function(f) { return { ...f, attachmentName: file.name, attachmentData: ev.target?.result as string } })
      }
      reader.readAsDataURL(file)
      return
    }
    if (!file.type.startsWith('image/')) {
      toast.error(isAr ? 'المرفق يجب أن يكون صورة أو PDF' : 'Attachment must be an image or PDF')
      return
    }
    compressImage(file, 1600, 0.75, function(dataUrl) {
      setNewForm(function(f) { return { ...f, attachmentName: file.name, attachmentData: dataUrl } })
    }, function() {
      toast.error(isAr ? 'فشل قراءة الصورة' : 'Failed to read image')
    })
  }

  async function submitNew() {
    if (!newForm.type || !newForm.startDate || !newForm.endDate) {
      toast.error(isAr ? 'نوع الإجازة والتواريخ مطلوبة' : 'Type and dates are required')
      return
    }
    if (sickNeedsAttach && !newForm.attachmentData) {
      toast.error(isAr ? 'إرفاق مستند طبي إلزامي للإجازة المرضية' : 'A medical document is required for sick leave')
      return
    }
    setNewSaving(true)
    try {
      var r = await authedFetch('/api/hr/leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newForm),
      })
      var d = await r.json()
      if (!r.ok) {
        toast.error(d.message || (isAr ? 'فشل إرسال الطلب' : 'Failed to submit'))
        return
      }
      toast.success(isAr ? 'تم إرسال طلب الإجازة — ينتظر موافقة المسؤول المباشر' : 'Leave request submitted — awaiting supervisor approval')
      setNewOpen(false)
      resetNewForm()
      load()
    } catch {
      toast.error(isAr ? 'خطأ في الاتصال' : 'Connection error')
    } finally {
      setNewSaving(false)
    }
  }

  async function decide(id: string, action: 'approve' | 'reject' | 'cancel', note?: string) {
    setDecisionLoading(true)
    try {
      var r = await authedFetch('/api/hr/leave/' + id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, note }),
      })
      var d = await r.json()
      if (!r.ok) {
        toast.error(d.message || (isAr ? 'فشل تنفيذ الإجراء' : 'Action failed'))
        return
      }
      toast.success(isAr ? 'تم تنفيذ الإجراء بنجاح' : 'Action completed')
      setRejectId(null)
      setRejectNote('')
      load()
      if (tab === 'admin') loadAdmin()
    } catch {
      toast.error(isAr ? 'خطأ في الاتصال' : 'Connection error')
    } finally {
      setDecisionLoading(false)
    }
  }

  function pickBalanceEmployee(id: string) {
    setBalEmpId(id)
    var emp = (adminData?.employees || []).find(function(e: any) { return e.id === id })
    setBalForm({
      annualTotal: emp?.annualTotal === null || emp?.annualTotal === undefined ? String(adminData?.policy.defaultAnnualDays ?? 30) : String(emp.annualTotal),
      carriedOver: emp?.carriedOver === null || emp?.carriedOver === undefined ? '0' : String(emp.carriedOver),
    })
    setAdjForm({ delta: '', reason: '' })
  }

  async function saveBalance() {
    if (!balEmpId) return
    setBalSaving(true)
    try {
      var r = await authedFetch('/api/hr/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_balance', userId: balEmpId, annualTotal: balForm.annualTotal, carriedOver: balForm.carriedOver }),
      })
      var d = await r.json()
      if (!r.ok) { toast.error(d.message || (isAr ? 'فشل حفظ الرصيد' : 'Failed to save')); return }
      toast.success(isAr ? 'تم حفظ الرصيد' : 'Balance saved')
      loadAdmin()
    } catch { toast.error(isAr ? 'خطأ في الاتصال' : 'Connection error') } finally { setBalSaving(false) }
  }

  async function adjustBalance() {
    if (!balEmpId) return
    if (!adjForm.reason.trim()) {
      toast.error(isAr ? 'سبب تعديل الرصيد إلزامي' : 'Adjustment reason is required')
      return
    }
    if (!adjForm.delta || parseFloat(adjForm.delta) === 0) {
      toast.error(isAr ? 'أدخل مقدار التعديل (مثال: 1 أو -2)' : 'Enter adjustment amount (e.g. 1 or -2)')
      return
    }
    setBalSaving(true)
    try {
      var r = await authedFetch('/api/hr/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'adjust_balance', userId: balEmpId, delta: parseFloat(adjForm.delta), reason: adjForm.reason.trim() }),
      })
      var d = await r.json()
      if (!r.ok) { toast.error(d.message || (isAr ? 'فشل التعديل' : 'Failed')); return }
      toast.success(isAr ? 'تم تعديل الرصيد وتسجيل السبب' : 'Balance adjusted and logged')
      setAdjForm({ delta: '', reason: '' })
      loadAdmin()
    } catch { toast.error(isAr ? 'خطأ في الاتصال' : 'Connection error') } finally { setBalSaving(false) }
  }

  async function addHoliday() {
    if (!holidayForm.date) {
      toast.error(isAr ? 'اختر تاريخ العطلة' : 'Pick a date')
      return
    }
    try {
      var r = await authedFetch('/api/hr/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add_holiday', date: holidayForm.date, name: holidayForm.name }),
      })
      var d = await r.json()
      if (!r.ok) { toast.error(d.message || (isAr ? 'فشل إضافة العطلة' : 'Failed')); return }
      toast.success(isAr ? 'تمت إضافة العطلة' : 'Holiday added')
      setHolidayForm({ date: '', name: '' })
      loadAdmin()
      load()
    } catch { toast.error(isAr ? 'خطأ في الاتصال' : 'Connection error') }
  }

  async function deleteHoliday(id: string) {
    try {
      var r = await authedFetch('/api/hr/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete_holiday', id }),
      })
      var d = await r.json()
      if (!r.ok) { toast.error(d.message || (isAr ? 'فشل الحذف' : 'Failed')); return }
      toast.success(isAr ? 'تم حذف العطلة' : 'Holiday deleted')
      loadAdmin()
      load()
    } catch { toast.error(isAr ? 'خطأ في الاتصال' : 'Connection error') }
  }

  async function savePolicy() {
    setPolicySaving(true)
    try {
      var r = await authedFetch('/api/hr/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_policy',
          weekendDays: policyForm.weekend.join(','),
          defaultAnnualDays: parseFloat(policyForm.defaultAnnualDays) || 30,
          sickAttachRequired: policyForm.sickAttachRequired,
        }),
      })
      var d = await r.json()
      if (!r.ok) { toast.error(d.message || (isAr ? 'فشل حفظ السياسة' : 'Failed')); return }
      toast.success(isAr ? 'تم حفظ السياسة' : 'Policy saved')
      loadAdmin()
      load()
    } catch { toast.error(isAr ? 'خطأ في الاتصال' : 'Connection error') } finally { setPolicySaving(false) }
  }

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  // v57: شاشة خطأ واضحة مع إعادة المحاولة وتشخيص النظام — بدل صفحة فارغة صامتة
  if (!data && loadError) {
    return (
      <div className="space-y-4 py-10">
        <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-5 text-center">
          <AlertTriangle className="h-8 w-8 text-amber-600" />
          <p className="text-sm font-medium leading-6 text-amber-800 dark:text-amber-300">{loadError}</p>
          <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
            <Button size="sm" onClick={load}>
              <Loader2 className="h-4 w-4" />
              {isAr ? 'إعادة المحاولة' : 'Retry'}
            </Button>
            <SystemDiagnosticsButton isAr={isAr} variant="sm" />
          </div>
        </div>
      </div>
    )
  }

  // v61: بوابة عدم اكتمال البيانات — الموظف (غير الإدارة) ببيانات ناقصة يرى رسالة واحدة فقط في القسم
  // نص الرسالة كما طلبت الإدارة حرفياً: «انت غير مكتمل البيانات , قم بمراجعة الادارة»
  var isManagerView = !!(data && data.isHR)
  if (!isManagerView && data && data.completeness && data.completeness.complete === false) {
    return (
      <div className="py-14">
        <div className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-8 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/20">
            <UserX className="h-7 w-7 text-amber-600 dark:text-amber-400" />
          </div>
          <p className="text-base font-semibold leading-7 text-amber-800 dark:text-amber-200">
            {isAr ? 'انت غير مكتمل البيانات , قم بمراجعة الادارة' : 'Your data is incomplete — please contact management'}
          </p>
        </div>
      </div>
    )
  }

  var tabs: Array<{ id: 'mine' | 'approvals' | 'admin'; label: string }> = [
    { id: 'mine', label: isAr ? 'إجازاتي' : 'My Leaves' },
  ]
  if (canSeeApprovals) tabs.push({ id: 'approvals', label: isAr ? 'الموافقات' : 'Approvals' })
  if (canSeeAdmin) tabs.push({ id: 'admin', label: isAr ? 'الإدارة' : 'Administration' })

  var teamPending = (data?.teamRequests || []).filter(function(r: any) { return r.status === 'pending' })
  var teamOthers = (data?.teamRequests || []).filter(function(r: any) { return r.status !== 'pending' })

  return (
    <div className="space-y-4">
      {/* التبويبات */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {tabs.map(function(t) {
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={'px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all border ' +
                (tab === t.id ? 'bg-primary text-primary-foreground border-primary shadow-sm' : 'bg-background text-muted-foreground hover:bg-muted border-border')}
            >
              {t.id === 'approvals' && teamPending.length > 0 ? t.label + ' (' + teamPending.length + ')' : t.label}
            </button>
          )
        })}
      </div>

      {/* ══════════ إجازاتي ══════════ */}
      {tab === 'mine' && (
        <div className="space-y-4">
          <Card>
            <CardContent className="py-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="secondary" className="gap-1"><CalendarDays className="h-3.5 w-3.5" /> {isAr ? 'الرصيد الكلي' : 'Total'}: {data?.balance ? data.balance.annualTotal + data.balance.carriedOver : 0}</Badge>
                  <Badge variant="outline" className="gap-1"><Clock className="h-3.5 w-3.5" /> {isAr ? 'المستخدم' : 'Used'}: {data?.balance?.used ?? 0}</Badge>
                  <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-0 gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5" /> {isAr ? 'المتبقي' : 'Remaining'}: {myRemaining}
                  </Badge>
                </div>
                <Button size="sm" className="gap-1.5" onClick={() => { resetNewForm(); setNewOpen(true) }}>
                  <Plus className="h-4 w-4" />
                  {isAr ? 'طلب إجازة جديدة' : 'New Leave Request'}
                </Button>
              </div>
            </CardContent>
          </Card>

          {(!data?.requests || data.requests.length === 0) ? (
            <div className="text-center py-12 text-muted-foreground">
              <Plane className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p className="text-sm">{isAr ? 'لا توجد طلبات إجازة — قدّم طلبك الأول' : 'No leave requests — submit your first request'}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {data.requests.map(function(r: any) {
                return (
                  <Card key={r.id}>
                    <CardContent className="py-3">
                      <div className="flex items-start justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline">{(isRtl ? leaveTypeLabels[r.type]?.ar : leaveTypeLabels[r.type]?.en) || r.type}</Badge>
                          <StatusBadge status={r.status} isAr={isAr} />
                          <span className="text-sm font-semibold">{r.days} {isAr ? 'يوم عمل' : 'working days'}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {r.attachmentData && (
                            <Button variant="ghost" size="icon" className="h-8 w-8" title={isAr ? 'عرض المرفق' : 'View attachment'}
                              onClick={() => setViewAtt({ name: r.attachmentName || 'مستند', data: r.attachmentData })}>
                              <Eye className="h-4 w-4" />
                            </Button>
                          )}
                          {r.status === 'pending' && (
                            <Button variant="ghost" size="sm" className="h-8 gap-1 text-destructive hover:text-destructive" disabled={decisionLoading}
                              onClick={() => decide(r.id, 'cancel')}>
                              <Ban className="h-3.5 w-3.5" />
                              {isAr ? 'إلغاء' : 'Cancel'}
                            </Button>
                          )}
                        </div>
                      </div>
                      <p className="text-sm mt-1.5">
                        {fmtDate(r.startDate, isAr)} ← {fmtDate(r.endDate, isAr)}
                        {r.substituteName && <span className="text-muted-foreground"> · {isAr ? 'البديل: ' : 'Sub: '}{r.substituteName}</span>}
                      </p>
                      {r.reason && <p className="text-xs text-muted-foreground mt-0.5">{r.reason}</p>}
                      {r.reviewNote && (
                        <p className={'text-xs mt-1.5 ' + (r.status === 'rejected' ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground')}>
                          {isAr ? 'ملاحظة القرار: ' : 'Decision note: '}{r.reviewNote}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ══════════ الموافقات ══════════ */}
      {tab === 'approvals' && canSeeApprovals && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                {isAr ? 'طلبات بانتظار الموافقة' : 'Pending Requests'}
                {teamPending.length > 0 && <Badge variant="destructive">{teamPending.length}</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {teamPending.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  {isAr ? 'لا توجد طلبات معلقة' : 'No pending requests'}
                </p>
              ) : (
                <div className="space-y-2">
                  {teamPending.map(function(r: any) {
                    var empName = r.employee ? (isRtl ? r.employee.name : (r.employee.nameEn || r.employee.name)) : '—'
                    return (
                      <div key={r.id} className="rounded-xl border p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm">{empName}</span>
                            <Badge variant="outline">{(isRtl ? leaveTypeLabels[r.type]?.ar : leaveTypeLabels[r.type]?.en) || r.type}</Badge>
                            <span className="text-sm">{r.days} {isAr ? 'يوم' : 'days'}</span>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {fmtDate(r.startDate, isAr)} ← {fmtDate(r.endDate, isAr)}
                          </span>
                        </div>
                        {r.employee?.jobTitle && <p className="text-xs text-muted-foreground">{r.employee.jobTitle}</p>}
                        {r.reason && <p className="text-xs text-muted-foreground">{isAr ? 'السبب: ' : 'Reason: '}{r.reason}</p>}
                        {r.substituteName && <p className="text-xs text-muted-foreground">{isAr ? 'الموظف البديل: ' : 'Substitute: '}{r.substituteName}</p>}
                        {r.type === 'annual' && r.remainingBalance !== null && (
                          <p className="text-xs flex items-center gap-1 text-muted-foreground">
                            <Wallet className="h-3.5 w-3.5" />
                            {isAr ? 'رصيده المتبقي: ' : 'Their remaining balance: '}{r.remainingBalance} {isAr ? 'يوم' : 'days'}
                          </p>
                        )}
                        <div className="flex items-center gap-2 flex-wrap pt-1">
                          <Button size="sm" className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white" disabled={decisionLoading}
                            onClick={() => decide(r.id, 'approve')}>
                            <CheckCircle2 className="h-4 w-4" />
                            {isAr ? 'موافقة' : 'Approve'}
                          </Button>
                          <Button size="sm" variant="outline" className="gap-1.5 text-destructive hover:text-destructive border-destructive/40" disabled={decisionLoading}
                            onClick={() => { setRejectId(r.id); setRejectNote('') }}>
                            <XCircle className="h-4 w-4" />
                            {isAr ? 'رفض' : 'Reject'}
                          </Button>
                          {r.attachmentData && (
                            <Button size="sm" variant="ghost" className="gap-1.5"
                              onClick={() => setViewAtt({ name: r.attachmentName || 'مستند', data: r.attachmentData })}>
                              <FileText className="h-4 w-4" />
                              {isAr ? 'عرض المستند' : 'View document'}
                            </Button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {teamOthers.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Clock className="h-4 w-4 text-primary" />
                  {isAr ? 'طلبات تم البت فيها' : 'Decided Requests'}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-2">
                {teamOthers.map(function(r: any) {
                  var empName = r.employee ? (isRtl ? r.employee.name : (r.employee.nameEn || r.employee.name)) : '—'
                  return (
                    <div key={r.id} className="flex items-center justify-between gap-2 text-sm py-2 border-b border-border/40 last:border-0 flex-wrap">
                      <span className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{empName}</span>
                        <Badge variant="outline" className="text-xs">{(isRtl ? leaveTypeLabels[r.type]?.ar : leaveTypeLabels[r.type]?.en) || r.type}</Badge>
                        <StatusBadge status={r.status} isAr={isAr} />
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {fmtDate(r.startDate, isAr)} ← {fmtDate(r.endDate, isAr)} · {r.days} {isAr ? 'يوم' : 'd'}
                      </span>
                    </div>
                  )
                })}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ══════════ الإدارة ══════════ */}
      {tab === 'admin' && canSeeAdmin && (
        adminLoading && !adminData ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : !adminData ? null : (
          <div className="space-y-4">
            {/* ملخص سريع */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Card>
                <CardContent className="py-4 flex items-center gap-3">
                  <Clock className="h-8 w-8 text-amber-500 shrink-0" />
                  <div>
                    <p className="text-2xl font-bold">{adminData.pendingCount}</p>
                    <p className="text-xs text-muted-foreground">{isAr ? 'طلب بانتظار الموافقة' : 'Pending requests'}</p>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="py-4 flex items-center gap-3">
                  <Users className="h-8 w-8 text-primary shrink-0" />
                  <div>
                    <p className="text-2xl font-bold">{adminData.employees?.length || 0}</p>
                    <p className="text-xs text-muted-foreground">{isAr ? 'إجمالي الموظفين' : 'Total employees'}</p>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="py-4 flex items-center gap-3">
                  <AlertTriangle className="h-8 w-8 text-rose-500 shrink-0" />
                  <div>
                    <p className="text-2xl font-bold">{adminData.docAlerts?.length || 0}</p>
                    <p className="text-xs text-muted-foreground">{isAr ? 'مستندات قاربت الانتهاء (60 يوماً)' : 'Documents expiring (60 days)'}</p>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* تنبيهات المستندات */}
            {adminData.docAlerts && adminData.docAlerts.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <ShieldAlert className="h-4 w-4 text-rose-500" />
                    {isAr ? 'تنبيهات انتهاء العقود والجوازات والبطاقات والإقامات' : 'Contract/Passport/ID/Residence Expiry Alerts'}
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 space-y-1.5">
                  {adminData.docAlerts.map(function(a: any, i: number) {
                    return (
                      <div key={i} className="flex items-center justify-between gap-2 text-sm py-2 border-b border-border/40 last:border-0 flex-wrap">
                        <span className="flex items-center gap-2 flex-wrap">
                          <Badge className={(a.expired || a.daysLeft <= 30 ? 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300') + ' border-0'}>
                            {a.expired ? (isAr ? 'منتهٍ' : 'Expired') : (isAr ? 'باقي ' + a.daysLeft + ' يوم' : a.daysLeft + 'd left')}
                          </Badge>
                          <span className="font-medium">{isRtl ? a.name : (a.nameEn || a.name)}</span>
                          <span className="text-muted-foreground text-xs">{a.kindLabel}</span>
                        </span>
                        <span className="text-xs text-muted-foreground">{a.expiry}</span>
                      </div>
                    )
                  })}
                </CardContent>
              </Card>
            )}

            {/* الإجازات القادمة */}
            {adminData.upcoming && adminData.upcoming.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <CalendarDays className="h-4 w-4 text-primary" />
                    {isAr ? 'الإجازات القادمة (30 يوماً) — لتجنب الغياب الجماعي' : 'Upcoming Leaves (30 days)'}
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 space-y-1.5">
                  {adminData.upcoming.map(function(lv: any) {
                    return (
                      <div key={lv.id} className="flex items-center justify-between gap-2 text-sm py-2 border-b border-border/40 last:border-0 flex-wrap">
                        <span className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium">{lv.employee ? (isRtl ? lv.employee.name : (lv.employee.nameEn || lv.employee.name)) : '—'}</span>
                          <Badge variant="outline" className="text-xs">{(isRtl ? leaveTypeLabels[lv.type]?.ar : leaveTypeLabels[lv.type]?.en) || lv.type}</Badge>
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {fmtDate(lv.startDate, isAr)} ← {fmtDate(lv.endDate, isAr)} · {lv.days} {isAr ? 'يوم' : 'd'}
                        </span>
                      </div>
                    )
                  })}
                </CardContent>
              </Card>
            )}

            {/* حالة الموظفين */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="h-4 w-4 text-primary" />
                  {isAr ? 'حالة الموظفين والأرصدة' : 'Employees Status & Balances'}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="space-y-1.5">
                  {adminData.employees.map(function(e: any) {
                    var st = empStatus[e.status] || empStatus.on_duty
                    return (
                      <div key={e.id} className="flex items-center justify-between gap-2 text-sm py-2 border-b border-border/40 last:border-0 flex-wrap">
                        <span className="flex items-center gap-2 flex-wrap min-w-0">
                          <span className="font-medium truncate">{isRtl ? e.name : (e.nameEn || e.name)}</span>
                          <Badge className={st.cls + ' border-0 text-xs'}>
                            {isAr ? st.ar : st.en}{e.leaveUntil ? ' — ' + e.leaveUntil : ''}
                          </Badge>
                          {e.absenceDays > 0 && <span className="text-xs text-rose-500">{isAr ? 'غياب: ' : 'Absence: '}{e.absenceDays}</span>}
                          {e.lateDays > 0 && <span className="text-xs text-amber-500">{isAr ? 'تأخير: ' : 'Late: '}{e.lateDays}</span>}
                        </span>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {isAr ? 'متبقي' : 'Remaining'}: <span className="font-semibold text-foreground">{e.remainingBalance ?? '—'}</span>
                          {e.used !== null && e.used > 0 ? ' · ' + (isAr ? 'مستخدم' : 'used') + ' ' + e.used : ''}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>

            {/* إدارة الأرصدة */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Wallet className="h-4 w-4 text-primary" />
                  {isAr ? 'إدارة أرصدة الإجازات' : 'Leave Balance Management'}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-3">
                <Select value={balEmpId || 'none'} onValueChange={pickBalanceEmployee}>
                  <SelectTrigger className="w-full sm:w-80">
                    <SelectValue placeholder={isAr ? 'اختر موظفاً' : 'Select employee'} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none" disabled>{isAr ? 'اختر موظفاً' : 'Select employee'}</SelectItem>
                    {adminData.employees.map(function(e: any) {
                      return (
                        <SelectItem key={e.id} value={e.id}>
                          {(isRtl ? e.name : (e.nameEn || e.name)) + (e.remainingBalance !== null ? ' (' + (isAr ? 'متبقي ' : 'left ') + e.remainingBalance + ')' : '')}
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
                {balEmpId && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                      <div className="space-y-1">
                        <Label>{isAr ? 'الرصيد السنوي الكلي' : 'Annual Total'}</Label>
                        <Input type="number" min="0" max="365" value={balForm.annualTotal} onChange={(e) => setBalForm({ ...balForm, annualTotal: e.target.value })} />
                      </div>
                      <div className="space-y-1">
                        <Label>{isAr ? 'الرصيد المرحّل' : 'Carried Over'}</Label>
                        <Input type="number" min="0" max="365" value={balForm.carriedOver} onChange={(e) => setBalForm({ ...balForm, carriedOver: e.target.value })} />
                      </div>
                      <Button onClick={saveBalance} disabled={balSaving} className="gap-1.5">
                        {balSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                        {isAr ? 'حفظ الرصيد' : 'Save Balance'}
                      </Button>
                    </div>
                    <div className="rounded-xl border p-3 space-y-2">
                      <p className="text-sm font-medium">{isAr ? 'تعديل فوري (يُسجَّل مع السبب)' : 'Instant Adjustment (logged with reason)'}</p>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                        <div className="space-y-1">
                          <Label>{isAr ? 'مقدار التعديل على المستخدم' : 'Adjustment to Used'}</Label>
                          <Input type="number" step="0.5" placeholder="1 أو -2" value={adjForm.delta} onChange={(e) => setAdjForm({ ...adjForm, delta: e.target.value })} />
                        </div>
                        <div className="space-y-1 sm:col-span-2">
                          <Label>{isAr ? 'سبب التعديل (إلزامي)' : 'Reason (required)'}</Label>
                          <Input value={adjForm.reason} onChange={(e) => setAdjForm({ ...adjForm, reason: e.target.value })} placeholder={isAr ? 'مثال: خصم غياب غير مصرح به' : 'e.g. unapproved absence deduction'} />
                        </div>
                      </div>
                      <Button size="sm" variant="outline" onClick={adjustBalance} disabled={balSaving}>
                        {isAr ? 'تنفيذ التعديل' : 'Apply Adjustment'}
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* العطلات الرسمية */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <CalendarDays className="h-4 w-4 text-primary" />
                  {isAr ? 'العطلات الرسمية المعتمدة' : 'Official Holidays'}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                  <div className="space-y-1">
                    <Label>{isAr ? 'التاريخ' : 'Date'}</Label>
                    <Input type="date" value={holidayForm.date} onChange={(e) => setHolidayForm({ ...holidayForm, date: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label>{isAr ? 'الاسم (اختياري)' : 'Name (optional)'}</Label>
                    <Input value={holidayForm.name} onChange={(e) => setHolidayForm({ ...holidayForm, name: e.target.value })} placeholder={isAr ? 'مثال: العيد الوطني' : 'e.g. National Day'} />
                  </div>
                  <Button onClick={addHoliday} className="gap-1.5">
                    <Plus className="h-4 w-4" />
                    {isAr ? 'إضافة عطلة' : 'Add Holiday'}
                  </Button>
                </div>
                {adminData.holidays.length > 0 && (
                  <div className="space-y-1">
                    {adminData.holidays.map(function(h: any) {
                      return (
                        <div key={h.id} className="flex items-center justify-between gap-2 text-sm py-1.5 border-b border-border/40 last:border-0">
                          <span>{h.date}{h.name ? ' — ' + h.name : ''}</span>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => deleteHoliday(h.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* السياسة */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Settings className="h-4 w-4 text-primary" />
                  {isAr ? 'سياسة الإجازات (قابلة للتعديل — ليست مبرمجة ثابتة)' : 'Leave Policy (editable — not hardcoded)'}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-3">
                <div className="space-y-1.5">
                  <Label>{isAr ? 'أيام نهاية الأسبوع (لا تُحسب ضمن الإجازة)' : 'Weekend Days (not counted as leave)'}</Label>
                  <div className="flex flex-wrap gap-3">
                    {WEEKDAYS.map(function(d) {
                      var on = policyForm.weekend.indexOf(d.v) !== -1
                      return (
                        <label key={d.v} className="flex items-center gap-1.5 text-sm cursor-pointer">
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={function() {
                              setPolicyForm(function(f) {
                                var w = on ? f.weekend.filter(function(x) { return x !== d.v }) : f.weekend.concat([d.v])
                                return { ...f, weekend: w.sort() }
                              })
                            }}
                          />
                          {isAr ? d.ar : d.en}
                        </label>
                      )
                    })}
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
                  <div className="space-y-1">
                    <Label>{isAr ? 'الرصيد السنوي الافتراضي (يوم)' : 'Default Annual Days'}</Label>
                    <Input type="number" min="0" max="365" value={policyForm.defaultAnnualDays} onChange={(e) => setPolicyForm({ ...policyForm, defaultAnnualDays: e.target.value })} />
                  </div>
                  <div className="flex items-center gap-2 pt-4">
                    <Switch checked={policyForm.sickAttachRequired} onCheckedChange={(v) => setPolicyForm({ ...policyForm, sickAttachRequired: v })} id="sick-attach" />
                    <Label htmlFor="sick-attach" className="cursor-pointer">{isAr ? 'المستند إلزامي للإجازة المرضية' : 'Document required for sick leave'}</Label>
                  </div>
                </div>
                <Button onClick={savePolicy} disabled={policySaving} className="gap-1.5">
                  {policySaving && <Loader2 className="h-4 w-4 animate-spin" />}
                  {isAr ? 'حفظ السياسة' : 'Save Policy'}
                </Button>
              </CardContent>
            </Card>
          </div>
        )
      )}

      {/* ══════════ نوافذ مشتركة ══════════ */}

      {/* طلب إجازة جديد */}
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plane className="h-5 w-5 text-primary" />
              {isAr ? 'طلب إجازة جديد' : 'New Leave Request'}
            </DialogTitle>
            <DialogDescription>
              {isAr ? 'تُحسب أيام العمل تلقائياً بعد استبعاد نهاية الأسبوع والعطلات الرسمية' : 'Working days are calculated automatically excluding weekends and holidays'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>{isAr ? 'نوع الإجازة' : 'Leave Type'}</Label>
              <Select value={newForm.type} onValueChange={(v) => setNewForm({ ...newForm, type: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.keys(leaveTypeLabels).map(function(k) {
                    return <SelectItem key={k} value={k}>{isAr ? leaveTypeLabels[k].ar : leaveTypeLabels[k].en}</SelectItem>
                  })}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>{isAr ? 'من تاريخ' : 'From'}</Label>
                <Input type="date" value={newForm.startDate} onChange={(e) => setNewForm({ ...newForm, startDate: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>{isAr ? 'إلى تاريخ' : 'To'}</Label>
                <Input type="date" value={newForm.endDate} onChange={(e) => setNewForm({ ...newForm, endDate: e.target.value })} />
              </div>
            </div>
            {newForm.startDate && newForm.endDate && (
              <div className="flex items-center gap-2 text-sm">
                <Badge variant={previewDays > 0 ? 'secondary' : 'destructive'}>
                  {previewDays > 0
                    ? (isAr ? previewDays + ' يوم عمل' : previewDays + ' working day(s)')
                    : (isAr ? 'لا أيام عمل في هذه الفترة' : 'No working days in this period')}
                </Badge>
                {newForm.type === 'annual' && (
                  <span className="text-xs text-muted-foreground">
                    {isAr ? 'المتبقي لديك: ' : 'Your remaining: '}{myRemaining}
                  </span>
                )}
              </div>
            )}
            <div className="space-y-1">
              <Label>{isAr ? 'السبب / ملاحظات (اختياري)' : 'Reason / Notes (optional)'}</Label>
              <Textarea rows={2} value={newForm.reason} onChange={(e) => setNewForm({ ...newForm, reason: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>{isAr ? 'الموظف البديل (عند الحاجة)' : 'Substitute Employee (if needed)'}</Label>
              <Input value={newForm.substituteName} onChange={(e) => setNewForm({ ...newForm, substituteName: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>
                {isAr ? 'المستند المرفق' : 'Attachment'}
                {sickNeedsAttach && <span className="text-destructive"> ({isAr ? 'إلزامي للمرضية' : 'required for sick leave'})</span>}
              </Label>
              <input ref={attachInputRef} type="file" accept="image/*,.pdf" className="hidden" onChange={onPickAttachment} />
              <Button variant="outline" size="sm" className="gap-1.5 w-full" onClick={() => attachInputRef.current?.click()}>
                <FileText className="h-4 w-4" />
                {newForm.attachmentName ? newForm.attachmentName : (isAr ? 'اختر صورة أو PDF' : 'Pick image or PDF')}
              </Button>
              {newForm.attachmentData && (
                <Button variant="ghost" size="sm" className="text-destructive h-7" onClick={() => setNewForm({ ...newForm, attachmentName: '', attachmentData: '' })}>
                  {isAr ? 'إزالة المرفق' : 'Remove attachment'}
                </Button>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)}>{isAr ? 'إلغاء' : 'Cancel'}</Button>
            <Button onClick={submitNew} disabled={newSaving} className="gap-1.5">
              {newSaving && <Loader2 className="h-4 w-4 animate-spin" />}
              {isAr ? 'إرسال الطلب' : 'Submit Request'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* رفض — السبب إلزامي */}
      <Dialog open={!!rejectId} onOpenChange={(v) => { if (!v) { setRejectId(null); setRejectNote('') } }}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <XCircle className="h-5 w-5" />
              {isAr ? 'رفض طلب الإجازة' : 'Reject Leave Request'}
            </DialogTitle>
            <DialogDescription>
              {isAr ? 'يجب كتابة سبب الرفض — يصل الموظف إشعاراً به' : 'A rejection reason is required — the employee will be notified'}
            </DialogDescription>
          </DialogHeader>
          <Textarea rows={3} value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} placeholder={isAr ? 'مثال: يرجى تعديل التواريخ لتغطية فترة التشغيل' : 'e.g. please adjust dates to cover the operation period'} />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRejectId(null); setRejectNote('') }}>{isAr ? 'تراجع' : 'Back'}</Button>
            <Button
              variant="destructive"
              disabled={decisionLoading || !rejectNote.trim()}
              onClick={function() { if (rejectId) decide(rejectId, 'reject', rejectNote.trim()) }}
              className="gap-1.5"
            >
              {decisionLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              {isAr ? 'تأكيد الرفض' : 'Confirm Rejection'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* عرض مرفق */}
      <Dialog open={!!viewAtt} onOpenChange={(v) => { if (!v) setViewAtt(null) }}>
        <DialogContent className="sm:max-w-[640px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              {viewAtt?.name}
            </DialogTitle>
          </DialogHeader>
          {viewAtt && viewAtt.data.startsWith('data:image/') ? (
            <img src={viewAtt.data} alt={viewAtt.name} className="max-w-full rounded-xl border" />
          ) : viewAtt ? (
            <a href={viewAtt.data} target="_blank" rel="noreferrer" className="text-primary underline text-sm">
              {isAr ? 'فتح المستند (PDF)' : 'Open document (PDF)'}
            </a>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
