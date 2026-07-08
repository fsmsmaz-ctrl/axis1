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
  Bell, HardHat, LogOut, Menu, X, Globe,
  AlertTriangle, ChevronLeft, UserPlus
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

// Dynamically import pages to avoid SSR issues
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
const CreateUserDialog = dynamic(() => import('@/components/create-user-dialog'), { ssr: false })

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
  const [userDialogOpen, setUserDialogOpen] = useState(false)

  useEffect(() => {
    if (!user || !token) return
    // Fetch notifications count - only when token is available
    authedFetch('/api/notifications?unreadOnly=true')
      .then(r => r.json())
      .then(data => setNotifications(data.notifications || []))
      .catch(() => {})
  }, [user, token, currentPage])

  // Sync document direction and language when language changes
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = language
      document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr'
    }
  }, [language])

  if (!user) return null

  const allowedItems = navItems.filter(item => hasPermission(user.role, item.resource, user.permissions))
  // Only admin@axis.om can manage users
  const isAdmin = user.email.toLowerCase().trim() === 'admin@axis.om'

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
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed top-0 bottom-0 z-50 w-72 bg-sidebar border-sidebar-border flex flex-col transition-transform duration-300 lg:translate-x-0",
          isRtl ? "right-0 border-l" : "left-0 border-r",
          sidebarOpen ? "translate-x-0" : (isRtl ? "translate-x-full" : "-translate-x-full")
        )}
      >
        {/* Logo */}
        <div className="p-5 border-b border-sidebar-border">
          <div className="flex items-center gap-3">
            <img
              src="data:image/png;base64,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"
              alt="AXIS"
              className="h-9 w-auto object-contain"
            />
            <div>
              <p className="text-xs text-muted-foreground">Pipe Jacking System</p>
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

        {/* Nav items */}
        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          {allowedItems.map((item) => {
            const Icon = item.icon
            const isActive = currentPage === item.id
            const label = isRtl ? item.labelAr : item.labelEn
            const unreadCount = item.id === 'notifications' ? notifications.length : 0

            return (
              <button
                key={item.id}
                onClick={() => {
                  setCurrentPage(item.id)
                  setSidebarOpen(false)
                }}
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

        {/* User card */}
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
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
              onClick={handleLogout}
              title={isRtl ? 'تسجيل الخروج' : 'Logout'}
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </aside>

      {/* Main content - padding depends on language direction */}
      <div className={isRtl ? "lg:pr-72" : "lg:pl-72"}>
        {/* Top header */}
        <header className="sticky top-0 z-30 h-16 bg-background/80 backdrop-blur border-b flex items-center px-4 lg:px-6 gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>

          {/* Admin: Add User Button */}
          {isAdmin && (
            <Button
              onClick={() => setUserDialogOpen(true)}
              size="sm"
              className="gap-1.5 bg-primary hover:bg-primary/90"
            >
              <UserPlus className="h-4 w-4" />
              <span className="hidden sm:inline text-sm">
                {isRtl ? 'إضافة مستخدم' : 'Add User'}
              </span>
            </Button>
          )}

          <div className="flex-1">
            <h2 className="text-lg font-semibold">
              {isRtl
                ? navItems.find(i => i.id === currentPage)?.labelAr
                : navItems.find(i => i.id === currentPage)?.labelEn}
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
                  <span className={cn(
                    "absolute -top-1 h-5 w-5 rounded-full bg-destructive text-destructive-foreground text-xs flex items-center justify-center",
                    isRtl ? "-left-1" : "-right-1"
                  )}>
                    {notifications.length}
                  </span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align={isRtl ? "start" : "end"} className="w-80">
              <DropdownMenuLabel className="flex items-center justify-between">
                <span>{isRtl ? 'التنبيهات' : 'Notifications'}</span>
                {notifications.length > 0 && (
                  <Badge variant="secondary">{notifications.length}</Badge>
                )}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {notifications.length === 0 ? (
                <div className="p-4 text-center text-sm text-muted-foreground">
                  {isRtl ? 'لا توجد تنبيهات جديدة' : 'No new notifications'}
                </div>
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
              <DropdownMenuItem onClick={() => setCurrentPage('notifications')}>
                {isRtl ? 'عرض الكل' : 'View all'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Avatar className="h-9 w-9 border-2 border-primary/20 shrink-0">
            <AvatarFallback className="bg-primary/10 text-primary text-sm font-semibold">
              {(isRtl ? user.name : (user.nameEn || user.name)).charAt(0)}
            </AvatarFallback>
          </Avatar>
        </header>

        {/* Page content */}
        <main className="p-4 lg:p-6 max-w-[1600px] mx-auto">
          {renderPage()}

      {/* Admin: Create User Dialog */}
      {isAdmin && (
        <CreateUserDialog open={userDialogOpen} onOpenChange={setUserDialogOpen} />
      )}
        </main>
      </div>
    </div>
  )
}
