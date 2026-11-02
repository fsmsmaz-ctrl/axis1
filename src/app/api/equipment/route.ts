import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { getAuthUser } from '@/lib/auth-server'
import { ensureMediaSupport, ensureEquipmentLogSupport } from '@/lib/db-selfheal'
import { db } from '@/lib/db'
import { handleDbError, validateRequired, parseNumber, safeDbOp, validImageDataUrl, logEquipmentChange } from '@/lib/api-helpers'
import { canWrite, hasPermission, isSystemAdminAccount } from '@/lib/auth'

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthUser(req)
    if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
    // v80 SECURITY FIX: أوامر DDL (الشفاء الذاتي) كانت تنفذ قبل فحص الهوية —
    // أي طلب مجهول كان يطلق إنشاء جداول/أعمدة. الآن بعد التحقق فقط.
    await ensureMediaSupport()
    // v75: يضمن عمودي الحذف الناعم + جدول المفكرة قبل أي استعلام
    await ensureEquipmentLogSupport()

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
    // v75: الحذف الناعم — المحذوفة تختفي عن الجميع (الأرشيف يُعاد منفصلاً لمدير النظام فقط)
    where.deletedAt = null

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
    // v84: السجل المصغر لكل معدة — آخر 4 تغييرات تُعاد مع كل صف كنقاط صغيرة
    // تُعرض على البطاقة نفسها (باسم صاحبها وتوقيتها) لضمان حقوق الجميع،
    // استعلام واحد خفيف بالمعرفات فقط ثم توزيع في الذاكرة (4 لكل معدة كحد أقصى)
    var v84RecentLogs: Record<string, any[]> = {}
    try {
      if (rows.length > 0) {
        var v84LogRows = await db.equipmentLog.findMany({
          where: { equipmentId: { in: rows.map(function(e) { return e.id }) } },
          orderBy: { createdAt: 'desc' },
          take: Math.min(rows.length * 8, 400),
          select: { id: true, equipmentId: true, action: true, changesAr: true, changesEn: true, userName: true, userNameEn: true, createdAt: true },
        })
        v84LogRows.forEach(function(l: any) {
          if (!l.equipmentId) return
          var arr = v84RecentLogs[l.equipmentId] || (v84RecentLogs[l.equipmentId] = [])
          if (arr.length < 4) arr.push(l)
        })
      }
    } catch { v84RecentLogs = {} }
    var equipment = rows.map(function(e) {
      return Object.assign({}, e, { hasImage: imgSet.has(e.id), recentLogs: v84RecentLogs[e.id] || [] })
    })
    // v83: أُلغي تعقيم تكاليف الصيانة عن مسؤول السلامة — قرار صاحب الموقع:
    // مَن يسجّل معدة يرى كافة بياناتها ومن ضمنها الأسعار، والمساءلة عبر المفكرة
    // v75: أرشيف المعدات المحذوفة — مرئي لمدير النظام فقط (لا يُحذف شيء نهائياً)
    var deletedEquipment: any[] = []
    if (isSystemAdminAccount(user)) {
      try {
        var delWhere: any = { deletedAt: { not: null } }
        if (projectId === 'none') delWhere.projectId = null
        else if (projectId) delWhere.projectId = projectId
        var delRows = await safeDbOp(
          () => db.equipment.findMany({
            where: delWhere,
            orderBy: { updatedAt: 'desc' }, take: 50,
            select: {
              id: true, projectId: true, name: true, number: true, type: true,
              status: true, deletedAt: true, deletedById: true,
              project: { select: { id: true, name: true, code: true } },
            },
          }), 'جلب أرشيف المحذوفات'
        )
        if (delRows.success) deletedEquipment = delRows.data as any[]
      } catch { deletedEquipment = [] }
    }
    return NextResponse.json({ equipment, deletedEquipment })
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
    // v82: مسؤول السلامة مُنح الإنشاء فقط — canWrite تقبل دوره هنا
    // v83: المشرف (foreman) أيضاً يسجّل معدات جديدة — canWrite تقبل دوره
    if (!canWrite(user.role, 'equipment', user.permissions)) {
      return NextResponse.json({ error: 'forbidden', message: 'لا تملك صلاحية لإضافة معدات' }, { status: 403 })
    }

    const body = await req.json()
    const validationError = validateRequired(body, ['name', 'number', 'type'])
    if (validationError) return validationError

    // v101: قيد التفرد على «الرقم» — يبقى كما هو (حارس أول).
    const dupResult = await safeDbOp(() => db.equipment.findUnique({ where: { number: String(body.number).trim() } }), 'فحص الرمز المكرر')
    if (dupResult.success && dupResult.data) {
      // v75: رسالة أوضح إذا كان الرقم محتجزاً بمعدة في الأرشيف (الحذف ناعم)
      var isArchivedDup = !!(dupResult.data as any).deletedAt
      return NextResponse.json({ error: 'duplicate_number', message: isArchivedDup
        ? `الرقم "${body.number}" محتجز بمعدة في أرشيف المحذوفات — يمكن لمدير النظام استعادتها أو اختر رقماً آخر`
        : `المعدة برقم "${body.number}" موجودة بالفعل` }, { status: 400 })
    }

    // v101: حارس زمني ضد التكرار بالنقر المزدوج — لو أن نفس المستخدم أنشأ معدة بنفس
    // «الاسم + النوع» خلال آخر 30 ثانية، فهذا تقريباً طلب مكرر من نقرات متتالية
    // (حتى لو اختلف الرقم قليلاً). نُرجع خطأ واضحاً بدل إنشاء نسخة مكررة. لا يُطبَّق
    // هذا الحارس على مدير النظام حتى لا يُعطّل عمليات الإصلاح اليدوية المتتالية.
    var v101Name = String(body.name).trim()
    var v101Type = String(body.type)
    if (!isSystemAdminAccount(user)) {
      var v101WindowStart = new Date(Date.now() - 30 * 1000)
      var v101RecentDup = await safeDbOp(
        () => db.equipment.findFirst({
          where: {
            createdById: user.id,
            name: v101Name,
            type: v101Type,
            createdAt: { gte: v101WindowStart },
            deletedAt: null,
          },
          select: { id: true, name: true, number: true, createdAt: true },
        }),
        'فحص التكرار الزمني'
      )
      if (v101RecentDup.success && v101RecentDup.data) {
        var v101Dup = v101RecentDup.data as any
        return NextResponse.json({
          error: 'duplicate_submit',
          message: `أنشأت للتو معدة بنفس الاسم والنوع («${v101Name}») — تنتظر قليلاً قبل إنشاء أخرى مطابقة لتفادي التكرار`,
          existing: { id: v101Dup.id, number: v101Dup.number },
        }, { status: 409 })
      }
    }

    const createResult = await safeDbOp(
      () => db.equipment.create({
        data: {
          projectId: body.projectId || null, name: String(body.name).trim(), number: String(body.number).trim(),
          type: String(body.type), status: String(body.status || 'operational'),
          dailyHours: parseNumber(body.dailyHours, 0),
          lastMaintenance: body.lastMaintenance ? new Date(body.lastMaintenance) : null,
          nextMaintenance: body.nextMaintenance ? new Date(body.nextMaintenance) : null,
          notes: body.notes ? String(body.notes).slice(0, 2000) : null,
          image: validImageDataUrl(body.image),
          // v101: تسجيل منشئ المعدة — كان مفقوداً قبل هذا الإصدار، وهو لازم
          // للمساءلة (المفكرة) ولاستخدام الحارس الزمني أعلاه.
          createdById: user.id,
        },
      }), 'إنشاء المعدة'
    )
    if (!createResult.success) return createResult.response
    // v75: تسجيل الإنشاء في مفكرة المعدات + سجل التدقيق (بالتوقيت واسم المستخدم)
    var v75Created = createResult.data as any
    await logEquipmentChange({
      equipmentId: v75Created.id, equipmentName: v75Created.name, user,
      action: 'create',
      changesAr: `تم إنشاء المعدة «${v75Created.name}» (الرقم ${v75Created.number})`,
      changesEn: `Created equipment "${v75Created.name}" (No. ${v75Created.number})`,
      projectId: v75Created.projectId || null,
    })
    return NextResponse.json({ equipment: createResult.data, success: true })
  } catch (error: any) {
    return handleDbError(error, 'إنشاء المعدة')
  }
}
