'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { AlertTriangle, Bell, CheckCircle2, Info, XCircle, Trash2 } from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { authedFetch } from '@/lib/api-client'
import { toast } from 'sonner'

const severityConfig = {
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

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const language = useAppStore((s) => s.language)
  const token = useAppStore((s) => s.token)
  const isRtl = language === 'ar'

  async function fetchNotifications() {
    setLoading(true)
    const res = await authedFetch('/api/notifications')
    const data = await res.json()
    setNotifications(data.notifications || [])
    setLoading(false)
  }

  useEffect(() => {
    if (!token) return
    fetchNotifications()
  }, [token])

  async function markAsRead(id: string) {
    await fetch(`/api/notifications/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ read: true }),
    })
    fetchNotifications()
  }

  async function deleteNotification(id: string) {
    const res = await authedFetch(`/api/notifications/${id}`, { method: 'DELETE' })
    if (res.ok) {
      toast.success(isRtl ? 'تم حذف التنبيه' : 'Notification deleted')
      clearApiCache('notifications')
      fetchNotifications()
    }
  }

  async function markAllAsRead() {
    await Promise.all(
      notifications.filter(n => !n.read).map(n =>
        fetch(`/api/notifications/${n.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ read: true }),
        })
      )
    )
    toast.success(isRtl ? 'تم تعليم الكل كمقروء' : 'All marked as read')
    clearApiCache('notifications')
    fetchNotifications()
  }

  const unreadCount = notifications.filter(n => !n.read).length

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
                        <p className="text-xs text-muted-foreground mt-1">📍 {n.project.name}</p>
                      )}
                      <p className="text-xs text-muted-foreground mt-1">
                        {new Date(n.createdAt).toLocaleString(isRtl ? 'ar-EG' : 'en-US')}
                      </p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {!n.read && (
                        <Button variant="ghost" size="sm" onClick={() => markAsRead(n.id)}>
                          <CheckCircle2 className="h-4 w-4" />
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => deleteNotification(n.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
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
