// ─── v97: المكتبات — ملفات القسم (عرض ورفع) ────────────────────────────────
// GET  /api/libraries/sections/[id]/files?t=<token> → بيانات الملفات (بدون محتوى
//        — المحتوى يُجلب من مسار التحميل عند الطلب) مع تطبيق الرؤية الثلاثية
// POST /api/libraries/sections/[id]/files → رفع ملف (صاحب القسم/المكتبة ومدير النظام)
// v98: كل الصيغات مقبولة (أي ملف بصيغة data base64 أو رابط https آمن) — سقف
// الحجم 3 ميغابايت للملف (أسفل سقف جسم الطلب في Vercel 4.5MB صلباً — الرافعة
// تضغط صور الجوال تلقائياً فتدفع الحد بسهولة) + توكن «رابط الوصول» للعرض
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, validateRequired, safeDbOp } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { hasPermission } from '@/lib/auth'
import { ensureLibrariesSupport } from '@/lib/db-selfheal'
import { canManageSection, canViewSection } from '@/lib/libraries'

type RouteParams = { params: Promise<{ id: string }> }

// v98: سقف آمن فوق Vercel — base64 ≈ 4/3 الحجم الفعلي، وجسم الطلب صلب 4.5MB
// على Vercel (لا يتجاوزه أي ضبط) — 3MB فعلي → ~4.0MB نصاً → هامش مريح
const MAX_URL_CHARS = 4_350_000           // سقف طول نص base64 في الجسم (≈ 3MB فعلي)
const MAX_FILES_PER_SECTION = 30          // سقف وقائي لكل قسم
// v98: تصنيفات عامة لكل الصيغات — التصنيف للعرض/الأيقونة فقط والخادم يتحقق منه
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

    var section = await db.librarySection.findUnique({
      where: { id },
      select: { id: true, name: true, isPrivate: true, linkToken: true, ownerId: true, library: { select: { id: true, ownerId: true, visibility: true, linkToken: true } } },
    })
    if (!section) return NextResponse.json({ error: 'not_found', message: 'القسم غير موجود' }, { status: 404 })
    // الرؤية خادمياً: عام للجميع، خاص لصاحبه/مدير النظام، «برابط» لمن قدم
    // التوكن الصحيح (من استعلام الرابط t=) أو للمدرّين
    // v100: بوابة المكتبة نفسها مطبقة دائماً — القاعدة الذهبية (الأضيق يفوز)
    var token = req.nextUrl.searchParams.get('t')
    if (!canViewSection(user, section, token, section.library.ownerId, section.library)) {
      return NextResponse.json({ error: 'forbidden', message: 'هذا القسم محمي — يُفتح برابط الوصول الخاص به أو لصاحبه' }, { status: 403 })
    }

    var sec = section // تثبيت النوع للاستخدام داخل الدوال المغلقة أدناه

    var files = await db.libraryFile.findMany({
      where: { sectionId: id },
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
        canDelete: f.uploaderId === user.id || canManageSection(user, sec.ownerId, sec.library.ownerId),
      })),
    })
  } catch (error: any) {
    return handleDbError(error, 'تحميل ملفات القسم')
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

    var section = await db.librarySection.findUnique({
      where: { id },
      select: { id: true, name: true, isPrivate: true, linkToken: true, ownerId: true, library: { select: { id: true, ownerId: true, visibility: true, linkToken: true } } },
    })
    if (!section) return NextResponse.json({ error: 'not_found', message: 'القسم غير موجود' }, { status: 404 })
    // الرفع لصاحب القسم أو صاحب المكتبة (ومدير النظام) — القسم العام «يُرى» للجميع
    // بينما إدارة ملفاته تبقى لصاحبها كما قرر صاحب الموقع
    if (!canManageSection(user, section.ownerId, section.library.ownerId)) {
      return NextResponse.json({ error: 'forbidden', message: 'رفع الملفات لصاحب القسم أو صاحب المكتبة فقط' }, { status: 403 })
    }
    // تثبيت معرف المكتبة للاستخدام داخل الدالة المغلقة أدناه (تضييق النوع لا يعبر حدود الإغلاقات)
    var libraryId = section.library.id

    var fileCount = await db.libraryFile.count({ where: { sectionId: id } })
    if (fileCount >= MAX_FILES_PER_SECTION) {
      return NextResponse.json({ error: 'too_many_files', message: `بلغ القسم الحد الأقصى (${MAX_FILES_PER_SECTION} ملفاً)` }, { status: 400 })
    }

    const body = await req.json()
    const validationError = validateRequired(body, ['fileName', 'url'])
    if (validationError) return validationError

    var url = String(body.url)
    // v98: حد الحجم خادمياً — طول النص مباشرة (نمط المرفقات) بسقف آمن فوق Vercel
    if (url.length > MAX_URL_CHARS) {
      return NextResponse.json({ error: 'too_large', message: 'حجم الملف يتجاوز الحد الأقصى (3 ميغابايت للملف — صور الجوال تُضغط تلقائياً عند الرفع)' }, { status: 413 })
    }

    // v98: كل الصيغات مقبولة — أي ملف بصيغة data base64 (صور/مستندات/فيديو/
    // صوت/أرشيف/نصوص/أي امتداد) أو رابط https آمن. الحماية من الهوية
    // (بوابة الكتابة) والحجم (السقف أعلاه) — لا قائمة صيغ تُقصي ملفات العمل.
    var isAllowedDataUrl = /^data:[A-Za-z0-9.+-]+\/[A-Za-z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/.test(url)
    var isAllowedHttpsUrl = /^https:\/\/[A-Za-z0-9.-]+(\/[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]*)?$/.test(url)
    if (!isAllowedDataUrl && !isAllowedHttpsUrl) {
      return NextResponse.json(
        { error: 'invalid_url', message: 'الملف غير صالح — ارفعه بصيغته الأصلية أو كرابط https آمن' },
        { status: 400 }
      )
    }

    // v98: التصنيف للعرض فقط — يُقبل من القائمة العامة أو يُصنّف «other»
    var fileType = VALID_FILE_TYPES.includes(String(body.fileType)) ? String(body.fileType) : 'other'

    const result = await safeDbOp(
      () => db.libraryFile.create({
        data: {
          // v100: كل ملف يعرف مكتبته مباشرة (قسمه يحددها، والعمود إجباري الآن)
          libraryId: libraryId,
          sectionId: id,
          fileName: String(body.fileName).slice(0, 255),
          fileType,
          url,
          // الحجم يُحسب من الخادم دائماً (نمط المرفقات — لا قيم مزورة من العميل)
          size: Buffer.byteLength(url, 'utf8'),
          uploaderId: user.id,
        },
        select: {
          id: true, fileName: true, fileType: true, size: true, createdAt: true,
          uploaderId: true,
          uploader: { select: { id: true, name: true, nameEn: true } },
        },
      }),
      'رفع ملف مكتبة'
    )
    if (!result.success) return result.response

    return NextResponse.json({ file: { ...result.data, canDelete: true }, success: true })
  } catch (error: any) {
    return handleDbError(error, 'رفع ملف مكتبة')
  }
}
