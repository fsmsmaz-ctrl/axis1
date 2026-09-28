'use client'

// v53: صفحة «ملفي الوظيفي» — بيانات الموظف الوظيفية ومدة الخدمة والأرصدة والمستندات وسجل الإجازات
// • تُضمَّن كاملة داخل صفحة «الملف الشخصي» (hideHeader) ليراى الموظف كل بياناته في مكان واحد
// • الموظف يرى ملفه فقط — الإدارة/الموارد البشرية ترى أي ملف ويمكنها تعديله
// • الرواتب سرية: تظهر للموظف نفسه والإدارة فقط (الخادم لا يرسلها لغيرهم أصلاً)
// • تنبيهات انتهاء الجواز والبطاقة والإقامة والعقد (أحمر ≤30 يوماً، كهرماني ≤60)

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import {
  Briefcase, Wallet, FileCheck, Pencil, Loader2, Clock, Plane, History, AlertTriangle,
  Search, Users, UserX, CheckCircle2
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

// v61: رسالة الموظف غير المكتمل بياناته — نصها كما طلبت الإدارة حرفياً
var INCOMPLETE_MSG_AR = 'انت غير مكتمل البيانات , قم بمراجعة الادارة'
var INCOMPLETE_MSG_EN = 'Your data is incomplete — please contact management'

// v61: تسميات الحقول الناقصة (تظهر للإدارة في قائمة التعبئة)
const missingLabels: Record<string, { ar: string; en: string }> = {
  jobTitle: { ar: 'المسمى الوظيفي', en: 'Job title' },
  department: { ar: 'القسم / المشروع', en: 'Department' },
  joinDate: { ar: 'تاريخ الالتحاق', en: 'Join date' },
  leaveBalance: { ar: 'بيانات الإجازة (الرصيد)', en: 'Leave data (balance)' },
}

// v61: بطاقة واحدة فقط للموظف الذي بياناته غير مكتملة — بدل كل بيانات القسم
function IncompleteDataCard({ isAr }: { isAr: boolean }) {
  return (
    <div className="py-14">
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-8 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/20">
          <UserX className="h-7 w-7 text-amber-600 dark:text-amber-400" />
        </div>
        <p className="text-base font-semibold leading-7 text-amber-800 dark:text-amber-200">
          {isAr ? INCOMPLETE_MSG_AR : INCOMPLETE_MSG_EN}
        </p>
      </div>
    </div>
  )
}

// v61: قائمة «تعبئة بيانات المستخدمين» — للإدارة فقط (isHRManager على الخادم)
// تعرض كل موظف مع حالة اكتمال بياناته (الوظيفية + الإجازة) وزر تعبئة يفتح نموذج الإدخال الكامل
function RosterCard({
  isAr, isRtl, roster, rosterSearch, setRosterSearch, rosterFilter, setRosterFilter, fillLoadingId, onFill,
}: {
  isAr: boolean
  isRtl: boolean
  roster: any[]
  rosterSearch: string
  setRosterSearch: (v: string) => void
  rosterFilter: 'all' | 'incomplete' | 'complete'
  setRosterFilter: (v: 'all' | 'incomplete' | 'complete') => void
  fillLoadingId: string
  onFill: (userId: string) => void
}) {
  var completeCount = 0
  for (var i = 0; i < roster.length; i++) if (roster[i].complete) completeCount++
  var filtered = roster.filter(function(emp: any) {
    if (rosterFilter === 'incomplete' && emp.complete) return false
    if (rosterFilter === 'complete' && !emp.complete) return false
    var q = rosterSearch.trim().toLowerCase()
    if (q) {
      var hay = ((emp.name || '') + ' ' + (emp.nameEn || '') + ' ' + (emp.jobTitle || '') + ' ' + (emp.employeeNo || '')).toLowerCase()
      if (hay.indexOf(q) === -1) return false
    }
    return true
  })
  return (
    <Card className="border-primary/30">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <Users className="h-4 w-4 text-primary" />
          {isAr ? 'تعبئة بيانات المستخدمين' : 'Fill Employee Data'}
          <Badge variant="outline" className="gap-1">
            <CheckCircle2 className="h-3 w-3" />
            {completeCount}/{roster.length} {isAr ? 'مكتمل' : 'complete'}
          </Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground leading-5 mt-1">
          {isAr
            ? 'أدخل لكل موظف بياناته الوظيفية الأساسية (المسمى الوظيفي، القسم، تاريخ الالتحاق) وبيانات الإجازة (الرصيد السنوي) — بعد الاكتمال تظهر بياناته له تلقائياً في قسمه. الموظف الذي بياناته ناقصة يرى رسالة «انت غير مكتمل البيانات , قم بمراجعة الادارة» فقط.'
            : 'Enter each employee’s essential employment data (job title, department, join date) and leave data (annual balance) — once complete, the data appears to them automatically. Employees with incomplete data see only a notice to contact management.'}
        </p>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={rosterSearch}
              onChange={(e) => setRosterSearch(e.target.value)}
              placeholder={isAr ? 'بحث بالاسم أو الرقم الوظيفي…' : 'Search by name or employee no…'}
              className="ps-8"
            />
          </div>
          <Select value={rosterFilter} onValueChange={(v: any) => setRosterFilter(v)}>
            <SelectTrigger className="sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{isAr ? 'كل الموظفين' : 'All employees'}</SelectItem>
              <SelectItem value="incomplete">{isAr ? 'ناقص البيانات فقط' : 'Incomplete only'}</SelectItem>
              <SelectItem value="complete">{isAr ? 'المكتملة فقط' : 'Complete only'}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-3">
              {isAr ? 'لا توجد نتائج مطابقة' : 'No matching employees'}
            </p>
          ) : filtered.map(function(emp: any) {
            var empName = isRtl ? emp.name : (emp.nameEn || emp.name)
            var missingText = (emp.missing || [])
              .map(function(k: string) { return isAr ? missingLabels[k]?.ar : missingLabels[k]?.en })
              .filter(Boolean)
              .join(isAr ? '، ' : ', ')
            return (
              <div key={emp.id} className="flex items-center justify-between gap-3 rounded-xl border p-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium truncate">{empName}</span>
                    <Badge variant="secondary">{(isRtl ? roleLabels[emp.role]?.ar : roleLabels[emp.role]?.en) || emp.role}</Badge>
                    {emp.complete ? (
                      <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-0 gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        {isAr ? 'مكتمل' : 'Complete'}
                      </Badge>
                    ) : (
                      <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-0 gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        {isAr ? 'بيانات ناقصة' : 'Incomplete'}
                      </Badge>
                    )}
                    {!emp.active && <Badge variant="destructive">{isAr ? 'معطل' : 'Inactive'}</Badge>}
                  </div>
                  {!emp.complete && missingText && (
                    <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-1">
                      {isAr ? 'الناقص: ' : 'Missing: '}{missingText}
                    </p>
                  )}
                  {(emp.jobTitle || emp.department) && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {emp.jobTitle || ''}{emp.jobTitle && emp.department ? ' — ' : ''}{emp.department || ''}
                      {emp.leaveComplete && emp.remainingBalance !== null && emp.remainingBalance !== undefined ? (isAr ? ' · رصيد الإجازة المتبقي: ' : ' · Leave left: ') + emp.remainingBalance + (isAr ? ' يوم' : 'd') : ''}
                    </p>
                  )}
                </div>
                <Button
                  size="sm"
                  variant={emp.complete ? 'outline' : 'default'}
                  className="gap-1.5 shrink-0"
                  onClick={() => onFill(emp.id)}
                  disabled={fillLoadingId === emp.id}
                >
                  {fillLoadingId === emp.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-3.5 w-3.5" />}
                  {isAr ? 'تعبئة البيانات' : 'Fill data'}
                </Button>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

function fmtDate(v: any, isAr: boolean): string {
  if (!v) return '—'
  try { return new Date(v).toLocaleDateString(isAr ? 'ar-EG' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' }) }
  catch { return '—' }
}

// مدة الخدمة محسوبة تلقائياً من تاريخ الالتحاق
function serviceDuration(joinDate: any, isAr: boolean): string {
  if (!joinDate) return '—'
  var start = new Date(joinDate)
  var now = new Date()
  if (isNaN(start.getTime()) || start > now) return '—'
  var years = now.getFullYear() - start.getFullYear()
  var months = now.getMonth() - start.getMonth()
  var days = now.getDate() - start.getDate()
  if (days < 0) {
    months--
    var prevMonth = new Date(now.getFullYear(), now.getMonth(), 0).getDate()
    days += prevMonth
  }
  if (months < 0) { years--; months += 12 }
  var parts: string[] = []
  if (isAr) {
    if (years > 0) parts.push(years + (years === 1 ? ' سنة' : years === 2 ? ' سنتان' : ' سنوات'))
    if (months > 0) parts.push(months + (months === 1 ? ' شهر' : ' أشهر'))
    if (days > 0) parts.push(days + (days === 1 ? ' يوم' : ' أيام'))
    return parts.length ? parts.join(' و') : 'أقل من يوم'
  }
  if (years > 0) parts.push(years + 'y')
  if (months > 0) parts.push(months + 'm')
  if (days > 0) parts.push(days + 'd')
  return parts.length ? parts.join(' ') : '<1d'
}

// حالة انتهاء المستند: أحمر ≤30 أو منتهٍ، كهرماني ≤60، عادي بعدها
function expiryBadge(expiry: any, isAr: boolean): { label: string; cls: string } | null {
  if (!expiry) return null
  var d = new Date(expiry)
  if (isNaN(d.getTime())) return null
  var todayKey = Math.floor(Date.now() / 86400000)
  var expKey = Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86400000)
  var daysLeft = expKey - todayKey
  if (daysLeft < 0) return { label: isAr ? 'منتهٍ' : 'Expired', cls: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300' }
  if (daysLeft <= 30) return { label: isAr ? 'ينتهي خلال ' + daysLeft + ' يوم' : 'Expires in ' + daysLeft + 'd', cls: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300' }
  if (daysLeft <= 60) return { label: isAr ? 'ينتهي خلال ' + daysLeft + ' يوماً' : 'Expires in ' + daysLeft + 'd', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' }
  return null
}

function InfoRow({ label, value, isAr }: { label: string; value: any; isAr: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-border/50 last:border-0">
      <span className="text-sm text-muted-foreground shrink-0">{label}</span>
      <span className="text-sm font-medium text-start break-words">{value === null || value === undefined || value === '' ? (isAr ? 'غير محدد' : 'Not set') : value}</span>
    </div>
  )
}

var EMPTY_FORM = {
  employeeNo: '', jobTitle: '', department: '', workLocation: '', supervisorId: '',
  joinDate: '', contractStart: '', contractEnd: '',
  baseSalary: '', allowances: '',
  passportNo: '', passportExpiry: '', idNo: '', idExpiry: '', residenceNo: '', residenceExpiry: '',
  absenceDays: '', lateDays: '',
  // v61: بيانات الإجازة — تُحفظ عبر /api/hr/admin (set_balance) وليس PUT /api/hr
  annualTotal: '', carriedOver: '',
}

export default function HRFilePage({ hideHeader = false }: { hideHeader?: boolean }) {
  const language = useAppStore((s) => s.language)
  const token = useAppStore((s) => s.token)
  const isAr = language === 'ar'
  const isRtl = isAr

  const [data, setData] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)
  const [targetId, setTargetId] = useState<string>('')
  // v57: حالة الخطأ المرئية — كانت أخطاء الشبكة/الخادم تُبتلع صامتة فتبدو الصفحة "لا تفتح"
  const [loadError, setLoadError] = useState<string | null>(null)

  // تعديل الملف (الإدارة)
  const [editOpen, setEditOpen] = useState(false)
  const [form, setForm] = useState<any>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  // v61: قائمة «تعبئة بيانات المستخدمين» — بحث وفلترة وتحميل لكل صف
  const [rosterSearch, setRosterSearch] = useState('')
  const [rosterFilter, setRosterFilter] = useState<'all' | 'incomplete' | 'complete'>('all')
  const [fillLoadingId, setFillLoadingId] = useState('')
  // v61: قيم الرصيد عند فتح النافذة — لكشف التغيير (لا نُرسل set_balance إلا عند التعديل الفعلي)
  const [balanceBaseline, setBalanceBaseline] = useState<{ annualTotal: string; carriedOver: string } | null>(null)

  async function load(userId?: string) {
    setLoading(true)
    try {
      const url = userId ? '/api/hr?userId=' + encodeURIComponent(userId) : '/api/hr'
      const r = await authedFetch(url)
      // v57: كشف الردود غير JSON (502/504 HTML من المنصة) — نمط v56
      const ct = r.headers.get('content-type') || ''
      if (ct.indexOf('application/json') === -1) {
        var unexpected = isAr
          ? ('رد غير متوقع من الخادم (رمز ' + r.status + ') — قد تكون قاعدة البيانات أو منصة الاستضافة مشغولة مؤقتاً')
          : ('Unexpected server response (HTTP ' + r.status + ')')
        setLoadError(unexpected)
        setData(null)
        toast.error(unexpected)
        return
      }
      const d = await r.json()
      if (r.ok) { setData(d); setLoadError(null) }
      else {
        var msg = d.message || (isAr ? 'فشل جلب الملف الوظيفي' : 'Failed to load HR file')
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

  useEffect(() => {
    if (!token) return
    load(targetId || undefined)
  }, [token, targetId])

  function toDayInput(v: any): string {
    if (!v) return ''
    var d = new Date(v)
    if (isNaN(d.getTime())) return ''
    return d.toISOString().slice(0, 10)
  }

  // v61: بناء النموذج من الملف + الرصيد (يشمل بيانات الإجازة)
  function buildForm(p: any, b?: any) {
    return {
      employeeNo: p.employeeNo || '',
      jobTitle: p.jobTitle || '',
      department: p.department || '',
      workLocation: p.workLocation || '',
      supervisorId: p.supervisorId || '',
      joinDate: toDayInput(p.joinDate),
      contractStart: toDayInput(p.contractStart),
      contractEnd: toDayInput(p.contractEnd),
      baseSalary: p.baseSalary === null || p.baseSalary === undefined ? '' : String(p.baseSalary),
      allowances: p.allowances === null || p.allowances === undefined ? '' : String(p.allowances),
      passportNo: p.passportNo || '',
      passportExpiry: toDayInput(p.passportExpiry),
      idNo: p.idNo || '',
      idExpiry: toDayInput(p.idExpiry),
      residenceNo: p.residenceNo || '',
      residenceExpiry: toDayInput(p.residenceExpiry),
      absenceDays: p.absenceDays === null || p.absenceDays === undefined ? '' : String(p.absenceDays),
      lateDays: p.lateDays === null || p.lateDays === undefined ? '' : String(p.lateDays),
      annualTotal: b && b.annualTotal !== null && b.annualTotal !== undefined ? String(b.annualTotal) : '',
      carriedOver: b && b.carriedOver !== null && b.carriedOver !== undefined ? String(b.carriedOver) : '',
    }
  }

  function openEdit() {
    if (!data?.profile) return
    setForm(buildForm(data.profile, data.balance))
    setBalanceBaseline({
      annualTotal: data.balance && data.balance.annualTotal !== null && data.balance.annualTotal !== undefined ? String(data.balance.annualTotal) : '',
      carriedOver: data.balance && data.balance.carriedOver !== null && data.balance.carriedOver !== undefined ? String(data.balance.carriedOver) : '',
    })
    setEditOpen(true)
  }

  // v61: فتح نموذج التعبئة لموظف محدد من القائمة — يجلب ملفه أولاً ثم يفتح النافذة
  async function openEditFor(userId: string) {
    setFillLoadingId(userId)
    try {
      const r = await authedFetch('/api/hr?userId=' + encodeURIComponent(userId))
      const ct = r.headers.get('content-type') || ''
      if (ct.indexOf('application/json') === -1) {
        toast.error(isAr ? 'رد غير متوقع من الخادم (رمز ' + r.status + ')' : 'Unexpected server response (HTTP ' + r.status + ')')
        return
      }
      const d = await r.json()
      if (!r.ok || !d?.profile) {
        toast.error(d.message || (isAr ? 'فشل جلب ملف الموظف' : 'Failed to load employee file'))
        return
      }
      // عرض ملف الموظف المعني تحت النافذة — يتسق مع ما يُعدَّل
      setTargetId(userId)
      setData(d)
      setForm(buildForm(d.profile, d.balance))
      setBalanceBaseline({
        annualTotal: d.balance && d.balance.annualTotal !== null && d.balance.annualTotal !== undefined ? String(d.balance.annualTotal) : '',
        carriedOver: d.balance && d.balance.carriedOver !== null && d.balance.carriedOver !== undefined ? String(d.balance.carriedOver) : '',
      })
      setEditOpen(true)
    } catch {
      toast.error(isAr ? 'خطأ في الاتصال' : 'Connection error')
    } finally {
      setFillLoadingId('')
    }
  }

  async function saveEdit() {
    if (!data?.profile) return
    setSaving(true)
    try {
      // v61: بيانات الإجازة — تُحفظ فقط إذا أدخلها المدير فعلياً وتغيّرت عن القيم المحمّلة
      var balChanged = false
      var annualNum: number | null = null
      var carriedNum = 0
      var annualRaw = String(form.annualTotal ?? '').trim()
      var carriedRaw = String(form.carriedOver ?? '').trim()
      if (annualRaw !== '' || carriedRaw !== '') {
        annualNum = annualRaw === '' ? null : parseFloat(annualRaw)
        carriedNum = carriedRaw === '' ? 0 : parseFloat(carriedRaw)
        if (annualNum !== null && (isNaN(annualNum) || annualNum < 0 || annualNum > 365)) {
          toast.error(isAr ? 'الرصيد السنوي المعتمد يجب أن يكون بين 0 و365' : 'Annual balance must be between 0 and 365')
          return
        }
        if (isNaN(carriedNum) || carriedNum < 0 || carriedNum > 365) {
          toast.error(isAr ? 'الرصيد المرحّل يجب أن يكون بين 0 و365' : 'Carried-over balance must be between 0 and 365')
          return
        }
        var base = balanceBaseline || { annualTotal: '', carriedOver: '' }
        balChanged = annualRaw !== base.annualTotal || carriedRaw !== base.carriedOver
      }
      var jobForm = { ...form }
      delete jobForm.annualTotal
      delete jobForm.carriedOver
      const r = await authedFetch('/api/hr', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: data.profile.id, ...jobForm }),
      })
      const d = await r.json()
      if (!r.ok) {
        toast.error(d.message || (isAr ? 'فشل حفظ التعديلات' : 'Failed to save'))
        return
      }
      if (balChanged && annualNum !== null) {
        const r2 = await authedFetch('/api/hr/admin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'set_balance', userId: data.profile.id, annualTotal: annualNum, carriedOver: carriedNum }),
        })
        const d2 = await r2.json().catch(() => null)
        if (!r2.ok || !d2) {
          toast.error((d2 && d2.message) || (isAr ? 'تم حفظ البيانات الوظيفية لكن فشل حفظ رصيد الإجازة' : 'File saved but leave balance failed'))
          load(targetId || undefined)
          return
        }
      }
      toast.success(isAr ? 'تم حفظ بيانات الموظف بنجاح' : 'Employee data saved successfully')
      setEditOpen(false)
      load(targetId || undefined)
    } catch {
      toast.error(isAr ? 'خطأ في الاتصال' : 'Connection error')
    } finally {
      setSaving(false)
    }
  }

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }
  if (!data?.profile) {
    // v57: شاشة خطأ واضحة مع إعادة المحاولة وتشخيص النظام — بدل «لا توجد بيانات» الصامتة
    if (loadError) {
      return (
        <div className="space-y-4 py-10">
          <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-5 text-center">
            <AlertTriangle className="h-8 w-8 text-amber-600" />
            <p className="text-sm font-medium leading-6 text-amber-800 dark:text-amber-300">{loadError}</p>
            <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
              <Button size="sm" onClick={function() { load(targetId || undefined) }}>
                <Loader2 className="h-4 w-4" />
                {isAr ? 'إعادة المحاولة' : 'Retry'}
              </Button>
              <SystemDiagnosticsButton isAr={isAr} variant="sm" />
            </div>
          </div>
        </div>
      )
    }
    return (
      <div className="text-center py-16 text-muted-foreground">
        {isAr ? 'لا توجد بيانات للعرض' : 'No data to display'}
      </div>
    )
  }

  // v61: بوابة عدم اكتمال البيانات — الموظف (غير الإدارة) ببيانات ناقصة يرى رسالة واحدة فقط في القسم
  // نص الرسالة كما طلبت الإدارة حرفياً: «انت غير مكتمل البيانات , قم بمراجعة الادارة»
  if (!data.canEdit && data.completeness && data.completeness.complete === false) {
    return <IncompleteDataCard isAr={isAr} />
  }

  var p = data.profile
  var b = data.balance
  var totalBalance = b ? (b.annualTotal + b.carriedOver - b.used) : 0
  var displayName = isRtl ? p.name : (p.nameEn || p.name)
  var roleLabel = isRtl ? roleLabels[p.role]?.ar : roleLabels[p.role]?.en
  var contractExpiryBadge = expiryBadge(p.contractEnd, isAr)

  return (
    <div className="space-y-4">
      {/* v61: تعبئة بيانات المستخدمين — الإدارة فقط: قائمة الموظفين بحالة الاكتمال ونموذج التعبئة */}
      {data.canEdit && data.roster && data.roster.length > 0 && (
        <RosterCard
          isAr={isAr}
          isRtl={isRtl}
          roster={data.roster}
          rosterSearch={rosterSearch}
          setRosterSearch={setRosterSearch}
          rosterFilter={rosterFilter}
          setRosterFilter={setRosterFilter}
          fillLoadingId={fillLoadingId}
          onFill={openEditFor}
        />
      )}

      {/* محدد الموظف للإدارة/الموارد البشرية — يُخفى عند التضمين داخل الملف الشخصي */}
      {!hideHeader && data.canEdit && data.employees && data.employees.length > 0 && (
        <Card>
          <CardContent className="py-3">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <span className="text-sm font-medium shrink-0">{isAr ? 'عرض ملف موظف:' : 'View employee file:'}</span>
              <Select value={targetId || p.id} onValueChange={(v) => setTargetId(v === p.id ? '' : v)}>
                <SelectTrigger className="w-full sm:w-72">
                  <SelectValue placeholder={isAr ? 'اختر موظفاً' : 'Select employee'} />
                </SelectTrigger>
                <SelectContent>
                  {data.employees.map((emp: any) => (
                    <SelectItem key={emp.id} value={emp.id}>
                      {(isRtl ? emp.name : (emp.nameEn || emp.name)) + (emp.jobTitle ? ' — ' + emp.jobTitle : '')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {targetId && (
                <Button variant="ghost" size="sm" onClick={() => setTargetId('')}>
                  {isAr ? 'ملفي' : 'My file'}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* الترويسة: الصورة والاسم والدور + زر التعديل للإدارة — تُخفى عند التضمين داخل الملف الشخصي */}
      {hideHeader ? null : (
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center gap-4 flex-wrap">
            <Avatar className="h-16 w-16 border-2 border-primary/20">
              {p.avatar && <AvatarImage src={p.avatar} alt={displayName} />}
              <AvatarFallback className="bg-primary/10 text-primary text-xl font-semibold">{displayName.charAt(0)}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <h3 className="text-lg font-semibold truncate">{displayName}</h3>
              <div className="flex items-center gap-2 flex-wrap mt-1">
                <Badge variant="secondary">{roleLabel || p.role}</Badge>
                {p.employeeNo && <Badge variant="outline">{isAr ? 'رقم وظيفي: ' : 'No.: '}{p.employeeNo}</Badge>}
                {!p.active && <Badge variant="destructive">{isAr ? 'الحساب معطل' : 'Inactive'}</Badge>}
              </div>
              <p className="text-xs text-muted-foreground mt-1">{p.email}{p.phone ? ' · ' + p.phone : ''}</p>
            </div>
            {data.canEdit && (
              <Button size="sm" onClick={openEdit} className="gap-1.5">
                <Pencil className="h-4 w-4" />
                {isAr ? 'تعديل الملف' : 'Edit file'}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* البيانات الوظيفية */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Briefcase className="h-4 w-4 text-primary" />
              {isAr ? 'البيانات الوظيفية' : 'Employment Data'}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <InfoRow label={isAr ? 'المسمى الوظيفي' : 'Job Title'} value={p.jobTitle} isAr={isAr} />
            <InfoRow label={isAr ? 'القسم / المشروع' : 'Department / Project'} value={p.department} isAr={isAr} />
            <InfoRow label={isAr ? 'موقع العمل الحالي' : 'Current Work Location'} value={p.workLocation} isAr={isAr} />
            <InfoRow
              label={isAr ? 'المسؤول المباشر' : 'Direct Supervisor'}
              value={p.supervisor ? (isRtl ? p.supervisor.name : (p.supervisor.nameEn || p.supervisor.name)) : null}
              isAr={isAr}
            />
            <InfoRow label={isAr ? 'تاريخ الالتحاق' : 'Join Date'} value={fmtDate(p.joinDate, isAr)} isAr={isAr} />
            <InfoRow label={isAr ? 'مدة الخدمة' : 'Service Duration'} value={serviceDuration(p.joinDate, isAr)} isAr={isAr} />
            <div className="flex items-center justify-between gap-3 py-2 border-b border-border/50">
              <span className="text-sm text-muted-foreground shrink-0">{isAr ? 'العقد' : 'Contract'}</span>
              <span className="text-sm font-medium text-start flex items-center gap-2 flex-wrap justify-end">
                {fmtDate(p.contractStart, isAr)} ← {fmtDate(p.contractEnd, isAr)}
                {contractExpiryBadge && <Badge className={contractExpiryBadge.cls + ' border-0'}>{contractExpiryBadge.label}</Badge>}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* رصيد الإجازات والغياب */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Plane className="h-4 w-4 text-primary" />
              {isAr ? 'رصيد الإجازات والغياب' : 'Leave Balance & Absence'}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-3 gap-2 my-2">
              <div className="rounded-xl bg-muted/60 p-3 text-center">
                <p className="text-[11px] text-muted-foreground">{isAr ? 'الرصيد الكلي' : 'Total'}</p>
                <p className="text-xl font-bold">{b ? b.annualTotal + b.carriedOver : 0}</p>
              </div>
              <div className="rounded-xl bg-muted/60 p-3 text-center">
                <p className="text-[11px] text-muted-foreground">{isAr ? 'المستخدم' : 'Used'}</p>
                <p className="text-xl font-bold">{b ? b.used : 0}</p>
              </div>
              <div className="rounded-xl bg-emerald-500/10 p-3 text-center">
                <p className="text-[11px] text-muted-foreground">{isAr ? 'المتبقي' : 'Remaining'}</p>
                <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400">{totalBalance}</p>
              </div>
            </div>
            {b && b.carriedOver > 0 && (
              <p className="text-xs text-muted-foreground mb-2">{isAr ? 'يشمل رصيداً مرحّلاً: ' : 'Includes carried-over: '}{b.carriedOver} {isAr ? 'يوم' : 'days'}</p>
            )}
            <InfoRow label={isAr ? 'أيام الغياب' : 'Absence Days'} value={String(p.absenceDays ?? 0)} isAr={isAr} />
            <InfoRow label={isAr ? 'أيام التأخير' : 'Late Days'} value={String(p.lateDays ?? 0)} isAr={isAr} />
            <p className="text-[11px] text-muted-foreground mt-2">
              {isAr ? 'الإجازات المعتمدة لا تُحتسب غياباً — الغياب والتأخير تُسجله الإدارة/الموارد البشرية' : 'Approved leaves are not counted as absence — absence/late days are recorded by HR'}
            </p>
          </CardContent>
        </Card>

        {/* الرواتب — تُعرض فقط للموظف نفسه والإدارة (الخادم لا يرسلها لغيرهم) */}
        {data.canSeeSalary && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Wallet className="h-4 w-4 text-primary" />
                {isAr ? 'الراتب (سرّي)' : 'Salary (Confidential)'}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <InfoRow label={isAr ? 'الراتب الأساسي' : 'Base Salary'} value={p.baseSalary === null || p.baseSalary === undefined ? null : p.baseSalary + ' OMR'} isAr={isAr} />
              <InfoRow label={isAr ? 'البدلات' : 'Allowances'} value={p.allowances === null || p.allowances === undefined ? null : p.allowances + ' OMR'} isAr={isAr} />
              <InfoRow
                label={isAr ? 'إجمالي الراتب' : 'Total Salary'}
                value={(p.baseSalary || 0) + (p.allowances || 0) + ' OMR'}
                isAr={isAr}
              />
            </CardContent>
          </Card>
        )}

        {/* المستندات */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <FileCheck className="h-4 w-4 text-primary" />
              {isAr ? 'المستندات' : 'Documents'}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            {[
              { icon: '🛂', label: isAr ? 'جواز السفر' : 'Passport', no: p.passportNo, exp: p.passportExpiry },
              { icon: '🪪', label: isAr ? 'البطاقة الشخصية' : 'ID Card', no: p.idNo, exp: p.idExpiry },
              { icon: '📋', label: isAr ? 'الإقامة' : 'Residence', no: p.residenceNo, exp: p.residenceExpiry },
            ].map(function(doc) {
              var badge = expiryBadge(doc.exp, isAr)
              return (
                <div key={doc.label} className="flex items-center justify-between gap-3 py-2 border-b border-border/50 last:border-0">
                  <span className="text-sm text-muted-foreground">{doc.icon} {doc.label}</span>
                  <span className="text-sm font-medium text-start flex items-center gap-2 flex-wrap justify-end">
                    <span>{doc.no || (isAr ? 'غير مسجل' : 'Not set')}</span>
                    <span className="text-xs text-muted-foreground">{doc.exp ? fmtDate(doc.exp, isAr) : ''}</span>
                    {badge && <Badge className={badge.cls + ' border-0'}>{badge.label}</Badge>}
                  </span>
                </div>
              )
            })}
          </CardContent>
        </Card>
      </div>

      {/* سجل الإجازات */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <History className="h-4 w-4 text-primary" />
            {isAr ? 'سجل الإجازات السابقة' : 'Leave History'}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {(!data.history || data.history.length === 0) ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              {isAr ? 'لا توجد إجازات مسجلة' : 'No leave records'}
            </p>
          ) : (
            <div className="space-y-2">
              {data.history.map(function(r: any) {
                var st = leaveStatus[r.status] || leaveStatus.pending
                return (
                  <div key={r.id} className="rounded-xl border p-3">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline">{(isRtl ? leaveTypeLabels[r.type]?.ar : leaveTypeLabels[r.type]?.en) || r.type}</Badge>
                        <Badge className={st.cls + ' border-0'}>{isRtl ? st.ar : st.en}</Badge>
                        <span className="text-sm font-medium">{r.days} {isAr ? 'يوم' : 'days'}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {fmtDate(r.startDate, isAr)} ← {fmtDate(r.endDate, isAr)}
                      </span>
                    </div>
                    {r.reason && <p className="text-xs text-muted-foreground mt-1.5">{isAr ? 'السبب: ' : 'Reason: '}{r.reason}</p>}
                    {r.substituteName && <p className="text-xs text-muted-foreground mt-0.5">{isAr ? 'البديل: ' : 'Substitute: '}{r.substituteName}</p>}
                    {r.reviewNote && (
                      <p className={'text-xs mt-1.5 ' + (r.status === 'rejected' ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground')}>
                        {isAr ? 'القرار: ' : 'Decision: '}{r.reviewNote}
                        {r.reviewedBy ? ' — ' + (isRtl ? r.reviewedBy.name : (r.reviewedBy.nameEn || r.reviewedBy.name)) : ''}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* تعديلات الرصيد المسجلة */}
      {data.adjustments && data.adjustments.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" />
              {isAr ? 'تعديلات الرصيد' : 'Balance Adjustments'}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-1.5">
            {data.adjustments.map(function(a: any) {
              return (
                <div key={a.id} className="flex items-center justify-between gap-2 text-sm py-1.5 border-b border-border/40 last:border-0">
                  <span className="flex items-center gap-2">
                    <span className={'font-semibold ' + (a.delta >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
                      {a.delta > 0 ? '+' : ''}{a.delta}
                    </span>
                    <span className="text-muted-foreground">{a.reason}</span>
                  </span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {a.by ? (isRtl ? a.by.name : (a.by.nameEn || a.by.name)) + ' · ' : ''}
                    {fmtDate(a.createdAt, isAr)}
                  </span>
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}

      {/* نافذة تعديل الملف — الإدارة/الموارد البشرية */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-[640px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-5 w-5 text-primary" />
              {isAr ? 'تعديل الملف الوظيفي — ' : 'Edit HR File — '}{displayName}
            </DialogTitle>
            <DialogDescription>
              {isAr ? 'بيانات الرواتب سرية ولا تظهر إلا للموظف نفسه والإدارة' : 'Salary data is confidential — visible to the employee and management only'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{isAr ? 'الرقم الوظيفي' : 'Employee No.'}</Label>
              <Input value={form.employeeNo} onChange={(e) => setForm({ ...form, employeeNo: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>{isAr ? 'المسمى الوظيفي' : 'Job Title'}</Label>
              <Input value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>{isAr ? 'القسم / المشروع' : 'Department / Project'}</Label>
              <Input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>{isAr ? 'موقع العمل الحالي' : 'Work Location'}</Label>
              <Input value={form.workLocation} onChange={(e) => setForm({ ...form, workLocation: e.target.value })} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label>{isAr ? 'المسؤول المباشر' : 'Direct Supervisor'}</Label>
              <Select value={form.supervisorId || 'none'} onValueChange={(v) => setForm({ ...form, supervisorId: v === 'none' ? '' : v })}>
                <SelectTrigger>
                  <SelectValue placeholder={isAr ? 'اختر المسؤول' : 'Select supervisor'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{isAr ? 'بدون مسؤول مباشر (تتحول الطلبات للإدارة)' : 'None (requests go to management)'}</SelectItem>
                  {(data.employees || []).filter((emp: any) => emp.id !== p.id).map((emp: any) => (
                    <SelectItem key={emp.id} value={emp.id}>
                      {isRtl ? emp.name : (emp.nameEn || emp.name)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{isAr ? 'تاريخ الالتحاق' : 'Join Date'}</Label>
              <Input type="date" value={form.joinDate} onChange={(e) => setForm({ ...form, joinDate: e.target.value })} />
            </div>
            <div className="space-y-1" />
            <div className="space-y-1">
              <Label>{isAr ? 'بداية العقد' : 'Contract Start'}</Label>
              <Input type="date" value={form.contractStart} onChange={(e) => setForm({ ...form, contractStart: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>{isAr ? 'نهاية العقد' : 'Contract End'}</Label>
              <Input type="date" value={form.contractEnd} onChange={(e) => setForm({ ...form, contractEnd: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>{isAr ? 'الراتب الأساسي (OMR)' : 'Base Salary (OMR)'}</Label>
              <Input type="number" min="0" step="0.001" value={form.baseSalary} onChange={(e) => setForm({ ...form, baseSalary: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>{isAr ? 'البدلات (OMR)' : 'Allowances (OMR)'}</Label>
              <Input type="number" min="0" step="0.001" value={form.allowances} onChange={(e) => setForm({ ...form, allowances: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>{isAr ? 'رقم جواز السفر' : 'Passport No.'}</Label>
              <Input value={form.passportNo} onChange={(e) => setForm({ ...form, passportNo: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>{isAr ? 'انتهاء الجواز' : 'Passport Expiry'}</Label>
              <Input type="date" value={form.passportExpiry} onChange={(e) => setForm({ ...form, passportExpiry: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>{isAr ? 'رقم البطاقة' : 'ID No.'}</Label>
              <Input value={form.idNo} onChange={(e) => setForm({ ...form, idNo: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>{isAr ? 'انتهاء البطاقة' : 'ID Expiry'}</Label>
              <Input type="date" value={form.idExpiry} onChange={(e) => setForm({ ...form, idExpiry: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>{isAr ? 'رقم الإقامة' : 'Residence No.'}</Label>
              <Input value={form.residenceNo} onChange={(e) => setForm({ ...form, residenceNo: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>{isAr ? 'انتهاء الإقامة' : 'Residence Expiry'}</Label>
              <Input type="date" value={form.residenceExpiry} onChange={(e) => setForm({ ...form, residenceExpiry: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>{isAr ? 'أيام الغياب' : 'Absence Days'}</Label>
              <Input type="number" min="0" step="0.5" value={form.absenceDays} onChange={(e) => setForm({ ...form, absenceDays: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>{isAr ? 'أيام التأخير' : 'Late Days'}</Label>
              <Input type="number" min="0" step="0.5" value={form.lateDays} onChange={(e) => setForm({ ...form, lateDays: e.target.value })} />
            </div>
            {/* v61: بيانات الإجازة — جزء من اكتمال بيانات الموظف، تُحفظ عبر set_balance */}
            <div className="sm:col-span-2 border-t border-border pt-3 mt-1">
              <p className="text-sm font-medium flex items-center gap-1.5">
                <Plane className="h-4 w-4 text-primary" />
                {isAr ? 'بيانات الإجازة — تُحتسب ضمن اكتمال بيانات الموظف' : 'Leave data — counts toward employee data completeness'}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {isAr ? 'اتركهما فارغين للإبقاء على الرصيد الحالي دون تغيير' : 'Leave empty to keep the current balance unchanged'}
              </p>
            </div>
            <div className="space-y-1">
              <Label>{isAr ? 'الرصيد السنوي المعتمد (يوم)' : 'Approved Annual Balance (days)'}</Label>
              <Input type="number" min="0" max="365" step="1" value={form.annualTotal} onChange={(e) => setForm({ ...form, annualTotal: e.target.value })} placeholder={isAr ? 'مثال: 30' : 'e.g. 30'} />
            </div>
            <div className="space-y-1">
              <Label>{isAr ? 'الرصيد المرحّل من العام السابق (يوم)' : 'Carried-over Balance (days)'}</Label>
              <Input type="number" min="0" max="365" step="1" value={form.carriedOver} onChange={(e) => setForm({ ...form, carriedOver: e.target.value })} placeholder="0" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>{isAr ? 'إلغاء' : 'Cancel'}</Button>
            <Button onClick={saveEdit} disabled={saving} className="gap-1.5">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {isAr ? 'حفظ' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {data.canEdit && (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5" />
          {isAr ? 'كل تعديل على الملف يُسجَّل في سجل التدقيق مع اسم المعدِّل والتاريخ' : 'Every file edit is recorded in the audit log with editor name and date'}
        </p>
      )}
    </div>
  )
}
