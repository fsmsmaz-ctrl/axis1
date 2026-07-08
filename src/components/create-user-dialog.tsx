'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { useAppStore } from '@/lib/store'
import { authedFetch } from '@/lib/api-client'
import { toast } from 'sonner'
import { UserPlus, ShieldAlert, Trash2, Edit3, Save, ArrowLeft, Users, FolderKanban, FileBarChart } from 'lucide-react'
import { TOGGLABLE_PERMISSION_LABELS, MODULE_PERMISSIONS, REPORT_PERMISSIONS, ROLE_PERMISSIONS } from '@/lib/auth'

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

function permsArrayToRecord(arr: string[]): Record<string, boolean> {
  const rec: Record<string, boolean> = {}
  for (const k of arr) rec[k] = true
  return rec
}

function permsRecordToArray(rec: Record<string, boolean>): string[] {
  return Object.entries(rec).filter(([, v]) => v).map(([k]) => k)
}

interface CreateUserDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function CreateUserDialog({ open, onOpenChange }: CreateUserDialogProps) {
  const language = useAppStore((s) => s.language)
  const isRtl = language === 'ar'
  const token = useAppStore((s) => s.token)

  const [view, setView] = useState<'list' | 'create' | 'edit'>('list')
  const [users, setUsers] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [editingUser, setEditingUser] = useState<any>(null)

  const [form, setForm] = useState({
    name: '', nameEn: '', email: '', phone: '', role: 'site_engineer', password: '',
  })
  const [permissions, setPermissions] = useState<Record<string, boolean>>({})

  const [editForm, setEditForm] = useState({
    name: '', nameEn: '', phone: '', role: '', password: '',
  })
  const [editPermissions, setEditPermissions] = useState<Record<string, boolean>>({})
  const [prevRole, setPrevRole] = useState('')

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    try {
      const res = await authedFetch('/api/users')
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
    setEditPermissions(user.permissions ? permsArrayToRecord(user.permissions) : {})
    setPrevRole(user.role || '')
    setEditingUser(user)
    setView('edit')
  }

