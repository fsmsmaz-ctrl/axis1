'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Eye, RefreshCw, CheckCircle2, AlertTriangle, XCircle, Info,
  Activity, Clock, ListChecks, ShieldAlert, Bell, ChevronRight, ChevronLeft,
} from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { authedFetch } from '@/lib/api-client'

// ============================================================
// الرقابة العملية (v17) — مركز المتابعة الإداري
// يجمع في قسم واحد:
//   1) سجل عمليات البيانات (إضافة / تعديل / حذف) — من سجل المراقبة AuditLog
//   2) التحذيرات الرقابية الموجهة للإدارة (نُقلت من قسم التنبيهات)
//   3) متابعة المهام (متأخرة / خلال 24 ساعة / بانتظار مراجعتك / بانتظار
//      جهة أخرى / معادة) + تنبيهات المهام
//   4) التحذيرات الحرجة
// متاح للإدارة العليا ومديري المشاريع ومدير النظام فقط.
// ============================================================

const severityConfig = {
  critical: { ar: 'حرج', en: 'Critical', color: 'destructive', icon: XCircle, bgColor: 'bg-red-50', iconColor: 'text-red-600', border: 'border-r-red-500' },
  warning: { ar: 'تحذير', en: 'Warning', color: 'default', icon: AlertTriangle, bgColor: 'bg-orange-50', iconColor: 'text-orange-600', border: 'border-r-orange-400' },
  info: { ar: 'معلومة', en: 'Info', color: 'secondary', icon: Info, bgColor: 'bg-blue-50', iconColor: 'text-blue-600', border: 'border-r-blue-400' },
}

const typeLabels: Record<string, { ar: string; en: string }> = {
  // إشعارات عمليات البيانات
  project_created: { ar: 'مشروع جديد', en: 'New project' },
  drive_line_completed: { ar: 'اكتمال خط حفر', en: 'Drive line completed' },
  cost_overrun: { ar: 'حركة مالية جديدة', en: 'New cost entry' },
  // التحذيرات الرقابية
  report_pending_approval: { ar: 'تقرير بحاجة إلى اعتماد', en: 'Report pending approval' },
  report_delay: { ar: 'تأخير في التقارير', en: 'Report delay' },
  safety_missing: { ar: 'تقرير سلامة ناقص', en: 'Missing safety report' },
  safety_alert: { ar: 'تنبيه سلامة', en: 'Safety alert' },
  finishing_incomplete: { ar: 'تشطيب غير مكتمل', en: 'Incomplete finishing' },
  finishing_pending_approval: { ar: 'تشطيب بحاجة إلى اعتماد', en: 'Finishing pending approval' },
  performance_ready: { ar: 'جاهزية تقييم الأداء', en: 'Performance review ready' },
  // متابعة المهام
  task_assigned: { ar: 'إسناد مهمة', en: 'Task assigned' },
  task_returned: { ar: 'مهمة معادة', en: 'Task returned' },
  task_approved: { ar: 'تم اعتماد المهمة', en: 'Task approved' },
  task_cancelled: { ar: 'تم إلغاء مهمة', en: 'Task cancelled' },
  task_due_changed: { ar: 'تغيير موعد مهمة', en: 'Task due date changed' },
  task_due_soon: { ar: 'موعد مهمة يقترب', en: 'Task due soon' },
  task_overdue: { ar: 'مهمة متأخرة', en: 'Task overdue' },
  task_review_pending: { ar: 'بانتظار مراجعة مهمة', en: 'Task review pending' },
  task_waiting: { ar: 'مهمة بانتظار جهة أخرى', en: 'Task waiting' },
  task_ready_review: { ar: 'مهمة جاهزة للمراجعة', en: 'Task ready for review' },
  // أنواع سابقة تبقى مدعومة
  work_stopped: { ar: 'توقف العمل', en: 'Work stopped' },
  low_production: { ar: 'انخفاض الإنتاج', en: 'Low production' },
  equipment_breakdown: { ar: 'عطل في المعدة', en: 'Equipment breakdown' },
  mass_absence: { ar: 'غياب جماعي', en: 'Mass absence' },
  deadline_near: { ar: 'اقتراب موعد التسليم', en: 'Deadline near' },
}

