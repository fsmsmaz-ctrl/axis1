// ─── v97: المكتبات — قائمة المكتبات وإنشاء مكتبة جديدة ─────────────────────
// GET  /api/libraries  → المكتبات المرئية للمستخدم الحالي مع أقسامها المرئية
//                        (v100: الخاصة و«برابط» لا تُرسل أصلاً لغير أهلها)
// POST /api/libraries  → إنشاء مكتبة — لكل موظف يملك صلاحية القسم (بقرار صاحب
//                        الموقع القسم عام لكل الموظفين)
// v100 — للمكتبة نفسها رؤية يختارها صاحبها: عامة / خاصة / لمن يمتلك الرابط،
// والقاعدة الذهبية: لا شيء داخلها أوسع انتشاراً منها (الخاص يبقى خاصاً مهما كان السبب).
import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, validateRequired, safeDbOp } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { hasPermission, canWrite } from '@/lib/auth'
import { ensureLibrariesSupport } from '@/lib/db-selfheal'
import { filterVisibleSections, isLibraryAdmin, canSeeLibraryInList } from '@/lib/libraries'

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthUser(req)
    if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
    // بوابة القسم: نفس صلاحية «المكتبات» في إدارة المستخدمين (ومدير النظام يتجاوز)
    if (!hasPermission(user.role, 'libraries', user.permissions, user.email)) {
      return NextResponse.json({ error: 'forbidden', message: 'لا تملك صلاحية الوصول' }, { status: 403 })
    }

    // v97: تجهيز جداول المكتبات تلقائياً عند أول استخدام (idempotent — بلا أي أثر إن وُجدت)
    await ensureLibrariesSupport()

    var rows = await db.library.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        description: true,
        visibility: true,
        linkToken: true,
        ownerId: true,
        createdAt: true,
        owner: { select: { id: true, name: true, nameEn: true } },
        _count: { select: { files: true } },
        sections: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            name: true,
            isPrivate: true,
            linkToken: true,
            ownerId: true,
            createdAt: true,
            owner: { select: { id: true, name: true, nameEn: true } },
            _count: { select: { files: true } },
          },
        },
      },
    })

    // الرؤية تُطبَّق هنا خادمياً — v100: المكتبة الخاصة أو «برابط» لا تصل أصلاً
    // لغير صاحبها (الخاص يبقى خاصاً مهما كان السبب)، وأقسامها تخضع لقيد مكتبتها
    var admin = isLibraryAdmin(user)
    var libraries: Array<Record<string, unknown>> = []
    for (var lib of rows) {
      if (!canSeeLibraryInList(user, lib)) continue
      var visible = admin ? lib.sections : filterVisibleSections(user, lib.sections, lib)
      // ملفات المكتبة المباشرة (خارج الأقسام) — الفرق بين كل ملفات المكتبة
      // وملفات أقسامها كله، فلا يسرّب عدد ملفات الأقسام المخفية
      var allSectionFiles = lib.sections.reduce((acc, s) => acc + s._count.files, 0)
      var directCount = Math.max(0, lib._count.files - allSectionFiles)
      var fileCount = visible.reduce((acc, s) => acc + s._count.files, 0) + directCount
      var manager = admin || lib.ownerId === user.id
      libraries.push({
        id: lib.id,
        name: lib.name,
        description: lib.description,
        createdAt: lib.createdAt,
        ownerId: lib.ownerId,
        owner: lib.owner,
        // v100: رؤية المكتبة نفسها — عامة/خاصة/برابط
        visibility: lib.visibility,
        // توكن رابط المكتبة يُسلَّم لمدرّها فقط — لا يصل أصلاً لغيرهم
        linkToken: manager ? lib.linkToken : undefined,
        isMine: lib.ownerId === user.id,
        canManage: manager,
        sectionCount: visible.length,
        fileCount,
        sections: visible.map((s) => ({
          id: s.id,
          name: s.name,
          isPrivate: s.isPrivate,
          createdAt: s.createdAt,
          ownerId: s.ownerId,
          owner: s.owner,
          fileCount: s._count.files,
          // توكن «رابط الوصول» للقسم يُسلَّم لمدرّي القسم/المكتبة فقط
          linkToken: (admin || s.ownerId === user.id || lib.ownerId === user.id) ? s.linkToken : undefined,
        })),
      })
    }

    return NextResponse.json({ libraries })
  } catch (error: any) {
    return handleDbError(error, 'تحميل المكتبات')
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser(req)
    if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
    // كل موظف يملك صلاحية القسم يستطيع إنشاء مكتبة (ومدير النظام يتجاوز دائماً)
    if (!canWrite(user.role, 'libraries', user.permissions) && !isLibraryAdmin(user)) {
      return NextResponse.json({ error: 'forbidden', message: 'لا تملك صلاحية إنشاء المكتبات' }, { status: 403 })
    }

    var rl = checkRateLimit(req, RateLimitPresets.write)
    if (rl.limited) return NextResponse.json({ error: 'too_many_requests', message: 'طلبات كثيرة جداً' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })

    await ensureLibrariesSupport()

    const body = await req.json()
    const validationError = validateRequired(body, ['name'])
    if (validationError) return validationError

    var name = String(body.name).trim()
    if (!name) return NextResponse.json({ error: 'invalid_name', message: 'اسم المكتبة مطلوب' }, { status: 400 })
    if (name.length > 120) return NextResponse.json({ error: 'invalid_name', message: 'اسم المكتبة طويل جداً (الحد 120 حرفاً)' }, { status: 400 })
    var description = body.description != null ? String(body.description).trim().slice(0, 500) : null

    // v100: رؤية المكتبة — عامة (افتراضي) / خاصة / لمن يمتلك الرابط
    var visibility = body.visibility === 'private' || body.visibility === 'link' ? String(body.visibility) : 'public'
    // وضع «برابط» يولّد رمز وصول فريد 32 خانة سدسية عملياً غير قابل للتخمين
    var linkToken = visibility === 'link' ? randomBytes(16).toString('hex') : null

    // سقف وقائي من التضخم: 50 مكتبة لكل موظف (مكتبات شخصية لا تتجاوز ذلك عملياً)
    var mine = await db.library.count({ where: { ownerId: user.id } })
    if (mine >= 50) {
      return NextResponse.json({ error: 'too_many', message: 'بلغت الحد الأقصى (50 مكتبة) — احذف مكتبة لا تحتاجها أو تواصل الإدارة' }, { status: 400 })
    }

    const result = await safeDbOp(
      () => db.library.create({
        data: { name, description, visibility, linkToken, ownerId: user.id },
        select: {
          id: true, name: true, description: true, visibility: true, linkToken: true, ownerId: true, createdAt: true,
          owner: { select: { id: true, name: true, nameEn: true } },
        },
      }),
      'إنشاء مكتبة'
    )
    if (!result.success) return result.response

    return NextResponse.json({ library: { ...result.data, isMine: true, canManage: true, sectionCount: 0, fileCount: 0, sections: [] }, success: true })
  } catch (error: any) {
    return handleDbError(error, 'إنشاء مكتبة')
  }
}
