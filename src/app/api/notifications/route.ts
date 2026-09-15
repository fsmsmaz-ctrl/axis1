import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, safeDbOp } from '@/lib/api-helpers'
import { runScanThrottled } from '@/lib/report-watch'
import { runTaskScanThrottled } from '@/lib/task-watch'
import { OVERSIGHT_NOTIFICATION_TYPES } from '@/lib/oversight'

export async function GET(req: NextRequest) {
  var user = await getAuthUser(req)
  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  var searchParams = new URL(req.url).searchParams
  var unreadOnly = searchParams.get('unreadOnly') === 'true'

  // ── فحص التأخيرات الدوري: يُنفَّذ مرة واحدة كحد أقصى كل 10 دقائق ──
  // يرصد: تقارير لم تُسلَّم/لم تُعتمد، سلامة ناقصة، تشطيب غير مكتمل،
  // جاهزية تقييم الأداء — ويُصدر التنبيهات لأصحاب الصلاحيات.
  // لا يُنفَّع عند طلب غير المقروءة فقط (polling الجرس الخفيف).
  if (!unreadOnly) {
    try {
      await runScanThrottled(false)
      // مراقب المهام: مواعيد خلال 24 ساعة / تأخيرات / بانتظار مراجعة
      await runTaskScanThrottled(false)
    } catch (e) {
      // الفحص غير حرج — الاستمرار في جلب التنبيهات
    }
  }

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
