     'use client'
     2→
     3→import { useEffect, useState, useMemo } from 'react'
     4→import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
     5→import { Button } from '@/components/ui/button'
     6→import { Badge } from '@/components/ui/badge'
     7→import { Input } from '@/components/ui/input'
     8→import { Label } from '@/components/ui/label'
     9→import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
    10→import { Textarea } from '@/components/ui/textarea'
    11→import {
    12→  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle
    13→} from '@/components/ui/dialog'
    14→import {
    15→  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
    16→  Cell
    17→} from 'recharts'
    18→import { Plus, DollarSign, TrendingUp, TrendingDown, Wallet, BarChart3, Search, FileText, Filter } from 'lucide-react'
    19→import { useAppStore } from '@/lib/store'
    20→import { authedFetch } from '@/lib/api-client'
    21→import { toast } from 'sonner'
    22→
    23→const categoryLabels: Record<string, { ar: string; en: string }> = {
    24→  labor: { ar: 'أجور العمال', en: 'Labor' },
    25→  housing: { ar: 'سكن', en: 'Housing' },
    26→  transport: { ar: 'نقل', en: 'Transport' },
    27→  fuel: { ar: 'ديزل', en: 'Fuel' },
    28→  maintenance: { ar: 'صيانة', en: 'Maintenance' },
    29→  parts: { ar: 'قطع غيار', en: 'Parts' },
    30→  oil: { ar: 'زيوت', en: 'Oil' },
    31→  safety: { ar: 'سلامة', en: 'Safety' },
    32→  rental: { ar: 'إيجار', en: 'Rental' },
    33→  other: { ar: 'أخرى', en: 'Other' },
    34→}
    35→
    36→const categoryColors: Record<string, string> = {
    37→  labor: '#f97316',
    38→  fuel: '#06b6d4',
    39→  maintenance: '#8b5cf6',
    40→  transport: '#10b981',
    41→  housing: '#f59e0b',
    42→  parts: '#ec4899',
    43→  oil: '#6366f1',
    44→  safety: '#ef4444',
    45→  rental: '#14b8a6',
    46→  other: '#64748b',
    47→}
    48→
    49→export default function CostsPage() {
    50→  const [costs, setCosts] = useState<any[]>([])
    51→  const [byCategory, setByCategory] = useState<any[]>([])
    52→  const [total, setTotal] = useState(0)
    53→  const [totalRentalCost, setTotalRentalCost] = useState(0)
    54→  const [grandTotal, setGrandTotal] = useState(0)
    55→  const [rentalAssets, setRentalAssets] = useState<any[]>([])
    56→  const [projects, setProjects] = useState<any[]>([])
    57→  const [loading, setLoading] = useState(true)
    58→  const [selectedProject, setSelectedProject] = useState<string>('all')
    59→  const [dialogOpen, setDialogOpen] = useState(false)
    60→  const [editingCostId, setEditingCostId] = useState<string | null>(null)
    61→  const language = useAppStore((s) => s.language)
    62→  const isRtl = language === 'ar'
    63→
    64→  const [revenue, setRevenue] = useState(0)
    65→  const [approvedReports, setApprovedReports] = useState<any[]>([])
    66→  // Search & filter
    67→  const [searchQuery, setSearchQuery] = useState('')
    68→  const [filterCategory, setFilterCategory] = useState<string>('all')
    69→
    70→  const [formData, setFormData] = useState({
    71→    projectId: '', date: new Date().toISOString().split('T')[0],
    72→    category: 'labor', description: '', amount: '', notes: '',
    73→  })
    74→
    75→  async function fetchCosts() {
    76→    setLoading(true)
    77→    try {
    78→      var costUrl = '/api/costs'
    79→      if (selectedProject !== 'all') costUrl += '?projectId=' + selectedProject
    80→      const res = await authedFetch(costUrl)
    81→      const data = await res.json()
    82→      setCosts(data.costs || [])
    83→      setByCategory(data.byCategory || [])
    84→      setTotal(data.total || 0)
    85→      setTotalRentalCost(data.totalRentalCost || 0)
    86→      setGrandTotal(data.grandTotal || 0)
    87→      setRentalAssets(data.rentalAssets || [])
    88→
    89→      var repParams = new URLSearchParams()
    90→      if (selectedProject !== 'all') repParams.set('projectId', selectedProject)
    91→      repParams.set('limit', '500')
    92→      const repRes = await authedFetch('/api/daily-reports?' + repParams.toString())
    93→      const repData = await repRes.json()
    94→      var reports = (repData.reports || []).filter(function(r: any) { return r.status === 'approved' })
    95→      var totalRev = reports.reduce(function(s: number, r: any) { return s + (r.dailyRevenue || 0) }, 0)
    96→      setRevenue(totalRev)
    97→      setApprovedReports(reports)
    98→    } catch (e) {
    99→      console.error('fetchCosts error:', e)
   100→    }
   101→    setLoading(false)
   102→  }
   103→
   104→  async function fetchProjects() {
   105→    try {
   106→      var res = await authedFetch('/api/projects/list?_t=' + Date.now(), { cache: 'no-store' })
   107→      if (!res.ok) { setProjects([]); return }
   108→      var data = await res.json()
   109→      setProjects(data.projects || [])
   110→    } catch {
   111→      setProjects([])
   112→    }
   113→  }
   114→
   115→  useEffect(function() {
   116→    fetchCosts()
   117→    fetchProjects()
   118→  // eslint-disable-next-line react-hooks/exhaustive-deps
   119→  }, [])
   120→
   121→  useEffect(function() {
   122→    fetchCosts()
   123→  // eslint-disable-next-line react-hooks/exhaustive-deps
   124→  }, [selectedProject])
   125→
   126→  // Filtered costs for display
   127→  var filteredCosts = useMemo(function() {
   128→    return costs.filter(function(c) {
   129→      var matchSearch = !searchQuery ||
   130→        (c.description && c.description.toLowerCase().includes(searchQuery.toLowerCase())) ||
   131→        (c.notes && c.notes.toLowerCase().includes(searchQuery.toLowerCase())) ||
   132→        (c.project && c.project.name && c.project.name.toLowerCase().includes(searchQuery.toLowerCase()))
   133→      var matchCat = filterCategory === 'all' || c.category === filterCategory
   134→      return matchSearch && matchCat
   135→    })
   136→  }, [costs, searchQuery, filterCategory])
   137→
   138→  var filteredTotal = useMemo(function() {
   139→    return filteredCosts.reduce(function(s: number, c: any) { return s + c.amount }, 0)
   140→  }, [filteredCosts])
   141→
   142→  async function handleSubmit(e: React.FormEvent) {
   143→    e.preventDefault()
   144→    try {
   145→      var url = editingCostId ? '/api/costs/' + editingCostId : '/api/costs'
   146→      var method = editingCostId ? 'PUT' : 'POST'
   147→      var res = await authedFetch(url, {
   148→        method,
   149→        headers: { 'Content-Type': 'application/json' },
   150→        body: JSON.stringify(formData),
   151→      })
   152→      if (res.ok) {
   153→        toast.success(editingCostId ? (isRtl ? 'تم تحديث التكلفة' : 'Cost updated') : (isRtl ? 'تم إضافة التكلفة' : 'Cost added'))
   154→        setDialogOpen(false)
   155→        setEditingCostId(null)
   156→        setFormData({
   157→          projectId: projects[0]?.id || '', date: new Date().toISOString().split('T')[0],
   158→          category: 'labor', description: '', amount: '', notes: '',
   159→        })
   160→        fetchCosts()
   161→      }
   162→    } catch {
   163→      toast.error(isRtl ? 'حدث خطأ' : 'Error')
   164→    }
   165→  }
   166→
   167→  async function deleteCost(id: string) {
   168→    if (!confirm(isRtl ? 'هل أنت متأكد من حذف هذه التكلفة؟' : 'Are you sure?')) return
   169→    try {
   170→      var res = await authedFetch('/api/costs/' + id, { method: 'DELETE' })
   171→      if (res.ok) {
   172→        toast.success(isRtl ? 'تم حذف التكلفة' : 'Cost deleted')
   173→        fetchCosts()
   174→      }
   175→    } catch {
   176→      toast.error(isRtl ? 'حدث خطأ' : 'Error')
   177→    }
   178→  }
   179→
   180→  var netProfit = revenue - grandTotal
   181→  var profitMargin = revenue > 0 ? (netProfit / revenue) * 100 : 0
   182→  var totalMeters = approvedReports.reduce(function(s, r) { return s + (r.dailyMeters || 0) }, 0)
   183→  var costPerMeter = totalMeters > 0 ? total / totalMeters : 0
   184→
   185→  var pieData = byCategory.map(function(c) {
   186→    return {
   187→      name: isRtl ? (categoryLabels[c.category] ? categoryLabels[c.category].ar : c.category) : (categoryLabels[c.category] ? categoryLabels[c.category].en : c.category),
   188→      value: c.amount,
   189→      color: categoryColors[c.category] || '#94a3b8',
   190→    }
   191→  })
   192→
   193→  return (
   194→    <div className="space-y-5">
   195→      {/* Page Header */}
   196→      <div className="flex items-center justify-between flex-wrap gap-3">
   197→        <div>
   198→          <h1 className="text-2xl font-bold tracking-tight">{isRtl ? 'التكاليف والإيرادات' : 'Costs & Revenue'}</h1>
   199→          <p className="text-sm text-muted-foreground mt-1">
   200→            {isRtl ? 'متابعة التكاليف والإيرادات وحساب الأرباح' : 'Track costs, revenue, and profit'}
   201→          </p>
   202→        </div>
   203→        <Button onClick={function() {
   204→          setEditingCostId(null)
   205→          setFormData({
   206→            projectId: projects[0]?.id || '', date: new Date().toISOString().split('T')[0],
   207→            category: 'labor', description: '', amount: '', notes: '',
   208→          })
   209→          setDialogOpen(true)
   210→        }} className="shadow-sm">
   211→          <Plus className="h-4 w-4 ml-2" />
   212→          {isRtl ? 'إضافة تكلفة' : 'Add Cost'}
   213→        </Button>
   214→      </div>
   215→
   216→      {/* Summary Cards - Modern Design */}
   217→      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
   218→        <Card className="border-0 shadow-sm bg-gradient-to-br from-emerald-500 to-emerald-600 text-white">
   219→          <CardContent className="p-4">
   220→            <div className="flex items-center gap-2 mb-2">
   221→              <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center">
   222→                <TrendingUp className="h-4 w-4" />
   223→              </div>
   224→              <span className="text-xs text-white/80">{isRtl ? 'الإيرادات' : 'Revenue'}</span>
   225→            </div>
   226→            <p className="text-xl font-bold">
   227→              {revenue.toLocaleString(isRtl ? 'ar-EG' : 'en-US', { maximumFractionDigits: 0 })}
   228→              <span className="text-sm font-normal ml-1 text-white/80">{isRtl ? 'ر.ع' : 'OMR'}</span>
   229→            </p>
   230→            <p className="text-xs text-white/60 mt-1">
   231→              {approvedReports.length} {isRtl ? 'تقرير معتمد' : 'approved reports'}
   232→            </p>
   233→          </CardContent>
   234→        </Card>
   235→        <Card className="border-0 shadow-sm bg-gradient-to-br from-rose-500 to-rose-600 text-white">
   236→          <CardContent className="p-4">
   237→            <div className="flex items-center gap-2 mb-2">
   238→              <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center">
   239→                <TrendingDown className="h-4 w-4" />
   240→              </div>
   241→              <span className="text-xs text-white/80">{isRtl ? 'التكاليف الكلية' : 'Total Costs'}</span>
   242→            </div>
   243→            <p className="text-xl font-bold">
   244→              {grandTotal.toLocaleString(isRtl ? 'ar-EG' : 'en-US', { maximumFractionDigits: 0 })}
   245→              <span className="text-sm font-normal ml-1 text-white/80">{isRtl ? 'ر.ع' : 'OMR'}</span>
   246→            </p>
   247→            {totalRentalCost > 0 && (
   248→              <p className="text-xs text-white/60 mt-1">
   249→                {isRtl ? 'شامل ' + totalRentalCost.toLocaleString(isRtl ? 'ar-EG' : 'en-US', { maximumFractionDigits: 0 }) + ' ر.ع إيجارات' : 'incl. ' + totalRentalCost.toLocaleString('en-US', { maximumFractionDigits: 0 }) + ' OMR rentals'}
   250→              </p>
   251→            )}
   252→          </CardContent>
   253→        </Card>
   254→        <Card className={"border-0 shadow-sm bg-gradient-to-br text-white " + (netProfit >= 0 ? 'from-blue-500 to-blue-600' : 'from-red-500 to-red-600')}>
   255→          <CardContent className="p-4">
   256→            <div className="flex items-center gap-2 mb-2">
   257→              <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center">
   258→                <Wallet className="h-4 w-4" />
   259→              </div>
   260→              <span className="text-xs text-white/80">{isRtl ? 'صافي الربح' : 'Net Profit'}</span>
   261→            </div>
   262→            <p className="text-xl font-bold">
   263→              {netProfit.toLocaleString(isRtl ? 'ar-EG' : 'en-US', { maximumFractionDigits: 0 })}
   264→              <span className="text-sm font-normal ml-1 text-white/80">{isRtl ? 'ر.ع' : 'OMR'}</span>
   265→            </p>
   266→          </CardContent>
   267→        </Card>
   268→        <Card className="border-0 shadow-sm bg-gradient-to-br from-violet-500 to-violet-600 text-white">
   269→          <CardContent className="p-4">
   270→            <div className="flex items-center gap-2 mb-2">
   271→              <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center">
   272→                <DollarSign className="h-4 w-4" />
   273→              </div>
   274→              <span className="text-xs text-white/80">{isRtl ? 'هامش الربح' : 'Profit Margin'}</span>
   275→            </div>
   276→            <p className="text-xl font-bold">{profitMargin.toFixed(1)}%</p>
   277→            <p className="text-xs text-white/60 mt-1">
   278→              {isRtl ? 'تكلفة المتر' : 'Cost/m'}: {costPerMeter.toFixed(1)} {isRtl ? 'ر.ع' : 'OMR'}
   279→            </p>
   280→          </CardContent>
   281→        </Card>
   282→      </div>
   283→
   284→      {/* Project Filter */}
   285→      <div className="flex items-center gap-3 flex-wrap">
   286→        <Select value={selectedProject} onValueChange={setSelectedProject}>
   287→          <SelectTrigger className="w-full sm:w-[280px]">
   288→            <SelectValue placeholder={isRtl ? 'اختر المشروع' : 'Select project'} />
   289→          </SelectTrigger>
   290→          <SelectContent>
   291→            <SelectItem value="all">{isRtl ? 'كل المشاريع' : 'All Projects'}</SelectItem>
   292→            {projects.map(function(p) {
   293→              return <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
   294→            })}
   295→          </SelectContent>
   296→        </Select>
   297→        <Badge variant="secondary" className="text-xs px-2.5 py-1">
   298→          {costs.length} {isRtl ? 'فاتورة' : 'invoices'}
   299→        </Badge>
   300→        <Badge variant="outline" className="text-xs px-2.5 py-1">
   301→          {filteredCosts.length} {isRtl ? 'معروضة' : 'shown'}
   302→        </Badge>
   303→      </div>
   304→
   305→      {/* Active Rental Assets Details */}
   306→      {rentalAssets.length > 0 && (
   307→        <Card className="shadow-sm">
   308→          <CardHeader className="pb-3">
   309→            <CardTitle className="flex items-center gap-2 text-base">
   310→              <div className="w-7 h-7 rounded-md bg-teal-100 text-teal-600 flex items-center justify-center">
   311→                <Wallet className="h-4 w-4" />
   312→              </div>
   313→              {isRtl ? 'إيجارات المعدات الشهرية (من قسم المعدات)' : 'Monthly Equipment Rentals (from Equipment section)'}
   314→            </CardTitle>
   315→          </CardHeader>
   316→          <CardContent>
   317→            <div className="space-y-2">
   318→              {rentalAssets.map(function(ra, idx) {
   319→                return (
   320→                  <div key={ra.id || idx} className="flex items-center justify-between p-3 rounded-xl border hover:bg-teal-50/50 transition-colors">
   321→                    <div className="flex-1 min-w-0">
   322→                      <p className="font-medium text-sm truncate">{ra.name}</p>
   323→                      <p className="text-xs text-muted-foreground">{ra.supplier} {ra.projectName !== '-' ? '• ' + ra.projectName : ''}</p>
   324→                    </div>
   325→                    <span className="font-semibold text-sm text-teal-700 shrink-0 mr-3">{ra.rentalCost.toLocaleString(isRtl ? 'ar-EG' : 'en-US', { maximumFractionDigits: 0 })} {isRtl ? 'ر.ع/شهر' : 'OMR/mo'}</span>
   326→                  </div>
   327→                )
   328→              })}
   329→              <div className="flex items-center justify-between pt-2 mt-2 border-t font-semibold">
   330→                <span className="text-sm">{isRtl ? 'الإجمالي' : 'Total'}</span>
   331→                <span className="text-teal-700">{totalRentalCost.toLocaleString(isRtl ? 'ar-EG' : 'en-US', { maximumFractionDigits: 0 })} {isRtl ? 'ر.ع/شهر' : 'OMR/mo'}</span>
   332→              </div>
   333→            </div>
   334→          </CardContent>
   335→        </Card>
   336→      )}
   337→
   338→      {/* Chart */}
   339→      <Card className="shadow-sm">
   340→        <CardHeader className="pb-3">
   341→          <CardTitle className="flex items-center gap-2 text-base">
   342→            <div className="w-7 h-7 rounded-md bg-primary/10 text-primary flex items-center justify-center">
   343→              <BarChart3 className="h-4 w-4" />
   344→            </div>
   345→            {isRtl ? 'التكاليف حسب الفئة' : 'Costs by Category'}
   346→          </CardTitle>
   347→        </CardHeader>
   348→        <CardContent>
   349→          {pieData.length === 0 ? (
   350→            <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
   351→              {isRtl ? 'لا توجد بيانات' : 'No data'}
   352→            </div>
   353→          ) : (
   354→            <ResponsiveContainer width="100%" height={Math.max(300, pieData.length * 45)}>
   355→              <BarChart data={pieData} layout="vertical" margin={{ left: 20, right: 20 }}>
   356→                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
   357→                <XAxis type="number" tick={{ fontSize: 11 }} reversed={isRtl} />
   358→                <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={80} orientation={isRtl ? 'right' : 'left'} />
   359→                <Tooltip
   360→                  contentStyle={{ direction: isRtl ? 'rtl' : 'ltr', borderRadius: 8, fontSize: 12 }}
   361→                  formatter={function(value: any) { return [value.toLocaleString() + ' ر.ع', isRtl ? 'المبلغ' : 'Amount'] }}
   362→                />
   363→                <Bar dataKey="value" radius={[0, 4, 4, 0]}>
   364→                  {pieData.map(function(entry, idx) {
   365→                    return <Cell key={idx} fill={entry.color} />
   366→                  })}
   367→                </Bar>
   368→              </BarChart>
   369→            </ResponsiveContainer>
   370→          )}
   371→        </CardContent>
   372→      </Card>
   373→
   374→      {/* Costs List - Full Table View */}
   375→      <Card className="shadow-sm">
   376→        <CardHeader className="pb-3">
   377→          <div className="flex items-center justify-between flex-wrap gap-3">
   378→            <CardTitle className="flex items-center gap-2 text-base">
   379→              <div className="w-7 h-7 rounded-md bg-rose-100 text-rose-600 flex items-center justify-center">
   380→                <FileText className="h-4 w-4" />
   381→              </div>
   382→              {isRtl ? 'التكاليف المسجلة' : 'Recorded Costs'}
   383→            </CardTitle>
   384→            <span className="text-sm font-semibold text-muted-foreground">
   385→              {filteredTotal.toLocaleString(isRtl ? 'ar-EG' : 'en-US', { maximumFractionDigits: 0 })} {isRtl ? 'ر.ع' : 'OMR'}
   386→            </span>
   387→          </div>
   388→
   389→          {/* Search & Filter Bar */}
   390→          <div className="flex items-center gap-2 mt-3 flex-wrap">
   391→            <div className="relative flex-1 min-w-[200px]">
   392→              <Search className={"absolute top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground " + (isRtl ? "right-3" : "left-3")} />
   393→              <Input
   394→                placeholder={isRtl ? 'بحث في التكاليف...' : 'Search costs...'}
   395→                value={searchQuery}
   396→                onChange={function(e) { setSearchQuery(e.target.value) }}
   397→                className={isRtl ? "pr-9" : "pl-9"}
   398→              />
   399→            </div>
   400→            <div className="flex items-center gap-1.5">
   401→              <Filter className="h-4 w-4 text-muted-foreground" />
   402→              <Select value={filterCategory} onValueChange={setFilterCategory}>
   403→                <SelectTrigger className="w-[160px]">
   404→                  <SelectValue placeholder={isRtl ? 'الفئة' : 'Category'} />
   405→                </SelectTrigger>
   406→                <SelectContent>
   407→                  <SelectItem value="all">{isRtl ? 'كل الفئات' : 'All Categories'}</SelectItem>
   408→                  {Object.keys(categoryLabels).map(function(key) {
   409→                    return <SelectItem key={key} value={key}>{isRtl ? categoryLabels[key].ar : categoryLabels[key].en}</SelectItem>
   410→                  })}
   411→                </SelectContent>
   412→              </Select>
   413→            </div>
   414→          </div>
   415→        </CardHeader>
   416→        <CardContent>
   417→          {loading ? (
   418→            <div className="h-32 bg-muted animate-pulse rounded-xl" />
   419→          ) : filteredCosts.length === 0 ? (
   420→            <div className="py-12 text-center text-muted-foreground text-sm">
   421→              <FileText className="h-10 w-10 mx-auto mb-3 opacity-30" />
   422→              {costs.length === 0
   423→                ? (isRtl ? 'لا توجد تكاليف مسجلة' : 'No costs recorded')
   424→                : (isRtl ? 'لا توجد نتائج مطابقة للبحث' : 'No matching results')
   425→              }
   426→            </div>
   427→          ) : (
   428→            <div className="overflow-x-auto">
   429→              <table className="w-full text-sm">
   430→                <thead>
   431→                  <tr className="border-b bg-muted/30">
   432→                    <th className="p-2.5 text-right font-medium text-xs uppercase tracking-wider text-muted-foreground w-8">#</th>
   433→                    <th className="p-2.5 text-right font-medium text-xs uppercase tracking-wider text-muted-foreground">{isRtl ? 'التاريخ' : 'Date'}</th>
   434→                    <th className="p-2.5 text-right font-medium text-xs uppercase tracking-wider text-muted-foreground">{isRtl ? 'الفئة' : 'Category'}</th>
   435→                    <th className="p-2.5 text-right font-medium text-xs uppercase tracking-wider text-muted-foreground">{isRtl ? 'الوصف' : 'Description'}</th>
   436→                    <th className="p-2.5 text-right font-medium text-xs uppercase tracking-wider text-muted-foreground">{isRtl ? 'المشروع' : 'Project'}</th>
   437→                    <th className="p-2.5 text-right font-medium text-xs uppercase tracking-wider text-muted-foreground">{isRtl ? 'المبلغ' : 'Amount'}</th>
   438→                    <th className="p-2.5 text-right font-medium text-xs uppercase tracking-wider text-muted-foreground w-20">{isRtl ? 'إجراءات' : 'Actions'}</th>
   439→                  </tr>
   440→                </thead>
   441→                <tbody>
   442→                  {filteredCosts.map(function(c, idx) {
   443→                    var catColor = categoryColors[c.category] || '#94a3b8'
   444→                    var catLabel = isRtl
   445→                      ? (categoryLabels[c.category] ? categoryLabels[c.category].ar : c.category)
   446→                      : (categoryLabels[c.category] ? categoryLabels[c.category].en : c.category)
   447→                    return (
   448→                      <tr key={c.id} className="border-b hover:bg-muted/20 transition-colors group">
   449→                        <td className="p-2.5 text-muted-foreground text-xs">{idx + 1}</td>
   450→                        <td className="p-2.5 whitespace-nowrap text-xs">{new Date(c.date).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US')}</td>
   451→                        <td className="p-2.5">
   452→                          <Badge
   453→                            variant="secondary"
   454→                            className="text-xs font-medium px-2 py-0.5"
   455→                            style={{ backgroundColor: catColor + '18', color: catColor, borderColor: catColor + '30' }}
   456→                          >
   457→                            {catLabel}
   458→                          </Badge>
   459→                        </td>
   460→                        <td className="p-2.5 max-w-[200px]">
   461→                          <p className="font-medium text-sm truncate">{c.description}</p>
   462→                          {c.notes && <p className="text-xs text-muted-foreground truncate mt-0.5">{c.notes}</p>}
   463→                        </td>
   464→                        <td className="p-2.5 text-xs text-muted-foreground">{c.project ? c.project.name : '-'}</td>
   465→                        <td className="p-2.5 font-semibold text-rose-600 whitespace-nowrap">
   466→                          {c.amount.toLocaleString()} {isRtl ? 'ر.ع' : 'OMR'}
   467→                        </td>
   468→                        <td className="p-2.5">
   469→                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
   470→                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={function() {
   471→                              setEditingCostId(c.id)
   472→                              setFormData({
   473→                                projectId: c.projectId || '',
   474→                                date: new Date(c.date).toISOString().split('T')[0],
   475→                                category: c.category,
   476→                                description: c.description,
   477→                                amount: String(c.amount),
   478→                                notes: c.notes || '',
   479→                              })
   480→                              setDialogOpen(true)
   481→                            }}>
   482→                              ✏️
   483→                            </Button>
   484→                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={function() { deleteCost(c.id) }}>
   485→                              🗑️
   486→                            </Button>
   487→                          </div>
   488→                        </td>
   489→                      </tr>
   490→                    )
   491→                  })}
   492→                </tbody>
   493→                <tfoot>
   494→                  <tr className="border-t-2 bg-muted/20 font-bold">
   495→                    <td className="p-2.5" colSpan={5}>{isRtl ? 'إجمالي المعروض' : 'Shown Total'}</td>
   496→                    <td className="p-2.5 text-rose-600">{filteredTotal.toLocaleString(isRtl ? 'ar-EG' : 'en-US', { maximumFractionDigits: 0 })} {isRtl ? 'ر.ع' : 'OMR'}</td>
   497→                    <td></td>
   498→                  </tr>
   499→                </tfoot>
   500→              </table>
   501→            </div>
   502→          )}
   503→        </CardContent>
   504→      </Card>
   505→
   506→      {/* Add/Edit Dialog */}
   507→      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
   508→        <DialogContent className="max-w-lg">
   509→          <DialogHeader>
   510→            <DialogTitle>{editingCostId ? (isRtl ? 'تعديل التكلفة' : 'Edit Cost') : (isRtl ? 'إضافة تكلفة' : 'Add Cost')}</DialogTitle>
   511→            <DialogDescription>
   512→              {editingCostId ? (isRtl ? 'عدّل بيانات التكلفة' : 'Edit cost details') : (isRtl ? 'سجّل تكلفة جديدة' : 'Record a new cost')}
   513→            </DialogDescription>
   514→          </DialogHeader>
   515→          <form onSubmit={handleSubmit} className="space-y-3">
   516→            <div className="grid grid-cols-2 gap-3">
   517→              <div className="space-y-1.5">
   518→                <Label>{isRtl ? 'المشروع' : 'Project'} *</Label>
   519→                <Select value={formData.projectId} onValueChange={function(v) { setFormData(Object.assign({}, formData, { projectId: v })) }} required>
   520→                  <SelectTrigger><SelectValue placeholder={isRtl ? 'اختر' : 'Select'} /></SelectTrigger>
   521→                  <SelectContent>
   522→                    {projects.map(function(p) {
   523→                      return <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
   524→                    })}
   525→                  </SelectContent>
   526→                </Select>
   527→              </div>
   528→              <div className="space-y-1.5">
   529→                <Label>{isRtl ? 'التاريخ' : 'Date'} *</Label>
   530→                <Input type="date" value={formData.date} onChange={function(e) { setFormData(Object.assign({}, formData, { date: e.target.value })) }} required />
   531→              </div>
   532→              <div className="space-y-1.5">
   533→                <Label>{isRtl ? 'الفئة' : 'Category'} *</Label>
   534→                <Select value={formData.category} onValueChange={function(v) { setFormData(Object.assign({}, formData, { category: v })) }}>
   535→                  <SelectTrigger><SelectValue /></SelectTrigger>
   536→                  <SelectContent>
   537→                    {Object.keys(categoryLabels).map(function(key) {
   538→                      return <SelectItem key={key} value={key}>{isRtl ? categoryLabels[key].ar : categoryLabels[key].en}</SelectItem>
   539→                    })}
   540→                  </SelectContent>
   541→                </Select>
   542→              </div>
   543→              <div className="space-y-1.5">
   544→                <Label>{isRtl ? 'المبلغ (ر.ع)' : 'Amount (OMR)'} *</Label>
   545→                <Input type="number" step="0.01" value={formData.amount} onChange={function(e) { setFormData(Object.assign({}, formData, { amount: e.target.value })) }} required />
   546→              </div>
   547→            </div>
   548→            <div className="space-y-1.5">
   549→              <Label>{isRtl ? 'الوصف' : 'Description'} *</Label>
   550→              <Input value={formData.description} onChange={function(e) { setFormData(Object.assign({}, formData, { description: e.target.value })) }} required />
   551→            </div>
   552→            <div className="space-y-1.5">
   553→              <Label>{isRtl ? 'ملاحظات' : 'Notes'}</Label>
   554→              <Textarea value={formData.notes} onChange={function(e) { setFormData(Object.assign({}, formData, { notes: e.target.value })) }} rows={2} />
   555→            </div>
   556→            <DialogFooter>
   557→              <Button type="button" variant="outline" onClick={function() { setDialogOpen(false) }}>
   558→                {isRtl ? 'إلغاء' : 'Cancel'}
   559→              </Button>
   560→              <Button type="submit">{isRtl ? 'حفظ' : 'Save'}</Button>
   561→            </DialogFooter>
   562→          </form>
   563→        </DialogContent>
   564→      </Dialog>
   565→    </div>
   566→  )
   567→}
   568→
