'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { AlertTriangle, Bell, CheckCircle2, ClipboardCheck, FileCheck, HardHat, Info, LayoutList, RefreshCw, XCircle } from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { authedFetch } from '@/lib/api-client'
import { toast } from 'sonner'

const severityConfig = {
  critical: { ar: 'حرج', en: 'Critical', color: 'destructive', icon: XCircle, bgColor: 'bg-red-50', iconColor: 'text-red-600' },
  warning: { ar: 'تحذير', en: 'Warning', color: 'default', icon: AlertTriangle, bgColor: 'bg-orange-50', iconColor: 'text-orange-600' },
  info: { ar: 'معلومة', en: 'Info', color: 'secondary', icon: Info, bgColor: 'bg-blue-50', iconColor: 'text-blue-600' },
}

const typeLabels: Record<string, { ar: string; en: string }> = {
  // تنبيهات التقارير اليومية والاعتماد
  report_pending_approval: { ar: 'تقرير بحاجة إلى اعتماد', en: 'Report pending approval' },
  report_approved: { ar: 'تم اعتماد التقرير', en: 'Report approved' },
  report_delay: { ar: 'تأخير في التقارير', en: 'Report delay' },
  // السلامة
  safety_missing: { ar: 'تقرير سلامة ناقص', en: 'Missing safety report' },
  safety_alert: { ar: 'تنبيه سلامة', en: 'Safety alert' },
  // خطوط الحفر والتشطيبات
  drive_line_completed: { ar: 'اكتمال خط حفر', en: 'Drive line completed' },
  finishing_incomplete: { ar: 'تشطيب غير مكتمل', en: 'Incomplete finishing' },
  // الأداء والإدارة
  performance_ready: { ar: 'جاهزية تقييم الأداء', en: 'Performance review ready' },
  project_created: { ar: 'مشروع جديد', en: 'New project' },
  // أنواع سابقة تبقى مدعومة
  work_stopped: { ar: 'توقف العمل', en: 'Work stopped' },
  low_production: { ar: 'انخفاض الإنتاج', en: 'Low production' },
  equipment_breakdown: { ar: 'عطل في المعدة', en: 'Equipment breakdown' },
  mass_absence: { ar: 'غياب جماعي', en: 'Mass absence' },
  cost_overrun: { ar: 'تجاوز التكاليف', en: 'Cost overrun' },
  deadline_near: { ar: 'اقتراب موعد التسليم', en: 'Deadline near' },
}

const typeIcons: Record<string, any> = {
  report_pending_approval: ClipboardCheck,
  report_approved: FileCheck,
  report_delay: ClipboardCheck,
  safety_missing: AlertTriangle,
  drive_line_completed: HardHat,
  finishing_incomplete: LayoutList,
  performance_ready: FileCheck,
}

