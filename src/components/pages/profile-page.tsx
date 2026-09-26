'use client'

// v48: صفحة الملف الشخصي — نقاط، بيانات الحساب (صورة + تغيير كلمة المرور)، والمشتريات
// المشتريات: يضيف الموظف غرضاً اشتراه مع صورة فاتورة إلزامية ثم يسلمه للمراجعة،
// ويُعتمد من قسم «مراجعة الفواتير» في لوحة التحكم فتُسجل تلقائياً في التكاليف.

import { useEffect, useState, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle
} from '@/components/ui/dialog'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import {
  UserCircle, Coins, KeyRound, ShoppingCart, Loader2, Plus, Pencil, Trash2,
  Send, Eye, ImageUp, CheckCircle2, XCircle, Clock, FileText, ShieldCheck, Lock
} from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { authedFetch, clearStoredToken } from '@/lib/api-client'
import { toast } from 'sonner'
import { MODULE_PERMISSIONS, REPORT_PERMISSIONS, TOGGLABLE_PERMISSION_LABELS, hasPermission } from '@/lib/auth'

const purchaseStatus: Record<string, { ar: string; en: string; color: any }> = {
  draft: { ar: 'مسودة', en: 'Draft', color: 'secondary' },
  submitted: { ar: 'مرسل للمراجعة', en: 'Submitted', color: 'default' },
  approved: { ar: 'معتمد', en: 'Approved', color: 'default' },
  rejected: { ar: 'مرفوض', en: 'Rejected', color: 'destructive' },
}

// ضغط الصورة قبل الرفع (data URL jpeg) — نفس نمط صور المعدات
function compressImage(file: File, maxSide: number, quality: number, cb: (dataUrl: string) => void, onErr: () => void) {
  var reader = new FileReader()
  reader.onload = function(ev) {
    var result = ev.target?.result as string
    var img = new Image()
    img.onload = function() {
      var w = img.width, h = img.height
      if (w > maxSide || h > maxSide) {
        if (w > h) { h = Math.round(h * maxSide / w); w = maxSide }
        else { w = Math.round(w * maxSide / h); h = maxSide }
      }
      var canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      var ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.drawImage(img, 0, 0, w, h)
        cb(canvas.toDataURL('image/jpeg', quality))
      } else onErr()
    }
    img.onerror = onErr
    img.src = result
  }
  reader.onerror = onErr
  reader.readAsDataURL(file)
}

