'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle
} from '@/components/ui/dialog'
import { Plus, CheckCircle2, XCircle, AlertCircle, Send, Pencil, Check, X } from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { authedFetch } from '@/lib/api-client'
import { SYSTEM_ADMIN_EMAIL, canWrite } from '@/lib/auth'
import { toast } from 'sonner'

// حالة تسليم العميل (كما كانت) — منفصلة عن حالة اعتماد الإدارة
const statusLabels: Record<string, { ar: string; en: string; color: string }> = {
  pending: { ar: 'قيد الانتظار', en: 'Pending', color: 'secondary' },
  accepted: { ar: 'مقبول', en: 'Accepted', color: 'default' },
  needs_revision: { ar: 'يحتاج تعديل', en: 'Needs Revision', color: 'default' },
  rejected: { ar: 'مرفوض', en: 'Rejected', color: 'destructive' },
}

// دورة اعتماد الإدارة — مطابقة لدورة التقارير اليومية
const workflowLabels: Record<string, { ar: string; en: string; color: string; cls?: string }> = {
  draft: { ar: 'مسودة', en: 'Draft', color: 'secondary' },
  submitted: { ar: 'مرفوع للإدارة — بانتظار الاعتماد', en: 'Submitted — Awaiting Approval', color: 'default' },
  approved: { ar: 'معتمد من الإدارة', en: 'Approved by Management', color: 'default', cls: 'bg-emerald-600 hover:bg-emerald-600 text-white' },
  rejected: { ar: 'مرفوض — يحتاج تعديل', en: 'Rejected — Needs Revision', color: 'destructive' },
}

