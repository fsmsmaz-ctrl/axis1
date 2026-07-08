'use client'

import { useEffect, useState } from 'react'
import { useAppStore } from '@/lib/store'
import { hasPermission, type SessionUser } from '@/lib/auth'
import { clearStoredToken, authedFetch } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  LayoutDashboard, FolderKanban, GitBranch, FileText, ShieldCheck,
  Wrench, DollarSign, CheckCircle2, FileBarChart, TrendingUp,
  Bell, LogOut, Menu, X, Globe, User, Settings,
  AlertTriangle, ChevronLeft
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import dynamic from 'next/dynamic'

type PageId =
  | 'dashboard' | 'projects' | 'driveLines' | 'dailyReports' | 'safety'
  | 'equipment' | 'costs' | 'finishings' | 'reports' | 'performance' | 'notifications'

interface NavItem {
  id: PageId
  labelAr: string
  labelEn: string
  icon: any
  resource: string
}

const navItems: NavItem[] = [
  { id: 'dashboard', labelAr: 'لوحة التحكم', labelEn: 'Dashboard', icon: LayoutDashboard, resource: 'dashboard' },
  { id: 'projects', labelAr: 'المشاريع', labelEn: 'Projects', icon: FolderKanban, resource: 'projects' },
  { id: 'driveLines', labelAr: 'خطوط الحفر', labelEn: 'Drive Lines', icon: GitBranch, resource: 'drive_lines' },
  { id: 'dailyReports', labelAr: 'التقارير اليومية', labelEn: 'Daily Reports', icon: FileText, resource: 'daily_reports' },
  { id: 'safety', labelAr: 'السلامة', labelEn: 'Safety', icon: ShieldCheck, resource: 'safety' },
  { id: 'equipment', labelAr: 'المعدات', labelEn: 'Equipment', icon: Wrench, resource: 'equipment' },
  { id: 'costs', labelAr: 'التكاليف والإيرادات', labelEn: 'Costs & Revenue', icon: DollarSign, resource: 'costs' },
  { id: 'finishings', labelAr: 'التشطيبات', labelEn: 'Finishings', icon: CheckCircle2, resource: 'finishings' },
  { id: 'performance', labelAr: 'تقييم الأداء', labelEn: 'Performance', icon: TrendingUp, resource: 'performance' },
  { id: 'reports', labelAr: 'التقارير', labelEn: 'Reports', icon: FileBarChart, resource: 'reports' },
  { id: 'notifications', labelAr: 'التنبيهات', labelEn: 'Notifications', icon: Bell, resource: 'notifications' },
]

const roleLabels: Record<string, { ar: string; en: string }> = {
  top_management: { ar: 'الإدارة العليا', en: 'Top Management' },
  project_manager: { ar: 'مدير المشروع', en: 'Project Manager' },
  site_engineer: { ar: 'مهندس الموقع', en: 'Site Engineer' },
  hse_officer: { ar: 'مسؤول السلامة', en: 'HSE Officer' },
  foreman: { ar: 'المشرف', en: 'Foreman' },
  accountant: { ar: 'المحاسب', en: 'Accountant' },
}

const DashboardPage = dynamic(() => import('@/components/pages/dashboard-page'), { ssr: false })
const ProjectsPage = dynamic(() => import('@/components/pages/projects-page'), { ssr: false })
const DriveLinesPage = dynamic(() => import('@/components/pages/drive-lines-page'), { ssr: false })
const DailyReportsPage = dynamic(() => import('@/components/pages/daily-reports-page'), { ssr: false })
const SafetyPage = dynamic(() => import('@/components/pages/safety-page'), { ssr: false })
const EquipmentPage = dynamic(() => import('@/components/pages/equipment-page'), { ssr: false })
const CostsPage = dynamic(() => import('@/components/pages/costs-page'), { ssr: false })
const FinishingsPage = dynamic(() => import('@/components/pages/finishings-page'), { ssr: false })
const PerformancePage = dynamic(() => import('@/components/pages/performance-page'), { ssr: false })
const ReportsPage = dynamic(() => import('@/components/pages/reports-page'), { ssr: false })
const NotificationsPage = dynamic(() => import('@/components/pages/notifications-page'), { ssr: false })

