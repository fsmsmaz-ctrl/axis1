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
import { Plus, DollarSign, TrendingUp, TrendingDown, Wallet, BarChart3, ChevronDown } from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { authedFetch } from '@/lib/api-client'
import { toast } from 'sonner'

const categoryLabels: Record<string, { ar: string; en: string }> = {
  labor: { ar: '\u0623\u062c\u0648\u0631 \u0627\u0644\u0639\u0645\u0627\u0644', en: 'Labor' },
  housing: { ar: '\u0633\u0643\u0646', en: 'Housing' },
  transport: { ar: '\u0646\u0642\u0644', en: 'Transport' },
  fuel: { ar: '\u062f\u064a\u0632\u0644', en: 'Fuel' },
  maintenance: { ar: '\u0635\u064a\u0627\u0646\u0629', en: 'Maintenance' },
  parts: { ar: '\u0642\u0637\u0639 \u063a\u064a\u0627\u0631', en: 'Parts' },
  oil: { ar: '\u0632\u064a\u0648\u062a', en: 'Oil' },
  safety: { ar: '\u0633\u0644\u0627\u0645\u0629', en: 'Safety' },
  rental: { ar: '\u0625\u064a\u062c\u0627\u0631', en: 'Rental' },
  other: { ar: '\u0623\u062e\u0631\u0649', en: 'Other' },
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
  const token = useAppStore((s) => s.token)
  const isRtl = language === 'ar'

  // Revenue data
  const [revenue, setRevenue] = useState(0)
  const [projectReports, setProjectReports] = useState<any[]>([])

  // Show all costs by default, load more on demand
  const [visibleCount, setVisibleCount] = useState(100)

  const [formData, setFormData] = useState({
    projectId: '', date: new Date().toISOString().split('T')[0],
    category: 'labor', description: '', amount: '', notes: '',
  })

  async function fetchCosts() {
    setLoading(true)
    const res = await authedFetch('/api/costs' + (selectedProject !== 'all' ? `?projectId=${selectedProject}` : ''))
    const data = await res.json()
    setCosts(data.costs || [])
    setByCategory(data.byCategory || [])
    setTotal(data.total || 0)

    // Get revenue from reports
    const repParams = new URLSearchParams()
    if (selectedProject !== 'all') repParams.set('projectId', selectedProject)
    repParams.set('limit', '500')
    const repRes = await authedFetch('/api/daily-reports?' + repParams.toString())
    const repData = await repRes.json()
    const reports = (repData.reports || []).filter((r: any) => r.status === 'approved')
    const totalRev = reports.reduce((s: number, r: any) => s + r.dailyRevenue, 0)
    setRevenue(totalRev)
    setProjectReports(reports)

    setLoading(false)
  }

  useEffect(() => {
    if (!token) return
    fetchCosts()
    authedFetch('/api/projects/list').then(r => r.json()).then(d => setProjects(d.projects || []))
  }, [selectedProject, token])

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
        toast.success(editingCostId ? (isRtl ? '\u062a\u0645 \u062a\u062d\u062f\u064a\u062b \u0627\u0644\u062a\u0643\u0644\u0641\u0629' : 'Cost updated') : (isRtl ? '\u062a\u0645 \u0625\u0636\u0627\u0641\u0629 \u0627\u0644\u062a\u0643\u0644\u0641\u0629' : 'Cost added'))
        setDialogOpen(false)
        setEditingCostId(null)
        setFormData({
          projectId: projects[0]?.id || '', date: new Date().toISOString().split('T')[0],
          category: 'labor', description: '', amount: '', notes: '',
        })
        fetchCosts()
      }
    } catch {
      toast.error(isRtl ? '\u062d\u062f\u062b \u062e\u0637\u0623' : 'Error')
    }
  }

  async function deleteCost(id: string) {
    if (!confirm(isRtl ? '\u0647\u0644 \u0623\u0646\u062a \u0645\u062a\u0623\u0643\u062f \u0645\u0646 \u062d\u0630\u0641 \u0647\u0630\u0647 \u0627\u0644\u062a\u0643\u0644\u0641\u0629\u061f' : 'Are you sure you want to delete this cost?')) return
    try {
      const res = await authedFetch(`/api/costs/${id}`, { method: 'DELETE' })
      if (res.ok) {
        toast.success(isRtl ? '\u062a\u0645 \u062d\u0630\u0641 \u0627\u0644\u062a\u0643\u0644\u0641\u0629' : 'Cost deleted')
        fetchCosts()
      }
    } catch {
      toast.error(isRtl ? '\u062d\u062f\u062b \u062e\u0637\u0623' : 'Error')
    }
  }

  const netProfit = revenue - total
  const profitMargin = revenue > 0 ? (netProfit / revenue) * 100 : 0
  const totalMeters = projectReports.reduce((s, r) => s + r.dailyMeters, 0)
  const costPerMeter = totalMeters > 0 ? total / totalMeters : 0

  // Chart data
  const pieData = byCategory.map(c => ({
    name: isRtl ? categoryLabels[c.category]?.ar : categoryLabels[c.category]?.en || c.category,
    value: c.amount,
    color: categoryColors[c.category] || '#94a3b8',
  }))

  const visibleCosts = costs.slice(0, visibleCount)
  const hasMore = costs.length > visibleCount

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">{isRtl ? '\u0627\u0644\u062a\u0643\u0627\u0644\u064a\u0641 \u0648\u0627\u0644\u0625\u064a\u0631\u0627\u062f\u0627\u062a' : 'Costs & Revenue'}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isRtl ? '\u0645\u062a\u0627\u0628\u0639\u0629 \u0627\u0644\u062a\u0643\u0627\u0644\u064a\u0641 \u0648\u0627\u0644\u0625\u064a\u0631\u0627\u062f\u0627\u062a \u0648\u062d\u0633\u0627\u0628 \u0627\u0644\u0623\u0631\u0628\u0627\u062d' : 'Track costs, revenue, and profit'}
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
          {isRtl ? '\u0625\u0636\u0627\u0641\u0629 \u062a\u0643\u0644\u0641\u0629' : 'Add Cost'}
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="bg-gradient-to-br from-emerald-50 to-emerald-50/30 border-emerald-200">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="h-4 w-4 text-emerald-600" />
              <span className="text-xs text-muted-foreground">{isRtl ? '\u0627\u0644\u0625\u064a\u0631\u0627\u062f\u0627\u062a' : 'Revenue'}</span>
            </div>
            <p className="text-xl font-bold text-emerald-700">
              {revenue.toLocaleString(isRtl ? 'ar-EG' : 'en-US', { maximumFractionDigits: 0 })}
              <span className="text-sm font-normal mr-1">{isRtl ? '\u0631.\u0639' : 'OMR'}</span>
            </p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-red-50 to-red-50/30 border-red-200">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingDown className="h-4 w-4 text-red-600" />
              <span className="text-xs text-muted-foreground">{isRtl ? '\u0627\u0644\u062a\u0643\u0627\u0644\u064a\u0641' : 'Costs'}</span>
            </div>
            <p className="text-xl font-bold text-red-700">
              {total.toLocaleString(isRtl ? 'ar-EG' : 'en-US', { maximumFractionDigits: 0 })}
              <span className="text-sm font-normal mr-1">{isRtl ? '\u0631.\u0639' : 'OMR'}</span>
            </p>
          </CardContent>
        </Card>
        <Card className={netProfit >= 0 ? 'bg-gradient-to-br from-blue-50 to-blue-50/30 border-blue-200' : 'bg-gradient-to-br from-red-50 to-red-50/30 border-red-200'}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Wallet className="h-4 w-4 text-blue-600" />
              <span className="text-xs text-muted-foreground">{isRtl ? '\u0635\u0627\u0641\u064a \u0627\u0644\u0631\u0628\u062d' : 'Net Profit'}</span>
            </div>
            <p className={`text-xl font-bold ${netProfit >= 0 ? 'text-blue-700' : 'text-red-700'}`}>
              {netProfit.toLocaleString(isRtl ? 'ar-EG' : 'en-US', { maximumFractionDigits: 0 })}
              <span className="text-sm font-normal mr-1">{isRtl ? '\u0631.\u0639' : 'OMR'}</span>
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="h-4 w-4 text-purple-600" />
              <span className="text-xs text-muted-foreground">{isRtl ? '\u0647\u0627\u0645\u0634 \u0627\u0644\u0631\u0628\u062d' : 'Profit Margin'}</span>
            </div>
            <p className={`text-xl font-bold ${profitMargin >= 0 ? 'text-purple-700' : 'text-red-700'}`}>
              {profitMargin.toFixed(1)}%
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {isRtl ? '\u062a\u0643\u0644\u0641\u0629 \u0627\u0644\u0645\u062a\u0631' : 'Cost/m'}: {costPerMeter.toFixed(1)} {isRtl ? '\u0631.\u0639' : 'OMR'}
            </p>
          </CardContent>
        </Card>
      </div>

      <Select value={selectedProject} onValueChange={setSelectedProject}>
        <SelectTrigger className="w-full sm:w-[300px]">
          <SelectValue placeholder={isRtl ? '\u0627\u062e\u062a\u0631 \u0627\u0644\u0645\u0634\u0631\u0648\u0639' : 'Select project'} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{isRtl ? '\u0643\u0644 \u0627\u0644\u0645\u0634\u0627\u0631\u064a\u0639' : 'All Projects'}</SelectItem>
          {projects.map((p) => (
            <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" />
              {isRtl ? '\u0627\u0644\u062a\u0643\u0627\u0644\u064a\u0641 \u062d\u0633\u0628 \u0627\u0644\u0641\u0626\u0629' : 'Costs by Category'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {pieData.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
                {isRtl ? '\u0644\u0627 \u062a\u0648\u062c\u062f \u0628\u064a\u0627\u0646\u0627\u062a' : 'No data'}
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
                    formatter={(value: any) => [`${value.toLocaleString()} \u0631.\u0639`, '']}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{isRtl ? '\u0623\u0639\u0644\u0649 \u0627\u0644\u062a\u0643\u0627\u0644\u064a\u0641' : 'Top Categories'}</CardTitle>
          </CardHeader>
          <CardContent>
            {pieData.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
                {isRtl ? '\u0644\u0627 \u062a\u0648\u062c\u062f \u0628\u064a\u0627\u0646\u0627\u062a' : 'No data'}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={pieData} layout="vertical" margin={{ left: 20, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis type="number" tick={{ fontSize: 11 }} reversed={isRtl} />
                  <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={80} orientation={isRtl ? 'right' : 'left'} />
                  <Tooltip
                    contentStyle={{ direction: isRtl ? 'rtl' : 'ltr', borderRadius: 8, fontSize: 12 }}
                    formatter={(value: any) => [`${value.toLocaleString()} \u0631.\u0639`, isRtl ? '\u0627\u0644\u0645\u0628\u0644\u063a' : 'Amount']}
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

      {/* Costs list */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{isRtl ? '\u062c\u0645\u064a\u0639 \u0627\u0644\u062a\u0643\u0627\u0644\u064a\u0641 \u0627\u0644\u0645\u0633\u062c\u0644\u0629' : 'All Recorded Costs'}</CardTitle>
            <Badge variant="outline">{costs.length}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="h-32 bg-muted animate-pulse rounded" />
          ) : costs.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm">
              {isRtl ? '\u0644\u0627 \u062a\u0648\u062c\u062f \u062a\u0643\u0627\u0644\u064a\u0641' : 'No costs'}
            </div>
          ) : (
            <div className="space-y-2">
              {visibleCosts.map((c) => (
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
                      {c.project && ` \u2022 ${c.project.name}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <p className="font-semibold text-sm text-red-600">
                      {c.amount.toLocaleString()} {isRtl ? '\u0631.\u0639' : 'OMR'}
                    </p>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition">
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => {
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
                      }}>{'\u270F\uFE0F'}</Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => deleteCost(c.id)}>
                        {'\uD83D\uDDD1\uFE0F'}
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
              {hasMore && (
                <div className="pt-2 text-center">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={function() { setVisibleCount(function(prev) { return prev + 100 }) }}
                  >
                    <ChevronDown className="h-4 w-4 ml-1" />
                    {isRtl
                      ? '\u0639\u0631\u0636 \u0627\u0644\u0645\u0632\u064a\u062f (' + (costs.length - visibleCount) + ')'
                      : 'Show more (' + (costs.length - visibleCount) + ')'
                    }
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingCostId ? (isRtl ? '\u062a\u0639\u062f\u064a\u0644 \u0627\u0644\u062a\u0643\u0644\u0641\u0629' : 'Edit Cost') : (isRtl ? '\u0625\u0636\u0627\u0641\u0629 \u062a\u0643\u0644\u064a\u0641\u0629' : 'Add Cost')}</DialogTitle>
            <DialogDescription>
              {editingCostId ? (isRtl ? '\u0639\u062f\u0651\u0644 \u0628\u064a\u0627\u0646\u0627\u062a \u0627\u0644\u062a\u0643\u0644\u0641\u0629' : 'Edit cost details') : (isRtl ? '\u0633\u062c\u0651\u0644 \u062a\u0643\u0644\u0641\u0629 \u062c\u062f\u064a\u062f\u0629' : 'Record a new cost')}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{isRtl ? '\u0627\u0644\u0645\u0634\u0631\u0648\u0639' : 'Project'} *</Label>
                <Select value={formData.projectId} onValueChange={(v) => setFormData({ ...formData, projectId: v })} required>
                  <SelectTrigger><SelectValue placeholder={isRtl ? '\u0627\u062e\u062a\u0631' : 'Select'} /></SelectTrigger>
                  <SelectContent>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? '\u0627\u0644\u062a\u0627\u0631\u064a\u062e' : 'Date'} *</Label>
                <Input type="date" value={formData.date} onChange={(e) => setFormData({ ...formData, date: e.target.value })} required />
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? '\u0627\u0644\u0641\u0626\u0629' : 'Category'} *</Label>
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
                <Label>{isRtl ? '\u0627\u0644\u0645\u0628\u0644\u063a (\u0631.\u0639)' : 'Amount (OMR)'} *</Label>
                <Input type="number" step="0.01" value={formData.amount} onChange={(e) => setFormData({ ...formData, amount: e.target.value })} required />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{isRtl ? '\u0627\u0644\u0648\u0635\u0641' : 'Description'} *</Label>
              <Input value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} required />
            </div>
            <div className="space-y-1.5">
              <Label>{isRtl ? '\u0645\u0644\u0627\u062d\u0638\u0627\u062a' : 'Notes'}</Label>
              <Textarea value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} rows={2} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                {isRtl ? '\u0625\u0644\u063a\u0627\u0621' : 'Cancel'}
              </Button>
              <Button type="submit">{isRtl ? '\u062d\u0641\u0638' : 'Save'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
