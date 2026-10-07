import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { getAuthUser } from '@/lib/auth-server'
import { ensureMediaSupport } from '@/lib/db-selfheal'
import { db } from '@/lib/db'
import { handleDbError, validateRequired, parseNumber, safeDbOp, validImageDataUrl } from '@/lib/api-helpers'
import { canWrite, hasPermission } from '@/lib/auth'

export async function GET(req: NextRequest) {
  await ensureMediaSupport()
  try {
    const user = await getAuthUser(req)
    if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })

    // SECURITY FIX: قائمة المعدات تتضمن سجلات الصيانة وتكاليفها — بوابة قراءة
    if (!hasPermission(user.role, 'equipment', user.permissions, user.email)) {
      return NextResponse.json({ error: 'forbidden', message: 'لا تملك صلاحية عرض المعدات' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const projectId = searchParams.get('projectId')
    const where: any = {}
    // v42: projectId=none → المعدات اليتيمة التي فقدت مشروعها (قيد SetNull يُبقيها في القاعدة)
    if (projectId === 'none') where.projectId = null
    else if (projectId) where.projectId = projectId

    // v74: إصلاح قنبلة الحمولة — القائمة كانت تُرسل صور المعدات (base64) مع كل سجل
    // (نحو 100-200KB مضغوطة × 100 معدة ≈ عشرات الميغابايت). الآن: القائمة خفيفة
    // بلا صور + علم hasImage، والصورة تُجلب عند الطلب من GET /api/equipment/[id]
    const result = await safeDbOp(
      () => db.equipment.findMany({
        where,
        orderBy: { name: 'asc' }, take: 100,
        select: {
          id: true, projectId: true, name: true, number: true, type: true,
          status: true, dailyHours: true, breakdowns: true, lastMaintenance: true,
          nextMaintenance: true, spareParts: true, notes: true,
          createdById: true, createdAt: true, updatedAt: true,
          project: { select: { id: true, name: true, code: true } },
          createdBy: { select: { id: true, name: true, nameEn: true } },
          maintenance: { orderBy: { date: 'desc' }, take: 3, include: { performedBy: { select: { id: true, name: true, nameEn: true } } } },
        },
      }), 'جلب المعدات'
    )
    if (!result.success) return result.response
    // v74: أي المعدات تملك صورة؟ — استعلام خفيف بالمعرفات فقط
    var rows: any[] = result.data as any[]
    var imgRows = rows.length > 0 ? await db.equipment.findMany({
      where: { id: { in: rows.map(function(e) { return e.id }) }, image: { not: null } },
      select: { id: true },
    }) : []
    var imgSet = new Set(imgRows.map(function(r) { return r.id }))
    var equipment = rows.map(function(e) {
      return Object.assign({}, e, { hasImage: imgSet.has(e.id) })
    })
    return NextResponse.json({ equipment })
  } catch (error: any) {
    return handleDbError(error, 'جلب المعدات')
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser(req)
    if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
    var rl = checkRateLimit(req, RateLimitPresets.write)
    if (rl.limited) {
      return NextResponse.json({ error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار قليلاً' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })
    }

    // H-1 FIX: RBAC check
    if (!canWrite(user.role, 'equipment', user.permissions)) {
      return NextResponse.json({ error: 'forbidden', message: 'لا تملك صلاحية لإضافة معدات' }, { status: 403 })
    }

    const body = await req.json()
    const validationError = validateRequired(body, ['name', 'number', 'type'])
    if (validationError) return validationError

    const dupResult = await safeDbOp(() => db.equipment.findUnique({ where: { number: String(body.number).trim() } }), 'فحص الرمز المكرر')
    if (dupResult.success && dupResult.data) {
      return NextResponse.json({ error: 'duplicate_number', message: `المعدة برقم "${body.number}" موجودة بالفعل` }, { status: 400 })
    }

    const createResult = await safeDbOp(
      () => db.equipment.create({
        data: {
          projectId: body.projectId || null, name: String(body.name).trim(), number: String(body.number).trim(),
          type: String(body.type), status: String(body.status || 'operational'),
          dailyHours: parseNumber(body.dailyHours, 0),
          lastMaintenance: body.lastMaintenance ? new Date(body.lastMaintenance) : null,
          nextMaintenance: body.nextMaintenance ? new Date(body.nextMaintenance) : null,
          notes: body.notes ? String(body.notes) : null,
          image: validImageDataUrl(body.image),
        },
      }), 'إنشاء المعدة'
    )
    if (!createResult.success) return createResult.response
    return NextResponse.json({ equipment: createResult.data, success: true })
  } catch (error: any) {
    return handleDbError(error, 'إنشاء المعدة')
  }
}

