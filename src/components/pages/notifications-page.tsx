'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import {
  AlertTriangle, Bell, CheckCircle2, Info, XCircle,
  FileDown, FileSpreadsheet, Filter, Activity, ChevronLeft, ChevronRight,
  Plus, Pencil, Trash2, ThumbsUp, ThumbsDown, ArrowRight, ArrowLeft
} from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { authedFetch } from '@/lib/api-client'
import { toast } from 'sonner'

// ==================== Types ====================
interface ChangeDiff {
  field: string
  fieldEn: string
  old: string
  new: string
}

interface AuditChangeDetails {
  summary: string
  changes: ChangeDiff[]
}

// ==================== Config ====================
const severityConfig: Record<string, { ar: string; en: string; color: string; icon: any; bgColor: string; iconColor: string }> = {
  critical: { ar: 'حرج', en: 'Critical', color: 'destructive', icon: XCircle, bgColor: 'bg-red-50', iconColor: 'text-red-600' },
  warning: { ar: 'تحذير', en: 'Warning', color: 'default', icon: AlertTriangle, bgColor: 'bg-orange-50', iconColor: 'text-orange-600' },
  info: { ar: 'معلومة', en: 'Info', color: 'secondary', icon: Info, bgColor: 'bg-blue-50', iconColor: 'text-blue-600' },
}

const typeLabels: Record<string, { ar: string; en: string }> = {
  safety_missing: { ar: 'عدم تعبئة تقرير السلامة', en: 'Safety report missing' },
  work_stopped: { ar: 'توقف العمل', en: 'Work stopped' },
  low_production: { ar: 'انخفاض الإنتاج', en: 'Low production' },
  equipment_breakdown: { ar: 'عطل في المعدة', en: 'Equipment breakdown' },
  mass_absence: { ar: 'غياب جماعي', en: 'Mass absence' },
  cost_overrun: { ar: 'تجاوز التكاليف', en: 'Cost overrun' },
  deadline_near: { ar: 'اقتراب موعد التسليم', en: 'Deadline near' },
  safety_alert: { ar: 'تنبيه سلامة', en: 'Safety alert' },
  report_delay: { ar: 'تأخير اعتماد التقرير', en: 'Report approval delay' },
}

const entityLabels: Record<string, { ar: string; en: string }> = {
  project: { ar: 'المشروع', en: 'Project' },
  daily_report: { ar: 'التقرير اليومي', en: 'Daily Report' },
  safety_report: { ar: 'تقرير السلامة', en: 'Safety Report' },
  cost: { ar: 'التكلفة', en: 'Cost' },
  equipment: { ar: 'المعدة', en: 'Equipment' },
  drive_line: { ar: 'خط الحفر', en: 'Drive Line' },
  finishing: { ar: 'التشطيب', en: 'Finishing' },
  company_asset: { ar: 'أصل الشركة', en: 'Company Asset' },
}

const actionLabels: Record<string, { ar: string; en: string; icon: any; color: string }> = {
  create: { ar: 'إنشاء', en: 'Create', icon: Plus, color: 'bg-green-100 text-green-700' },
  update: { ar: 'تعديل', en: 'Update', icon: Pencil, color: 'bg-blue-100 text-blue-700' },
  delete: { ar: 'حذف', en: 'Delete', icon: Trash2, color: 'bg-red-100 text-red-700' },
  approve: { ar: 'اعتماد', en: 'Approve', icon: ThumbsUp, color: 'bg-emerald-100 text-emerald-700' },
  reject: { ar: 'رفض', en: 'Reject', icon: ThumbsDown, color: 'bg-amber-100 text-amber-700' },
}

// ==================== Helper: Parse Details ====================
function parseDetails(details: string | null | undefined): AuditChangeDetails | null {
  if (!details) return null
  try {
    const parsed = JSON.parse(details)
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.changes) && parsed.changes.length > 0) {
      return parsed as AuditChangeDetails
    }
    return null
  } catch {
    return null
  }
}