export default function ProfilePage() {
  const language = useAppStore((s) => s.language)
  const token = useAppStore((s) => s.token)
  const user = useAppStore((s) => s.user)
  const setUser = useAppStore((s) => s.setUser)
  const isRtl = language === 'ar'

  const [profile, setProfile] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)

  // صورة الملف الشخصي
  const avatarInputRef = useRef<HTMLInputElement | null>(null)
  const [savingAvatar, setSavingAvatar] = useState(false)

  // تغيير كلمة المرور
  const [pwCurrent, setPwCurrent] = useState('')
  const [pwNew, setPwNew] = useState('')
  const [pwConfirm, setPwConfirm] = useState('')
  const [pwLoading, setPwLoading] = useState(false)

  // المشتريات
  const [purchases, setPurchases] = useState<any[]>([])
  const [purchasesLoading, setPurchasesLoading] = useState(true)
  const [purchaseDialogOpen, setPurchaseDialogOpen] = useState(false)
  const [editingPurchase, setEditingPurchase] = useState<any | null>(null)
  const [purchaseForm, setPurchaseForm] = useState({ title: '', amount: '', notes: '', invoiceImage: '' })
  const [savingPurchase, setSavingPurchase] = useState(false)
  const [submittingId, setSubmittingId] = useState<string | null>(null)
  const [viewInvoice, setViewInvoice] = useState<string | null>(null)
  const invoiceInputRef = useRef<HTMLInputElement | null>(null)

  async function loadProfile() {
    try {
      const r = await authedFetch('/api/profile')
      const d = await r.json()
      if (r.ok && d.profile) setProfile(d.profile)
    } catch {}
  }

  async function loadPurchases() {
    setPurchasesLoading(true)
    try {
      const r = await authedFetch('/api/purchases')
      const d = await r.json()
      if (r.ok) setPurchases(d.purchases || [])
    } catch {} finally {
      setPurchasesLoading(false)
    }
  }

  useEffect(() => {
    if (!token) return
    loadProfile()
    loadPurchases()
  }, [token])

  // ── صورة الملف الشخصي ──
  function onPickAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    var file = e.target.files && e.target.files[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error(isRtl ? 'يرجى اختيار ملف صورة' : 'Please select an image file')
      return
    }
    compressImage(file, 400, 0.8, function(dataUrl) {
      saveAvatar(dataUrl)
    }, function() {
      toast.error(isRtl ? 'فشل معالجة الصورة' : 'Failed to process image')
    })
    if (avatarInputRef.current) avatarInputRef.current.value = ''
  }

  async function saveAvatar(dataUrl: string) {
    setSavingAvatar(true)
    try {
      const r = await authedFetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatar: dataUrl }),
      })
      const d = await r.json()
      if (r.ok) {
        setProfile((p: any) => ({ ...(p || {}), avatar: d.profile.avatar }))
        // تحديث فوري لصورة الشريط الجانبي
        if (user) setUser({ ...user, avatar: d.profile.avatar })
        toast.success(isRtl ? 'تم تحديث صورة الملف الشخصي' : 'Profile picture updated')
      } else {
        toast.error(d.message || (isRtl ? 'فشل تحديث الصورة' : 'Failed to update picture'))
      }
    } catch {
      toast.error(isRtl ? 'خطأ في الاتصال' : 'Connection error')
    } finally {
      setSavingAvatar(false)
    }
  }

  async function removeAvatar() {
    setSavingAvatar(true)
    try {
      const r = await authedFetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatar: null }),
      })
      const d = await r.json()
      if (r.ok) {
        setProfile((p: any) => ({ ...(p || {}), avatar: null }))
        if (user) setUser({ ...user, avatar: null })
        toast.success(isRtl ? 'تمت إزالة الصورة' : 'Picture removed')
      }
    } catch {} finally {
      setSavingAvatar(false)
    }
  }

  // ── تغيير كلمة المرور ──
  async function changePassword(e: React.FormEvent) {
    e.preventDefault()
    if (pwNew !== pwConfirm) {
      toast.error(isRtl ? 'كلمتا المرور الجديدتان غير متطابقتين' : 'New passwords do not match')
      return
    }
    setPwLoading(true)
    try {
      const r = await authedFetch('/api/profile/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: pwCurrent, newPassword: pwNew }),
      })
      const d = await r.json()
      if (r.ok) {
        toast.success(d.message || (isRtl ? 'تم تغيير كلمة المرور' : 'Password changed'))
        setPwCurrent(''); setPwNew(''); setPwConfirm('')
        // رفع tokenVersion يبطّل الجلسة — خروج نظيع لإعادة الدخول بكلمة المرور الجديدة
        setTimeout(async function() {
          try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }) } catch {}
          clearStoredToken()
          setUser(null)
        }, 1500)
      } else {
        toast.error(d.message || (isRtl ? 'فشل تغيير كلمة المرور' : 'Failed to change password'))
      }
    } catch {
      toast.error(isRtl ? 'خطأ في الاتصال' : 'Connection error')
    } finally {
      setPwLoading(false)
    }
  }

  // ── المشتريات ──
  function openAddPurchase() {
    setEditingPurchase(null)
    setPurchaseForm({ title: '', amount: '', notes: '', invoiceImage: '' })
    setPurchaseDialogOpen(true)
  }

  function openEditPurchase(p: any) {
    setEditingPurchase(p)
    setPurchaseForm({
      title: p.title || '',
      amount: String(p.amount || ''),
      notes: p.notes || '',
      invoiceImage: p.invoiceImage || '',
    })
    setPurchaseDialogOpen(true)
  }

  function onPickInvoice(e: React.ChangeEvent<HTMLInputElement>) {
    var file = e.target.files && e.target.files[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error(isRtl ? 'يرجى اختيار ملف صورة' : 'Please select an image file')
      return
    }
    compressImage(file, 1200, 0.75, function(dataUrl) {
      setPurchaseForm(function(prev) { return { ...prev, invoiceImage: dataUrl } })
    }, function() {
      toast.error(isRtl ? 'فشل معالجة الصورة' : 'Failed to process image')
    })
    if (invoiceInputRef.current) invoiceInputRef.current.value = ''
  }

  async function savePurchase(e: React.FormEvent) {
    e.preventDefault()
    if (!purchaseForm.invoiceImage) {
      toast.error(isRtl ? 'صورة الفاتورة مطلوبة' : 'Invoice image is required')
      return
    }
    setSavingPurchase(true)
    try {
      const payload: any = {
        title: purchaseForm.title,
        amount: purchaseForm.amount,
        notes: purchaseForm.notes,
        invoiceImage: purchaseForm.invoiceImage,
      }
      const r = editingPurchase
        ? await authedFetch('/api/purchases/' + editingPurchase.id, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await authedFetch('/api/purchases', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
      const d = await r.json()
      if (r.ok) {
        toast.success(isRtl ? 'تم حفظ عملية الشراء' : 'Purchase saved')
        setPurchaseDialogOpen(false)
        loadPurchases()
      } else {
        toast.error(d.message || (isRtl ? 'فشل الحفظ' : 'Save failed'))
      }
    } catch {
      toast.error(isRtl ? 'خطأ في الاتصال' : 'Connection error')
    } finally {
      setSavingPurchase(false)
    }
  }

  async function submitPurchase(p: any) {
    if (!p.invoiceImage) {
      toast.error(isRtl ? 'صورة الفاتورة مطلوبة قبل التسليم' : 'Invoice image required before submission')
      return
    }
    setSubmittingId(p.id)
    try {
      const r = await authedFetch('/api/purchases/' + p.id, { method: 'POST' })
      const d = await r.json()
      if (r.ok) {
        toast.success(isRtl ? 'تم تسليم الفاتورة للمراجعة' : 'Invoice submitted for review')
        loadPurchases()
      } else {
        toast.error(d.message || (isRtl ? 'فشل التسليم' : 'Submit failed'))
      }
    } catch {
      toast.error(isRtl ? 'خطأ في الاتصال' : 'Connection error')
    } finally {
      setSubmittingId(null)
    }
  }

  async function deletePurchase(p: any) {
    if (!confirm(isRtl ? 'حذف هذه المسودة؟' : 'Delete this draft?')) return
    try {
      const r = await authedFetch('/api/purchases/' + p.id, { method: 'DELETE' })
      if (r.ok) {
        toast.success(isRtl ? 'تم الحذف' : 'Deleted')
        loadPurchases()
      } else {
        const d = await r.json().catch(function() { return {} })
        toast.error(d.message || (isRtl ? 'فشل الحذف' : 'Delete failed'))
      }
    } catch {
      toast.error(isRtl ? 'خطأ في الاتصال' : 'Connection error')
    }
  }

  var displayName = profile ? (isRtl ? profile.name : (profile.nameEn || profile.name)) : (user ? user.name : '')
  var roleKey = profile ? profile.role : (user ? user.role : '')
  var roleLabel = roleKey === 'top_management' ? (isRtl ? 'الإدارة العليا' : 'Top Management')
    : roleKey === 'project_manager' ? (isRtl ? 'مدير المشروع' : 'Project Manager')
    : roleKey === 'site_engineer' ? (isRtl ? 'مهندس الموقع' : 'Site Engineer')
    : roleKey === 'hse_officer' ? (isRtl ? 'مسؤول السلامة' : 'HSE Officer')
    : roleKey === 'foreman' ? (isRtl ? 'المشرف' : 'Foreman')
    : roleKey === 'accountant' ? (isRtl ? 'المحاسب' : 'Accountant')
    : roleKey

  // v49: صلاحيات الوصول للأقسام — قراءة فقط (تديرها الإدارة من إدارة المستخدمين)
  var v49Email = user ? user.email : (profile ? profile.email : '')
  var v49Perms = user ? user.permissions : null
  var v49ModuleAccess = MODULE_PERMISSIONS.filter(function(res) {
    return hasPermission(String(roleKey), res, v49Perms, v49Email)
  })
  var v49ReportAccess = REPORT_PERMISSIONS.filter(function(res) {
    return hasPermission(String(roleKey), res, v49Perms, v49Email)
  })

  return (
    <div className="space-y-4">
      {/* الترويسة: الصورة + الاسم + الدور */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="relative shrink-0">
              <Avatar className="h-20 w-20 border-2 border-primary/20">
                {profile && profile.avatar && <AvatarImage src={profile.avatar} alt={displayName} />}
                <AvatarFallback className="bg-primary/10 text-primary text-2xl font-semibold">
                  {displayName ? displayName.charAt(0) : '?'}
                </AvatarFallback>
              </Avatar>
              <button
                type="button"
                title={isRtl ? 'تغيير الصورة' : 'Change picture'}
                className="absolute -bottom-1 -end-1 h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow hover:opacity-90 transition"
                onClick={function() { if (avatarInputRef.current) avatarInputRef.current.click() }}
              >
                {savingAvatar ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageUp className="h-4 w-4" />}
              </button>
              <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={onPickAvatar} />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-bold truncate">{displayName || '-'}</h1>
              <p className="text-sm text-muted-foreground">{roleLabel}</p>
              {profile && <p className="text-xs text-muted-foreground mt-0.5">{profile.email}</p>}
              {profile && profile.avatar && (
                <Button variant="link" size="sm" className="p-0 h-auto text-xs text-destructive" onClick={removeAvatar}>
                  {isRtl ? 'إزالة الصورة' : 'Remove picture'}
                </Button>
              )}
            </div>
            {/* النقاط — تُفعّل لاحقاً عبر المهام (تحديث مستقل) */}
            <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-center min-w-[120px]">
              <Coins className="h-6 w-6 text-amber-500 mx-auto" />
              <p className="text-2xl font-bold text-amber-700 mt-1">{profile ? (profile.points || 0) : 0}</p>
              <p className="text-xs text-amber-700/80">{isRtl ? 'النقاط' : 'Points'}</p>
              <p className="text-[10px] text-amber-600/70 mt-1">{isRtl ? 'قريباً — تُمنح عبر المهام' : 'Soon — earned via tasks'}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* v49: الرتبة وصلاحيات الوصول للأقسام — قراءة فقط (تُدار من إدارة المستخدمين) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base flex-wrap">
            <div className="w-7 h-7 rounded-md bg-violet-100 text-violet-600 flex items-center justify-center">
              <ShieldCheck className="h-4 w-4" />
            </div>
            {isRtl ? 'الرتبة وصلاحيات الوصول' : 'Rank & Access Permissions'}
            <Badge variant="outline" className="text-[10px] font-normal gap-1">
              <Lock className="h-3 w-3" />
              {isRtl ? 'قراءة فقط' : 'Read only'}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">
            {isRtl
              ? 'رتبتك وصلاحيات وصولك إلى الأقسام يحددها النظام وتديرها الإدارة من إدارة المستخدمين — لا يمكن تعديلها من الملف الشخصي، وتظهر هنا للاطلاع فقط.'
              : 'Your rank and section access are set by the system and managed by administration in User Management — they cannot be changed from the profile, shown for reference only.'}
          </p>
          <div className="space-y-4">
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1.5">{isRtl ? 'الرتبة' : 'Rank'}</p>
              <Badge className="bg-violet-100 text-violet-700 text-xs">
                <ShieldCheck className="h-3.5 w-3.5 ml-1" />
                {roleLabel || String(roleKey)}
              </Badge>
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1.5">
                {isRtl
                  ? 'الأقسام المتاح الوصول إليها (' + v49ModuleAccess.length + ' من ' + MODULE_PERMISSIONS.length + ')'
                  : 'Accessible sections (' + v49ModuleAccess.length + ' of ' + MODULE_PERMISSIONS.length + ')'}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {MODULE_PERMISSIONS.map(function(res) {
                  var ok = v49ModuleAccess.indexOf(res) !== -1
                  var lbl = TOGGLABLE_PERMISSION_LABELS[res]
                  return (
                    <span key={res} className={'inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border ' + (ok ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-muted/40 border-border text-muted-foreground/60 line-through')}>
                      {ok ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                      {lbl ? (isRtl ? lbl.ar : lbl.en) : res}
                    </span>
                  )
                })}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1.5">
                {isRtl
                  ? 'التقارير المسموحة (' + v49ReportAccess.length + ' من ' + REPORT_PERMISSIONS.length + ')'
                  : 'Allowed reports (' + v49ReportAccess.length + ' of ' + REPORT_PERMISSIONS.length + ')'}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {REPORT_PERMISSIONS.map(function(res) {
                  var ok = v49ReportAccess.indexOf(res) !== -1
                  var lbl = TOGGLABLE_PERMISSION_LABELS[res]
                  return (
                    <span key={res} className={'inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border ' + (ok ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-muted/40 border-border text-muted-foreground/60 line-through')}>
                      {ok ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                      {lbl ? (isRtl ? lbl.ar : lbl.en) : res}
                    </span>
                  )
                })}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* بيانات الحساب: تغيير كلمة المرور فقط (الاسم والبريد من إدارة النظام) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <div className="w-7 h-7 rounded-md bg-blue-100 text-blue-600 flex items-center justify-center">
              <KeyRound className="h-4 w-4" />
            </div>
            {isRtl ? 'بيانات الحساب' : 'Account Data'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">
            {isRtl
              ? 'يمكنك من هنا إضافة صورة الملف الشخصي (من زر الكاميرا أعلاه) وإعادة تعيين كلمة مرور جديدة فقط. الاسم والبريد الإلكتروني يُدار من إدارة النظام.'
              : 'From here you can add a profile picture (camera button above) and reset your password only. Name and email are managed by administration.'}
          </p>
          <form onSubmit={changePassword} className="grid grid-cols-1 min-[420px]:grid-cols-3 gap-3 max-w-2xl">
            <div className="space-y-1.5">
              <Label>{isRtl ? 'كلمة المرور الحالية' : 'Current password'}</Label>
              <Input type="password" value={pwCurrent} onChange={function(e) { setPwCurrent(e.target.value) }} required autoComplete="current-password" />
            </div>
            <div className="space-y-1.5">
              <Label>{isRtl ? 'كلمة المرور الجديدة' : 'New password'}</Label>
              <Input type="password" value={pwNew} onChange={function(e) { setPwNew(e.target.value) }} required minLength={6} autoComplete="new-password" />
            </div>
            <div className="space-y-1.5">
              <Label>{isRtl ? 'تأكيد الجديدة' : 'Confirm new'}</Label>
              <Input type="password" value={pwConfirm} onChange={function(e) { setPwConfirm(e.target.value) }} required minLength={6} autoComplete="new-password" />
            </div>
            <div className="min-[420px]:col-span-3">
              <Button type="submit" size="sm" disabled={pwLoading}>
                {pwLoading ? <Loader2 className="h-4 w-4 animate-spin ml-1" /> : <KeyRound className="h-4 w-4 ml-1" />}
                {isRtl ? 'تغيير كلمة المرور' : 'Change password'}
              </Button>
              <p className="text-[11px] text-muted-foreground mt-2">
                {isRtl ? 'ملاحظة: بعد التغيير ستُسجَّل خروجك تلقائياً — سجّل الدخول بكلمة المرور الجديدة.' : 'Note: after changing you will be logged out — sign in with the new password.'}
              </p>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* المشتريات */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between flex-wrap gap-2">
            <span className="flex items-center gap-2 text-base">
              <div className="w-7 h-7 rounded-md bg-emerald-100 text-emerald-600 flex items-center justify-center">
                <ShoppingCart className="h-4 w-4" />
              </div>
              {isRtl ? 'المشتريات' : 'Purchases'}
              <Badge variant="secondary" className="text-xs font-normal">{purchases.length}</Badge>
            </span>
            <Button size="sm" onClick={openAddPurchase}>
              <Plus className="h-3.5 w-3.5 ml-1" />
              {isRtl ? 'إضافة عملية شراء' : 'Add Purchase'}
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">
            {isRtl
              ? 'عند شراء أي غرض: أضف العملية مع صورة الفاتورة (إلزامية) ثم سلّمها للمراجعة. بعد اعتمادها من الإدارة تُسجل تلقائياً في قسم التكاليف.'
              : 'For any purchase: add it with the invoice photo (required) then submit for review. Once approved it is recorded automatically in Costs.'}
          </p>
          {purchasesLoading ? (
            <div className="h-24 bg-muted animate-pulse rounded-lg" />
          ) : purchases.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground text-sm">
              <ShoppingCart className="h-10 w-10 mx-auto mb-2 opacity-30" />
              {isRtl ? 'لا توجد مشتريات مسجلة' : 'No purchases recorded'}
            </div>
          ) : (
            <div className="space-y-2">
              {purchases.map(function(p) {
                var st = purchaseStatus[p.status] || purchaseStatus.draft
                return (
                  <div key={p.id} className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/30 transition">
                    {p.invoiceImage ? (
                      <img src={p.invoiceImage} alt="invoice" className="h-14 w-14 rounded-lg object-cover border cursor-pointer shrink-0" onClick={function() { setViewInvoice(p.invoiceImage) }} />
                    ) : (
                      <div className="h-14 w-14 rounded-lg bg-muted flex items-center justify-center shrink-0">
                        <FileText className="h-5 w-5 text-muted-foreground" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-sm truncate">{p.title}</p>
                        <Badge variant={st.color} className="text-xs">
                          {p.status === 'approved' ? <CheckCircle2 className="h-3 w-3 ml-0.5" /> : p.status === 'rejected' ? <XCircle className="h-3 w-3 ml-0.5" /> : p.status === 'submitted' ? <Clock className="h-3 w-3 ml-0.5" /> : null}
                          {isRtl ? st.ar : st.en}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {new Date(p.createdAt).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US')}
                        {' • '}
                        <span className="font-medium">{p.amount} ر.ع</span>
                        {p.costId && (isRtl ? ' • مسجلة في التكاليف' : ' • recorded in Costs')}
                      </p>
                      {(p.status === 'rejected' || p.status === 'approved') && p.reviewNote && (
                        <p className={'text-xs mt-1 ' + (p.status === 'rejected' ? 'text-destructive' : 'text-emerald-700')}>
                          {isRtl ? 'ملاحظة المراجع' : 'Reviewer note'}: {p.reviewNote}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {p.status === 'draft' && (
                        <>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" title={isRtl ? 'تعديل' : 'Edit'} onClick={function() { openEditPurchase(p) }}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="outline" size="sm" className="text-emerald-600" title={isRtl ? 'تسليم للمراجعة' : 'Submit for review'} disabled={submittingId === p.id} onClick={function() { submitPurchase(p) }}>
                            {submittingId === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                          </Button>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive" title={isRtl ? 'حذف' : 'Delete'} onClick={function() { deletePurchase(p) }}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                      <Button variant="outline" size="sm" className="h-8 w-8 p-0" title={isRtl ? 'عرض الفاتورة' : 'View invoice'} onClick={function() { setViewInvoice(p.invoiceImage) }}>
                        <Eye className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* نافذة إضافة/تعديل عملية شراء */}
      <Dialog open={purchaseDialogOpen} onOpenChange={setPurchaseDialogOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingPurchase ? (isRtl ? 'تعديل عملية الشراء' : 'Edit Purchase') : (isRtl ? 'إضافة عملية شراء' : 'Add Purchase')}</DialogTitle>
            <DialogDescription>
              {isRtl ? 'صورة الفاتورة إلزامية لحفظ العملية' : 'Invoice image is required'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={savePurchase} className="space-y-3">
            <div className="space-y-1.5">
              <Label>{isRtl ? 'اسم الغرض المشترى' : 'Item name'} *</Label>
              <Input value={purchaseForm.title} onChange={function(e) { setPurchaseForm({ ...purchaseForm, title: e.target.value }) }} required maxLength={300} placeholder={isRtl ? 'مثال: خرطوم مياه — موقع الحفرة 3' : 'e.g. water hose — shaft 3'} />
            </div>
            <div className="space-y-1.5">
              <Label>{isRtl ? 'المبلغ (ر.ع)' : 'Amount (OMR)'} *</Label>
              <Input type="number" step="0.001" min="0.001" value={purchaseForm.amount} onChange={function(e) { setPurchaseForm({ ...purchaseForm, amount: e.target.value }) }} required />
            </div>
            <div className="space-y-1.5">
              <Label>{isRtl ? 'ملاحظات' : 'Notes'}</Label>
              <Textarea rows={2} value={purchaseForm.notes} onChange={function(e) { setPurchaseForm({ ...purchaseForm, notes: e.target.value }) }} maxLength={2000} />
            </div>
            <div className="space-y-1.5">
              <Label>{isRtl ? 'صورة الفاتورة' : 'Invoice image'} *</Label>
              {purchaseForm.invoiceImage ? (
                <div className="relative">
                  <img src={purchaseForm.invoiceImage} alt="invoice" className="w-full max-h-48 object-cover rounded-lg border" />
                  <button type="button" className="absolute top-1 end-1 h-7 w-7 rounded-full bg-background/90 border flex items-center justify-center text-destructive" onClick={function() { setPurchaseForm({ ...purchaseForm, invoiceImage: '' }) }}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <button type="button" className="w-full h-24 rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-1 text-muted-foreground hover:border-primary/50 hover:text-primary transition" onClick={function() { if (invoiceInputRef.current) invoiceInputRef.current.click() }}>
                  <ImageUp className="h-5 w-5" />
                  <span className="text-xs">{isRtl ? 'ارفع صورة الفاتورة' : 'Upload invoice photo'}</span>
                </button>
              )}
              <input ref={invoiceInputRef} type="file" accept="image/*" className="hidden" onChange={onPickInvoice} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={function() { setPurchaseDialogOpen(false) }}>{isRtl ? 'إلغاء' : 'Cancel'}</Button>
              <Button type="submit" disabled={savingPurchase || !purchaseForm.invoiceImage}>
                {savingPurchase ? <Loader2 className="h-4 w-4 animate-spin ml-1" /> : null}
                {isRtl ? 'حفظ' : 'Save'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* نافذة عرض الفاتورة بالحجم الكامل */}
      <Dialog open={!!viewInvoice} onOpenChange={function(open) { if (!open) setViewInvoice(null) }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{isRtl ? 'صورة الفاتورة' : 'Invoice image'}</DialogTitle>
          </DialogHeader>
          {viewInvoice && <img src={viewInvoice} alt="invoice" className="w-full max-h-[70vh] object-contain rounded-lg" />}
        </DialogContent>
      </Dialog>
    </div>
  )
}
