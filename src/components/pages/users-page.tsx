'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Plus, Search, UserPlus, Edit, Trash2, ToggleLeft, ToggleRight, Shield, Mail, Phone } from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { authedFetch } from '@/lib/api-client'
import { toast } from 'sonner'
import { ROLE_PERMISSIONS } from '@/lib/auth'

const roleLabels: Record<string, { ar: string; en: string }> = {
  top_management: { ar: 'الإدارة العليا', en: 'Top Management' },
  project_manager: { ar: 'مدير المشروع', en: 'Project Manager' },
  site_engineer: { ar: 'مهندس الموقع', en: 'Site Engineer' },
  hse_officer: { ar: 'مسؤول السلامة', en: 'HSE Officer' },
  foreman: { ar: 'المشرف', en: 'Foreman' },
  accountant: { ar: 'المحاسب', en: 'Accountant' },
}

const permissionLabels: Record<string, { ar: string; en: string }> = {
  dashboard: { ar: 'لوحة التحكم', en: 'Dashboard' },
  projects: { ar: 'المشاريع', en: 'Projects' },
  drive_lines: { ar: 'خطوط الحفر', en: 'Drive Lines' },
  daily_reports: { ar: 'التقارير اليومية', en: 'Daily Reports' },
  safety: { ar: 'السلامة', en: 'Safety' },
  equipment: { ar: 'المعدات', en: 'Equipment' },
  costs: { ar: 'التكاليف', en: 'Costs & Revenue' },
  finishings: { ar: 'التشطيبات', en: 'Finishings' },
  performance: { ar: 'تقييم الأداء', en: 'Performance' },
  reports: { ar: 'التقارير', en: 'Reports' },
  notifications: { ar: 'التنبيهات', en: 'Notifications' },
  users: { ar: 'إدارة المستخدمين', en: 'User Management' },
}

const allPermissions = Object.keys(permissionLabels)

function getDefaultPermissions(role: string): string[] {
  const perms = ROLE_PERMISSIONS[role] || []
  if (perms.includes('*')) return [...allPermissions]
  return [...perms]
}

interface FormState {
  name: string
  nameEn: string
  email: string
  password: string
  phone: string
  role: string
  language: string
  active: boolean
  permissions: string[]
}

const emptyForm: FormState = {
  name: '', nameEn: '', email: '', password: '', phone: '',
  role: 'site_engineer', language: 'ar', active: true, permissions: [],
}

