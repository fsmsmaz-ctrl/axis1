'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { useAppStore } from '@/lib/store'
import { authedFetch } from '@/lib/api-client'
import { toast } from 'sonner'
import { UserPlus, ShieldAlert, Trash2, Edit3, Save, ArrowLeft, Users } from 'lucide-react'
import { TOGGLABLE_PERMISSIONS, TOGGLABLE_PERMISSION_LABELS, ROLE_PERMISSIONS } from '@/lib/auth'
import bcrypt from 'bcryptjs'

const VALID_ROLES = [
  { value: 'top_management', ar: 'الإدارة العليا', en: 'Top Management' },
  { value: 'project_manager', ar: 'مدير المشروع', en: 'Project Manager' },
  { value: 'site_engineer', ar: 'مهندس الموقع', en: 'Site Engineer' },
  { value: 'hse_officer', ar: 'مسؤول السلامة', en: 'HSE Officer' },
  { value: 'foreman', ar: 'المشرف', en: 'Foreman' },
  { value: 'accountant', ar: 'المحاسب', en: 'Accountant' },
]

const roleLabels: Record<string, { ar: string; en: string }> = {
  top_management: { ar: 'الإدارة العليا', en: 'Top Management' },
  project_manager: { ar: 'مدير المشروع', en: 'Project Manager' },
  site_engineer: { ar: 'مهندس الموقع', en: 'Site Engineer' },
  hse_officer: { ar: 'مسؤول السلامة', en: 'HSE Officer' },
  foreman: { ar: 'المشرف', en: 'Foreman' },
  accountant: { ar: 'المحاسب', en: 'Accountant' },
}

interface CreateUserDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function CreateUserDialog({ open, onOpenChange }: CreateUserDialogProps) {
  const language = useAppStore((s) => s.language)
  const isRtl = language === 'ar'
  const token = useAppStore((s) => s.token)

  // View mode: 'list' | 'create' | 'edit'
  const [view, setView] = useState<'list' | 'create' | 'edit'>('list')
  const [users, setUsers] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [editingUser, setEditingUser] = useState<any>(null)

  // Create form
  const [form, setForm] = useState({
    name: '', nameEn: '', email: '', phone: '', role: 'site_engineer', password: '',
  })
  const [permissions, setPermissions] = useState<Record<string, boolean>>({})

  // Edit form
  const [editForm, setEditForm] = useState({
    name: '', nameEn: '', phone: '', role: '', password: '',
  })
  const [editPermissions, setEditPermissions] = useState<Record<string, boolean>>({})