export default function FinishingsPage() {
  const [finishings, setFinishings] = useState<any[]>([])
  const [projects, setProjects] = useState<any[]>([])
  const [driveLines, setDriveLines] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [rejectTarget, setRejectTarget] = useState<any>(null)
  const [rejectNotes, setRejectNotes] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const language = useAppStore((s) => s.language)
  const user = useAppStore((s) => s.user)
  const isRtl = language === 'ar'

  // مدير النظام (admin@axis.om)
  const isAdmin = (user?.email || '').toLowerCase().trim() === SYSTEM_ADMIN_EMAIL
  // المشرف (الفورمان) — له صلاحية رفع التشطيب للإدارة بعد الانتهاء من العمل
  const isSupervisor = user?.role === 'foreman'
  // الاعتماد/الرفض: الإداري (الإدارة العليا) أو مدير المشروع أو مدير النظام
  const canApprove = isAdmin || user?.role === 'top_management' || user?.role === 'project_manager'
  // إنشاء/تعديل التشطيبات — وفق صلاحيات الكتابة المعتمدة في النظام
  const canWriteFin = !!user && (isAdmin || canWrite(user.role, 'finishings', user.permissions))

  const [formData, setFormData] = useState({
    projectId: '', driveLineId: '', date: new Date().toISOString().split('T')[0],
    siteCleaned: false, wasteRemoved: false, shaftClosed: false,
    siteRestored: false, lineHandover: false, casingSpacer: false,
    clientNotes: '', handoverStatus: 'pending',
  })

  async function fetchFinishings() {
    setLoading(true)
    const res = await authedFetch('/api/finishings')
    const data = await res.json()
    setFinishings(data.finishings || [])
    setLoading(false)
  }

  useEffect(() => {
    fetchFinishings()
    authedFetch('/api/projects/list').then(r => r.json()).then(d => setProjects(d.projects || []))
  }, [])

  useEffect(() => {
    if (formData.projectId) {
      authedFetch(`/api/drive-lines?projectId=${formData.projectId}`)
        .then(r => r.json())
        .then(d => setDriveLines(d.driveLines || []))
    }
  }, [formData.projectId])

  function resetForm() {
    setFormData({
      projectId: projects[0]?.id || '', driveLineId: '', date: new Date().toISOString().split('T')[0],
      siteCleaned: false, wasteRemoved: false, shaftClosed: false,
      siteRestored: false, lineHandover: false, casingSpacer: false,
      clientNotes: '', handoverStatus: 'pending',
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      const isEdit = !!editingId
      const res = await authedFetch(isEdit ? `/api/finishings/${editingId}` : '/api/finishings', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        toast.success(isRtl
          ? (isEdit ? 'تم حفظ التعديلات' : 'تم إنشاء سجل التشطيب')
          : (isEdit ? 'Changes saved' : 'Finishing record created'))
        setDialogOpen(false)
        setEditingId(null)
        fetchFinishings()
      } else {
        toast.error(data.message || (isRtl ? 'حدث خطأ' : 'Error'))
      }
    } catch {
      toast.error(isRtl ? 'حدث خطأ' : 'Error')
    }
  }

  function openEdit(f: any) {
    setEditingId(f.id)
    setFormData({
      projectId: f.projectId || '',
      driveLineId: f.driveLineId || '',
      date: f.date ? new Date(f.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
      siteCleaned: !!f.siteCleaned,
      wasteRemoved: !!f.wasteRemoved,
      shaftClosed: !!f.shaftClosed,
      siteRestored: !!f.siteRestored,
      lineHandover: !!f.lineHandover,
      casingSpacer: !!f.casingSpacer,
      clientNotes: f.clientNotes || '',
      handoverStatus: f.handoverStatus || 'pending',
    })
    setDialogOpen(true)
  }

  // رفع التشطيب للإدارة — المشرف (الفورمان) ومدير النظام فقط، بعد اكتمال البنود
  async function submitFinishing(id: string) {
    setBusyId(id)
    try {
      const res = await authedFetch(`/api/finishings/${id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        toast.success(isRtl ? 'تم رفع التشطيب للإدارة — بانتظار الاعتماد' : 'Finishing submitted to management — awaiting approval')
        fetchFinishings()
      } else {
        toast.error(data.message || (isRtl ? 'تعذر رفع التشطيب' : 'Failed to submit'))
      }
    } catch {
      toast.error(isRtl ? 'حدث خطأ' : 'Error')
    }
    setBusyId(null)
  }

  // اعتماد أو رفض — الإداري / مدير المشروع / مدير النظام
  async function reviewFinishing(id: string, action: 'approve' | 'reject', notes?: string) {
    setBusyId(id)
    try {
      const res = await authedFetch(`/api/finishings/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, notes }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        toast.success(action === 'approve'
          ? (isRtl ? 'تم اعتماد التشطيب' : 'Finishing approved')
          : (isRtl ? 'تم رفض التشطيب — أعيد للمشرف للتعديل' : 'Finishing rejected — returned to supervisor'))
        setRejectTarget(null)
        setRejectNotes('')
        fetchFinishings()
      } else {
        toast.error(data.message || (isRtl ? 'تعذر تنفيذ القرار' : 'Failed to review'))
      }
    } catch {
      toast.error(isRtl ? 'حدث خطأ' : 'Error')
    }
    setBusyId(null)
  }

  const checklistItems = [
    { key: 'siteCleaned', label: isRtl ? 'تنظيف الموقع' : 'Site cleaned', short: isRtl ? 'تنظيف' : 'Clean' },
    { key: 'wasteRemoved', label: isRtl ? 'إزالة المخلفات' : 'Waste removed', short: isRtl ? 'المخلفات' : 'Waste' },
    { key: 'shaftClosed', label: isRtl ? 'إغلاق الحفر' : 'Shaft closed', short: isRtl ? 'الإغلاق' : 'Shaft' },
    { key: 'siteRestored', label: isRtl ? 'إعادة الوضع كما كان' : 'Site restored', short: isRtl ? 'الإعادة' : 'Restore' },
    { key: 'lineHandover', label: isRtl ? 'تسليم الخط' : 'Line handover', short: isRtl ? 'التسليم' : 'Handover' },
    { key: 'casingSpacer', label: isRtl ? 'حشوة الكيسنج (سبيسر)' : 'Casing Spacer', short: isRtl ? 'سبيسر' : 'Spacer' },
  ]
  const totalItems = checklistItems.length

  // هل يمكن للمستخدم الحالي تعديل هذا السجل؟ (مسودة لأصحاب الكتابة — مرفوض للمشرف/الرافع/مدير النظام)
  function canEdit(f: any): boolean {
    if (!canWriteFin) return false
    if (f.status === 'submitted' || f.status === 'approved') return isAdmin
    if (f.status === 'rejected') return isAdmin || isSupervisor || f.submittedById === user?.id
    return true // draft
  }

  // زر الرفع: المشرف أو مدير النظام — للمسودة أو المرفوض
  function canSubmit(f: any): boolean {
    return (isSupervisor || isAdmin) && (f.status === 'draft' || f.status === 'rejected')
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">{isRtl ? 'التشطيبات' : 'Finishings'}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isRtl ? 'سجلات التشطيب وتسليم الأعمال — يرفعها المشرف للإدارة للاعتماد' : 'Finishing and handover records — submitted by supervisor for management approval'}
          </p>
        </div>
        {canWriteFin && (
          <Button onClick={() => { setEditingId(null); resetForm(); setDialogOpen(true) }}>
            <Plus className="h-4 w-4 ml-2" />
            {isRtl ? 'تشطيب جديد' : 'New Finishing'}
          </Button>
        )}
      </div>

      {loading ? (
        <div className="h-32 bg-muted animate-pulse rounded" />
      ) : finishings.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <CheckCircle2 className="h-12 w-12 mx-auto text-muted-foreground/50" />
            <p className="mt-3 text-muted-foreground">{isRtl ? 'لا توجد سجلات تشطيب' : 'No finishing records'}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {finishings.map((f) => {
            const status = statusLabels[f.handoverStatus] || statusLabels.pending
            const wf = workflowLabels[f.status] || workflowLabels.draft
            const checks = [
              f.siteCleaned, f.wasteRemoved, f.shaftClosed, f.siteRestored, f.lineHandover, f.casingSpacer,
            ]
            const completed = checks.filter(Boolean).length
            const workDone = completed === totalItems
            return (
              <Card key={f.id} className={f.status === 'rejected' ? 'border-destructive/40' : ''}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm truncate">{f.project?.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(f.date).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US')}
                        {' • '}
                        {isRtl ? 'موقّع من' : 'Signed by'}: {f.signedBy || '-'}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1.5">
                      <Badge variant={wf.color as any} className={`text-xs ${wf.cls || ''}`}>
                        {isRtl ? wf.ar : wf.en}
                      </Badge>
                      <Badge variant={status.color as any} className="text-xs font-normal">
                        {isRtl ? 'التسليم: ' : 'Handover: '}{isRtl ? status.ar : status.en}
                      </Badge>
                    </div>
                  </div>

                  <div className="grid grid-cols-6 gap-1 mb-3">
                    {checks.map((ok, i) => (
                      <div key={i} className="flex flex-col items-center gap-1">
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center ${
                          ok ? 'bg-emerald-50' : 'bg-muted'
                        }`}>
                          {ok ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                          ) : (
                            <XCircle className="h-4 w-4 text-muted-foreground" />
                          )}
                        </div>
                        <span className="text-[10px] text-center text-muted-foreground">
                          {checklistItems[i].short}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">{isRtl ? 'مكتمل' : 'Completed'}:</span>
                    <span className="font-semibold">{completed}/{totalItems}</span>
                    {f.status === 'submitted' && f.submitter?.name && (
                      <span className="text-muted-foreground">• {isRtl ? 'رافعه' : 'Submitted by'}: {f.submitter.name}</span>
                    )}
                    {f.status === 'approved' && f.approver?.name && (
                      <span className="text-emerald-600">• {isRtl ? 'اعتمده' : 'Approved by'}: {f.approver.name}</span>
                    )}
                  </div>

                  {f.reviewNotes && (f.status === 'rejected' || f.status === 'draft') && (
                    <div className="mt-2 p-2 rounded bg-destructive/10 border border-destructive/20 text-xs">
                      <p className="font-semibold text-destructive flex items-center gap-1">
                        <AlertCircle className="h-3.5 w-3.5" />
                        {isRtl ? 'سبب الرفض — عدل ثم أعد الرفع' : 'Rejection reason — edit then resubmit'}:
                      </p>
                      <p className="mt-1">{f.reviewNotes}</p>
                    </div>
                  )}

                  {f.clientNotes && (
                    <div className="mt-2 p-2 rounded bg-muted/30 text-xs">
                      <p className="text-muted-foreground">{isRtl ? 'ملاحظات العميل' : 'Client notes'}:</p>
                      <p>{f.clientNotes}</p>
                    </div>
                  )}

                  {(canSubmit(f) || (canApprove && f.status === 'submitted') || canEdit(f)) && (
                    <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t">
                      {/* رفع التشطيب للإدارة — المشرف/الفورمان ومدير النظام، عند الانتهاء من العمل */}
                      {canSubmit(f) && (
                        workDone ? (
                          <Button
                            size="sm"
                            className="text-white bg-emerald-600 hover:bg-emerald-700"
                            disabled={busyId === f.id}
                            title={isRtl ? 'رفع التشطيب للإدارة للاعتماد' : 'Submit to management for approval'}
                            onClick={() => submitFinishing(f.id)}
                          >
                            <Send className="h-4 w-4 ml-1" />
                            {isRtl ? 'رفع التشطيب للإدارة' : 'Submit to Management'}
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <AlertCircle className="h-3.5 w-3.5" />
                            {isRtl ? `أكمل البنود (${completed}/${totalItems}) لتفعيل الرفع للإدارة` : `Complete all items (${completed}/${totalItems}) to enable submission`}
                          </span>
                        )
                      )}

                      {/* الاعتماد/الرفض — الإداري أو مدير المشروع أو مدير النظام */}
                      {canApprove && f.status === 'submitted' && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-emerald-600"
                            disabled={busyId === f.id}
                            onClick={() => reviewFinishing(f.id, 'approve')}
                          >
                            <Check className="h-4 w-4 ml-1" />
                            {isRtl ? 'اعتماد' : 'Approve'}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-destructive"
                            disabled={busyId === f.id}
                            onClick={() => { setRejectTarget(f); setRejectNotes('') }}
                          >
                            <X className="h-4 w-4 ml-1" />
                            {isRtl ? 'رفض' : 'Reject'}
                          </Button>
                        </>
                      )}

                      {/* التعديل — المسودة لأصحاب الكتابة، والمرفوض للمشرف الرافع */}
                      {canEdit(f) && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openEdit(f)}
                        >
                          <Pencil className="h-4 w-4 ml-1" />
                          {isRtl ? 'تعديل' : 'Edit'}
                        </Button>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) setEditingId(null) }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? (isRtl ? 'تعديل التشطيب' : 'Edit Finishing') : (isRtl ? 'تشطيب جديد' : 'New Finishing')}</DialogTitle>
            <DialogDescription>
              {editingId
                ? (isRtl ? 'عدّل بيانات التشطيب ثم احفظ — بعد الحفظ يمكنك رفعه للإدارة مجدداً' : 'Edit the finishing data then save — you can resubmit it afterwards')
                : (isRtl ? 'سجل تشطيب وتسليم خط' : 'Record finishing and handover')}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{isRtl ? 'المشروع' : 'Project'} *</Label>
                <Select value={formData.projectId} onValueChange={(v) => setFormData({ ...formData, projectId: v, driveLineId: '' })} required>
                  <SelectTrigger><SelectValue placeholder={isRtl ? 'اختر' : 'Select'} /></SelectTrigger>
                  <SelectContent>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'خط الحفر' : 'Drive Line'}</Label>
                <Select value={formData.driveLineId} onValueChange={(v) => setFormData({ ...formData, driveLineId: v })}>
                  <SelectTrigger><SelectValue placeholder={isRtl ? 'اختر' : 'Select'} /></SelectTrigger>
                  <SelectContent>
                    {driveLines.map((l) => (
                      <SelectItem key={l.id} value={l.id}>{l.lineNumber}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'التاريخ' : 'Date'} *</Label>
                <Input type="date" value={formData.date} onChange={(e) => setFormData({ ...formData, date: e.target.value })} required />
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'حالة التسليم' : 'Handover Status'}</Label>
                <Select value={formData.handoverStatus} onValueChange={(v) => setFormData({ ...formData, handoverStatus: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">{isRtl ? 'قيد الانتظار' : 'Pending'}</SelectItem>
                    <SelectItem value="accepted">{isRtl ? 'مقبول' : 'Accepted'}</SelectItem>
                    <SelectItem value="needs_revision">{isRtl ? 'يحتاج تعديل' : 'Needs Revision'}</SelectItem>
                    <SelectItem value="rejected">{isRtl ? 'مرفوض' : 'Rejected'}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>{isRtl ? 'قائمة التشطيب' : 'Checklist'}</Label>
              <div className="space-y-1.5">
                {checklistItems.map((item) => (
                  <label
                    key={item.key}
                    className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition ${
                      formData[item.key as keyof typeof formData]
                        ? 'bg-emerald-50 border-emerald-200'
                        : 'bg-card border-border hover:bg-muted/50'
                    }`}
                  >
                    <Checkbox
                      checked={formData[item.key as keyof typeof formData] as boolean}
                      onCheckedChange={(checked) => setFormData({ ...formData, [item.key]: !!checked })}
                    />
                    <span className="text-sm">{item.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>{isRtl ? 'ملاحظات العميل' : 'Client Notes'}</Label>
              <Textarea value={formData.clientNotes} onChange={(e) => setFormData({ ...formData, clientNotes: e.target.value })} rows={2} />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { setDialogOpen(false); setEditingId(null) }}>
                {isRtl ? 'إلغاء' : 'Cancel'}
              </Button>
              <Button type="submit">{isRtl ? 'حفظ' : 'Save'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Reject Dialog — سبب الرفض يعود للمشرف ليعدل بناءً عليه */}
      <Dialog open={!!rejectTarget} onOpenChange={(o) => { if (!o) setRejectTarget(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-destructive">{isRtl ? 'رفض التشطيب' : 'Reject Finishing'}</DialogTitle>
            <DialogDescription>
              {isRtl ? 'سيُعاد التشطيب إلى المشرف للتعديل — يرجى ذكر سبب الرفض بوضوح' : 'The finishing will be returned to the supervisor for revision — please state the reason clearly'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{isRtl ? 'سبب الرفض' : 'Rejection Reason'} *</Label>
              <Textarea
                value={rejectNotes}
                onChange={(e) => setRejectNotes(e.target.value)}
                rows={3}
                placeholder={isRtl ? 'مثال: إعادة تشطيب البئر رقم 3 — المخلفات لم تُزل بعد' : 'e.g. Reshape shaft No. 3 — waste not removed yet'}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRejectTarget(null)}>
              {isRtl ? 'إلغاء' : 'Cancel'}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!rejectNotes.trim() || busyId === rejectTarget?.id}
              onClick={() => rejectTarget && reviewFinishing(rejectTarget.id, 'reject', rejectNotes.trim())}
            >
              <X className="h-4 w-4 ml-1" />
              {isRtl ? 'تأكيد الرفض' : 'Confirm Rejection'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

