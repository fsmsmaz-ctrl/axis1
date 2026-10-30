// ─── v97: قسم «المكتبات» — v98: إصلاح الرفع لكل الصيغات + وضع «رابط الوصول» ──
// قسم عام يظهر لكل الموظفين: كل موظف يُنشئ مكتباته للاحتفاظ بملفاته، ويصنع
// داخلها أقساماً بأحد ثلاثة أوضاع: «خاص به» أو «عام للجميع» أو «برابط وصول»
// (مخفي عن القوائم ويُفتح بالرابط الذي يحمل رمزاً فريداً).
// v98 — إصلاحات جذرية لشكوى عدم إدراج الملفات:
//   • كل الصيغات مقبولة (صور/فيديو/صوت/مستندات/أرشيف/نصوص/أي امتداد) — القائمة
//     الضيقة القديمة كانت ترفض PowerPoint وCSV وأي صيغة غيرها.
//   • صور الجوال تُضغط تلقائياً في الجهاز قبل الرفع (فوتوغرافيا 5MB تصير
//     مئات الكيلوبايتات) — الحد الفعلي في Vercel 4.5MB لجسم الطلب كان يقتل
//     كل ملف أكبر من ~3MB قبل وصوله للخادم أصلاً.
//   • سقف واضح 3MB للملف برسالة صريحة بدل «فشل الرفع» العام.
//   • حالة خطأ ظاهرة بزر إعادة محاولة في عرض الملفات بدل الصمت.
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
import { toast } from 'sonner'

interface LibOwner { id: string; name: string; nameEn?: string | null }
interface LibSectionRow { id: string; name: string; isPrivate: boolean; createdAt: string; ownerId: string; owner: LibOwner; fileCount: number; linkToken?: string | null }
interface LibRow {
  id: string; name: string; description?: string | null; createdAt: string
  ownerId: string; owner: LibOwner; isMine?: boolean; canManage?: boolean
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

  // صلاحيات الواجهة — مرآة لبوابات الخادم (الخادم يبقى المصدر النهائي)
  var canManageHere = section.ownerId === userId || lib.ownerId === userId || isAdmin
  var mode = sectionMode(section)

  // v98: نسخ رابط الوصول — صاحب القسم/المكتبة ينسخه ويوزعه على من يريد
  async function copySectionLink() {
    if (!section.linkToken) return
    var url = `${window.location.origin}/?lib=${encodeURIComponent(lib.id)}&sec=${encodeURIComponent(section.id)}&t=${encodeURIComponent(section.linkToken)}`
    try {
      await navigator.clipboard.writeText(url)
      toast.success(isRtl ? 'نُسخ رابط الوصول — شاركه مع من تريد' : 'Access link copied — share it')
    } catch {
      // متصفحات بلا إذن الحافظة — نافذة اختيار يدوية
      try {
        window.prompt(isRtl ? 'انسخ الرابط يدوياً:' : 'Copy the link manually:', url)
      } catch {}
    }
  }

