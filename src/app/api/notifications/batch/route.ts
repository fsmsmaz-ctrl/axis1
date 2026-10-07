import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { safeDbOp } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { OVERSIGHT_NOTIFICATION_TYPES } from '@/lib/oversight'

// تعليم كل تنبيهات المستخدم الحالية كمقروءة في طلب واحد.
// ملاحظة: المسار الثابت batch له الأولوية على المسار الديناميكي [id]
// في App Router — سابقاً كان الطلب يصل إلى [id] ويفشل بخطأ 404.
export async function PUT(req: NextRequest) {
  var user = await getAuthUser(req)
  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }
  // v74: تحصين — كتابة جماعية على التنبيهات بلا حد معدل سابقاً
  var rl = checkRateLimit(req, RateLimitPresets.write)
  if (rl.limited) {
    return NextResponse.json({ error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار قليلاً' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })
  }

  // تعليم التنبيهات الموجهة للمستخدم نفسه فقط (userId = user.id)
  // بالإضافة إلى التنبيهات العامة (userId = null) — لا نلمس تنبيهات مستخدمين آخرين
  // v17: زر «تعليم الكل» لا يمس سجلات الرقابة غير المقروءة
  // v19: الاستبعاد صار لجميع المستخدمين — سجلات الرقابة لم تعد تُعرض
  // في هذا القسم أصلاً (موطنها قسم الرقابة العملية)، فلا يجوز أن يمسها
  // الزر لأي مستخدم وإلا صفرت عدادات القسم الجديد دون أن يراها أحد.
  var where: any = {
    read: false,
    OR: [{ userId: user!.id }, { userId: null }],
    type: { notIn: OVERSIGHT_NOTIFICATION_TYPES.slice() },
  }

  var updateResult = await safeDbOp(
    () => db.notification.updateMany({
      where,
      data: { read: true },
    }),
    'تعليم التنبيهات كمقروءة'
  )
  if (!updateResult.success) return updateResult.response

  return NextResponse.json({ success: true, updated: updateResult.data.count })
}

                                    
