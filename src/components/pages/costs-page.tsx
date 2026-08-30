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
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, Legend
} from 'recharts'
import { Plus, DollarSign, TrendingUp, TrendingDown, Wallet, BarChart3, Pencil, Trash2, ChevronDown, ChevronUp } from 'lucide-react'
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
  const token = useAppStore((s) => s.token)
  const isRtl = language === 'ar'

  const [revenue, setRevenue] = useState(0)
  const [approvedReports, setApprovedReports] = useState<any[]>([])
  const [showRevenueTable, setShowRevenueTable] = useState(true)

  const [formData, setFormData] = useState({
    projectId: '', date: new Date().toISOString().split('T')[0],
    category: 'labor', description: '', amount: '', notes: '',
  })

  async function fetchCosts() {
    setLoading(true)
    try {
      const costUrl = '/api/costs' + (selectedProject !== 'all' ? `?projectId=${selectedProject}` : '')
      const res = await authedFetch(costUrl)
      const data = await res.json()
      setCosts(data.costs || [])
      setByCategory(data.byCategory || [])
      setTotal(data.total || 0)
      setTotalRentalCost(data.totalRentalCost || 0)
      setGrandTotal(data.grandTotal || 0)
      setRentalAssets(data.rentalAssets || [])

      const repParams = new URLSearchParams()
      if (selectedProject !== 'all') repParams.set('projectId', selectedProject)
      repParams.set('limit', '500')
      const repRes = await authedFetch('/api/daily-reports?' + repParams.toString())
      const repData = await repRes.json()
      const reports = (repData.reports || []).filter((r: any) => r.status === 'approved')
      const totalRev = reports.reduce((s: number, r: any) => s + (r.dailyRevenue || 0), 0)
      setRevenue(totalRev)
      setApprovedReports(reports)
    } catch (e) {
      console.error('fetchCosts error:', e)
    }
    setLoading(false)
  }

  async function fetchProjects() {
    try {
      const res = await authedFetch('/api/projects/list?_t=' + Date.now(), { cache: 'no-store' })
      if (!res.ok) { setProjects([]); return }
      const data = await res.json()
      setProjects((data.projects || []).filter((p: any) => p.showInCosts !== false))
    } catch {
      setProjects([])
    }
  }

  useEffect(() => {
    if (!token) return
    fetchCosts()
    fetchProjects()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  useEffect(() => {
    if (!token) return
    fetchCosts()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProject])

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

  function openEdit(c: any) {
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
  }

  const netProfit = revenue - grandTotal
  const profitMargin = revenue > 0 ? (netProfit / revenue) * 100 : 0
  const totalMeters = approvedReports.reduce((s, r) => s + (r.dailyMeters || 0), 0)
  const costPerMeter = totalMeters > 0 ? total / totalMeters : 0

  const pieData = byCategory.map((c) => ({
    name: isRtl ? (categoryLabels[c.category]?.ar || c.category) : (categoryLabels[c.category]?.en || c.category),
    value: c.amount,
    color: categoryColors[c.category] || '#94a3b8',
  }))

  const revenueByProject: Record<string, { name: string; meters: number; revenue: number; count: number }> = {}
  approvedReports.forEach((r) => {
    const pName = r.project ? r.project.name : (isRtl ? 'غير معروف' : 'Unknown')
    if (!revenueByProject[r.projectId]) {
      revenueByProject[r.projectId] = { name: pName, meters: 0, revenue: 0, count: 0 }
    }
    revenueByProject[r.projectId].meters += (r.dailyMeters || 0)
    revenueByProject[r.projectId].revenue += (r.dailyRevenue || 0)
    revenueByProject[r.projectId].count += 1
  })
  const projectRevenueList = Object.values(revenueByProject)

  function getCatLabel(cat: string) {
    return isRtl ? (categoryLabels[cat]?.ar || cat) : (categoryLabels[cat]?.en || cat)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">{isRtl ? 'التكاليف والإيرادات' : 'Costs & Revenue'}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isRtl ? 'متابعة التكاليف والإيرادات وحساب الأرباح' : 'Track costs, revenue, and profit'}
          </p>
        </div>
        <Button onClick={() => {
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
            <p className="text-xs text-muted-foreground mt-1">
              {approvedReports.length} {isRtl ? 'تقرير معتمد' : 'approved reports'}
            </p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-red-50 to-red-50/30 border-red-200">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingDown className="h-4 w-4 text-red-600" />
              <span className="text-xs text-muted-foreground">{isRtl ? 'التكاليف الكلية' : 'Total Costs'}</span>
            </div>
            <p className="text-xl font-bold text-red-700">
              {grandTotal.toLocaleString(isRtl ? 'ar-EG' : 'en-US', { maximumFractionDigits: 0 })}
              <span className="text-sm font-normal mr-1">{isRtl ? 'ر.ع' : 'OMR'}</span>
            </p>
            {totalRentalCost > 0 && (
              <p className="text-xs text-teal-600 mt-1">
                {isRtl ? `شامل ${totalRentalCost.toLocaleString(isRtl ? 'ar-EG' : 'en-US', { maximumFractionDigits: 0 })} ر.ع إيجارات شهرية` : `incl. ${totalRentalCost.toLocaleString('en-US', { maximumFractionDigits: 0 })} OMR monthly rentals`}
              </p>
            )}
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
          {projects.map((p) => (
            <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Revenue Details */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between cursor-pointer select-none" onClick={() => setShowRevenueTable(!showRevenueTable)}>
            <span className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-emerald-600" />
              {isRtl ? 'تفاصيل الإيرادات (من التقارير المعتمدة)' : 'Revenue Details (from approved reports)'}
            </span>
            {showRevenueTable ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </CardTitle>
        </CardHeader>
        {showRevenueTable && (
          <CardContent className="space-y-4">
            {projectRevenueList.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {projectRevenueList.map((p, idx) => (
                  <div key={idx} className="p-3 rounded-lg border bg-emerald-50/50">
                    <p className="font-medium text-sm truncate">{p.name}</p>
                    <div className="flex items-baseline gap-2 mt-1">
                      <span className="text-lg font-bold text-emerald-700">{p.revenue.toLocaleString(isRtl ? 'ar-EG' : 'en-US', { maximumFractionDigits: 0 })}</span>
                      <span className="text-xs text-muted-foreground">{isRtl ? 'ر.ع' : 'OMR'}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {p.meters.toFixed(1)} {isRtl ? 'م' : 'm'} / {p.count} {isRtl ? 'تقرير' : 'reports'}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {approvedReports.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground text-sm">
                {isRtl ? 'لا توجد تقارير معتمدة بعد' : 'No approved reports yet'}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="p-2 text-right">{isRtl ? 'التاريخ' : 'Date'}</th>
                      <th className="p-2 text-right">{isRtl ? 'المشروع' : 'Project'}</th>
                      <th className="p-2 text-right">{isRtl ? 'خط الحفر' : 'Drive Line'}</th>
                      <th className="p-2 text-right">{isRtl ? 'الأمتار' : 'Meters'}</th>
                      <th className="p-2 text-right">{isRtl ? 'سعر المتر' : 'Price/m'}</th>
                      <th className="p-2 text-right">{isRtl ? 'الإيراد' : 'Revenue'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {approvedReports.map((r) => (
                      <tr key={r.id} className="border-b hover:bg-muted/30">
                        <td className="p-2">{r.reportDate ? new Date(r.reportDate).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US') : '-'}</td>
                        <td className="p-2">{r.project ? r.project.name : '-'}</td>
                        <td className="p-2">{r.driveLine ? r.driveLine.lineNumber : '-'}</td>
                        <td className="p-2">{r.dailyMeters || 0} {isRtl ? 'م' : 'm'}</td>
                        <td className="p-2">{r.project ? (r.project.pricePerMeter || 0) : 0} {isRtl ? 'ر.ع' : 'OMR'}</td>
                        <td className="p-2 font-semibold text-emerald-700">{(r.dailyRevenue || 0).toLocaleString()} {isRtl ? 'ر.ع' : 'OMR'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 font-bold">
                      <td className="p-2" colSpan={3}>{isRtl ? 'الإجمالي' : 'Total'}</td>
                      <td className="p-2">{totalMeters.toFixed(1)} {isRtl ? 'م' : 'm'}</td>
                      <td className="p-2">-</td>
                      <td className="p-2 text-emerald-700">{revenue.toLocaleString(isRtl ? 'ar-EG' : 'en-US', { maximumFractionDigits: 0 })} {isRtl ? 'ر.ع' : 'OMR'}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* Rental Assets */}
      {rentalAssets.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5 text-teal-600" />
              {isRtl ? 'تفاصيل الإيجارات الشهرية' : 'Monthly Rental Details'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {rentalAssets.map((ra, idx) => (
                <div key={ra.id || idx} className="flex items-center justify-between p-2.5 rounded-lg bg-teal-50/50 hover:bg-teal-50 transition">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{ra.name}</p>
                    <p className="text-xs text-muted-foreground">{ra.supplier}{ra.projectName !== '-' ? ` • ${ra.projectName}` : ''}</p>
                  </div>
                  <span className="font-semibold text-sm text-teal-700 shrink-0 mr-3">{ra.rentalCost.toLocaleString(isRtl ? 'ar-EG' : 'en-US', { maximumFractionDigits: 0 })} {isRtl ? 'ر.ع/شهر' : 'OMR/mo'}</span>
                </div>
              ))}
              <div className="flex items-center justify-between pt-2 mt-2 border-t font-semibold">
                <span className="text-sm">{isRtl ? 'الإجمالي' : 'Total'}</span>
                <span className="text-teal-700">{totalRentalCost.toLocaleString(isRtl ? 'ar-EG' : 'en-US', { maximumFractionDigits: 0 })} {isRtl ? 'ر.ع/شهر' : 'OMR/mo'}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

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
                    label={(entry: any) => `${entry.value.toFixed(0)}`}
                  >
                    {pieData.map((entry, idx) => (
                      <Cell key={idx} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ direction: isRtl ? 'rtl' : 'ltr', borderRadius: 8, fontSize: 12 }}
                    formatter={(value: any) => [`${value.toLocaleString()} ر.ع`, '']}
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
                    formatter={(value: any) => [`${value.toLocaleString()} ر.ع`, isRtl ? 'المبلغ' : 'Amount']}
                  />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                    {pieData.map((entry, idx) => (
                      <Cell key={idx} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Costs Table - ALL costs, no limit */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>{isRtl ? 'جميع التكاليف المسجلة' : 'All Recorded Costs'}</span>
            <Badge variant="secondary" className="text-xs font-normal">
              {costs.length} {isRtl ? 'سجل' : 'records'}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="h-32 bg-muted animate-pulse rounded" />
          ) : costs.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm">
              {isRtl ? 'لا توجد تكاليف' : 'No costs'}
            </div>
          ) : (
            <div className="overflow-x-auto -mx-4 sm:mx-0">
              <table className="w-full text-sm min-w-[600px]">
                <thead>
                  <tr className="border-b-2 bg-muted/30">
                    <th className={`p-2.5 text-xs font-semibold ${isRtl ? 'text-right' : 'text-left'}`}>
                      {isRtl ? 'الإجراءات' : 'Actions'}
                    </th>
                    <th className={`p-2.5 text-xs font-semibold ${isRtl ? 'text-right' : 'text-left'}`}>
                      {isRtl ? 'الحالة' : 'Status'}
                    </th>
                    <th className={`p-2.5 text-xs font-semibold ${isRtl ? 'text-right' : 'text-left'}`}>
                      {isRtl ? 'المبلغ' : 'Amount'}
                    </th>
                    <th className={`p-2.5 text-xs font-semibold ${isRtl ? 'text-right' : 'text-left'}`}>
                      {isRtl ? 'الوصف' : 'Description'}
                    </th>
                    <th className={`p-2.5 text-xs font-semibold ${isRtl ? 'text-right' : 'text-left'}`}>
                      {isRtl ? 'الفئة' : 'Category'}
                    </th>
                    <th className={`p-2.5 text-xs font-semibold ${isRtl ? 'text-right' : 'text-left'}`}>
                      {isRtl ? 'المشروع' : 'Project'}
                    </th>
                    <th className={`p-2.5 text-xs font-semibold ${isRtl ? 'text-right' : 'text-left'}`}>
                      {isRtl ? 'التاريخ' : 'Date'}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {costs.map((c) => {
                    const isFromReport = !!c.dailyReportId
                    return (
                      <tr key={c.id} className="border-b hover:bg-muted/30 transition-colors">
                        {/* Actions - ALWAYS VISIBLE */}
                        <td className="p-2.5">
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                              onClick={() => openEdit(c)}
                              title={isRtl ? 'تعديل' : 'Edit'}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-red-500 hover:text-red-600 hover:bg-red-50"
                              onClick={() => deleteCost(c.id)}
                              title={isRtl ? 'حذف' : 'Delete'}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                        {/* Status */}
                        <td className="p-2.5">
                          {isFromReport ? (
                            <Badge variant="outline" className="text-emerald-700 border-emerald-300 bg-emerald-50 text-xs">
                              {isRtl ? 'فقط للعرض' : 'View Only'}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-xs">
                              {isRtl ? 'مقبول' : 'Approved'}
                            </Badge>
                          )}
                        </td>
                        {/* Amount */}
                        <td className="p-2.5">
                          <span className="font-semibold text-red-600">
                            {c.amount.toLocaleString()} {isRtl ? 'ر.ع' : 'OMR'}
                          </span>
                        </td>
                        {/* Description */}
                        <td className="p-2.5 max-w-[200px]">
                          <p className="truncate font-medium" title={c.description}>{c.description}</p>
                        </td>
                        {/* Category */}
                        <td className="p-2.5">
                          <span
                            className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full"
                            style={{ backgroundColor: (categoryColors[c.category] || '#94a3b8') + '15', color: categoryColors[c.category] || '#94a3b8' }}
                          >
                            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: categoryColors[c.category] || '#94a3b8' }} />
                            {getCatLabel(c.category)}
                          </span>
                        </td>
                        {/* Project */}
                        <td className="p-2.5">
                          {c.project ? (
                            <span className="text-orange-600 font-medium text-xs" title={c.project.code ? `${c.project.code} - ${c.project.name}` : c.project.name}>
                              {c.project.code && <span className="opacity-70">{c.project.code} </span>}
                              {c.project.name}
                            </span>
                          ) : '-'}
                        </td>
                        {/* Date */}
                        <td className="p-2.5 text-muted-foreground text-xs whitespace-nowrap">
                          {new Date(c.date).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US')}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
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
                <Select value={formData.projectId} onValueChange={(v) => setFormData({ ...formData, projectId: v })} required>
                  <SelectTrigger><SelectValue placeholder={isRtl ? 'اختر' : 'Select'} /></SelectTrigger>
                  <SelectContent>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'التاريخ' : 'Date'} *</Label>
                <Input type="date" value={formData.date} onChange={(e) => setFormData({ ...formData, date: e.target.value })} required />
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'الفئة' : 'Category'} *</Label>
                <Select value={formData.category} onValueChange={(v) => setFormData({ ...formData, category: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(categoryLabels).map(([key, val]) => (
                      <SelectItem key={key} value={key}>{isRtl ? val.ar : val.en}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'المبلغ (ر.ع)' : 'Amount (OMR)'} *</Label>
                <Input type="number" step="0.01" value={formData.amount} onChange={(e) => setFormData({ ...formData, amount: e.target.value })} required />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{isRtl ? 'الوصف' : 'Description'} *</Label>
              <Input value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} required />
            </div>
            <div className="space-y-1.5">
              <Label>{isRtl ? 'ملاحظات' : 'Notes'}</Label>
              <Textarea value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} rows={2} />
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