  // ─── رفع ملف (v98: كل الصيغات + ضغط الصور تلقائياً) ───────────────────────
  async function handleFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    var input = e.target
    var f = input.files && input.files[0]
    input.value = ''
    if (!f) return
    var picked = f // تثبيت النوع للاستخدام داخل الدالة المغلقة أدناه
    var type = detectFileType(picked)
    var toUpload = picked
    // صور الجوال الكبيرة تُضغط أولاً — فوتوغرافيا 5MB تصير مئات الكيلوبايتات
    if (type === 'image' && picked.size > IMAGE_COMPRESS_OVER) {
      try {
        var smaller = await compressImage(picked)
        if (smaller) toUpload = smaller
      } catch {}
    }
    if (toUpload.size > MAX_FILE_BYTES) {
      toast.error(
        isRtl
          ? `حجم الملف ${fmtSize(toUpload.size)} يتجاوز 3 ميغابايت — الصور تُضغط تلقائياً، والملفات الأخرى صغّرها أو قسّمها`
          : `File is ${fmtSize(toUpload.size)} — over the 3MB limit. Photos are compressed automatically; shrink other files first`
      )
      return
    }
    setBusy(true)
    try {
      var url = await new Promise<string>((resolve, reject) => {
        var reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('read_failed'))
        reader.readAsDataURL(toUpload)
      })
      var res = await authedFetch(`/api/libraries/sections/${section.id}/files`, {
        method: 'POST',
        body: JSON.stringify({ fileName: toUpload.name, url, fileType: detectFileType(toUpload) }),
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
          {/* v98: زر نسخ الرابط — للمدرّين في أقسام «برابط» */}
          {canManageHere && mode === 'link' && section.linkToken && (
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

  // نوافذ الإنشاء والتعديل
  const [libDialog, setLibDialog] = useState<null | 'create' | 'edit'>(null)
  const [libForm, setLibForm] = useState({ name: '', description: '' })
  const [sectionDialog, setSectionDialog] = useState<null | { mode: 'create' | 'edit'; section?: LibSectionRow }>(null)
  const [sectionForm, setSectionForm] = useState({ name: '', mode: 'public' as 'private' | 'public' | 'link' })
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

  useEffect(() => {
    try {
      var sp = new URLSearchParams(window.location.search)
      var secId = sp.get('sec')
      if (!secId) return
      var token = sp.get('t') || ''
      loadLinkSection(secId, token)
    } catch {}
  }, [loadLinkSection])

  const openLib = (id: string) => { setLinkView(null); setView({ libId: id, sectionId: null }) }
  const openSection = (id: string) => setView((v) => ({ ...v, sectionId: id }))
  const backToLibraries = () => { setLinkView(null); setView({ libId: null, sectionId: null }) }
  const backToSections = () => { setLinkView(null); setView((v) => ({ ...v, sectionId: null })) }

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

  // ─── إنشاء/تعديل قسم (v98: ثلاثة أوضاع رؤية) ─────────────────────────────
  function openSectionDialog(mode: 'create' | 'edit', section?: LibSectionRow) {
    setSectionForm({
      name: section ? section.name : '',
      mode: section ? sectionMode(section) : 'public',
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

  // ─── نسخ رابط قسم من بطاقة القسم (للمدرّين) ──────────────────────────────
  async function copySectionLink(section: LibSectionRow, lib: LibRow) {
    if (!section.linkToken) return
    var url = `${window.location.origin}/?lib=${encodeURIComponent(lib.id)}&sec=${encodeURIComponent(section.id)}&t=${encodeURIComponent(section.linkToken)}`
    try {
      await navigator.clipboard.writeText(url)
      toast.success(isRtl ? 'نُسخ رابط الوصول — شاركه مع من تريد' : 'Access link copied — share it')
    } catch {
      try {
        window.prompt(isRtl ? 'انسخ الرابط يدوياً:' : 'Copy the link manually:', url)
      } catch {}
    }
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
              {isRtl ? 'المكتبة مكان تحفظ فيه ملفاتك في أقسام — خاصة أو عامة أو برابط وصول' : 'A library holds your files in sections — private, public or by access link'}
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
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setSectionForm({ ...sectionForm, mode: 'private' })}
                className={`p-3 rounded-lg border text-right transition ${sectionForm.mode === 'private' ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border hover:bg-muted/50'}`}
              >
                <div className="flex items-center gap-2">
                  <Lock className={`h-4 w-4 shrink-0 ${sectionForm.mode === 'private' ? 'text-primary' : 'text-muted-foreground'}`} />
                  <span className="text-sm font-medium">{isRtl ? 'خاص' : 'Private'}</span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1 leading-snug">{isRtl ? 'تراه أنت والإدارة فقط' : 'Only you and management'}</p>
              </button>
              <button
                type="button"
                onClick={() => setSectionForm({ ...sectionForm, mode: 'public' })}
                className={`p-3 rounded-lg border text-right transition ${sectionForm.mode === 'public' ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border hover:bg-muted/50'}`}
              >
                <div className="flex items-center gap-2">
                  <Globe2 className={`h-4 w-4 shrink-0 ${sectionForm.mode === 'public' ? 'text-primary' : 'text-muted-foreground'}`} />
                  <span className="text-sm font-medium">{isRtl ? 'عام' : 'Public'}</span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1 leading-snug">{isRtl ? 'يراه جميع الموظفين' : 'Visible to all employees'}</p>
              </button>
              <button
                type="button"
                onClick={() => setSectionForm({ ...sectionForm, mode: 'link' })}
                className={`p-3 rounded-lg border text-right transition ${sectionForm.mode === 'link' ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border hover:bg-muted/50'}`}
              >
                <div className="flex items-center gap-2">
                  <Link2 className={`h-4 w-4 shrink-0 ${sectionForm.mode === 'link' ? 'text-primary' : 'text-muted-foreground'}`} />
                  <span className="text-sm font-medium">{isRtl ? 'برابط' : 'By link'}</span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1 leading-snug">{isRtl ? 'يُفتح فقط لمن يملك رابطه' : 'Opens only with its link'}</p>
              </button>
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
  if (linkError) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Link2 className="h-12 w-12 mx-auto text-muted-foreground/50" />
          <p className="mt-3 text-muted-foreground">{isRtl ? 'رابط الوصول غير صالح أو انتهت صلاحيته' : 'This access link is invalid'}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => { setLinkError(false); try { var sp = new URLSearchParams(window.location.search); var secId = sp.get('sec'); if (secId) loadLinkSection(secId, sp.get('t') || '') } catch {} }}>
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
              {openLibRow.canManage && <p className="text-xs text-muted-foreground mt-1">{isRtl ? 'أضف أول قسم — خاص بك أو عام للجميع أو برابط وصول' : 'Add the first section — private, public or by link'}</p>}
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {openLibRow.sections.map((s) => {
              var m = sectionMode(s)
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
                          {` • ${isRtl ? `${s.fileCount} ملف` : `${s.fileCount} file${s.fileCount === 1 ? '' : 's'}`}`}
                        </p>
                        {!s.isPrivate && !s.linkToken && s.ownerId !== user.id && (
                          <p className="text-xs text-muted-foreground/70 mt-0.5">{ownerName(s.owner)}</p>
                        )}
                      </div>
                      {canManageSectionUI(s, openLibRow) && (
                        <div className="flex items-center gap-0.5 shrink-0">
                          {m === 'link' && s.linkToken && (
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
              ? 'أنشئ مكتبتك للاحتفاظ بملفاتك — أقسام خاصة بك أو عامة للجميع أو تُفتح برابط وصول'
              : 'Create your own library — private sections, public ones, or sections opened by access link'}
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

      {dialogsJsx}
    </div>
  )
}