const actionConfig: Record<string, { ar: string; en: string; cls: string }> = {
  create: { ar: 'إضافة', en: 'Create', cls: 'bg-green-100 text-green-700' },
  update: { ar: 'تعديل', en: 'Update', cls: 'bg-blue-100 text-blue-700' },
  delete: { ar: 'حذف', en: 'Delete', cls: 'bg-red-100 text-red-700' },
  approve: { ar: 'اعتماد', en: 'Approve', cls: 'bg-emerald-100 text-emerald-700' },
  submit: { ar: 'إرسال للاعتماد', en: 'Submit', cls: 'bg-indigo-100 text-indigo-700' },
  reject: { ar: 'رفض', en: 'Reject', cls: 'bg-red-100 text-red-700' },
}

const entityLabels: Record<string, { ar: string; en: string }> = {
  project: { ar: 'مشروع', en: 'Project' },
  drive_line: { ar: 'خط حفر', en: 'Drive Line' },
  daily_report: { ar: 'تقرير يومي', en: 'Daily Report' },
  safety_report: { ar: 'تقرير سلامة', en: 'Safety Report' },
  cost: { ar: 'تكلفة / إيراد', en: 'Cost' },
  equipment: { ar: 'معدة', en: 'Equipment' },
  equipment_maintenance: { ar: 'صيانة معدة', en: 'Equipment Maintenance' },
  finishing: { ar: 'تشطيب', en: 'Finishing' },
  company_asset: { ar: 'أصل شركة', en: 'Company Asset' },
  worker: { ar: 'عامل', en: 'Worker' },
  user: { ar: 'مستخدم', en: 'User' },
  safety_inspection: { ar: 'فحص سلامة', en: 'Safety Inspection' },
}

const entityFilterOptions = [
  'project', 'drive_line', 'daily_report', 'safety_report', 'cost',
  'equipment', 'equipment_maintenance', 'finishing', 'company_asset',
  'worker', 'user', 'safety_inspection',
]

const actionFilterOptions = ['create', 'update', 'delete', 'approve', 'submit', 'reject']

const priorityConfig: Record<string, { ar: string; en: string; cls: string }> = {
  urgent: { ar: 'عاجلة', en: 'Urgent', cls: 'bg-red-100 text-red-700' },
  high: { ar: 'عالية', en: 'High', cls: 'bg-orange-100 text-orange-700' },
  normal: { ar: 'عادية', en: 'Normal', cls: 'bg-muted text-muted-foreground' },
  low: { ar: 'منخفضة', en: 'Low', cls: 'bg-secondary text-secondary-foreground' },
}

type TabKey = 'logs' | 'warnings' | 'tasks' | 'critical'

