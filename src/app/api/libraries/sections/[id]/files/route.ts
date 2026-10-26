// ─── v97: المكتبات — ملفات القسم (عرض ورفع) ────────────────────────────────
// GET  /api/libraries/sections/[id]/files → بيانات الملفات (بدون محتوى —
//        المحتوى يُجلب من مسار التحميل عند الطلب) مع تطبيق الخصوصية
// POST /api/libraries/sections/[id]/files → رفع ملف (صاحب القسم/المكتبة ومدير النظام)
// نفس قواعد مرفقات المهام: base64 أو رابط https آمن، حد 4 ميغابايت، قائمة سماح صارمة
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, validateRequired, safeDbOp } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { hasPermission } from '@/lib/auth'
import { ensureLibrariesSupport } from '@/lib/db-selfheal'
import { canManageSection, canViewSection } from '@/lib/libraries'

type RouteParams = { params: Promise<{ id: string }> }

const MAX_FILE_BYTES = 4 * 1024 * 1024 // 4MB حد أقصى (base64 في قاعدة البيانات — نمط مرفقات المهام)
const MAX_FILES_PER_SECTION = 30       // سقف وقائي لكل قسم
const VALID_FILE_TYPES = ['image', 'pdf', 'doc', 'xls']

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
      select: { id: true, name: true, isPrivate: true, ownerId: true, library: { select: { id: true, ownerId: true } } },
    })
    if (!section) return NextResponse.json({ error: 'not_found', message: 'القسم غير موجود' }, { status: 404 })
    // الخصوصية خادمياً: القسم الخاص وملفاته لصاحبه ومدير النظام فقط
    if (!canViewSection(user, section)) {
      return NextResponse.json({ error: 'forbidden', message: 'هذا القسم خاص بصاحبه' }, { status: 403 })
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
      select: { id: true, name: true, isPrivate: true, ownerId: true, library: { select: { id: true, ownerId: true } } },
    })
    if (!section) return NextResponse.json({ error: 'not_found', message: 'القسم غير موجود' }, { status: 404 })
    // الرفع لصاحب القسم أو صاحب المكتبة (ومدير النظام) — القسم العام «يُرى» للجميع
    // بينما إدارة ملفاته تبقى لصاحبها كما قرر صاحب الموقع
    if (!canManageSection(user, section.ownerId, section.library.ownerId)) {
      return NextResponse.json({ error: 'forbidden', message: 'رفع الملفات لصاحب القسم أو صاحب المكتبة فقط' }, { status: 403 })
    }

    var fileCount = await db.libraryFile.count({ where: { sectionId: id } })
    if (fileCount >= MAX_FILES_PER_SECTION) {
      return NextResponse.json({ error: 'too_many_files', message: `بلغ القسم الحد الأقصى (${MAX_FILES_PER_SECTION} ملفاً)` }, { status: 400 })
    }

    const body = await req.json()
    const validationError = validateRequired(body, ['fileName', 'url'])
    if (validationError) return validationError

    var url = String(body.url)
    // حد الحجم: طول base64 ≈ 4/3 الحجم الفعلي — نفحص طول النص مباشرة (نمط المرفقات)
    if (url.length > MAX_FILE_BYTES * 1.4) {
      return NextResponse.json({ error: 'too_large', message: 'حجم الملف يتجاوز الحد الأقصى (4 ميغابايت)' }, { status: 413 })
    }

    // قائمة السماح: صور / PDF / Word / Excel — أو رابط https آمن (نفس بوابة المرفقات + Excel للمكتبات)
    var isAllowedDataUrl = /^data:(image\/(png|jpe?g|gif|webp)|application\/pdf|application\/(vnd\.openxmlformats-officedocument\.wordprocessingml\.document|msword)|application\/(vnd\.ms-excel|vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet));base64,[A-Za-z0-9+/=]+$/.test(url)
    var isAllowedHttpsUrl = /^https:\/\/[A-Za-z0-9.-]+(\/[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]*)?$/.test(url)
    if (!isAllowedDataUrl && !isAllowedHttpsUrl) {
      return NextResponse.json(
        { error: 'invalid_url', message: 'الملف يجب أن يكون صورة أو PDF أو Word أو Excel بصيغة data أو رابط https آمن' },
        { status: 400 }
      )
    }

    var fileType = VALID_FILE_TYPES.includes(String(body.fileType)) ? String(body.fileType) : 'doc'

    const result = await safeDbOp(
      () => db.libraryFile.create({
        data: {
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
