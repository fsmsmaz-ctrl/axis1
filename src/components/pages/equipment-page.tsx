'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Plus, Wrench, Clock, AlertTriangle, Cpu, Settings, Calendar, DollarSign } from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { authedFetch } from '@/lib/api-client'
import { toast } from 'sonner'

const statusLabels: Record<string, { ar: string; en: string; color: string }> = {
  operational: { ar: 'تعمل', en: 'Operational', color: 'default' },
  stopped: { ar: 'متوقفة', en: 'Stopped', color: 'destructive' },
  maintenance_needed: { ar: 'تحتاج صيانة', en: 'Maintenance Needed', color: 'secondary' },
}

const typeLabels: Record<string, { ar: string; en: string }> = {
  jacking_machine: { ar: 'ماكينة Jacking', en: 'Jacking Machine' },
  crane: { ar: 'رافعة', en: 'Crane' },
  excavator: { ar: 'حفار', en: 'Excavator' },
  pump: { ar: 'مضخة', en: 'Pump' },
  other: { ar: 'أخرى', en: 'Other' },
}

export default function EquipmentPage() {
  const [equipment, setEquipment] = useState<any[]>([])
  const [projects, setProjects] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedProject, setSelectedProject] = useState<string>('all')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [viewEquipment, setViewEquipment] = useState<any | null>(null)
  const [viewDialogOpen, setViewDialogOpen] = useState(false)
  const [maintenanceDialogOpen, setMaintenanceDialogOpen] = useState(false)
  const language = useAppStore((s) => s.language)
  const token = useAppStore((s) => s.token)
  const isRtl = language === 'ar'

  const [formData, setFormData] = useState({
    projectId: '', name: '', number: '', type: 'jacking_machine',
    status: 'operational', dailyHours: '8', lastMaintenance: '',
    nextMaintenance: '', notes: '',
  })

  const [maintenanceForm, setMaintenanceForm] = useState({
    equipmentId: '', date: new Date().toISOString().split('T')[0],
    type: 'routine', description: '', cost: '', partsUsed: '', setStatus: 'operational',
  })

  async function fetchEquipment() {
    setLoading(true)
    const res = await authedFetch('/api/equipment' + (selectedProject !== 'all' ? `?projectId=${selectedProject}` : ''))
    const data = await res.json()
    setEquipment(data.equipment || [])
    setLoading(false)
  }

  useEffect(() => {
    if (!token) return
    fetchEquipment()
    authedFetch('/api/projects/list').then(r => r.json()).then(d => setProjects(d.projects || []))
  }, [selectedProject, token])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      const res = await authedFetch('/api/equipment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })
      if (res.ok) {
        toast.success(isRtl ? 'تم إنشاء المعدة' : 'Equipment created')
        setDialogOpen(false)
        fetchEquipment()
      }
    } catch {
      toast.error(isRtl ? 'حدث خطأ' : 'Error')
    }
  }

  async function handleMaintenanceSubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      const res = await fetch(`/api/equipment/${maintenanceForm.equipmentId}/maintenance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(maintenanceForm),
      })
      if (res.ok) {
        toast.success(isRtl ? 'تم تسجيل الصيانة' : 'Maintenance recorded')
        setMaintenanceDialogOpen(false)
        fetchEquipment()
      }
    } catch {
      toast.error(isRtl ? 'حدث خطأ' : 'Error')
    }
  }

  function openView(eq: any) {
    setViewEquipment(eq)
    setViewDialogOpen(true)
    authedFetch(`/api/equipment/${eq.id}`).then(r => r.json()).then(d => setViewEquipment(d.equipment))
  }

  // Stats
  const operational = equipment.filter(e => e.status === 'operational').length
  const stopped = equipment.filter(e => e.status === 'stopped').length
  const needsMaintenance = equipment.filter(e => e.status === 'maintenance_needed').length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">{isRtl ? 'المعدات' : 'Equipment'}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isRtl ? 'إدارة المعدات والصيانة' : 'Equipment and maintenance management'}
          </p>
        </div>
        <Button onClick={() => {
          setFormData({
            projectId: projects[0]?.id || '', name: '', number: '', type: 'jacking_machine',
            status: 'operational', dailyHours: '8', lastMaintenance: '',
            nextMaintenance: '', notes: '',
          })
          setDialogOpen(true)
        }}>
          <Plus className="h-4 w-4 ml-2" />
          {isRtl ? 'معدة جديدة' : 'New Equipment'}
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center">
                <Wrench className="h-4 w-4 text-emerald-600" />
              </div>
              <div>
                <p className="text-xl font-bold">{operational}</p>
                <p className="text-xs text-muted-foreground">{isRtl ? 'تعمل' : 'Operational'}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-lg bg-orange-50 flex items-center justify-center">
                <Settings className="h-4 w-4 text-orange-600" />
              </div>
              <div>
                <p className="text-xl font-bold">{needsMaintenance}</p>
                <p className="text-xs text-muted-foreground">{isRtl ? 'تحتاج صيانة' : 'Maintenance'}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-lg bg-red-50 flex items-center justify-center">
                <AlertTriangle className="h-4 w-4 text-red-600" />
              </div>
              <div>
                <p className="text-xl font-bold">{stopped}</p>
                <p className="text-xs text-muted-foreground">{isRtl ? 'متوقفة' : 'Stopped'}</p>
              </div>
            </div>
          </CardContent>
        </Card>
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
      ) : equipment.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Wrench className="h-12 w-12 mx-auto text-muted-foreground/50" />
            <p className="mt-3 text-muted-foreground">{isRtl ? 'لا توجد معدات' : 'No equipment'}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {equipment.map((eq) => {
            const status = statusLabels[eq.status]
            const type = typeLabels[eq.type] || typeLabels.other
            return (
              <Card key={eq.id} className="hover:shadow-sm transition">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3 mb-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                      eq.status === 'operational' ? 'bg-emerald-50' :
                      eq.status === 'stopped' ? 'bg-red-50' : 'bg-orange-50'
                    }`}>
                      <Wrench className={`h-5 w-5 ${
                        eq.status === 'operational' ? 'text-emerald-600' :
                        eq.status === 'stopped' ? 'text-red-600' : 'text-orange-600'
                      }`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm truncate">{eq.name}</p>
                      <p className="text-xs text-muted-foreground font-mono">{eq.number}</p>
                    </div>
                    <Badge variant={status.color as any} className="text-xs shrink-0">
                      {isRtl ? status.ar : status.en}
                    </Badge>
                  </div>

                  <div className="space-y-1.5 text-sm">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Cpu className="h-3.5 w-3.5" />
                      <span className="text-xs">{isRtl ? type.ar : type.en}</span>
                    </div>
                    {eq.project && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Settings className="h-3.5 w-3.5" />
                        <span className="text-xs truncate">{eq.project.name}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" />
                      <span className="text-xs">{eq.dailyHours} {isRtl ? 'ساعة/يوم' : 'h/day'}</span>
                    </div>
                    {eq.nextMaintenance && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Calendar className="h-3.5 w-3.5" />
                        <span className="text-xs">
                          {isRtl ? 'الصيانة القادمة' : 'Next maint.'}: {new Date(eq.nextMaintenance).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US')}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-1.5 mt-3">
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => openView(eq)}>
                      {isRtl ? 'تفاصيل' : 'Details'}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setMaintenanceForm({
                          ...maintenanceForm,
                          equipmentId: eq.id,
                          setStatus: eq.status === 'maintenance_needed' ? 'operational' : 'operational',
                        })
                        setMaintenanceDialogOpen(true)
                      }}
                    >
                      <Settings className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isRtl ? 'معدة جديدة' : 'New Equipment'}</DialogTitle>
            <DialogDescription>
              {isRtl ? 'أدخل بيانات المعدة' : 'Enter equipment details'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{isRtl ? 'اسم المعدة' : 'Equipment Name'} *</Label>
                <Input value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} required />
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'رقم المعدة' : 'Number'} *</Label>
                <Input value={formData.number} onChange={(e) => setFormData({ ...formData, number: e.target.value })} required />
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'النوع' : 'Type'}</Label>
                <Select value={formData.type} onValueChange={(v) => setFormData({ ...formData, type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="jacking_machine">{isRtl ? 'ماكينة Jacking' : 'Jacking Machine'}</SelectItem>
                    <SelectItem value="crane">{isRtl ? 'رافعة' : 'Crane'}</SelectItem>
                    <SelectItem value="excavator">{isRtl ? 'حفار' : 'Excavator'}</SelectItem>
                    <SelectItem value="pump">{isRtl ? 'مضخة' : 'Pump'}</SelectItem>
                    <SelectItem value="other">{isRtl ? 'أخرى' : 'Other'}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'الحالة' : 'Status'}</Label>
                <Select value={formData.status} onValueChange={(v) => setFormData({ ...formData, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="operational">{isRtl ? 'تعمل' : 'Operational'}</SelectItem>
                    <SelectItem value="stopped">{isRtl ? 'متوقفة' : 'Stopped'}</SelectItem>
                    <SelectItem value="maintenance_needed">{isRtl ? 'تحتاج صيانة' : 'Maintenance Needed'}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'ساعات التشغيل اليومية' : 'Daily Hours'}</Label>
                <Input type="number" step="0.1" value={formData.dailyHours} onChange={(e) => setFormData({ ...formData, dailyHours: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'المشروع' : 'Project'}</Label>
                <Select value={formData.projectId} onValueChange={(v) => setFormData({ ...formData, projectId: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'آخر صيانة' : 'Last Maintenance'}</Label>
                <Input type="date" value={formData.lastMaintenance} onChange={(e) => setFormData({ ...formData, lastMaintenance: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'الصيانة القادمة' : 'Next Maintenance'}</Label>
                <Input type="date" value={formData.nextMaintenance} onChange={(e) => setFormData({ ...formData, nextMaintenance: e.target.value })} />
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
              <Button type="submit">{isRtl ? 'إنشاء' : 'Create'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* View Dialog */}
      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isRtl ? 'تفاصيل المعدة' : 'Equipment Details'}</DialogTitle>
          </DialogHeader>
          {viewEquipment && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">{isRtl ? 'الاسم' : 'Name'}</p>
                  <p className="font-medium">{viewEquipment.name}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{isRtl ? 'الرقم' : 'Number'}</p>
                  <p className="font-medium font-mono">{viewEquipment.number}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{isRtl ? 'النوع' : 'Type'}</p>
                  <p className="font-medium">{viewEquipment.type}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{isRtl ? 'الحالة' : 'Status'}</p>
                  <Badge variant={statusLabels[viewEquipment.status]?.color as any}>
                    {isRtl ? statusLabels[viewEquipment.status]?.ar : statusLabels[viewEquipment.status]?.en}
                  </Badge>
                </div>
                {viewEquipment.lastMaintenance && (
                  <div>
                    <p className="text-xs text-muted-foreground">{isRtl ? 'آخر صيانة' : 'Last Maintenance'}</p>
                    <p className="font-medium">{new Date(viewEquipment.lastMaintenance).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US')}</p>
                  </div>
                )}
                {viewEquipment.nextMaintenance && (
                  <div>
                    <p className="text-xs text-muted-foreground">{isRtl ? 'الصيانة القادمة' : 'Next Maintenance'}</p>
                    <p className="font-medium">{new Date(viewEquipment.nextMaintenance).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US')}</p>
                  </div>
                )}
              </div>

              {viewEquipment.maintenance?.length > 0 && (
                <div>
                  <h4 className="font-semibold text-sm mb-2">{isRtl ? 'سجل الصيانة' : 'Maintenance History'}</h4>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {viewEquipment.maintenance.map((m: any) => (
                      <div key={m.id} className="p-3 rounded-lg bg-muted/30 border">
                        <div className="flex items-center justify-between mb-1">
                          <Badge variant="outline" className="text-xs">{m.type}</Badge>
                          <span className="text-xs text-muted-foreground">
                            {new Date(m.date).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US')}
                          </span>
                        </div>
                        <p className="text-sm">{m.description}</p>
                        {m.partsUsed && <p className="text-xs text-muted-foreground mt-1">{isRtl ? 'قطع الغيار' : 'Parts'}: {m.partsUsed}</p>}
                        {m.cost > 0 && (
                          <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1">
                            <DollarSign className="h-3 w-3" />
                            {m.cost} {isRtl ? 'ر.ع' : 'OMR'}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Maintenance Dialog */}
      <Dialog open={maintenanceDialogOpen} onOpenChange={setMaintenanceDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{isRtl ? 'تسجيل صيانة' : 'Record Maintenance'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleMaintenanceSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{isRtl ? 'التاريخ' : 'Date'} *</Label>
                <Input type="date" value={maintenanceForm.date} onChange={(e) => setMaintenanceForm({ ...maintenanceForm, date: e.target.value })} required />
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'النوع' : 'Type'}</Label>
                <Select value={maintenanceForm.type} onValueChange={(v) => setMaintenanceForm({ ...maintenanceForm, type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="routine">{isRtl ? 'دورية' : 'Routine'}</SelectItem>
                    <SelectItem value="repair">{isRtl ? 'إصلاح' : 'Repair'}</SelectItem>
                    <SelectItem value="emergency">{isRtl ? 'طارئة' : 'Emergency'}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{isRtl ? 'الوصف' : 'Description'} *</Label>
              <Textarea value={maintenanceForm.description} onChange={(e) => setMaintenanceForm({ ...maintenanceForm, description: e.target.value })} rows={3} required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{isRtl ? 'التكلفة (ر.ع)' : 'Cost (OMR)'}</Label>
                <Input type="number" step="0.01" value={maintenanceForm.cost} onChange={(e) => setMaintenanceForm({ ...maintenanceForm, cost: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'الحالة بعد الصيانة' : 'Status After'}</Label>
                <Select value={maintenanceForm.setStatus} onValueChange={(v) => setMaintenanceForm({ ...maintenanceForm, setStatus: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="operational">{isRtl ? 'تعمل' : 'Operational'}</SelectItem>
                    <SelectItem value="stopped">{isRtl ? 'متوقفة' : 'Stopped'}</SelectItem>
                    <SelectItem value="maintenance_needed">{isRtl ? 'تحتاج صيانة' : 'Maintenance'}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{isRtl ? 'قطع الغيار المستخدمة' : 'Parts Used'}</Label>
              <Input value={maintenanceForm.partsUsed} onChange={(e) => setMaintenanceForm({ ...maintenanceForm, partsUsed: e.target.value })} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setMaintenanceDialogOpen(false)}>
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
