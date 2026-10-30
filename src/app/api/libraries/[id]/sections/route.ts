// ─── v97: المكتبات — إنشاء قسم داخل مكتبة ──────────────────────────────────
// POST /api/libraries/[id]/sections → صاحب المكتبة ومدير النظام فقط
// v98 — القسم بأحد ثلاثة أوضاع: خاص / عام / برابط (linkToken: 'generate'
// يولّد رمز وصول فريد يُنسخ مع الرابط — انظر GET في sections/[id])
import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, validateRequired, safeDbOp } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { ensureLibrariesSupport } from '@/lib/db-selfheal'
import { canManageLibrary } from '@/lib/libraries'

type RouteParams = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params
    const user = await getAuthUser(req)
    if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })

    var rl = checkRateLimit(req, RateLimitPresets.write)
    if (rl.limited) return NextResponse.json({ error: 'too_many_requests', message: 'طلبات كثيرة جداً' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })

    await ensureLibrariesSupport()

    var lib = await db.library.findUnique({ where: { id }, select: { id: true, ownerId: true, name: true } })
    if (!lib) return NextResponse.json({ error: 'not_found', message: 'المكتبة غير موجودة' }, { status: 404 })
    // الأقسام يصنعها صاحب المكتبة (تنظيم مكتبته بيد هو) — ومدير النظام يتجاوز
    if (!canManageLibrary(user, lib.ownerId)) {
      return NextResponse.json({ error: 'forbidden', message: 'إنشاء الأقسام داخل مكتبة صاحبها فقط' }, { status: 403 })
    }

    const body = await req.json()
    const validationError = validateRequired(body, ['name'])
    if (validationError) return validationError

    var name = String(body.name).trim()
    if (!name) return NextResponse.json({ error: 'invalid_name', message: 'اسم القسم مطلوب' }, { status: 400 })
    if (name.length > 120) return NextResponse.json({ error: 'invalid_name', message: 'اسم القسم طويل جداً (الحد 120 حرفاً)' }, { status: 400 })
    var isPrivate = body.isPrivate === true
    // v98: وضع «برابط الوصول» — رمز عشوائي 32 خانة سدسية عملياً غير قابل للتخمين
    var linkToken: string | null = null
    if (body.linkToken === 'generate') linkToken = randomBytes(16).toString('hex')

    // سقف وقائي: 50 قسماً لكل مكتبة
    var count = await db.librarySection.count({ where: { libraryId: id } })
    if (count >= 50) {
      return NextResponse.json({ error: 'too_many', message: 'بلغت المكتبة الحد الأقصى (50 قسماً)' }, { status: 400 })
    }

    const result = await safeDbOp(
      () => db.librarySection.create({
        data: { libraryId: id, name, isPrivate, linkToken, ownerId: user.id },
        select: {
          id: true, name: true, isPrivate: true, linkToken: true, ownerId: true, createdAt: true,
          owner: { select: { id: true, name: true, nameEn: true } },
        },
      }),
      'إنشاء قسم مكتبة'
    )
    if (!result.success) return result.response

    return NextResponse.json({ section: { ...result.data, fileCount: 0 }, success: true })
  } catch (error: any) {
    return handleDbError(error, 'إنشاء قسم مكتبة')
  }
}
