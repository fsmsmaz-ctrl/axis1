// ─── v97: قسم «المكتبات» ────────────────────────────────────────────────────
// قسم عام يظهر لكل الموظفين: كل موظف يُنشئ مكتباته للاحتفاظ بملفاته، ويصنع
// داخلها أقساماً يحدد كل واحد منها: «خاص به فقط» أو «عام يراه جميع الموظفين».
// الملفات تُخزَّن base64 في القاعدة (نمط مرفقات المهام نفسه) والخصوصية تُطبَّق
// خادمياً — القسم الخاص لا يُرسل أصلاً لغير صاحبه.
// القراءة عبر ذاكرة إدارة الحالة المركزية (v95/v96) — نفس نمط بقية الأقسام.

'use client'

import { useState, useRef, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Library, FolderPlus, Folder, Lock, Globe2, FileText, FileSpreadsheet, Image as ImageIcon,
  File as FileIcon, Download, Upload, Trash2, Pencil, Plus, RefreshCw, Loader2, ChevronLeft,
} from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { authedFetch } from '@/lib/api-client'
import { useCachedGet, invalidateCache } from '@/application/data-cache'
import { toast } from 'sonner'

interface LibOwner { id: string; name: string; nameEn?: string | null }
interface LibSectionRow { id: string; name: string; isPrivate: boolean; createdAt: string; ownerId: string; owner: LibOwner; fileCount: number }
interface LibRow {
  id: string; name: string; description?: string | null; createdAt: string
  ownerId: string; owner: LibOwner; isMine?: boolean; canManage?: boolean
  sectionCount: number; fileCount: number; sections: LibSectionRow[]
}
interface LibFileRow {
  id: string; fileName: string; fileType: string; size?: number | null; createdAt: string
  uploaderId: string; uploader: LibOwner; canDelete?: boolean
}

const MAX_FILE_BYTES = 4 * 1024 * 1024 // 4MB — نفس حد مرفقات المهام

/** نوع الملف من صيغته — نفس قائمة السماح الخادمية (صور/PDF/Word/Excel) */
function mimeToFileType(file: File): string | null {
  var t = (file.type || '').toLowerCase()
  var n = (file.name || '').toLowerCase()
  if (t.startsWith('image/')) return 'image'
  if (t === 'application/pdf' || n.endsWith('.pdf')) return 'pdf'
  if (t.includes('word') || t.includes('msword') || n.endsWith('.doc') || n.endsWith('.docx')) return 'doc'
  if (t.includes('excel') || t.includes('spreadsheetml') || n.endsWith('.xls') || n.endsWith('.xlsx')) return 'xls'
  return null
}

function fileTypeIcon(type: string) {
  if (type === 'image') return ImageIcon
  if (type === 'pdf') return FileText
  if (type === 'xls') return FileSpreadsheet
  return FileIcon
}

function fileTypeLabelAr(type: string): string {
  if (type === 'image') return 'صورة'
  if (type === 'pdf') return 'PDF'
  if (type === 'xls') return 'Excel'
  return 'مستند'
}

interface SectionViewProps {
  section: LibSectionRow
  lib: LibRow
  userId: string
  isAdmin: boolean
  isRtl: boolean
  onChanged: () => void
  onBackToSections: () => void
  onBackToLibraries: () => void
  onEditSection: (s: LibSectionRow) => void
  onDeleteSection: (s: LibSectionRow) => void
}

