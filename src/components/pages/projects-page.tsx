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
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Plus, Search, FolderKanban, MapPin, Calendar, DollarSign, Edit, Trash2, Eye, Users } from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { authedFetch, apiRequest, getErrorMessage } from '@/lib/api-client'
import { toast } from 'sonner'

const workTypeLabels: Record<string, { ar: string; en: string }> = {
  pipe_jacking: { ar: 'Pipe Jacking', en: 'Pipe Jacking' },
  microtunneling: { ar: 'Microtunneling', en: 'Microtunneling' },
  hdd: { ar: 'HDD', en: 'HDD' },
  auger_boring: { ar: 'Auger Boring', en: 'Auger Boring' },
}

const statusLabels: Record<string, { ar: string; en: string; color: string }> = {
  not_started: { ar: 'لم يبدأ', en: 'Not Started', color: 'secondary' },
  in_progress: { ar: 'جارٍ', en: 'In Progress', color: 'default' },
  suspended: { ar: 'متوقف', en: 'Suspended', color: 'destructive' },
  completed: { ar: 'مكتمل', en: 'Completed', color: 'default' },
}

const soilTypeLabels: Record<string, { ar: string; en: string }> = {
  soft: { ar: 'طرية', en: 'Soft' },
  hard: { ar: 'صلبة', en: 'Hard' },
  rocky: { ar: 'صخرية', en: 'Rocky' },
  mixed: { ar: 'مختلطة', en: 'Mixed' },
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editProject, setEditProject] = useState<any | null>(null)
  const [viewProject, setViewProject] = useState<any | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const language = useAppStore((s) => s.language)
  const token = useAppStore((s) => s.token)
  const isRtl = language === 'ar'

  const [formData, setFormData] = useState({
    code: '', name: '', client: '', location: '', contractNumber: '',
    workType: 'pipe_jacking', pipeDiameter: '1200mm', totalLength: '',
    pricePerMeter: '', soilType: 'mixed', startDate: '', expectedEnd: '',
    status: 'not_started', notes: '',
  })

  async function fetchProjects() {
    setLoading(true)
    const res = await authedFetch('/api/projects/list' + (statusFilter !== 'all' ? `?status=${statusFilter}` : ''))
    const data = await res.json()
    setProjects(data.projects || [])
    setLoading(false)
  }

  useEffect(() => {
    if (!token) return
    fetchProjects()
  }, [statusFilter, token])

  function openCreate() {
    const today = new Date()
    const defaultEnd = new Date()
    defaultEnd.setMonth(defaultEnd.getMonth() + 6)
    setEditProject(null)
    setFormData({
      code: 'AXIS-' + Date.now().toString().slice(-6),
      name: '', client: '', location: '', contractNumber: '',
      workType: 'pipe_jacking', pipeDiameter: '1200mm', totalLength: '',
      pricePerMeter: '', soilType: 'mixed',
      startDate: today.toISOString().split('T')[0],
      expectedEnd: defaultEnd.toISOString().split('T')[0],
      status: 'not_started', notes: '',
    })
    setDialogOpen(true)
  }

  function openEdit(p: any) {
    setEditProject(p)
    setFormData({
      code: p.code, name: p.name, client: p.client, location: p.location,
      contractNumber: p.contractNumber || '', workType: p.workType,
      pipeDiameter: p.pipeDiameter, totalLength: String(p.totalLength),
      pricePerMeter: String(p.pricePerMeter), soilType: p.soilType,
      startDate: p.startDate.split('T')[0], expectedEnd: p.expectedEnd.split('T')[0],
      status: p.status, notes: p.notes || '',
    })
    setDialogOpen(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    // Validate required fields before sending
    if (!formData.code || !formData.name || !formData.client || !formData.location) {
      toast.error(isRtl ? 'يرجى ملء جميع الحقول المطلوبة' : 'Please fill all required fields')
      return
    }
    if (!formData.totalLength || !formData.pricePerMeter) {
      toast.error(isRtl ? 'يرجى إدخال الطول والسعر' : 'Please enter length and price')
      return
    }

    try {
      if (editProject) {
        const result = await apiRequest(`/api/projects/${editProject.id}`, {
          method: 'PUT',
          body: formData,
        })
        if (result.ok) {
          toast.success(isRtl ? 'تم تحديث المشروع' : 'Project updated')
          setDialogOpen(false)
          fetchProjects()
        } else {
          toast.error(getErrorMessage(result.error || '', isRtl, result.message))
        }
      } else {
        const result = await apiRequest('/api/projects', {
          method: 'POST',
          body: formData,
        })
        if (result.ok) {
          toast.success(isRtl ? 'تم إنشاء المشروع بنجاح' : 'Project created successfully')
          setDialogOpen(false)
          fetchProjects()
        } else {
          toast.error(getErrorMessage(result.error || '', isRtl, result.message))
        }
      }
    } catch (err) {
      toast.error(isRtl ? 'حدث خطأ في الاتصال: ' + String(err) : 'Connection error: ' + String(err))
    }
  }

  async function handleDelete() {
    if (!deleteId) return
    const res = await authedFetch(`/api/projects/${deleteId}`, { method: 'DELETE' })
    if (res.ok) {
      toast.success(isRtl ? 'تم الحذف' : 'Deleted')
      setDeleteId(null)
      fetchProjects()
    }
  }

  const filtered = projects.filter(p =>
    p.name.includes(search) || p.code.includes(search) || p.client.includes(search)
  )

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">{isRtl ? 'المشاريع' : 'Projects'}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isRtl ? `${projects.length} مشروع` : `${projects.length} projects`}
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 ml-2" />
          {isRtl ? 'مشروع جديد' : 'New Project'}
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={isRtl ? 'بحث عن مشروع...' : 'Search projects...'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pr-10"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder={isRtl ? 'الحالة' : 'Status'} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{isRtl ? 'الكل' : 'All'}</SelectItem>
            <SelectItem value="not_started">{isRtl ? 'لم يبدأ' : 'Not Started'}</SelectItem>
            <SelectItem value="in_progress">{isRtl ? 'جارٍ' : 'In Progress'}</SelectItem>
            <SelectItem value="suspended">{isRtl ? 'متوقف' : 'Suspended'}</SelectItem>
            <SelectItem value="completed">{isRtl ? 'مكتمل' : 'Completed'}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Projects grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <Card key={i}>
              <CardContent className="p-5">
                <div className="h-32 bg-muted animate-pulse rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FolderKanban className="h-12 w-12 mx-auto text-muted-foreground/50" />
            <p className="mt-3 text-muted-foreground">{isRtl ? 'لا توجد مشاريع' : 'No projects'}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((p) => {
            const status = statusLabels[p.status]
            const workType = workTypeLabels[p.workType]
            const soilType = soilTypeLabels[p.soilType]
            return (
              <Card key={p.id} className="hover:shadow-md transition">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono text-xs text-primary font-semibold">{p.code}</span>
                        <Badge variant={status.color as any} className="text-xs">
                          {isRtl ? status.ar : status.en}
                        </Badge>
                      </div>
                      <h3 className="font-semibold truncate" title={p.name}>{p.name}</h3>
                      <p className="text-sm text-muted-foreground truncate">{p.client}</p>
                    </div>
                  </div>

                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <MapPin className="h-4 w-4 shrink-0" />
                      <span className="truncate">{p.location}</span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Calendar className="h-4 w-4 shrink-0" />
                      <span className="text-xs">
                        {new Date(p.startDate).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US')} - {new Date(p.expectedEnd).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US')}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <DollarSign className="h-4 w-4 shrink-0" />
                      <span>{p.pricePerMeter} {isRtl ? 'ر.ع/م' : 'OMR/m'} • {p.totalLength} {isRtl ? 'م' : 'm'}</span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Users className="h-4 w-4 shrink-0" />
                      <span className="text-xs">{isRtl ? workType.ar : workType.en} • {p.pipeDiameter} • {isRtl ? soilType.ar : soilType.en}</span>
                    </div>
                  </div>

                  <div className="mt-4">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-muted-foreground">{isRtl ? 'نسبة الإنجاز' : 'Progress'}</span>
                      <span className="text-xs font-semibold">{p.progress.toFixed(1)}%</span>
                    </div>
                    <Progress value={p.progress} className="h-2" />
                  </div>

                  <div className="mt-4 flex items-center gap-1.5">
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => setViewProject(p.id)}>
                      <Eye className="h-4 w-4 ml-1" />
                      {isRtl ? 'عرض' : 'View'}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => openEdit(p)}>
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="sm" className="text-destructive" onClick={() => setDeleteId(p.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editProject ? (isRtl ? 'تعديل المشروع' : 'Edit Project') : (isRtl ? 'مشروع جديد' : 'New Project')}</DialogTitle>
            <DialogDescription>
              {isRtl ? 'أدخل بيانات المشروع الأساسية' : 'Enter project details'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{isRtl ? 'رمز المشروع' : 'Project Code'} *</Label>
                <Input value={formData.code} onChange={(e) => setFormData({ ...formData, code: e.target.value })} required />
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'اسم المشروع' : 'Project Name'} *</Label>
                <Input value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} required />
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'العميل' : 'Client'} *</Label>
                <Input value={formData.client} onChange={(e) => setFormData({ ...formData, client: e.target.value })} required />
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'الموقع' : 'Location'} *</Label>
                <Input value={formData.location} onChange={(e) => setFormData({ ...formData, location: e.target.value })} required />
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'رقم العقد' : 'Contract No.'}</Label>
                <Input value={formData.contractNumber} onChange={(e) => setFormData({ ...formData, contractNumber: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'نوع العمل' : 'Work Type'}</Label>
                <Select value={formData.workType} onValueChange={(v) => setFormData({ ...formData, workType: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pipe_jacking">Pipe Jacking</SelectItem>
                    <SelectItem value="microtunneling">Microtunneling</SelectItem>
                    <SelectItem value="hdd">HDD</SelectItem>
                    <SelectItem value="auger_boring">Auger Boring</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'قطر الأنبوب' : 'Pipe Diameter'}</Label>
                <Select value={formData.pipeDiameter} onValueChange={(v) => setFormData({ ...formData, pipeDiameter: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="600mm">600mm</SelectItem>
                    <SelectItem value="800mm">800mm</SelectItem>
                    <SelectItem value="1000mm">1000mm</SelectItem>
                    <SelectItem value="1200mm">1200mm</SelectItem>
                    <SelectItem value="1500mm">1500mm</SelectItem>
                    <SelectItem value="1800mm">1800mm</SelectItem>
                    <SelectItem value="other">{isRtl ? 'أخرى' : 'Other'}</SelectItem>
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
                <Label>{isRtl ? 'الطول الكلي (م)' : 'Total Length (m)'} *</Label>
                <Input type="number" step="0.1" value={formData.totalLength} onChange={(e) => setFormData({ ...formData, totalLength: e.target.value })} required />
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'سعر المتر (ر.ع)' : 'Price per Meter (OMR)'} *</Label>
                <Input type="number" step="0.01" value={formData.pricePerMeter} onChange={(e) => setFormData({ ...formData, pricePerMeter: e.target.value })} required />
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'تاريخ البداية' : 'Start Date'}</Label>
                <Input type="date" value={formData.startDate} onChange={(e) => setFormData({ ...formData, startDate: e.target.value })} required />
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'تاريخ الانتهاء المتوقع' : 'Expected End'}</Label>
                <Input type="date" value={formData.expectedEnd} onChange={(e) => setFormData({ ...formData, expectedEnd: e.target.value })} required />
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'الحالة' : 'Status'}</Label>
                <Select value={formData.status} onValueChange={(v) => setFormData({ ...formData, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="not_started">{isRtl ? 'لم يبدأ' : 'Not Started'}</SelectItem>
                    <SelectItem value="in_progress">{isRtl ? 'جارٍ' : 'In Progress'}</SelectItem>
                    <SelectItem value="suspended">{isRtl ? 'متوقف' : 'Suspended'}</SelectItem>
                    <SelectItem value="completed">{isRtl ? 'مكتمل' : 'Completed'}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{isRtl ? 'ملاحظات' : 'Notes'}</Label>
              <Textarea value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} rows={2} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                {isRtl ? 'إلغاء' : 'Cancel'}
              </Button>
              <Button type="submit">
                {editProject ? (isRtl ? 'تحديث' : 'Update') : (isRtl ? 'إنشاء' : 'Create')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* View Dialog */}
      <Dialog open={!!viewProject} onOpenChange={(open) => !open && setViewProject(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isRtl ? 'تفاصيل المشروع' : 'Project Details'}</DialogTitle>
          </DialogHeader>
          <ProjectDetails id={viewProject} />
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{isRtl ? 'تأكيد الحذف' : 'Confirm Delete'}</AlertDialogTitle>
            <AlertDialogDescription>
              {isRtl ? 'هل أنت متأكد من حذف هذا المشروع؟ سيتم حذف جميع البيانات المرتبطة به.' : 'Are you sure? This will delete all related data.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{isRtl ? 'إلغاء' : 'Cancel'}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
              {isRtl ? 'حذف' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function ProjectDetails({ id }: { id: string | null }) {
  const [project, setProject] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const language = useAppStore((s) => s.language)
  const token = useAppStore((s) => s.token)
  const isRtl = language === 'ar'

  useEffect(() => {
    if (!id) return
    fetch(`/api/projects/${id}`)
      .then(r => r.json())
      .then(d => setProject(d.project))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return <div className="h-40 bg-muted animate-pulse rounded" />
  if (!project) return null

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 text-sm">
        <Detail label={isRtl ? 'الرمز' : 'Code'} value={project.code} />
        <Detail label={isRtl ? 'العميل' : 'Client'} value={project.client} />
        <Detail label={isRtl ? 'الموقع' : 'Location'} value={project.location} />
        <Detail label={isRtl ? 'العقد' : 'Contract'} value={project.contractNumber || '-'} />
        <Detail label={isRtl ? 'نوع العمل' : 'Work Type'} value={project.workType} />
        <Detail label={isRtl ? 'القطر' : 'Diameter'} value={project.pipeDiameter} />
        <Detail label={isRtl ? 'الطول الكلي' : 'Total Length'} value={`${project.totalLength} م`} />
        <Detail label={isRtl ? 'سعر المتر' : 'Price/m'} value={`${project.pricePerMeter} ر.ع`} />
        <Detail label={isRtl ? 'مدير المشروع' : 'Manager'} value={project.manager?.name || '-'} />
        <Detail label={isRtl ? 'مهندس الموقع' : 'Engineer'} value={project.engineer?.name || '-'} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Stat label={isRtl ? 'الأمتار المنجزة' : 'Meters Drilled'} value={`${project.totalMetersDrilled?.toFixed(1) || 0} م`} />
        <Stat label={isRtl ? 'الإيرادات' : 'Revenue'} value={`${project.totalRevenue?.toFixed(0) || 0} ر.ع`} />
        <Stat label={isRtl ? 'التكاليف' : 'Costs'} value={`${project.totalCost?.toFixed(0) || 0} ر.ع`} />
        <Stat label={isRtl ? 'صافي الربح' : 'Net Profit'} value={`${project.netProfit?.toFixed(0) || 0} ر.ع`} />
      </div>

      {project.driveLines?.length > 0 && (
        <div>
          <h4 className="font-semibold text-sm mb-2">{isRtl ? 'خطوط الحفر' : 'Drive Lines'}</h4>
          <div className="space-y-1.5">
            {project.driveLines.map((l: any) => (
              <div key={l.id} className="flex items-center gap-2 text-sm p-2 rounded bg-muted/30">
                <Badge variant="outline">{l.lineNumber}</Badge>
                <span className="flex-1">{l.startPoint} ← {l.endPoint}</span>
                <span className="text-muted-foreground">{l.completedLength}/{l.totalLength} م</span>
                <span className="font-medium">{l.progress.toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {project.notes && (
        <div>
          <h4 className="font-semibold text-sm mb-1">{isRtl ? 'ملاحظات' : 'Notes'}</h4>
          <p className="text-sm text-muted-foreground">{project.notes}</p>
        </div>
      )}
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 rounded-lg bg-muted/50 text-center">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-bold text-sm mt-0.5">{value}</p>
    </div>
  )
}
