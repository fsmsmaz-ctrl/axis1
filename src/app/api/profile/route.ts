// v48: الملف الشخصي — قراءة بيانات الحساب وتحديث صورة الملف الشخصي فقط
// الاسم والبريد لا يُعدَّلان من هنا (بيانات الحساب الأساسية من إدارة النظام)
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { ensurePurchasesSupport } from '@/lib/db-selfheal'
import { logProfileAudit, logOversightEvent } from '@/lib/profile-audit'

// GET: بيانات الملف الشخصي للمستخدم الحالي (الاسم، الدور، الصورة، النقاط)
export async function GET(req: NextRequest) {
  var user = await getAuthUser(req)
  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }
  try {
    await ensurePurchasesSupport()
    var me = await db.user.findUnique({
      where: { id: user.id },
      select: {
        id: true, email: true, name: true, nameEn: true,
        role: true, phone: true, avatar: true, points: true, active: true,
      },
    })
    if (!me || !me.active) {
      return NextResponse.json({ error: 'unauthorized', message: 'الحساب غير متاح' }, { status: 401 })
    }
    return NextResponse.json({ profile: me })
  } catch (e) {
    console.error('v48 profile GET failed:', e)
    return NextResponse.json({ error: 'database_error', message: 'فشل جلب الملف الشخصي' }, { status: 500 })
  }
}

// PATCH: تحديث صورة الملف الشخصي فقط — data URL مضغوطة من المتصفح
export async function PATCH(req: NextRequest) {
  var user = await getAuthUser(req)
  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }
  var rl = checkRateLimit(req, RateLimitPresets.write)
  if (rl.limited) {
    return NextResponse.json({ error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار قليلاً' }, { status: 429 })
  }
  try {
    await ensurePurchasesSupport()
    var body = await req.json()
    if (!('avatar' in body)) {
      return NextResponse.json({ error: 'missing_fields', message: 'لا توجد بيانات للتحديث' }, { status: 400 })
    }
    var avatar: string | null = null
    if (body.avatar) {
      var s = String(body.avatar)
      // صيغة مسموحة فقط: data URL لصورة
      if (!/^data:image\/(png|jpeg|jpg|webp);base64,/.test(s)) {
        return NextResponse.json({ error: 'invalid_input', message: 'صورة غير صالحة' }, { status: 400 })
      }
      // حد الحجم: ~2 مليون حرف base64 (نحو 1.5MB صورة)
      if (s.length > 2000000) {
        return NextResponse.json({ error: 'invalid_input', message: 'حجم الصورة كبير جداً' }, { status: 400 })
      }
      avatar = s
    }
    var updated = await db.user.update({
      where: { id: user.id },
      data: { avatar: avatar },
      select: {
        id: true, email: true, name: true, nameEn: true,
        role: true, phone: true, avatar: true, points: true,
      },
    })
    // v49: ربط تغيير الصورة بالرقابة — سجل عمليات + تنبيه رقابي عام
    await logProfileAudit({
      actorId: user.id, action: 'update', entity: 'user', entityId: user.id,
      details: JSON.stringify({
        summary: avatar ? 'تحديث صورة الملف الشخصي' : 'إزالة صورة الملف الشخصي',
        changes: [],
      }),
    })
    await logOversightEvent({
      type: 'profile_updated',
      title: avatar ? 'تحديث صورة الملف الشخصي' : 'إزالة صورة الملف الشخصي',
      message: (updated.name || user.name || 'موظف') + (avatar ? ' حدّث صورة ملفه الشخصي' : ' أزال صورة ملفه الشخصي'),
      severity: 'info',
      link: 'profile', entityType: 'user', entityId: user.id,
    })
    return NextResponse.json({ ok: true, profile: updated })
  } catch (e) {
    console.error('v48 profile PATCH failed:', e)
    return NextResponse.json({ error: 'database_error', message: 'فشل تحديث الملف الشخصي' }, { status: 500 })
  }
}
