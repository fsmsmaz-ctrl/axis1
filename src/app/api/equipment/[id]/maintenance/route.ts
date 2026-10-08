import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, safeDbOp } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { canEditAnyEquipment, isSystemAdminAccount } from '@/lib/auth'
import { ensureEquipmentLogSupport } from '@/lib/db-selfheal'
import { logEquipmentChange } from '@/lib/api-helpers'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // v75: يضمن عمودي الحذف الناعم قبل أي استعلام
  await ensureEquipmentLogSupport()
  var user = await getAuthUser(req)
  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  var { id } = await params

  // FIX: Use centralized RBAC instead of custom admin email check
  // v84 (قرار صاحب الموقع): تسجيل الصيانة متاح لأي موظف يملك صلاحية كتابة
  // المعدات — أي معدة سجّلها موظف يمكن لأي موظف آخر تسجيل صيانتها، وكل
  // صيانة تُسجّل باسم صاحبها وتوقيتها في سجل المعدة نفسها (النقاط الصغيرة)
  var eqGate = await safeDbOp(
    () => db.equipment.findUnique({ where: { id }, select: { id: true, deletedAt: true, name: true, number: true, projectId: true } }),
    'فحص المعدة'
  )
  var eqForGate = eqGate.success ? eqGate.data as any : null
  if (!canEditAnyEquipment(user)) {
    return NextResponse.json({ error: 'forbidden', message: 'لا تملك صلاحية لتسجيل صيانة المعدات' }, { status: 403 })
  }

  var rl = checkRateLimit(req, RateLimitPresets.write)
  if (rl.limited) {
    return NextResponse.json(
      { error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار قليلاً' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    )
  }

  var body = await req.json()

  if (!body.date || !body.type) {
    return NextResponse.json({ error: 'missing_fields', message: 'التاريخ والنوع مطلوبان' }, { status: 400 })
  }

  try {
    // FIX: Validate equipment exists
    // v83: الفحص الأول للبوابة تم أعلاه (eqForGate) — هذا فحص ما بعد الجسم للسلامة
    var eqResult = eqGate.success ? eqGate : await safeDbOp(
      () => db.equipment.findUnique({ where: { id }, select: { id: true, deletedAt: true } }),
      'فحص المعدة'
    )
    if (!eqResult.success) return eqResult.response
    if (!eqResult.data) {
      return NextResponse.json({ error: 'not_found', message: 'المعدة غير موجودة' }, { status: 404 })
    }
    // v75: المعدة المحذوفة مخفية عن غير مدير النظام — لا صيانة عليها
    if ((eqResult.data as any).deletedAt && !isSystemAdminAccount(user)) {
      return NextResponse.json({ error: 'not_found', message: 'المعدة غير موجودة' }, { status: 404 })
    }

    // v70: تكلفة غير سالبة + قائمة سماح للحالة + معاملة واحدة (كان فشل التحديث يترك السجل بلا حالة)
    var maintCost = parseFloat(body.cost)
    if (!Number.isFinite(maintCost) || maintCost < 0) maintCost = 0
    var VALID_MAINT_STATUS = ['operational', 'stopped', 'maintenance_needed']
    var maintStatus = VALID_MAINT_STATUS.includes(String(body.setStatus || 'operational')) ? String(body.setStatus || 'operational') : 'operational'
    var maintenance = await safeDbOp(
      () => db.$transaction(async function (tx) {
        var rec = await tx.equipmentMaintenance.create({
          data: {
            equipmentId: id,
            date: new Date(body.date),
            type: String(body.type),
            description: body.description ? String(body.description) : "",
            cost: maintCost,
            partsUsed: body.partsUsed ? String(body.partsUsed) : "",
            performedById: user!.id,
          },
        })
        await tx.equipment.update({
          where: { id },
          data: {
            lastMaintenance: new Date(body.date),
            status: maintStatus,
          },
        })
        return rec
      }),
      'إنشاء سجل الصيانة'
    )
    if (!maintenance.success) return maintenance.response

    safeDbOp(
      () => db.auditLog.create({ data: { userId: user!.id, action: 'create', entity: 'equipment_maintenance', entityId: maintenance.data.id, details: 'Maintenance: ' + body.type + ' for equipment ' + id } }),
      'سجل التدقيق'
    ).catch(function() {})

    // v83: تسجيل الصيانة في مفكرة المعدات أيضاً — «أي تغيّر يظهر في السجل في الأسفل»
    var v83Cost = Number(maintCost) || 0
    var v83TypeAr = String(body.type) === 'routine' ? 'دورية' : String(body.type) === 'repair' ? 'إصلاح' : String(body.type) === 'emergency' ? 'طارئة' : String(body.type)
    await logEquipmentChange({
      equipmentId: id,
      equipmentName: eqForGate ? (eqForGate.name as string) : null,
      user,
      action: 'maintenance',
      changesAr: 'سجّل صيانة (' + v83TypeAr + ') للمعدة «' + (eqForGate ? eqForGate.name : '') + '»' + (v83Cost > 0 ? ' — التكلفة: ' + v83Cost + ' ر.ع' : ''),
      changesEn: 'Recorded ' + String(body.type) + ' maintenance for equipment "' + (eqForGate ? (eqForGate.name as string) : '') + '"' + (v83Cost > 0 ? ' — cost: ' + v83Cost + ' OMR' : ''),
      projectId: eqForGate ? (eqForGate.projectId as string | null) : null,
    })

    return NextResponse.json({ maintenance: maintenance.data })
  } catch (error) {
    return handleDbError(error, 'إنشاء سجل الصيانة')
  }
}
