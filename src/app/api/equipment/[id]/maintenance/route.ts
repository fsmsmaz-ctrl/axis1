import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, safeDbOp } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { canWrite, isSystemAdminAccount } from '@/lib/auth'
import { ensureEquipmentLogSupport } from '@/lib/db-selfheal'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // v75: يضمن عمودي الحذف الناعم قبل أي استعلام
  await ensureEquipmentLogSupport()
  var user = await getAuthUser(req)
  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  // FIX: Use centralized RBAC instead of custom admin email check
  if (!canWrite(user.role, 'equipment', user.permissions)) {
    return NextResponse.json({ error: 'forbidden', message: 'لا تملك صلاحية لتسجيل صيانة المعدات' }, { status: 403 })
  }

  var rl = checkRateLimit(req, RateLimitPresets.write)
  if (rl.limited) {
    return NextResponse.json(
      { error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار قليلاً' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    )
  }

  var { id } = await params

  var body = await req.json()

  if (!body.date || !body.type) {
    return NextResponse.json({ error: 'missing_fields', message: 'التاريخ والنوع مطلوبان' }, { status: 400 })
  }

  try {
    // FIX: Validate equipment exists
    var eqResult = await safeDbOp(
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

    return NextResponse.json({ maintenance: maintenance.data })
  } catch (error) {
    return handleDbError(error, 'إنشاء سجل الصيانة')
  }
}