// ─── عرض ملفات قسم واحد ──────────────────────────────────────────────────────
// مكوّن مُفتّاحي بمعرّف القسم (key في الأب): تبديل القسم يعيد تركيبه من الصفر
// فلا تتسرب بيانات قسم سابق لآخر (حارس mountedRef في الخطّاف يمنع أي setState
// بعد الفك) — ويبقى يستخدم خطّاف الذاكرة المركزي نفسه بلا أي تعديل عليه.
function SectionFilesView(props: SectionViewProps) {
  const { section, lib, userId, isAdmin, isRtl, onChanged } = props
  const files = useCachedGet<{ files: LibFileRow[] }>(`/api/libraries/sections/${section.id}/files`)
  const [busy, setBusy] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function ownerName(o: LibOwner): string {
    return isRtl ? (o.name || o.nameEn || '') : (o.nameEn || o.name || '')
  }
  function fmtDate(s: string): string {
    return new Date(s).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US')
  }
  function fmtSize(n?: number | null): string {
    if (!n) return ''
    var kb = n / 1024
    if (kb < 1024) return `${Math.round(kb)} KB`
    return `${(kb / 1024).toFixed(1)} MB`
  }

  // صلاحيات الواجهة — مرآة لبوابات الخادم (الخادم يبقى المصدر النهائي)
  var canManageHere = section.ownerId === userId || lib.ownerId === userId || isAdmin

  // ─── رفع ملف ─────────────────────────────────────────────────────────────
  async function handleFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    var input = e.target
    var f = input.files && input.files[0]
    input.value = ''
    if (!f) return
    var picked = f // تثبيت النوع للاستخدام داخل الدالة المغلقة أدناه
    if (picked.size > MAX_FILE_BYTES) {
      toast.error(isRtl ? 'حجم الملف يتجاوز 4 ميغابايت' : 'File exceeds 4MB')
      return
    }
    var type = mimeToFileType(picked)
    if (!type) {
      toast.error(isRtl ? 'الصيغ المدعومة: صور، PDF، Word، Excel' : 'Supported: images, PDF, Word, Excel')
      return
    }
    setBusy(true)
    try {
      var url = await new Promise<string>((resolve, reject) => {
        var reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('read_failed'))
        reader.readAsDataURL(picked)
      })
      var res = await authedFetch(`/api/libraries/sections/${section.id}/files`, {
        method: 'POST',
        body: JSON.stringify({ fileName: picked.name, url, fileType: type }),
      })
      var data = await res.json().catch(() => null)
      if (!res.ok) toast.error(data?.message || (isRtl ? 'فشل الرفع — حاول مجدداً' : 'Upload failed — try again'))
      else {
        toast.success(isRtl ? 'رُفع الملف' : 'File uploaded')
        onChanged()
      }
    } catch {
      toast.error(isRtl ? 'فشل الاتصال' : 'Connection failed')
    } finally {
      setBusy(false)
    }
  }

  // ─── تحميل/فتح ملف ───────────────────────────────────────────────────────
  async function openFile(f: LibFileRow) {
    try {
      var res = await authedFetch(`/api/libraries/files/${f.id}`)
      var data = await res.json().catch(() => null)
      if (!res.ok || !data?.file?.url) {
        toast.error(data?.message || (isRtl ? 'تعذر تحميل الملف' : 'Failed to load file'))
        return
      }
      var url = String(data.file.url)
      if (url.startsWith('data:')) {
        var a = document.createElement('a')
        a.href = url
        a.download = f.fileName
        document.body.appendChild(a)
        a.click()
        a.remove()
      } else {
        window.open(url, '_blank', 'noopener,noreferrer')
      }
    } catch {
      toast.error(isRtl ? 'فشل الاتصال' : 'Connection failed')
    }
  }

  // ─── حذف ملف ─────────────────────────────────────────────────────────────
  async function deleteFile(f: LibFileRow) {
    if (!window.confirm(isRtl ? `حذف الملف «${f.fileName}»؟` : `Delete file "${f.fileName}"?`)) return
    try {
      var res = await authedFetch(`/api/libraries/files/${f.id}`, { method: 'DELETE' })
      var data = await res.json().catch(() => null)
      if (!res.ok) toast.error(data?.message || (isRtl ? 'فشل الحذف' : 'Delete failed'))
      else {
        toast.success(isRtl ? 'حُذف الملف' : 'File deleted')
        onChanged()
      }
    } catch {
      toast.error(isRtl ? 'فشل الاتصال' : 'Connection failed')
    }
  }

  return (
    <div className="space-y-4">
      {/* مسار التنقل */}
      <div className="flex items-center gap-1 text-sm text-muted-foreground flex-wrap">
        <button onClick={props.onBackToLibraries} className="hover:text-primary transition">{isRtl ? 'المكتبات' : 'Libraries'}</button>
        <ChevronLeft className="h-4 w-4 rotate-180 rtl:rotate-0" />
        <button onClick={props.onBackToSections} className="hover:text-primary transition">{lib.name}</button>
        <ChevronLeft className="h-4 w-4 rotate-180 rtl:rotate-0" />
        <span className="text-foreground font-medium">{section.name}</span>
      </div>

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            {section.name}
            {section.isPrivate ? (
              <Badge variant="outline" className="gap-1"><Lock className="h-3 w-3" />{isRtl ? 'خاص' : 'Private'}</Badge>
            ) : (
              <Badge variant="secondary" className="gap-1"><Globe2 className="h-3 w-3" />{isRtl ? 'عام' : 'Public'}</Badge>
            )}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {section.isPrivate
              ? (isRtl ? 'قسم خاص — يراه صاحبه والإدارة فقط' : 'Private section — visible to its owner and management only')
              : (isRtl ? 'قسم عام — يراه جميع الموظفين' : 'Public section — visible to all employees')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onChanged} disabled={files.refreshing}>
            <RefreshCw className={`h-4 w-4 ml-2 ${files.refreshing ? 'animate-spin' : ''}`} />
            {isRtl ? 'تحديث' : 'Refresh'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => props.onEditSection(section)} title={isRtl ? 'تعديل القسم' : 'Edit section'}>
            <Pencil className="h-4 w-4" />
          </Button>
          {canManageHere && (
            <>
              <input ref={fileInputRef} type="file" accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.doc,.docx,.xls,.xlsx" className="hidden" onChange={handleFilePicked} />
              <Button size="sm" onClick={() => fileInputRef.current?.click()} disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 ml-2 animate-spin" /> : <Upload className="h-4 w-4 ml-2" />}
                {isRtl ? 'رفع ملف' : 'Upload'}
              </Button>
            </>
          )}
        </div>
      </div>

      {files.loading ? (
        <div className="space-y-2">
          <div className="h-16 bg-muted animate-pulse rounded" />
          <div className="h-16 bg-muted animate-pulse rounded" />
        </div>
      ) : (files.data?.files || []).length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FileIcon className="h-12 w-12 mx-auto text-muted-foreground/50" />
            <p className="mt-3 text-muted-foreground">{isRtl ? 'لا توجد ملفات في هذا القسم بعد' : 'No files in this section yet'}</p>
            {canManageHere && <p className="text-xs text-muted-foreground mt-1">{isRtl ? 'استخدم زر «رفع ملف» لإضافة أول ملف' : 'Use "Upload" to add the first file'}</p>}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {(files.data?.files || []).map((f) => {
            var Icon = fileTypeIcon(f.fileType)
            return (
              <Card key={f.id} className="transition hover:bg-muted/40">
                <CardContent className="p-3 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate" title={f.fileName}>{f.fileName}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
                      <span>{fileTypeLabelAr(f.fileType)}</span>
                      {f.size ? <span>• {fmtSize(f.size)}</span> : null}
                      <span>• {ownerName(f.uploader)}</span>
                      <span>• {fmtDate(f.createdAt)}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="sm" onClick={() => openFile(f)} title={isRtl ? 'تحميل' : 'Download'}>
                      <Download className="h-4 w-4" />
                    </Button>
                    {(f.canDelete || f.uploaderId === userId) && (
                      <Button variant="ghost" size="sm" onClick={() => deleteFile(f)} className="text-destructive hover:text-destructive" title={isRtl ? 'حذف' : 'Delete'}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
      <p className="text-xs text-muted-foreground">{isRtl ? 'الحد الأقصى للملف 4 ميغابايت — الصور و PDF و Word و Excel' : 'Max 4MB per file — images, PDF, Word, Excel'}</p>
    </div>
  )
}

// ─── الصفحة الرئيسية: قائمة المكتبات وعرض المكتبة والأقسام ───────────────────
export default function LibrariesPage() {
  const user = useAppStore((s) => s.user)
  const language = useAppStore((s) => s.language)
  const isRtl = language === 'ar'

  // قائمة المكتبات — عبر ذاكرة إدارة الحالة المركزية (stale-while-revalidate)
  const libs = useCachedGet<{ libraries: LibRow[] }>('/api/libraries')
  const [view, setView] = useState<{ libId: string | null; sectionId: string | null }>({ libId: null, sectionId: null })

  // نوافذ الإنشاء والتعديل
  const [libDialog, setLibDialog] = useState<null | 'create' | 'edit'>(null)
  const [libForm, setLibForm] = useState({ name: '', description: '' })
  const [sectionDialog, setSectionDialog] = useState<null | { mode: 'create' | 'edit'; section?: LibSectionRow }>(null)
  const [sectionForm, setSectionForm] = useState({ name: '', isPrivate: false })
  const [busy, setBusy] = useState(false)

  const refreshAll = useCallback(() => {
    invalidateCache('/api/libraries')
    libs.refresh()
  }, [libs])

  const openLib = (id: string) => setView({ libId: id, sectionId: null })
  const openSection = (id: string) => setView((v) => ({ ...v, sectionId: id }))
  const backToLibraries = () => setView({ libId: null, sectionId: null })
  const backToSections = () => setView((v) => ({ ...v, sectionId: null }))

  const openLibRow = view.libId ? (libs.data?.libraries || []).find((l) => l.id === view.libId) || null : null
  const openSectionRow = openLibRow?.sections.find((s) => s.id === view.sectionId) || null

  var isAdmin = user?.isSystemAdmin === true
  function canManageSectionUI(section: LibSectionRow, lib: LibRow): boolean {
    if (!user) return false
    return section.ownerId === user.id || lib.ownerId === user.id || isAdmin
  }

  // ─── إنشاء/تعديل مكتبة ────────────────────────────────────────────────────
  async function submitLibrary() {
    if (!libForm.name.trim()) { toast.error(isRtl ? 'اسم المكتبة مطلوب' : 'Library name is required'); return }
    setBusy(true)
    try {
      var isEdit = libDialog === 'edit' && openLibRow
      var res = await authedFetch(isEdit ? `/api/libraries/${openLibRow!.id}` : '/api/libraries', {
        method: isEdit ? 'PATCH' : 'POST',
        body: JSON.stringify({ name: libForm.name.trim(), description: libForm.description.trim() || null }),
      })
      var data = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error(data?.message || (isRtl ? 'فشل الحفظ — حاول مجدداً' : 'Save failed — try again'))
      } else {
        toast.success(isEdit ? (isRtl ? 'حُدّثت المكتبة' : 'Library updated') : (isRtl ? 'أُنشئت المكتبة' : 'Library created'))
        setLibDialog(null)
        refreshAll()
      }
    } catch {
      toast.error(isRtl ? 'فشل الاتصال' : 'Connection failed')
    } finally {
      setBusy(false)
    }
  }

  // ─── حذف مكتبة ───────────────────────────────────────────────────────────
  async function deleteLibrary(lib: LibRow) {
    if (!window.confirm(isRtl ? `حذف مكتبة «${lib.name}» بكل أقسامها وملفاتها؟ لا يمكن التراجع.` : `Delete library "${lib.name}" with all its sections and files? This cannot be undone.`)) return
    try {
      var res = await authedFetch(`/api/libraries/${lib.id}`, { method: 'DELETE' })
      var data = await res.json().catch(() => null)
      if (!res.ok) toast.error(data?.message || (isRtl ? 'فشل الحذف' : 'Delete failed'))
      else {
        toast.success(isRtl ? 'حُذفت المكتبة' : 'Library deleted')
        backToLibraries()
        refreshAll()
      }
    } catch {
      toast.error(isRtl ? 'فشل الاتصال' : 'Connection failed')
    }
  }

  // ─── إنشاء/تعديل قسم ─────────────────────────────────────────────────────
  function openSectionDialog(mode: 'create' | 'edit', section?: LibSectionRow) {
    setSectionForm({ name: section ? section.name : '', isPrivate: section ? section.isPrivate : false })
    setSectionDialog({ mode, section })
  }

  async function submitSection() {
    if (!openLibRow || !sectionDialog) return
    if (!sectionForm.name.trim()) { toast.error(isRtl ? 'اسم القسم مطلوب' : 'Section name is required'); return }
    setBusy(true)
    try {
      var isEdit = sectionDialog.mode === 'edit' && sectionDialog.section
      var res = await authedFetch(isEdit ? `/api/libraries/sections/${sectionDialog.section!.id}` : `/api/libraries/${openLibRow.id}/sections`, {
        method: isEdit ? 'PATCH' : 'POST',
        body: JSON.stringify({ name: sectionForm.name.trim(), isPrivate: sectionForm.isPrivate }),
      })
      var data = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error(data?.message || (isRtl ? 'فشل الحفظ — حاول مجدداً' : 'Save failed — try again'))
      } else {
        toast.success(isEdit ? (isRtl ? 'حُدّث القسم' : 'Section updated') : (isRtl ? 'أُنشئ القسم' : 'Section created'))
        setSectionDialog(null)
        refreshAll()
      }
    } catch {
      toast.error(isRtl ? 'فشل الاتصال' : 'Connection failed')
    } finally {
      setBusy(false)
    }
  }

  // ─── حذف قسم ─────────────────────────────────────────────────────────────
  async function deleteSection(section: LibSectionRow) {
    if (!window.confirm(isRtl ? `حذف قسم «${section.name}» وكل ملفاته؟ لا يمكن التراجع.` : `Delete section "${section.name}" with all its files? This cannot be undone.`)) return
    try {
      var res = await authedFetch(`/api/libraries/sections/${section.id}`, { method: 'DELETE' })
      var data = await res.json().catch(() => null)
      if (!res.ok) toast.error(data?.message || (isRtl ? 'فشل الحذف' : 'Delete failed'))
      else {
        toast.success(isRtl ? 'حُذف القسم' : 'Section deleted')
        backToSections()
        refreshAll()
      }
    } catch {
      toast.error(isRtl ? 'فشل الاتصال' : 'Connection failed')
    }
  }

  if (!user) return null

  function ownerName(o: LibOwner): string {
    return isRtl ? (o.name || o.nameEn || '') : (o.nameEn || o.name || '')
  }

  // ─── عرض ملفات القسم ─────────────────────────────────────────────────────
  if (openLibRow && openSectionRow) {
    return (
      <SectionFilesView
        key={openSectionRow.id}
        section={openSectionRow}
        lib={openLibRow}
        userId={user.id}
        isAdmin={isAdmin}
        isRtl={isRtl}
        onChanged={refreshAll}
        onBackToSections={backToSections}
        onBackToLibraries={backToLibraries}
        onEditSection={(s) => openSectionDialog('edit', s)}
        onDeleteSection={deleteSection}
      />
    )
  }

  // ─── عرض المكتبة (الأقسام) ────────────────────────────────────────────────
  if (openLibRow) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-1 text-sm text-muted-foreground flex-wrap">
          <button onClick={backToLibraries} className="hover:text-primary transition">{isRtl ? 'المكتبات' : 'Libraries'}</button>
          <ChevronLeft className="h-4 w-4 rotate-180 rtl:rotate-0" />
          <span className="text-foreground font-medium">{openLibRow.name}</span>
        </div>

        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">{openLibRow.name}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {openLibRow.description ? <span>{openLibRow.description} — </span> : null}
              {isRtl ? `مكتبة ${ownerName(openLibRow.owner)}` : `Library of ${ownerName(openLibRow.owner)}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={refreshAll} disabled={libs.refreshing}>
              <RefreshCw className={`h-4 w-4 ml-2 ${libs.refreshing ? 'animate-spin' : ''}`} />
              {isRtl ? 'تحديث' : 'Refresh'}
            </Button>
            {openLibRow.canManage && (
              <>
                <Button size="sm" onClick={() => openSectionDialog('create')}>
                  <Plus className="h-4 w-4 ml-2" />
                  {isRtl ? 'قسم جديد' : 'New Section'}
                </Button>
                <Button variant="outline" size="sm" onClick={() => { setLibForm({ name: openLibRow!.name, description: openLibRow!.description || '' }); setLibDialog('edit') }}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" onClick={() => deleteLibrary(openLibRow!)} className="text-destructive hover:text-destructive">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        </div>

        {openLibRow.sections.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Folder className="h-12 w-12 mx-auto text-muted-foreground/50" />
              <p className="mt-3 text-muted-foreground">{isRtl ? 'لا توجد أقسام في هذه المكتبة بعد' : 'No sections in this library yet'}</p>
              {openLibRow.canManage && <p className="text-xs text-muted-foreground mt-1">{isRtl ? 'أضف أول قسم — خاص بك أو عام للجميع' : 'Add the first section — private or public'}</p>}
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {openLibRow.sections.map((s) => (
              <Card
                key={s.id}
                className="transition cursor-pointer hover:bg-muted/40 hover:shadow-sm"
                onClick={() => openSection(s.id)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${s.isPrivate ? 'bg-orange-100 text-orange-600' : 'bg-primary/10 text-primary'}`}>
                      {s.isPrivate ? <Lock className="h-5 w-5" /> : <Folder className="h-5 w-5" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm truncate">{s.name}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {s.isPrivate ? (isRtl ? 'خاص' : 'Private') : (isRtl ? 'عام' : 'Public')}
                        {` • ${isRtl ? `${s.fileCount} ملف` : `${s.fileCount} file${s.fileCount === 1 ? '' : 's'}`}`}
                      </p>
                      {!s.isPrivate && s.ownerId !== user.id && (
                        <p className="text-xs text-muted-foreground/70 mt-0.5">{ownerName(s.owner)}</p>
                      )}
                    </div>
                    {canManageSectionUI(s, openLibRow) && (
                      <button
                        onClick={(e) => { e.stopPropagation(); openSectionDialog('edit', s) }}
                        className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition shrink-0"
                        title={isRtl ? 'تعديل القسم' : 'Edit section'}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ─── عرض قائمة المكتبات ───────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">{isRtl ? 'المكتبات' : 'Libraries'}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isRtl
              ? 'أنشئ مكتبتك للاحتفاظ بملفاتك — أقسام خاصة لك وحدك أو عامة يراها جميع الموظفين'
              : 'Create your own library to keep your files — private sections for you or public ones for everyone'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={refreshAll} disabled={libs.refreshing}>
            <RefreshCw className={`h-4 w-4 ml-2 ${libs.refreshing ? 'animate-spin' : ''}`} />
            {isRtl ? 'تحديث' : 'Refresh'}
          </Button>
          <Button size="sm" onClick={() => { setLibForm({ name: '', description: '' }); setLibDialog('create') }}>
            <FolderPlus className="h-4 w-4 ml-2" />
            {isRtl ? 'مكتبة جديدة' : 'New Library'}
          </Button>
        </div>
      </div>

      {libs.loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div className="h-28 bg-muted animate-pulse rounded" />
          <div className="h-28 bg-muted animate-pulse rounded" />
          <div className="h-28 bg-muted animate-pulse rounded" />
        </div>
      ) : (libs.data?.libraries || []).length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Library className="h-14 w-14 mx-auto text-muted-foreground/50" />
            <p className="mt-3 text-muted-foreground font-medium">{isRtl ? 'لا توجد مكتبات بعد' : 'No libraries yet'}</p>
            <p className="text-xs text-muted-foreground mt-1">{isRtl ? 'كن أول من يُنشئ مكتبة — اضغط «مكتبة جديدة»' : 'Be the first — click "New Library"'}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {(libs.data?.libraries || []).map((lib) => (
            <Card key={lib.id} className="transition cursor-pointer hover:bg-muted/40 hover:shadow-sm" onClick={() => openLib(lib.id)}>
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <Library className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="font-semibold text-sm truncate">{lib.name}</p>
                      {lib.isMine && <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">{isRtl ? 'مكتبتك' : 'Yours'}</Badge>}
                    </div>
                    {lib.description ? <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{lib.description}</p> : null}
                    <p className="text-xs text-muted-foreground mt-1">
                      {isRtl ? `${lib.sectionCount} قسم • ${lib.fileCount} ملف` : `${lib.sectionCount} section${lib.sectionCount === 1 ? '' : 's'} • ${lib.fileCount} file${lib.fileCount === 1 ? '' : 's'}`}
                    </p>
                    {!lib.isMine && <p className="text-xs text-muted-foreground/70 mt-0.5">{ownerName(lib.owner)}</p>}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* نافذة إنشاء/تعديل مكتبة */}
      <Dialog open={libDialog !== null} onOpenChange={(o) => { if (!o) setLibDialog(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{libDialog === 'edit' ? (isRtl ? 'تعديل المكتبة' : 'Edit Library') : (isRtl ? 'مكتبة جديدة' : 'New Library')}</DialogTitle>
            <DialogDescription>
              {isRtl ? 'المكتبة مكان تحفظ فيه ملفاتك في أقسام — خاصة أو عامة' : 'A library holds your files in sections — private or public'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>{isRtl ? 'اسم المكتبة *' : 'Library name *'}</Label>
              <Input value={libForm.name} onChange={(e) => setLibForm({ ...libForm, name: e.target.value })} placeholder={isRtl ? 'مثال: ملفاتي الهندسية' : 'e.g. My engineering files'} className="h-10" maxLength={120} />
            </div>
            <div className="space-y-2">
              <Label>{isRtl ? 'وصف مختصر (اختياري)' : 'Short description (optional)'}</Label>
              <Textarea value={libForm.description} onChange={(e) => setLibForm({ ...libForm, description: e.target.value })} placeholder={isRtl ? 'لماذا هذه المكتبة؟' : 'What is this library for?'} rows={2} maxLength={500} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLibDialog(null)} disabled={busy}>{isRtl ? 'إلغاء' : 'Cancel'}</Button>
            <Button onClick={submitLibrary} disabled={busy || !libForm.name.trim()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : null}
              {isRtl ? 'حفظ' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* نافذة إنشاء/تعديل قسم — مع اختيار الخاص/العام */}
      <Dialog open={sectionDialog !== null} onOpenChange={(o) => { if (!o) setSectionDialog(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {sectionDialog?.mode === 'edit' ? (isRtl ? 'تعديل القسم' : 'Edit Section') : (isRtl ? 'قسم جديد' : 'New Section')}
            </DialogTitle>
            <DialogDescription>
              {isRtl ? 'حدد هل القسم خاص بك وحدك أم عام يراه جميع الموظفين' : 'Choose whether the section is private to you or public for everyone'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>{isRtl ? 'اسم القسم *' : 'Section name *'}</Label>
              <Input value={sectionForm.name} onChange={(e) => setSectionForm({ ...sectionForm, name: e.target.value })} placeholder={isRtl ? 'مثال: شهاداتي ووثائقي' : 'e.g. My certificates'} className="h-10" maxLength={120} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setSectionForm({ ...sectionForm, isPrivate: true })}
                className={`p-3 rounded-lg border text-right transition ${sectionForm.isPrivate ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border hover:bg-muted/50'}`}
              >
                <div className="flex items-center gap-2">
                  <Lock className={`h-4 w-4 ${sectionForm.isPrivate ? 'text-primary' : 'text-muted-foreground'}`} />
                  <span className="text-sm font-medium">{isRtl ? 'خاص' : 'Private'}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{isRtl ? 'تراه أنت والإدارة فقط' : 'Only you and management'}</p>
              </button>
              <button
                type="button"
                onClick={() => setSectionForm({ ...sectionForm, isPrivate: false })}
                className={`p-3 rounded-lg border text-right transition ${!sectionForm.isPrivate ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border hover:bg-muted/50'}`}
              >
                <div className="flex items-center gap-2">
                  <Globe2 className={`h-4 w-4 ${!sectionForm.isPrivate ? 'text-primary' : 'text-muted-foreground'}`} />
                  <span className="text-sm font-medium">{isRtl ? 'عام' : 'Public'}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{isRtl ? 'يراه جميع الموظفين' : 'Visible to all employees'}</p>
              </button>
            </div>
          </div>
          <DialogFooter>
            {sectionDialog?.mode === 'edit' && sectionDialog.section && openLibRow && canManageSectionUI(sectionDialog.section, openLibRow) ? (
              <Button variant="outline" className="text-destructive hover:text-destructive mr-auto" onClick={() => { var s = sectionDialog.section!; setSectionDialog(null); deleteSection(s) }} disabled={busy}>
                <Trash2 className="h-4 w-4 ml-2" />
                {isRtl ? 'حذف القسم' : 'Delete'}
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => setSectionDialog(null)} disabled={busy}>{isRtl ? 'إلغاء' : 'Cancel'}</Button>
            <Button onClick={submitSection} disabled={busy || !sectionForm.name.trim()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : null}
              {isRtl ? 'حفظ' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
