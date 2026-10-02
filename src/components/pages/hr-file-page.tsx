'use client'

// v62: بيانات الموظف الوظيفية ومدة الخدمة والأرصدة والمستندات وسجل الإجازات — مكوّن مدمج حصراً داخل صفحة «الملف الشخصي»
// • v62: حُذف قسما «ملفي الوظيفي» و«الإجازات» من التنقل نهائياً — الملف الشخصي هو الموطن الوحيد لبيانات الموظف ورصيد إجازاته
// • الموظف يرى ملفه فقط — الإدارة ومدير النظام يرون هنا قائمة «تعبئة بيانات المستخدمين» ويمكنهم إدخال وتعديل بيانات كل مستخدم
// • الرواتب سرية: تظهر للموظف نفسه والإدارة فقط (الخادم لا يرسلها لغيرهم أصلاً)
// • تنبيهات انتهاء الجواز والبطاقة والإقامة والعقد (أحمر ≤30 يوماً، كهرماني ≤60)
// • v68: استعادة دورة طلبات الإجازة التي فُقدت في إعادة هيكلة v62 (حُذفت مساراتها
//   الخادمية بالخطأ) — تقديم طلب بحساب أيام العمل تلقائياً، إلغاء المعلق،
//   وطلبات الفريق بانتظار الموافقة للمسؤول المباشر والإدارة (اعتماد/رفض بسبب)

