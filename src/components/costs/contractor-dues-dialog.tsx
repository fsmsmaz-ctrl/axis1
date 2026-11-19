'use client'

// ============================================================
// v123 — نافذة مستحقات مقاولي الحفر النفقي (قسم التكاليف)
// AXIS Pipe Jacking Management System
// ============================================================
// تبديل كامل لآلية «فاتورة لكل 10 أمتار» القديمة. تعرض:
//   تبويب المستحقات: كل خط حفر مع — المقاول والسعر، الحفر الفعلي،
//     الأنابيب المدفوعة (للمراجعة الفنية فقط)، المستحق التراكمي،
//     المعتمد سابقاً، المدفوع، الرصيد، وحالة الخط، مع أزرار حسب الدور.
//   تبويب الفواتير: كل الفواتير مع التصفية (مشروع/مقاول/حالة) وسلسلة
//     الاعتماد الثلاثية وأزرار القرارات والدفعات حسب الدور.
// الصلاحيات تأتي من الخادم (viewer) — الخادم هو المصدر.
// كل المبالغ بالريال العماني بثلاث خانات عشرية.
// ============================================================

import { useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle
} from '@/components/ui/dialog'
import { Coins, FileText, History, Search, Coins as CoinsIcon } from 'lucide-react'
import { authedFetch } from '@/lib/api-client'
import { toast } from 'sonner'

var MONEY_LABEL = ' ر.ع'

function fmtMoney(n: number): string {
  return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
}
function fmtM(n: number): string {
  return (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })
}

var LINE_STATUS_LABELS: Record<string, { ar: string; color: string }> = {
  not_started: { ar: 'لم يبدأ العمل', color: '#64748b' },
  in_progress: { ar: 'جارٍ التنفيذ', color: '#0ea5e9' },
  completed: { ar: 'اكتمل الحفر', color: '#8b5cf6' },
  suspended: { ar: 'متوقف', color: '#f59e0b' },
  pending_verification: { ar: 'بانتظار مراجعة المهندس', color: '#f97316' },
  verified: { ar: 'الأطوال معتمدة فنياً', color: '#10b981' },
}

var INVOICE_STATUS_LABELS: Record<string, { ar: string; color: string }> = {
  draft: { ar: 'مسودة', color: '#64748b' },
  pending_financial: { ar: 'بانتظار الاعتماد المالي', color: '#f59e0b' },
  pending_final: { ar: 'بانتظار الاعتماد النهائي', color: '#8b5cf6' },
  approved: { ar: 'معتمدة نهائياً', color: '#10b981' },
  partially_paid: { ar: 'مدفوعة جزئياً', color: '#0ea5e9' },
  paid: { ar: 'مدفوعة بالكامل', color: '#059669' },
  returned: { ar: 'معادة للتعديل', color: '#f97316' },
  rejected: { ar: 'مرفوضة', color: '#ef4444' },
}

function statusBadge(labels: Record<string, { ar: string; color: string }>, status: string, isRtl: boolean) {
  var meta = labels[status] || { ar: status, color: '#64748b' }
  return (
    <Badge variant="outline" className="text-[11px] whitespace-nowrap" style={{ backgroundColor: meta.color + '14', color: meta.color, borderColor: meta.color + '40' }}>
      {isRtl ? meta.ar : status}
    </Badge>
  )
}

