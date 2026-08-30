'use client'

import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle
} from '@/components/ui/dialog'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, Legend
} from 'recharts'
import { Plus, DollarSign, TrendingUp, TrendingDown, Wallet, BarChart3, Pencil, Trash2, AlertCircle, X } from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { authedFetch } from '@/lib/api-client'
import { toast } from 'sonner'

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

const categoryColors: Record<string, string> = {
  labor: '#f97316',
  fuel: '#06b6d4',
  maintenance: '#8b5cf6',
  transport: '#10b981',
  housing: '#f59e0b',
  parts: '#ec4899',
  oil: '#6366f1',
  safety: '#ef4444',
  rental: '#14b8a6',
  other: '#64748b',
}

export default function CostsPage() {
  const [costs, setCosts] = useState<any[]>([])
  const [byCategory, setByCategory] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [projects, setProjects] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedProject, setSelectedProject] = useState<string>('all')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingCostId, setEditingCostId] = useState<string | null>(null)
  const language = useAppStore((s) => s.language)
  const isRtl = language === 'ar'

  // Visible debug state - shows API errors on screen
  const [apiError, setApiError] = useState<string | null>(null)

  // Revenue data
  const [revenue, setRevenue] = useState(0)
  const [projectReports, setProjectReports] = useState<any[]>([])

  const [formData, setFormData] = useState({
    projectId: '', date: new Date().toISOString().split('T')[0],
    category: 'labor', description: '', amount: '', notes: '',
  })

  const fetchCosts = useCallback(async function() {
    setLoading(true)
    setApiError(null)
    try {
      const url = '/api/costs' + (selectedProject !== 'all' ? `?projectId=${selectedProject}` : '')
      const res = await authedFetch(url)
      
      if (!res.ok) {
        const errData = await res.json().catch(function() { return {} })
        const errMsg = `API ${res.status}: ${errData?.error || ''} - ${errData?.message || ''}`
        console.error('Costs API error:', res.status, errData)
        setApiError(errMsg)
        toast.error(isRtl ? 'فشل جلب التكاليف' : 'Failed to fetch costs')
        setLoading(false)
        return
      }
      
      const data = await res.json()
      console.log('Costs API response:', data)
      setCosts(data.costs || [])
      setByCategory(data.byCategory || [])
      setTotal(data.total || 0)

      // Get revenue from reports
      const repParams = new URLSearchParams()
      if (selectedProject !== 'all') repParams.set('projectId', selectedProject)
      repParams.set('limit', '500')
      const repRes = await authedFetch('/api/daily-reports?' + repParams.toString())
      if (repRes.ok) {
        const repData = await repRes.json()
        const reports = (repData.reports || []).filter(function(r: any) { return r.status === 'approved' })
        const totalRev = reports.reduce(function(s: number, r: any) { return s + r.dailyRevenue }, 0)
        setRevenue(totalRev)
        setProjectReports(reports)
      }
    } catch (err) {
      console.error('fetchCosts error:', err)
      setApiError(String(err))
      toast.error(isRtl ? 'خطأ في الاتصال' : 'Connection error')
    }
    setLoading(false)
  }, [selectedProject, isRtl])

  // REMOVED: if (!user) return  -- auth is handled by httpOnly cookie via authedFetch
  // The AppShell already guards that user exists before rendering this page
  useEffect(function() {
    fetchCosts()
    authedFetch('/api/projects/list').then(function(r) { return r.json() }).then(function(d) {
      setProjects((d.projects || []).filter(function(p: any) { return p.showInCosts !== false }))
    }).catch(function() {})
  }, [fetchCosts])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      const url = editingCostId ? `/api/costs/${editingCostId}` : '/api/costs'
      const method = editingCostId ? 'PUT' : 'POST'
      const res = await authedFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })
      if (res.ok) {
        toast.success(editingCostId ? (isRtl ? 'تم تحديث التكلفة' : 'Cost updated') : (isRtl ? 'تم إضافة التكلفة' : 'Cost added'))
        setDialogOpen(false)
        setEditingCostId(null)
        setFormData({
          projectId: projects[0]?.id || '', date: new Date().toISOString().split('T')[0],
          category: 'labor', description: '', amount: '', notes: '',
        })
        fetchCosts()
      }
    } catch {
      toast.error(isRtl ? 'حدث خطأ' : 'Error')
    }
  }

  async function deleteCost(id: string) {
    if (!confirm(isRtl ? 'هل أنت متأكد من حذف هذه التكلفة؟' : 'Are you sure you want to delete this cost?')) return
    try {
      const res = await authedFetch(`/api/costs/${id}`, { method: 'DELETE' })
      if (res.ok) {
        toast.success(isRtl ? 'تم حذف التكلفة' : 'Cost deleted')
        fetchCosts()
      }
    } catch {
      toast.error(isRtl ? 'حدث خطأ' : 'Error')
    }
  }

  const netProfit = revenue - total
  const profitMargin = revenue > 0 ? (netProfit / revenue) * 100 : 0
  const totalMeters = projectReports.reduce(function(s, r) { return s + r.dailyMeters }, 0)
  const costPerMeter = totalMeters > 0 ? total / totalMeters : 0

  // Chart data
  const pieData = byCategory.map(function(c) {
    return {
      name: isRtl ? categoryLabels[c.category]?.ar : categoryLabels[c.category]?.en || c.category,
      value: c.amount,
      color: categoryColors[c.category] || '#94a3b8',
    }
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">{isRtl ? 'التكاليف والإيرادات' : 'Costs & Revenue'}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isRtl ? 'متابعة التكاليف والإيرادات وحساب الأرباح' : 'Track costs, revenue, and profit'}
          </p>
        </div>
        <Button onClick={function() {
          setEditingCostId(null)
          setFormData({
            projectId: projects[0]?.id || '', date: new Date().toISOString().split('T')[0],
            category: 'labor', description: '', amount: '', notes: '',
          })
          setDialogOpen(true)
        }}>
          <Plus className="h-4 w-4 ml-2" />
          {isRtl ? 'إضافة تكلفة' : 'Add Cost'}
        </Button>
      </div>

      {/* Visible API Error Banner - shows on screen instead of hidden in console */}
      {apiError && (
        <div className="border border-red-300 bg-red-50 dark:bg-red-950/30 rounded-lg p-3 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-red-700 dark:text-red-400">{isRtl ? 'خطأ في جلب التكاليف' : 'Costs API Error'}</p>
            <p className="text-xs text-red-600 dark:text-red-400 mt-1 font-mono break-all" dir="ltr">{apiError}</p>
            <p className="text-xs text-red-500 dark:text-red-400 mt-1">{isRtl ? 'صوّر هذه الرسالة وأرسلها للمطور' : 'Screenshot this and send to developer'}</p>
          </div>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0" onClick={function() { setApiError(null) }}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="bg-gradient-to-br from-emerald-50 to-emerald-50/30 border-emerald-200">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="h-4 w-4 text-emerald-600" />
              <span className="text-xs text-muted-foreground">{isRtl ? 'الإيرادات' : 'Revenue'}</span>
            </div>
            <p className="text-xl font-bold text-emerald-700">
              {revenue.toLocaleString(isRtl ? 'ar-EG' : 'en-US', { maximumFractionDigits: 0 })}
              <span className="text-sm font-normal mr-1">{isRtl ? 'ر.ع' : 'OMR'}</span>
            </p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-red-50 to-red-50/30 border-red-200">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingDown className="h-4 w-4 text-red-600" />
              <span className="text-xs text-muted-foreground">{isRtl ? 'التكاليف' : 'Costs'}</span>
            </div>
            <p className="text-xl font-bold text-red-700">
              {total.toLocaleString(isRtl ? 'ar-EG' : 'en-US', { maximumFractionDigits: 0 })}
              <span className="text-sm font-normal mr-1">{isRtl ? 'ر.ع' : 'OMR'}</span>
            </p>
          </CardContent>
        </Card>
        <Card className={netProfit >= 0 ? 'bg-gradient-to-br from-blue-50 to-blue-50/30 border-blue-200' : 'bg-gradient-to-br from-red-50 to-red-50/30 border-red-200'}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Wallet className="h-4 w-4 text-blue-600" />
              <span className="text-xs text-muted-foreground">{isRtl ? 'صافي الربح' : 'Net Profit'}</span>
            </div>
            <p className={`text-xl font-bold ${netProfit >= 0 ? 'text-blue-700' : 'text-red-700'}`}>
              {netProfit.toLocaleString(isRtl ? 'ar-EG' : 'en-US', { maximumFractionDigits: 0 })}
              <span className="text-sm font-normal mr-1">{isRtl ? 'ر.ع' : 'OMR'}</span>
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="h-4 w-4 text-purple-600" />
              <span className="text-xs text-muted-foreground">{isRtl ? 'هامش الربح' : 'Profit Margin'}</span>
            </div>
            <p className={`text-xl font-bold ${profitMargin >= 0 ? 'text-purple-700' : 'text-red-700'}`}>
              {profitMargin.toFixed(1)}%
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {isRtl ? 'تكلفة المتر' : 'Cost/m'}: {costPerMeter.toFixed(1)} {isRtl ? 'ر.ع' : 'OMR'}
            </p>
          </CardContent>
        </Card>
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

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" />
              {isRtl ? 'التكاليف حسب الفئة' : 'Costs by Category'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {pieData.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
                {isRtl ? 'لا توجد بيانات' : 'No data'}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    cx="50%"
                    cy="50%"
                    outerRadius={90}
                    label={function(entry: any) { return entry.value.toFixed(0) }}
                  >
                    {pieData.map(function(entry, idx) {
                      return <Cell key={idx} fill={entry.color} />
                    })}
                  </Pie>
                  <Tooltip
                    contentStyle={{ direction: isRtl ? 'rtl' : 'ltr', borderRadius: 8, fontSize: 12 }}
                    formatter={function(value: any) { return [value.toLocaleString() + ' ر.ع', ''] }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{isRtl ? 'أعلى التكاليف' : 'Top Categories'}</CardTitle>
          </CardHeader>
          <CardContent>
            {pieData.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
                {isRtl ? 'لا توجد بيانات' : 'No data'}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={pieData} layout="vertical" margin={{ left: 20, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis type="number" tick={{ fontSize: 11 }} reversed={isRtl} />
                  <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={80} orientation={isRtl ? 'right' : 'left'} />
                  <Tooltip
                    contentStyle={{ direction: isRtl ? 'rtl' : 'ltr', borderRadius: 8, fontSize: 12 }}
                    formatter={function(value: any) { return [value.toLocaleString() + ' ر.ع', isRtl ? 'المبلغ' : 'Amount'] }}
                  />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                    {pieData.map(function(entry, idx) {
                      return <Cell key={idx} fill={entry.color} />
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Costs list */}
      <Card>
        <CardHeader>
          <CardTitle>{isRtl ? 'آخر التكاليف المسجلة' : 'Recent Costs'}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="h-32 bg-muted animate-pulse rounded" />
          ) : costs.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm">
              {isRtl ? 'لا توجد تكاليف' : 'No costs'}
            </div>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {costs.map(function(c) {
                return (
                  <div key={c.id} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-muted/50 transition group">
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                      style={{ backgroundColor: (categoryColors[c.category] || '#94a3b8') + '20' }}
                    >
                      <DollarSign className="h-4 w-4" style={{ color: categoryColors[c.category] || '#94a3b8' }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{c.description}</p>
                      <p className="text-xs text-muted-foreground">
                        {isRtl ? categoryLabels[c.category]?.ar : categoryLabels[c.category]?.en || c.category}
                        {' \u2022 '}
                        {new Date(c.date).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US')}
                        {c.project && ' \u2022 ' + c.project.name}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <p className="font-semibold text-sm text-red-600">
                        {c.amount.toLocaleString()} {isRtl ? 'ر.ع' : 'OMR'}
                      </p>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-blue-600 hover:text-blue-700 hover:bg-blue-50" onClick={function() {
                          setEditingCostId(c.id)
                          setFormData({
                            projectId: c.projectId || '',
                            date: new Date(c.date).toISOString().split('T')[0],
                            category: c.category,
                            description: c.description,
                            amount: String(c.amount),
                            notes: c.notes || '',
                          })
                          setDialogOpen(true)
                        }}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-500 hover:text-red-600 hover:bg-red-50" onClick={function() { deleteCost(c.id) }}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingCostId ? (isRtl ? 'تعديل التكلفة' : 'Edit Cost') : (isRtl ? 'إضافة تكلفة' : 'Add Cost')}</DialogTitle>
            <DialogDescription>
              {editingCostId ? (isRtl ? 'عدّل بيانات التكلفة' : 'Edit cost details') : (isRtl ? 'سجل تكلفة جديدة' : 'Record a new cost')}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{isRtl ? 'المشروع' : 'Project'} *</Label>
                <Select value={formData.projectId} onValueChange={function(v) { setFormData({ ...formData, projectId: v }) }} required>
                  <SelectTrigger><SelectValue placeholder={isRtl ? 'اختر' : 'Select'} /></SelectTrigger>
                  <SelectContent>
                    {projects.map(function(p) {
                      return <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    })}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'التاريخ' : 'Date'} *</Label>
                <Input type="date" value={formData.date} onChange={function(e) { setFormData({ ...formData, date: e.target.value }) }} required />
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'الفئة' : 'Category'} *</Label>
                <Select value={formData.category} onValueChange={function(v) { setFormData({ ...formData, category: v }) }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(categoryLabels).map(function([key, val]) {
                      return <SelectItem key={key} value={key}>{isRtl ? val.ar : val.en}</SelectItem>
                    })}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'المبلغ (ر.ع)' : 'Amount (OMR)'} *</Label>
                <Input type="number" step="0.01" value={formData.amount} onChange={function(e) { setFormData({ ...formData, amount: e.target.value }) }} required />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{isRtl ? 'الوصف' : 'Description'} *</Label>
              <Input value={formData.description} onChange={function(e) { setFormData({ ...formData, description: e.target.value }) }} required />
            </div>
            <div className="space-y-1.5">
              <Label>{isRtl ? 'ملاحظات' : 'Notes'}</Label>
              <Textarea value={formData.notes} onChange={function(e) { setFormData({ ...formData, notes: e.target.value }) }} rows={2} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={function() { setDialogOpen(false) }}>
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
