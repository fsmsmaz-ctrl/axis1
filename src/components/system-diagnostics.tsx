'use client'

// v57: زر «تشخيص النظام» — يفتح حواراً يستدعي /api/system-status ويعرض النتيجة
// بوضوح: حالة الاتصال بقاعدة البيانات، والجداول/الحقول الحرجة المفقودة إن وُجدت.
// الهدف: إنهاء دورة «القسم لا يفتح ولا نعرف السبب» — المستخدم يرى السبب بنفسه
// ويلتقط صورة للنتيجة ويرسلها فتُحل المشكلة من أول رسالة.

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle
} from '@/components/ui/dialog'
import { Loader2, Stethoscope, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react'
import { authedFetch } from '@/lib/api-client'

interface SystemStatus {
  version?: string
  time?: string
  db?: { connected?: boolean; latencyMs?: number | null; error?: string }
  missingTables?: Array<{ name: string; label: string }>
  missingColumns?: Array<{ table: string; column: string; label: string }>
  ok?: boolean
  summary?: string
}

export function SystemDiagnosticsButton(props: {
  isAr: boolean
  variant?: 'default' | 'outline' | 'ghost' | 'sm'
  className?: string
}) {
  var isAr = props.isAr
  var [open, setOpen] = useState(false)
  var [loading, setLoading] = useState(false)
  var [status, setStatus] = useState<SystemStatus | null>(null)
  var [fetchError, setFetchError] = useState<string | null>(null)

  function run() {
    setOpen(true)
    setLoading(true)
    setFetchError(null)
    setStatus(null)
    authedFetch('/api/system-status')
      .then(async function(r) {
        var ct = (r.headers.get('content-type') || '')
        if (ct.indexOf('application/json') === -1) {
          throw new Error('HTTP ' + r.status)
        }
        var d = await r.json()
        if (!r.ok) throw new Error(d && d.message ? String(d.message) : 'HTTP ' + r.status)
        setStatus(d)
      })
      .catch(function(e) {
        setFetchError(isAr
          ? ('تعذر تشغيل التشخيص (' + (e && e.message ? e.message : 'خطأ غير معروف') + ') — الخادم نفسه لا يستجيب، انتظر دقيقة وأعد المحاولة')
          : ('Diagnostics failed (' + (e && e.message ? e.message : 'unknown') + ') — the server itself is not responding, retry in a minute'))
      })
      .finally(function() { setLoading(false) })
  }

  var label = isAr ? 'تشخيص النظام' : 'System diagnostics'

  return (
    <>
      <Button
        type="button"
        variant={props.variant === 'sm' ? 'outline' : (props.variant || 'outline')}
        size={props.variant === 'sm' ? 'sm' : 'default'}
        onClick={run}
        className={props.className}
      >
        <Stethoscope className="h-4 w-4" />
        {label}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto" dir={isAr ? 'rtl' : 'ltr'}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Stethoscope className="h-5 w-5" />
              {label}
            </DialogTitle>
            <DialogDescription>
              {isAr
                ? 'فحص مباشر لقاعدة البيانات وكل المكونات التي يعتمد عليها العمل — أرسل لنا صورة لهذه النتيجة إن استمرت المشكلة.'
                : 'Live check of the database and every component the app depends on — send us a screenshot if the problem persists.'}
            </DialogDescription>
          </DialogHeader>

          {loading && (
            <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">{isAr ? 'جارٍ الفحص...' : 'Checking...'}</span>
            </div>
          )}

          {!loading && fetchError && (
            <div className="space-y-3">
              <div className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 p-3">
                <XCircle className="h-5 w-5 shrink-0 text-red-600" />
                <p className="text-sm leading-6 text-red-700 dark:text-red-400">{fetchError}</p>
              </div>
              <Button variant="outline" className="w-full" onClick={run}>
                <Loader2 className="h-4 w-4" />
                {isAr ? 'إعادة الفحص' : 'Re-check'}
              </Button>
            </div>
          )}

          {!loading && status && (
            <div className="space-y-3 text-sm">
              {/* حالة قاعدة البيانات */}
              <div className={'flex items-start gap-2 rounded-md border p-3 ' + (status.db && status.db.connected
                ? 'border-emerald-500/40 bg-emerald-500/10'
                : 'border-red-500/40 bg-red-500/10')}>
                {status.db && status.db.connected
                  ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
                  : <XCircle className="h-5 w-5 shrink-0 text-red-600" />}
                <div>
                  <p className="font-medium leading-6">
                    {isAr ? 'قاعدة البيانات: ' : 'Database: '}
                    {status.db && status.db.connected
                      ? (isAr ? 'متصلة ✓ (زمن الاستجابة ' + status.db.latencyMs + 'ms)' : 'connected (' + status.db.latencyMs + 'ms)')
                      : (status.db && status.db.error ? status.db.error : (isAr ? 'غير متصلة' : 'not connected'))}
                  </p>
                  {status.version && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {isAr ? 'إصدار النظام على الخادم: ' : 'Server version: '}{status.version}
                      {status.time ? ' — ' + new Date(status.time).toLocaleString(isAr ? 'ar-EG' : 'en') : ''}
                    </p>
                  )}
                </div>
              </div>

              {/* الجداول المفقودة */}
              {status.missingTables && status.missingTables.length > 0 && (
                <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
                  <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
                  <div>
                    <p className="font-medium leading-6">{isAr ? 'جداول مفقودة في قاعدة البيانات:' : 'Missing database tables:'}</p>
                    <ul className="mt-1 list-inside list-disc space-y-0.5 text-muted-foreground">
                      {status.missingTables.map(function(t) {
                        return <li key={t.name}>{t.label} <span className="text-[10px]">({t.name})</span></li>
                      })}
                    </ul>
                  </div>
                </div>
              )}

              {/* الأعمدة المفقودة */}
              {status.missingColumns && status.missingColumns.length > 0 && (
                <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
                  <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
                  <div>
                    <p className="font-medium leading-6">{isAr ? 'حقول مفقودة في قاعدة البيانات:' : 'Missing database columns:'}</p>
                    <ul className="mt-1 list-inside list-disc space-y-0.5 text-muted-foreground">
                      {status.missingColumns.map(function(c) {
                        return <li key={c.table + '.' + c.column}>{c.label} <span className="text-[10px]">({c.table}.{c.column})</span></li>
                      })}
                    </ul>
                  </div>
                </div>
              )}

              {/* الخلاصة */}
              {status.summary && (
                <div className={'rounded-md border p-3 leading-6 ' + (status.ok
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300'
                  : 'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300')}>
                  {status.summary}
                </div>
              )}

              <Button variant="outline" className="w-full" onClick={run}>
                <Loader2 className="h-4 w-4" />
                {isAr ? 'إعادة الفحص' : 'Re-check'}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
