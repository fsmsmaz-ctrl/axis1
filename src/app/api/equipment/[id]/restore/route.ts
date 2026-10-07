import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { getAuthUser } from '@/lib/auth-server'
import { ensureEquipmentLogSupport } from '@/lib/db-selfheal'
import { db } from '@/lib/db'
import { handleDbError, safeDbOp, logEquipmentChange } from '@/lib/api-helpers'
import { isSystemAdminAccount } from '@/lib/auth'

// v75: استعادة معدة من أرشيف المحذوفات — لمدير النظام فقط (admin@axis.om)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await ensureEquipmentLogSupport()
  try {
    const user = await getAuthUser(req)
    if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
    var rl = checkRateLimit(req, RateLimitPresets.write)
    if (rl.limited) {
      return NextResponse.json({ error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار قليلاً' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })
    }
    if (!isSystemAdminAccount(user)) {
      return NextResponse.json({ error: 'forbidden', message: 'الاستعادة متاحة لمدير النظام فقط' }, { status: 403 })
    }
    const { id } = await params
    var result = await safeDbOp(() => db.equipment.findUnique({ where: { id } }), 'فحص المعدة')
    if (!result.success) return result.response
    if (!result.data) return NextResponse.json({ error: 'not_found', message: 'المعدة غير موجودة' }, { status: 404 })
    var old = result.data as any
    if (!old.deletedAt) {
      return NextResponse.json({ error: 'not_deleted', message: 'المعدة غير محذوفة أصلاً' }, { status: 400 })
    }
    // v75: منع تعارض الرقم — لو استخدم موظف رقم هذه المعدة لمعدة نشطة أخرى
    var dupActive = await safeDbOp(
      () => db.equipment.findFirst({ where: { number: old.number, id: { not: id }, deletedAt: null }, select: { id: true, name: true } }),
      'فحص تعارض الرقم'
    )
    if (dupActive.success && dupActive.data) {
      var dup = dupActive.data as any
      return NextResponse.json({ error: 'number_conflict', message: `لا يمكن الاستعادة — الرقم «${old.number}» مستخدم الآن بالمعدة النشطة «${dup.name}». عدّل رقم إحداها أولاً` }, { status: 409 })
    }
    var restoreResult = await safeDbOp(
      () => db.equipment.update({ where: { id }, data: { deletedAt: null, deletedById: null } }),
      'استعادة المعدة'
    )
    if (!restoreResult.success) return restoreResult.response
    await logEquipmentChange({
      equipmentId: id, equipmentName: old.name, user,
      action: 'restore',
      changesAr: 'استعادة المعدة «' + old.name + '» (الرقم ' + old.number + ') من أرشيف المحذوفات — عادت ظاهرة للمستخدمين',
      changesEn: 'Restored equipment "' + old.name + '" (No. ' + old.number + ') from the deleted archive — visible to users again',
      projectId: old.projectId || null,
    })
    return NextResponse.json({ success: true, equipment: restoreResult.data })
  } catch (error) {
    return handleDbError(error, 'استعادة المعدة')
  }
}