  // Track previous role to detect role changes
  const [prevRole, setPrevRole] = useState('')

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    try {
      const res = await authedFetch('/api/users/list')
      if (res.ok) {
        const data = await res.json()
        setUsers(data.users || [])
      }
    } catch {}
    setLoading(false)
  }, [token])

  useEffect(() => {
    if (open) fetchUsers()
  }, [open, fetchUsers])

  function openCreate() {
    setForm({ name: '', nameEn: '', email: '', phone: '', role: 'site_engineer', password: '' })
    setPermissions({})
    setPrevRole('site_engineer')
    setEditingUser(null)
    setView('create')
  }

  function openEdit(user: any) {
    setEditForm({
      name: user.name || '',
      nameEn: user.nameEn || '',
      phone: user.phone || '',
      role: user.role || '',
      password: '',
    })
    setEditPermissions(user.permissions ? { ...user.permissions } : {})
    setPrevRole(user.role || '')
    setEditingUser(user)
    setView('edit')
  }

  // When role changes, reset custom permissions
  useEffect(() => {
    const currentRole = view === 'edit' ? editForm.role : form.role
    if (currentRole && currentRole !== prevRole) {
      if (view === 'edit') {
        setEditPermissions({})
      } else {
        setPermissions({})
      }
      setPrevRole(currentRole)
    }
  }, [view === 'edit' ? editForm.role : form.role, view])

  function togglePermission(key: string, isEdit: boolean) {
    if (isEdit) {
      setEditPermissions(prev => ({ ...prev, [key]: !prev[key] }))
    } else {
      setPermissions(prev => ({ ...prev, [key]: !prev[key] }))
    }
  }

  async function handleCreate() {
    if (!form.name.trim() || !form.email.trim() || !form.password.trim()) {
      toast.error(isRtl ? 'الاسم والبريد وكلمة المرور مطلوبة' : 'Name, email and password are required')
      return
    }

    setSubmitting(true)
    try {
      const res = await authedFetch('/api/users/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, permissions }),
      })
      const data = await res.json()

      if (res.ok) {
        toast.success(isRtl ? 'تم إنشاء المستخدم بنجاح' : 'User created successfully')
        setView('list')
        fetchUsers()
      } else {
        toast.error(data.message || (isRtl ? 'فشل إنشاء المستخدم' : 'Failed to create user'))
      }
    } catch {
      toast.error(isRtl ? 'حدث خطأ' : 'Error')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleUpdate() {
    if (!editingUser) return

    setSubmitting(true)
    try {
      const res = await authedFetch('/api/users/update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: editingUser.id,
          name: editForm.name,
          nameEn: editForm.nameEn,
          role: editForm.role,
          phone: editForm.phone,
          password: editForm.password || undefined,
          permissions: editPermissions,
        }),
      })
      const data = await res.json()

      if (res.ok) {
        toast.success(isRtl ? 'تم تحديث المستخدم بنجاح' : 'User updated successfully')
        setView('list')
        setEditingUser(null)
        setEditPermissions({})
        fetchUsers()
      } else {
        toast.error(data.message || (isRtl ? 'فشل التحديث' : 'Update failed'))
      }
    } catch {
      toast.error(isRtl ? 'حدث خطأ' : 'Error')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(userId: string, userName: string) {
    const msg = isRtl
      ? `هل أنت متأكد من حذف المستخدم "${userName}"؟`
      : `Are you sure you want to delete "${userName}"?`
    if (!confirm(msg)) return

    try {
      const res = await authedFetch(`/api/users/delete?id=${userId}`, { method: 'DELETE' })
      const data = await res.json()

      if (res.ok) {
        toast.success(isRtl ? 'تم حذف المستخدم' : 'User deleted')
        fetchUsers()
      } else {
        toast.error(data.message || (isRtl ? 'فشل الحذف' : 'Delete failed'))
      }
    } catch {
      toast.error(isRtl ? 'حدث خطأ' : 'Error')
    }
  }

  // Get role's default permission for a resource
  function getRoleDefault(role: string, resource: string): boolean {
    if (role === 'top_management') return true
    const perms = ROLE_PERMISSIONS[role] || []
    return perms.includes('*') || perms.includes(resource)
  }

  // Effective permission = custom override if set, otherwise role default
  function getEffectivePermission(permKey: string, customPerms: Record<string, boolean>, role: string): boolean {
    if (customPerms && typeof customPerms[permKey] === 'boolean') {
      return customPerms[permKey]
    }
    return getRoleDefault(role, permKey)
  }

  function renderPermissionSwitches(customPerms: Record<string, boolean>, role: string, isEdit: boolean) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <ShieldAlert className="h-4 w-4 text-orange-500" />
          <p className="text-sm font-medium text-orange-600">
            {isRtl ? 'تحكم بالصلاحيات' : 'Permissions Control'}
          </p>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          {isRtl
            ? 'فعّل أو عطّل صلاحية الوصول لكل قسم. الصلاحيات المعدّلة تظهر عليها علامة "مخصص".'
            : 'Toggle access for each section. Modified permissions show a "Custom" badge.'
          }
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {(TOGGLABLE_PERMISSIONS as readonly string[]).map((key) => {
            const labels = TOGGLABLE_PERMISSION_LABELS[key]
            const isCustom = customPerms && typeof customPerms[key] === 'boolean'
            const effective = getEffectivePermission(key, customPerms, role)
            const isOverridden = isCustom && effective !== getRoleDefault(role, key)

            return (
              <div
                key={key}
                className={`flex items-center justify-between p-3 rounded-lg border transition cursor-pointer ${
                  effective
                    ? 'bg-emerald-50/50 border-emerald-200'
                    : 'bg-red-50/50 border-red-200'
                }`}
                onClick={() => togglePermission(key, isEdit)}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Switch
                    checked={effective}
                    onCheckedChange={() => togglePermission(key, isEdit)}
                  />
                  <span className={`text-sm ${effective ? '' : 'text-muted-foreground line-through'}`}>
                    {isRtl ? labels.ar : labels.en}
                  </span>
                </div>
                {isOverridden && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0 text-orange-600 border-orange-300">
                    {isRtl ? 'مخصص' : 'Custom'}
                  </Badge>
                )}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  const isAdmin = useAppStore((s) => s.user)?.email?.toLowerCase().trim() === 'admin@axis.om'

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) { setView('list'); setEditingUser(null) } }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          {view === 'create' ? (
            <>
              <DialogTitle className="flex items-center gap-2">
                <UserPlus className="h-5 w-5" />
                {isRtl ? 'إضافة مستخدم جديد' : 'Add New User'}
              </DialogTitle>
              <DialogDescription>
                {isRtl ? 'أدخل بيانات المستخدم الجديد ثم حدد صلاحيات الوصول' : 'Enter new user details and set access permissions'}
              </DialogDescription>
            </>
          ) : view === 'edit' ? (
            <>
              <DialogTitle className="flex items-center gap-2">
                <Edit3 className="h-5 w-5" />
                {isRtl ? 'تعديل المستخدم' : 'Edit User'}
              </DialogTitle>
              <DialogDescription>
                {isRtl ? 'عدّل بيانات المستخدم وصلاحياته' : 'Edit user details and permissions'}
              </DialogDescription>
            </>
          ) : (
            <>
              <DialogTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                {isRtl ? 'إدارة المستخدمين' : 'User Management'}
              </DialogTitle>
              <DialogDescription>
                {isRtl ? 'أضف مستخدم جديد أو عدّل صلاحيات المستخدمين الحاليين' : 'Add a new user or edit existing user permissions'}
              </DialogDescription>
            </>
          )}
        </DialogHeader>

        {view === 'list' && (
          <div className="space-y-3">
            <Button onClick={openCreate} className="w-full gap-2">
              <UserPlus className="h-4 w-4" />
              {isRtl ? 'إضافة مستخدم جديد' : 'Add New User'}
            </Button>

            <Separator />

            {loading ? (
              <div className="h-32 bg-muted animate-pulse rounded" />
            ) : users.length === 0 ? (
              <p className="text-center text-muted-foreground py-6">{isRtl ? 'لا يوجد مستخدمين' : 'No users'}</p>
            ) : (
              <div className="space-y-2 max-h-[50vh] overflow-y-auto">
                {users.map((u) => {
                  const role = roleLabels[u.role] || { ar: u.role, en: u.role }
                  const isCurrentUserAdmin = u.email?.toLowerCase().trim() === 'admin@axis.om'
                  return (
                    <div key={u.id} className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/30 transition">
                      <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <span className="text-sm font-semibold text-primary">
                          {(isRtl ? u.name : (u.nameEn || u.name)).charAt(0)}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{isRtl ? u.name : (u.nameEn || u.name)}</p>
                        <p className="text-xs text-muted-foreground">{isRtl ? role.ar : role.en} • {u.email}</p>
                      </div>
                      {u.permissions && Object.keys(u.permissions).length > 0 && (
                        <Badge variant="outline" className="text-[10px] text-orange-600 border-orange-300 shrink-0">
                          {isRtl ? 'صلاحيات مخصصة' : 'Custom'}
                        </Badge>
                      )}
                      {!isCurrentUserAdmin && (
                        <div className="flex gap-1 shrink-0">
                          <Button variant="outline" size="sm" onClick={() => openEdit(u)}>
                            <Edit3 className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => handleDelete(u.id, u.name)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {view === 'create' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{isRtl ? 'الاسم (عربي)' : 'Name (Arabic)'} *</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder={isRtl ? 'أحمد البلوشي' : 'Ahmed Al-Balushi'}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'الاسم (إنجليزي)' : 'Name (English)'}</Label>
                <Input
                  value={form.nameEn}
                  onChange={(e) => setForm({ ...form, nameEn: e.target.value })}
                  placeholder="Ahmed Al-Balushi"
                  dir="ltr"
                />
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'البريد الإلكتروني' : 'Email'} *</Label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="user@axis.om"
                  dir="ltr"
                />
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'كلمة المرور' : 'Password'} *</Label>
                <Input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="••••••••"
                />
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'الهاتف' : 'Phone'}</Label>
                <Input
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="+968"
                  dir="ltr"
                />
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'نوع الحساب' : 'Role'} *</Label>
                <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {VALID_ROLES.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {isRtl ? r.ar : r.en}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Separator />

            {renderPermissionSwitches(permissions, form.role, false)}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { setView('list'); fetchUsers() }}>
                <ArrowLeft className="h-4 w-4 ml-1.5" />
                {isRtl ? 'رجوع' : 'Back'}
              </Button>
              <Button type="button" onClick={handleCreate} disabled={submitting}>
                {submitting
                  ? (isRtl ? 'جاري الإنشاء...' : 'Creating...')
                  : <>{isRtl ? 'إنشاء المستخدم' : 'Create User'}</>
                }
              </Button>
            </DialogFooter>
          </div>
        )}

        {view === 'edit' && editingUser && (
          <div className="space-y-4">
            <div className="p-3 rounded-lg bg-muted/50 mb-1">
              <p className="text-sm font-medium">{editingUser.name}</p>
              <p className="text-xs text-muted-foreground">{editingUser.email}</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{isRtl ? 'الاسم (عربي)' : 'Name (Arabic)'}</Label>
                <Input
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'الاسم (إنجليزي)' : 'Name (English)'}</Label>
                <Input
                  value={editForm.nameEn}
                  onChange={(e) => setEditForm({ ...editForm, nameEn: e.target.value })}
                  dir="ltr"
                />
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'الهاتف' : 'Phone'}</Label>
                <Input
                  value={editForm.phone}
                  onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                  dir="ltr"
                />
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'نوع الحساب' : 'Role'}</Label>
                <Select value={editForm.role} onValueChange={(v) => setEditForm({ ...editForm, role: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {VALID_ROLES.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {isRtl ? r.ar : r.en}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>{isRtl ? 'كلمة المرور الجديدة (اتركها فارغة إذا لم ترد التغيير)' : 'New Password (leave empty to keep current)'}</Label>
                <Input
                  type="password"
                  value={editForm.password}
                  onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                  placeholder="••••••••"
                />
              </div>
            </div>

            <Separator />

            {renderPermissionSwitches(editPermissions, editForm.role, true)}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { setView('list'); fetchUsers() }}>
                <ArrowLeft className="h-4 w-4 ml-1.5" />
                {isRtl ? 'رجوع' : 'Back'}
              </Button>
              <Button type="button" variant="destructive" onClick={() => handleDelete(editingUser.id, editingUser.name)} className="gap-1.5">
                <Trash2 className="h-4 w-4" />
                {isRtl ? 'حذف' : 'Delete'}
              </Button>
              <Button type="button" onClick={handleUpdate} disabled={submitting} className="gap-1.5">
                <Save className="h-4 w-4" />
                {submitting
                  ? (isRtl ? 'جاري الحفظ...' : 'Saving...')
                  : (isRtl ? 'حفظ التعديلات' : 'Save Changes')
                }
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