  useEffect(() => {
    const currentRole = view === 'edit' ? editForm.role : form.role
    if (currentRole && currentRole !== prevRole) {
      if (view === 'edit') setEditPermissions({})
      else setPermissions({})
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
      const res = await authedFetch('/api/users', {
        method: 'POST',
        body: JSON.stringify({ ...form, permissions: permsRecordToArray(permissions) }),
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
      const res = await authedFetch(`/api/users/${editingUser.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: editForm.name,
          nameEn: editForm.nameEn,
          role: editForm.role,
          phone: editForm.phone,
          password: editForm.password || undefined,
          permissions: permsRecordToArray(editPermissions),
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
    const msg = isRtl ? `هل أنت متأكد من حذف "${userName}"؟` : `Delete "${userName}"?`
    if (!confirm(msg)) return
    try {
      const res = await authedFetch(`/api/users/${userId}`, { method: 'DELETE' })
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

  function getRoleDefault(role: string, resource: string): boolean {
    if (role === 'top_management') return true
    const perms = ROLE_PERMISSIONS[role] || []
    return perms.includes('*') || perms.includes(resource)
  }

  function getEffectivePermission(permKey: string, customPerms: Record<string, boolean>, role: string): boolean {
    if (customPerms && typeof customPerms[permKey] === 'boolean') return customPerms[permKey]
    if (permKey.startsWith('report_')) {
      const perms = ROLE_PERMISSIONS[role] || []
      return perms.includes('*') || perms.includes('reports')
    }
    return getRoleDefault(role, permKey)
  }

  function renderPermissionGroup(
    groupKeys: readonly string[],
    customPerms: Record<string, boolean>,
    role: string,
    isEdit: boolean,
    groupLabel: string,
    iconType: 'module' | 'report'
  ) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 mt-1">
          {iconType === 'module' ? (
            <FolderKanban className="h-4 w-4 text-blue-500" />
          ) : (
            <FileBarChart className="h-4 w-4 text-purple-500" />
          )}
          <p className="text-sm font-semibold">{groupLabel}</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {groupKeys.map((key) => {
            const labels = TOGGLABLE_PERMISSION_LABELS[key]
            if (!labels) return null
            const isCustom = customPerms && typeof customPerms[key] === 'boolean'
            const effective = getEffectivePermission(key, customPerms, role)
            const isOverridden = isCustom && effective !== getEffectivePermission(key, {}, role)
            return (
              <div
                key={key}
                className={`flex items-center justify-between p-3 rounded-lg border transition cursor-pointer ${
                  effective ? 'bg-emerald-50/50 border-emerald-200' : 'bg-red-50/50 border-red-200'
                }`}
                onClick={() => togglePermission(key, isEdit)}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className={`h-4 w-4 rounded border-2 flex items-center justify-center shrink-0 ${
                    effective ? 'bg-primary border-primary' : 'border-muted-foreground/30'
                  }`}>
                    {effective && <span className="text-primary-foreground text-xs leading-none">&#10003;</span>}
                  </div>
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

  function renderPermissionSwitches(customPerms: Record<string, boolean>, role: string, isEdit: boolean) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <ShieldAlert className="h-4 w-4 text-orange-500" />
          <p className="text-sm font-medium text-orange-600">
            {isRtl ? 'تحكم بالصلاحيات' : 'Permissions Control'}
          </p>
        </div>
        <p className="text-xs text-muted-foreground mb-2">
          {isRtl
            ? 'فعّل أو عطّل صلاحية الوصول لكل قسم وتقرير'
            : 'Toggle access for each section and report type'}
        </p>
        {renderPermissionGroup(MODULE_PERMISSIONS, customPerms, role, isEdit, isRtl ? 'صلاحية الأقسام' : 'Module Access', 'module')}
        <Separator />
        {renderPermissionGroup(REPORT_PERMISSIONS, customPerms, role, isEdit, isRtl ? 'صلاحية التقارير' : 'Report Access', 'report')}
      </div>
    )
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) { setView('list'); setEditingUser(null) } }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          {view === 'create' ? (
            <>
              <DialogTitle className="flex items-center gap-2"><UserPlus className="h-5 w-5" />{isRtl ? 'إضافة مستخدم جديد' : 'Add New User'}</DialogTitle>
              <DialogDescription>{isRtl ? 'أدخل بيانات المستخدم الجديد وحدد صلاحياته' : 'Enter new user details and set permissions'}</DialogDescription>
            </>
          ) : view === 'edit' ? (
            <>
              <DialogTitle className="flex items-center gap-2"><Edit3 className="h-5 w-5" />{isRtl ? 'تعديل المستخدم' : 'Edit User'}</DialogTitle>
              <DialogDescription>{isRtl ? 'عدّل بيانات المستخدم وصلاحياته' : 'Edit user details and permissions'}</DialogDescription>
            </>
          ) : (
            <>
              <DialogTitle className="flex items-center gap-2"><Users className="h-5 w-5" />{isRtl ? 'إدارة المستخدمين' : 'User Management'}</DialogTitle>
              <DialogDescription>{isRtl ? 'أضف مستخدم جديد أو عدّل صلاحيات المستخدمين' : 'Add a new user or edit existing users'}</DialogDescription>
            </>
          )}
        </DialogHeader>

        {view === 'list' && (
          <div className="space-y-3">
            <Button onClick={openCreate} className="w-full gap-2">
              <UserPlus className="h-4 w-4" />{isRtl ? 'إضافة مستخدم جديد' : 'Add New User'}
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
                        <span className="text-sm font-semibold text-primary">{(isRtl ? u.name : (u.nameEn || u.name)).charAt(0)}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{isRtl ? u.name : (u.nameEn || u.name)}</p>
                        <p className="text-xs text-muted-foreground">{isRtl ? role.ar : role.en} - {u.email}</p>
                      </div>
                      <Badge variant={u.active !== false ? 'default' : 'secondary'} className="shrink-0">
                        {u.active !== false ? (isRtl ? 'نشط' : 'Active') : (isRtl ? 'معطل' : 'Inactive')}
                      </Badge>
                      {!isCurrentUserAdmin && (
                        <div className="flex gap-1 shrink-0">
                          <Button variant="outline" size="sm" onClick={() => openEdit(u)}><Edit3 className="h-3.5 w-3.5" /></Button>
                          <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => handleDelete(u.id, u.name)}><Trash2 className="h-3.5 w-3.5" /></Button>
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
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'الاسم (إنجليزي)' : 'Name (English)'}</Label>
                <Input value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} dir="ltr" />
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'البريد الإلكتروني' : 'Email'} *</Label>
                <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} dir="ltr" />
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'كلمة المرور' : 'Password'} *</Label>
                <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'الهاتف' : 'Phone'}</Label>
                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} dir="ltr" />
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'نوع الحساب' : 'Role'} *</Label>
                <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {VALID_ROLES.map((r) => (<SelectItem key={r.value} value={r.value}>{isRtl ? r.ar : r.en}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Separator />
            {renderPermissionSwitches(permissions, form.role, false)}
            <DialogFooter>
              <Button variant="outline" onClick={() => { setView('list'); fetchUsers() }}>
                <ArrowLeft className="h-4 w-4" />{isRtl ? 'رجوع' : 'Back'}
              </Button>
              <Button onClick={handleCreate} disabled={submitting}>
                {submitting ? (isRtl ? 'جاري الإنشاء...' : 'Creating...') : (isRtl ? 'إنشاء المستخدم' : 'Create User')}
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
                <Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'الاسم (إنجليزي)' : 'Name (English)'}</Label>
                <Input value={editForm.nameEn} onChange={(e) => setEditForm({ ...editForm, nameEn: e.target.value })} dir="ltr" />
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'الهاتف' : 'Phone'}</Label>
                <Input value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} dir="ltr" />
              </div>
              <div className="space-y-1.5">
                <Label>{isRtl ? 'نوع الحساب' : 'Role'}</Label>
                <Select value={editForm.role} onValueChange={(v) => setEditForm({ ...editForm, role: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {VALID_ROLES.map((r) => (<SelectItem key={r.value} value={r.value}>{isRtl ? r.ar : r.en}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>{isRtl ? 'كلمة المرور الجديدة (اتركها فارغة)' : 'New Password (leave empty)'}</Label>
                <Input type="password" value={editForm.password} onChange={(e) => setEditForm({ ...editForm, password: e.target.value })} />
              </div>
            </div>
            <Separator />
            {renderPermissionSwitches(editPermissions, editForm.role, true)}
            <DialogFooter>
              <Button variant="outline" onClick={() => { setView('list'); fetchUsers() }}>
                <ArrowLeft className="h-4 w-4" />{isRtl ? 'رجوع' : 'Back'}
              </Button>
              <Button variant="destructive" onClick={() => handleDelete(editingUser.id, editingUser.name)} className="gap-1.5">
                <Trash2 className="h-4 w-4" />{isRtl ? 'حذف' : 'Delete'}
              </Button>
              <Button onClick={handleUpdate} disabled={submitting} className="gap-1.5">
                <Save className="h-4 w-4" />
                {submitting ? (isRtl ? 'جاري الحفظ...' : 'Saving...') : (isRtl ? 'حفظ التعديلات' : 'Save Changes')}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
