'use client'

import { useEffect, useState } from 'react'
import { useAppStore } from '@/lib/store'
import { hasPermission, MODULE_PERMISSIONS, MODULE_PERMISSION_LABELS, REPORT_PERMISSIONS, REPORT_LABELS, ROLE_PERMISSIONS, type SessionUser } from '@/lib/auth'
import { clearStoredToken, authedFetch } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  LayoutDashboard, FolderKanban, GitBranch, FileText, ShieldCheck,
  Wrench, DollarSign, CheckCircle2, FileBarChart, TrendingUp,
  Bell, LogOut, Menu, X, Globe,
  AlertTriangle, ChevronLeft, UserPlus, Users, Loader2, Shield, Pencil, Trash2, Check,
  ShieldAlert
} from 'lucide-react'
import { Switch } from '@/components/ui/switch'
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

const ROLES = [
  { value: 'top_management', ar: 'الإدارة العليا', en: 'Top Management' },
  { value: 'project_manager', ar: 'مدير المشروع', en: 'Project Manager' },
  { value: 'site_engineer', ar: 'مهندس الموقع', en: 'Site Engineer' },
  { value: 'hse_officer', ar: 'مسؤول السلامة HSE', en: 'HSE Officer' },
  { value: 'foreman', ar: 'المشرف / الفورمان', en: 'Foreman' },
  { value: 'accountant', ar: 'المحاسب / الإدارة المالية', en: 'Accountant' },
]

// ─── Permission helpers ──────────────────────────────────────────
function getRoleDefaults(role: string): Record<string, boolean> {
  const defs: Record<string, boolean> = {}
  // Module permissions from role
  const rolePerms = ROLE_PERMISSIONS[role] || []
  const hasAll = rolePerms.includes('*')
  for (const key of MODULE_PERMISSIONS) {
    defs[key] = hasAll || rolePerms.includes(key)
  }
  // Report permissions: all roles get all reports by default
  for (const key of REPORT_PERMISSIONS) {
    defs[key] = hasAll || rolePerms.includes('reports')
  }
  return defs
}

function getEffective(key: string, role: string, customPerms: Record<string, boolean>): boolean {
  if (typeof customPerms[key] === 'boolean') return customPerms[key]
  return getRoleDefaults(role)[key] ?? false
}

