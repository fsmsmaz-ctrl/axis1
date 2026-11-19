// ============================================================
// v121 — خطة عمل الماكينات: ألوان الماكينات
// PUT /api/machine-plans/machine-colors — مدير الخطة فقط
//
// «يكون لكل ماكينة لون خاص يختاره مدير الخطة» — تغيير اللون يطبق
// فوراً على كل أعمال الماكينة ليظل الدليل موحداً على المخطط كله.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { canManageMachinePlans } from '@/lib/auth'
import { ensureMachinePlansSupport } from '@/lib/db-selfheal'

export async function PUT(req: NextRequest) {
  try {
    var user = await getAuthUser(req)
    if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
    if (!canManageMachinePlans(user)) {
      return NextResponse.json({ error: 'forbidden', message: 'تغيير ألوان الماكينات محصور بحساب مدير الخطة' }, { status: 403 })
    }
    var rl = checkRateLimit(req, RateLimitPresets.write)
    if (rl.limited) {
      return NextResponse.json({ error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار قليلاً' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })
    }
    await ensureMachinePlansSupport()

    var body = await req.json().catch(() => ({} as Record<string, unknown>))
    var machineName = typeof body.machineName === 'string' ? body.machineName.trim().slice(0, 60) : ''
    var color = typeof body.color === 'string' ? body.color.trim() : ''
    if (!machineName) return NextResponse.json({ error: 'invalid_value', message: 'رقم/اسم الماكينة مطلوب' }, { status: 400 })
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) return NextResponse.json({ error: 'invalid_value', message: 'صيغة اللون غير صالحة — يجب أن تكون #RRGGBB' }, { status: 400 })

    var result = await db.machinePlan.updateMany({
      where: { machineName: { equals: machineName } },
      data: { machineColor: color },
    })

    return NextResponse.json({ count: result.count, message: 'عُدّل لون الماكينة ' + machineName + ' على ' + result.count + ' عمل في الخطة' })
  } catch (error) {
    return handleDbError(error, 'PUT /api/machine-plans/machine-colors')
  }
}
