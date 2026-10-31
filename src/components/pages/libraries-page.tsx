// ─── v97: قسم «المكتبات» — v100: خصوصية المكتبة نفسها + ملفات مباشرة ────────
// قسم عام يظهر لكل الموظفين: كل موظف يُنشئ مكتباته للاحتفاظ بملفاته، ويحدد
// رؤية مكتبته نفسها: «عامة» أو «خاصة» أو «لمن يمتلك الرابط»، ويصنع داخلها
// أقساماً بأحد ثلاثة أوضاع: «خاص به» أو «عام للجميع» أو «برابط وصول».
// v100 — القاعدة الذهبية من صاحب الموقع:
//   • أي شيء داخل مكتبة خاصة يبقى خاصاً ولا يظهر لأحد مهما كان السبب.
//   • لا يمكن جعل قسم «عاماً» أو «برابط» داخل مكتبة خاصة — ثغرة مسدودة
//     خادمياً وفي الواجهة معاً (خيارات القسم تُقيَّد بمستوى مكتبته).
//   • مكتبة «برابط» مخفية عن القوائم وتُفتح برابطها — وأقسامها خاص أو برابط فقط.
//   • المستخدم يرفع ملفاته مباشرة داخل مكتبته بلا قسم («ملفات المكتبة»).
// القراءة عبر ذاكرة إدارة الحالة المركزية (v95/v96) — نفس نمط بقية الأقسام.

'use client'

import { useState, useRef, useCallback, useEffect, type ReactNode } from 'react'
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
  Library, FolderPlus, Folder, Lock, Globe2, Link2, FileText, FileSpreadsheet, Image as ImageIcon,
  File as FileIcon, Film, Music, Archive, Presentation, Download, Upload, Trash2, Pencil, Plus,
  RefreshCw, Loader2, ChevronLeft, Copy, AlertTriangle,
} from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { authedFetch } from '@/lib/api-client'
import { useCachedGet, invalidateCache } from '@/application/data-cache'
import { effectiveSectionMode, allowedSectionModes, libraryVisibility, type LibVisibility } from '@/lib/lib-visibility'
import { toast } from 'sonner'

interface LibOwner { id: string; name: string; nameEn?: string | null }
interface LibSectionRow { id: string; name: string; isPrivate: boolean; createdAt: string; ownerId: string; owner: LibOwner; fileCount: number; linkToken?: string | null }
interface LibRow {
  id: string; name: string; description?: string | null; createdAt: string
  ownerId: string; owner: LibOwner; isMine?: boolean; canManage?: boolean
  // v100: رؤية المكتبة نفسها + توكن رابطها (يُسلَّم لمدرّيها فقط)
  visibility?: string; linkToken?: string | null
  sectionCount: number; fileCount: number; sections: LibSectionRow[]
}
interface LibFileRow {
  id: string; fileName: string; fileType: string; size?: number | null; createdAt: string
  uploaderId: string; uploader: LibOwner; canDelete?: boolean
}

// v98: 3MB فعلياً للملف — base64 ≈ 4.0MB نصاً وأسفل سقف Vercel الصلب 4.5MB لجسم
// الطلب (السقف القديم 4MB كان يوهم بأن الملف سيمر ثم يقطعه Vercel برسالة عامة)
const MAX_FILE_BYTES = 3 * 1024 * 1024
// الصور دون هذا الحجم تُرفع كما هي — وأكبر منها تُضغط (وإن فشل الضغط تُرفع كما هي)
const IMAGE_COMPRESS_OVER = 800 * 1024

/** v98: تصنيف عام لأي صيغة — للعرض/الأيقونة فقط (الخادم يقبل كل الصيغات) */
function detectFileType(file: File): string {
  var t = (file.type || '').toLowerCase()
  var n = (file.name || '').toLowerCase()
  if (t.startsWith('image/')) return 'image'
  if (t.startsWith('video/')) return 'video'
  if (t.startsWith('audio/')) return 'audio'
  if (t === 'application/pdf' || n.endsWith('.pdf')) return 'pdf'
  if (t.includes('word') || t.includes('msword') || t.includes('wordprocessingml') || /\.(doc|docx|rtf|odt)$/.test(n)) return 'doc'
  if (t.includes('excel') || t.includes('spreadsheetml') || t.includes('ms-excel') || /\.(xls|xlsx|csv|ods)$/.test(n)) return 'xls'
  if (t.includes('powerpoint') || t.includes('presentationml') || /\.(ppt|pptx|odp)$/.test(n)) return 'ppt'
  if (t.includes('zip') || t.includes('rar') || t.includes('7z') || t.includes('tar') || t.includes('compressed') || /\.(zip|rar|7z|tar|gz|7zip)$/.test(n)) return 'archive'
  if (t.startsWith('text/') || /\.(txt|md|log|json|xml)$/.test(n)) return 'text'
  return 'other'
}

/** v98: ضغط صور الجوال في الجهاز — أقصى ضلع 2048px بجودة 0.85 (خلفية بيضاء
 * تحت الشفافية). GIF لا يُلمس (الحركة تنكسر) وSVG يُرفع كما هو.
 * يعيد null إن تعذر الضغط (HEIC في كروم مثلاً) — فيُرفع الملف الأصلي. */
async function compressImage(file: File): Promise<File | null> {
  try {
    var t = (file.type || '').toLowerCase()
    if (t === 'image/gif' || t === 'image/svg+xml') return null
    if (!t.startsWith('image/') || typeof createImageBitmap !== 'function') return null
    var bitmap = await createImageBitmap(file)
    var maxSide = 2048
    var scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
    var cw = Math.max(1, Math.round(bitmap.width * scale))
    var ch = Math.max(1, Math.round(bitmap.height * scale))
    var canvas = document.createElement('canvas')
    canvas.width = cw
    canvas.height = ch
    var ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, cw, ch)
    ctx.drawImage(bitmap, 0, 0, cw, ch)
    var blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
    if (!blob || blob.size >= file.size) return null
    var baseName = (file.name || 'photo').replace(/\.[^.]+$/, '')
    return new File([blob], baseName + '.jpg', { type: 'image/jpeg' })
  } catch {
    return null
  }
}

function fileTypeIcon(type: string) {
  if (type === 'image') return ImageIcon
  if (type === 'video') return Film
  if (type === 'audio') return Music
  if (type === 'xls') return FileSpreadsheet
  if (type === 'ppt') return Presentation
  if (type === 'archive') return Archive
  return FileText
}

