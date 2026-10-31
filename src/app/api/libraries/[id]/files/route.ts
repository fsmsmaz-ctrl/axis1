// ─── v100: المكتبات — ملفات المكتبة المباشرة (بلا قسم) ─────────────────────
// GET  /api/libraries/[id]/files?t=<libToken> → الملفات المرفوعة مباشرة على
//        المكتبة (خارج الأقسام) — بوابة الرؤية هي رؤية المكتبة نفسها:
//        عامة → كل الموظفين، خاصة → صاحبها ومدير النظام حصراً،
//        «برابط» → من يقدم توكن رابطها (أو صاحبها/مدير النظام)
// POST /api/libraries/[id]/files → رفع مباشر داخل المكتبة — صاحب المكتبة
//        ومدير النظام (نفس قواعد القسم: كل الصيغات وسقف 3MB وضغط الصور عميلاً)
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, validateRequired, safeDbOp } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { hasPermission } from '@/lib/auth'
import { ensureLibrariesSupport } from '@/lib/db-selfheal'
import { canManageLibrary, canOpenLibraryByToken } from '@/lib/libraries'

type RouteParams = { params: Promise<{ id: string }> }

// نفس سقوف مسار الأقسام حرفياً — سلوك موحّد لا مفاجآت
const MAX_URL_CHARS = 4_350_000           // سقف طول نص base64 في الجسم (≈ 3MB فعلي)
const MAX_FILES_PER_LIBRARY = 30          // سقف وقائي لملفات المكتبة المباشرة
const VALID_FILE_TYPES = ['image', 'video', 'audio', 'pdf', 'doc', 'xls', 'ppt', 'archive', 'text', 'other']

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params
    const user = await getAuthUser(req)
    if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
    if (!hasPermission(user.role, 'libraries', user.permissions, user.email)) {
      return NextResponse.json({ error: 'forbidden', message: 'لا تملك صلاحية الوصول' }, { status: 403 })
    }

    await ensureLibrariesSupport()

    var lib = await db.library.findUnique({
      where: { id },
      select: { id: true, ownerId: true, visibility: true, linkToken: true },
    })
    if (!lib) return NextResponse.json({ error: 'not_found', message: 'المكتبة غير موجودة' }, { status: 404 })
    // بوابة المكتبة نفسها — ملفاتها المباشرة لا تُوسّعها أبداً (القاعدة الذهبية)
    var token = req.nextUrl.searchParams.get('t')
    if (!canOpenLibraryByToken(user, lib, token)) {
      return NextResponse.json({ error: 'forbidden', message: 'هذه المكتبة محمية — تُفتح برابط الوصول الخاص بها أو لصاحبها' }, { status: 403 })
    }

    // تثبيت القيم للاستخدام داخل الدوال المغلقة (تضييق النوع لا يعبر حدود الإغلاقات)
    var libOwnerId = lib.ownerId
    var libId = lib.id
    var libVis = lib.visibility

    var files = await db.libraryFile.findMany({
      where: { libraryId: id, sectionId: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, fileName: true, fileType: true, size: true, createdAt: true,
        uploaderId: true,
        uploader: { select: { id: true, name: true, nameEn: true } },
      },
    })

    return NextResponse.json({
      files: files.map((f) => ({
        ...f,
        url: undefined, // المحتوى لا يُرسل في القائمة — يُجلب من مسار التحميل فقط
        canDelete: f.uploaderId === user.id || canManageLibrary(user, libOwnerId, libVis),
      })),
    })
  } catch (error: any) {
    return handleDbError(error, 'تحميل ملفات المكتبة')
  }
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params
    const user = await getAuthUser(req)
    if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })

    var rl = checkRateLimit(req, RateLimitPresets.write)
    if (rl.limited) return NextResponse.json({ error: 'too_many_requests', message: 'طلبات كثيرة جداً' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })

    await ensureLibrariesSupport()

    var lib = await db.library.findUnique({
      where: { id },
      select: { id: true, ownerId: true, visibility: true, linkToken: true },
    })
    if (!lib) return NextResponse.json({ error: 'not_found', message: 'المكتبة غير موجودة' }, { status: 404 })
    // الرفع المباشر داخل المكتبة: صاحب المكتبة — v101: الخاصة لصاحبها حصراً حتى عن الإدارة
    if (!canManageLibrary(user, lib.ownerId, lib.visibility)) {
      return NextResponse.json({ error: 'forbidden', message: 'الرفع المباشر داخل المكتبة لصاحبها فقط' }, { status: 403 })
    }
    // تثبيت معرف المكتبة للاستخدام داخل الدالة المغلقة أدناه
    var libId = lib.id

    var fileCount = await db.libraryFile.count({ where: { libraryId: id, sectionId: null } })
    if (fileCount >= MAX_FILES_PER_LIBRARY) {
      return NextResponse.json({ error: 'too_many_files', message: `بلغت المكتبة الحد الأقصى (${MAX_FILES_PER_LIBRARY} ملفاً مباشراً) — نظّم ملفاتك في أقسام` }, { status: 400 })
    }

    const body = await req.json()
    const validationError = validateRequired(body, ['fileName', 'url'])
    if (validationError) return validationError

    var url = String(body.url)
    if (url.length > MAX_URL_CHARS) {
      return NextResponse.json({ error: 'too_large', message: 'حجم الملف يتجاوز الحد الأقصى (3 ميغابايت للملف — صور الجوال تُضغط تلقائياً عند الرفع)' }, { status: 413 })
    }

    // نفس قوائم القسم: أي صيغة بصيغة data base64 أو رابط https آمن
    var isAllowedDataUrl = /^data:[A-Za-z0-9.+-]+\/[A-Za-z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/.test(url)
    var isAllowedHttpsUrl = /^https:\/\/[A-Za-z0-9.-]+(\/[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]*)?$/.test(url)
    if (!isAllowedDataUrl && !isAllowedHttpsUrl) {
      return NextResponse.json(
        { error: 'invalid_url', message: 'الملف غير صالح — ارفعه بصيغته الأصلية أو كرابط https آمن' },
        { status: 400 }
      )
    }

    var fileType = VALID_FILE_TYPES.includes(String(body.fileType)) ? String(body.fileType) : 'other'

    const result = await safeDbOp(
      () => db.libraryFile.create({
        data: {
          libraryId: libId,
          sectionId: null, // ملف مباشر على المكتبة — بلا قسم
          fileName: String(body.fileName).slice(0, 255),
          fileType,
          url,
          size: Buffer.byteLength(url, 'utf8'),
          uploaderId: user.id,
        },
        select: {
          id: true, fileName: true, fileType: true, size: true, createdAt: true,
          uploaderId: true,
          uploader: { select: { id: true, name: true, nameEn: true } },
        },
      }),
      'رفع ملف مباشر في المكتبة'
    )
    if (!result.success) return result.response

    return NextResponse.json({ file: { ...result.data, canDelete: true }, success: true })
  } catch (error: any) {
    return handleDbError(error, 'رفع ملف مباشر في المكتبة')
  }
}
