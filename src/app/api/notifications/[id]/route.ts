import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, safeDbOp } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { normalizeRole } from '@/lib/auth'

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  var user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  // v74: تحصين — كتابة على التنبيه بلا حد معدل سابقاً
  var rl = checkRateLimit(req, RateLimitPresets.write)
  if (rl.limited) {
    return NextResponse.json({ error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار قليلاً' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })
  }

  var { id } = await params

  var notifResult = await safeDbOp(
    () => db.notification.findUnique({ where: { id }, select: { userId: true } }),
    'البحث عن التنبيه'
  )
  if (!notifResult.success) return notifResult.response
  if (!notifResult.data) return NextResponse.json({ error: 'not_found', message: 'التنبيه غير موجود' }, { status: 404 })

  // FIX: Use role check instead of email comparison
  if (notifResult.data.userId && notifResult.data.userId !== user.id && normalizeRole(user.role) !== 'top_management') {
    return NextResponse.json({ error: 'forbidden', message: 'لا يمكنك تعديل تنبيهات مستخدم آخر' }, { status: 403 })
  }

  var body = await req.json()

  // FIX-4.5: Wrapped in safeDbOp to prevent crash
  var updateResult = await safeDbOp(
    () => db.notification.update({ where: { id }, data: { read: body.read ?? true } }),
    'تحديث التنبيه'
  )
  if (!updateResult.success) return updateResult.response

  return NextResponse.json({ notification: updateResult.data })
}
