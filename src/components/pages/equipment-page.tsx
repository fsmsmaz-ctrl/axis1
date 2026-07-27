'use client'

import { useEffect, useState, useCallback } from 'react'
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
import {
  Plus, Wrench, Clock, AlertTriangle, Cpu, Settings, Calendar, DollarSign,
  Package, Building2, ArrowDownToLine, ArrowRightLeft, Trash2, Pencil, Eye, UserCircle
} from 'lucide-react'
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

const ownershipLabels: Record<string, { ar: string; en: string; color: string; icon: any }> = {
  owned: { ar: 'ملك الشركة', en: 'Company Owned', color: 'bg-emerald-100 text-emerald-700', icon: Building2 },
  rented: { ar: 'مستأجر', en: 'Rented', color: 'bg-amber-100 text-amber-700', icon: ArrowDownToLine },
  borrowed: { ar: 'معار', en: 'Borrowed', color: 'bg-blue-100 text-blue-700', icon: ArrowRightLeft },
}

const assetTypeLabels: Record<string, { ar: string; en: string }> = {
  machine: { ar: 'آلة/ماكينة', en: 'Machine' },
  vehicle: { ar: 'مركبة', en: 'Vehicle' },
  tool: { ar: 'أداة', en: 'Tool' },
  pipe: { ar: 'أنابيب', en: 'Pipes' },
  safety_gear: { ar: 'معدات سلامة', en: 'Safety Gear' },
  electrical: { ar: 'معدات كهربائية', en: 'Electrical' },
  other: { ar: 'أخرى', en: 'Other' },
}

const assetStatusLabels: Record<string, { ar: string; en: string; color: string }> = {
  available: { ar: 'متاح', en: 'Available', color: 'bg-emerald-50 text-emerald-700' },
  in_use: { ar: 'قيد الاستخدام', en: 'In Use', color: 'bg-blue-50 text-blue-700' },
  returned: { ar: 'تم الإرجاع', en: 'Returned', color: 'bg-gray-100 text-gray-700' },
  damaged: { ar: 'متلف', en: 'Damaged', color: 'bg-red-50 text-red-700' },
}