export default function UsersPage() {
  const [users, setUsers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editUser, setEditUser] = useState<any | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<FormState>({ ...emptyForm })
  const language = useAppStore((s) => s.language)
  const currentUser = useAppStore((s) => s.user)
  const isRtl = language === 'ar'

  const t = {
    title: isRtl ? 'إدارة المستخدمين' : 'User Management',
    create: isRtl ? 'إنشاء مستخدم' : 'Create User',
    edit: isRtl ? 'تعديل المستخدم' : 'Edit User',
    search: isRtl ? 'بحث بالاسم أو البريد...' : 'Search by name or email...',
    name: isRtl ? 'الاسم (عربي)' : 'Name (Arabic)',
    nameEn: isRtl ? 'الاسم (إنجليزي)' : 'Name (English)',
    email: isRtl ? 'البريد الإلكتروني' : 'Email',
    password: isRtl ? 'كلمة المرور' : 'Password',
    passwordHint: isRtl ? 'اتركه فارغاً للتعديل' : 'Leave empty to keep current',
    phone: isRtl ? 'الهاتف' : 'Phone',
    role: isRtl ? 'الدور' : 'Role',
    languageLabel: isRtl ? 'اللغة' : 'Language',
    status: isRtl ? 'الحالة' : 'Status',
    active: isRtl ? 'نشط' : 'Active',
    inactive: isRtl ? 'معطل' : 'Inactive',
    permissions: isRtl ? 'الصلاحيات' : 'Permissions',
    permissionsHint: isRtl ? 'الأقسام المتاحة لهذا المستخدم' : 'Available sections for this user',
    selectAll: isRtl ? 'تحديد الكل' : 'Select All',
    deselectAll: isRtl ? 'إلغاء الكل' : 'Deselect All',
    noUsers: isRtl ? 'لا يوجد مستخدمون' : 'No users found',
    confirmDelete: isRtl ? 'هل أنت متأكد من حذف هذا المستخدم؟' : 'Delete this user? This cannot be undone.',
    cancel: isRtl ? 'إلغاء' : 'Cancel',
    delete: isRtl ? 'حذف' : 'Delete',
    save: isRtl ? 'حفظ' : 'Save',
    userCreated: isRtl ? 'تم إنشاء المستخدم بنجاح' : 'User created successfully',
    userUpdated: isRtl ? 'تم تحديث المستخدم بنجاح' : 'User updated successfully',
    userDeleted: isRtl ? 'تم حذف المستخدم' : 'User deleted',
    statusChanged: isRtl ? 'تم تغيير حالة المستخدم' : 'User status changed',
    deleteConfirm: isRtl ? 'حذف المستخدم' : 'Delete User',
    totalUsers: isRtl ? 'إجمالي المستخدمين' : 'Total Users',
    saving: isRtl ? 'جاري الحفظ...' : 'Saving...',
    loading: isRtl ? 'جاري التحميل...' : 'Loading...',
    you: isRtl ? 'أنت' : 'You',
    permsCount: isRtl ? 'صلاحية' : 'permissions',
    editDesc: isRtl ? 'تعديل بيانات المستخدم وصلاحياته' : 'Edit user details and permissions',
    createDesc: isRtl ? 'إضافة مستخدم جديد للنظام' : 'Add a new user to the system',
    fillRequired: isRtl ? 'يرجى ملء جميع الحقول المطلوبة' : 'Please fill all required fields',
    connError: isRtl ? 'فشل الاتصال' : 'Connection failed',
    error: isRtl ? 'حدث خطأ' : 'An error occurred',
  }

  async function fetchUsers() {
    setLoading(true)
    try {
      const res = await authedFetch('/api/users')
      const data = await res.json()
      if (res.ok) setUsers(data.users || [])
    } catch {}
    setLoading(false)
  }

  useEffect(() => { fetchUsers() }, [])

  function openCreate() {
    setEditUser(null)
    setForm({ ...emptyForm, role: 'site_engineer', permissions: getDefaultPermissions('site_engineer') })
    setDialogOpen(true)
  }

  function openEdit(u: any) {
    setEditUser(u)
    setForm({
      name: u.name || '', nameEn: u.nameEn || '', email: u.email || '',
      password: '', phone: u.phone || '', role: u.role || 'site_engineer',
      language: u.language || 'ar', active: u.active !== false,
      permissions: Array.isArray(u.permissions) && u.permissions.length > 0
        ? [...u.permissions] : getDefaultPermissions(u.role || 'site_engineer'),
    })
    setDialogOpen(true)
  }

  function togglePermission(perm: string) {
    setForm(prev => ({
      ...prev,
      permissions: prev.permissions.includes(perm)
        ? prev.permissions.filter(p => p !== perm) : [...prev.permissions, perm],
    }))
  }

  function handleRoleChange(role: string) {
    setForm(prev => ({ ...prev, role, permissions: getDefaultPermissions(role) }))
  }

  async function handleSave() {
  async function handleSave() {
    setSaving(true)
    try {
      const body: any = {
        name: (form.name || '').trim(),
        nameEn: (form.nameEn || '').trim() || null,
        email: (form.email || '').trim(),
        phone: (form.phone || '').trim() || null,
        role: form.role,
        language: form.language || 'ar',
        active: form.active !== false,
        permissions: form.permissions || [],
      }
      if (form.password && form.password.trim()) body.password = form.password.trim()
      const res = await authedFetch(editUser ? `/api/users/${editUser.id}` : '/api/users', {
        method: editUser ? 'PUT' : 'POST', body: JSON.stringify(body),
      })
      const data = await res.json()
      if (res.ok) {
        toast.success(editUser ? t.userUpdated : t.userCreated)
        setDialogOpen(false)
        fetchUsers()
      } else {
        toast.error(data.message || t.error)
      }
    } catch {
      toast.error(t.connError)
    } finally {
      setSaving(false)
    }
  }
      const body: any = {
        name: form.name, nameEn: form.nameEn || null, email: form.email,
        phone: form.phone || null, role: form.role, language: form.language,
        active: form.active, permissions: form.permissions,
      }
      if (form.password.trim()) body.password = form.password
      const res = await authedFetch(editUser ? `/api/users/${editUser.id}` : '/api/users', {
        method: editUser ? 'PUT' : 'POST', body: JSON.stringify(body),
      })
      const data = await res.json()
      if (res.ok) {
        toast.success(editUser ? t.userUpdated : t.userCreated)
        setDialogOpen(false)
        fetchUsers()
      } else {
        toast.error(data.message || t.error)
      }
    } catch { toast.error(t.connError) }
    setSaving(false)
  }

  async function handleDelete() {
    if (!deleteId) return
    try {
      const res = await authedFetch(`/api/users/${deleteId}`, { method: 'DELETE' })
      if (res.ok) { toast.success(t.userDeleted); setUsers(prev => prev.filter(u => u.id !== deleteId)) }
    } catch {}
    setDeleteId(null)
  }

  async function toggleActive(u: any) {
    try {
      const res = await authedFetch(`/api/users/${u.id}`, {
        method: 'PUT', body: JSON.stringify({ active: !u.active }),
      })
      if (res.ok) { toast.success(t.statusChanged); fetchUsers() }
    } catch {}
  }

  const filtered = users.filter(u => {
    if (!search) return true
    const q = search.toLowerCase()
    return (u.name || '').toLowerCase().includes(q) ||
           (u.nameEn || '').toLowerCase().includes(q) ||
           (u.email || '').toLowerCase().includes(q)
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">{t.title}</h2>
          <p className="text-muted-foreground text-sm mt-1">{t.totalUsers}: {users.length}</p>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <UserPlus className="h-4 w-4" />{t.create}
        </Button>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground start-3" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t.search} className="ps-10" />
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">{t.loading}</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">{t.noUsers}</div>
      ) : (
        <div className="grid gap-3">
          {filtered.map((u) => {
            const role = roleLabels[u.role] || { ar: u.role, en: u.role }
            const isMe = currentUser?.id === u.id
            return (
              <Card key={u.id} className={!u.active ? 'opacity-60' : ''}>
                <CardContent className="p-4">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold">{isRtl ? u.name : (u.nameEn || u.name)}</span>
                        {u.nameEn && isRtl && <span className="text-muted-foreground text-sm">({u.nameEn})</span>}
                        {isMe && <Badge variant="outline" className="text-xs">{t.you}</Badge>}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{u.email}</span>
                        {u.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{u.phone}</span>}
                      </div>
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <Badge variant={u.active ? 'default' : 'secondary'}>{u.active ? t.active : t.inactive}</Badge>
                        <Badge variant="outline">{isRtl ? role.ar : role.en}</Badge>
                        {u.permissions && u.permissions.length > 0 && (
                          <span className="text-xs text-muted-foreground">{u.permissions.length} {t.permsCount}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button variant="ghost" size="icon" onClick={() => toggleActive(u)} title={u.active ? t.inactive : t.active}>
                        {u.active ? <ToggleRight className="h-5 w-5 text-green-600" /> : <ToggleLeft className="h-5 w-5 text-muted-foreground" />}
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => openEdit(u)} disabled={isMe}><Edit className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => setDeleteId(u.id)} disabled={isMe} className="text-destructive hover:text-destructive">
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editUser ? t.edit : t.create}</DialogTitle>
            <DialogDescription>{editUser ? t.editDesc : t.createDesc}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t.name} *</Label>
                <Input value={form.name} onChange={(e) => setForm(p => ({ ...p, name: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>{t.nameEn}</Label>
                <Input value={form.nameEn} onChange={(e) => setForm(p => ({ ...p, nameEn: e.target.value }))} dir="ltr" />
              </div>
              <div className="space-y-2">
                <Label>{t.email} *</Label>
                <Input type="email" value={form.email} onChange={(e) => setForm(p => ({ ...p, email: e.target.value }))} dir="ltr" />
              </div>
              <div className="space-y-2">
                <Label>{editUser ? t.password : `${t.password} *`}</Label>
                <Input type="password" value={form.password} onChange={(e) => setForm(p => ({ ...p, password: e.target.value }))} placeholder={editUser ? t.passwordHint : ''} dir="ltr" />
              </div>
              <div className="space-y-2">
                <Label>{t.phone}</Label>
                <Input value={form.phone} onChange={(e) => setForm(p => ({ ...p, phone: e.target.value }))} dir="ltr" />
              </div>
              <div className="space-y-2">
                <Label>{t.role} *</Label>
                <Select value={form.role} onValueChange={handleRoleChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(roleLabels).map(([key, label]) => (
                      <SelectItem key={key} value={key}>{isRtl ? label.ar : label.en}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t.languageLabel}</Label>
                <Select value={form.language} onValueChange={(v) => setForm(p => ({ ...p, language: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ar">العربية</SelectItem>
                    <SelectItem value="en">English</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t.status}</Label>
                <Select value={form.active ? 'active' : 'inactive'} onValueChange={(v) => setForm(p => ({ ...p, active: v === 'active' }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">{t.active}</SelectItem>
                    <SelectItem value="inactive">{t.inactive}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-3 pt-2 border-t">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-base font-semibold flex items-center gap-2"><Shield className="h-4 w-4" />{t.permissions}</Label>
                  <p className="text-xs text-muted-foreground mt-1">{t.permissionsHint}</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setForm(p => ({ ...p, permissions: [...allPermissions] }))}>{t.selectAll}</Button>
                  <Button variant="outline" size="sm" onClick={() => setForm(p => ({ ...p, permissions: [] }))}>{t.deselectAll}</Button>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {allPermissions.map(perm => {
                  const label = permissionLabels[perm]
                  const isSelected = form.permissions.includes(perm)
                  return (
                    <button
                      key={perm}
                      type="button"
                      onClick={() => togglePermission(perm)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm border transition-all text-start ${
                        isSelected
                          ? 'bg-primary/10 border-primary text-primary font-medium'
                          : 'bg-muted/50 border-transparent text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      <div className={`h-4 w-4 rounded border-2 flex items-center justify-center shrink-0 ${
                        isSelected ? 'bg-primary border-primary' : 'border-muted-foreground/30'
                      }`}>
                        {isSelected && <span className="text-primary-foreground text-xs leading-none">&#10003;</span>}
                      </div>
                      {isRtl ? label.ar : label.en}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{t.cancel}</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? t.saving : t.save}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.deleteConfirm}</AlertDialogTitle>
            <AlertDialogDescription>{t.confirmDelete}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{t.delete}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