type FilterKey = 'all' | 'unread' | 'warning' | 'critical'

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterKey>('all')
  const language = useAppStore((s) => s.language)
  const token = useAppStore((s) => s.token)
  const isRtl = language === 'ar'

  const fetchNotifications = useCallback(async () => {
    setLoading(true)
    try {
      const res = await authedFetch('/api/notifications')
      const data = await res.json()
      setNotifications(data.notifications || [])
    } catch (e) {
      // تجاهل أخطاء الشبكة المؤقتة
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchNotifications()
  }, [fetchNotifications])

  async function markAsRead(id: string) {
    try {
      await authedFetch(`/api/notifications/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ read: true }),
      })
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)))
    } catch (e) {
      // تجاهل
    }
  }

  async function markAllAsRead() {
    // طلب دفعي واحد — يُحدّث تنبيهات المستخدم الحالي فقط
    const res = await authedFetch('/api/notifications/batch', { method: 'PUT' })
    if (res.ok) {
      toast.success(isRtl ? 'تم تعليم الكل كمقروء' : 'All marked as read')
      fetchNotifications()
    }
  }

  /** التنقل إلى الصفحة المرتبطة بالتنبيه عبر حدث يلتقطه app-shell */
  function navigateToNotification(n: any) {
    if (!n.read) markAsRead(n.id)
    if (n.link) {
      window.dispatchEvent(new CustomEvent('axis:goto-page', { detail: n.link }))
    }
  }

  const unreadCount = useMemo(() => notifications.filter(n => !n.read).length, [notifications])

  const filtered = useMemo(() => {
    switch (filter) {
      case 'unread': return notifications.filter(n => !n.read)
      case 'warning': return notifications.filter(n => n.severity === 'warning')
      case 'critical': return notifications.filter(n => n.severity === 'critical')
      default: return notifications
    }
  }, [notifications, filter])

  const filters: { key: FilterKey; ar: string; en: string; count?: number }[] = [
    { key: 'all', ar: 'الكل', en: 'All', count: notifications.length },
    { key: 'unread', ar: 'غير المقروء', en: 'Unread', count: unreadCount },
    { key: 'warning', ar: 'تحذيرات', en: 'Warnings', count: notifications.filter(n => n.severity === 'warning').length },
    { key: 'critical', ar: 'حرجة', en: 'Critical', count: notifications.filter(n => n.severity === 'critical').length },
  ]

  function formatTime(dateStr: string): string {
    const d = new Date(dateStr)
    const diffMs = Date.now() - d.getTime()
    const mins = Math.floor(diffMs / 60000)
    if (mins < 1) return isRtl ? 'الآن' : 'Just now'
    if (mins < 60) return isRtl ? `منذ ${mins} دقيقة` : `${mins}m ago`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return isRtl ? `منذ ${hours} ساعة` : `${hours}h ago`
    const days = Math.floor(hours / 24)
    if (days < 7) return isRtl ? `منذ ${days} يوم` : `${days}d ago`
    return d.toLocaleDateString(isRtl ? 'ar-EG' : 'en-US')
  }

  return (
    <div className="space-y-4">
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
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchNotifications} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ml-2 ${loading ? 'animate-spin' : ''}`} />
            {isRtl ? 'تحديث' : 'Refresh'}
          </Button>
          {unreadCount > 0 && (
            <Button variant="outline" onClick={markAllAsRead}>
              <CheckCircle2 className="h-4 w-4 ml-2" />
              {isRtl ? 'تعليم الكل كمقروء' : 'Mark all as read'}
            </Button>
          )}
        </div>
      </div>

      {/* فلاتر التصنيف */}
      <div className="flex items-center gap-2 flex-wrap">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
              filter === f.key
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background text-muted-foreground border-border hover:bg-muted'
            }`}
          >
            {isRtl ? f.ar : f.en}
            {typeof f.count === 'number' && f.count > 0 && (
              <span className={`mr-1.5 ${filter === f.key ? 'opacity-90' : 'opacity-60'}`}>({f.count})</span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">
          <div className="h-20 bg-muted animate-pulse rounded" />
          <div className="h-20 bg-muted animate-pulse rounded" />
          <div className="h-20 bg-muted animate-pulse rounded" />
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Bell className="h-12 w-12 mx-auto text-muted-foreground/50" />
            <p className="mt-3 text-muted-foreground">
              {filter === 'all' ? (isRtl ? 'لا توجد تنبيهات' : 'No notifications') : (isRtl ? 'لا توجد تنبيهات في هذا التصنيف' : 'No notifications in this filter')}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((n) => {
            const config = severityConfig[n.severity as keyof typeof severityConfig] || severityConfig.info
            const TypeIcon = typeIcons[n.type] || config.icon
            const typeLabel = typeLabels[n.type] || { ar: n.type, en: n.type }

            return (
              <Card
                key={n.id}
                className={`transition cursor-pointer hover:bg-muted/40 ${!n.read ? 'border-r-4 border-r-primary' : 'opacity-75'}`}
                onClick={() => navigateToNotification(n)}
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
                      <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                        {n.project && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary/60" />
                            {n.project.name}
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground/80">
                          {formatTime(n.createdAt)}
                        </span>
                      </div>
                    </div>
                    {!n.read && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => { e.stopPropagation(); markAsRead(n.id) }}
                        title={isRtl ? 'تعليم كمقروء' : 'Mark as read'}
                      >
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
    </div>
  )
}

