'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import { Plus, CheckCircle2, XCircle, AlertCircle } from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { authedFetch } from '@/lib/api-client'
import { toast } from 'sonner'

const statusLabels: Record<string, { ar: string; en: string; color: string }> = {
  pending: { ar: 'قيد الانتظار', en: 'Pending', color: 'secondary' },
  accepted: { ar: 'مقبول', en: 'Accepted', color: 'default' },
  needs_revision: { ar: 'يحتاج تعديل', en: 'Needs Revision', color: 'default' },
  rejected: { ar: 'مرفوض', en: 'Rejected', color: 'destructive' },
}

export default function FinishingsPage() {
  const [finishings, setFinishings] = useState<any[]>([])
  const [projects, setProjects] = useState<any[]>([])
  const [driveLines, setDriveLines] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const language = useAppStore((s) => s.language)
  const token = useAppStore((s) => s.token)
  const isRtl = language === 'ar'

  const [formData, setFormData] = useState({
    projectId: '', driveLineId: '', date: new Date().toISOString().split('T')[0],
    siteCleaned: false, wasteRemoved: false, shaftClosed: false,
    siteRestored: false, lineHandover: false,
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
    if (!token) return
    fetchFinishings()
    authedFetch('/api/projects/list').then(r => r.json()).then(d => setProjects(d.projects || []))
  }, [token])

  useEffect(() => {
    if (formData.projectId) {
      authedFetch(`/api/drive-lines?projectId=${formData.projectId}`)
        .then(r => r.json())
        .then(d => setDriveLines(d.driveLines || []))
    }
  }, [formData.projectId])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      const res = await authedFetch('/api/finishings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })
      if (res.ok) {
        toast.success(isRtl ? 'تم إنشاء سجل التشطيب' : 'Finishing record created')
        setDialogOpen(false)
        fetchFinishings()
      }
    } catch {
      toast.error(isRtl ? 'حدث خطأ' : 'Error')
    }
  }

  const checklistItems = [
    { key: 'siteCleaned', label: isRtl ? 'تنظيف الموقع' : 'Site cleaned' },
    { key: 'wasteRemoved', label: isRtl ? 'إزالة المخلفات' : 'Waste removed' },
    { key: 'shaftClosed', label: isRtl ? 'إغلاق الحفر' : 'Shaft closed' },
    { key: 'siteRestored', label: isRtl ? 'إعادة الوضع كما كان' : 'Site restored' },
    { key: 'lineHandover', label: isRtl ? 'تسليم الخط' : 'Line handover' },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">{isRtl ? 'التشطيبات' : 'Finishings'}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isRtl ? 'سجلات التشطيب وتسليم الأعمال' : 'Finishing and handover records'}
          </p>
        </div>
        <Button onClick={() => {
          setFormData({
            projectId: projects[0]?.id || '', driveLineId: '', date: new Date().toISOString().split('T')[0],
            siteCleaned: false, wasteRemoved: false, shaftClosed: false,
            siteRestored: false, lineHandover: false,
            clientNotes: '', handoverStatus: 'pending',
          })
          setDialogOpen(true)
        }}>
          <Plus className="h-4 w-4 ml-2" />
          {isRtl ? 'تشطيب جديد' : 'New Finishing'}
        </Button>
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
            const status = statusLabels[f.handoverStatus]
            const checks = [
              f.siteCleaned, f.wasteRemoved, f.shaftClosed, f.siteRestored, f.lineHandover,
            ]
            const completed = checks.filter(Boolean).length
            return (
              <Card key={f.id}>
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
                    <Badge variant={status.color as any} className="text-xs">
                      {isRtl ? status.ar : status.en}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-5 gap-1 mb-3">
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
                          {checklistItems[i].label.split(' ')[0]}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">{isRtl ? 'مكتمل' : 'Completed'}:</span>
                    <span className="font-semibold">{completed}/5</span>
                  </div>

                  {f.clientNotes && (
                    <div className="mt-2 p-2 rounded bg-muted/30 text-xs">
                      <p className="text-muted-foreground">{isRtl ? 'ملاحظات العميل' : 'Client notes'}:</p>
                      <p>{f.clientNotes}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{isRtl ? 'تشطيب جديد' : 'New Finishing'}</DialogTitle>
            <DialogDescription>
              {isRtl ? 'سجل تشطيب وتسليم خط' : 'Record finishing and handover'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
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
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                {isRtl ? 'إلغاء' : 'Cancel'}
              </Button>
              <Button type="submit">{isRtl ? 'حفظ' : 'Save'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
