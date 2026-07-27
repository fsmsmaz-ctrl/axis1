'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  AlertTriangle, Bell, CheckCircle2, Info, XCircle,
  Plus, Pencil, Trash2, Eye, ShieldCheck, Clock,
  Activity, Filter, RotateCcw, ChevronLeft, ChevronRight,
} from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { authedFetch } from '@/lib/api-client'
import { toast } from 'sonner'

const severityConfig = {
  critical: { ar: 'حرج', en: 'Critical', color: 'destructive' as const, icon: XCircle, bgColor: 'bg-red-50', iconColor: 'text-red-600' },
  warning: { ar: 'تحذير', en: 'Warning', color: 'default' as const, icon: AlertTriangle, bgColor: 'bg-orange-50', iconColor: 'text-orange-600' },
  info: { ar: 'معلومة', en: 'Info', color: 'secondary' as const, icon: Info, bgColor: 'bg-blue-50', iconColor: 'text-blue-600' },
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

const entityLabels: Record<string, { ar: string; en: string; color: string }> = {
  project:        { ar: 'المشاريع',         en: 'Projects',        color: 'bg-blue-100 text-blue-800' },
  drive_line:     { ar: 'خطوط الحفر',       en: 'Drive Lines',     color: 'bg-indigo-100 text-indigo-800' },
  daily_report:   { ar: 'التقارير اليومية',  en: 'Daily Reports',   color: 'bg-emerald-100 text-emerald-800' },
  safety_report:  { ar: 'تقارير السلامة',    en: 'Safety Reports',  color: 'bg-red-100 text-red-800' },
  cost:           { ar: 'التكاليف',         en: 'Costs',           color: 'bg-amber-100 text-amber-800' },
  equipment:      { ar: 'المعدات',          en: 'Equipment',       color: 'bg-purple-100 text-purple-800' },
  finishing:      { ar: 'التشطيبات',        en: 'Finishings',      color: 'bg-teal-100 text-teal-800' },
  user:           { ar: 'المستخدمين',        en: 'Users',           color: 'bg-slate-100 text-slate-800' },
}

const actionLabels: Record<string, { ar: string; en: string; icon: any; color: string }> = {
  create:  { ar: 'إنشاء', en: 'Created',  icon: Plus,       color: 'bg-green-100 text-green-700' },
  update:  { ar: 'تعديل', en: 'Updated',  icon: Pencil,     color: 'bg-blue-100 text-blue-700' },
  delete:  { ar: 'حذف',   en: 'Deleted',  icon: Trash2,     color: 'bg-red-100 text-red-700' },
  approve: { ar: 'اعتماد', en: 'Approved', icon: ShieldCheck, color: 'bg-emerald-100 text-emerald-700' },
  reject:  { ar: 'رفض',   en: 'Rejected', icon: XCircle,    color: 'bg-orange-100 text-orange-700' },
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<any[]>([])
  const [loadingNotif, setLoadingNotif] = useState(true)
  const [activeTab, setActiveTab] = useState('notifications')

  const [auditLogs, setAuditLogs] = useState<any[]>([])
  const [loadingLogs, setLoadingLogs] = useState(false)
  const [filterEntity, setFilterEntity] = useState('all')
  const [filterAction, setFilterAction] = useState('all')
  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo, setFilterTo] = useState('')
  const [logPage, setLogPage] = useState(1)
  const [logTotal, setLogTotal] = useState(0)
  const [entityStats, setEntityStats] = useState<any[]>([])
  const limit = 50

  const language = useAppStore((s) => s.language)
  const token = useAppStore((s) => s.token)
  const isRtl = language === 'ar'

  const fetchNotifications = useCallback(async () => {
    setLoadingNotif(true)
    try {
      const res = await authedFetch('/api/notifications')
      const data = await res.json()
      setNotifications(data.notifications || [])
    } catch {} finally {
      setLoadingNotif(false)
    }
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

  const fetchAuditLogs = useCallback(async () => {
    if (activeTab !== 'monitor') return
    setLoadingLogs(true)
    try {
      const params = new URLSearchParams()
      if (filterEntity !== 'all') params.set('entity', filterEntity)
      if (filterAction !== 'all') params.set('action', filterAction)
      if (filterFrom) params.set('from', filterFrom)
      if (filterTo) params.set('to', filterTo)
      params.set('page', String(logPage))
      params.set('limit', String(limit))

      const res = await authedFetch(`/api/audit-logs?${params.toString()}`)
      const data = await res.json()
      setAuditLogs(data.logs || [])
      setLogTotal(data.total || 0)
      setEntityStats(data.entityStats || [])
    } catch {} finally {
      setLoadingLogs(false)
    }
  }, [activeTab, filterEntity, filterAction, filterFrom, filterTo, logPage])

  useEffect(() => {
    if (!token || activeTab !== 'monitor') return
    fetchAuditLogs()
  }, [token, activeTab, fetchAuditLogs])

  function resetFilters() {
    setFilterEntity('all')
    setFilterAction('all')
    setFilterFrom('')
    setFilterTo('')
    setLogPage(1)
  }

  const totalPages = Math.ceil(logTotal / limit)
  const logStatsSum = useMemo(() => {
    return entityStats.reduce((sum: number, e: any) => sum + (e._count?.id || 0), 0)
  }, [entityStats])

  return (
    <div className="space-y-4">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <TabsList>
            <TabsTrigger value="notifications" className="gap-1.5">
              <Bell className="h-4 w-4" />
              {isRtl ? 'التنبيهات' : 'Notifications'}
              {unreadCount > 0 && (
                <span className="h-5 min-w-5 px-1.5 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center">
                  {unreadCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="monitor" className="gap-1.5">
              <Activity className="h-4 w-4" />
              {isRtl ? 'سجل المراقبة' : 'Activity Monitor'}
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Tab 1: Notifications */}
        <TabsContent value="notifications">
          <div className="flex items-center justify-between flex-wrap gap-3 mt-2">
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

          {loadingNotif ? (
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
                  <Card key={n.id} className={`transition ${!n.read ? 'border-r-4 border-r-primary' : 'opacity-70'}`}>
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <div className={`w-10 h-10 rounded-lg ${config.bgColor} flex items-center justify-center shrink-0`}>
                          <Icon className={`h-5 w-5 ${config.iconColor}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <p className="font-semibold text-sm">{n.title}</p>
                            <Badge variant={config.color} className="text-xs">{isRtl ? config.ar : config.en}</Badge>
                            <Badge variant="outline" className="text-xs">{isRtl ? typeLabel.ar : typeLabel.en}</Badge>
                            {!n.read && <span className="h-2 w-2 rounded-full bg-primary" />}
                          </div>
                          <p className="text-sm text-muted-foreground">{n.message}</p>
                          {n.project && <p className="text-xs text-muted-foreground mt-1">{n.project.name}</p>}
                          <p className="text-xs text-muted-foreground mt-1">{new Date(n.createdAt).toLocaleString(isRtl ? 'ar-EG' : 'en-US')}</p>
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

        {/* Tab 2: Activity Monitor */}
        <TabsContent value="monitor">
          <div className="mt-2 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <h1 className="text-2xl font-bold">{isRtl ? 'سجل المراقبة' : 'Activity Monitor'}</h1>
                <p className="text-sm text-muted-foreground mt-1">
                  {isRtl ? `تتبع جميع عمليات الإنشاء والتعديل والحذف - ${logTotal} سجل` : `Track all operations - ${logTotal} records`}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={resetFilters}>
                <RotateCcw className={`h-4 w-4 ${isRtl ? 'ml-1.5' : 'mr-1.5'}`} />
                {isRtl ? 'إعادة تعيين' : 'Reset'}
              </Button>
            </div>

            {entityStats.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
                {entityStats.map((stat: any) => {
                  const label = entityLabels[stat.entity] || { ar: stat.entity, en: stat.entity, color: 'bg-gray-100 text-gray-800' }
                  return (
                    <div key={stat.entity} className="rounded-lg border p-3 text-center">
                      <p className="text-2xl font-bold">{stat._count?.id || 0}</p>
                      <p className={`text-xs font-medium mt-1 inline-block px-2 py-0.5 rounded-full ${label.color}`}>{isRtl ? label.ar : label.en}</p>
                    </div>
                  )
                })}
                <div className="rounded-lg border p-3 text-center bg-muted/50">
                  <p className="text-2xl font-bold">{logStatsSum}</p>
                  <p className="text-xs font-medium mt-1 text-muted-foreground">{isRtl ? 'الإجمالي' : 'Total'}</p>
                </div>
              </div>
            )}

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Filter className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">{isRtl ? 'تصفية السجلات' : 'Filter Records'}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <Select value={filterEntity} onValueChange={(v) => { setFilterEntity(v); setLogPage(1) }}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={isRtl ? 'كل الأقسام' : 'All Sections'} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{isRtl ? 'كل الأقسام' : 'All Sections'}</SelectItem>
                      {Object.entries(entityLabels).map(([key, label]) => (
                        <SelectItem key={key} value={key}>{isRtl ? label.ar : label.en}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={filterAction} onValueChange={(v) => { setFilterAction(v); setLogPage(1) }}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={isRtl ? 'كل الإجراءات' : 'All Actions'} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{isRtl ? 'كل الإجراءات' : 'All Actions'}</SelectItem>
                      {Object.entries(actionLabels).map(([key, label]) => (
                        <SelectItem key={key} value={key}>{isRtl ? label.ar : label.en}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div><Input type="date" value={filterFrom} onChange={(e) => { setFilterFrom(e.target.value); setLogPage(1) }} /></div>
                  <div><Input type="date" value={filterTo} onChange={(e) => { setFilterTo(e.target.value); setLogPage(1) }} /></div>
                </div>
              </CardContent>
            </Card>

            {loadingLogs ? (
              <div className="space-y-2">{[1,2,3,4,5].map(i => <div key={i} className="h-20 bg-muted animate-pulse rounded-lg" />)}</div>
            ) : auditLogs.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <Activity className="h-12 w-12 mx-auto text-muted-foreground/50" />
                  <p className="mt-3 text-muted-foreground">{isRtl ? 'لا توجد سجلات مراقبة' : 'No activity logs found'}</p>
                </CardContent>
              </Card>
            ) : (
              <>
                <div className="space-y-2">
                  {auditLogs.map((log: any) => {
                    const entityCfg = entityLabels[log.entity] || { ar: log.entity, en: log.entity, color: 'bg-gray-100 text-gray-800' }
                    const actionCfg = actionLabels[log.action] || { ar: log.action, en: log.action, icon: Eye, color: 'bg-gray-100 text-gray-700' }
                    const ActionIcon = actionCfg.icon
                    return (
                      <Card key={log.id} className="hover:shadow-sm transition">
                        <CardContent className="p-4">
                          <div className="flex items-start gap-3">
                            <div className={`w-10 h-10 rounded-lg ${actionCfg.color} flex items-center justify-center shrink-0`}>
                              <ActionIcon className="h-5 w-5" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap mb-1">
                                {log.user && <span className="font-semibold text-sm">{log.user.name}</span>}
                                <Badge variant="outline" className={`text-xs font-medium ${actionCfg.color}`}>{isRtl ? actionCfg.ar : actionCfg.en}</Badge>
                                <Badge variant="secondary" className={`text-xs ${entityCfg.color} border-0`}>{isRtl ? entityCfg.ar : entityCfg.en}</Badge>
                              </div>
                              {log.details && <p className="text-sm text-muted-foreground mb-1 leading-relaxed">{log.details}</p>}
                              {log.project && (
                                <p className="text-xs text-muted-foreground mb-1">
                                  {isRtl ? 'المشروع' : 'Project'}: {log.project.name}
                                  <span className="text-muted-foreground/60 mr-1">({log.project.code})</span>
                                </p>
                              )}
                              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1.5">
                                <Clock className="h-3 w-3" />
                                {new Date(log.createdAt).toLocaleString(isRtl ? 'ar-EG' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    )
                  })}
                </div>
                {totalPages > 1 && (
                  <div className="flex items-center justify-center gap-2 pt-2">
                    <Button variant="outline" size="sm" disabled={logPage <= 1} onClick={() => setLogPage(p => p - 1)}>
                      {isRtl ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
                    </Button>
                    <span className="text-sm text-muted-foreground px-3">{logPage} / {totalPages}</span>
                    <Button variant="outline" size="sm" disabled={logPage >= totalPages} onClick={() => setLogPage(p => p + 1)}>
                      {isRtl ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