function fileTypeLabelAr(type: string, isRtl: boolean): string {
  if (type === 'image') return isRtl ? 'صورة' : 'Image'
  if (type === 'video') return isRtl ? 'فيديو' : 'Video'
  if (type === 'audio') return isRtl ? 'صوت' : 'Audio'
  if (type === 'pdf') return 'PDF'
  if (type === 'xls') return 'Excel'
  if (type === 'ppt') return isRtl ? 'عرض تقديمي' : 'Slides'
  if (type === 'archive') return isRtl ? 'أرشيف مضغوط' : 'Archive'
  if (type === 'text') return isRtl ? 'نص' : 'Text'
  return isRtl ? 'ملف' : 'File'
}

function sectionMode(s: { isPrivate: boolean; linkToken?: string | null }): 'private' | 'public' | 'link' {
  if (s.linkToken) return 'link'
  return s.isPrivate ? 'private' : 'public'
}

/** v100: نسخ أي رابط وصول (قسم أو مكتبة) — مع نافذة يدوية للمتصفحات الصارمة */
async function copyAccessLink(url: string, isRtl: boolean): Promise<void> {
  try {
    await navigator.clipboard.writeText(url)
    toast.success(isRtl ? 'نُسخ رابط الوصول — شاركه مع من تريد' : 'Access link copied — share it')
  } catch {
    try {
      window.prompt(isRtl ? 'انسخ الرابط يدوياً:' : 'Copy the link manually:', url)
    } catch {}
  }
}

/** v100: قراءة الملف ورفعه إلى أي مسار ملفات (قسم أو مكتبة) — منطق واحد لكل الرفع */
async function uploadLibraryFile(
  file: File,
  endpoint: string,
  isRtl: boolean,
  fmtSize: (n?: number | null) => string
): Promise<boolean> {
  var type = detectFileType(file)
  var toUpload = file
  // صور الجوال الكبيرة تُضغط أولاً — فوتوغرافيا 5MB تصير مئات الكيلوبايتات
  if (type === 'image' && file.size > IMAGE_COMPRESS_OVER) {
    try {
      var smaller = await compressImage(file)
      if (smaller) toUpload = smaller
    } catch {}
  }
  if (toUpload.size > MAX_FILE_BYTES) {
    toast.error(
      isRtl
        ? `حجم الملف ${fmtSize(toUpload.size)} يتجاوز 3 ميغابايت — الصور تُضغط تلقائياً، والملفات الأخرى صغّرها أو قسّمها`
        : `File is ${fmtSize(toUpload.size)} — over the 3MB limit. Photos are compressed automatically; shrink other files first`
    )
    return false
  }
  try {
    var url = await new Promise<string>((resolve, reject) => {
      var reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(new Error('read_failed'))
      reader.readAsDataURL(toUpload)
    })
    var res = await authedFetch(endpoint, {
      method: 'POST',
      body: JSON.stringify({ fileName: toUpload.name, url, fileType: detectFileType(toUpload) }),
    })
    var data = await res.json().catch(() => null)
    if (!res.ok) {
      toast.error(data?.message || (isRtl ? 'فشل الرفع — حاول مجدداً' : 'Upload failed — try again'))
      return false
    }
    toast.success(isRtl ? 'رُفع الملف' : 'File uploaded')
    return true
  } catch {
    toast.error(isRtl ? 'فشل الاتصال' : 'Connection failed')
    return false
  }
}

/**
 * v100: منتقي الرؤية الثلاثي المشترك — في نافذة المكتبة ونافذة القسم معاً.
 * الأوضاع غير المسموحة معطّلة تماماً (والخادم يرفضها أيضاً — حاجزان لا واحد)،
 * مع تلميح يوضّح سبب التقييد: قاعدة صاحب الموقع — لا توسيع فوق مستوى المكتبة.
 */
