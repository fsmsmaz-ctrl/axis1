'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Plus, GitBranch, MapPin, Ruler, Layers, AlertCircle, Pencil, Trash2, Loader2 } from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { authedFetch } from '@/lib/api-client'
import { toast } from 'sonner'
import { canWrite } from '@/lib/auth'

const statusLabels: Record<string, { ar: string; en: string; color: string }> = {
  not_started: { ar: 'لم يبدأ', en: 'Not Started', color: 'secondary' },
  in_progress: { ar: 'جارٍ', en: 'In Progress', color: 'default' },
  completed: { ar: 'مكتمل', en: 'Completed', color: 'default' },
  suspended: { ar: 'متوقف', en: 'Suspended', color: 'destructive' },
}

const emptyForm = {
  projectId: '', lineNumber: '', startPoint: '', endPoint: '',
  totalLength: '', diameter: '1200mm', pipeType: 'pipe', soilType: 'mixed',
  depth: '', status: 'not_started', problems: '',
}

export default function DriveLinesPage() {
  const [driveLines, setDriveLines] = useState<any[]>([])
  const [projects, setProjects] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedProject, setSelectedProject] = useState<string>('all')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // Delete confirmation dialog state
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null)
  const [deleting, setDeleting] = useState(false)

  const language = useAppStore((s) => s.language)
  const token = useAppStore((s) => s.token)
  const user = useAppStore((s) => s.user)
  const isRtl = language === 'ar'

  // Permission check — server also enforces this, but we hide the buttons
  // for users without write access to drive_lines for a cleaner UI.
  const canEdit = !!(user && canWrite(user.role, 'drive_lines', user.permissions))

  const [formData, setFormData] = useState(emptyForm)

  async function fetchData() {
    setLoading(true)
    const [linesRes, projRes] = await Promise.all([
      authedFetch('/api/drive-lines' + (selectedProject !== 'all' ? `?projectId=${selectedProject}` : '')),
      authedFetch('/api/projects/list'),
    ])
    const linesData = await linesRes.json()
    const projData = await projRes.json()
    setDriveLines(linesData.driveLines || [])
    setProjects(projData.projects || [])
    setLoading(false)
  }

  useEffect(() => {
    fetchData()
  }, [selectedProject])

  // ── Create / Update submit ──
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    try {
      const isEditing = !!editingId
      const url = isEditing ? `/api/drive-lines/${editingId}` : '/api/drive-lines'
      const method = isEditing ? 'PUT' : 'POST'
      const res = await authedFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(body?.message || body?.error || ('Error ' + res.status))
      }
      toast.success(isRtl
        ? (isEditing ? 'تم تحديث خط الحفر' : 'تم إنشاء خط الحفر')
        : (isEditing ? 'Drive line updated' : 'Drive line created'))
      setDialogOpen(false)
      setEditingId(null)
      setFormData(emptyForm)
      fetchData()
    } catch (e: any) {
      toast.error(e?.message || (isRtl ? 'حدث خطأ' : 'Error'))
    } finally {
      setSubmitting(false)
    }
  }

  // ── Open dialog for creating a new drive line ──
  function openCreate() {
    setEditingId(null)
    setFormData({
      ...emptyForm,
      projectId: projects[0]?.id || '',
    })
    setDialogOpen(true)
  }

  // ── Open dialog for editing an existing drive line ──
  function openEdit(line: any) {
    setEditingId(line.id)
    setFormData({
      projectId: line.projectId || line.project?.id || '',
      lineNumber: line.lineNumber || '',
      startPoint: line.startPoint || '',
      endPoint: line.endPoint || '',
      totalLength: line.totalLength != null ? String(line.totalLength) : '',
      diameter: line.diameter || '1200mm',
      pipeType: line.pipeType || 'pipe',
      soilType: line.soilType || 'mixed',
      depth: line.depth != null ? String(line.depth) : '',
      status: line.status || 'not_started',
      problems: line.problems || '',
    })
    setDialogOpen(true)
  }

  // ── Delete a drive line (after confirmation) ──
  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await authedFetch(`/api/drive-lines/${deleteTarget.id}`, { method: 'DELETE' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(body?.message || body?.error || ('Error ' + res.status))
      }
      toast.success(isRtl ? 'تم حذف خط الحفر' : 'Drive line deleted')
      setDeleteTarget(null)
      fetchData()
    } catch (e: any) {
      toast.error(e?.message || (isRtl ? 'فشل الحذف' : 'Delete failed'))
    } finally {
      setDeleting(false)
    }
  }

  // Group drive lines by project
  type GroupedItem = { project: any; lines: any[] }
  const grouped = driveLines.reduce((acc, line) => {
    const key = line.project?.id || 'unknown'
    if (!acc[key]) acc[key] = { project: line.project, lines: [] }
    acc[key].lines.push(line)
    return acc
  }, {} as Record<string, GroupedItem>)

  const dialogTitle = editingId
    ? (isRtl ? 'تعديل خط الحفر' : 'Edit Drive Line')
    : (isRtl ? 'خط حفر جديد' : 'New Drive Line')
  const dialogDescription = editingId
    ? (isRtl ? 'عدّل بيانات خط الحفر' : 'Edit drive line details')
    : (isRtl ? 'أدخل بيانات خط الحفر' : 'Enter drive line details')
  const submitLabel = editingId
    ? (isRtl ? 'حفظ التعديلات' : 'Save Changes')
    : (isRtl ? 'إنشاء' : 'Create')

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">{isRtl ? 'خطوط الحفر' : 'Drive Lines'}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isRtl ? `${driveLines.length} خط حفر` : `${driveLines.length} drive lines`}
          </p>
        </div>
        {canEdit && (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4 ml-2" />
            {isRtl ? 'خط حفر جديد' : 'New Drive Line'}
          </Button>
        )}
      </div>

      <Select value={selectedProject} onValueChange={setSelectedProject}>
        <SelectTrigger className="w-full sm:w-[300px]">
          <SelectValue placeholder={isRtl ? 'اختر المشروع' : 'Select project'} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{isRtl ? 'كل المشاريع' : 'All Projects'}</SelectItem>
          {projects.map((p) => (
            <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {loading ? (
        <div className="h-32 bg-muted animate-pulse rounded" />
      ) : driveLines.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <GitBranch className="h-12 w-12 mx-auto text-muted-foreground/50" />
            <p className="mt-3 text-muted-foreground">{isRtl ? 'لا توجد خطوط حفر' : 'No drive lines'}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {(Object.values(grouped) as GroupedItem[]).map((group) => (
            <Card key={group.project?.id || 'unknown'}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <span className="font-mono text-xs text-primary">{group.project?.code || '—'}</span>
                  {group.project?.name || (isRtl ? 'مشروع غير معروف' : 'Unknown Project')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {group.lines.map((line) => {
                    const status = statusLabels[line.status] || statusLabels.not_started
                    return (
                      <div key={line.id} className="border rounded-lg p-4 space-y-3 hover:shadow-sm transition relative">
                        {/* Action buttons — top-left in RTL, top-right in LTR */}
                        {canEdit && (
                          <div className="absolute top-2 ltr:right-2 rtl:left-2 flex gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-primary"
                              onClick={() => openEdit(line)}
                              title={isRtl ? 'تعديل' : 'Edit'}
                              aria-label={isRtl ? 'تعديل' : 'Edit'}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              onClick={() => setDeleteTarget(line)}
                              title={isRtl ? 'حذف' : 'Delete'}
                              aria-label={isRtl ? 'حذف' : 'Delete'}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        )}

                        <div className="flex items-center justify-between pr-14">
                          <div className="flex items-center gap-2">
                            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                              <GitBranch className="h-4 w-4 text-primary" />
                            </div>
                            <div>
                              <p className="font-semibold text-sm">{line.lineNumber}</p>
                              <p className="text-xs text-muted-foreground">{line.diameter} • {line.pipeType}</p>
                            </div>
                          </div>
                          <Badge variant={status.color as any} className="text-xs">
                            {isRtl ? status.ar : status.en}
                          </Badge>
                        </div>

                        <div className="space-y-1.5 text-sm">
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <MapPin className="h-3.5 w-3.5" />
                            <span className="text-xs">{line.startPoint} → {line.endPoint}</span>
                          </div>
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <Ruler className="h-3.5 w-3.5" />
                            <span className="text-xs">{line.completedLength} / {line.totalLength} {isRtl ? 'م' : 'm'}</span>
                          </div>
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <Layers className="h-3.5 w-3.5" />
                            <span className="text-xs">{isRtl ? 'العمق' : 'Depth'}: {line.depth} {isRtl ? 'م' : 'm'} • {line.soilType}</span>
                          </div>
                        </div>

                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs text-muted-foreground">{isRtl ? 'الإنجاز' : 'Progress'}</span>
                            <span className="text-xs font-semibold">{(line.progress || 0).toFixed(1)}%</span>
                          </div>
                          <Progress value={line.progress || 0} className="h-1.5" />
                        </div>

                        {line.problems && (
                          <div className="flex items-start gap-1.5 text-xs text-orange-600 bg-orange-50 p-2 rounded">
                            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                            <span>{line.problems}</span>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open)
          if (!open) {
            setEditingId(null)
            setFormData(emptyForm)
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
            <DialogDescription>{dialogDescription}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>{isRtl ? 'المشروع' : 'Project'} *</Label>
              <Select
                value={formData.projectId}
                onValueChange={(v) => setFormData({ ...formData, projectId: v })}
                required
              >
                <SelectTrigger><SelectValue placeholder={isRtl ? 'اختر المشروع' : 'Select project'} /></SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{isRtl ? 'رقم الخط' : 'Line Number'} *</Label>
                <Input value={formData.lineNumber} onChange={(e) => setFormData({ ...formData, lineNumber: e.target.value })} placeholder="L-01" required />
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'الطول الكلي (م)' : 'Total Length (m)'} *</Label>
                <Input type="number" step="0.1" value={formData.totalLength} onChange={(e) => setFormData({ ...formData, totalLength: e.target.value })} required />
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'نقطة البداية' : 'Start Point'} *</Label>
                <Input value={formData.startPoint} onChange={(e) => setFormData({ ...formData, startPoint: e.target.value })} required />
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'نقطة النهاية' : 'End Point'} *</Label>
                <Input value={formData.endPoint} onChange={(e) => setFormData({ ...formData, endPoint: e.target.value })} required />
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'القطر' : 'Diameter'}</Label>
                <Select value={formData.diameter} onValueChange={(v) => setFormData({ ...formData, diameter: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['600mm', '800mm', '1000mm', '1200mm', '1500mm', '1800mm'].map(d => (
                      <SelectItem key={d} value={d}>{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'نوع الأنبوب' : 'Pipe Type'}</Label>
                <Select value={formData.pipeType} onValueChange={(v) => setFormData({ ...formData, pipeType: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pipe">{isRtl ? 'أنبوب' : 'Pipe'}</SelectItem>
                    <SelectItem value="sleeve">{isRtl ? 'سليف' : 'Sleeve'}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'نوع التربة' : 'Soil Type'}</Label>
                <Select value={formData.soilType} onValueChange={(v) => setFormData({ ...formData, soilType: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="soft">{isRtl ? 'طرية' : 'Soft'}</SelectItem>
                    <SelectItem value="hard">{isRtl ? 'صلبة' : 'Hard'}</SelectItem>
                    <SelectItem value="rocky">{isRtl ? 'صخرية' : 'Rocky'}</SelectItem>
                    <SelectItem value="mixed">{isRtl ? 'مختلطة' : 'Mixed'}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'العمق (م)' : 'Depth (m)'}</Label>
                <Input type="number" step="0.1" value={formData.depth} onChange={(e) => setFormData({ ...formData, depth: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'الحالة' : 'Status'}</Label>
                <Select value={formData.status} onValueChange={(v) => setFormData({ ...formData, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="not_started">{isRtl ? 'لم يبدأ' : 'Not Started'}</SelectItem>
                    <SelectItem value="in_progress">{isRtl ? 'جارٍ' : 'In Progress'}</SelectItem>
                    <SelectItem value="completed">{isRtl ? 'مكتمل' : 'Completed'}</SelectItem>
                    <SelectItem value="suspended">{isRtl ? 'متوقف' : 'Suspended'}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{isRtl ? 'ملاحظات / مشاكل' : 'Problems/Notes'}</Label>
              <Textarea value={formData.problems} onChange={(e) => setFormData({ ...formData, problems: e.target.value })} rows={2} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>
                {isRtl ? 'إلغاء' : 'Cancel'}
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting && <Loader2 className="h-4 w-4 ml-2 animate-spin" />}
                {submitLabel}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{isRtl ? 'تأكيد الحذف' : 'Confirm Delete'}</AlertDialogTitle>
            <AlertDialogDescription>
              {isRtl
                ? `هل أنت متأكد من حذف خط الحفر "${deleteTarget?.lineNumber || ''}"؟ سيتم حذف جميع التقارير المرتبطة به ولا يمكن التراجع عن هذا الإجراء.`
                : `Are you sure you want to delete drive line "${deleteTarget?.lineNumber || ''}"? All related daily reports will also be deleted. This action cannot be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>
              {isRtl ? 'إلغاء' : 'Cancel'}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); confirmDelete() }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting && <Loader2 className="h-4 w-4 ml-2 animate-spin" />}
              {isRtl ? 'حذف' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