export default function OversightPage() {
  const language = useAppStore((s) => s.language)
  const isRtl = language === 'ar'
  const t = (ar: string, en: string) => (isRtl ? ar : en)

  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<TabKey>('warnings')

  // سجل العمليات (AuditLog عبر /api/audit-logs)
  const [logs, setLogs] = useState<any[]>([])
  const [logsTotal, setLogsTotal] = useState(0)
  const [logsPages, setLogsPages] = useState(1)
  const [logsPage, setLogsPage] = useState(1)
  const [logsLoading, setLogsLoading] = useState(true)
  const [fEntity, setFEntity] = useState('all')
  const [fAction, setFAction] = useState('all')
  const [fProject, setFProject] = useState('all')

  const fetchOverview = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await authedFetch('/api/oversight')
      const d = await res.json()
      if (!res.ok) {
        setError(d.message || (isRtl ? 'تعذر تحميل بيانات الرقابة' : 'Failed to load oversight data'))
        setData(null)
      } else {
        setData(d)
      }
    } catch (e) {
      setError(isRtl ? 'تعذر الاتصال بالخادم' : 'Connection failed')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [isRtl])

  const fetchLogs = useCallback(async (page: number) => {
    setLogsLoading(true)
    try {
      const p = new URLSearchParams()
      p.set('page', String(page))
      p.set('limit', '25')
      if (fEntity !== 'all') p.set('entity', fEntity)
      if (fAction !== 'all') p.set('action', fAction)
      if (fProject !== 'all') p.set('projectId', fProject)
      const res = await authedFetch('/api/audit-logs?' + p.toString())
      const d = await res.json()
      if (res.ok) {
        setLogs(d.logs || [])
        setLogsTotal(d.total || 0)
        setLogsPages(d.totalPages || 1)
        setLogsPage(d.page || page)
      } else {
        setLogs([])
        setLogsTotal(0)
        setLogsPages(1)
      }
    } catch (e) {
      setLogs([])
    } finally {
      setLogsLoading(false)
    }
  }, [fEntity, fAction, fProject])

  useEffect(() => {
    fetchOverview()
  }, [fetchOverview])

  useEffect(() => {
    fetchLogs(1)
  }, [fetchLogs])

  async function refreshAll() {
    await Promise.all([fetchOverview(), fetchLogs(1)])
  }

  function markAsRead(id: string) {
    authedFetch(`/api/notifications/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ read: true }),
    }).catch(() => {})
    setData((prev: any) => {
      if (!prev) return prev
      const upd = (arr: any[]) => (arr || []).map((n: any) => (n.id === id ? { ...n, read: true } : n))
      return {
        ...prev,
        notifications: upd(prev.notifications),
        taskNotifications: upd(prev.taskNotifications),
        critical: upd(prev.critical),
      }
    })
  }

  /** التنقل إلى الصفحة المرتبطة عبر حدث يلتقطه app-shell */
  function navigateTo(n: any) {
    if (!n.read) markAsRead(n.id)
    if (n.link) {
      window.dispatchEvent(new CustomEvent('axis:goto-page', { detail: n.link }))
    }
  }

  const notifications = useMemo(() => data?.notifications || [], [data])
  const taskNotifications = useMemo(() => data?.taskNotifications || [], [data])
  const criticalItems = useMemo(() => data?.critical || [], [data])
  const tasks = data?.tasks || {}
  const stats = data?.stats || {}
  const projects = data?.projects || []

  const warningsUnread = useMemo(() => notifications.filter((n: any) => !n.read).length, [notifications])
  const criticalUnread = useMemo(() => criticalItems.filter((n: any) => !n.read).length, [criticalItems])

  function formatTime(dateStr: string): string {
    if (!dateStr) return '—'
    const d = new Date(dateStr)
    const diffMs = Date.now() - d.getTime()
    const mins = Math.floor(diffMs / 60000)
    if (mins < 1) return t('الآن', 'Just now')
    if (mins < 60) return t(`منذ ${mins} دقيقة`, `${mins}m ago`)
    const hours = Math.floor(mins / 60)
    if (hours < 24) return t(`منذ ${hours} ساعة`, `${hours}h ago`)
    const days = Math.floor(hours / 24)
    if (days < 7) return t(`منذ ${days} يوم`, `${days}d ago`)
    return d.toLocaleDateString(isRtl ? 'ar-EG' : 'en-US')
  }

  function formatFull(dateStr: string): string {
    if (!dateStr) return '—'
    return new Date(dateStr).toLocaleString(isRtl ? 'ar-EG' : 'en-US', { dateStyle: 'short', timeStyle: 'short' })
  }

  function overdueFor(dateStr: string): string {
    const ms = Date.now() - new Date(dateStr).getTime()
    if (ms <= 0) return ''
    const hours = Math.floor(ms / 3600000)
    if (hours < 24) return t(`متأخرة ${hours} ساعة`, `${hours}h late`)
    const days = Math.floor(hours / 24)
    return t(`متأخرة ${days} يوم`, `${days}d late`)
  }

  function parseDetails(details: any): string {
    if (!details || typeof details !== 'string') return ''
    try {
      const obj = JSON.parse(details)
      if (obj && typeof obj === 'object' && obj.summary) return String(obj.summary)
      return details
    } catch {
      return details
    }
  }

  function userName(u: any): string {
    if (!u) return '—'
    return isRtl ? u.name : (u.nameEn || u.name)
  }

  function EmptyCard({ icon: Icon, text }: { icon: any; text: string }) {
    return (
      <Card>
        <CardContent className="py-10 text-center">
          <Icon className="h-10 w-10 mx-auto text-muted-foreground/50" />
          <p className="mt-2 text-sm text-muted-foreground">{text}</p>
        </CardContent>
      </Card>
    )
  }

  function RowsSkeleton({ n }: { n: number }) {
    return (
      <div className="space-y-2">
        {Array.from({ length: n }).map((_, i) => (
          <div key={i} className="h-16 bg-muted animate-pulse rounded" />
        ))}
      </div>
    )
  }

  function NotifCard({ n }: { n: any }) {
    const config = severityConfig[n.severity as keyof typeof severityConfig] || severityConfig.info
    const TypeIcon = config.icon
    const typeLabel = typeLabels[n.type] || { ar: n.type, en: n.type }
    return (
      <Card
        className={`transition cursor-pointer hover:bg-muted/40 ${!n.read ? `border-r-4 ${config.border}` : 'opacity-75'}`}
        onClick={() => navigateTo(n)}
      >
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className={`w-10 h-10 rounded-lg ${config.bgColor} flex items-center justify-center shrink-0`}>
              <TypeIcon className={`h-5 w-5 ${config.iconColor}`} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <p className="font-semibold text-sm">{n.title}</p>
                <Badge variant={config.color as any} className="text-xs">
                  {t(config.ar, config.en)}
                </Badge>
                <Badge variant="outline" className="text-xs">
                  {t(typeLabel.ar, typeLabel.en)}
                </Badge>
                {!n.read && <span className="h-2 w-2 rounded-full bg-primary" />}
              </div>
              <p className="text-sm text-muted-foreground">{n.message}</p>
              <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                {n.project && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary/60" />
                    {n.project.name}
                  </span>
                )}
                <span className="text-xs text-muted-foreground/80">{formatTime(n.createdAt)}</span>
              </div>
            </div>
            {!n.read && (
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => { e.stopPropagation(); markAsRead(n.id) }}
                title={t('تعليم كمقروء', 'Mark as read')}
              >
                <CheckCircle2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    )
  }

  function TaskRow({ task }: { task: any }) {
    const pr = priorityConfig[task.priority] || priorityConfig.normal
    return (
      <div className="flex items-center gap-3 py-2.5 border-b last:border-0">
        <span className="text-xs font-mono text-muted-foreground shrink-0">#{task.taskNumber}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{task.title}</p>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            {userName(task.assignee)}
            {' · '}
            {formatFull(task.dueDate)}
            {task.waitingReason ? ' · ' + task.waitingReason : ''}
          </p>
        </div>
        <Badge className={'text-xs shrink-0 ' + pr.cls}>{t(pr.ar, pr.en)}</Badge>
        <span className="text-xs text-red-600 font-medium shrink-0 hidden sm:block whitespace-nowrap">
          {overdueFor(task.dueDate)}
        </span>
      </div>
    )
  }

  const noTasks =
    !stats.lateTasks && !stats.dueSoonTasks && !stats.waitingTasks &&
    !stats.readyReviewTasks && !stats.returnedTasks && taskNotifications.length === 0

  const tabs: { key: TabKey; ar: string; en: string; count?: number }[] = [
    { key: 'logs', ar: 'سجل العمليات', en: 'Operations Log' },
    { key: 'warnings', ar: 'التحذيرات الرقابية', en: 'Supervisory Warnings', count: warningsUnread },
    { key: 'tasks', ar: 'متابعة المهام', en: 'Task Follow-up', count: (stats.lateTasks || 0) + (stats.readyReviewTasks || 0) },
    { key: 'critical', ar: 'التحذيرات الحرجة', en: 'Critical Alerts', count: criticalUnread },
  ]

  return (
    <div className="space-y-4">
      {/* الرأس */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Eye className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{t('الرقابة العملية', 'Operational Control')}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {t('عمليات البيانات، التحذيرات الرقابية، متابعة المهام، والتحذيرات الحرجة — في مكان واحد',
                 'Data operations, supervisory warnings, task follow-up and critical alerts — in one place')}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={refreshAll} disabled={loading || logsLoading}>
          <RefreshCw className={`h-4 w-4 ml-2 ${(loading || logsLoading) ? 'animate-spin' : ''}`} />
          {t('تحديث', 'Refresh')}
        </Button>
      </div>

      {error && (
        <Card>
          <CardContent className="py-8 text-center">
            <ShieldAlert className="h-10 w-10 mx-auto text-destructive" />
            <p className="mt-2 text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={fetchOverview}>
              {t('إعادة المحاولة', 'Retry')}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* لوحة المؤشرات السريعة */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <button onClick={() => setTab('logs')} className="text-start">
          <Card className="hover:bg-muted/40 transition cursor-pointer h-full">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
                <Activity className="h-5 w-5 text-blue-600" />
              </div>
              <div className="min-w-0">
                <p className="text-2xl font-bold leading-none">{stats.opsToday ?? 0}</p>
                <p className="text-xs text-muted-foreground mt-1">{t('عملية على البيانات اليوم', 'Data operations today')}</p>
                <p className="text-[11px] text-muted-foreground/70">{t(`${stats.ops7d ?? 0} خلال 7 أيام`, `${stats.ops7d ?? 0} in 7 days`)}</p>
              </div>
            </CardContent>
          </Card>
        </button>
        <button onClick={() => setTab('warnings')} className="text-start">
          <Card className="hover:bg-muted/40 transition cursor-pointer h-full">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-orange-50 flex items-center justify-center shrink-0">
                <ShieldAlert className="h-5 w-5 text-orange-600" />
              </div>
              <div className="min-w-0">
                <p className="text-2xl font-bold leading-none">{stats.supervisoryUnread ?? 0}</p>
                <p className="text-xs text-muted-foreground mt-1">{t('تحذيرات رقابية غير مقروءة', 'Unread supervisory warnings')}</p>
              </div>
            </CardContent>
          </Card>
        </button>
        <button onClick={() => setTab('tasks')} className="text-start">
          <Card className="hover:bg-muted/40 transition cursor-pointer h-full">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-red-50 flex items-center justify-center shrink-0">
                <Clock className="h-5 w-5 text-red-600" />
              </div>
              <div className="min-w-0">
                <p className="text-2xl font-bold leading-none">{stats.lateTasks ?? 0}</p>
                <p className="text-xs text-muted-foreground mt-1">{t('مهام متأخرة', 'Overdue tasks')}</p>
                <p className="text-[11px] text-muted-foreground/70">{t(`${stats.readyReviewTasks ?? 0} بانتظار مراجعتك`, `${stats.readyReviewTasks ?? 0} await review`)}</p>
              </div>
            </CardContent>
          </Card>
        </button>
        <button onClick={() => setTab('critical')} className="text-start">
          <Card className="hover:bg-muted/40 transition cursor-pointer h-full">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-red-50 flex items-center justify-center shrink-0">
                <XCircle className="h-5 w-5 text-red-600" />
              </div>
              <div className="min-w-0">
                <p className="text-2xl font-bold leading-none text-red-600">{stats.criticalUnread ?? 0}</p>
                <p className="text-xs text-muted-foreground mt-1">{t('تحذيرات حرجة غير مقروءة', 'Unread critical alerts')}</p>
              </div>
            </CardContent>
          </Card>
        </button>
      </div>

      {/* التبويبات */}
      <div className="flex items-center gap-2 flex-wrap">
        {tabs.map((f) => (
          <button
            key={f.key}
            onClick={() => setTab(f.key)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
              tab === f.key
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background text-muted-foreground border-border hover:bg-muted'
            }`}
          >
            {t(f.ar, f.en)}
            {typeof f.count === 'number' && f.count > 0 && (
              <span className={`mr-1.5 ${tab === f.key ? 'opacity-90' : 'opacity-60'}`}>({f.count})</span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <RowsSkeleton n={4} />
      ) : (
        <>
          {/* ═══ 1) سجل عمليات البيانات (إضافة / تعديل / حذف) ═══ */}
          {tab === 'logs' && (
            <div className="space-y-3">
              {data && !data.viewer?.isTopManagement && projects.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  {t('سجل العمليات يعرض مشاريعك المسندة إليك فقط — لا توجد مشاريع مسندة إليك حالياً',
                      'The log shows projects assigned to you only — none assigned at the moment')}
                </p>
              )}
              <div className="flex items-center gap-2 flex-wrap">
                <Select value={fProject} onValueChange={setFProject}>
                  <SelectTrigger className="h-9 w-[180px] text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('كل المشاريع', 'All projects')}</SelectItem>
                    {projects.map((p: any) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={fEntity} onValueChange={setFEntity}>
                  <SelectTrigger className="h-9 w-[170px] text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('كل الأنواع', 'All entities')}</SelectItem>
                    {entityFilterOptions.map((k) => (
                      <SelectItem key={k} value={k}>{t(entityLabels[k].ar, entityLabels[k].en)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={fAction} onValueChange={setFAction}>
                  <SelectTrigger className="h-9 w-[150px] text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('كل العمليات', 'All actions')}</SelectItem>
                    {actionFilterOptions.map((k) => (
                      <SelectItem key={k} value={k}>{t(actionConfig[k].ar, actionConfig[k].en)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {logsLoading ? (
                <RowsSkeleton n={5} />
              ) : logs.length === 0 ? (
                <EmptyCard icon={Activity} text={t('لا توجد عمليات مسجلة مطابقة للفلاتر', 'No matching operations recorded')} />
              ) : (
                <Card>
                  <CardContent className="p-4">
                    {logs.map((log: any) => {
                      const ac = actionConfig[log.action] || { ar: log.action, en: log.action, cls: 'bg-muted text-muted-foreground' }
                      const ent = entityLabels[log.entity] || { ar: log.entity, en: log.entity }
                      const summary = parseDetails(log.details)
                      return (
                        <div key={log.id} className="flex items-start gap-3 py-2.5 border-b last:border-0">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge className={'text-xs ' + ac.cls}>{t(ac.ar, ac.en)}</Badge>
                              <Badge variant="outline" className="text-xs">{t(ent.ar, ent.en)}</Badge>
                              {summary && (
                                <span className={`text-sm font-medium truncate ${log.action === 'delete' ? 'text-destructive' : ''}`}>
                                  {summary}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">
                              {userName(log.user)}
                              {log.project ? ' · ' + log.project.name : ''}
                              {' · '}
                              {formatFull(log.createdAt)}
                            </p>
                          </div>
                        </div>
                      )
                    })}
                  </CardContent>
                </Card>
              )}

              {logsTotal > 0 && (
                <div className="flex items-center justify-between text-sm flex-wrap gap-2">
                  <span className="text-muted-foreground text-xs">
                    {t(`صفحة ${logsPage} من ${logsPages}`, `Page ${logsPage} of ${logsPages}`)}
                    {' · '}
                    {t(`${logsTotal} عملية`, `${logsTotal} operations`)}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" disabled={logsPage <= 1} onClick={() => fetchLogs(logsPage - 1)}>
                      <ChevronRight className="h-4 w-4 ml-1" />
                      {t('السابق', 'Prev')}
                    </Button>
                    <Button variant="outline" size="sm" disabled={logsPage >= logsPages} onClick={() => fetchLogs(logsPage + 1)}>
                      {t('التالي', 'Next')}
                      <ChevronLeft className="h-4 w-4 mr-1" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ═══ 2) التحذيرات الرقابية (المنقولة من قسم التنبيهات) ═══ */}
          {tab === 'warnings' && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                {t('فئات نُقلت من قسم التنبيهات: إشعارات عمليات البيانات (إضافة / تعديل / حذف) والتحذيرات الرقابية الموجهة للإدارة — التحذيرات الحرجة لها تبويب خاص.',
                   'Categories moved from Notifications: data-operation alerts and supervisory warnings — critical alerts have their own tab.')}
              </p>
              {notifications.length === 0 ? (
                <EmptyCard icon={Bell} text={t('لا توجد تحذيرات رقابية', 'No supervisory warnings')} />
              ) : (
                notifications.map((n: any) => <NotifCard key={n.id} n={n} />)
              )}
            </div>
          )}

          {/* ═══ 3) متابعة المهام ═══ */}
          {tab === 'tasks' && (
            <div className="space-y-4">
              {noTasks ? (
                <EmptyCard icon={CheckCircle2} text={t('لا توجد متابعات مهام حالياً', 'No task follow-ups right now')} />
              ) : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                    {[
                      { label: t('متأخرة', 'Late'), value: stats.lateTasks ?? 0, cls: 'text-red-600 bg-red-50' },
                      { label: t('خلال 24 ساعة', 'Due 24h'), value: stats.dueSoonTasks ?? 0, cls: 'text-orange-600 bg-orange-50' },
                      { label: t('بانتظار مراجعتك', 'Your review'), value: stats.readyReviewTasks ?? 0, cls: 'text-blue-600 bg-blue-50' },
                      { label: t('بانتظار جهة أخرى', 'Waiting'), value: stats.waitingTasks ?? 0, cls: 'text-muted-foreground bg-muted' },
                      { label: t('معادة للتعديل', 'Returned'), value: stats.returnedTasks ?? 0, cls: 'text-amber-600 bg-amber-50' },
                    ].map((s) => (
                      <div key={s.label} className={`rounded-lg p-3 text-center ${s.cls}`}>
                        <p className="text-xl font-bold leading-none">{s.value}</p>
                        <p className="text-[11px] mt-1 opacity-80">{s.label}</p>
                      </div>
                    ))}
                  </div>

                  {(tasks.late?.length > 0 || stats.lateTasks > 0) && (
                    <Card>
                      <CardContent className="p-4">
                        <div className="flex items-center gap-2 mb-1">
                          <Clock className="h-4 w-4 text-red-600" />
                          <h3 className="text-sm font-semibold text-red-600">{t('مهام متأخرة', 'Overdue tasks')}</h3>
                          <Badge variant="destructive" className="text-xs">{stats.lateTasks ?? tasks.late?.length ?? 0}</Badge>
                        </div>
                        {(tasks.late || []).map((task: any) => <TaskRow key={task.id} task={task} />)}
                        {stats.lateTasks > (tasks.late?.length || 0) && (
                          <p className="text-xs text-muted-foreground pt-2">
                            {t(`توجد ${stats.lateTasks} مهمة متأخرة إجمالاً — يُعرض أول ${tasks.late?.length || 0}`,
                               `Showing first ${tasks.late?.length || 0} of ${stats.lateTasks} overdue`)}
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  )}

                  {tasks.dueSoon?.length > 0 && (
                    <Card>
                      <CardContent className="p-4">
                        <div className="flex items-center gap-2 mb-1">
                          <Clock className="h-4 w-4 text-orange-500" />
                          <h3 className="text-sm font-semibold text-orange-600">{t('تستحق خلال 24 ساعة', 'Due within 24 hours')}</h3>
                          <Badge variant="outline" className="text-xs">{tasks.dueSoon.length}</Badge>
                        </div>
                        {tasks.dueSoon.map((task: any) => <TaskRow key={task.id} task={task} />)}
                      </CardContent>
                    </Card>
                  )}

                  {tasks.readyReview?.length > 0 && (
                    <Card>
                      <CardContent className="p-4">
                        <div className="flex items-center gap-2 mb-1">
                          <ListChecks className="h-4 w-4 text-blue-600" />
                          <h3 className="text-sm font-semibold text-blue-600">{t('بانتظار مراجعة الإدارة', 'Awaiting management review')}</h3>
                          <Badge variant="outline" className="text-xs">{tasks.readyReview.length}</Badge>
                        </div>
                        {tasks.readyReview.map((task: any) => <TaskRow key={task.id} task={task} />)}
                      </CardContent>
                    </Card>
                  )}

                  {tasks.waiting?.length > 0 && (
                    <Card>
                      <CardContent className="p-4">
                        <div className="flex items-center gap-2 mb-1">
                          <ListChecks className="h-4 w-4 text-muted-foreground" />
                          <h3 className="text-sm font-semibold">{t('بانتظار جهة أخرى', 'Waiting on another party')}</h3>
                          <Badge variant="outline" className="text-xs">{tasks.waiting.length}</Badge>
                        </div>
                        {tasks.waiting.map((task: any) => <TaskRow key={task.id} task={task} />)}
                      </CardContent>
                    </Card>
                  )}

                  {tasks.returned?.length > 0 && (
                    <Card>
                      <CardContent className="p-4">
                        <div className="flex items-center gap-2 mb-1">
                          <ListChecks className="h-4 w-4 text-amber-600" />
                          <h3 className="text-sm font-semibold text-amber-600">{t('مهام معادة للتعديل', 'Returned for rework')}</h3>
                          <Badge variant="outline" className="text-xs">{tasks.returned.length}</Badge>
                        </div>
                        {tasks.returned.map((task: any) => <TaskRow key={task.id} task={task} />)}
                      </CardContent>
                    </Card>
                  )}

                  {taskNotifications.length > 0 && (
                    <Card>
                      <CardContent className="p-4">
                        <div className="flex items-center gap-2 mb-1">
                          <Bell className="h-4 w-4 text-primary" />
                          <h3 className="text-sm font-semibold">{t('تنبيهات المهام', 'Task notifications')}</h3>
                        </div>
                        {taskNotifications.map((n: any) => {
                          const tl = typeLabels[n.type] || { ar: n.type, en: n.type }
                          return (
                            <div
                              key={n.id}
                              onClick={() => navigateTo(n)}
                              className="flex items-start gap-2.5 py-2 border-b last:border-0 cursor-pointer hover:bg-muted/40 rounded px-1"
                            >
                              {n.severity === 'critical' ? (
                                <XCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
                              ) : n.severity === 'warning' ? (
                                <AlertTriangle className="h-4 w-4 text-orange-500 mt-0.5 shrink-0" />
                              ) : (
                                <Bell className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
                              )}
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium flex items-center gap-2 flex-wrap">
                                  {n.title}
                                  <Badge variant="outline" className="text-[10px]">{t(tl.ar, tl.en)}</Badge>
                                  {!n.read && <span className="h-2 w-2 rounded-full bg-primary inline-block" />}
                                </p>
                                <p className="text-xs text-muted-foreground line-clamp-1">{n.message}</p>
                              </div>
                              <span className="text-[11px] text-muted-foreground/80 shrink-0">{formatTime(n.createdAt)}</span>
                            </div>
                          )
                        })}
                      </CardContent>
                    </Card>
                  )}
                </>
              )}
            </div>
          )}

          {/* ═══ 4) التحذيرات الحرجة ═══ */}
          {tab === 'critical' && (
            <div className="space-y-2">
              <p className="text-xs text-destructive flex items-center gap-1.5">
                <ShieldAlert className="h-3.5 w-3.5" />
                {t('تحذيرات حرجة تتطلب تدخلاً فورياً من الإدارة', 'Critical alerts requiring immediate management action')}
              </p>
              {criticalItems.length === 0 ? (
                <Card>
                  <CardContent className="py-10 text-center">
                    <CheckCircle2 className="h-10 w-10 mx-auto text-green-600" />
                    <p className="mt-2 text-sm text-muted-foreground">
                      {t('لا توجد تحذيرات حرجة — الوضع مستقر', 'No critical alerts — all clear')}
                    </p>
                  </CardContent>
                </Card>
              ) : (
                criticalItems.map((n: any) => <NotifCard key={n.id} n={n} />)
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