function VisibilityOptions(props: {
  value: LibVisibility
  onChange: (m: LibVisibility) => void
  allowed: LibVisibility[]
  isRtl: boolean
}) {
  var opts: Array<{ m: LibVisibility; label: string; hint: string; icon: typeof Lock }> = [
    { m: 'private', label: props.isRtl ? 'خاص' : 'Private', hint: props.isRtl ? 'تراه أنت والإدارة فقط' : 'Only you and management', icon: Lock },
    { m: 'public', label: props.isRtl ? 'عام' : 'Public', hint: props.isRtl ? 'يراه جميع الموظفين' : 'Visible to all employees', icon: Globe2 },
    { m: 'link', label: props.isRtl ? 'برابط' : 'By link', hint: props.isRtl ? 'يُفتح فقط لمن يملك رابطه' : 'Opens only with its link', icon: Link2 },
  ]
  return (
    <div className="grid grid-cols-3 gap-2">
      {opts.map((o) => {
        var disabled = !props.allowed.includes(o.m)
        var active = props.value === o.m
        var Icon = o.icon
        return (
          <button
            key={o.m}
            type="button"
            disabled={disabled}
            onClick={() => props.onChange(o.m)}
            className={`p-3 rounded-lg border text-right transition ${active ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border hover:bg-muted/50'} ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
          >
            <div className="flex items-center gap-2">
              <Icon className={`h-4 w-4 shrink-0 ${active ? 'text-primary' : 'text-muted-foreground'}`} />
              <span className="text-sm font-medium">{o.label}</span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1 leading-snug">{o.hint}</p>
          </button>
        )
      })}
    </div>
  )
}

interface SectionViewProps {
  section: LibSectionRow
  lib: LibRow
  userId: string
  isAdmin: boolean
  isRtl: boolean
  /** v98: توكن الرابط الذي فُتح به القسم (لمن دخل بالرابط دون صلاحية إدارة) */
  accessToken?: string | null
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
  // v98: توكن الرابط يُمرَّر مع طلب الملفات — من دخل بالرابط يرى الملفات دون صلاحية إدارة
  var filesUrl = props.accessToken
    ? `/api/libraries/sections/${section.id}/files?t=${encodeURIComponent(props.accessToken)}`
    : `/api/libraries/sections/${section.id}/files`
  const files = useCachedGet<{ files: LibFileRow[] }>(filesUrl)
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

  // v100: الوضع المعروض هو الوضع الفعلي بعد قيد المكتبة (الأضيق يفوز) —
  // قسم «عام» داخل مكتبة خاصة يظهر خاصاً كما يحكم عليه الخادم حرفياً
  var mode = effectiveSectionMode(lib, section)
  // صلاحيات الواجهة — مرآة لبوابات الخادم (الخادم يبقى المصدر النهائي)
  // v101: الخاصة الفعلية لصاحبيها حصراً — الإدارة لا تديرها (قرار صاحب الموقع)
  var canManageHere = section.ownerId === userId || lib.ownerId === userId || (isAdmin && mode !== 'private')

  // v98/v100: نسخ رابط الوصول — لرابط القسم نفسه، أو لرابط مكتبته إن كان
  // القسم يُفتح برابط المكتبة (قسم بلا توكن خاص داخل مكتبة «برابط»)
  async function copySectionLink() {
    var url = section.linkToken
      ? `${window.location.origin}/?lib=${encodeURIComponent(lib.id)}&sec=${encodeURIComponent(section.id)}&t=${encodeURIComponent(section.linkToken)}`
      : (lib.visibility === 'link' && lib.linkToken
        ? `${window.location.origin}/?lib=${encodeURIComponent(lib.id)}&t=${encodeURIComponent(lib.linkToken)}`
        : '')
    if (!url) return
    await copyAccessLink(url, isRtl)
  }

  // ─── رفع ملف (v98: كل الصيغات + ضغط الصور — v100: منطق مشترك واحد) ────────
  async function handleFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    var input = e.target
    var f = input.files && input.files[0]
    input.value = ''
    if (!f) return
    setBusy(true)
    try {
      var ok = await uploadLibraryFile(f, `/api/libraries/sections/${section.id}/files`, isRtl, fmtSize)
      if (ok) onChanged()
    } finally {
      setBusy(false)
    }
  }

  // ─── تحميل/فتح ملف ───────────────────────────────────────────────────────
  async function openFile(f: LibFileRow) {
    try {
      var res = await authedFetch(`/api/libraries/files/${f.id}${props.accessToken ? `?t=${encodeURIComponent(props.accessToken)}` : ''}`)
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

  var modeBadge: ReactNode = null
  var modeHint = ''
  if (mode === 'private') {
    modeBadge = (
      <Badge variant="outline" className="gap-1"><Lock className="h-3 w-3" />{isRtl ? 'خاص' : 'Private'}</Badge>
    )
    modeHint = isRtl ? 'قسم خاص — يراه صاحبه والإدارة فقط' : 'Private section — visible to its owner and management only'
  } else if (mode === 'link') {
    modeBadge = (
      <Badge variant="outline" className="gap-1"><Link2 className="h-3 w-3" />{isRtl ? 'برابط' : 'By link'}</Badge>
    )
    modeHint = isRtl ? 'مخفي عن القوائم — يُفتح برابط الوصول فقط' : 'Hidden from lists — opens via its access link only'
  } else {
    modeBadge = (
      <Badge variant="secondary" className="gap-1"><Globe2 className="h-3 w-3" />{isRtl ? 'عام' : 'Public'}</Badge>
    )
    modeHint = isRtl ? 'قسم عام — يراه جميع الموظفين' : 'Public section — visible to all employees'
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
          <h1 className="text-2xl font-bold flex items-center gap-2 flex-wrap">
            {section.name}
            {modeBadge}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{modeHint}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={onChanged} disabled={files.refreshing}>
            <RefreshCw className={`h-4 w-4 ml-2 ${files.refreshing ? 'animate-spin' : ''}`} />
            {isRtl ? 'تحديث' : 'Refresh'}
          </Button>
          {canManageHere && (
            <Button variant="outline" size="sm" onClick={() => props.onEditSection(section)} title={isRtl ? 'تعديل القسم' : 'Edit section'}>
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          {/* v98/v100: زر نسخ الرابط — لرابط القسم نفسه أو لرابط مكتبته */}
          {canManageHere && (section.linkToken || (lib.visibility === 'link' && lib.linkToken)) && (
            <Button variant="outline" size="sm" onClick={copySectionLink} title={isRtl ? 'نسخ رابط الوصول' : 'Copy access link'}>
              <Copy className="h-4 w-4" />
            </Button>
          )}
          {canManageHere && (
            <>
              {/* v98: بلا تصفية صيغ — كل الملفات تظهر في نافذة الاختيار */}
              <input ref={fileInputRef} type="file" className="hidden" onChange={handleFilePicked} />
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
      ) : files.error ? (
        // v98: خطأ ظاهر بزر إعادة محاولة — بدل صمت يعجز المستخدم عن معرفة السبب
        <Card>
          <CardContent className="py-10 text-center">
            <AlertTriangle className="h-10 w-10 mx-auto text-destructive/70" />
            <p className="mt-3 text-muted-foreground">{isRtl ? 'تعذر تحميل ملفات هذا القسم — تحقق من الاتصال' : 'Could not load files — check your connection'}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => files.refresh()}>
              <RefreshCw className="h-4 w-4 ml-2" />
              {isRtl ? 'إعادة المحاولة' : 'Retry'}
            </Button>
          </CardContent>
        </Card>
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
                      <span>{fileTypeLabelAr(f.fileType, isRtl)}</span>
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
      {/* v98: التلميح بالقواعد الجديدة — كل الصيغات مع ضغط الصور تلقائياً */}
      <p className="text-xs text-muted-foreground">
        {isRtl
          ? 'كل الصيغات مدعومة (صور، مستندات، تقارير، فيديو، أرشيف…) — الحد 3 ميغابايت للملف وصور الجوال تُضغط تلقائياً'
          : 'All formats supported (images, documents, reports, video, archives…) — 3MB max per file; phone photos are compressed automatically'}
      </p>
    </div>
  )
}

// ─── v100: ملفات المكتبة المباشرة (بلا قسم) ──────────────────────────────────
// «يمكن للمستخدم أن يرفع ملفاته بشكل مباشر داخل مكتبته» — كتلة مستقلة أعلى
// الأقسام، رؤيتها = رؤية المكتبة نفسها (الخادم يفرض ذلك — هنا مرآة عرض فقط).
function LibraryDirectFiles(props: {
  lib: LibRow
  /** توكن رابط المكتبة لمن فتحها بالرابط (يمر مع طلبات العرض والفتح) */
  libToken?: string | null
  userId: string
  isRtl: boolean
  onChanged: () => void
}) {
  const { lib, isRtl } = props
  var filesUrl = `/api/libraries/${lib.id}/files${props.libToken ? `?t=${encodeURIComponent(props.libToken)}` : ''}`
  const files = useCachedGet<{ files: LibFileRow[] }>(filesUrl)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  var canManageHere = lib.ownerId === props.userId || lib.canManage === true

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

  async function handleFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    var input = e.target
    var f = input.files && input.files[0]
    input.value = ''
    if (!f) return
    setBusy(true)
    try {
      var ok = await uploadLibraryFile(f, `/api/libraries/${lib.id}/files`, isRtl, fmtSize)
      if (ok) {
        files.refresh()
        props.onChanged()
      }
    } finally {
      setBusy(false)
    }
  }

  async function openFile(f: LibFileRow) {
    try {
      var res = await authedFetch(`/api/libraries/files/${f.id}${props.libToken ? `?t=${encodeURIComponent(props.libToken)}` : ''}`)
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

  async function deleteFile(f: LibFileRow) {
    if (!window.confirm(isRtl ? `حذف الملف «${f.fileName}»؟` : `Delete file "${f.fileName}"?`)) return
    try {
      var res = await authedFetch(`/api/libraries/files/${f.id}`, { method: 'DELETE' })
      var data = await res.json().catch(() => null)
      if (!res.ok) toast.error(data?.message || (isRtl ? 'فشل الحذف' : 'Delete failed'))
      else {
        toast.success(isRtl ? 'حُذف الملف' : 'File deleted')
        files.refresh()
        props.onChanged()
      }
    } catch {
      toast.error(isRtl ? 'فشل الاتصال' : 'Connection failed')
    }
  }

  var list = files.data?.files || []

  return (
    <div>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <button
          type="button"
          className="flex items-center gap-2 text-sm font-medium hover:text-primary transition"
          onClick={() => setOpen((o) => !o)}
        >
          <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-600 flex items-center justify-center shrink-0">
            <FileIcon className="h-4 w-4" />
          </div>
          {isRtl ? 'ملفات المكتبة (خارج الأقسام)' : 'Library files (outside sections)'}
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">{list.length}</Badge>
        </button>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="sm" onClick={() => files.refresh()} disabled={files.refreshing} title={isRtl ? 'تحديث' : 'Refresh'}>
            <RefreshCw className={`h-4 w-4 ${files.refreshing ? 'animate-spin' : ''}`} />
          </Button>
          {canManageHere && (
            <>
              <input ref={fileInputRef} type="file" className="hidden" onChange={handleFilePicked} />
              <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 ml-2 animate-spin" /> : <Upload className="h-4 w-4 ml-2" />}
                {isRtl ? 'رفع مباشر' : 'Upload'}
              </Button>
            </>
          )}
        </div>
      </div>

      {open && (
        <div className="mt-2 space-y-2">
          {files.loading ? (
            <>
              <div className="h-14 bg-muted animate-pulse rounded" />
              <div className="h-14 bg-muted animate-pulse rounded" />
            </>
          ) : files.error ? (
            <div className="text-sm text-muted-foreground py-3 text-center bg-muted/40 rounded">
              {isRtl ? 'تعذر تحميل ملفات المكتبة — تحقق من الاتصال' : 'Could not load library files'}
            </div>
          ) : list.length === 0 ? (
            <div className="text-sm text-muted-foreground py-3 text-center bg-muted/40 rounded">
              {canManageHere
                ? (isRtl ? 'لا توجد ملفات مباشرة بعد — استخدم «رفع مباشر» لإضافة ملف بلا قسم' : 'No direct files yet — use "Upload"')
                : (isRtl ? 'لا توجد ملفات مباشرة' : 'No direct files')}
            </div>
          ) : (
            list.map((f) => {
              var Icon = fileTypeIcon(f.fileType)
              return (
                <Card key={f.id} className="transition hover:bg-muted/40">
                  <CardContent className="p-3 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Icon className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate" title={f.fileName}>{f.fileName}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
                        <span>{fileTypeLabelAr(f.fileType, isRtl)}</span>
                        {f.size ? <span>• {fmtSize(f.size)}</span> : null}
                        <span>• {ownerName(f.uploader)}</span>
                        <span>• {fmtDate(f.createdAt)}</span>
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button variant="ghost" size="sm" onClick={() => openFile(f)} title={isRtl ? 'تحميل' : 'Download'}>
                        <Download className="h-4 w-4" />
                      </Button>
                      {(f.canDelete || f.uploaderId === props.userId) && (
                        <Button variant="ghost" size="sm" onClick={() => deleteFile(f)} className="text-destructive hover:text-destructive" title={isRtl ? 'حذف' : 'Delete'}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )
            })
          )}
        </div>
      )}
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

  // v98: عرض قسم فُتح برابط وصول مباشر (خارج القوائم) — قسم ببياناته من مسار الرابط
  const [linkView, setLinkView] = useState<null | { section: LibSectionRow; lib: LibRow; token: string }>(null)
  const [linkLoading, setLinkLoading] = useState(false)
  const [linkError, setLinkError] = useState(false)

  // v100: عرض مكتبة فُتحت برابطها المباشر (مكتبة «برابط» مخفية عن القوائم)
  const [libLinkView, setLibLinkView] = useState<null | { lib: LibRow; token: string }>(null)
  const [libLinkError, setLibLinkError] = useState(false)

  // نوافذ الإنشاء والتعديل
  const [libDialog, setLibDialog] = useState<null | 'create' | 'edit'>(null)
  const [libForm, setLibForm] = useState({ name: '', description: '', visibility: 'public' as LibVisibility })
  // v100: تدوير رابط مكتبة موجودة (زر «توليد رابط جديد» في نافذة التعديل)
  const [libRegenLink, setLibRegenLink] = useState(false)
  const [sectionDialog, setSectionDialog] = useState<null | { mode: 'create' | 'edit'; section?: LibSectionRow }>(null)
  const [sectionForm, setSectionForm] = useState({ name: '', mode: 'public' as LibVisibility })
  const [busy, setBusy] = useState(false)

  const refreshAll = useCallback(() => {
    invalidateCache('/api/libraries')
    libs.refresh()
  }, [libs])

  // ─── v98: فتح «رابط الوصول» مباشرة ────────────────────────────────────────
  // الرابط: ?lib=<id>&sec=<id>&t=<token> — يُقرأ مرة عند فتح القسم فيفتح القسم
  // حتى لو كان مخفياً عن القوائم (الخادم يتحقق من التوكن — لا ثقة بالواجهة)
  const loadLinkSection = useCallback(async (secId: string, token: string) => {
    setLinkLoading(true)
    setLinkError(false)
    try {
      var res = await authedFetch(`/api/libraries/sections/${encodeURIComponent(secId)}?t=${encodeURIComponent(token)}`)
      var data = await res.json().catch(() => null)
      if (!res.ok || !data?.section) {
        setLinkError(true)
      } else {
        var s = data.section
        setLinkView({
          token,
          section: {
            id: s.id, name: s.name, isPrivate: s.isPrivate, createdAt: s.createdAt,
            ownerId: s.ownerId, owner: s.owner || { id: '', name: '', nameEn: null },
            fileCount: s.fileCount || 0, linkToken: s.linkToken ?? null,
          },
          lib: {
            id: s.library?.id || '', name: s.library?.name || '', createdAt: s.createdAt,
            ownerId: s.library?.ownerId || '', owner: s.owner || { id: '', name: '', nameEn: null },
            visibility: s.library?.visibility || 'public',
            sectionCount: 0, fileCount: 0, sections: [],
          },
        })
      }
    } catch {
      setLinkError(true)
    } finally {
      setLinkLoading(false)
    }
  }, [])

  // ─── v100: فتح «رابط المكتبة» مباشرة ─────────────────────────────────────
  // الرابط: ?lib=<id>&t=<libToken> (بلا sec) — يفتح مكتبة «لمن يمتلك الرابط»
  // بأقسامها وملفاتها المباشرة (الخادم يتحقق من التوكن — لا ثقة بالواجهة)
  const loadLibraryLink = useCallback(async (libId: string, token: string) => {
    setLinkLoading(true)
    setLibLinkError(false)
    try {
      var res = await authedFetch(`/api/libraries/${encodeURIComponent(libId)}?t=${encodeURIComponent(token)}`)
      var data = await res.json().catch(() => null)
      if (!res.ok || !data?.library) {
        setLibLinkError(true)
      } else {
        var l = data.library
        setLibLinkView({
          token,
          lib: {
            id: l.id, name: l.name, description: l.description || null, createdAt: l.createdAt,
            ownerId: l.ownerId, owner: l.owner || { id: '', name: '', nameEn: null },
            visibility: l.visibility || 'public', linkToken: l.linkToken ?? null,
            isMine: l.isMine, canManage: l.canManage,
            sectionCount: l.sectionCount || 0, fileCount: l.fileCount || 0,
            sections: (l.sections || []).map((x: Record<string, unknown>) => ({
              id: String(x.id), name: String(x.name), isPrivate: x.isPrivate === true,
              createdAt: String(x.createdAt), ownerId: String(x.ownerId),
              owner: (x.owner as LibOwner) || { id: '', name: '', nameEn: null },
              fileCount: Number(x.fileCount || 0), linkToken: (x.linkToken as string) ?? null,
            })),
          },
        })
        setView({ libId: libId, sectionId: null })
      }
    } catch {
      setLibLinkError(true)
    } finally {
      setLinkLoading(false)
    }
  }, [])

  useEffect(() => {
    try {
      var sp = new URLSearchParams(window.location.search)
      var secId = sp.get('sec')
      var libId = sp.get('lib')
      var token = sp.get('t') || ''
      // رابط قسم: ?lib=&sec=&t= — يُقرأ كما هو منذ v98
      if (secId) { loadLinkSection(secId, token); return }
      // v100 رابط مكتبة: ?lib=&t= (بلا sec) — يفتح المكتبة نفسها
      if (libId && token) loadLibraryLink(libId, token)
    } catch {}
  }, [loadLinkSection, loadLibraryLink])

  const openLib = (id: string) => { setLinkView(null); setLibLinkView(null); setView({ libId: id, sectionId: null }) }
  const openSection = (id: string) => setView((v) => ({ ...v, sectionId: id }))
  const backToLibraries = () => { setLinkView(null); setLibLinkView(null); setView({ libId: null, sectionId: null }) }
  const backToSections = () => { setLinkView(null); setView((v) => ({ ...v, sectionId: null })) }

  // v100: المكتبة المفتوحة — من القائمة، أو المُحمّلة برابطها المباشر
  const openLibRow = libLinkView?.lib
    || (view.libId ? (libs.data?.libraries || []).find((l) => l.id === view.libId) || null : null)
  const openSectionRow = openLibRow?.sections.find((s) => s.id === view.sectionId) || null
  // توكن رابط المكتبة يرافق التنقل داخلها (طلبات ملفات أقسامها وملفاتها المباشرة)
  const activeLibToken = libLinkView && openLibRow && libLinkView.lib.id === openLibRow.id ? libLinkView.token : null

  var isAdmin = user?.isSystemAdmin === true
  function canManageSectionUI(section: LibSectionRow, lib: LibRow): boolean {
    if (!user) return false
    // v101: الخاصة الفعلية لصاحبي القسم/المكتبة حصراً — الإدارة مستثناة (قرار صاحب الموقع)
    if (effectiveSectionMode(lib, section) === 'private') {
      return section.ownerId === user.id || lib.ownerId === user.id
    }
    return section.ownerId === user.id || lib.ownerId === user.id || isAdmin
  }

  // ─── إنشاء/تعديل مكتبة (v100: مع رؤيتها العامة/خاصة/برابط) ─────────────────
  async function submitLibrary() {
    if (!libForm.name.trim()) { toast.error(isRtl ? 'اسم المكتبة مطلوب' : 'Library name is required'); return }
    setBusy(true)
    try {
      var isEdit = libDialog === 'edit' && openLibRow
      // v100: الرؤية تُرسل دائماً، و«توليد رابط جديد» في التعديل يدوّر الرمز
      var payload: Record<string, unknown> = {
        name: libForm.name.trim(),
        description: libForm.description.trim() || null,
        visibility: libForm.visibility,
      }
      if (isEdit && libRegenLink && libForm.visibility === 'link') payload.linkToken = 'generate'
      var res = await authedFetch(isEdit ? `/api/libraries/${openLibRow!.id}` : '/api/libraries', {
        method: isEdit ? 'PATCH' : 'POST',
        body: JSON.stringify(payload),
      })
      var data = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error(data?.message || (isRtl ? 'فشل الحفظ — حاول مجدداً' : 'Save failed — try again'))
      } else {
        toast.success(isEdit ? (isRtl ? 'حُدّثت المكتبة' : 'Library updated') : (isRtl ? 'أُنشئت المكتبة' : 'Library created'))
        setLibDialog(null)
        setLibRegenLink(false)
        // رابط المكتبة المفتوح بالرابط يُحدّث بياناته بعد أي حفظ
        if (libLinkView) loadLibraryLink(libLinkView.lib.id, libLinkView.token)
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

  // ─── إنشاء/تعديل قسم (v98: ثلاثة أوضاع — v100: مقيدة برؤية المكتبة) ────────
  function openSectionDialog(mode: 'create' | 'edit', section?: LibSectionRow) {
    // v100: الوضع الافتراضي للقسم الجديد يلتزم بمستوى مكتبته — داخل مكتبة
    // خاصة أو «برابط» يبدأ من «خاص» (الخيار الأضيق المتاح دائماً)
    var defMode: LibVisibility = 'public'
    if (openLibRow && !allowedSectionModes(openLibRow).includes('public')) defMode = 'private'
    setSectionForm({
      name: section ? section.name : '',
      mode: section ? sectionMode(section) : defMode,
    })
    setSectionDialog({ mode, section })
  }

  async function submitSection() {
    if (!openLibRow || !sectionDialog) return
    if (!sectionForm.name.trim()) { toast.error(isRtl ? 'اسم القسم مطلوب' : 'Section name is required'); return }
    setBusy(true)
    try {
      var isEdit = sectionDialog.mode === 'edit' && sectionDialog.section
      var wasLink = !!sectionDialog.section?.linkToken
      // v98: حالة الرؤية تُترجم لحقول الخادم — «برابط» يولّد توكناً عند التفعيل
      // أول مرة، وإلغاؤه يصفر التوكن فيرجع القسم خاصاً/عاماً حسب اختيارك
      var payload: Record<string, unknown> = {
        name: sectionForm.name.trim(),
        isPrivate: sectionForm.mode === 'private',
      }
      if (sectionForm.mode === 'link' && (!isEdit || !wasLink)) payload.linkToken = 'generate'
      if (isEdit && wasLink && sectionForm.mode !== 'link') payload.linkToken = null
      var res = await authedFetch(isEdit ? `/api/libraries/sections/${sectionDialog.section!.id}` : `/api/libraries/${openLibRow.id}/sections`, {
        method: isEdit ? 'PATCH' : 'POST',
        body: JSON.stringify(payload),
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

  // ─── نسخ رابط قسم من بطاقة القسم (للمدرّين — v100: أو رابط مكتبته) ────────
  async function copySectionLink(section: LibSectionRow, lib: LibRow) {
    var url = section.linkToken
      ? `${window.location.origin}/?lib=${encodeURIComponent(lib.id)}&sec=${encodeURIComponent(section.id)}&t=${encodeURIComponent(section.linkToken)}`
      : (lib.visibility === 'link' && lib.linkToken
        ? `${window.location.origin}/?lib=${encodeURIComponent(lib.id)}&t=${encodeURIComponent(lib.linkToken)}`
        : '')
    if (!url) return
    await copyAccessLink(url, isRtl)
  }

  // ─── v100: نسخ رابط المكتبة نفسها (للمدرّين) ──────────────────────────────
  async function copyLibraryLink(lib: LibRow) {
    if (!lib.linkToken) return
    var url = `${window.location.origin}/?lib=${encodeURIComponent(lib.id)}&t=${encodeURIComponent(lib.linkToken)}`
    await copyAccessLink(url, isRtl)
  }

  if (!user) return null

  function ownerName(o: LibOwner): string {
    return isRtl ? (o.name || o.nameEn || '') : (o.nameEn || o.name || '')
  }

  // ─── v99: نوافذ المكتبة والقسم — تعريف واحد يُعرض في كل الفروع ──────────
  // الإصلاح: كانت النوافذ في فرع قائمة المكتبات فقط، فالنقر على «قسم جديد»
  // أو «تعديل القسم» من داخل المكتبة أو القسم المفتوح لا يظهر شيئاً (فشل صامت).
  const dialogsJsx = (
    <>
      {/* نافذة إنشاء/تعديل مكتبة */}
      <Dialog open={libDialog !== null} onOpenChange={(o) => { if (!o) setLibDialog(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{libDialog === 'edit' ? (isRtl ? 'تعديل المكتبة' : 'Edit Library') : (isRtl ? 'مكتبة جديدة' : 'New Library')}</DialogTitle>
            <DialogDescription>
              {isRtl ? 'حدد من يرى مكتبتك: عامة للجميع، خاصة بك وحدك، أو تُفتح لمن يمتلك رابطها — وقاعدة ثابتة: ما داخل المكتبة الخاصة يبقى خاصاً دائماً' : 'Choose who sees this library: public, private to you, or opened only with its link — inside a private library everything stays private'}
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
            {/* v100: رؤية المكتبة نفسها — عامة/خاصة/لمن يمتلك الرابط */}
            <div className="space-y-2">
              <Label>{isRtl ? 'من يرى هذه المكتبة؟' : 'Who can see this library?'}</Label>
              <VisibilityOptions
                value={libForm.visibility}
                onChange={(m) => setLibForm({ ...libForm, visibility: m })}
                allowed={['private', 'public', 'link']}
                isRtl={isRtl}
              />
            </div>
            {libForm.visibility === 'private' && (
              <p className="text-xs text-muted-foreground bg-muted/50 rounded p-2 leading-relaxed">
                {isRtl
                  ? 'المكتبة الخاصة لا تظهر إلا لك (والإدارة) — وكل أقسامها وملفاتها تبقى خاصة إجبارياً حتى لو حاول أحد جعل قسم فيها عاماً (حماية من التسريب).'
                  : 'A private library is visible only to you (and management) — all its sections and files stay private no matter what (leak-proof).' }
              </p>
            )}
            {libForm.visibility === 'link' && (
              <p className="text-xs text-muted-foreground bg-muted/50 rounded p-2 leading-relaxed">
                {isRtl
                  ? 'المكتبة مخفية عن القوائم — بعد الحفظ استخدم زر «نسخ رابط المكتبة» لمن تريد، وكل من يملك الرابط يراها بأقسامها المسموحة وملفاتها المباشرة. يمكنك توليد رابط جديد متى شئت فيُبطل القديم فوراً.'
                  : 'The library stays hidden from lists — share its link after saving. Anyone with it sees the library and its allowed sections. Regenerate the link anytime to revoke the old one instantly.'}
              </p>
            )}
            {libDialog === 'edit' && libForm.visibility === 'link' && openLibRow?.linkToken && (
              <div className="flex items-center gap-2 flex-wrap">
                <Button type="button" variant="outline" size="sm" onClick={() => copyLibraryLink(openLibRow!)}>
                  <Copy className="h-4 w-4 ml-2" />
                  {isRtl ? 'نسخ رابط المكتبة' : 'Copy library link'}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setLibRegenLink(true)} disabled={libRegenLink}>
                  <RefreshCw className="h-4 w-4 ml-2" />
                  {libRegenLink ? (isRtl ? 'سيُولَّد رابط جديد عند الحفظ' : 'A new link will be generated on save') : (isRtl ? 'توليد رابط جديد (يبطل القديم)' : 'Regenerate link (revokes old)')}
                </Button>
              </div>
            )}
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

      {/* نافذة إنشاء/تعديل قسم — v98: ثلاثة أوضاع رؤية */}
      <Dialog open={sectionDialog !== null} onOpenChange={(o) => { if (!o) setSectionDialog(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {sectionDialog?.mode === 'edit' ? (isRtl ? 'تعديل القسم' : 'Edit Section') : (isRtl ? 'قسم جديد' : 'New Section')}
            </DialogTitle>
            <DialogDescription>
              {isRtl ? 'حدد رؤية القسم: خاص بك وحدك، عام لجميع الموظفين، أو يُفتح برابط وصول فقط' : 'Choose visibility: private to you, public to everyone, or opened by access link only'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>{isRtl ? 'اسم القسم *' : 'Section name *'}</Label>
              <Input value={sectionForm.name} onChange={(e) => setSectionForm({ ...sectionForm, name: e.target.value })} placeholder={isRtl ? 'مثال: شهاداتي ووثائقي' : 'e.g. My certificates'} className="h-10" maxLength={120} />
            </div>
            {/* v100: خيارات القسم مقيّدة برؤية مكتبته — لا قسم أوسع من مكتبته */}
            <div className="space-y-2">
              <Label>{isRtl ? 'رؤية القسم' : 'Section visibility'}</Label>
              {openLibRow && (
                <VisibilityOptions
                  value={sectionForm.mode}
                  onChange={(m) => setSectionForm({ ...sectionForm, mode: m })}
                  allowed={allowedSectionModes(openLibRow)}
                  isRtl={isRtl}
                />
              )}
              {openLibRow && libraryVisibility(openLibRow.visibility) === 'private' && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 leading-relaxed">
                  {isRtl
                    ? 'المكتبة نفسها خاصة — القسم هنا خاص إجبارياً ولا يمكن جعله عاماً أو برابط (منع ثغرة التسريب).'
                    : 'This library is private — the section stays private; public/link modes are locked (leak-proof rule).'}
                </p>
              )}
              {openLibRow && libraryVisibility(openLibRow.visibility) === 'link' && (
                <p className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded p-2 leading-relaxed">
                  {isRtl
                    ? 'المكتبة تُفتح لمن يمتلك رابطها — القسم هنا يكون خاصاً أو برابط وصول فقط، ولا يمكن جعله عاماً.'
                    : 'This library opens by its link — sections can be private or by-link only, never public.'}
                </p>
              )}
            </div>
            {sectionForm.mode === 'link' && (
              <p className="text-xs text-muted-foreground bg-muted/50 rounded p-2 leading-relaxed">
                {isRtl
                  ? 'بعد الحفظ ستجد زر «نسخ الرابط» على بطاقة القسم — شاركه مع من تريد، وكل من يملكه يفتح القسم وملفاته مباشرة. القسم يبقى مخفياً عن بقية القوائم، ويمكنك إبطال الرابط وتوليد غيره متى شئت من التعديل.'
                  : 'After saving, use the copy-link button on the section card to share it. Anyone with the link opens the section directly. It stays hidden from lists, and you can revoke and regenerate the link anytime from Edit.'}
              </p>
            )}
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
    </>
  )

  // ─── v98: عرض قسم فُتح برابط وصول مباشر (يستبق كل العروض الأخرى) ──────────
  if (linkView) {
    return (
      <>
      <SectionFilesView
        key={`link-${linkView.section.id}`}
        section={linkView.section}
        lib={linkView.lib}
        userId={user.id}
        isAdmin={isAdmin}
        isRtl={isRtl}
        accessToken={linkView.token}
        onChanged={refreshAll}
        onBackToSections={() => { setLinkView(null); setView({ libId: null, sectionId: null }) }}
        onBackToLibraries={() => { setLinkView(null); setView({ libId: null, sectionId: null }) }}
        onEditSection={(s) => openSectionDialog('edit', s)}
        onDeleteSection={deleteSection}
      />
      {dialogsJsx}
      </>
    )
  }

  // ─── عرض ملفات القسم ─────────────────────────────────────────────────────
  if (openLibRow && openSectionRow) {
    return (
      <>
      <SectionFilesView
        key={openSectionRow.id}
        section={openSectionRow}
        lib={openLibRow}
        userId={user.id}
        isAdmin={isAdmin}
        isRtl={isRtl}
        // v100: من فتح مكتبة «برابط» ثم دخل قسماً — توكن المكتبة يرافقه
        // في عرض الملفات (الخادم يقبل توكن المكتبة أو توكن القسم)
        accessToken={activeLibToken || undefined}
        onChanged={refreshAll}
        onBackToSections={backToSections}
        onBackToLibraries={backToLibraries}
        onEditSection={(s) => openSectionDialog('edit', s)}
        onDeleteSection={deleteSection}
      />
      {dialogsJsx}
      </>
    )
  }

  // ─── تحميل قسم الرابط ────────────────────────────────────────────────────
  if (linkLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-64 bg-muted animate-pulse rounded" />
        <div className="h-16 bg-muted animate-pulse rounded" />
        <div className="h-16 bg-muted animate-pulse rounded" />
      </div>
    )
  }
  if (linkError || libLinkError) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Link2 className="h-12 w-12 mx-auto text-muted-foreground/50" />
          <p className="mt-3 text-muted-foreground">{isRtl ? 'رابط الوصول غير صالح أو انتهت صلاحيته' : 'This access link is invalid'}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => { setLinkError(false); setLibLinkError(false); try { var sp = new URLSearchParams(window.location.search); var secId = sp.get('sec'); var lbId = sp.get('lib'); var tk = sp.get('t') || ''; if (secId) loadLinkSection(secId, tk); else if (lbId && tk) loadLibraryLink(lbId, tk) } catch {} }}>
            <RefreshCw className="h-4 w-4 ml-2" />
            {isRtl ? 'إعادة المحاولة' : 'Retry'}
          </Button>
        </CardContent>
      </Card>
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
            <h1 className="text-2xl font-bold flex items-center gap-2 flex-wrap">
              {openLibRow.name}
              {/* v100: شارة رؤية المكتبة نفسها */}
              {libraryVisibility(openLibRow.visibility) === 'private' ? (
                <Badge variant="outline" className="gap-1"><Lock className="h-3 w-3" />{isRtl ? 'مكتبة خاصة' : 'Private'}</Badge>
              ) : libraryVisibility(openLibRow.visibility) === 'link' ? (
                <Badge variant="outline" className="gap-1"><Link2 className="h-3 w-3" />{isRtl ? 'برابط' : 'By link'}</Badge>
              ) : (
                <Badge variant="secondary" className="gap-1"><Globe2 className="h-3 w-3" />{isRtl ? 'عامة' : 'Public'}</Badge>
              )}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {openLibRow.description ? <span>{openLibRow.description} — </span> : null}
              {isRtl ? `مكتبة ${ownerName(openLibRow.owner)}` : `Library of ${ownerName(openLibRow.owner)}`}
              {libraryVisibility(openLibRow.visibility) === 'private' ? (isRtl ? ' — كل ما فيها يبقى خاصاً' : ' — everything inside stays private') : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={refreshAll} disabled={libs.refreshing}>
              <RefreshCw className={`h-4 w-4 ml-2 ${libs.refreshing ? 'animate-spin' : ''}`} />
              {isRtl ? 'تحديث' : 'Refresh'}
            </Button>
            {/* v100: نسخ رابط المكتبة — لمدرّي مكتبة «برابط» */}
            {openLibRow.canManage && libraryVisibility(openLibRow.visibility) === 'link' && openLibRow.linkToken && (
              <Button variant="outline" size="sm" onClick={() => copyLibraryLink(openLibRow!)} title={isRtl ? 'نسخ رابط المكتبة' : 'Copy library link'}>
                <Copy className="h-4 w-4" />
              </Button>
            )}
            {openLibRow.canManage && (
              <>
                <Button size="sm" onClick={() => openSectionDialog('create')}>
                  <Plus className="h-4 w-4 ml-2" />
                  {isRtl ? 'قسم جديد' : 'New Section'}
                </Button>
                <Button variant="outline" size="sm" onClick={() => { setLibForm({ name: openLibRow!.name, description: openLibRow!.description || '', visibility: libraryVisibility(openLibRow!.visibility) }); setLibRegenLink(false); setLibDialog('edit') }}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" onClick={() => deleteLibrary(openLibRow!)} className="text-destructive hover:text-destructive">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        </div>

        {/* v100: ملفات المكتبة المباشرة — الرفع المباشر داخل المكتبة بلا قسم */}
        <Card>
          <CardContent className="p-4">
            <LibraryDirectFiles lib={openLibRow} libToken={activeLibToken} userId={user.id} isRtl={isRtl} onChanged={refreshAll} />
          </CardContent>
        </Card>

        {openLibRow.sections.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Folder className="h-12 w-12 mx-auto text-muted-foreground/50" />
              <p className="mt-3 text-muted-foreground">{isRtl ? 'لا توجد أقسام في هذه المكتبة بعد' : 'No sections in this library yet'}</p>
              {openLibRow.canManage && <p className="text-xs text-muted-foreground mt-1">{isRtl ? 'أضف أول قسم — خاص بك أو عام للجميع أو برابط وصول' : 'Add the first section — private, public or by link'}</p>}
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {openLibRow.sections.map((s) => {
              // v100: البطاقة تعرض الوضع الفعلي بعد قيد المكتبة (الأضيق يفوز)
              var m = effectiveSectionMode(openLibRow, s)
              return (
                <Card
                  key={s.id}
                  className="transition cursor-pointer hover:bg-muted/40 hover:shadow-sm"
                  onClick={() => openSection(s.id)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${m === 'private' ? 'bg-orange-100 text-orange-600' : m === 'link' ? 'bg-blue-100 text-blue-600' : 'bg-primary/10 text-primary'}`}>
                        {m === 'private' ? <Lock className="h-5 w-5" /> : m === 'link' ? <Link2 className="h-5 w-5" /> : <Folder className="h-5 w-5" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm truncate">{s.name}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {m === 'private' ? (isRtl ? 'خاص' : 'Private') : m === 'link' ? (isRtl ? 'برابط' : 'By link') : (isRtl ? 'عام' : 'Public')}
                          {/* داخل مكتبة خاصة: القسم خاص إجبارياً — توضيح صريح للقاعدة */}
                          {m === 'private' && s && !s.isPrivate ? (isRtl ? ' (إجباري — مكتبة خاصة)' : ' (forced — private library)') : ''}
                          {` • ${isRtl ? `${s.fileCount} ملف` : `${s.fileCount} file${s.fileCount === 1 ? '' : 's'}`}`}
                        </p>
                        {m === 'public' && s.ownerId !== user.id && (
                          <p className="text-xs text-muted-foreground/70 mt-0.5">{ownerName(s.owner)}</p>
                        )}
                      </div>
                      {canManageSectionUI(s, openLibRow) && (
                        <div className="flex items-center gap-0.5 shrink-0">
                          {(s.linkToken || (libraryVisibility(openLibRow.visibility) === 'link' && openLibRow.linkToken)) && (
                            <button
                              onClick={(e) => { e.stopPropagation(); copySectionLink(s, openLibRow) }}
                              className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition"
                              title={isRtl ? 'نسخ رابط الوصول' : 'Copy access link'}
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <button
                            onClick={(e) => { e.stopPropagation(); openSectionDialog('edit', s) }}
                            className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition"
                            title={isRtl ? 'تعديل القسم' : 'Edit section'}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
        {dialogsJsx}
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
              ? 'أنشئ مكتبتك وحدد من يراها: عامة أو خاصة أو لمن يمتلك رابطها — وما داخل الخاصة يبقى خاصاً دائماً'
              : 'Create your library and choose who sees it: public, private, or by-link only — inside a private one everything stays private'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={refreshAll} disabled={libs.refreshing}>
            <RefreshCw className={`h-4 w-4 ml-2 ${libs.refreshing ? 'animate-spin' : ''}`} />
            {isRtl ? 'تحديث' : 'Refresh'}
          </Button>
          <Button size="sm" onClick={() => { setLibForm({ name: '', description: '', visibility: 'public' }); setLibRegenLink(false); setLibDialog('create') }}>
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
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${libraryVisibility(lib.visibility) === 'private' ? 'bg-orange-100 text-orange-600' : libraryVisibility(lib.visibility) === 'link' ? 'bg-blue-100 text-blue-600' : 'bg-primary/10 text-primary'}`}>
                    {libraryVisibility(lib.visibility) === 'private' ? <Lock className="h-5 w-5" /> : libraryVisibility(lib.visibility) === 'link' ? <Link2 className="h-5 w-5" /> : <Library className="h-5 w-5 text-primary" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="font-semibold text-sm truncate">{lib.name}</p>
                      {lib.isMine && <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">{isRtl ? 'مكتبتك' : 'Yours'}</Badge>}
                      {/* v100: شارة رؤية المكتبة — خاصة/برابط تُخفى عن غير أهلها أصلاً */}
                      {libraryVisibility(lib.visibility) === 'private' && <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0 gap-0.5"><Lock className="h-2.5 w-2.5" />{isRtl ? 'خاصة' : 'Private'}</Badge>}
                      {libraryVisibility(lib.visibility) === 'link' && <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0 gap-0.5"><Link2 className="h-2.5 w-2.5" />{isRtl ? 'برابط' : 'By link'}</Badge>}
                    </div>
                    {lib.description ? <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{lib.description}</p> : null}
                    <p className="text-xs text-muted-foreground mt-1">
                      {isRtl ? `${lib.sectionCount} قسم • ${lib.fileCount} ملف` : `${lib.sectionCount} section${lib.sectionCount === 1 ? '' : 's'} • ${lib.fileCount} file${lib.fileCount === 1 ? '' : 's'}`}
                    </p>
                    {!lib.isMine && <p className="text-xs text-muted-foreground/70 mt-0.5">{ownerName(lib.owner)}</p>}
                  </div>
                  {/* v100: نسخ رابط مكتبة «برابط» من البطاقة — لمدرّيها فقط */}
                  {lib.canManage && libraryVisibility(lib.visibility) === 'link' && lib.linkToken && (
                    <button
                      onClick={(e) => { e.stopPropagation(); copyLibraryLink(lib) }}
                      className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition shrink-0"
                      title={isRtl ? 'نسخ رابط المكتبة' : 'Copy library link'}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {dialogsJsx}
    </div>
  )
}