function togglePerm(key: string, role: string, current: Record<string, boolean>): Record<string, boolean> {
  const defaults = getRoleDefaults(role)
  const currentVal = getEffective(key, role, current)
  const newVal = !currentVal
  // If toggling TO the default value, remove the override (cleaner)
  if (newVal === defaults[key]) {
    const next = { ...current }
    delete next[key]
    return next
  }
  return { ...current, [key]: newVal }
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
  const [userDialogOpen, setUserDialogOpen] = useState(false)
  const [formData, setFormData] = useState({ email: '', name: '', nameEn: '', password: '', role: 'site_engineer', phone: '', permissions: {} as Record<string, boolean> })
  const [createLoading, setCreateLoading] = useState(false)
  const [createError, setCreateError] = useState('')
  const [remainingSlots, setRemainingSlots] = useState(50)
  const [existingUsers, setExistingUsers] = useState<any[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [dialogTab, setDialogTab] = useState<'create' | 'list' | 'edit'>('create')
  const [editingUser, setEditingUser] = useState<any>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

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

  const allowedItems = navItems.filter(item => hasPermission(user.role, item.resource, user.permissions))
  const isAdmin = user.email.toLowerCase().trim() === 'admin@axis.om'
  const isAr = language === 'ar'
  const isRtl = isAr

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

  function openUserDialog() {
    setDialogTab('create')
    setFormData({ email: '', name: '', nameEn: '', password: '', role: 'site_engineer', phone: '', permissions: {} })
    setCreateError('')
    loadSlotInfo()
    setUserDialogOpen(true)
  }

  async function loadSlotInfo() {
    try {
      const res = await authedFetch('/api/users/list', { noCache: true })
      const data = await res.json()
      if (res.ok) {
        setRemainingSlots(data.remainingSlots ?? 50)
        setExistingUsers(data.users || [])
      }
    } catch {}
  }

  async function loadUserList() {
    setListLoading(true)
    try {
      const res = await authedFetch('/api/users/list', { noCache: true })
      const data = await res.json()
      if (res.ok) {
        setExistingUsers(data.users || [])
        setRemainingSlots(data.remainingSlots)
      }
    } catch {} finally {
      setListLoading(false)
    }
  }

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault()
    setCreateLoading(true)
    setCreateError('')
    if (dialogTab === 'edit') {
      const { email, ...updateFields } = formData
      try {
        const res = await authedFetch('/api/users/update', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: editingUser.id, ...updateFields, permissions: updateFields.permissions }),
        })
        const data = await res.json()
        if (!res.ok) {
          setCreateError(data.error || (isAr ? 'فشل تحديث المستخدم' : 'Failed to update user'))
          return
        }
        toast.success(isAr ? 'تم تحديث المستخدم بنجاح' : 'User updated successfully')
        setDialogTab('list')
        setEditingUser(null)
        loadUserList()
      } catch {
        setCreateError(isAr ? 'خطأ في الاتصال' : 'Connection error')
      } finally {
        setCreateLoading(false)
      }
      return
    }
    // Create new user
    if (!formData.email || !formData.password || !formData.name || !formData.role) {
      setCreateError(isAr ? 'جميع الحقول المطلوبة يجب أن تُملأ' : 'All required fields must be filled')
      setCreateLoading(false)
      return
    }
    try {
      const res = await authedFetch('/api/users/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })
      const data = await res.json()
      if (!res.ok) {
        setCreateError(data.error || (isAr ? 'فشل إنشاء المستخدم' : 'Failed to create user'))
        return
      }
      toast.success(isAr ? 'تم إنشاء المستخدم بنجاح' : 'User created successfully')
      setRemainingSlots(data.remainingSlots)
      setDialogTab('list')
      loadUserList()
    } catch {
      setCreateError(isAr ? 'خطأ في الاتصال' : 'Connection error')
    } finally {
      setCreateLoading(false)
    }
  }

  function openEditUser(u: any) {
    setEditingUser(u)
    setFormData({
      email: u.email,
      name: u.name,
      nameEn: u.nameEn || '',
      password: '',
      role: u.role,
      phone: u.phone || '',
      permissions: u.permissions ? { ...u.permissions } : {},
    })
    setCreateError('')
    setDialogTab('edit')
  }

  async function handleDeleteUser(userId: string) {
    try {
      const res = await authedFetch(`/api/users/delete?id=${userId}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || (isAr ? 'فشل حذف المستخدم' : 'Failed to delete user'))
        return
      }
      toast.success(isAr ? 'تم حذف المستخدم بنجاح' : 'User deleted successfully')
      setRemainingSlots(data.remainingSlots)
      setDeleteConfirm(null)
      loadUserList()
    } catch {
      toast.error(isAr ? 'خطأ في الاتصال' : 'Connection error')
    }
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

  return (
    <div className="min-h-screen bg-muted/30" dir={isRtl ? 'rtl' : 'ltr'}>
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <aside className={cn(
        "fixed top-0 bottom-0 z-50 w-72 bg-sidebar border-sidebar-border flex flex-col transition-transform duration-300 lg:translate-x-0",
        isRtl ? "right-0 border-l" : "left-0 border-r",
        sidebarOpen ? "translate-x-0" : (isRtl ? "translate-x-full" : "-translate-x-full")
      )}>
        <div className="p-4 pb-3 border-b border-sidebar-border">
          <div className="flex items-center gap-2">
            <img
              src="/axis-logo.png"
              alt="AXIS"
              className="h-9 w-auto object-contain flex-1 min-w-0"
            />
            <Button variant="ghost" size="icon" className={cn("lg:hidden shrink-0 h-7 w-7", isRtl ? "-mr-1" : "-ml-1")} onClick={() => setSidebarOpen(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">Pipe Jacking Management System</p>
        </div>

        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          {isAdmin && (
            <button
              onClick={openUserDialog}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-all border border-primary/20 border-dashed"
            >
              <UserPlus className="h-5 w-5 shrink-0" />
              <span className="flex-1 text-start">{isAr ? 'إدارة المستخدمين' : 'User Management'}</span>
            </button>
          )}
          <div className="h-2" />
          {allowedItems.map((item) => {
            const Icon = item.icon
            const isActive = currentPage === item.id
            const label = isRtl ? item.labelAr : item.labelEn
            const unreadCount = item.id === 'notifications' ? notifications.length : 0
            return (
              <button key={item.id} onClick={() => { setCurrentPage(item.id); setSidebarOpen(false) }} className={cn(
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all",
                isActive ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm" : "text-sidebar-foreground hover:bg-sidebar-accent"
              )}>
                <Icon className={cn("h-5 w-5 shrink-0", isActive ? "" : "text-muted-foreground")} />
                <span className="flex-1 text-start">{label}</span>
                {unreadCount > 0 && <Badge variant="destructive" className="h-5 min-w-5 flex items-center justify-center px-1.5 text-xs">{unreadCount}</Badge>}
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
              <p className="text-xs text-muted-foreground">{isRtl ? roleLabels[user.role]?.ar : roleLabels[user.role]?.en}</p>
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
                <span>{isAr ? 'التنبيهات' : 'Notifications'}</span>
                {notifications.length > 0 && <Badge variant="secondary">{notifications.length}</Badge>}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {notifications.length === 0 ? (
                <div className="p-4 text-center text-sm text-muted-foreground">{isAr ? 'لا توجد تنبيهات جديدة' : 'No new notifications'}</div>
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
              <DropdownMenuItem onClick={() => setCurrentPage('notifications')}>{isAr ? 'عرض الكل' : 'View all'}</DropdownMenuItem>
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

      {isAdmin && (
        <Dialog open={userDialogOpen} onOpenChange={(v) => setUserDialogOpen(v)}>
          <DialogContent className="sm:max-w-[680px] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-primary" />
                {isAr ? 'إدارة المستخدمين' : 'User Management'}
              </DialogTitle>
              <DialogDescription>
                {dialogTab === 'edit'
                  ? (isAr ? 'تعديل بيانات المستخدم' : 'Edit user information')
                  : dialogTab === 'create'
                  ? (isAr ? 'أضف مستخدم جديد (الحد الأقصى 50)' : 'Add a new user (max 50)')
                  : (isAr ? 'قائمة المستخدمين في النظام' : 'Users list')}
              </DialogDescription>
            </DialogHeader>

            <div className="flex border rounded-lg overflow-hidden">
              <button onClick={() => { setDialogTab('create'); setEditingUser(null); setFormData({ email: '', name: '', nameEn: '', password: '', role: 'site_engineer', phone: '', permissions: {} }); setCreateError(''); }} className={`flex-1 py-2.5 text-sm font-medium transition ${dialogTab === 'create' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}>
                <UserPlus className="h-4 w-4 inline-block mr-1.5" />
                {isAr ? 'إنشاء مستخدم' : 'Create User'}
              </button>
              <button onClick={() => { setDialogTab('list'); setEditingUser(null); loadUserList(); }} className={`flex-1 py-2.5 text-sm font-medium transition ${dialogTab === 'list' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}>
                <Users className="h-4 w-4 inline-block mr-1.5" />
                {isAr ? 'المستخدمون' : 'Users'}
              </button>
            </div>

            {dialogTab !== 'edit' && (
              <div className="flex items-center gap-3 text-sm">
                <div className="flex-1 h-2.5 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${((50 - remainingSlots) / 50) * 100}%` }} />
                </div>
                <span className="text-muted-foreground shrink-0 font-medium">{remainingSlots} {isAr ? 'متبقي من 50' : 'remaining of 50'}</span>
              </div>
            )}

            {(dialogTab === 'create' || dialogTab === 'edit') ? (
              <form onSubmit={handleCreateUser} className="space-y-4">
                {dialogTab === 'edit' && (
                  <div className="space-y-2">
                    <Label>{isAr ? 'البريد الإلكتروني' : 'Email'}</Label>
                    <Input type="email" value={formData.email} disabled dir="ltr" className="h-10 bg-muted cursor-not-allowed opacity-70" />
                    <p className="text-xs text-muted-foreground">{isAr ? 'لا يمكن تغيير البريد الإلكتروني' : 'Email cannot be changed'}</p>
                  </div>
                )}
                {dialogTab === 'create' && (
                  <div className="space-y-2">
                    <Label>{isAr ? 'البريد الإلكتروني (اسم المستخدم) *' : 'Email (Username) *'}</Label>
                    <Input type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} placeholder="user@axis.om" dir="ltr" className="h-10" />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>{isAr ? 'الاسم بالعربي *' : 'Name (Arabic) *'}</Label>
                    <Input value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="محمد أحمد" className="h-10" />
                  </div>
                  <div className="space-y-2">
                    <Label>{isAr ? 'الاسم بالإنجليزي' : 'Name (English)'}</Label>
                    <Input value={formData.nameEn} onChange={(e) => setFormData({ ...formData, nameEn: e.target.value })} placeholder="Mohammed Ahmed" dir="ltr" className="h-10" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>{dialogTab === 'edit'
                    ? (isAr ? 'كلمة المرور الجديدة (اتركها فارغة للإبقاء)' : 'New password (leave empty to keep current)')
                    : (isAr ? 'كلمة المرور *' : 'Password *')
                  }</Label>
                  <Input type="password" value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} placeholder="••••••••" dir="ltr" className="h-10" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>{isAr ? 'نوع الحساب *' : 'Role *'}</Label>
                    <Select value={formData.role} onValueChange={(val) => setFormData({ ...formData, role: val, permissions: {} })}>
                      <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {ROLES.map((r) => (
                          <SelectItem key={r.value} value={r.value}>{isAr ? r.ar : r.en}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>{isAr ? 'رقم الهاتف' : 'Phone'}</Label>
                    <Input type="tel" value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} placeholder="+968XXXXXXXX" dir="ltr" className="h-10" />
                  </div>
                </div>

                {/* ─── Permissions Section ─── */}
                <div className="space-y-3 pt-2">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <ShieldAlert className="h-4 w-4 text-primary" />
                    <span>{isAr ? 'صلاحيات الوصول إلى الأقسام' : 'Section Access Permissions'}</span>
                  </div>
                  <p className="text-xs text-muted-foreground -mt-1">
                    {isAr ? 'تغيير الدور يعيد الصلاحيات للقيم الافتراضية' : 'Changing role resets permissions to defaults'}
                  </p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 p-3 rounded-lg border bg-muted/30">
                    {MODULE_PERMISSIONS.map((key) => {
                      const labels = MODULE_PERMISSION_LABELS[key]
                      const val = getEffective(key, formData.role, formData.permissions)
                      const isDefault = typeof formData.permissions[key] !== 'boolean'
                      return (
                        <div key={key} className="flex items-center justify-between gap-2 py-1">
                          <span className="text-xs truncate">{isAr ? labels.ar : labels.en}</span>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {!isDefault && (
                              <Badge variant="outline" className="h-4 px-1 text-[10px] font-normal text-amber-600 border-amber-300">
                                {isAr ? 'مخصص' : 'custom'}
                              </Badge>
                            )}
                            <Switch
                              checked={val}
                              onCheckedChange={() => setFormData({ ...formData, permissions: togglePerm(key, formData.role, formData.permissions) })}
                              className={cn("scale-75", val ? "" : "opacity-50")}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <FileBarChart className="h-4 w-4 text-primary" />
                    <span>{isAr ? 'صلاحيات التقارير' : 'Report Permissions'}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 p-3 rounded-lg border bg-muted/30">
                    {REPORT_PERMISSIONS.map((key) => {
                      const labels = REPORT_LABELS[key]
                      const val = getEffective(key, formData.role, formData.permissions)
                      const isDefault = typeof formData.permissions[key] !== 'boolean'
                      return (
                        <div key={key} className="flex items-center justify-between gap-2 py-1">
                          <span className="text-xs truncate">{isAr ? labels.ar : labels.en}</span>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {!isDefault && (
                              <Badge variant="outline" className="h-4 px-1 text-[10px] font-normal text-amber-600 border-amber-300">
                                {isAr ? 'مخصص' : 'custom'}
                              </Badge>
                            )}
                            <Switch
                              checked={val}
                              onCheckedChange={() => setFormData({ ...formData, permissions: togglePerm(key, formData.role, formData.permissions) })}
                              className={cn("scale-75", val ? "" : "opacity-50")}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {createError && (
                  <Alert variant="destructive"><AlertDescription>{createError}</AlertDescription></Alert>
                )}
                <DialogFooter className="gap-2">
                  <Button type="button" variant="outline" onClick={() => { if (dialogTab === 'edit') { setDialogTab('list'); setEditingUser(null); } else { setUserDialogOpen(false) } }}>{isAr ? 'رجوع' : 'Back'}</Button>
                  {dialogTab === 'edit' ? (
                    <Button type="submit" disabled={createLoading} className="gap-2">
                      {createLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                      {createLoading ? (isAr ? 'جارٍ التحديث...' : 'Updating...') : (isAr ? 'حفظ التعديلات' : 'Save Changes')}
                    </Button>
                  ) : (
                    <Button type="submit" disabled={createLoading || remainingSlots <= 0} className="gap-2">
                      {createLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                      {createLoading ? (isAr ? 'جارٍ الإنشاء...' : 'Creating...') : (isAr ? 'إنشاء الحساب' : 'Create Account')}
                    </Button>
                  )}
                </DialogFooter>
              </form>
            ) : (
              <div className="space-y-2">
                {listLoading ? (
                  <div className="py-8 text-center text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
                    <span className="text-sm">{isAr ? 'جارٍ التحميل...' : 'Loading...'}</span>
                  </div>
                ) : existingUsers.length === 0 ? (
                  <div className="py-8 text-center text-muted-foreground">
                    <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <span className="text-sm">{isAr ? 'لا يوجد مستخدمون بعد' : 'No users yet'}</span>
                  </div>
                ) : (
                  <div className="border rounded-lg divide-y max-h-72 overflow-y-auto">
                    {existingUsers.map((u) => (
                      <div key={u.id} className="flex items-center gap-3 p-3">
                        <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                          <span className="text-sm font-semibold text-primary">{(isAr ? u.name : (u.nameEn || u.name)).charAt(0)}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{isAr ? u.name : (u.nameEn || u.name)}</p>
                          <p className="text-xs text-muted-foreground" dir="ltr">{u.email}</p>
                        </div>
                        <span className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary font-medium shrink-0">
                          {u.roleLabel ? (isAr ? u.roleLabel.ar : u.roleLabel.en) : u.role}
                        </span>
                        <div className="flex items-center gap-1 shrink-0">
                          {deleteConfirm === u.id ? (
                            <>
                              <Button size="sm" variant="destructive" className="h-7 px-2 text-xs gap-1" onClick={() => handleDeleteUser(u.id)}>
                                {isAr ? 'تأكيد' : 'Confirm'}
                              </Button>
                              <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setDeleteConfirm(null)}>
                                {isAr ? 'إلغاء' : 'No'}
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-primary" onClick={() => openEditUser(u)} title={isAr ? 'تعديل' : 'Edit'}>
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => setDeleteConfirm(u.id)} title={isAr ? 'حذف' : 'Delete'}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