export default function ContractorDuesDialog(props: { open: boolean; onOpenChange: (open: boolean) => void; projects: any[]; isRtl: boolean }) {
  var isRtl = props.isRtl
  var [data, setData] = useState<any>(null)
  var [loading, setLoading] = useState(false)
  var [tab, setTab] = useState<'dues' | 'invoices'>('dues')
  var [error, setError] = useState('')

  // التصفية
  var [fProject, setFProject] = useState('all')
  var [fContractor, setFContractor] = useState('')
  var [fLineStatus, setFLineStatus] = useState('all')
  var [fInvoiceStatus, setFInvoiceStatus] = useState('all')
  var [fSearch, setFSearch] = useState('')

  // حالات النوافذ والأزرار
  var [busyId, setBusyId] = useState<string | null>(null)
  var [agreeOpen, setAgreeOpen] = useState(false)
  var [agreeLine, setAgreeLine] = useState<any>(null)
  var [agreeName, setAgreeName] = useState('')
  var [agreePrice, setAgreePrice] = useState('')
  var [agreeDate, setAgreeDate] = useState('')
  var [agreeReason, setAgreeReason] = useState('')
  var [reviewOpen, setReviewOpen] = useState(false)
  var [reviewLine, setReviewLine] = useState<any>(null)
  var [reviewDecision, setReviewDecision] = useState('approve')
  var [reviewNote, setReviewNote] = useState('')
  var [invOpen, setInvOpen] = useState(false)
  var [inv, setInv] = useState<any>(null)
  var [decNote, setDecNote] = useState('')
  var [payAmount, setPayAmount] = useState('')
  var [payDate, setPayDate] = useState('')
  var [payNote, setPayNote] = useState('')
  var [settleOpen, setSettleOpen] = useState(false)
  var [settleLine, setSettleLine] = useState<any>(null)
  var [settleLength, setSettleLength] = useState('')
  var [settleReason, setSettleReason] = useState('')
  var [extOpen, setExtOpen] = useState(false)
  var [extLine, setExtLine] = useState<any>(null)
  var [extLength, setExtLength] = useState('')
  var [extReason, setExtReason] = useState('')
  var [migBusy, setMigBusy] = useState(false)
  var [migReport, setMigReport] = useState<any>(null)

  async function fetchData() {
    setLoading(true)
    setError('')
    try {
      var res = await authedFetch('/api/contractor-dues')
      if (!res.ok) {
        var errData = await res.json().catch(function() { return null })
        setError((errData && (errData.message || errData.details)) || ('HTTP ' + res.status))
        setData(null)
      } else {
        setData(await res.json())
      }
    } catch (e: any) {
      setError(String(e))
      setData(null)
    }
    setLoading(false)
  }

  useEffect(function() {
    if (props.open) fetchData()
  }, [props.open])

  var lines = useMemo(function() { return (data && data.lines) || [] }, [data])
  var invoices = useMemo(function() { return (data && data.invoices) || [] }, [data])
  var viewer = (data && data.viewer) || {}

  var filteredLines = useMemo(function() {
    return lines.filter(function(l: any) {
      var okP = fProject === 'all' || l.projectId === fProject
      var okC = !fContractor || (l.contractorName || '').toLowerCase().indexOf(fContractor.toLowerCase()) !== -1
      var okS = fLineStatus === 'all' || l.status === fLineStatus
      var okQ = !fSearch || (l.lineNumber || '').toLowerCase().indexOf(fSearch.toLowerCase()) !== -1
      return okP && okC && okS && okQ
    })
  }, [lines, fProject, fContractor, fLineStatus, fSearch])

  var filteredInvoices = useMemo(function() {
    // خريطة مشروع لكل خط — بدل استدعاء دالة خارج useMemo (نظافة hooks)
    var projectByLine: Record<string, string> = {}
    for (var l of lines) projectByLine[l.driveLineId] = l.projectId
    return invoices.filter(function(inv: any) {
      var okP = fProject === 'all' || projectByLine[inv.driveLineId] === fProject
      var okC = !fContractor || (inv.contractorName || '').toLowerCase().indexOf(fContractor.toLowerCase()) !== -1
      var okS = fInvoiceStatus === 'all' || inv.status === fInvoiceStatus
      var okQ = !fSearch || (inv.invoiceNo || '').toLowerCase().indexOf(fSearch.toLowerCase()) !== -1 || (inv.lineNumber || '').toLowerCase().indexOf(fSearch.toLowerCase()) !== -1
      return okP && okC && okS && okQ
    })
  }, [invoices, lines, fProject, fContractor, fInvoiceStatus, fSearch])

  function openAgreement(line: any) {
    setAgreeLine(line)
    setAgreeName(line.contractorName || '')
    setAgreePrice(line.pricePerMeter != null ? String(line.pricePerMeter) : '')
    setAgreeDate(line.plannedStartDate ? String(line.plannedStartDate).slice(0, 10) : '')
    setAgreeReason('')
    setAgreeOpen(true)
  }

  async function post(url: string, body: any, busyKey: string): Promise<any> {
    setBusyId(busyKey)
    try {
      var res = await authedFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      var d: any = null
      try { d = await res.json() } catch { d = null }
      if (!res.ok) {
        toast.error((d && d.message) || (isRtl ? 'فشل الإجراء' : 'Action failed'))
        return null
      }
      return d
    } catch {
      toast.error(isRtl ? 'فشل الاتصال' : 'Network error')
      return null
    } finally {
      setBusyId(null)
    }
  }

  async function saveAgreement() {
    if (!agreeLine) return
    if (!agreeName.trim()) {
      toast.error(isRtl ? 'اسم المقاول إجباري' : 'Contractor name is required')
      return
    }
    if (String(agreePrice).trim() === '' || !(Number(agreePrice) > 0)) {
      toast.error(isRtl ? 'سعر المتر إجباري ويجب أن يكون رقماً موجباً' : 'Price per meter is required')
      return
    }
    var lineStarted = agreeLine.status !== 'not_started'
    var priceChanged = Number(agreePrice) !== Number(agreeLine.pricePerMeter || 0)
    if (lineStarted && priceChanged && Number(agreeLine.pricePerMeter || 0) > 0 && !viewer.canFinanceReview && agreeReason.trim().length < 3) {
      toast.error(isRtl ? 'تغيير السعر بعد بدء العمل يحتاج الاعتماد المالي مع السبب' : 'Price change after start needs financial approval + reason')
      return
    }
    var d = await post('/api/contractor-dues', {
      action: 'set_agreement',
      driveLineId: agreeLine.driveLineId,
      contractorName: agreeName.trim(),
      pricePerMeter: Number(agreePrice),
      plannedStartDate: agreeDate.trim() || undefined,
      changeReason: agreeReason.trim() || undefined,
    }, 'agree:' + agreeLine.driveLineId)
    if (d) {
      toast.success(d.message || (isRtl ? 'تم' : 'Done'))
      setAgreeOpen(false)
      fetchData()
    }
  }

  async function requestVerification(line: any) {
    if (!window.confirm(isRtl ? 'إرسال الخط ' + line.lineNumber + ' لمراجعة المهندس؟ سيصل إشعار فوري لأصحاب صلاحية المراجعة الفنية بأطوال الحفر والمستحقات.' : 'Send line for engineer verification?')) return
    var d = await post('/api/contractor-dues', { action: 'request_verification', driveLineId: line.driveLineId }, 'verify:' + line.driveLineId)
    if (d) {
      toast.success(d.message || (isRtl ? 'أُرسل للمراجعة' : 'Sent'))
      fetchData()
    }
  }

  async function submitReview() {
    if (!reviewLine) return
    if (reviewDecision !== 'approve' && reviewNote.trim().length < 3) {
      toast.error(isRtl ? 'ملاحظات التعديل أو سبب الرفض إجبارية' : 'Note is required')
      return
    }
    var d = await post('/api/contractor-dues/review', { driveLineId: reviewLine.driveLineId, decision: reviewDecision, note: reviewNote.trim() }, 'review:' + reviewLine.driveLineId)
    if (d) {
      toast.success(d.message || (isRtl ? 'تم' : 'Done'))
      setReviewOpen(false)
      setReviewNote('')
      fetchData()
    }
  }

  async function submitDecision(stage: string, decision: string) {
    if (!inv) return
    if (decision !== 'approve' && decision !== 'resubmit' && decNote.trim().length < 3) {
      toast.error(isRtl ? 'السبب/الملاحظة إجبارية (3 أحرف على الأقل)' : 'Reason is required')
      return
    }
    if (!window.confirm(isRtl ? 'تأكيد القرار (' + decision + ') على الفاتورة ' + inv.invoiceNo + '؟ سيُسجل باسمك ووقته في سجل التدقيق وسيصل إشعار للمختصين.' : 'Confirm decision?')) return
    var d = await post('/api/contractor-dues/invoices/' + inv.id + '/decision', { stage: stage, decision: decision, note: decNote.trim() || undefined }, 'dec:' + inv.id + ':' + stage)
    if (d) {
      toast.success(d.message || (isRtl ? 'تم' : 'Done'))
      setDecNote('')
      setInvOpen(false)
      fetchData()
    }
  }

  async function addPayment() {
    if (!inv) return
    var amt = Number(payAmount)
    if (!isFinite(amt) || amt <= 0) {
      toast.error(isRtl ? 'مبلغ الدفعة يجب أن يكون رقماً موجباً' : 'Payment must be positive')
      return
    }
    var d = await post('/api/contractor-dues/invoices/' + inv.id + '/payments', { amount: amt, paidAt: payDate.trim() || undefined, note: payNote.trim() || undefined }, 'pay:' + inv.id)
    if (d) {
      toast.success(d.message || (isRtl ? 'سُجلت الدفعة' : 'Recorded'))
      setPayAmount('')
      setPayNote('')
      setInv(null)
      setInvOpen(false)
      fetchData()
    }
  }

  async function requestExtension(line: any) {
    if (!extLine) return
    var len = Number(extLength)
    if (!isFinite(len) || len <= Number(line.approvedPlannedLength || 0)) {
      toast.error(isRtl ? 'الطول الجديد يجب أن يتجاوز الحد الحالي (' + line.approvedPlannedLength + ' م)' : 'New length must exceed current cap')
      return
    }
    if (extReason.trim().length < 3) {
      toast.error(isRtl ? 'سبب التعديل إجباري' : 'Reason is required')
      return
    }
    var d = await post('/api/contractor-dues', { action: 'planned_length_change', driveLineId: line.driveLineId, newLength: len, reason: extReason.trim() }, 'ext:' + line.driveLineId)
    if (d) {
      toast.success(d.message || (isRtl ? 'تم' : 'Done'))
      setExtOpen(false)
      fetchData()
    }
  }

  async function runMigration() {
    if (!window.confirm(isRtl ? 'تشغيل ترحيل الفواتير القديمة (v123)؟ يراجع الفواتير المعتمدة القديمة، يكشف التكرار، ويثبت الأطوال المسواة على كل خط — بلا أي حذف وبلا أي اعتماد آلي. قابل للتكرار بأمان.' : 'Run v123 migration?')) return
    setMigBusy(true)
    try {
      var res = await authedFetch('/api/admin/contractor-migration-v123', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      var d = await res.json().catch(function() { return null })
      if (!res.ok) {
        toast.error((d && d.message) || (isRtl ? 'فشل الترحيل' : 'Migration failed'))
      } else {
        toast.success(d.message || (isRtl ? 'اكتمل' : 'Done'))
        setMigReport(d.report || null)
        fetchData()
      }
    } catch {
      toast.error(isRtl ? 'فشل الاتصال' : 'Network error')
    }
    setMigBusy(false)
  }

  var invoicesPaid = function(inv: any): number {
    var s = 0
    for (var p of (inv.payments || [])) s += Number(p.amount) || 0
    return s
  }

  return (
    <>
      <Dialog open={props.open} onOpenChange={props.onOpenChange}>
        {/* v124: حارس ارتفاع — على شاشات الهاتف القصيرة/العرضي كان محتوى النافذة
            يتجاوز ارتفاع الشاشة فتُقتطع أعلى وأسفل ويصعب الوصول لزر الإغلاق */}
        <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Coins className="h-5 w-5 text-sky-600" />
              {isRtl ? 'مستحقات مقاولي الحفر النفقي' : 'Contractor dues'}
            </DialogTitle>
            <DialogDescription>
              {isRtl
                ? 'الاحتساب تلقائي من أطوال الحفر المنفذة فعلياً في التقارير اليومية المعتمدة — لا فواتير متكررة، وطول الأنابيب المدفوعة يظهر للمراجعة الفنية فقط. فاتورة واحدة لكل خط بعد اعتماد المهندس، ثم الاعتماد المالي فالاعتماد النهائي.'
                : 'Dues accrue automatically from actual excavated lengths in approved daily reports.'}
            </DialogDescription>
          </DialogHeader>

          {/* التصفية */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
            <div className="relative">
              <Search className="absolute right-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pr-8" placeholder={isRtl ? 'بحث: خط / رقم فاتورة / مقاول' : 'Search'} value={fSearch} onChange={function(e) { setFSearch(e.target.value) }} />
            </div>
            <Select value={fProject} onValueChange={setFProject}>
              <SelectTrigger><SelectValue placeholder={isRtl ? 'المشروع' : 'Project'} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{isRtl ? 'كل المشاريع' : 'All projects'}</SelectItem>
                {(props.projects || []).map(function(p: any) {
                  return <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                })}
              </SelectContent>
            </Select>
            <Input placeholder={isRtl ? 'اسم المقاول' : 'Contractor'} value={fContractor} onChange={function(e) { setFContractor(e.target.value) }} />
            <Select value={fLineStatus} onValueChange={setFLineStatus}>
              <SelectTrigger><SelectValue placeholder={isRtl ? 'حالة الخط' : 'Line status'} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{isRtl ? 'كل حالات الخط' : 'All line statuses'}</SelectItem>
                {Object.keys(LINE_STATUS_LABELS).map(function(k) {
                  return <SelectItem key={k} value={k}>{isRtl ? LINE_STATUS_LABELS[k].ar : k}</SelectItem>
                })}
              </SelectContent>
            </Select>
            <Select value={fInvoiceStatus} onValueChange={setFInvoiceStatus}>
              <SelectTrigger><SelectValue placeholder={isRtl ? 'حالة الفاتورة' : 'Invoice status'} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{isRtl ? 'كل حالات الفاتورة' : 'All invoice statuses'}</SelectItem>
                {Object.keys(INVOICE_STATUS_LABELS).map(function(k) {
                  return <SelectItem key={k} value={k}>{isRtl ? INVOICE_STATUS_LABELS[k].ar : k}</SelectItem>
                })}
              </SelectContent>
            </Select>
          </div>

          {/* التبويبات */}
          <div className="flex gap-2">
            <Button size="sm" variant={tab === 'dues' ? 'default' : 'outline'} onClick={function() { setTab('dues') }}>
              <CoinsIcon className="h-4 w-4 ml-1" />
              {isRtl ? 'المستحقات حسب الخط (' + filteredLines.length + ')' : 'Dues by line'}
            </Button>
            <Button size="sm" variant={tab === 'invoices' ? 'default' : 'outline'} onClick={function() { setTab('invoices') }}>
              <FileText className="h-4 w-4 ml-1" />
              {isRtl ? 'فواتير المقاولين (' + filteredInvoices.length + ')' : 'Invoices'}
            </Button>
            {viewer.isAdmin && (
              <Button size="sm" variant="outline" disabled={migBusy} onClick={runMigration} className="mr-auto border-amber-600/40 text-amber-700 dark:text-amber-400">
                <History className="h-4 w-4 ml-1" />
                {migBusy ? (isRtl ? 'جارٍ الترحيل...' : 'Migrating...') : (isRtl ? 'ترحيل الفواتير القديمة' : 'Migrate old invoices')}
              </Button>
            )}
          </div>

          <div className="max-h-[52vh] overflow-y-auto rounded-xl border">
            {loading ? (
              <div className="p-10 text-center text-muted-foreground text-sm">{isRtl ? 'جارٍ حساب المستحقات من التقارير...' : 'Computing dues...'}</div>
            ) : error ? (
              <div className="p-10 text-center text-sm text-red-600">{error}</div>
            ) : tab === 'dues' ? (
              <div className="divide-y">
                {filteredLines.length === 0 ? (
                  <div className="p-10 text-center text-muted-foreground text-sm">{isRtl ? 'لا خطوط مطابقة للتصفية' : 'No matching lines'}</div>
                ) : filteredLines.map(function(l: any) {
                  var ls = LINE_STATUS_LABELS[l.status] || { ar: l.status, color: '#64748b' }
                  return (
                    <div key={l.driveLineId} className="p-3 space-y-2">
                      <div className="flex items-start justify-between gap-2 flex-wrap">
                        <div className="min-w-0">
                          <p className="font-semibold text-sm">
                            {isRtl ? 'خط ' : 'Line '}{l.lineNumber}
                            <span className="text-muted-foreground font-normal"> • {l.projectName}</span>
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {(l.contractorName || (isRtl ? 'مقاول غير محدد' : 'No contractor'))}
                            {' • '}{isRtl ? 'السعر' : 'Price'}: {l.pricePerMeter > 0 ? fmtMoney(l.pricePerMeter) + MONEY_LABEL + '/م' : (isRtl ? 'غير محدد' : 'Not set')}
                            {' • '}{isRtl ? 'المخطط' : 'Planned'}: {fmtM(l.plannedLength)} م
                            {l.hasLengthExtension && ' • ' + (isRtl ? 'معدّل معتمداً إلى ' : 'extended to ') + fmtM(l.approvedPlannedLength) + ' م'}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Badge variant="outline" className="text-[11px]" style={{ backgroundColor: ls.color + '14', color: ls.color, borderColor: ls.color + '40' }}>{isRtl ? ls.ar : l.status}</Badge>
                          {l.overLimit && (
                            <Badge variant="outline" className="text-[11px] border-red-500/40 text-red-600 bg-red-500/10">{isRtl ? 'تجاوز المخطط — يحتاج تعديلاً معتمداً' : 'Over plan'}</Badge>
                          )}
                        </div>
                      </div>

                      {/* أرقام المستحقات — الحفر الفعلي هو أساس الاحتساب */}
                      <div className="grid grid-cols-3 lg:grid-cols-6 gap-1.5 text-center">
                        <div className="p-1.5 rounded-lg bg-sky-500/10">
                          <p className="text-[10px] text-muted-foreground">{isRtl ? 'الحفر الفعلي' : 'Actual excavated'}</p>
                          <p className="text-sm font-bold text-sky-700 dark:text-sky-400">{fmtM(l.excavatedLength)} م</p>
                        </div>
                        <div className="p-1.5 rounded-lg bg-slate-500/10">
                          <p className="text-[10px] text-muted-foreground">{isRtl ? 'الأنابيب المدفوعة (فني)' : 'Piped (review)'}</p>
                          <p className="text-sm font-bold text-slate-600 dark:text-slate-300">{fmtM(l.pipeJackedLength)} م</p>
                        </div>
                        <div className="p-1.5 rounded-lg bg-amber-500/10">
                          <p className="text-[10px] text-muted-foreground">{isRtl ? 'المستحق التراكمي' : 'Accrued'}</p>
                          <p className="text-sm font-bold text-amber-700 dark:text-amber-400">{fmtMoney(l.accruedAmount)}</p>
                        </div>
                        <div className="p-1.5 rounded-lg bg-violet-500/10">
                          <p className="text-[10px] text-muted-foreground">{isRtl ? 'المعتمد سابقاً' : 'Prev. approved'}</p>
                          <p className="text-sm font-bold text-violet-700 dark:text-violet-400">{fmtMoney(l.previouslyApprovedAmount)}</p>
                        </div>
                        <div className="p-1.5 rounded-lg bg-emerald-500/10">
                          <p className="text-[10px] text-muted-foreground">{isRtl ? 'المدفوع' : 'Paid'}</p>
                          <p className="text-sm font-bold text-emerald-700 dark:text-emerald-400">{fmtMoney(l.paidAmount)}</p>
                        </div>
                        <div className="p-1.5 rounded-lg bg-rose-500/10">
                          <p className="text-[10px] text-muted-foreground">{isRtl ? 'المستحق غير المدفوع' : 'Unpaid balance'}</p>
                          <p className="text-sm font-bold text-rose-700 dark:text-rose-400">{fmtMoney(l.balance)}</p>
                        </div>
                      </div>
                      {l.uninvoicedLength > 0 && l.pricePerMeter > 0 && (
                        <p className="text-[11px] text-muted-foreground">
                          {isRtl ? 'حفر غير مفوتر بعد: ' + fmtM(l.uninvoicedLength) + ' م (' + fmtMoney(l.uninvoicedAmount) + MONEY_LABEL + ') — يُحتسب في الفاتورة عند اكتمال الخط واعتماد المهندس للأطوال' : 'Uninvoiced: ' + fmtM(l.uninvoicedLength) + ' m'}
                        </p>
                      )}
                      {!l.hasAgreement && (
                        <p className="text-[11px] text-orange-600 font-medium">
                          {isRtl ? 'عقد المقاول غير مكتمل (الاسم والسعر إجباريان قبل بدء الاحتساب)' : 'Agreement incomplete'}
                        </p>
                      )}

                      {/* الأزرار حسب الدور — الخادم هو المصدر */}
                      <div className="flex gap-1.5 flex-wrap">
                        {viewer.canWriteCosts && l.status === 'completed' && !l.activeInvoice && (
                          <Button size="sm" variant="outline" disabled={busyId !== null} onClick={function() { requestVerification(l) }}>
                            {isRtl ? 'إرسال لمراجعة المهندس' : 'Send for verification'}
                          </Button>
                        )}
                        {viewer.canTechReview && l.status === 'pending_verification' && (
                          <Button size="sm" className="bg-sky-600 hover:bg-sky-700" onClick={function() { setReviewLine(l); setReviewDecision('approve'); setReviewNote(''); setReviewOpen(true) }}>
                            {isRtl ? 'مراجعة الأطوال (مهندس)' : 'Review lengths'}
                          </Button>
                        )}
                        {viewer.canWriteCosts && (
                          <Button size="sm" variant="outline" onClick={function() { openAgreement(l) }}>
                            {isRtl ? 'بيانات العقد' : 'Agreement'}
                          </Button>
                        )}
                        {(viewer.canFinanceReview || viewer.isAdmin) && l.overLimit && (
                          <Button size="sm" variant="outline" className="border-red-500/40 text-red-600" onClick={function() { setExtLine(l); setExtLength(String(Math.max(l.excavatedLength, Number(l.approvedPlannedLength) || 0))); setExtReason(''); setExtOpen(true) }}>
                            {isRtl ? 'تعديل الطول المخطط (معتمد)' : 'Extend planned length'}
                          </Button>
                        )}
                        {(viewer.canFinalApprove || viewer.isAdmin) && l.activeInvoice && l.status === 'verified' && (
                          <Button size="sm" variant="outline" className="border-amber-500/40 text-amber-700" onClick={function() { setSettleLine(l); setSettleLength(''); setSettleReason(''); setSettleOpen(true) }}>
                            {isRtl ? 'تسوية مالية مستقلة' : 'Financial settlement'}
                          </Button>
                        )}
                        {l.lastChanges.length > 0 && (
                          <span className="text-[10px] text-muted-foreground self-center">
                            {isRtl ? 'آخر تغيير معتمد: ' : 'Last change: '}
                            {l.lastChanges[0].changeType === 'price' ? (isRtl ? 'السعر' : 'price') : (isRtl ? 'الطول المخطط' : 'length')}
                            {' '}{l.lastChanges[0].oldValue} → {l.lastChanges[0].newValue}
                            {' — '}{l.lastChanges[0].approvedByName || ''}
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="divide-y">
                {filteredInvoices.length === 0 ? (
                  <div className="p-10 text-center text-muted-foreground text-sm">
                    <FileText className="h-10 w-10 mx-auto mb-3 opacity-30" />
                    {isRtl ? 'لا فواتير — تُنشأ مسودة واحدة لكل خط بعد اكتماله واعتماد المهندس لأطواله' : 'No invoices yet'}
                  </div>
                ) : filteredInvoices.map(function(iv: any) {
                  var paid = invoicesPaid(iv)
                  var st = INVOICE_STATUS_LABELS[iv.status] || { ar: iv.status, color: '#64748b' }
                  return (
                    <div key={iv.id} className="p-3 space-y-2">
                      <div className="flex items-start justify-between gap-2 flex-wrap">
                        <div className="min-w-0">
                          <p className="font-semibold text-sm">{iv.invoiceNo}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {isRtl ? 'خط ' : 'Line '}{iv.lineNumber} • {iv.projectName} • {iv.contractorName}
                            {' • '}{isRtl ? 'الطول المعتمد' : 'Approved length'}: {fmtM(iv.approvedLength)} م × {fmtMoney(iv.pricePerMeter)}
                          </p>
                        </div>
                        <Badge variant="outline" className="text-[11px]" style={{ backgroundColor: st.color + '14', color: st.color, borderColor: st.color + '40' }}>{isRtl ? st.ar : iv.status}</Badge>
                      </div>
                      <div className="grid grid-cols-4 gap-1.5 text-center">
                        <div className="p-1.5 rounded-lg bg-slate-500/10">
                          <p className="text-[10px] text-muted-foreground">{isRtl ? 'الإجمالي' : 'Total'}</p>
                          <p className="text-sm font-bold">{fmtMoney(iv.totalAmount)}</p>
                        </div>
                        <div className="p-1.5 rounded-lg bg-violet-500/10">
                          <p className="text-[10px] text-muted-foreground">{isRtl ? 'المخصوم سابقاً' : 'Prev. deducted'}</p>
                          <p className="text-sm font-bold text-violet-700 dark:text-violet-400">{fmtMoney(iv.previouslyApprovedAmount)}</p>
                        </div>
                        <div className="p-1.5 rounded-lg bg-sky-500/10">
                          <p className="text-[10px] text-muted-foreground">{isRtl ? 'الصافي المطلوب' : 'Net'}</p>
                          <p className="text-sm font-bold text-sky-700 dark:text-sky-400">{fmtMoney(iv.netAmount)}</p>
                        </div>
                        <div className="p-1.5 rounded-lg bg-emerald-500/10">
                          <p className="text-[10px] text-muted-foreground">{isRtl ? 'المدفوع' : 'Paid'}</p>
                          <p className="text-sm font-bold text-emerald-700 dark:text-emerald-400">{fmtMoney(paid)}</p>
                        </div>
                      </div>
                      <div className="flex gap-1.5 flex-wrap">
                        <Button size="sm" variant="outline" onClick={function() { setInv(iv); setDecNote(''); setPayAmount(''); setPayNote(''); setInvOpen(true) }}>
                          {isRtl ? 'التفاصيل والقرارات' : 'Details & decisions'}
                        </Button>
                        {viewer.canWriteCosts && iv.status === 'returned' && (
                          <Button size="sm" variant="outline" disabled={busyId !== null} onClick={function() { var ivv = iv; setInv(ivv); setInvOpen(true); setDecNote('') }}>
                            {isRtl ? 'أعد الإرسال بعد التعديل' : 'Resubmit'}
                          </Button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {migReport && (
            <div className="text-[11px] text-muted-foreground border-t pt-2">
              {isRtl ? 'تقرير الترحيل: ' : 'Migration: '}{migReport.oldApprovedInvoices} {isRtl ? 'فاتورة قديمة على' : 'old invoices on'} {migReport.byLine ? migReport.byLine.length : 0} {isRtl ? 'خطاً — ثُبتت المستوطنة على' : 'lines — settled on'} {migReport.linesUpdated} {migReport.legacyAutoRows > 0 ? (' — بقايا آلية v114: ' + migReport.legacyAutoRows) : ''}
              {migReport.byLine && migReport.byLine.some(function(x: any) { return x.needsAgreement }) && (
                <p className="text-orange-600 mt-1">{isRtl ? 'خطوط تحتاج استكمال العقد: ' : 'Lines missing agreement: '}{migReport.byLine.filter(function(x: any) { return x.needsAgreement }).map(function(x: any) { return x.lineNumber }).join('، ')}</p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={function() { fetchData() }} disabled={loading}>
              {isRtl ? 'تحديث' : 'Refresh'}
            </Button>
            <Button type="button" variant="ghost" onClick={function() { props.onOpenChange(false) }}>
              {isRtl ? 'إغلاق' : 'Close'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* نافذة بيانات العقد */}
      <Dialog open={agreeOpen} onOpenChange={setAgreeOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{isRtl ? 'عقد المقاول — خط ' + (agreeLine ? agreeLine.lineNumber : '') : 'Contractor agreement'}</DialogTitle>
            <DialogDescription>
              {isRtl ? 'السعر خاص بهذا الخط فقط ولا يُسحب من خطوط أخرى. تغيير السعر بعد بدء العمل يحتاج الاعتماد المالي مع سبب موثق.' : 'Price is per-line only.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{isRtl ? 'اسم المقاول المنفذ *' : 'Contractor name *'}</Label>
              <Input value={agreeName} onChange={function(e) { setAgreeName(e.target.value) }} />
            </div>
            <div className="space-y-1.5">
              <Label>{isRtl ? 'سعر المقاول المتفق عليه لكل متر (ر.ع) *' : 'Price per meter (OMR) *'}</Label>
              <Input type="number" step="0.001" min="0" inputMode="decimal" value={agreePrice} onChange={function(e) { setAgreePrice(e.target.value) }} />
            </div>
            <div className="space-y-1.5">
              <Label>{isRtl ? 'تاريخ بدء العمل' : 'Work start date'}</Label>
              <Input type="date" value={agreeDate} onChange={function(e) { setAgreeDate(e.target.value) }} />
            </div>
            {agreeLine && agreeLine.status !== 'not_started' && Number(agreeLine.pricePerMeter || 0) > 0 && (
              <div className="space-y-1.5">
                <Label>{isRtl ? 'سبب تغيير السعر (إجباري عند تغييره بعد بدء العمل)' : 'Price change reason (if changed)'}</Label>
                <Textarea rows={2} value={agreeReason} onChange={function(e) { setAgreeReason(e.target.value) }} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={function() { setAgreeOpen(false) }}>{isRtl ? 'إلغاء' : 'Cancel'}</Button>
            <Button disabled={busyId !== null} onClick={saveAgreement}>{busyId ? '...' : (isRtl ? 'حفظ' : 'Save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* نافذة المراجعة الفنية (المهندس) */}
      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{isRtl ? 'مراجعة أطوال الخط ' + (reviewLine ? reviewLine.lineNumber : '') : 'Review lengths'}</DialogTitle>
            <DialogDescription>
              {isRtl
                ? 'الحفر الفعلي المسجل: ' + (reviewLine ? fmtM(reviewLine.excavatedLength) : '') + ' م — الأنابيب المدفوعة: ' + (reviewLine ? fmtM(reviewLine.pipeJackedLength) : '') + ' م (للمراجعة الفنية فقط، لا يدخل الاحتساب) — المستحق التراكمي: ' + (reviewLine ? fmtMoney(reviewLine.accruedAmount) + MONEY_LABEL : '') + ' — الاعتماد ينشئ مسودة الفاتورة الوحيدة آلياً.'
                : 'Approval creates the single draft invoice automatically.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{isRtl ? 'القرار' : 'Decision'}</Label>
              <Select value={reviewDecision} onValueChange={setReviewDecision}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="approve">{isRtl ? 'اعتماد الأطوال — تصح ومطابقة للتنفيذ' : 'Approve lengths'}</SelectItem>
                  <SelectItem value="correction">{isRtl ? 'طلب تعديل — الأطوال المسجلة غير صحيحة' : 'Request correction'}</SelectItem>
                  <SelectItem value="reject">{isRtl ? 'رفض — مشكلة جوهرية تمنع الاعتماد' : 'Reject'}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {reviewDecision !== 'approve' && (
              <div className="space-y-1.5">
                <Label>{isRtl ? 'ملاحظات التعديل / سبب الرفض *' : 'Notes / reason *'}</Label>
                <Textarea rows={3} value={reviewNote} onChange={function(e) { setReviewNote(e.target.value) }} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={function() { setReviewOpen(false) }}>{isRtl ? 'إلغاء' : 'Cancel'}</Button>
            <Button disabled={busyId !== null} onClick={submitReview}>{busyId ? '...' : (isRtl ? 'إرسال القرار' : 'Submit')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* نافذة تفاصيل الفاتورة: سلسلة الاعتماد + القرارات + الدفعات */}
      <Dialog open={invOpen} onOpenChange={setInvOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{inv ? inv.invoiceNo : ''}</DialogTitle>
            <DialogDescription>
              {inv ? (isRtl ? 'خط ' + inv.lineNumber + ' — ' + inv.projectName + ' — المقاول: ' + inv.contractorName + ' — القطر: ' + (inv.diameter || '-') : 'Invoice details') : ''}
            </DialogDescription>
          </DialogHeader>
          {inv && (
            <div className="space-y-3 max-h-[50vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="p-2 rounded-lg bg-muted/40">
                  <p className="text-xs text-muted-foreground">{isRtl ? 'الطول الفعلي المعتمد من المهندس' : 'Engineer-approved length'}</p>
                  <p className="font-bold">{fmtM(inv.approvedLength)} م</p>
                </div>
                <div className="p-2 rounded-lg bg-muted/40">
                  <p className="text-xs text-muted-foreground">{isRtl ? 'سعر المتر المتفق عليه' : 'Agreed price/m'}</p>
                  <p className="font-bold">{fmtMoney(inv.pricePerMeter)}{MONEY_LABEL}</p>
                </div>
                <div className="p-2 rounded-lg bg-muted/40">
                  <p className="text-xs text-muted-foreground">{isRtl ? 'إجمالي قيمة الأعمال' : 'Total value'}</p>
                  <p className="font-bold">{fmtMoney(inv.totalAmount)}{MONEY_LABEL}</p>
                </div>
                <div className="p-2 rounded-lg bg-muted/40">
                  <p className="text-xs text-muted-foreground">{isRtl ? 'معتمد/مفوتر سابقاً لنفس الخط' : 'Previously approved'}</p>
                  <p className="font-bold text-violet-700 dark:text-violet-400">{fmtMoney(inv.previouslyApprovedAmount)}{MONEY_LABEL}</p>
                </div>
                <div className="p-2 rounded-lg bg-sky-500/10">
                  <p className="text-xs text-muted-foreground">{isRtl ? 'صافي المبلغ المطلوب اعتماده' : 'Net to approve'}</p>
                  <p className="font-bold text-sky-700 dark:text-sky-400">{fmtMoney(inv.netAmount)}{MONEY_LABEL}</p>
                </div>
                <div className="p-2 rounded-lg bg-emerald-500/10">
                  <p className="text-xs text-muted-foreground">{isRtl ? 'المدفوع / المتبقي' : 'Paid / remaining'}</p>
                  <p className="font-bold text-emerald-700 dark:text-emerald-400">{fmtMoney(invoicesPaid(inv))} / {fmtMoney(inv.netAmount - invoicesPaid(inv))}{MONEY_LABEL}</p>
                </div>
              </div>
              {inv.isSettlement && (
                <p className="text-[11px] text-amber-700 dark:text-amber-400 border border-amber-500/30 rounded-lg p-2 bg-amber-500/5">
                  {isRtl ? 'فاتورة تسوية مالية مستقلة مصرّح بها — السبب: ' + (inv.settlementReason || '') : 'Authorized settlement invoice'}
                </p>
              )}

              {/* سلسلة الاعتماد — الاسم والتاريخ والوقت لكل مرحلة */}
              <div className="space-y-1.5 text-xs">
                <p className="font-semibold">{isRtl ? 'سلسلة الاعتماد' : 'Approval chain'}</p>
                <p className="text-muted-foreground">
                  {isRtl ? 'الفني (المهندس): ' : 'Technical: '}{inv.techByName || (isRtl ? '—' : '—')}{inv.techAt ? ' — ' + new Date(inv.techAt).toLocaleString(isRtl ? 'ar-EG' : 'en-US') : ''}
                  {inv.techNote ? ' — ' + inv.techNote : ''}
                </p>
                <p className="text-muted-foreground">
                  {isRtl ? 'المالي: ' : 'Financial: '}{inv.finByName || '—'}{inv.finAt ? ' — ' + new Date(inv.finAt).toLocaleString(isRtl ? 'ar-EG' : 'en-US') : ''}
                  {inv.finNote ? ' — ' + inv.finNote : ''}
                </p>
                <p className="text-muted-foreground">
                  {isRtl ? 'النهائي (مالك الشركة): ' : 'Final (owner): '}{inv.finalByName || '—'}{inv.finalAt ? ' — ' + new Date(inv.finalAt).toLocaleString(isRtl ? 'ar-EG' : 'en-US') : ''}
                  {inv.finalNote ? ' — ' + inv.finalNote : ''}
                </p>
                <p className="text-muted-foreground">
                  {isRtl ? 'أنشأها: ' : 'Created by: '}{inv.createdByName || '—'}{inv.createdAt ? ' — ' + new Date(inv.createdAt).toLocaleString(isRtl ? 'ar-EG' : 'en-US') : ''}
                </p>
              </div>

              {/* الدفعات المسجلة */}
              {(inv.payments || []).length > 0 && (
                <div className="space-y-1 text-xs">
                  <p className="font-semibold">{isRtl ? 'الدفعات المسجلة' : 'Payments'}</p>
                  {inv.payments.map(function(p: any) {
                    return (
                      <p key={p.id} className="text-muted-foreground">
                        {fmtMoney(p.amount)}{MONEY_LABEL} — {new Date(p.paidAt).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US')} — {p.byName || ''}{p.note ? ' — ' + p.note : ''}
                      </p>
                    )
                  })}
                </div>
              )}

              {/* أزرار القرارات حسب المرحلة والدور */}
              <div className="space-y-2 border-t pt-2">
                {viewer.canFinanceReview && inv.status === 'pending_financial' && (
                  <div className="space-y-1.5">
                    <Label>{isRtl ? 'ملاحظات المالي (إجبارية عند الإعادة/الرفض)' : 'Financial note'}</Label>
                    <Textarea rows={2} value={decNote} onChange={function(e) { setDecNote(e.target.value) }} />
                    <div className="flex gap-1.5 flex-wrap">
                      <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" disabled={busyId !== null} onClick={function() { submitDecision('financial', 'approve') }}>{isRtl ? 'موافقة مالية — تنتقل للنهائي' : 'Approve (financial)'}</Button>
                      <Button size="sm" variant="outline" className="border-orange-500/40 text-orange-600" disabled={busyId !== null} onClick={function() { submitDecision('financial', 'return') }}>{isRtl ? 'إعادة للتعديل' : 'Return'}</Button>
                      <Button size="sm" variant="outline" className="border-red-500/40 text-red-600" disabled={busyId !== null} onClick={function() { submitDecision('financial', 'reject') }}>{isRtl ? 'رفض' : 'Reject'}</Button>
                    </div>
                  </div>
                )}
                {viewer.canFinalApprove && inv.status === 'pending_final' && (
                  <div className="space-y-1.5">
                    <Label>{isRtl ? 'ملاحظات الاعتماد النهائي (السبب إجباري عند الإرجاع/الرفض)' : 'Final note'}</Label>
                    <Textarea rows={2} value={decNote} onChange={function(e) { setDecNote(e.target.value) }} />
                    <div className="flex gap-1.5 flex-wrap">
                      <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" disabled={busyId !== null} onClick={function() { submitDecision('final', 'approve') }}>{isRtl ? 'اعتماد نهائي — تصبح قابلة للصرف' : 'Final approve'}</Button>
                      <Button size="sm" variant="outline" className="border-orange-500/40 text-orange-600" disabled={busyId !== null} onClick={function() { submitDecision('final', 'return') }}>{isRtl ? 'إرجاع للمراجعة المالية' : 'Return to financial'}</Button>
                      <Button size="sm" variant="outline" className="border-red-500/40 text-red-600" disabled={busyId !== null} onClick={function() { submitDecision('final', 'reject') }}>{isRtl ? 'رفض مع ذكر السبب' : 'Reject with reason'}</Button>
                    </div>
                  </div>
                )}
                {viewer.canFinanceReview && (inv.status === 'approved' || inv.status === 'partially_paid') && (
                  <div className="space-y-1.5 border-t pt-2">
                    <Label>{isRtl ? 'تسجيل دفعة — المبلغ (ر.ع) *' : 'Record payment — amount *'}</Label>
                    <div className="flex gap-1.5">
                      <Input type="number" step="0.001" min="0.001" inputMode="decimal" value={payAmount} onChange={function(e) { setPayAmount(e.target.value) }} placeholder={isRtl ? 'المبلغ' : 'Amount'} />
                      <Input type="date" value={payDate} onChange={function(e) { setPayDate(e.target.value) }} className="w-36 shrink-0" />
                    </div>
                    <Input placeholder={isRtl ? 'ملاحظة (اختياري)' : 'Note (optional)'} value={payNote} onChange={function(e) { setPayNote(e.target.value) }} />
                    <Button size="sm" className="bg-sky-600 hover:bg-sky-700" disabled={busyId !== null || !(Number(payAmount) > 0)} onClick={addPayment}>
                      {busyId === 'pay:' + inv.id ? '...' : (isRtl ? 'سجل الدفعة' : 'Record payment')}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={function() { setInvOpen(false) }}>{isRtl ? 'إغلاق' : 'Close'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* نافذة تعديل الطول المخطط المعتمد */}
      <Dialog open={extOpen} onOpenChange={setExtOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{isRtl ? 'تعديل الطول المخطط المعتمد — خط ' + (extLine ? extLine.lineNumber : '') : 'Extend planned length'}</DialogTitle>
            <DialogDescription>
              {isRtl ? 'الباب الوحيد لاحتساب أطوال تتجاوز المخطط الأصلي (' + (extLine ? extLine.approvedPlannedLength : 0) + ' م) — التعديل معتمد وموثق باسمك وسببه.' : 'Authorized length extension with logged reason.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{isRtl ? 'الطول المخطط الجديد (م) — أكبر من الحد الحالي *' : 'New planned length (m) *'}</Label>
              <Input type="number" step="0.01" min="0.01" inputMode="decimal" value={extLength} onChange={function(e) { setExtLength(e.target.value) }} />
            </div>
            <div className="space-y-1.5">
              <Label>{isRtl ? 'سبب التعديل *' : 'Reason *'}</Label>
              <Textarea rows={2} value={extReason} onChange={function(e) { setExtReason(e.target.value) }} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={function() { setExtOpen(false) }}>{isRtl ? 'إلغاء' : 'Cancel'}</Button>
            <Button disabled={busyId !== null} onClick={function() { if (extLine) requestExtension(extLine) }}>{busyId ? '...' : (isRtl ? 'اعتماد التعديل' : 'Apply')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* نافذة التسوية المالية المستقلة */}
      <Dialog open={settleOpen} onOpenChange={setSettleOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{isRtl ? 'تسوية مالية مستقلة — خط ' + (settleLine ? settleLine.lineNumber : '') : 'Financial settlement'}</DialogTitle>
            <DialogDescription>
              {isRtl ? 'لا تُنشأ فاتورة ثانية لخط مكتمل ومعتمد إلا من خلال إجراء تسوية مالية مستقل ومصرّح به وموثق — متاح لمالك الشركة والإدارة فقط.' : 'Authorized settlement — owner/admin only.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{isRtl ? 'الطول المطلوب تسويته (م) — من غير المسوى فقط *' : 'Length to settle (m) *'}</Label>
              <Input type="number" step="0.01" min="0.01" inputMode="decimal" value={settleLength} onChange={function(e) { setSettleLength(e.target.value) }} />
              {settleLine && <p className="text-[11px] text-muted-foreground">{isRtl ? 'غير المسوى حالياً: ' : 'Unsettled now: '}{fmtM(settleLine.uninvoicedLength)} م</p>}
            </div>
            <div className="space-y-1.5">
              <Label>{isRtl ? 'سبب التسوية (يُوثق في سجل التدقيق) *' : 'Settlement reason *'}</Label>
              <Textarea rows={2} value={settleReason} onChange={function(e) { setSettleReason(e.target.value) }} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={function() { setSettleOpen(false) }}>{isRtl ? 'إلغاء' : 'Cancel'}</Button>
            <Button disabled={busyId !== null} onClick={async function() {
              if (!settleLine) return
              var len = Number(settleLength)
              if (!isFinite(len) || len <= 0) { toast.error(isRtl ? 'الطول يجب أن يكون رقماً موجباً' : 'Invalid length'); return }
              if (len > Number(settleLine.uninvoicedLength) + 0.001) { toast.error(isRtl ? 'الطول يتجاوز غير المسوى (' + settleLine.uninvoicedLength + ' م) — منع الازدواجية' : 'Length exceeds unsettled'); return }
              if (settleReason.trim().length < 3) { toast.error(isRtl ? 'سبب التسوية إجباري' : 'Reason required'); return }
              if (!window.confirm(isRtl ? 'إنشاء فاتورة تسوية مستقلة للخط ' + settleLine.lineNumber + ' بطول ' + len + ' م؟' : 'Create settlement?')) return
              var d = await post('/api/contractor-dues/invoices/create-settlement', { driveLineId: settleLine.driveLineId, settlementLength: len, reason: settleReason.trim() }, 'settle:' + settleLine.driveLineId)
              if (d) { toast.success(d.message || (isRtl ? 'أُنشئت التسوية' : 'Created')); setSettleOpen(false); fetchData() }
            }}>{busyId ? '...' : (isRtl ? 'إنشاء فاتورة التسوية' : 'Create settlement')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
