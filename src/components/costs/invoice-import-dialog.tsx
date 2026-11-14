'use client'

// ============================================================
// v110 — نافذة «رفع ملف الفواتير» في قسم التكاليف
// ============================================================
// ثلاث خطوات بسيطة للموظف:
//   1) اختيار ملف الإكسل (xlsx / xls / csv) وإسناد مشروع اختياري
//   2) معاينة التحليل التلقائي: الأعمدة المكتشفة + عدد الفواتير
//      الصالحة والإجمالي + عينة من الصفوف + الصفوف المهمَلة وسببها
//   3) تأكيد وإنشاء الفواتير — ثم ملخص النجاح
//
// لا يُكتب أي شيء في قاعدة البيانات إلا بعد الضغط على زر التأكيد.
// الإرسال بـ fetch مباشر (وليس authedFetch) لأن رفع الملفات يحتاج
// ترويسة multipart التي يجبرها authedFetch على JSON — والكوكي
// httpOnly يُرسل تلقائياً مع fetch نفس المصدر.
// ============================================================

import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { toast } from 'sonner'

// نفس تصنيفات التكاليف المعتمدة (نسخة عرض للواجهة فقط)
const categoryLabels: Record<string, { ar: string; en: string }> = {
  labor: { ar: 'أجور العمال', en: 'Labor' },
  housing: { ar: 'سكن', en: 'Housing' },
  transport: { ar: 'نقل', en: 'Transport' },
  fuel: { ar: 'ديزل', en: 'Fuel' },
  maintenance: { ar: 'صيانة', en: 'Maintenance' },
  parts: { ar: 'قطع غيار', en: 'Parts' },
  oil: { ar: 'زيوت', en: 'Oil' },
  safety: { ar: 'سلامة', en: 'Safety' },
  rental: { ar: 'إيجار', en: 'Rental' },
  other: { ar: 'أخرى', en: 'Other' },
}

interface InvoiceImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projects: any[]
  onImported: () => void
}

