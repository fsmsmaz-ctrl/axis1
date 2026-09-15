import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, safeDbOp } from '@/lib/api-helpers'
import { OVERSIGHT_NOTIFICATION_TYPES } from '@/lib/oversight'

export async function GET(req: NextRequest) {
  var user = await getAuthUser(req)
  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  var searchParams = new URL(req.url).searchParams
  var unreadOnly = searchParams.get('unreadOnly') === 'true'

  // ── v20: لم يعد هذا المسار يشغّل فحص التأخيرات الدوري ──
  // انتظار الفحص الثقيل داخل مسار الطلب كان يتجاوز حد مهلة Netlify
  // (10 ثوانٍ) فيُعيد الخادم صفحة خطأ غير JSON فتفشل الواجهة صامتة
  // (قائمة فارغة بلا رسالة). القراءة الآن مباشرة وسريعة دائماً،
  // والفحص له مساره الخاص: POST /api/notifications/scan — تشغّله
  // الواجهة عند الفتح بشكل غير معترَض عليه (fire-and-forget) مع
  // throttle داخلي (مرة كل 10 دقائق كحد أقصى).

  // ── قاعدة الظهور: التنبيه يظهر فقط لمن وُجِّه إليه ──
  // 1) تنبيهات موجهة للمستخدم نفسه (userId = user.id)
  // 2) تنبيهات عامة بلا مستهدف محدد (userId = null)
  // لكل الأدوار بلا استثناء — حتى الإدارة العليا ومديرو المشاريع
  // لا يرون إلا تنبيهاتهم الموجهة أو العامة (كان سابقاً يرون الكل).
  var where: any = {
    OR: [
      { userId: user.id },
      { userId: null },
    ],
  }
  // ── حذف سجلات الرقابة العملية من قسم التنبيهات (v17 ← v19) ──
  // اعتباراً من v19: كل سجلات الرقابة تُحذف من قسم "التنبيهات" لجميع
  // المستخدمين دون استثناء — لم يعد الاستبعاد حكراً على مشاهدي الإدارة:
  //   • إشعارات عمليات البيانات (إضافة / تعديل / حذف)
  //   • التحذيرات الرقابية الموجهة للإدارة
  //   • متابعة المهام الإدارية (تأخير / اقتراب موعد / بانتظار مراجعة...)
  //   • الأنواع الرقابية القديمة (safety_alert, work_stopped, ...)
  // موطنها الحصري قسم "الرقابة العملية" (api/oversight) — والسجلات
  // القديمة الموجودة في قاعدة البيانات تظهر هناك تلقائياً.
  // تبقى في هذا القسم التنبيهات الشخصية فقط: إسناد/إعادة/اعتماد/إلغاء
  // مهمة، تغيير موعد، اعتماد تقريرك/تشطيبك، وتذكيرات مهمتك الشخصية.
  where.type = { notIn: OVERSIGHT_NOTIFICATION_TYPES.slice() }
  if (unreadOnly) where.read = false

  var result = await safeDbOp(
    () => db.notification.findMany({
      where,
      include: { project: { select: { name: true, code: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    'جلب التنبيهات'
  )

  var countWhere: any = {
    read: false,
    OR: [{ userId: user.id }, { userId: null }],
    // v19: عدّاد الجرس يعدّ التنبيهات الشخصية فقط — سجلات الرقابة مستبعدة دائماً
    type: { notIn: OVERSIGHT_NOTIFICATION_TYPES.slice() },
  }

  var countResult = await safeDbOp(
    () => db.notification.count({ where: countWhere }),
    'عد التنبيهات غير المقروءة'
  )

  if (!result.success) return result.response

  return NextResponse.json({
    notifications: result.data,
    unreadCount: countResult.success ? countResult.data : 0,
  })
}
