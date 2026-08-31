'use client'

import { useEffect, useState, useMemo } from 'react'
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
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Cell
} from 'recharts'
import { Plus, DollarSign, TrendingUp, TrendingDown, Wallet, BarChart3, Search, FileText, Filter } from 'lucide-react'
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
  const [totalRentalCost, setTotalRentalCost] = useState(0)
  const [grandTotal, setGrandTotal] = useState(0)
  const [rentalAssets, setRentalAssets] = useState<any[]>([])
  const [projects, setProjects] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedProject, setSelectedProject] = useState<string>('all')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingCostId, setEditingCostId] = useState<string | null>(null)
  const language = useAppStore((s) => s.language)
  const isRtl = language === 'ar'

  const [revenue, setRevenue] = useState(0)
  const [approvedReports, setApprovedReports] = useState<any[]>([])
  // Search & filter
  const [searchQuery, setSearchQuery] = useState('')
  const [filterCategory, setFilterCategory] = useState<string>('all')

  const [formData, setFormData] = useState({
    projectId: '', date: new Date().toISOString().split('T')[0],
    category: 'labor', description: '', amount: '', notes: '',
  })

  async function fetchCosts() {
    setLoading(true)
    try {
      var costUrl = '/api/costs'
      if (selectedProject !== 'all') costUrl += '?projectId=' + selectedProject
      const res = await authedFetch(costUrl)
      const data = await res.json()
      setCosts(data.costs || [])
      setByCategory(data.byCategory || [])
      setTotal(data.total || 0)
      setTotalRentalCost(data.totalRentalCost || 0)
      setGrandTotal(data.grandTotal || 0)
      setRentalAssets(data.rentalAssets || [])

      var repParams = new URLSearchParams()
      if (selectedProject !== 'all') repParams.set('projectId', selectedProject)
      repParams.set('limit', '500')
      const repRes = await authedFetch('/api/daily-reports?' + repParams.toString())
      const repData = await repRes.json()
      var reports = (repData.reports || []).filter(function(r: any) { return r.status === 'approved' })
      var totalRev = reports.reduce(function(s: number, r: any) { return s + (r.dailyRevenue || 0) }, 0)
      setRevenue(totalRev)
      setApprovedReports(reports)
    } catch (e) {
      console.error('fetchCosts error:', e)
    }
    setLoading(false)
  }

  async function fetchProjects() {
    try {
      var res = await authedFetch('/api/projects/list?_t=' + Date.now(), { cache: 'no-store' })
      if (!res.ok) { setProjects([]); return }
      var data = await res.json()
      setProjects(data.projects || [])
    } catch {
      setProjects([])
    }
  }

  useEffect(function() {
    fetchCosts()
    fetchProjects()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(function() {
    fetchCosts()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProject])

  // Filtered costs for display
  var filteredCosts = useMemo(function() {
    return costs.filter(function(c) {
      var matchSearch = !searchQuery ||
        (c.description && c.description.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (c.notes && c.notes.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (c.project && c.project.name && c.project.name.toLowerCase().includes(searchQuery.toLowerCase()))
      var matchCat = filterCategory === 'all' || c.category === filterCategory
      return matchSearch && matchCat
    })
  }, [costs, searchQuery, filterCategory])

  var filteredTotal = useMemo(function() {
    return filteredCosts.reduce(function(s: number, c: any) { return s + c.amount }, 0)
  }, [filteredCosts])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      var url = editingCostId ? '/api/costs/' + editingCostId : '/api/costs'
      var method = editingCostId ? 'PUT' : 'POST'
      var res = await authedFetch(url, {
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
    if (!confirm(isRtl ? 'هل أنت متأكد من حذف هذه التكلفة؟' : 'Are you sure?')) return
    try {
      var res = await authedFetch('/api/costs/' + id, { method: 'DELETE' })
      if (res.ok) {
        toast.success(isRtl ? 'تم حذف التكلفة' : 'Cost deleted')
        fetchCosts()
      }
    } catch {
      toast.error(isRtl ? 'حدث خطأ' : 'Error')
    }
  }

  var netProfit = revenue - grandTotal
  var profitMargin = revenue > 0 ? (netProfit / revenue) * 100 : 0
  var totalMeters = approvedReports.reduce(function(s, r) { return s + (r.dailyMeters || 0) }, 0)
  var costPerMeter = totalMeters > 0 ? total / totalMeters : 0

  var pieData = byCategory.map(function(c) {
    return {
      name: isRtl ? (categoryLabels[c.category] ? categoryLabels[c.category].ar : c.category) : (categoryLabels[c.category] ? categoryLabels[c.category].en : c.category),
      value: c.amount,
      color: categoryColors[c.category] || '#94a3b8',
    }
  })

  return (
    <div className="space-y-5">
      {/* Page Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{isRtl ? 'التكاليف والإيرادات' : 'Costs & Revenue'}</h1>
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
        }} className="shadow-sm">
          <Plus className="h-4 w-4 ml-2" />
          {isRtl ? 'إضافة تكلفة' : 'Add Cost'}
        </Button>
      </div>

      {/* Summary Cards - Modern Design */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="border-0 shadow-sm bg-gradient-to-br from-emerald-500 to-emerald-600 text-white">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center">
                <TrendingUp className="h-4 w-4" />
              </div>
              <span className="text-xs text-white/80">{isRtl ? 'الإيرادات' : 'Revenue'}</span>
            </div>
            <p className="text-xl font-bold">
              {revenue.toLocaleString(isRtl ? 'ar-EG' : 'en-US', { maximumFractionDigits: 0 })}
              <span className="text-sm font-normal ml-1 text-white/80">{isRtl ? 'ر.ع' : 'OMR'}</span>
            </p>
            <p className="text-xs text-white/60 mt-1">
              {approvedReports.length} {isRtl ? 'تقرير معتمد' : 'approved reports'}
            </p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm bg-gradient-to-br from-rose-500 to-rose-600 text-white">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center">
                <TrendingDown className="h-4 w-4" />
              </div>
              <span className="text-xs text-white/80">{isRtl ? 'التكاليف الكلية' : 'Total Costs'}</span>
            </div>
            <p className="text-xl font-bold">
              {grandTotal.toLocaleString(isRtl ? 'ar-EG' : 'en-US', { maximumFractionDigits: 0 })}
              <span className="text-sm font-normal ml-1 text-white/80">{isRtl ? 'ر.ع' : 'OMR'}</span>
            </p>
            {totalRentalCost > 0 && (
              <p className="text-xs text-white/60 mt-1">
                {isRtl ? 'شامل ' + totalRentalCost.toLocaleString(isRtl ? 'ar-EG' : 'en-US', { maximumFractionDigits: 0 }) + ' ر.ع إيجارات' : 'incl. ' + totalRentalCost.toLocaleString('en-US', { maximumFractionDigits: 0 }) + ' OMR rentals'}
              </p>
            )}
          </CardContent>
        </Card>
        <Card className={"border-0 shadow-sm bg-gradient-to-br text-white " + (netProfit >= 0 ? 'from-blue-500 to-blue-600' : 'from-red-500 to-red-600')}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center">
                <Wallet className="h-4 w-4" />
              </div>
              <span className="text-xs text-white/80">{isRtl ? 'صافي الربح' : 'Net Profit'}</span>
            </div>
            <p className="text-xl font-bold">
              {netProfit.toLocaleString(isRtl ? 'ar-EG' : 'en-US', { maximumFractionDigits: 0 })}
              <span className="text-sm font-normal ml-1 text-white/80">{isRtl ? 'ر.ع' : 'OMR'}</span>
            </p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm bg-gradient-to-br from-violet-500 to-violet-600 text-white">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center">
                <DollarSign className="h-4 w-4" />
              </div>
              <span className="text-xs text-white/80">{isRtl ? 'هامش الربح' : 'Profit Margin'}</span>
            </div>
            <p className="text-xl font-bold">{profitMargin.toFixed(1)}%</p>
            <p className="text-xs text-white/60 mt-1">
              {isRtl ? 'تكلفة المتر' : 'Cost/m'}: {costPerMeter.toFixed(1)} {isRtl ? 'ر.ع' : 'OMR'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Project Filter */}
      <div className="flex items-center gap-3 flex-wrap">
        <Select value={selectedProject} onValueChange={setSelectedProject}>
          <SelectTrigger className="w-full sm:w-[280px]">
            <SelectValue placeholder={isRtl ? 'اختر المشروع' : 'Select project'} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{isRtl ? 'كل المشاريع' : 'All Projects'}</SelectItem>
            {projects.map(function(p) {
              return <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            })}
          </SelectContent>
        </Select>
        <Badge variant="secondary" className="text-xs px-2.5 py-1">
          {costs.length} {isRtl ? 'فاتورة' : 'invoices'}
        </Badge>
        <Badge variant="outline" className="text-xs px-2.5 py-1">
          {filteredCosts.length} {isRtl ? 'معروضة' : 'shown'}
        </Badge>
      </div>

      {/* Active Rental Assets Details */}
      {rentalAssets.length > 0 && (
        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <div className="w-7 h-7 rounded-md bg-teal-100 text-teal-600 flex items-center justify-center">
                <Wallet className="h-4 w-4" />
              </div>
              {isRtl ? 'إيجارات المعدات الشهرية (من قسم المعدات)' : 'Monthly Equipment Rentals (from Equipment section)'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {rentalAssets.map(function(ra, idx) {
                return (
                  <div key={ra.id || idx} className="flex items-center justify-between p-3 rounded-xl border hover:bg-teal-50/50 transition-colors">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{ra.name}</p>
                      <p className="text-xs text-muted-foreground">{ra.supplier} {ra.projectName !== '-' ? '• ' + ra.projectName : ''}</p>
                    </div>
                    <span className="font-semibold text-sm text-teal-700 shrink-0 mr-3">{ra.rentalCost.toLocaleString(isRtl ? 'ar-EG' : 'en-US', { maximumFractionDigits: 0 })} {isRtl ? 'ر.ع/شهر' : 'OMR/mo'}</span>
                  </div>
                )
              })}
              <div className="flex items-center justify-between pt-2 mt-2 border-t font-semibold">
                <span className="text-sm">{isRtl ? 'الإجمالي' : 'Total'}</span>
                <span className="text-teal-700">{totalRentalCost.toLocaleString(isRtl ? 'ar-EG' : 'en-US', { maximumFractionDigits: 0 })} {isRtl ? 'ر.ع/شهر' : 'OMR/mo'}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Chart */}
      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <div className="w-7 h-7 rounded-md bg-primary/10 text-primary flex items-center justify-center">
              <BarChart3 className="h-4 w-4" />
            </div>
            {isRtl ? 'التكاليف حسب الفئة' : 'Costs by Category'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {pieData.length === 0 ? (
            <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
              {isRtl ? 'لا توجد بيانات' : 'No data'}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(300, pieData.length * 45)}>
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

      {/* Costs List - Full Table View */}
      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <div className="w-7 h-7 rounded-md bg-rose-100 text-rose-600 flex items-center justify-center">
                <FileText className="h-4 w-4" />
              </div>
              {isRtl ? 'التكاليف المسجلة' : 'Recorded Costs'}
            </CardTitle>
            <span className="text-sm font-semibold text-muted-foreground">
              {filteredTotal.toLocaleString(isRtl ? 'ar-EG' : 'en-US', { maximumFractionDigits: 0 })} {isRtl ? 'ر.ع' : 'OMR'}
            </span>
          </div>

          {/* Search & Filter Bar */}
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className={"absolute top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground " + (isRtl ? "right-3" : "left-3")} />
              <Input
                placeholder={isRtl ? 'بحث في التكاليف...' : 'Search costs...'}
                value={searchQuery}
                onChange={function(e) { setSearchQuery(e.target.value) }}
                className={isRtl ? "pr-9" : "pl-9"}
              />
            </div>
            <div className="flex items-center gap-1.5">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <Select value={filterCategory} onValueChange={setFilterCategory}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder={isRtl ? 'الفئة' : 'Category'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{isRtl ? 'كل الفئات' : 'All Categories'}</SelectItem>
                  {Object.keys(categoryLabels).map(function(key) {
                    return <SelectItem key={key} value={key}>{isRtl ? categoryLabels[key].ar : categoryLabels[key].en}</SelectItem>
                  })}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="h-32 bg-muted animate-pulse rounded-xl" />
          ) : filteredCosts.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">
              <FileText className="h-10 w-10 mx-auto mb-3 opacity-30" />
              {costs.length === 0
                ? (isRtl ? 'لا توجد تكاليف مسجلة' : 'No costs recorded')
                : (isRtl ? 'لا توجد نتائج مطابقة للبحث' : 'No matching results')
              }
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="p-2.5 text-right font-medium text-xs uppercase tracking-wider text-muted-foreground w-8">#</th>
                    <th className="p-2.5 text-right font-medium text-xs uppercase tracking-wider text-muted-foreground">{isRtl ? 'التاريخ' : 'Date'}</th>
                    <th className="p-2.5 text-right font-medium text-xs uppercase tracking-wider text-muted-foreground">{isRtl ? 'الفئة' : 'Category'}</th>
                    <th className="p-2.5 text-right font-medium text-xs uppercase tracking-wider text-muted-foreground">{isRtl ? 'الوصف' : 'Description'}</th>
                    <th className="p-2.5 text-right font-medium text-xs uppercase tracking-wider text-muted-foreground">{isRtl ? 'المشروع' : 'Project'}</th>
                    <th className="p-2.5 text-right font-medium text-xs uppercase tracking-wider text-muted-foreground">{isRtl ? 'المبلغ' : 'Amount'}</th>
                    <th className="p-2.5 text-right font-medium text-xs uppercase tracking-wider text-muted-foreground w-20">{isRtl ? 'إجراءات' : 'Actions'}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCosts.map(function(c, idx) {
                    var catColor = categoryColors[c.category] || '#94a3b8'
                    var catLabel = isRtl
                      ? (categoryLabels[c.category] ? categoryLabels[c.category].ar : c.category)
                      : (categoryLabels[c.category] ? categoryLabels[c.category].en : c.category)
                    return (
                      <tr key={c.id} className="border-b hover:bg-muted/20 transition-colors group">
                        <td className="p-2.5 text-muted-foreground text-xs">{idx + 1}</td>
                        <td className="p-2.5 whitespace-nowrap text-xs">{new Date(c.date).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US')}</td>
                        <td className="p-2.5">
                          <Badge
                            variant="secondary"
                            className="text-xs font-medium px-2 py-0.5"
                            style={{ backgroundColor: catColor + '18', color: catColor, borderColor: catColor + '30' }}
                          >
                            {catLabel}
                          </Badge>
                        </td>
                        <td className="p-2.5 max-w-[200px]">
                          <p className="font-medium text-sm truncate">{c.description}</p>
                          {c.notes && <p className="text-xs text-muted-foreground truncate mt-0.5">{c.notes}</p>}
                        </td>
                        <td className="p-2.5 text-xs text-muted-foreground">{c.project ? c.project.name : '-'}</td>
                        <td className="p-2.5 font-semibold text-rose-600 whitespace-nowrap">
                          {c.amount.toLocaleString()} {isRtl ? 'ر.ع' : 'OMR'}
                        </td>
                        <td className="p-2.5">
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={function() {
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
                              ✏️
                            </Button>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={function() { deleteCost(c.id) }}>
                              🗑️
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 bg-muted/20 font-bold">
                    <td className="p-2.5" colSpan={5}>{isRtl ? 'إجمالي المعروض' : 'Shown Total'}</td>
                    <td className="p-2.5 text-rose-600">{filteredTotal.toLocaleString(isRtl ? 'ar-EG' : 'en-US', { maximumFractionDigits: 0 })} {isRtl ? 'ر.ع' : 'OMR'}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingCostId ? (isRtl ? 'تعديل التكلفة' : 'Edit Cost') : (isRtl ? 'إضافة تكلفة' : 'Add Cost')}</DialogTitle>
            <DialogDescription>
              {editingCostId ? (isRtl ? 'عدّل بيانات التكلفة' : 'Edit cost details') : (isRtl ? 'سجّل تكلفة جديدة' : 'Record a new cost')}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{isRtl ? 'المشروع' : 'Project'} *</Label>
                <Select value={formData.projectId} onValueChange={function(v) { setFormData(Object.assign({}, formData, { projectId: v })) }} required>
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
                <Input type="date" value={formData.date} onChange={function(e) { setFormData(Object.assign({}, formData, { date: e.target.value })) }} required />
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'الفئة' : 'Category'} *</Label>
                <Select value={formData.category} onValueChange={function(v) { setFormData(Object.assign({}, formData, { category: v })) }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.keys(categoryLabels).map(function(key) {
                      return <SelectItem key={key} value={key}>{isRtl ? categoryLabels[key].ar : categoryLabels[key].en}</SelectItem>
                    })}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'المبلغ (ر.ع)' : 'Amount (OMR)'} *</Label>
                <Input type="number" step="0.01" value={formData.amount} onChange={function(e) { setFormData(Object.assign({}, formData, { amount: e.target.value })) }} required />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{isRtl ? 'الوصف' : 'Description'} *</Label>
              <Input value={formData.description} onChange={function(e) { setFormData(Object.assign({}, formData, { description: e.target.value })) }} required />
            </div>
            <div className="space-y-1.5">
              <Label>{isRtl ? 'ملاحظات' : 'Notes'}</Label>
              <Textarea value={formData.notes} onChange={function(e) { setFormData(Object.assign({}, formData, { notes: e.target.value })) }} rows={2} />
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