// ==================== Component: Diff Renderer ====================
function DiffRenderer({ details, isRtl }: { details: AuditChangeDetails; isRtl: boolean }) {
  const Arrow = isRtl ? ArrowLeft : ArrowRight

  return (
    <div className="mt-1.5 space-y-1.5">
      {details.summary && (
        <p className="text-xs font-medium text-muted-foreground mb-1.5">{details.summary}</p>
      )}
      {details.changes.map((change, idx) => (
        <div
          key={idx}
          className="flex items-start gap-2 text-xs bg-muted/50 rounded-md px-2.5 py-1.5 border border-border/50"
        >
          <span className="font-medium text-foreground shrink-0 min-w-[80px] sm:min-w-[100px]">
            {isRtl ? change.field : change.fieldEn}:
          </span>
          <span className="text-red-600 bg-red-50 px-1.5 py-0.5 rounded line-through font-mono break-all">
            {change.old}
          </span>
          <Arrow className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
          <span className="text-green-700 bg-green-50 px-1.5 py-0.5 rounded font-mono font-medium break-all">
            {change.new}
          </span>
        </div>
      ))}
    </div>
  )
}

// ==================== Component: Expanded Log ====================
function LogEntry({ log, isRtl }: { log: any; isRtl: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const actionConfig = actionLabels[log.action] || actionLabels.update
  const ActionIcon = actionConfig.icon
  const entityLabel = entityLabels[log.entity] || { ar: log.entity, en: log.entity }
  const diffDetails = parseDetails(log.details)
  const isUpdateWithChanges = log.action === 'update' && diffDetails

  return (
    <Card
      className={`cursor-pointer transition hover:shadow-sm ${
        log.action === 'delete'
          ? 'border-r-4 border-r-red-400'
          : log.action === 'create'
          ? 'border-r-4 border-r-green-400'
          : ''
      }`}
      onClick={() => setExpanded(!expanded)}
    >
      <CardContent className="p-3">
        <div className="flex items-center gap-3">
          {/* Action Icon */}
          <div className={`w-9 h-9 rounded-lg ${actionConfig.color} flex items-center justify-center shrink-0`}>
            <ActionIcon className="h-4 w-4" />
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm">
                {log.user?.name || (isRtl ? 'غير معروف' : 'Unknown')}
              </span>
              <Badge variant="outline" className={`text-xs ${actionConfig.color} border-0`}>
                {isRtl ? actionConfig.ar : actionConfig.en}
              </Badge>
              <Badge variant="secondary" className="text-xs">
                {isRtl ? entityLabel.ar : entityLabel.en}
              </Badge>
              {isUpdateWithChanges && (
                <Badge variant="outline" className="text-xs bg-blue-50 text-blue-600 border-blue-200">
                  {diffDetails.changes.length} {isRtl ? 'تغيير' : 'change'}{diffDetails.changes.length > 1 ? 's' : ''}
                </Badge>
              )}
            </div>

            {/* Summary line (truncated) */}
            {!isUpdateWithChanges && (
              <p className="text-sm text-muted-foreground mt-0.5 truncate">
                {log.details || '-'}
              </p>
            )}
            {isUpdateWithChanges && !expanded && (
              <p className="text-sm text-muted-foreground mt-0.5">
                {diffDetails.summary}
                <span className="text-xs ml-1 text-primary">
                  ({isRtl ? 'انقر للتوسيع' : 'click to expand'})
                </span>
              </p>
            )}

            {/* Expanded: show diff or full details */}
            {expanded && isUpdateWithChanges && (
              <DiffRenderer details={diffDetails} isRtl={isRtl} />
            )}
            {expanded && !isUpdateWithChanges && log.details && (
              <p className="text-sm text-muted-foreground mt-1 bg-muted/50 rounded-md px-2.5 py-1.5">
                {log.details}
              </p>
            )}

            {/* Project + Time */}
            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
              {log.project && (
                <span>{log.project.name} ({log.project.code})</span>
              )}
              <span>{new Date(log.createdAt).toLocaleString(isRtl ? 'ar-EG' : 'en-US')}</span>
            </div>
          </div>

          {/* Expand indicator */}
          <div className={`transition-transform shrink-0 ${expanded ? 'rotate-180' : ''}`}>
            <ChevronLeft className="h-4 w-4 text-muted-foreground" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ==================== Main Component ====================
export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const language = useAppStore((s) => s.language)
  const token = useAppStore((s) => s.token)
  const isRtl = language === 'ar'

  // Monitor state
  const [logs, setLogs] = useState<any[]>([])
  const [logTotal, setLogTotal] = useState(0)
  const [logPage, setLogPage] = useState(1)
  const [logLoading, setLogLoading] = useState(true)
  const [entityStats, setEntityStats] = useState<any[]>([])
  const [actionStats, setActionStats] = useState<any[]>([])
  const [usersList, setUsersList] = useState<any[]>([])
  const [filterEntity, setFilterEntity] = useState('all')
  const [filterAction, setFilterAction] = useState('all')
  const [filterUser, setFilterUser] = useState('all')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')
  const [activeTab, setActiveTab] = useState('notifications')

  // ==================== Notifications ====================
  const fetchNotifications = useCallback(async () => {
    setLoading(true)
    const res = await authedFetch('/api/notifications')
    const data = await res.json()
    setNotifications(data.notifications || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!token) return
    fetchNotifications()
  }, [token, fetchNotifications])

  async function markAsRead(id: string) {
    await authedFetch(`/api/notifications/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ read: true }),
    })
    fetchNotifications()
  }

  async function markAllAsRead() {
    const res = await authedFetch('/api/notifications/batch', { method: 'PUT' })
    if (res.ok) {
      toast.success(isRtl ? 'تم تعليم الكل كمقروء' : 'All marked as read')
      fetchNotifications()
    }
  }

  const unreadCount = useMemo(() => notifications.filter(n => !n.read).length, [notifications])

  // ==================== Audit Logs ====================
  const fetchLogs = useCallback(async () => {
    setLogLoading(true)
    const params = new URLSearchParams()
    if (filterEntity !== 'all') params.set('entity', filterEntity)
    if (filterAction !== 'all') params.set('action', filterAction)
    if (filterUser !== 'all') params.set('userId', filterUser)
    if (filterDateFrom) params.set('dateFrom', filterDateFrom)
    if (filterDateTo) params.set('dateTo', filterDateTo)
    params.set('page', String(logPage))
    params.set('limit', '50')

    const res = await authedFetch(`/api/audit-logs?${params.toString()}`)
    if (res.ok) {
      const data = await res.json()
      setLogs(data.logs || [])
      setLogTotal(data.total || 0)
      setEntityStats(data.entityStats || [])
      setActionStats(data.actionStats || [])
      setUsersList(data.users || [])
    }
    setLogLoading(false)
  }, [filterEntity, filterAction, filterUser, filterDateFrom, filterDateTo, logPage])

  useEffect(() => {
    if (!token || activeTab !== 'monitor') return
    fetchLogs()
  }, [token, activeTab, fetchLogs])

  // Reset page on filter change
  useEffect(() => {
    setLogPage(1)
  }, [filterEntity, filterAction, filterUser, filterDateFrom, filterDateTo])

  // ==================== Export Functions ====================
  function exportCSV() {
    const t = (item: { ar: string; en: string }) => (isRtl ? item.ar : item.en)
    const header = isRtl
      ? ['التاريخ', 'المستخدم', 'الإجراء', 'القسم', 'التفاصيل', 'المشروع']
      : ['Date', 'User', 'Action', 'Entity', 'Details', 'Project']
    const rows = logs.map((log: any) => {
      // For CSV, flatten diff details into readable text
      let detailsStr = log.details || '-'
      const diff = parseDetails(log.details)
      if (diff) {
        detailsStr = diff.summary + ' | ' + diff.changes.map(
          (c) => `${isRtl ? c.field : c.fieldEn}: ${c.old} → ${c.new}`
        ).join('; ')
      }
      return [
        new Date(log.createdAt).toLocaleString(isRtl ? 'ar-EG' : 'en-US'),
        log.user?.name || '-',
        t(actionLabels[log.action] || { ar: log.action, en: log.action }),
        t(entityLabels[log.entity] || { ar: log.entity, en: log.entity }),
        detailsStr,
        log.project?.name || '-',
      ]
    })
    const csvContent = '\uFEFF' + [header, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}").join(',')).join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(isRtl ? 'تم تصدير السجلات بنجاح' : 'Exported successfully')
  }

  function exportJSON() {
    const exportData = logs.map((log: any) => {
      const diff = parseDetails(log.details)
      return {
        ...log,
        detailsParsed: diff || log.details,
      }
    })
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(isRtl ? 'تم تصدير السجلات بنجاح' : 'Exported successfully')
  }

  // ==================== Render ====================
  const totalPages = Math.ceil(logTotal / 50)

  return (
    <div className="space-y-4">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="notifications" className="gap-2">
            <Bell className="h-4 w-4" />
            {isRtl ? 'التنبيهات' : 'Notifications'}
            {unreadCount > 0 && (
              <span className="bg-primary text-primary-foreground text-xs rounded-full h-5 min-w-5 flex items-center justify-center px-1">
                {unreadCount}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="monitor" className="gap-2">
            <Activity className="h-4 w-4" />
            {isRtl ? 'سجل المراقبة' : 'Activity Monitor'}
          </TabsTrigger>
        </TabsList>

        {/* ========== Notifications Tab ========== */}
        <TabsContent value="notifications" className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h1 className="text-2xl font-bold">{isRtl ? 'التنبيهات' : 'Notifications'}</h1>
              <p className="text-sm text-muted-foreground mt-1">
                {unreadCount > 0
                  ? (isRtl ? `${unreadCount} تنبيه غير مقروء` : `${unreadCount} unread`)
                  : (isRtl ? 'لا توجد تنبيهات جديدة' : 'No new notifications')
                }
              </p>
            </div>
            {unreadCount > 0 && (
              <Button variant="outline" onClick={markAllAsRead}>
                <CheckCircle2 className="h-4 w-4 ml-2" />
                {isRtl ? 'تعليم الكل كمقروء' : 'Mark all as read'}
              </Button>
            )}
          </div>

          {loading ? (
            <div className="h-32 bg-muted animate-pulse rounded" />
          ) : notifications.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Bell className="h-12 w-12 mx-auto text-muted-foreground/50" />
                <p className="mt-3 text-muted-foreground">{isRtl ? 'لا توجد تنبيهات' : 'No notifications'}</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {notifications.map((n) => {
                const config = severityConfig[n.severity as keyof typeof severityConfig] || severityConfig.info
                const Icon = config.icon
                const typeLabel = typeLabels[n.type] || { ar: n.type, en: n.type }

                return (
                  <Card
                    key={n.id}
                    className={`transition ${!n.read ? 'border-r-4 border-r-primary' : 'opacity-70'}`}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <div className={`w-10 h-10 rounded-lg ${config.bgColor} flex items-center justify-center shrink-0`}>
                          <Icon className={`h-5 w-5 ${config.iconColor}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <p className="font-semibold text-sm">{n.title}</p>
                            <Badge variant={config.color as any} className="text-xs">
                              {isRtl ? config.ar : config.en}
                            </Badge>
                            <Badge variant="outline" className="text-xs">
                              {isRtl ? typeLabel.ar : typeLabel.en}
                            </Badge>
                            {!n.read && (
                              <span className="h-2 w-2 rounded-full bg-primary" />
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground">{n.message}</p>
                          {n.project && (
                            <p className="text-xs text-muted-foreground mt-1">
                              {isRtl ? 'المشروع' : 'Project'}: {n.project.name}
                            </p>
                          )}
                          <p className="text-xs text-muted-foreground mt-1">
                            {new Date(n.createdAt).toLocaleString(isRtl ? 'ar-EG' : 'en-US')}
                          </p>
                        </div>
                        {!n.read && (
                          <Button variant="ghost" size="sm" onClick={() => markAsRead(n.id)}>
                            <CheckCircle2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </TabsContent>

        {/* ========== Monitor Tab ========== */}
        <TabsContent value="monitor" className="space-y-4">
          {/* Stats Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {entityStats.map((stat: any) => (
              <Card
                key={stat.entity}
                className={`${filterEntity === stat.entity ? 'ring-2 ring-primary' : ''} cursor-pointer hover:shadow-md transition`}
                onClick={() => setFilterEntity(filterEntity === stat.entity ? 'all' : stat.entity)}
              >
                <CardContent className="p-3 text-center">
                  <p className="text-2xl font-bold">{stat.count}</p>
                  <p className="text-xs text-muted-foreground">{isRtl ? stat.ar : stat.en}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Filter Bar */}
          <Card>
            <CardContent className="p-3">
              <div className="flex items-center gap-2 mb-3 text-sm font-medium text-muted-foreground">
                <Filter className="h-4 w-4" />
                {isRtl ? 'فلترة السجلات' : 'Filter Logs'}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
                {/* Entity Filter */}
                <Select value={filterEntity} onValueChange={setFilterEntity}>
                  <SelectTrigger>
                    <SelectValue placeholder={isRtl ? 'القسم' : 'Entity'} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{isRtl ? 'الكل' : 'All'}</SelectItem>
                    {entityStats.map((stat: any) => (
                      <SelectItem key={stat.entity} value={stat.entity}>
                        {isRtl ? stat.ar : stat.en}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Action Filter */}
                <Select value={filterAction} onValueChange={setFilterAction}>
                  <SelectTrigger>
                    <SelectValue placeholder={isRtl ? 'الإجراء' : 'Action'} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{isRtl ? 'الكل' : 'All'}</SelectItem>
                    {actionStats.map((stat: any) => (
                      <SelectItem key={stat.action} value={stat.action}>
                        {isRtl ? stat.ar : stat.en}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* User Filter */}
                <Select value={filterUser} onValueChange={setFilterUser}>
                  <SelectTrigger>
                    <SelectValue placeholder={isRtl ? 'المستخدم' : 'User'} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{isRtl ? 'الكل' : 'All'}</SelectItem>
                    {usersList.map((u: any) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Date From */}
                <Input
                  type="date"
                  value={filterDateFrom}
                  onChange={(e) => setFilterDateFrom(e.target.value)}
                  placeholder={isRtl ? 'من تاريخ' : 'From'}
                />

                {/* Date To */}
                <Input
                  type="date"
                  value={filterDateTo}
                  onChange={(e) => setFilterDateTo(e.target.value)}
                  placeholder={isRtl ? 'إلى تاريخ' : 'To'}
                />

                {/* Export Buttons */}
                <div className="flex gap-1">
                  <Button variant="outline" size="sm" onClick={exportCSV} title={isRtl ? 'تصدير Excel/CSV' : 'Export CSV'}>
                    <FileSpreadsheet className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="sm" onClick={exportJSON} title={isRtl ? 'تصدير JSON' : 'Export JSON'}>
                    <FileDown className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Logs List */}
          {logLoading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className="h-16 bg-muted animate-pulse rounded" />
              ))}
            </div>
          ) : logs.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Activity className="h-12 w-12 mx-auto text-muted-foreground/50" />
                <p className="mt-3 text-muted-foreground">{isRtl ? 'لا توجد سجلات' : 'No logs found'}</p>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="space-y-2">
                {logs.map((log: any) => (
                  <LogEntry key={log.id} log={log} isRtl={isRtl} />
                ))}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    {isRtl
                      ? `${logTotal} سجل - صفحة ${logPage} من ${totalPages}`
                      : `${logTotal} logs - Page ${logPage} of ${totalPages}`
                    }
                  </p>
                  <div className="flex gap-1">
                    <Button
                      variant="outline" size="sm"
                      disabled={logPage <= 1}
                      onClick={() => setLogPage(logPage - 1)}
                    >
                      {isRtl ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
                    </Button>
                    <Button
                      variant="outline" size="sm"
                      disabled={logPage >= totalPages}
                      onClick={() => setLogPage(logPage + 1)}
                    >
                      {isRtl ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
