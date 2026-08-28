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
import { Plus, DollarSign, TrendingDown, Search, Trash2, Building2, Fuel, Wrench, Users, Home, Truck, Droplets, Package, MoreHorizontal, BarChart3, PieChartIcon } from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { authedFetch, getErrorMessage } from '@/lib/api-client'
import { toast } from 'sonner'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, PieChart, Pie, Cell, Legend
} from 'recharts'

var categoryIcons: Record<string, any> = {
  labor: Users,
  housing: Home,
  transport: Truck,
  fuel: Fuel,
  maintenance: Wrench,
  parts: Package,
  oil: Droplets,
  rental: Building2,
  other: MoreHorizontal,
}

var categoryLabels: Record<string, { ar: string; en: string }> = {
  labor: { ar: 'أجور العمال', en: 'Labor' },
  housing: { ar: 'السكن', en: 'Housing' },
  transport: { ar: 'النقل', en: 'Transport' },
  fuel: { ar: 'الديزل', en: 'Fuel' },
  maintenance: { ar: 'صيانة المعدات', en: 'Maintenance' },
  parts: { ar: 'قطع الغيار', en: 'Parts' },
  oil: { ar: 'استهلاك الزيوت', en: 'Oil' },
  rental: { ar: 'إيجار المعدات', en: 'Rental' },
  other: { ar: 'مصاريف أخرى', en: 'Other' },
}

var categoryColors: Record<string, string> = {
  labor: 'bg-blue-100 text-blue-700',
  housing: 'bg-purple-100 text-purple-700',
  transport: 'bg-orange-100 text-orange-700',
  fuel: 'bg-red-100 text-red-700',
  maintenance: 'bg-yellow-100 text-yellow-700',
  parts: 'bg-teal-100 text-teal-700',
  oil: 'bg-indigo-100 text-indigo-700',
  rental: 'bg-cyan-100 text-cyan-700',
  other: 'bg-gray-100 text-gray-700',
}

var chartColors: Record<string, string> = {
  labor: '#3b82f6',
  housing: '#a855f7',
  transport: '#f97316',
  fuel: '#ef4444',
  maintenance: '#eab308',
  parts: '#14b8a6',
  oil: '#6366f1',
  rental: '#06b6d4',
  other: '#6b7280',
}

var allChartColors = ['#3b82f6', '#f97316', '#a855f7', '#14b8a6', '#ef4444', '#eab308', '#06b6d4', '#6366f1', '#ec4899', '#22c55e']