import { useEffect, useState, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Briefcase, Wallet, FileCheck, Pencil, Loader2, Clock, Plane, History, AlertTriangle,
  Search, Users, UserX, CheckCircle2, Plus, CalendarDays, Ban, XCircle, Eye
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

export default function HRFilePage() {
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
  // v68: هوية المستخدم الحالي — قسم «طلبات الإجازة» يظهر للملف الذاتي فقط
  // (عندما تعرض الإدارة ملف موظف آخر من قائمة التعبئة يختفي القسم)
  const meId = useAppStore((s) => s.user?.id || '')

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

  // v64 إصلاح حرج: كان الشرط «if (!token) return» يوقف التحميل للأبد —
  // منذ v14 لا يُخزن أي توكن في المتجر (المصادقة كوكي httpOnly فقط) فتبقى
  // s.token دائماً null، وبالتالي لم يُستدعَ load() قط فظهرت دائرة التحميل
  // الدوّارة بلا بيانات في «بياناتي الوظيفية والإجازات». authedFetch يرسل
  // الكوكي تلقائياً — لا حاجة لأي شرط توكن هنا (نمط بقية الصفحات).
  useEffect(() => {
    load(targetId || undefined)
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

      {/* v62: أُزيلت ترويسة الصفحة المستقلة ومحدد الموظف مع حذف قسم «ملفي الوظيفي» — الترويسة تعرضها صفحة الملف الشخصي نفسها */}

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

      {/* v68: طلبات الإجازة — تقديم طلب جديد + طلباتي + طلبات الفريق بانتظار الموافقة (الملف الذاتي فقط) */}
      {(!targetId || targetId === meId) && <LeaveFlowSection isAr={isAr} isRtl={isRtl} />}

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

// ══════════ v68: طلبات الإجازة — تقديم ومتابعة واعتماد ══════════
// استُعيدت الوظيفة بعد فقدانها في إعادة هيكلة v62 (حُذفت مسارات الخادم بالخطأ
// وبقيت الصفحة القديمة يتيمة بلا استدعاء). الواجهة هنا مدمجة داخل «بياناتي
// الوظيفية والإجازات» والخادم في /api/hr/leave + /api/hr/leave/[id]:
// • طلب جديد: نوع + فترة (أيام العمل تُحتسب تلقائياً بعد استبعاد نهاية الأسبوع
//   والعطلات الرسمية) + سبب اختياري + موظف بديل + مرفق (إلزامي للمرضية وفق السياسة)
// • طلباتي: المعلق قابل للإلغاء + عرض المرفق — والقرارات في السجل أعلاه
// • للمسؤول المباشر والإدارة: طلبات الفريق بانتظار الموافقة — الاعتماد يخصم
//   أيام السنوية تلقائياً من رصيد الموظف، والرفض يتطلب سبباً يُبلَّغ به الموظف

// مفتاح اليوم: عدد الأيام منذ البداية (نفس منطق hr.ts على الخادم)
function dayKeyOfLeave(s: string): number {
  var d = new Date(s + 'T00:00:00.000Z')
  return Math.floor(d.getTime() / 86400000)
}

// معاينة أيام العمل في العميل — نفس منطق countWorkingDays على الخادم
// (استبعاد أيام نهاية الأسبوع من السياسة والعطلات الرسمية المعتمدة)
function countWorkingDaysLeave(start: string, end: string, weekend: Set<number>, holidayKeys: Set<number>): number {
  if (!start || !end) return 0
  var sK = dayKeyOfLeave(start), eK = dayKeyOfLeave(end)
  if (eK < sK) return 0
  var count = 0
  var guard = 0
  for (var k = sK; k <= eK && guard < 800; k++, guard++) {
    var d = new Date(k * 86400000)
    if (!weekend.has(d.getUTCDay()) && !holidayKeys.has(k)) count++
  }
  return count
}

// ضغط صورة المرفق في المتصفح قبل الإرسال (نفس نمط صور الفواتير)
function compressImageLeave(file: File, maxSide: number, quality: number, cb: (dataUrl: string) => void, onErr: () => void) {
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

function LeaveFlowSection({ isAr, isRtl }: { isAr: boolean; isRtl: boolean }) {
  var [leaveData, setLeaveData] = useState<any | null>(null)
  var [loading, setLoading] = useState(true)
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

  var weekendSet = new Set<number>()
  if (leaveData?.policy?.weekendDays) {
    String(leaveData.policy.weekendDays).split(',').forEach(function(s) {
      var n = parseInt(s.trim(), 10)
      if (!isNaN(n)) weekendSet.add(n)
    })
  }
  var holidayKeys = new Set<number>()
  if (leaveData?.holidays) {
    for (var h of leaveData.holidays) {
      if (h && h.date) holidayKeys.add(dayKeyOfLeave(String(h.date).slice(0, 10)))
    }
  }

  async function loadLeave() {
    setLoading(true)
    try {
      var r = await authedFetch('/api/hr/leave')
      var ct = r.headers.get('content-type') || ''
      if (ct.indexOf('application/json') === -1) {
        var unexpected = isAr
          ? ('رد غير متوقع من الخادم (رمز ' + r.status + ')')
          : ('Unexpected server response (HTTP ' + r.status + ')')
        setLoadError(unexpected)
        setLeaveData(null)
        setLoading(false)
        return
      }
      var d = await r.json()
      if (r.ok) { setLeaveData(d); setLoadError(null) }
      else {
        var msg = d.message || (isAr ? 'فشل جلب طلبات الإجازة' : 'Failed to load leave requests')
        setLoadError(msg)
        setLeaveData(null)
      }
    } catch {
      setLoadError(isAr ? 'تعذر الاتصال بالخادم' : 'Cannot reach the server')
      setLeaveData(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(function() {
    loadLeave()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  var myRemaining = leaveData?.balance ? (leaveData.balance.annualTotal + leaveData.balance.carriedOver - leaveData.balance.used) : 0
  // بوابة الموافقات: الإدارة/الموارد البشرية أو من لديه مرؤوسون (مسؤول مباشر)
  var canApprove = !!(leaveData && (leaveData.isHR || leaveData.teamCount > 0))
  var teamPending = (leaveData?.teamRequests || []).filter(function(r: any) { return r.status === 'pending' })
  var teamDecided = (leaveData?.teamRequests || []).filter(function(r: any) { return r.status !== 'pending' })
  var myPending = (leaveData?.requests || []).filter(function(r: any) { return r.status === 'pending' })
  var myDecided = (leaveData?.requests || []).filter(function(r: any) { return r.status !== 'pending' }).slice(0, 5)

  var previewDays = countWorkingDaysLeave(newForm.startDate, newForm.endDate, weekendSet, holidayKeys)
  var sickNeedsAttach = !!(leaveData?.policy?.sickAttachRequired && newForm.type === 'sick')

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
    compressImageLeave(file, 1600, 0.75, function(dataUrl) {
      setNewForm(function(f) { return { ...f, attachmentName: file.name, attachmentData: dataUrl } })
    }, function() {
      toast.error(isAr ? 'فشل قراءة الصورة' : 'Failed to read image')
    })
    if (attachInputRef.current) attachInputRef.current.value = ''
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
      loadLeave()
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
      loadLeave()
    } catch {
      toast.error(isAr ? 'خطأ في الاتصال' : 'Connection error')
    } finally {
      setDecisionLoading(false)
    }
  }

  function cancelMine(id: string) {
    if (!window.confirm(isAr ? 'إلغاء هذا الطلب المعلق؟' : 'Cancel this pending request?')) return
    decide(id, 'cancel')
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-6 flex items-center justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </CardContent>
      </Card>
    )
  }
  if (!leaveData) {
    // فشل تحميل القسم لا يعطل بقية الصفحة — رسالة مختصرة مع إعادة المحاولة
    return (
      <Card>
        <CardContent className="py-5 flex flex-col items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-500" />
          <p className="text-sm text-muted-foreground">{loadError || (isAr ? 'تعذر تحميل طلبات الإجازة' : 'Failed to load leave requests')}</p>
          <Button size="sm" variant="outline" onClick={loadLeave}>
            <Loader2 className="h-4 w-4" />
            {isAr ? 'إعادة المحاولة' : 'Retry'}
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {/* طلبات الفريق بانتظار الموافقة — للمسؤول المباشر والإدارة */}
      {canApprove && teamPending.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              {isAr ? 'طلبات إجازة بانتظار موافقتك' : 'Leave Requests Awaiting Your Approval'}
              <Badge variant="destructive">{teamPending.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-2">
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
                      onClick={function() { decide(r.id, 'approve') }}>
                      <CheckCircle2 className="h-4 w-4" />
                      {isAr ? 'موافقة' : 'Approve'}
                    </Button>
                    <Button size="sm" variant="outline" className="gap-1.5 text-destructive hover:text-destructive border-destructive/40" disabled={decisionLoading}
                      onClick={function() { setRejectId(r.id); setRejectNote('') }}>
                      <XCircle className="h-4 w-4" />
                      {isAr ? 'رفض' : 'Reject'}
                    </Button>
                    {r.attachmentData && (
                      <Button size="sm" variant="ghost" className="gap-1.5"
                        onClick={function() { setViewAtt({ name: r.attachmentName || 'مستند', data: r.attachmentData }) }}>
                        <FileCheck className="h-4 w-4" />
                        {isAr ? 'عرض المستند' : 'View document'}
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}

      {/* طلباتي + طلب جديد */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center justify-between flex-wrap gap-2">
            <span className="flex items-center gap-2">
              <Plane className="h-4 w-4 text-primary" />
              {isAr ? 'طلبات الإجازة' : 'Leave Requests'}
              {myPending.length > 0 && <Badge variant="secondary" className="text-xs">{myPending.length}</Badge>}
            </span>
            <Button size="sm" className="gap-1.5" onClick={function() { resetNewForm(); setNewOpen(true) }}>
              <Plus className="h-4 w-4" />
              {isAr ? 'طلب إجازة جديدة' : 'New Leave Request'}
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-2">
          <div className="flex items-center gap-2 flex-wrap pb-1">
            <Badge variant="secondary" className="gap-1"><CalendarDays className="h-3.5 w-3.5" /> {isAr ? 'الرصيد الكلي' : 'Total'}: {leaveData.balance ? leaveData.balance.annualTotal + leaveData.balance.carriedOver : 0}</Badge>
            <Badge variant="outline" className="gap-1"><Clock className="h-3.5 w-3.5" /> {isAr ? 'المستخدم' : 'Used'}: {leaveData.balance?.used ?? 0}</Badge>
            <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-0 gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" /> {isAr ? 'المتبقي' : 'Remaining'}: {myRemaining}
            </Badge>
          </div>
          {myPending.length === 0 && myDecided.length === 0 ? (
            <p className="text-sm text-muted-foreground py-3 text-center">
              {isAr ? 'لا توجد طلبات إجازة — قدّم طلبك الأول' : 'No leave requests — submit your first request'}
            </p>
          ) : (
            <>
              {myPending.map(function(r: any) {
                return (
                  <div key={r.id} className="rounded-xl border p-3">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline">{(isRtl ? leaveTypeLabels[r.type]?.ar : leaveTypeLabels[r.type]?.en) || r.type}</Badge>
                        <Badge className={(leaveStatus[r.status] || leaveStatus.pending).cls + ' border-0'}>{isRtl ? (leaveStatus[r.status] || leaveStatus.pending).ar : (leaveStatus[r.status] || leaveStatus.pending).en}</Badge>
                        <span className="text-sm font-medium">{r.days} {isAr ? 'يوم عمل' : 'working days'}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        {r.attachmentData && (
                          <Button variant="ghost" size="icon" className="h-8 w-8" title={isAr ? 'عرض المرفق' : 'View attachment'}
                            onClick={function() { setViewAtt({ name: r.attachmentName || 'مستند', data: r.attachmentData }) }}>
                            <Eye className="h-4 w-4" />
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" className="h-8 gap-1 text-destructive hover:text-destructive" disabled={decisionLoading}
                          onClick={function() { cancelMine(r.id) }}>
                          <Ban className="h-3.5 w-3.5" />
                          {isAr ? 'إلغاء' : 'Cancel'}
                        </Button>
                      </div>
                    </div>
                    <p className="text-sm mt-1.5">
                      {fmtDate(r.startDate, isAr)} ← {fmtDate(r.endDate, isAr)}
                      {r.substituteName && <span className="text-muted-foreground"> · {isAr ? 'البديل: ' : 'Sub: '}{r.substituteName}</span>}
                    </p>
                    {r.reason && <p className="text-xs text-muted-foreground mt-0.5">{r.reason}</p>}
                  </div>
                )
              })}
              {myDecided.length > 0 && (
                <div className="pt-1">
                  <p className="text-xs font-semibold text-muted-foreground mb-1">{isAr ? 'آخر القرارات على طلباتك' : 'Recent decisions'}</p>
                  {myDecided.map(function(r: any) {
                    var st = leaveStatus[r.status] || leaveStatus.pending
                    return (
                      <div key={r.id} className="flex items-center justify-between gap-2 text-sm py-1.5 border-b border-border/40 last:border-0 flex-wrap">
                        <span className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className="text-xs">{(isRtl ? leaveTypeLabels[r.type]?.ar : leaveTypeLabels[r.type]?.en) || r.type}</Badge>
                          <Badge className={st.cls + ' border-0 text-xs'}>{isRtl ? st.ar : st.en}</Badge>
                          <span className="text-xs text-muted-foreground">{r.days} {isAr ? 'يوم' : 'd'}</span>
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {fmtDate(r.startDate, isAr)} ← {fmtDate(r.endDate, isAr)}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* طلبات الفريق تم البت فيها — ملخص مختصر */}
      {canApprove && teamDecided.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" />
              {isAr ? 'طلبات الفريق — تم البت فيها' : 'Team Requests — Decided'}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-1">
            {teamDecided.slice(0, 10).map(function(r: any) {
              var st = leaveStatus[r.status] || leaveStatus.pending
              var empName = r.employee ? (isRtl ? r.employee.name : (r.employee.nameEn || r.employee.name)) : '—'
              return (
                <div key={r.id} className="flex items-center justify-between gap-2 text-sm py-1.5 border-b border-border/40 last:border-0 flex-wrap">
                  <span className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{empName}</span>
                    <Badge variant="outline" className="text-xs">{(isRtl ? leaveTypeLabels[r.type]?.ar : leaveTypeLabels[r.type]?.en) || r.type}</Badge>
                    <Badge className={st.cls + ' border-0 text-xs'}>{isRtl ? st.ar : st.en}</Badge>
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

      {/* نافذة طلب إجازة جديد */}
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
              <Select value={newForm.type} onValueChange={function(v) { setNewForm({ ...newForm, type: v }) }}>
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
                <Input type="date" value={newForm.startDate} onChange={function(e) { setNewForm({ ...newForm, startDate: e.target.value }) }} />
              </div>
              <div className="space-y-1">
                <Label>{isAr ? 'إلى تاريخ' : 'To'}</Label>
                <Input type="date" value={newForm.endDate} onChange={function(e) { setNewForm({ ...newForm, endDate: e.target.value }) }} />
              </div>
            </div>
            {newForm.startDate && newForm.endDate && (
              <div className="flex items-center gap-2 text-sm flex-wrap">
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
              <Textarea rows={2} value={newForm.reason} onChange={function(e) { setNewForm({ ...newForm, reason: e.target.value }) }} />
            </div>
            <div className="space-y-1">
              <Label>{isAr ? 'الموظف البديل (عند الحاجة)' : 'Substitute Employee (if needed)'}</Label>
              <Input value={newForm.substituteName} onChange={function(e) { setNewForm({ ...newForm, substituteName: e.target.value }) }} />
            </div>
            <div className="space-y-1">
              <Label>
                {isAr ? 'المستند المرفق' : 'Attachment'}
                {sickNeedsAttach && <span className="text-destructive"> ({isAr ? 'إلزامي للمرضية' : 'required for sick leave'})</span>}
              </Label>
              <input ref={attachInputRef} type="file" accept="image/*,.pdf" className="hidden" onChange={onPickAttachment} />
              <Button variant="outline" size="sm" className="gap-1.5 w-full" onClick={function() { if (attachInputRef.current) attachInputRef.current.click() }}>
                <FileCheck className="h-4 w-4" />
                {newForm.attachmentName ? newForm.attachmentName : (isAr ? 'اختر صورة أو PDF' : 'Pick image or PDF')}
              </Button>
              {newForm.attachmentData && (
                <Button variant="ghost" size="sm" className="text-destructive h-7" onClick={function() { setNewForm({ ...newForm, attachmentName: '', attachmentData: '' }) }}>
                  {isAr ? 'إزالة المرفق' : 'Remove attachment'}
                </Button>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={function() { setNewOpen(false) }}>{isAr ? 'إلغاء' : 'Cancel'}</Button>
            <Button onClick={submitNew} disabled={newSaving} className="gap-1.5">
              {newSaving && <Loader2 className="h-4 w-4 animate-spin" />}
              {isAr ? 'إرسال الطلب' : 'Submit Request'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* نافذة رفض طلب — السبب إلزامي */}
      <Dialog open={!!rejectId} onOpenChange={function(v) { if (!v) { setRejectId(null); setRejectNote('') } }}>
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
          <Textarea rows={3} value={rejectNote} onChange={function(e) { setRejectNote(e.target.value) }} placeholder={isAr ? 'مثال: يرجى تعديل التواريخ لتغطية فترة التشغيل' : 'e.g. please adjust dates to cover the operation period'} />
          <DialogFooter>
            <Button variant="outline" onClick={function() { setRejectId(null); setRejectNote('') }}>{isAr ? 'تراجع' : 'Back'}</Button>
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

      {/* نافذة عرض مرفق */}
      <Dialog open={!!viewAtt} onOpenChange={function(v) { if (!v) setViewAtt(null) }}>
        <DialogContent className="sm:max-w-[640px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileCheck className="h-5 w-5 text-primary" />
              {viewAtt?.name}
            </DialogTitle>
          </DialogHeader>
          {viewAtt && viewAtt.data.startsWith('data:image/') ? (
            // eslint-disable-next-line @next/next/no-img-element
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