export default function AppShell() {
  const user = useAppStore((s) => s.user)
  const setUser = useAppStore((s) => s.setUser)
  const token = useAppStore((s) => s.token)
  const language = useAppStore((s) => s.language)
  const setLanguage = useAppStore((s) => s.setLanguage)
  const sidebarOpen = useAppStore((s) => s.sidebarOpen)
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen)
  const [currentPage, setCurrentPage] = useState<PageId>('dashboard')
  const [notifications, setNotifications] = useState<any[]>([])

  useEffect(() => {
    if (!user || !token) return
    authedFetch('/api/notifications?unreadOnly=true')
      .then(r => r.json())
      .then(data => setNotifications(data.notifications || []))
      .catch(() => {})
  }, [user, token, currentPage])

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = language
      document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr'
    }
  }, [language])

  if (!user) return null

  const allowedItems = navItems.filter(item => hasPermission(user.role, item.resource))

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
    clearStoredToken()
    setUser(null)
    toast.success('تم تسجيل الخروج')
  }

  function toggleLanguage() {
    const newLang = language === 'ar' ? 'en' : 'ar'
    setLanguage(newLang)
    document.documentElement.lang = newLang
    document.documentElement.dir = newLang === 'ar' ? 'rtl' : 'ltr'
  }

  function renderPage() {
    switch (currentPage) {
      case 'dashboard': return <DashboardPage onNavigate={setCurrentPage} />
      case 'projects': return <ProjectsPage />
      case 'driveLines': return <DriveLinesPage />
      case 'dailyReports': return <DailyReportsPage />
      case 'safety': return <SafetyPage />
      case 'equipment': return <EquipmentPage />
      case 'costs': return <CostsPage />
      case 'finishings': return <FinishingsPage />
      case 'performance': return <PerformancePage />
      case 'reports': return <ReportsPage />
      case 'notifications': return <NotificationsPage />
      default: return <DashboardPage onNavigate={setCurrentPage} />
    }
  }

  const isRtl = language === 'ar'

  return (
    <div className="min-h-screen bg-muted/30" dir={isRtl ? 'rtl' : 'ltr'}>
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside
        className={cn(
          "fixed top-0 bottom-0 z-50 w-72 bg-sidebar border-sidebar-border flex flex-col transition-transform duration-300 lg:translate-x-0",
          isRtl ? "right-0 border-l" : "left-0 border-r",
          sidebarOpen ? "translate-x-0" : (isRtl ? "translate-x-full" : "-translate-x-full")
        )}
      >
        <div className="px-5 py-4 border-b border-sidebar-border">
          <div className="flex items-center gap-3">
            <div className="shrink-0">
              <img
                src="/logo-orange.png"
                alt="AXIS"
                className="h-9 w-auto object-contain"
              />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-bold text-sidebar-foreground leading-tight tracking-wide">AXIS</h1>
              <p className="text-[10px] text-muted-foreground leading-tight">Pipe Jacking System</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className={cn("lg:hidden", isRtl ? "mr-auto" : "ml-auto")}
              onClick={() => setSidebarOpen(false)}
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          {allowedItems.map((item) => {
            const Icon = item.icon
            const isActive = currentPage === item.id
            const label = isRtl ? item.labelAr : item.labelEn
            const unreadCount = item.id === 'notifications' ? notifications.length : 0
            return (
              <button
                key={item.id}
                onClick={() => { setCurrentPage(item.id); setSidebarOpen(false) }}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all",
                  isActive
                    ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
                    : "text-sidebar-foreground hover:bg-sidebar-accent"
                )}
              >
                <Icon className={cn("h-5 w-5 shrink-0", isActive ? "" : "text-muted-foreground")} />
                <span className="flex-1 text-start">{label}</span>
                {unreadCount > 0 && (
                  <Badge variant="destructive" className="h-5 min-w-5 flex items-center justify-center px-1.5 text-xs">
                    {unreadCount}
                  </Badge>
                )}
                {isActive && <ChevronLeft className={cn("h-4 w-4", isRtl ? "" : "rotate-180")} />}
              </button>
            )
          })}
        </nav>
        <div className="p-3 border-t border-sidebar-border">
          <div className="flex items-center gap-3 p-2 rounded-lg">
            <Avatar className="h-10 w-10 border-2 border-primary/20 shrink-0">
              <AvatarFallback className="bg-primary/10 text-primary font-semibold">
                {(isRtl ? user.name : (user.nameEn || user.name)).charAt(0)}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{isRtl ? user.name : (user.nameEn || user.name)}</p>
              <p className="text-xs text-muted-foreground">
                {isRtl ? roleLabels[user.role]?.ar : roleLabels[user.role]?.en}
              </p>
            </div>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0" onClick={handleLogout} title={isRtl ? 'تسجيل الخروج' : 'Logout'}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </aside>
      <div className={isRtl ? "lg:pr-72" : "lg:pl-72"}>
        <header className="sticky top-0 z-30 h-16 bg-background/80 backdrop-blur border-b flex items-center px-4 lg:px-6 gap-3">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setSidebarOpen(true)}>
            <Menu className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            <h2 className="text-lg font-semibold">
              {isRtl ? navItems.find(i => i.id === currentPage)?.labelAr : navItems.find(i => i.id === currentPage)?.labelEn}
            </h2>
          </div>
          <Button variant="ghost" size="sm" onClick={toggleLanguage} className="gap-1.5">
            <Globe className="h-4 w-4" />
            <span className="text-sm">{isRtl ? 'EN' : 'ع'}</span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="relative">
                <Bell className="h-5 w-5" />
                {notifications.length > 0 && (
                  <span className={cn("absolute -top-1 h-5 w-5 rounded-full bg-destructive text-destructive-foreground text-xs flex items-center justify-center", isRtl ? "-left-1" : "-right-1")}>
                    {notifications.length}
                  </span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align={isRtl ? "start" : "end"} className="w-80">
              <DropdownMenuLabel className="flex items-center justify-between">
                <span>{isRtl ? 'التنبيهات' : 'Notifications'}</span>
                {notifications.length > 0 && <Badge variant="secondary">{notifications.length}</Badge>}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {notifications.length === 0 ? (
                <div className="p-4 text-center text-sm text-muted-foreground">{isRtl ? 'لا توجد تنبيهات جديدة' : 'No new notifications'}</div>
              ) : (
                notifications.slice(0, 5).map((n) => (
                  <DropdownMenuItem key={n.id} className="flex-col items-start p-3">
                    <div className="flex items-center gap-2 w-full">
                      {n.severity === 'critical' && <AlertTriangle className="h-4 w-4 text-destructive" />}
                      {n.severity === 'warning' && <AlertTriangle className="h-4 w-4 text-yellow-500" />}
                      {n.severity === 'info' && <Bell className="h-4 w-4 text-blue-500" />}
                      <span className="font-medium text-sm">{n.title}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{n.message}</p>
                  </DropdownMenuItem>
                ))
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setCurrentPage('notifications')}>{isRtl ? 'عرض الكل' : 'View all'}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Avatar className="h-9 w-9 border-2 border-primary/20 shrink-0">
            <AvatarFallback className="bg-primary/10 text-primary text-sm font-semibold">
              {(isRtl ? user.name : (user.nameEn || user.name)).charAt(0)}
            </AvatarFallback>
          </Avatar>
        </header>
        <main className="p-4 lg:p-6 max-w-[1600px] mx-auto">
          {renderPage()}
        </main>
      </div>
    </div>
  )
}
