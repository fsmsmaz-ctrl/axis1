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
import { Plus, GitBranch, MapPin, Ruler, Layers, AlertCircle, Pencil, Trash2 } from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { authedFetch } from '@/lib/api-client'
import { toast } from 'sonner'

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
  const [saving, setSaving] = useState(false)
  const language = useAppStore((s) => s.language)
  const user = useAppStore((s) => s.user)
  const isRtl = language === 'ar'

  const [formData, setFormData] = useState({ ...emptyForm })

  async function fetchDriveLines() {
    setLoading(true)
    try {
      var res = await authedFetch('/api/drive-lines' + (selectedProject !== 'all' ? '?projectId=' + selectedProject : ''))
      var data = await res.json()
      setDriveLines(data.driveLines || [])
    } catch {
      setDriveLines([])
    }
    setLoading(false)
  }

  async function fetchProjectList() {
    try {
      var res = await authedFetch('/api/projects/list?_t=' + Date.now(), { cache: 'no-store' })
      if (!res.ok) { setProjects([]); return }
      var data = await res.json()
      setProjects(data.projects || [])
    } catch {
      setProjects([])
    }
  }

  useEffect(() => {
    if (!user) return
    fetchDriveLines()
    fetchProjectList()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  useEffect(() => {
    if (!user) return
    fetchDriveLines()
  }, [selectedProject])

  function openCreateDialog() {
    setEditingId(null)
    setFormData({ ...emptyForm, projectId: projects[0]?.id || '' })
    setDialogOpen(true)
  }

  function openEditDialog(line: any) {
    setEditingId(line.id)
    setFormData({
      projectId: line.projectId || '',
      lineNumber: line.lineNumber || '',
      startPoint: line.startPoint || '',
      endPoint: line.endPoint || '',
      totalLength: String(line.totalLength || ''),
      diameter: line.diameter || '1200mm',
      pipeType: line.pipeType || 'pipe',
      soilType: line.soilType || 'mixed',
      depth: String(line.depth || ''),
      status: line.status || 'not_started',
      problems: line.problems || '',
    })
    setDialogOpen(true)
  }

  async function handleDelete(line: any) {
    var msg = isRtl
      ? 'هل أنت متأكد من حذف خط الحفر ' + line.lineNumber + '؟'
      : 'Delete drive line ' + line.lineNumber + '?'
    if (!confirm(msg)) return
    try {
      var res = await authedFetch('/api/drive-lines/' + line.id, { method: 'DELETE' })
      if (res.ok) {
        toast.success(isRtl ? 'تم حذف خط الحفر' : 'Drive line deleted')
        fetchDriveLines()
      } else {
        var data = await res.json().catch(function() { return {} })
        toast.error(data.message || (isRtl ? 'فشل الحذف' : 'Delete failed'))
      }
    } catch {
      toast.error(isRtl ? 'حدث خطأ' : 'Error')
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      var isEdit = !!editingId
      var url = isEdit ? '/api/drive-lines/' + editingId : '/api/drive-lines'
      var res = await authedFetch(url, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })
      if (res.ok) {
        toast.success(isRtl ? (isEdit ? 'تم تعديل خط الحفر' : 'تم إنشاء خط الحفر') : (isEdit ? 'Drive line updated' : 'Drive line created'))
        setDialogOpen(false)
        setEditingId(null)
        setFormData({ ...emptyForm })
        fetchDriveLines()
      } else {
        var data = await res.json().catch(function() { return {} })
        toast.error(data.message || (isRtl ? 'فشلت العملية' : 'Operation failed'))
      }
    } catch {
      toast.error(isRtl ? 'حدث خطأ' : 'Error')
    } finally {
      setSaving(false)
    }
  }

  type GroupedItem = { project: any; lines: any[] }
  const grouped = driveLines.reduce((acc, line) => {
    const key = line.project?.id || 'unknown'
    if (!acc[key]) acc[key] = { project: line.project, lines: [] }
    acc[key].lines.push(line)
    return acc
  }, {} as Record<string, GroupedItem>)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">{isRtl ? 'خطوط الحفر' : 'Drive Lines'}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isRtl ? driveLines.length + ' خط حفر' : driveLines.length + ' drive lines'}
          </p>
        </div>
        {user && (
          <Button onClick={openCreateDialog}>
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
          {projects.map(function(p) {
            return <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
          })}
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
          {(Object.values(grouped) as GroupedItem[]).map(function(group) {
            return (
              <Card key={group.project?.id}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <span className="font-mono text-xs text-primary">{group.project?.code}</span>
                    {group.project?.name}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {group.lines.map(function(line) {
                      var status = statusLabels[line.status] || { ar: line.status || '-', en: line.status || '-', color: 'secondary' }
                      return (
                        <div key={line.id} className="border rounded-lg p-4 space-y-3 hover:shadow-sm transition">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                                <GitBranch className="h-4 w-4 text-primary" />
                              </div>
                              <div>
                                <p className="font-semibold text-sm">{line.lineNumber}</p>
                                <p className="text-xs text-muted-foreground">{line.diameter} {'\u2022 '} {line.pipeType}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              <Badge variant={status.color as any} className="text-xs">
                                {isRtl ? status.ar : status.en}
                              </Badge>
                            </div>
                          </div>

                          <div className="space-y-1.5 text-sm">
                            <div className="flex items-center gap-2 text-muted-foreground">
                              <MapPin className="h-3.5 w-3.5" />
                              <span className="text-xs">{line.startPoint} {'\u2192 '} {line.endPoint}</span>
                            </div>
                            <div className="flex items-center gap-2 text-muted-foreground">
                              <Ruler className="h-3.5 w-3.5" />
                              <span className="text-xs">{line.completedLength} / {line.totalLength} {isRtl ? 'م' : 'm'}</span>
                            </div>
                            <div className="flex items-center gap-2 text-muted-foreground">
                              <Layers className="h-3.5 w-3.5" />
                              <span className="text-xs">{isRtl ? 'العمق' : 'Depth'}: {line.depth} {isRtl ? 'م' : 'm'} {'\u2022 '} {line.soilType}</span>
                            </div>
                          </div>

                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs text-muted-foreground">{isRtl ? 'الإنجاز' : 'Progress'}</span>
                              <span className="text-xs font-semibold">{(line.progress || 0).toFixed(1)}%</span>
                            </div>
                            <Progress value={line.progress} className="h-1.5" />
                          </div>

                          {line.problems && (
                            <div className="flex items-start gap-1.5 text-xs text-orange-600 bg-orange-50 p-2 rounded">
                              <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                              <span>{line.problems}</span>
                            </div>
                          )}

                          {user && (
                            <div className="flex items-center gap-1 pt-1 border-t mt-1">
                              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-muted-foreground hover:text-primary flex-1" onClick={function() { openEditDialog(line) }}>
                                <Pencil className="h-3 w-3" />
                                {isRtl ? 'تعديل' : 'Edit'}
                              </Button>
                              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-muted-foreground hover:text-destructive flex-1" onClick={function() { handleDelete(line) }}>
                                <Trash2 className="h-3 w-3" />
                                {isRtl ? 'حذف' : 'Delete'}
                              </Button>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId
              ? (isRtl ? 'تعديل خط الحفر' : 'Edit Drive Line')
              : (isRtl ? 'خط حفر جديد' : 'New Drive Line')
            }</DialogTitle>
            <DialogDescription>
              {editingId
                ? (isRtl ? 'عدّل بيانات خط الحفر' : 'Update drive line details')
                : (isRtl ? 'أدخل بيانات خط الحفر' : 'Enter drive line details')
              }
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>{isRtl ? 'المشروع' : 'Project'} *</Label>
              <Select value={formData.projectId} onValueChange={function(v) { setFormData({ ...formData, projectId: v }) }} required>
                <SelectTrigger><SelectValue placeholder={isRtl ? 'اختر المشروع' : 'Select project'} /></SelectTrigger>
                <SelectContent>
                  {projects.map(function(p) {
                    return <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  })}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{isRtl ? 'رقم الخط' : 'Line Number'} *</Label>
                <Input value={formData.lineNumber} onChange={function(e) { setFormData({ ...formData, lineNumber: e.target.value }) }} placeholder="L-01" required />
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'الطول الكلي (م)' : 'Total Length (m)'} *</Label>
                <Input type="number" step="0.1" value={formData.totalLength} onChange={function(e) { setFormData({ ...formData, totalLength: e.target.value }) }} required />
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'نقطة البداية' : 'Start Point'} *</Label>
                <Input value={formData.startPoint} onChange={function(e) { setFormData({ ...formData, startPoint: e.target.value }) }} required />
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'نقطة النهاية' : 'End Point'} *</Label>
                <Input value={formData.endPoint} onChange={function(e) { setFormData({ ...formData, endPoint: e.target.value }) }} required />
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'القطر' : 'Diameter'}</Label>
                <Select value={formData.diameter} onValueChange={function(v) { setFormData({ ...formData, diameter: v }) }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['600mm', '800mm', '1000mm', '1200mm', '1500mm', '1800mm'].map(function(d) {
                      return <SelectItem key={d} value={d}>{d}</SelectItem>
                    })}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'نوع الأنبوب' : 'Pipe Type'}</Label>
                <Select value={formData.pipeType} onValueChange={function(v) { setFormData({ ...formData, pipeType: v }) }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pipe">{isRtl ? 'أنبوب' : 'Pipe'}</SelectItem>
                    <SelectItem value="sleeve">{isRtl ? 'سليف' : 'Sleeve'}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'نوع التربة' : 'Soil Type'}</Label>
                <Select value={formData.soilType} onValueChange={function(v) { setFormData({ ...formData, soilType: v }) }}>
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
                <Input type="number" step="0.1" value={formData.depth} onChange={function(e) { setFormData({ ...formData, depth: e.target.value }) }} />
              </div>
              {editingId && (
                <div className="space-y-1.5">
                  <Label>{isRtl ? 'الحالة' : 'Status'}</Label>
                  <Select value={formData.status} onValueChange={function(v) { setFormData({ ...formData, status: v }) }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="not_started">{isRtl ? 'لم يبدأ' : 'Not Started'}</SelectItem>
                      <SelectItem value="in_progress">{isRtl ? 'جارٍ' : 'In Progress'}</SelectItem>
                      <SelectItem value="completed">{isRtl ? 'مكتمل' : 'Completed'}</SelectItem>
                      <SelectItem value="suspended">{isRtl ? 'متوقف' : 'Suspended'}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>{isRtl ? 'ملاحظات / مشاكل' : 'Problems/Notes'}</Label>
              <Textarea value={formData.problems} onChange={function(e) { setFormData({ ...formData, problems: e.target.value }) }} rows={2} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={function() { setDialogOpen(false) }}>
                {isRtl ? 'إلغاء' : 'Cancel'}
              </Button>
              <Button type="submit" disabled={saving}>
                {saving
                  ? (isRtl ? 'جارٍ الحفظ...' : 'Saving...')
                  : (editingId ? (isRtl ? 'حفظ التعديلات' : 'Save Changes') : (isRtl ? 'إنشاء' : 'Create'))
                }
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