export default function InvoiceImportDialog({ open, onOpenChange, projects, onImported }: InvoiceImportDialogProps) {
  const language = useAppStore((s) => s.language)
  const isRtl = language === 'ar'

  const [file, setFile] = useState<File | null>(null)
  const [projectId, setProjectId] = useState('none')
  const [step, setStep] = useState<'pick' | 'preview' | 'done'>('pick')
  const [busy, setBusy] = useState<'' | 'analyze' | 'commit'>('')
  const [preview, setPreview] = useState<any>(null)
  const [commitResult, setCommitResult] = useState<any>(null)
  const [errorMsg, setErrorMsg] = useState('')

  // إعادة الضبط الكاملة عند كل فتح/إغلاق — لا بقايا من جلسة سابقة
  useEffect(function() {
    if (!open) {
      setFile(null)
      setProjectId('none')
      setStep('pick')
      setBusy('')
      setPreview(null)
      setCommitResult(null)
      setErrorMsg('')
    }
  }, [open])

  function pickFile(f: File | null) {
    setFile(f)
    setErrorMsg('')
    setPreview(null)
    setStep('pick')
  }

  async function sendToServer(mode: 'analyze' | 'commit') {
    if (!file) return
    setBusy(mode)
    setErrorMsg('')
    try {
      var fd = new FormData()
      fd.append('file', file)
      fd.append('mode', mode)
      fd.append('projectId', projectId === 'none' ? '' : projectId)
      // fetch مباشر: كوكي الجلسة يُرسل تلقائياً (نفس المصدر) ولا تُفرض ترويسة JSON
      var res = await fetch('/api/costs-import', { method: 'POST', body: fd, credentials: 'include' })
      var data: any = null
      try { data = await res.json() } catch { data = null }

      if (!res.ok) {
        setErrorMsg((data && data.message) || ('HTTP ' + res.status))
        if (mode === 'analyze' && data && data.errors && data.errors.length) {
          setPreview(data) // تحليل فاشل جزئياً — نعرض الملاحظات التشخيصية
        }
        return
      }

      if (mode === 'analyze') {
        setPreview(data)
        setStep('preview')
      } else {
        setCommitResult(data)
        setStep('done')
        toast.success(isRtl
          ? 'تم إنشاء ' + data.created + ' فاتورة في قسم التكاليف'
          : 'Created ' + data.created + ' invoices in Costs')
        onImported()
      }
    } catch (e) {
      setErrorMsg(isRtl ? 'فشل الاتصال بالخادم — تحقق من الإنترنت وأعد المحاولة' : 'Network error')
    }
    setBusy('')
  }

  function fmtMoney(n: number): string {
    return (n || 0).toLocaleString(isRtl ? 'ar-EG' : 'en-US', { maximumFractionDigits: 3 })
  }

  function fmtDate(iso: string): string {
    if (!iso) return '-'
    var parts = iso.split('-')
    return parts.length === 3 ? parts[2] + '/' + parts[1] + '/' + parts[0] : iso
  }

  var mapping = (preview && preview.mapping) || null
  var stats = (preview && preview.stats) || null
  var validCount = stats ? stats.validRows : 0

  function MappingChip(props: { label: string; m: any }) {
    return (
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-xs font-medium">{props.label}:</span>
        {props.m && props.m.found ? (
          <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 text-xs font-medium">
            {props.m.header}
          </Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground text-xs">{isRtl ? 'لم يُعثر عليه' : 'Not found'}</Badge>
        )}
      </div>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-primary" />
            {isRtl ? 'رفع ملف الفواتير' : 'Upload Invoices File'}
          </DialogTitle>
          <DialogDescription>
            {isRtl
              ? 'يقرأ النظام ملف الإكسل ويحلله تلقائياً ثم ينشئ فواتير مستقلة في قسم التكاليف بنفس المبالغ والتواريخ وأنواع التكلفة. لا يُسجل شيء قبل تأكيدك النهائي.'
              : 'The system reads and analyzes the Excel file automatically, then creates independent invoices in Costs with the same amounts, dates and cost types. Nothing is recorded before your final confirmation.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 max-h-[65vh] overflow-y-auto pl-1 pr-1">

          {/* ── الخطوة 1: اختيار الملف ── */}
          {step === 'pick' && (
            <div className="space-y-3">
              <label className="block">
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={function(e) { pickFile(e.target.files && e.target.files[0] ? e.target.files[0] : null) }}
                />
                <div className="border-2 border-dashed rounded-xl p-6 text-center cursor-pointer hover:bg-muted/40 transition-colors">
                  <FileSpreadsheet className="h-10 w-10 mx-auto mb-2 text-emerald-600" />
                  {file ? (
                    <>
                      <p className="text-sm font-semibold">{file.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {(file.size / 1024).toFixed(0)} KB — {isRtl ? 'انقر لاختيار ملف آخر' : 'Click to choose another file'}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-semibold">{isRtl ? 'انقر لاختيار ملف الإكسل' : 'Click to choose an Excel file'}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">xlsx / xls / csv — {isRtl ? 'بحد 4 ميجابايت و500 فاتورة' : 'up to 4 MB, 500 invoices'}</p>
                    </>
                  )}
                </div>
              </label>

              <div className="space-y-1.5">
                <Label>{isRtl ? 'إسناد كل الفواتير المستوردة إلى مشروع (اختياري)' : 'Assign all imported invoices to a project (optional)'}</Label>
                <Select value={projectId} onValueChange={setProjectId}>
                  <SelectTrigger><SelectValue placeholder={isRtl ? 'اختر' : 'Select'} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{isRtl ? 'بدون مشروع' : 'No project'}</SelectItem>
                    {projects.map(function(p: any) {
                      return <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    })}
                  </SelectContent>
                </Select>
              </div>

              <div className="text-xs text-muted-foreground leading-relaxed rounded-lg bg-muted/40 p-3">
                {isRtl
                  ? 'يفهم النظام العناوين العربية والإنجليزية الشائعة (مبلغ/قيمة/إجمالي، تاريخ، بيان/وصف/اسم الفاتورة، نوع/تصنيف، ملاحظات) — وإن لم يجدها اكتشف الأعمدة من محتواها. الأرقام العربية (٠١٢٣) والتواريخ بصيغة يوم/شهر/سنة مدعومة، وصفوف «الإجمالي» تُهمل تلقائياً.'
                  : 'The system understands common Arabic/English headers (amount/value/total, date, description, type/category, notes) — and falls back to content-based column detection. Arabic digits (٠١٢٣) and day/month/year dates are supported. Total/sum rows are skipped automatically.'}
              </div>
            </div>
          )}

          {/* ── الخطوة 2: معاينة التحليل ── */}
          {step === 'preview' && mapping && stats && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <MappingChip label={isRtl ? 'المبلغ' : 'Amount'} m={mapping.amount} />
                <MappingChip label={isRtl ? 'التاريخ' : 'Date'} m={mapping.date} />
                <MappingChip label={isRtl ? 'البيان' : 'Description'} m={mapping.description} />
                <MappingChip label={isRtl ? 'النوع' : 'Type'} m={mapping.category} />
                <MappingChip label={isRtl ? 'الملاحظات' : 'Notes'} m={mapping.notes} />
              </div>

              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-lg border p-2.5">
                  <p className="text-xs text-muted-foreground">{isRtl ? 'فواتير صالحة للإنشاء' : 'Valid invoices'}</p>
                  <p className="text-lg font-bold text-emerald-700 dark:text-emerald-400">{validCount}</p>
                </div>
                <div className="rounded-lg border p-2.5">
                  <p className="text-xs text-muted-foreground">{isRtl ? 'إجمالي المبالغ' : 'Total amount'}</p>
                  <p className="text-lg font-bold">{fmtMoney(stats.totalAmount)} {isRtl ? 'ر.ع' : 'OMR'}</p>
                </div>
                <div className="rounded-lg border p-2.5">
                  <p className="text-xs text-muted-foreground">{isRtl ? 'فترة التواريخ' : 'Date range'}</p>
                  <p className="text-sm font-semibold mt-1">{fmtDate(stats.minDate)} {stats.maxDate !== stats.minDate ? '← ' + fmtDate(stats.maxDate) : ''}</p>
                </div>
                <div className="rounded-lg border p-2.5">
                  <p className="text-xs text-muted-foreground">{isRtl ? 'صفوف مهمَلة' : 'Skipped rows'}</p>
                  <p className="text-lg font-bold text-amber-700 dark:text-amber-400">{stats.skippedRows}</p>
                </div>
              </div>

              {preview.preview && preview.preview.length > 0 && (
                <div className="rounded-xl border overflow-hidden">
                  <p className="text-xs font-semibold p-2 bg-muted/40 border-b">
                    {isRtl ? 'عينة من الفواتير التي ستُنشأ (أول ' + preview.preview.length + ')' : 'Sample of invoices to be created (first ' + preview.preview.length + ')'}
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b bg-muted/20">
                          <th className="p-2 text-right font-medium text-muted-foreground">{isRtl ? 'التاريخ' : 'Date'}</th>
                          <th className="p-2 text-right font-medium text-muted-foreground">{isRtl ? 'البيان' : 'Description'}</th>
                          <th className="p-2 text-right font-medium text-muted-foreground">{isRtl ? 'النوع' : 'Type'}</th>
                          <th className="p-2 text-right font-medium text-muted-foreground">{isRtl ? 'المبلغ' : 'Amount'}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.preview.map(function(r: any) {
                          var cat = categoryLabels[r.category]
                          return (
                            <tr key={r.rowNumber} className="border-b last:border-0">
                              <td className="p-2 whitespace-nowrap">{fmtDate(r.dateISO)}</td>
                              <td className="p-2 max-w-[220px]"><span className="block truncate">{r.description}</span></td>
                              <td className="p-2 whitespace-nowrap">{cat ? (isRtl ? cat.ar : cat.en) : r.category}</td>
                              <td className="p-2 font-semibold text-rose-600 whitespace-nowrap">{fmtMoney(r.amount)}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {preview.errors && preview.errors.length > 0 && (
                <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-2.5">
                  <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {isRtl ? 'صفوف مهمَلة (لن تُنشأ) — ' + stats.skippedRows + ' صف' : 'Skipped rows (not created) — ' + stats.skippedRows}
                  </p>
                  <div className="mt-1.5 space-y-0.5">
                    {preview.errors.map(function(er: any, idx: number) {
                      return (
                        <p key={idx} className="text-xs text-muted-foreground">
                          {isRtl ? 'صف' : 'Row'} {er.rowNumber}: {er.reason}
                        </p>
                      )
                    })}
                    {stats.skippedRows > preview.errors.length && (
                      <p className="text-xs text-muted-foreground">{isRtl ? '…و' + (stats.skippedRows - preview.errors.length) + ' صفوف أخرى مماثلة' : '…and ' + (stats.skippedRows - preview.errors.length) + ' more similar rows'}</p>
                    )}
                  </div>
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                {isRtl
                  ? 'بالتأكيد ستُنشأ الفواتير الصالحة كلها دفعة واحدة في قسم التكاليف، ويمكن تعديل أو حذف أي فاتورة فردياً من الجدول بعد ذلك.'
                  : 'On confirm, all valid invoices are created at once in Costs; each one can later be edited or deleted individually from the table.'}
              </p>
            </div>
          )}

          {/* ── الخطوة 3: ملخص النجاح ── */}
          {step === 'done' && commitResult && (
            <div className="text-center py-4 space-y-2">
              <CheckCircle2 className="h-12 w-12 mx-auto text-emerald-600" />
              <p className="text-lg font-bold">
                {isRtl ? 'تم إنشاء ' + commitResult.created + ' فاتورة بنجاح' : 'Successfully created ' + commitResult.created + ' invoices'}
              </p>
              <p className="text-sm text-muted-foreground">
                {isRtl ? 'الإجمالي: ' + fmtMoney(commitResult.totalAmount) + ' ر.ع' : 'Total: ' + fmtMoney(commitResult.totalAmount) + ' OMR'}
                {commitResult.skipped > 0 ? ' — ' + (isRtl ? 'وتم إهمال ' + commitResult.skipped + ' صف غير صالح' : ', skipped ' + commitResult.skipped + ' invalid rows') : ''}
              </p>
              <p className="text-xs text-muted-foreground">
                {isRtl
                  ? 'الفواتير ظاهرة الآن في جدول التكاليف أدناه، وتحمل في ملاحظاتها اسم الملف ورقم الصف لتتبعها.'
                  : 'The invoices are now visible in the Costs table below, each noting its source file and row for traceability.'}
              </p>
            </div>
          )}

          {/* رسالة الخطأ */}
          {errorMsg && (
            <div className="rounded-xl border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          {step === 'pick' && (
            <>
              <Button variant="outline" onClick={function() { onOpenChange(false) }} disabled={busy !== ''}>
                {isRtl ? 'إلغاء' : 'Cancel'}
              </Button>
              <Button onClick={function() { sendToServer('analyze') }} disabled={!file || busy !== ''}>
                {busy === 'analyze' ? <Loader2 className="h-4 w-4 ml-2 animate-spin" /> : <FileSpreadsheet className="h-4 w-4 ml-2" />}
                {busy === 'analyze' ? (isRtl ? 'جارٍ التحليل...' : 'Analyzing...') : (isRtl ? 'تحليل الملف' : 'Analyze file')}
              </Button>
            </>
          )}
          {step === 'preview' && (
            <>
              <Button variant="outline" onClick={function() { setStep('pick') }} disabled={busy !== ''}>
                {isRtl ? 'رجوع' : 'Back'}
              </Button>
              <Button onClick={function() { sendToServer('commit') }} disabled={validCount === 0 || busy !== ''}>
                {busy === 'commit' ? <Loader2 className="h-4 w-4 ml-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 ml-2" />}
                {busy === 'commit'
                  ? (isRtl ? 'جارٍ الإنشاء...' : 'Creating...')
                  : (isRtl ? 'تأكيد وإنشاء ' + validCount + ' فاتورة' : 'Confirm & create ' + validCount)}
              </Button>
            </>
          )}
          {step === 'done' && (
            <Button onClick={function() { onOpenChange(false) }}>
              {isRtl ? 'تم' : 'Done'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
