'use client'

import { useState, useEffect } from 'react'
import { useAppStore } from '@/lib/store'
import { authedFetch } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2, UserPlus, Users, Shield, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

const ROLES = [
  { value: 'top_management', ar: 'الإدارة العليا', en: 'Top Management' },
  { value: 'project_manager', ar: 'مدير المشروع', en: 'Project Manager' },
  { value: 'site_engineer', ar: 'مهندس الموقع', en: 'Site Engineer' },
  { value: 'hse_officer', ar: 'مسؤول السلامة', en: 'HSE Officer' },
  { value: 'foreman', ar: 'المشرف / الفورمان', en: 'Foreman' },
  { value: 'accountant', ar: 'المحاسب', en: 'Accountant' },
]

interface ExistingUser {
  id: string
  email: string
  name: string
  nameEn: string
  role: string
  phone: string | null
  active: boolean
  roleLabel: { ar: string; en: string }
}

export default function CreateUserDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const language = useAppStore((s) => s.language)
  const isAr = language === 'ar'

  const [tab, setTab] = useState<'create' | 'list'>('create')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [existingUsers, setExistingUsers] = useState<ExistingUser[]>([])
  const [remainingSlots, setRemainingSlots] = useState(6)
  const [listLoading, setListLoading] = useState(false)

  const [formData, setFormData] = useState({
    email: '',
    name: '',
    nameEn: '',
    password: '',
    role: 'site_engineer',
    phone: '',
  })

  // Fetch existing users when dialog opens
  useEffect(() => {
    if (open && tab === 'list') {
      fetchUsers()
    }
  }, [open, tab])

  async function fetchUsers() {
    setListLoading(true)
    try {
      const res = await authedFetch('/api/users/list')
      const data = await res.json()
      if (res.ok) {
        setExistingUsers(data.users || [])
        setRemainingSlots(data.remainingSlots)
      }
    } catch {
      // silent
    } finally {
      setListLoading(false)
    }
  }

  function resetForm() {
    setFormData({ email: '', name: '', nameEn: '', password: '', role: 'site_engineer', phone: '' })
    setError('')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    if (!formData.email || !formData.password || !formData.name || !formData.role) {
      setError(isAr ? 'جميع الحقول المطلوبة يجب أن تُملأ' : 'All required fields must be filled')
      setLoading(false)
      return
    }

    if (formData.password.length < 6) {
      setError(isAr ? 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' : 'Password must be at least 6 characters')
      setLoading(false)
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
        setError(data.error || (isAr ? 'فشل إنشاء المستخدم' : 'Failed to create user'))
        return
      }

      toast.success(isAr ? 'تم إنشاء المستخدم بنجاح' : 'User created successfully')
      resetForm()
      setRemainingSlots(data.remainingSlots)
      // Switch to list tab to show new user
      setTab('list')
    } catch {
      setError(isAr ? 'خطأ في الاتصال' : 'Connection error')
    } finally {
      setLoading(false)
    }
  }

  const t = {
    title: isAr ? 'إدارة المستخدمين' : 'User Management',
    createTitle: isAr ? 'إنشاء مستخدم جديد' : 'Create New User',
    listTitle: isAr ? 'المستخدمون الحاليون' : 'Current Users',
    createDesc: isAr ? 'أضف مستخدم جديد للنظام (الحد الأقصى 6 مستخدمين)' : 'Add a new user to the system (max 6 users)',
    listDesc: isAr ? 'قائمة المستخدمين المسجلين في النظام' : 'List of registered users in the system',
    email: isAr ? 'البريد الإلكتروني *' : 'Email *',
    name: isAr ? 'الاسم (عربي) *' : 'Name (Arabic) *',
    nameEn: isAr ? 'الاسم (إنجليزي)' : 'Name (English)',
    password: isAr ? 'كلمة المرور *' : 'Password *',
    role: isAr ? 'الدور الوظيفي *' : 'Role *',
    phone: isAr ? 'رقم الهاتف' : 'Phone',
    create: isAr ? 'إنشاء الحساب' : 'Create Account',
    creating: isAr ? 'جارٍ الإنشاء...' : 'Creating...',
    cancel: isAr ? 'إلغاء' : 'Cancel',
    createTab: isAr ? 'إنشاء مستخدم' : 'Create User',
    listTab: isAr ? 'المستخدمون' : 'Users',
    remaining: isAr ? 'المتبقي' : 'Remaining',
    of: isAr ? 'من' : 'of',
    slots: isAr ? 'مقاعد' : 'slots',
    noUsers: isAr ? 'لا يوجد مستخدمون بعد' : 'No users yet',
    userEmail: isAr ? 'البريد' : 'Email',
    userRole: isAr ? 'الدور' : 'Role',
    userPhone: isAr ? 'الهاتف' : 'Phone',
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); resetForm() }}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            {t.title}
          </DialogTitle>
          <DialogDescription>
            {tab === 'create' ? t.createDesc : t.listDesc}
          </DialogDescription>
        </DialogHeader>

        {/* Tabs */}
        <div className="flex border rounded-lg overflow-hidden">
          <button
            onClick={() => setTab('create')}
            className={`flex-1 py-2 text-sm font-medium transition ${
              tab === 'create'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            <UserPlus className="h-4 w-4 inline-block mr-1.5" />
            {t.createTab}
          </button>
          <button
            onClick={() => setTab('list')}
            className={`flex-1 py-2 text-sm font-medium transition ${
              tab === 'list'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            <Users className="h-4 w-4 inline-block mr-1.5" />
            {t.listTab}
          </button>
        </div>

        {/* Slots counter */}
        <div className="flex items-center gap-2 text-sm">
          <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all"
              style={{ width: `${((6 - remainingSlots) / 6) * 100}%` }}
            />
          </div>
          <span className="text-muted-foreground shrink-0">
            {remainingSlots} {t.remaining} {t.of} 6 {t.slots}
          </span>
        </div>

        {tab === 'create' ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-email">{t.email}</Label>
              <Input
                id="new-email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="user@axis.om"
                dir="ltr"
                className="h-10"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="new-name">{t.name}</Label>
                <Input
                  id="new-name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="محمد أحمد"
                  className="h-10"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-nameEn">{t.nameEn}</Label>
                <Input
                  id="new-nameEn"
                  value={formData.nameEn}
                  onChange={(e) => setFormData({ ...formData, nameEn: e.target.value })}
                  placeholder="Mohammed Ahmed"
                  dir="ltr"
                  className="h-10"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-password">{t.password}</Label>
              <Input
                id="new-password"
                type="password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                placeholder="••••••••"
                dir="ltr"
                className="h-10"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>{t.role}</Label>
                <Select
                  value={formData.role}
                  onValueChange={(val) => setFormData({ ...formData, role: val })}
                >
                  <SelectTrigger className="h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {isAr ? r.ar : r.en}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-phone">{t.phone}</Label>
                <Input
                  id="new-phone"
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="+968XXXXXXXX"
                  dir="ltr"
                  className="h-10"
                />
              </div>
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t.cancel}
              </Button>
              <Button type="submit" disabled={loading || remainingSlots <= 0} className="gap-2">
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <UserPlus className="h-4 w-4" />
                )}
                {loading ? t.creating : t.create}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          /* Users list tab */
          <div className="space-y-2">
            {listLoading ? (
              <div className="py-8 text-center text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
                <span className="text-sm">{isAr ? 'جارٍ التحميل...' : 'Loading...'}</span>
              </div>
            ) : existingUsers.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">
                <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <span className="text-sm">{t.noUsers}</span>
              </div>
            ) : (
              <div className="border rounded-lg divide-y max-h-64 overflow-y-auto">
                {existingUsers.map((u) => (
                  <div key={u.id} className="flex items-center gap-3 p-3">
                    <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <span className="text-sm font-semibold text-primary">
                        {(isAr ? u.name : u.nameEn).charAt(0)}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{isAr ? u.name : u.nameEn}</p>
                      <p className="text-xs text-muted-foreground" dir="ltr">{u.email}</p>
                    </div>
                    <span className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary font-medium shrink-0">
                      {isAr ? u.roleLabel.ar : u.roleLabel.en}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}