var monthsAr = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']
var monthsEn = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export default function CostsPage() {
  var [costs, setCosts] = useState<any[]>([])
  var [projects, setProjects] = useState<any[]>([])
  var [byCategory, setByCategory] = useState<any[]>([])
  var [rentalAssets, setRentalAssets] = useState<any[]>([])
  var [totalCost, setTotalCost] = useState(0)
  var [totalRentalCost, setTotalRentalCost] = useState(0)
  var [grandTotal, setGrandTotal] = useState(0)
  var [loading, setLoading] = useState(true)
  var [selectedProject, setSelectedProject] = useState<string>('all')
  var [dialogOpen, setDialogOpen] = useState(false)
  var [saving, setSaving] = useState(false)
  var [search, setSearch] = useState('')
  var language = useAppStore((s) => s.language)
  var user = useAppStore((s) => s.user)
  var isRtl = language === 'ar'

  var emptyForm = { projectId: '', date: new Date().toISOString().split('T')[0], category: 'labor', description: '', amount: '', notes: '' }
  var [formData, setFormData] = useState({ ...emptyForm })

  async function fetchData() {
    setLoading(true)
    try {
      var res = await authedFetch('/api/costs' + (selectedProject !== 'all' ? '?projectId=' + selectedProject : ''))
      var data = await res.json()
      setCosts(data.costs || [])
      setByCategory(data.byCategory || [])
      setTotalCost(data.total || 0)
      setTotalRentalCost(data.totalRentalCost || 0)
      setGrandTotal(data.grandTotal || 0)
      setRentalAssets(data.rentalAssets || [])
    } catch {
      setCosts([])
    }
    setLoading(false)
  }

  async function fetchProjects() {
    try {
      var res = await authedFetch('/api/projects/list?_t=' + Date.now())
      if (!res.ok) { setProjects([]); return }
      var data = await res.json()
      setProjects(data.projects || [])
    } catch {
      setProjects([])
    }
  }

  useEffect(function() {
    if (!user) return
    fetchProjects()
  }, [user])

  useEffect(function() {
    if (!user) return
    fetchData()
  }, [user, selectedProject])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      var res = await authedFetch('/api/costs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })
      if (res.ok) {
        toast.success(isRtl ? 'تم إضافة التكلفة' : 'Cost added')
        setDialogOpen(false)
        setFormData({ ...emptyForm })
        fetchData()
      } else {
        var data = await res.json().catch(function() { return {} })
        toast.error(getErrorMessage(data.error || '', isRtl, data.message))
      }
    } catch {
      toast.error(isRtl ? 'حدث خطأ' : 'Error')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(cost: any) {
    var msg = isRtl ? 'هل أنت متأكد من حذف هذه التكلفة؟' : 'Delete this cost?'
    if (!confirm(msg)) return
    try {
      var res = await authedFetch('/api/costs/' + cost.id, { method: 'DELETE' })
      if (res.ok) {
        toast.success(isRtl ? 'تم الحذف' : 'Deleted')
        fetchData()
      }
    } catch {
      toast.error(isRtl ? 'حدث خطأ' : 'Error')
    }
  }

  function getCatLabel(cat: string) {
    var c = categoryLabels[cat]
    return c ? (isRtl ? c.ar : c.en) : cat
  }

  function getCatColor(cat: string) {
    return categoryColors[cat] || 'bg-gray-100 text-gray-700'
  }

  function getCatIcon(cat: string) {
    return categoryIcons[cat] || MoreHorizontal
  }

  var filtered = costs.filter(function(c: any) {
    if (!search) return true
    var s = search.toLowerCase()
    return (c.description || '').toLowerCase().includes(s) ||
      (c.category || '').toLowerCase().includes(s) ||
      (c.project?.name || '').toLowerCase().includes(s) ||
      String(c.amount).includes(s)
  })

  /* ---- Chart Data ---- */
  var pieData = useMemo(function() {
    return byCategory.map(function(c: any) {
      return { name: getCatLabel(c.category), value: c.amount || 0, color: chartColors[c.category] || '#6b7280' }
    })
  }, [byCategory])

  var monthlyData = useMemo(function() {
    var map: Record<string, number> = {}
    costs.forEach(function(c: any) {
      if (!c.date) return
      var key = c.date.substring(0, 7)
      map[key] = (map[key] || 0) + c.amount
    })
    return Object.keys(map).sort().map(function(k) {
      var parts = k.split('-')
      var label = isRtl
        ? monthsAr[parseInt(parts[1]) - 1] + ' ' + parts[0]
        : monthsEn[parseInt(parts[1]) - 1] + ' ' + parts[0]
      return { month: label, amount: map[k] }
    })
  }, [costs, isRtl])

  var projectData = useMemo(function() {
    var map: Record<string, { name: string; amount: number }> = {}
    costs.forEach(function(c: any) {
      var pName = c.project?.name || (isRtl ? 'غير محدد' : 'Unassigned')
      if (!map[pName]) map[pName] = { name: pName, amount: 0 }
      map[pName].amount += c.amount
    })
    return Object.values(map).sort(function(a, b) { return b.amount - a.amount })
  }, [costs, isRtl])

  var catProjectData = useMemo(function() {
    var catSet = new Set<string>()
    costs.forEach(function(c: any) { if (c.category) catSet.add(c.category) })
    var categories = Array.from(catSet)
    var projectSet = new Set<string>()
    costs.forEach(function(c: any) { projectSet.add(c.project?.name || (isRtl ? 'غير محدد' : 'Unassigned')) })
    var projectNames = Array.from(projectSet)
    return projectNames.map(function(pName) {
      var row: any = { project: pName }
      costs.forEach(function(c: any) {
        if ((c.project?.name || (isRtl ? 'غير محدد' : 'Unassigned')) !== pName) return
        row[c.category] = (row[c.category] || 0) + c.amount
      })
      return row
    })
  }, [costs, isRtl])

  var hasChartData = pieData.length > 0 || monthlyData.length > 0

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">{isRtl ? 'التكاليف والإيرادات' : 'Costs & Revenue'}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isRtl ? costs.length + ' بند تكلفة' : costs.length + ' cost items'}
          </p>
        </div>
        {user && (
          <Button onClick={function() { setFormData({ ...emptyForm, projectId: projects[0]?.id || '' }); setDialogOpen(true) }}>
            <Plus className="h-4 w-4 ml-2" />
            {isRtl ? 'إضافة تكلفة' : 'Add Cost'}
          </Button>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4 text-center">
            <DollarSign className="h-5 w-5 mx-auto text-muted-foreground mb-1" />
            <p className="text-xs text-muted-foreground">{isRtl ? 'إجمالي التكاليف' : 'Total Costs'}</p>
            <p className="font-bold text-lg">{totalCost.toLocaleString()} <span className="text-xs font-normal">{isRtl ? 'ر.ع' : 'OMR'}</span></p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <Building2 className="h-5 w-5 mx-auto text-cyan-600 mb-1" />
            <p className="text-xs text-muted-foreground">{isRtl ? 'إيجارات المعدات' : 'Rental Costs'}</p>
            <p className="font-bold text-lg text-cyan-700">{totalRentalCost.toLocaleString()} <span className="text-xs font-normal">{isRtl ? 'ر.ع' : 'OMR'}</span></p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <TrendingDown className="h-5 w-5 mx-auto text-orange-600 mb-1" />
            <p className="text-xs text-muted-foreground">{isRtl ? 'الإجمالي الكلي' : 'Grand Total'}</p>
            <p className="font-bold text-lg text-orange-700">{grandTotal.toLocaleString()} <span className="text-xs font-normal">{isRtl ? 'ر.ع' : 'OMR'}</span></p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <Package className="h-5 w-5 mx-auto text-primary mb-1" />
            <p className="text-xs text-muted-foreground">{isRtl ? 'عدد البنود' : 'Items'}</p>
            <p className="font-bold text-lg">{costs.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Category Breakdown + Filter */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Filter + Search */}
        <div className="space-y-3">
          <Select value={selectedProject} onValueChange={setSelectedProject}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder={isRtl ? 'اختر المشروع' : 'Select project'} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{isRtl ? 'كل المشاريع' : 'All Projects'}</SelectItem>
              {projects.map(function(p: any) {
                return <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              })}
            </SelectContent>
          </Select>
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={isRtl ? 'بحث...' : 'Search...'}
              value={search}
              onChange={function(e) { setSearch(e.target.value) }}
              className="pr-10"
            />
          </div>
        </div>

        {/* Categories */}
        <div className="md:col-span-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{isRtl ? 'التكاليف حسب الفئة' : 'Costs by Category'}</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {byCategory.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">{isRtl ? 'لا توجد بيانات' : 'No data'}</p>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                  {byCategory.map(function(cat: any) {
                    var CatIcon = getCatIcon(cat.category)
                    var pct = grandTotal > 0 ? ((cat.amount / grandTotal) * 100).toFixed(1) : '0.0'
                    return (
                      <div key={cat.category} className="flex flex-col items-center p-2 rounded-lg bg-muted/50">
                        <CatIcon className="h-4 w-4 mb-1 text-muted-foreground" />
                        <span className="text-[10px] text-muted-foreground text-center leading-tight">{getCatLabel(cat.category)}</span>
                        <span className="font-bold text-sm mt-0.5">{(cat.amount || 0).toLocaleString()}</span>
                        <span className="text-[10px] text-muted-foreground">{pct}%</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Charts Section */}
      {hasChartData && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Pie Chart - Category Distribution */}
          {pieData.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <PieChartIcon className="h-4 w-4 text-primary" />
                  {isRtl ? 'توزيع التكاليف حسب الفئة' : 'Cost Distribution by Category'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={90}
                      paddingAngle={3}
                      dataKey="value"
                      stroke="none"
                    >
                      {pieData.map(function(entry: any, index: number) {
                        return <Cell key={index} fill={entry.color} />
                      })}
                    </Pie>
                    <Tooltip
                      formatter={function(value: number) {
                        return [value.toLocaleString() + ' ' + (isRtl ? 'ر.ع' : 'OMR'), isRtl ? 'المبلغ' : 'Amount']
                      }}
                      contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
                    />
                    <Legend
                      wrapperStyle={{ fontSize: 11 }}
                      formatter={function(value: string) {
                        return <span className="text-xs">{value}</span>
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Bar Chart - Monthly Trend */}
          {monthlyData.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-primary" />
                  {isRtl ? 'التكاليف الشهرية' : 'Monthly Costs'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={monthlyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis
                      dataKey="month"
                      tick={{ fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={function(v) { return v >= 1000 ? (v / 1000).toFixed(0) + 'k' : String(v) }}
                    />
                    <Tooltip
                      formatter={function(value: number) {
                        return [value.toLocaleString() + ' ' + (isRtl ? 'ر.ع' : 'OMR'), isRtl ? 'المبلغ' : 'Amount']
                      }}
                      contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
                      labelStyle={{ fontWeight: 600 }}
                    />
                    <Bar dataKey="amount" fill="#f97316" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Horizontal Bar - Cost per Project */}
          {projectData.length > 0 && (
            <Card className={pieData.length === 0 && monthlyData.length === 0 ? '' : 'md:col-span-2 lg:col-span-1'}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-primary" />
                  {isRtl ? 'التكاليف حسب المشروع' : 'Costs by Project'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={projectData} layout="vertical" margin={{ left: 10, right: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                    <XAxis
                      type="number"
                      tick={{ fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={function(v) { return v >= 1000 ? (v / 1000).toFixed(0) + 'k' : String(v) }}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      tick={{ fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      width={100}
                    />
                    <Tooltip
                      formatter={function(value: number) {
                        return [value.toLocaleString() + ' ' + (isRtl ? 'ر.ع' : 'OMR'), isRtl ? 'المبلغ' : 'Amount']
                      }}
                      contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
                      labelStyle={{ fontWeight: 600 }}
                    />
                    <Bar dataKey="amount" fill="#3b82f6" radius={[0, 4, 4, 0]}>
                      {projectData.map(function(_: any, index: number) {
                        return <Cell key={index} fill={allChartColors[index % allChartColors.length]} />
                      })}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Stacked Bar - Categories per Project (only if multiple projects) */}
      {catProjectData.length > 1 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" />
              {isRtl ? 'مقارنة الفئات بين المشاريع' : 'Category Comparison Across Projects'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={catProjectData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis
                  dataKey="project"
                  tick={{ fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={function(v) { return v >= 1000 ? (v / 1000).toFixed(0) + 'k' : String(v) }}
                />
                <Tooltip
                  formatter={function(value: number) {
                    return [value.toLocaleString() + ' ' + (isRtl ? 'ر.ع' : 'OMR')]
                  }}
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
                />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} formatter={function(value: string) {
                  return <span className="text-xs">{getCatLabel(value)}</span>
                }} />
                {Object.keys(categoryLabels).map(function(cat) {
                  return <Bar key={cat} dataKey={cat} stackId="a" fill={chartColors[cat] || '#6b7280'} />
                })}
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Rental Assets */}
      {rentalAssets.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
          <CardTitle className="text-sm">{isRtl ? 'الأصول المستأجرة' : 'Rental Assets'}</CardTitle>
        </CardHeader>
          <CardContent className="pt-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="p-2 text-right">{isRtl ? 'المعدة' : 'Asset'}</th>
                    <th className="p-2 text-right">{isRtl ? 'المورّد' : 'Supplier'}</th>
                    <th className="p-2 text-right">{isRtl ? 'المشروع' : 'Project'}</th>
                    <th className="p-2 text-right">{isRtl ? 'التكلفة الشهرية' : 'Monthly Cost'}</th>
                  </tr>
                </thead>
                <tbody>
                  {rentalAssets.map(function(a: any) {
                    return (
                      <tr key={a.id} className="border-b last:border-0">
                        <td className="p-2 font-medium">{a.name}</td>
                        <td className="p-2 text-muted-foreground">{a.supplier}</td>
                        <td className="p-2 text-muted-foreground">{a.projectName}</td>
                        <td className="p-2 font-semibold text-cyan-700">{a.rentalCost.toLocaleString()} {isRtl ? 'ر.ع' : 'OMR'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Costs Table */}
      {loading ? (
        <div className="h-32 bg-muted animate-pulse rounded" />
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <DollarSign className="h-12 w-12 mx-auto text-muted-foreground/50" />
            <p className="mt-3 text-muted-foreground">{isRtl ? 'لا توجد تكاليف' : 'No costs'}</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{isRtl ? 'تفاصيل التكاليف' : 'Cost Details'}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="p-2 text-right">{isRtl ? 'التاريخ' : 'Date'}</th>
                    <th className="p-2 text-right">{isRtl ? 'المشروع' : 'Project'}</th>
                    <th className="p-2 text-right">{isRtl ? 'الفئة' : 'Category'}</th>
                    <th className="p-2 text-right">{isRtl ? 'الوصف' : 'Description'}</th>
                    <th className="p-2 text-right">{isRtl ? 'المبلغ' : 'Amount'}</th>
                    <th className="p-2 text-right">{isRtl ? 'بواسطة' : 'By'}</th>
                    {user && <th className="p-2 text-right">{isRtl ? 'إجراءات' : 'Actions'}</th>}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(function(c: any) {
                    var CatIcon = getCatIcon(c.category)
                    return (
                      <tr key={c.id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="p-2 text-xs text-muted-foreground whitespace-nowrap">{new Date(c.date).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US')}</td>
                        <td className="p-2">
                          <span className="text-xs font-mono text-primary">{c.project?.code || ''}</span>
                          <span className="text-xs mr-1">{c.project?.name || ''}</span>
                        </td>
                        <td className="p-2">
                          <span className={"inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium " + getCatColor(c.category)}>
                            <CatIcon className="h-3 w-3" />
                            {getCatLabel(c.category)}
                          </span>
                        </td>
                        <td className="p-2 max-w-[200px] truncate" title={c.description}>{c.description}</td>
                        <td className="p-2 font-semibold">{c.amount.toLocaleString()} <span className="text-xs font-normal text-muted-foreground">{isRtl ? 'ر.ع' : 'OMR'}</span></td>
                        <td className="p-2 text-xs text-muted-foreground">{c.recordedBy?.name || '-'}</td>
                        {user && (
                          <td className="p-2">
                            <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive hover:text-destructive" onClick={function() { handleDelete(c) }}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Add Cost Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{isRtl ? 'إضافة تكلفة' : 'Add Cost'}</DialogTitle>
            <DialogDescription>{isRtl ? 'أدخل بيانات التكلفة الجديدة' : 'Enter new cost details'}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>{isRtl ? 'المشروع' : 'Project'} *</Label>
              <Select value={formData.projectId} onValueChange={function(v) { setFormData({ ...formData, projectId: v }) }} required>
                <SelectTrigger><SelectValue placeholder={isRtl ? 'اختر المشروع' : 'Select project'} /></SelectTrigger>
                <SelectContent>
                  {projects.map(function(p: any) {
                    return <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  })}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{isRtl ? 'التاريخ' : 'Date'} *</Label>
                <Input type="date" value={formData.date} onChange={function(e) { setFormData({ ...formData, date: e.target.value }) }} required />
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'الفئة' : 'Category'} *</Label>
                <Select value={formData.category} onValueChange={function(v) { setFormData({ ...formData, category: v }) }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.keys(categoryLabels).map(function(key) {
                      return <SelectItem key={key} value={key}>{isRtl ? categoryLabels[key].ar : categoryLabels[key].en}</SelectItem>
                    })}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{isRtl ? 'الوصف' : 'Description'} *</Label>
              <Input value={formData.description} onChange={function(e) { setFormData({ ...formData, description: e.target.value }) }} placeholder={isRtl ? 'وصف التكلفة...' : 'Cost description...'} required />
            </div>
            <div className="space-y-1.5">
              <Label>{isRtl ? 'المبلغ (ر.ع)' : 'Amount (OMR)'} *</Label>
              <Input type="number" step="0.01" value={formData.amount} onChange={function(e) { setFormData({ ...formData, amount: e.target.value }) }} placeholder="0.00" required />
            </div>
            <div className="space-y-1.5">
              <Label>{isRtl ? 'ملاحظات' : 'Notes'}</Label>
              <Textarea value={formData.notes} onChange={function(e) { setFormData({ ...formData, notes: e.target.value }) }} rows={2} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={function() { setDialogOpen(false) }}>{isRtl ? 'إلغاء' : 'Cancel'}</Button>
              <Button type="submit" disabled={saving}>{saving ? (isRtl ? 'جارٍ الحفظ...' : 'Saving...') : (isRtl ? 'حفظ' : 'Save')}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