export default function EquipmentPage() {
  const [equipment, setEquipment] = useState<any[]>([])
  const [projects, setProjects] = useState<any[]>([])
  const [users, setUsers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedProject, setSelectedProject] = useState<string>('all')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [viewEquipment, setViewEquipment] = useState<any | null>(null)
  const [viewDialogOpen, setViewDialogOpen] = useState(false)
  const [maintenanceDialogOpen, setMaintenanceDialogOpen] = useState(false)
  const language = useAppStore((s) => s.language)
  const token = useAppStore((s) => s.token)
  const isRtl = language === 'ar'

  const [assets, setAssets] = useState<any[]>([])
  const [assetsLoading, setAssetsLoading] = useState(false)
  const [assetDialogOpen, setAssetDialogOpen] = useState(false)
  const [assetStats, setAssetStats] = useState<any>({ ownedCount: 0, rentedCount: 0, borrowedCount: 0, totalRentalCost: 0 })
  const [editingAsset, setEditingAsset] = useState<any | null>(null)
  const [assetFilter, setAssetFilter] = useState<string>('all')
  const [viewAsset, setViewAsset] = useState<any | null>(null)
  const [viewAssetDialogOpen, setViewAssetDialogOpen] = useState(false)

  const [formData, setFormData] = useState({
    projectId: '', name: '', number: '', type: 'jacking_machine',
    status: 'operational', dailyHours: '8', lastMaintenance: '',
    nextMaintenance: '', notes: '',
  })

  const [maintenanceForm, setMaintenanceForm] = useState({
    equipmentId: '', date: new Date().toISOString().split('T')[0],
    type: 'routine', description: '', cost: '', partsUsed: '', setStatus: 'operational',
  })

  const [assetForm, setAssetForm] = useState({
    projectId: '', name: '', itemType: 'machine', quantity: '1',
    ownership: 'owned', supplier: '', rentalCost: '',
    rentalStart: '', rentalEnd: '', responsibleId: '',
    status: 'available', notes: '',
  })

  async function fetchEquipment() {
    setLoading(true)
    const res = await authedFetch('/api/equipment' + (selectedProject !== 'all' ? `?projectId=${selectedProject}` : ''))
    const data = await res.json()
    setEquipment(data.equipment || [])
    setLoading(false)
  }

  const fetchAssets = useCallback(async () => {
    setAssetsLoading(true)
    const params = new URLSearchParams()
    if (selectedProject !== 'all') params.set('projectId', selectedProject)
    if (assetFilter !== 'all') params.set('ownership', assetFilter)
    const res = await authedFetch(`/api/company-assets?${params.toString()}`)
    if (res.ok) {
      const data = await res.json()
      setAssets(data.assets || [])
      setAssetStats(data.stats || { ownedCount: 0, rentedCount: 0, borrowedCount: 0, totalRentalCost: 0 })
    }
    setAssetsLoading(false)
  }, [selectedProject, assetFilter])

  useEffect(() => {
    if (!token) return
    fetchEquipment()
    authedFetch('/api/projects/list').then(r => r.json()).then(d => setProjects(d.projects || []))
    authedFetch('/api/users/list').then(r => r.json()).then(d => setUsers(d.users || []))
  }, [selectedProject, token])

  useEffect(() => {
    if (!token) return
    fetchAssets()
  }, [token, fetchAssets])

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

  async function handleAssetSubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      const url = editingAsset ? `/api/company-assets/${editingAsset.id}` : '/api/company-assets'
      const method = editingAsset ? 'PUT' : 'POST'
      const res = await authedFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(assetForm),
      })
      if (res.ok) {
        toast.success(isRtl ? (editingAsset ? 'تم التحديث' : 'تم الإضافة') : (editingAsset ? 'Updated' : 'Added'))
        setAssetDialogOpen(false)
        setEditingAsset(null)
        fetchAssets()
      }
    } catch {
      toast.error(isRtl ? 'حدث خطأ' : 'Error')
    }
  }

  async function deleteAsset(id: string) {
    if (!confirm(isRtl ? 'هل تريد حذف هذا الأصل؟' : 'Delete this asset?')) return
    const res = await authedFetch(`/api/company-assets/${id}`, { method: 'DELETE' })
    if (res.ok) {
      toast.success(isRtl ? 'تم الحذف' : 'Deleted')
      fetchAssets()
    }
  }

  function openAssetDialog(asset?: any) {
    if (asset) {
      setEditingAsset(asset)
      setAssetForm({
        projectId: asset.projectId || '', name: asset.name, itemType: asset.itemType,
        quantity: String(asset.quantity), ownership: asset.ownership,
        supplier: asset.supplier || '', rentalCost: asset.rentalCost ? String(asset.rentalCost) : '',
        rentalStart: asset.rentalStart ? asset.rentalStart.split('T')[0] : '',
        rentalEnd: asset.rentalEnd ? asset.rentalEnd.split('T')[0] : '',
        responsibleId: asset.responsibleId || '',
        status: asset.status, notes: asset.notes || '',
      })
    } else {
      setEditingAsset(null)
      setAssetForm({
        projectId: projects[0]?.id || '', name: '', itemType: 'machine', quantity: '1',
        ownership: 'owned', supplier: '', rentalCost: '',
        rentalStart: '', rentalEnd: '', responsibleId: '',
        status: 'available', notes: '',
      })
    }
    setAssetDialogOpen(true)
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
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => openAssetDialog()}>
            <Package className="h-4 w-4 ml-2" />
            {isRtl ? 'أصول ومستأجرات' : 'Assets & Rentals'}
          </Button>
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
                    <Button variant="outline" size="sm" onClick={() => {
                      setMaintenanceForm({ ...maintenanceForm, equipmentId: eq.id, setStatus: eq.status === 'maintenance_needed' ? 'operational' : 'operational' })
                      setMaintenanceDialogOpen(true)
                    }}>
                      <Settings className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* ==================== Company Assets Section ==================== */}
      <div className="pt-4 border-t mt-8">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <div className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            <h2 className="text-xl font-bold">{isRtl ? 'أصول الشركة والمستأجرات' : 'Company Assets & Rentals'}</h2>
          </div>
          <div className="flex gap-2 items-center flex-wrap">
            <div className="flex gap-1 bg-muted rounded-lg p-0.5">
              {['all', 'owned', 'rented', 'borrowed'].map((f) => (
                <Button key={f} variant={assetFilter === f ? 'default' : 'ghost'} size="sm" onClick={() => setAssetFilter(f)} className="text-xs h-7 px-2">
                  {f === 'all' ? (isRtl ? 'الكل' : 'All') : f === 'owned' ? (isRtl ? 'ملك الشركة' : 'Owned') : f === 'rented' ? (isRtl ? 'مستأجر' : 'Rented') : (isRtl ? 'معار' : 'Borrowed')}
                </Button>
              ))}
            </div>
            <Button size="sm" onClick={() => openAssetDialog()}>
              <Plus className="h-4 w-4 ml-1" />
              {isRtl ? 'إضافة' : 'Add'}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <Card className="cursor-pointer" onClick={() => setAssetFilter(assetFilter === 'owned' ? 'all' : 'owned')}>
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center"><Building2 className="h-4 w-4 text-emerald-600" /></div>
                <div><p className="text-lg font-bold">{assetStats.ownedCount}</p><p className="text-xs text-muted-foreground">{isRtl ? 'ملك الشركة' : 'Owned'}</p></div>
              </div>
            </CardContent>
          </Card>
          <Card className="cursor-pointer" onClick={() => setAssetFilter(assetFilter === 'rented' ? 'all' : 'rented')}>
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center"><ArrowDownToLine className="h-4 w-4 text-amber-600" /></div>
                <div><p className="text-lg font-bold">{assetStats.rentedCount}</p><p className="text-xs text-muted-foreground">{isRtl ? 'مستأجر' : 'Rented'}</p></div>
              </div>
            </CardContent>
          </Card>
          <Card className="cursor-pointer" onClick={() => setAssetFilter(assetFilter === 'borrowed' ? 'all' : 'borrowed')}>
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center"><ArrowRightLeft className="h-4 w-4 text-blue-600" /></div>
                <div><p className="text-lg font-bold">{assetStats.borrowedCount}</p><p className="text-xs text-muted-foreground">{isRtl ? 'معار' : 'Borrowed'}</p></div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-orange-50 flex items-center justify-center"><DollarSign className="h-4 w-4 text-orange-600" /></div>
                <div><p className="text-lg font-bold">{assetStats.totalRentalCost.toFixed(0)}</p><p className="text-xs text-muted-foreground">{isRtl ? 'إجمالي الإيجار/شهر' : 'Rental/Month'}</p></div>
              </div>
            </CardContent>
          </Card>
        </div>

        {assetsLoading ? (
          <div className="h-24 bg-muted animate-pulse rounded" />
        ) : assets.length === 0 ? (
          <Card><CardContent className="py-10 text-center"><Package className="h-10 w-10 mx-auto text-muted-foreground/50" /><p className="mt-2 text-muted-foreground">{isRtl ? 'لا توجد أصول' : 'No assets'}</p></CardContent></Card>
        ) : (
          <div className="space-y-2">
            {assets.map((a: any) => {
              const own = ownershipLabels[a.ownership] || ownershipLabels.owned
              const OwnIcon = own.icon
              const aType = assetTypeLabels[a.itemType] || assetTypeLabels.other
              const aStatus = assetStatusLabels[a.status] || assetStatusLabels.available
              return (
                <Card key={a.id} className="hover:shadow-sm transition">
                  <CardContent className="p-3">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${own.color.split(' ')[0]}`}>
                        <OwnIcon className={`h-5 w-5 ${own.color.split(' ')[1]}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm">{a.name}</span>
                          <Badge variant="outline" className={`text-xs ${own.color} border-0`}>{isRtl ? own.ar : own.en}</Badge>
                          <Badge variant="secondary" className="text-xs">{isRtl ? aType.ar : aType.en}</Badge>
                          <Badge className={`text-xs ${aStatus.color} border-0`}>{isRtl ? aStatus.ar : aStatus.en}</Badge>
                          <span className="text-xs text-muted-foreground">x{a.quantity}</span>
                        </div>
                        <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground flex-wrap">
                          {a.project && <span>{a.project.name}</span>}
                          {a.responsible && <span className="flex items-center gap-1"><UserCircle className="h-3 w-3" />{a.responsible.name}</span>}
                          {a.ownership === 'rented' && a.rentalCost > 0 && <span className="text-orange-600 font-medium">{a.rentalCost} {isRtl ? 'ر.ع/شهر' : 'OMR/mo'}</span>}
                          {a.ownership === 'borrowed' && a.rentalEnd && <span>{isRtl ? 'إرجاع' : 'Return'}: {new Date(a.rentalEnd).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US')}</span>}
                          {a.supplier && <span>{isRtl ? 'الجهة' : 'From'}: {a.supplier}</span>}
                        </div>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button variant="ghost" size="sm" onClick={() => openAssetDialog(a)}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="sm" onClick={() => deleteAsset(a.id)}><Trash2 className="h-3.5 w-3.5 text-red-500" /></Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </div>

      {/* ==================== Dialogs ==================== */}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isRtl ? 'معدة جديدة' : 'New Equipment'}</DialogTitle>
            <DialogDescription>{isRtl ? 'أدخل بيانات المعدة' : 'Enter equipment details'}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>{isRtl ? 'اسم المعدة' : 'Equipment Name'} *</Label><Input value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} required /></div>
              <div className="space-y-1.5"><Label>{isRtl ? 'رقم المعدة' : 'Number'} *</Label><Input value={formData.number} onChange={(e) => setFormData({ ...formData, number: e.target.value })} required /></div>
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
              <div className="space-y-1.5"><Label>{isRtl ? 'ساعات التشغيل اليومية' : 'Daily Hours'}</Label><Input type="number" step="0.1" value={formData.dailyHours} onChange={(e) => setFormData({ ...formData, dailyHours: e.target.value })} /></div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'المشروع' : 'Project'}</Label>
                <Select value={formData.projectId} onValueChange={(v) => setFormData({ ...formData, projectId: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{projects.map((p) => (<SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>))}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label>{isRtl ? 'آخر صيانة' : 'Last Maintenance'}</Label><Input type="date" value={formData.lastMaintenance} onChange={(e) => setFormData({ ...formData, lastMaintenance: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>{isRtl ? 'الصيانة القادمة' : 'Next Maintenance'}</Label><Input type="date" value={formData.nextMaintenance} onChange={(e) => setFormData({ ...formData, nextMaintenance: e.target.value })} /></div>
            </div>
            <div className="space-y-1.5"><Label>{isRtl ? 'ملاحظات' : 'Notes'}</Label><Textarea value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} rows={2} /></div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>{isRtl ? 'إلغاء' : 'Cancel'}</Button>
              <Button type="submit">{isRtl ? 'إنشاء' : 'Create'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={assetDialogOpen} onOpenChange={(v) => { setAssetDialogOpen(v); if (!v) setEditingAsset(null) }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingAsset ? (isRtl ? 'تعديل أصل/مستأجر' : 'Edit Asset') : (isRtl ? 'إضافة أصل/مستأجر جديد' : 'Add New Asset')}</DialogTitle>
            <DialogDescription>{isRtl ? 'تحديد نوع الملكية وتفاصيل الغرض' : 'Specify ownership type and item details'}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAssetSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-base font-semibold">{isRtl ? 'نوع الملكية *' : 'Ownership Type *'}</Label>
              <div className="grid grid-cols-3 gap-2">
                {(['owned', 'rented', 'borrowed'] as const).map((o) => {
                  const own = ownershipLabels[o]
                  const OwnIcon = own.icon
                  return (
                    <button key={o} type="button" onClick={() => setAssetForm({ ...assetForm, ownership: o })} className={`p-3 rounded-lg border-2 text-center transition cursor-pointer ${assetForm.ownership === o ? 'border-primary bg-primary/5' : 'border-muted hover:border-muted-foreground/30'}`}>
                      <OwnIcon className={`h-6 w-6 mx-auto mb-1 ${own.color.split(' ')[1]}`} />
                      <p className={`text-sm font-medium ${assetForm.ownership === o ? 'text-primary' : ''}`}>{isRtl ? own.ar : own.en}</p>
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>{isRtl ? 'اسم الغرض *' : 'Item Name *'}</Label><Input value={assetForm.name} onChange={(e) => setAssetForm({ ...assetForm, name: e.target.value })} required /></div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'النوع *' : 'Type *'}</Label>
                <Select value={assetForm.itemType} onValueChange={(v) => setAssetForm({ ...assetForm, itemType: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="machine">{isRtl ? 'آلة/ماكينة' : 'Machine'}</SelectItem>
                    <SelectItem value="vehicle">{isRtl ? 'مركبة' : 'Vehicle'}</SelectItem>
                    <SelectItem value="tool">{isRtl ? 'أداة' : 'Tool'}</SelectItem>
                    <SelectItem value="pipe">{isRtl ? 'أنابيب' : 'Pipes'}</SelectItem>
                    <SelectItem value="safety_gear">{isRtl ? 'معدات سلامة' : 'Safety Gear'}</SelectItem>
                    <SelectItem value="electrical">{isRtl ? 'معدات كهربائية' : 'Electrical'}</SelectItem>
                    <SelectItem value="other">{isRtl ? 'أخرى' : 'Other'}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label>{isRtl ? 'الكمية' : 'Quantity'}</Label><Input type="number" min="1" value={assetForm.quantity} onChange={(e) => setAssetForm({ ...assetForm, quantity: e.target.value })} /></div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'الحالة' : 'Status'}</Label>
                <Select value={assetForm.status} onValueChange={(v) => setAssetForm({ ...assetForm, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="available">{isRtl ? 'متاح' : 'Available'}</SelectItem>
                    <SelectItem value="in_use">{isRtl ? 'قيد الاستخدام' : 'In Use'}</SelectItem>
                    <SelectItem value="returned">{isRtl ? 'تم الإرجاع' : 'Returned'}</SelectItem>
                    <SelectItem value="damaged">{isRtl ? 'متلف' : 'Damaged'}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'المشروع' : 'Project'}</Label>
                <Select value={assetForm.projectId} onValueChange={(v) => setAssetForm({ ...assetForm, projectId: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">{isRtl ? 'بدون مشروع' : 'No project'}</SelectItem>
                    {projects.map((p) => (<SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'المسؤول' : 'Responsible'}</Label>
                <Select value={assetForm.responsibleId} onValueChange={(v) => setAssetForm({ ...assetForm, responsibleId: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">{isRtl ? 'غير محدد' : 'Not assigned'}</SelectItem>
                    {users.map((u) => (<SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {(assetForm.ownership === 'rented' || assetForm.ownership === 'borrowed') && (
              <div className={`p-3 rounded-lg border-2 border-dashed ${assetForm.ownership === 'rented' ? 'border-amber-300 bg-amber-50/50' : 'border-blue-300 bg-blue-50/50'}`}>
                <p className="text-sm font-medium mb-2">{assetForm.ownership === 'rented' ? (isRtl ? 'تفاصيل الإيجار' : 'Rental Details') : (isRtl ? 'تفاصيل الإعارة' : 'Borrow Details')}</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5"><Label>{isRtl ? 'الجهة المانحة/المؤجرة' : 'Supplier/Lender'}</Label><Input value={assetForm.supplier} onChange={(e) => setAssetForm({ ...assetForm, supplier: e.target.value })} /></div>
                  {assetForm.ownership === 'rented' && (
                    <div className="space-y-1.5"><Label>{isRtl ? 'تكلفة الإيجار الشهري (ر.ع)' : 'Monthly Rent (OMR)'}</Label><Input type="number" step="0.01" value={assetForm.rentalCost} onChange={(e) => setAssetForm({ ...assetForm, rentalCost: e.target.value })} /></div>
                  )}
                  <div className="space-y-1.5"><Label>{isRtl ? 'بداية الإيجار/الإعارة' : 'Start Date'}</Label><Input type="date" value={assetForm.rentalStart} onChange={(e) => setAssetForm({ ...assetForm, rentalStart: e.target.value })} /></div>
                  <div className="space-y-1.5"><Label>{isRtl ? (assetForm.ownership === 'rented' ? 'نهاية الإيجار' : 'تاريخ الإرجاع المتوقع') : (assetForm.ownership === 'rented' ? 'End Date' : 'Expected Return Date')}</Label><Input type="date" value={assetForm.rentalEnd} onChange={(e) => setAssetForm({ ...assetForm, rentalEnd: e.target.value })} /></div>
                </div>
              </div>
            )}
            <div className="space-y-1.5"><Label>{isRtl ? 'ملاحظات' : 'Notes'}</Label><Textarea value={assetForm.notes} onChange={(e) => setAssetForm({ ...assetForm, notes: e.target.value })} rows={2} /></div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { setAssetDialogOpen(false); setEditingAsset(null) }}>{isRtl ? 'إلغاء' : 'Cancel'}</Button>
              <Button type="submit">{editingAsset ? (isRtl ? 'تحديث' : 'Update') : (isRtl ? 'إضافة' : 'Add')}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{isRtl ? 'تفاصيل المعدة' : 'Equipment Details'}</DialogTitle></DialogHeader>
          {viewEquipment && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><p className="text-xs text-muted-foreground">{isRtl ? 'الاسم' : 'Name'}</p><p className="font-medium">{viewEquipment.name}</p></div>
                <div><p className="text-xs text-muted-foreground">{isRtl ? 'الرقم' : 'Number'}</p><p className="font-medium font-mono">{viewEquipment.number}</p></div>
                <div><p className="text-xs text-muted-foreground">{isRtl ? 'النوع' : 'Type'}</p><p className="font-medium">{viewEquipment.type}</p></div>
                <div><p className="text-xs text-muted-foreground">{isRtl ? 'الحالة' : 'Status'}</p><Badge variant={statusLabels[viewEquipment.status]?.color as any}>{isRtl ? statusLabels[viewEquipment.status]?.ar : statusLabels[viewEquipment.status]?.en}</Badge></div>
                {viewEquipment.lastMaintenance && (<div><p className="text-xs text-muted-foreground">{isRtl ? 'آخر صيانة' : 'Last Maintenance'}</p><p className="font-medium">{new Date(viewEquipment.lastMaintenance).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US')}</p></div>)}
                {viewEquipment.nextMaintenance && (<div><p className="text-xs text-muted-foreground">{isRtl ? 'الصيانة القادمة' : 'Next Maintenance'}</p><p className="font-medium">{new Date(viewEquipment.nextMaintenance).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US')}</p></div>)}
              </div>
              {viewEquipment.maintenance?.length > 0 && (
                <div>
                  <h4 className="font-semibold text-sm mb-2">{isRtl ? 'سجل الصيانة' : 'Maintenance History'}</h4>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {viewEquipment.maintenance.map((m: any) => (
                      <div key={m.id} className="p-3 rounded-lg bg-muted/30 border">
                        <div className="flex items-center justify-between mb-1"><Badge variant="outline" className="text-xs">{m.type}</Badge><span className="text-xs text-muted-foreground">{new Date(m.date).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US')}</span></div>
                        <p className="text-sm">{m.description}</p>
                        {m.partsUsed && <p className="text-xs text-muted-foreground mt-1">{isRtl ? 'قطع الغيار' : 'Parts'}: {m.partsUsed}</p>}
                        {m.cost > 0 && (<p className="text-xs text-emerald-600 mt-1 flex items-center gap-1"><DollarSign className="h-3 w-3" />{m.cost} {isRtl ? 'ر.ع' : 'OMR'}</p>)}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={maintenanceDialogOpen} onOpenChange={setMaintenanceDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{isRtl ? 'تسجيل صيانة' : 'Record Maintenance'}</DialogTitle></DialogHeader>
          <form onSubmit={handleMaintenanceSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>{isRtl ? 'التاريخ' : 'Date'} *</Label><Input type="date" value={maintenanceForm.date} onChange={(e) => setMaintenanceForm({ ...maintenanceForm, date: e.target.value })} required /></div>
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
            <div className="space-y-1.5"><Label>{isRtl ? 'الوصف' : 'Description'} *</Label><Textarea value={maintenanceForm.description} onChange={(e) => setMaintenanceForm({ ...maintenanceForm, description: e.target.value })} rows={3} required /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>{isRtl ? 'التكلفة (ر.ع)' : 'Cost (OMR)'}</Label><Input type="number" step="0.01" value={maintenanceForm.cost} onChange={(e) => setMaintenanceForm({ ...maintenanceForm, cost: e.target.value })} /></div>
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
            <div className="space-y-1.5"><Label>{isRtl ? 'قطع الغيار المستخدمة' : 'Parts Used'}</Label><Input value={maintenanceForm.partsUsed} onChange={(e) => setMaintenanceForm({ ...maintenanceForm, partsUsed: e.target.value })} /></div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setMaintenanceDialogOpen(false)}>{isRtl ? 'إلغاء' : 'Cancel'}</Button>
              <Button type="submit">{isRtl ? 'حفظ' : 'Save'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
