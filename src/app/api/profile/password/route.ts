// v48: تغيير كلمة المرور من الملف الشخصي — يتطلب كلمة المرور الحالية
// عند النجاح يُرفع tokenVersion فتُبطَل كل الجلسات القديمة فوراً (نمط v14 الأمني)
// ويعيد المتصفح توجيه الموظف لتسجيل الدخول بكلمة المرور الجديدة
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import bcrypt from 'bcryptjs'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { logProfileAudit, logOversightEvent } from '@/lib/profile-audit'

export async function POST(req: NextRequest) {
  var user = await getAuthUser(req)
  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }
  // معدل دخول: نفس الحماية الصارمة لتسجيل الدخول لمنع التخمين
  var rl = checkRateLimit(req, RateLimitPresets.auth)
  if (rl.limited) {
    return NextResponse.json(
      { error: 'too_many_requests', message: 'محاولات كثيرة جداً، يرجى الانتظار قليلاً' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    )
  }
  try {
    var body = await req.json()
    var currentPassword = body.currentPassword
    var newPassword = body.newPassword
    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: 'missing_fields', message: 'أدخل كلمة المرور الحالية والجديدة' }, { status: 400 })
    }
    if (String(newPassword).length < 6) {
      return NextResponse.json({ error: 'weak_password', message: 'كلمة المرور الجديدة قصيرة جداً (6 أحرف على الأقل)' }, { status: 400 })
    }
    var me = await db.user.findUnique({ where: { id: user.id } })
    if (!me || !me.active) {
      return NextResponse.json({ error: 'unauthorized', message: 'الحساب غير متاح' }, { status: 401 })
    }
    var ok = await bcrypt.compare(String(currentPassword), me.password)
    if (!ok) {
      return NextResponse.json({ error: 'wrong_password', message: 'كلمة المرور الحالية غير صحيحة' }, { status: 400 })
    }
    if (String(currentPassword) === String(newPassword)) {
      return NextResponse.json({ error: 'same_password', message: 'كلمة المرور الجديدة مطابقة للحالية' }, { status: 400 })
    }
    var hash = await bcrypt.hash(String(newPassword), 10)
    await db.user.update({
      where: { id: user.id },
      data: { password: hash, tokenVersion: { increment: 1 } },
    })
    // v49: ربط تغيير كلمة المرور بالرقابة — سجل عمليات + تنبيه رقابي عام (تحذير أمني)
    await logProfileAudit({
      actorId: user.id, action: 'update', entity: 'user', entityId: user.id,
      details: JSON.stringify({ summary: 'تغيير كلمة المرور من الملف الشخصي (أُبطلت الجلسات القديمة)', changes: [] }),
    })
    await logOversightEvent({
      type: 'password_changed',
      title: 'تغيير كلمة المرور',
      message: (me.name || user.name || 'موظف') + ' غيّر كلمة مرور حسابه وتم إبطال كل الجلسات القديمة',
      severity: 'warning',
      link: 'profile', entityType: 'user', entityId: user.id,
    })
    return NextResponse.json({ ok: true, message: 'تم تغيير كلمة المرور بنجاح — سيتم تسجيل خروجك لإعادة الدخول' })
  } catch (e) {
    console.error('v48 profile password change failed:', e)
    return NextResponse.json({ error: 'database_error', message: 'فشل تغيير كلمة المرور' }, { status: 500 })
  }
}
