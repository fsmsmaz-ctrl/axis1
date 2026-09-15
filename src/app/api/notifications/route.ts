import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, safeDbOp } from '@/lib/api-helpers'
import { runScanThrottled } from '@/lib/report-watch'
import { runTaskScanThrottled } from '@/lib/task-watch'
import { OVERSIGHT_NOTIFICATION_TYPES, isOversightViewer } from '@/lib/oversight'

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
  // ── نقل الرقابة العملية (v17) ──
  // لمشاهدي الإدارة (الإدارة العليا / مديرو المشاريع / مدير النظام) تُنقل
  // هذه الفئات من قسم "التنبيهات" إلى قسم "الرقابة العملية":
  //   • رسائل وإشعارات عمليات البيانات (إضافة / تعديل / حذف)
  //   • التحذيرات الرقابية الموجهة للإدارة
  //   • متابعة المهام (تأخير / اقتراب موعد / بانتظار مراجعة...)
  //   • التحذيرات الحرجة
  // لذا تُستبعد أنواعها هنا وتظهر حصراً في القسم الجديد (api/oversight).
  // التنبيهات الشخصية (إسناد مهمة، اعتماد تقرير/تشطيب، إعادة مهمة...)
  // تبقى في هذا القسم لجميع المستخدمين دون استثناء.
  var excludeOversight = isOversightViewer(user)
  if (excludeOversight) {
    where.type = { notIn: OVERSIGHT_NOTIFICATION_TYPES.slice() }
  }
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
  }
  if (excludeOversight) {
    countWhere.type = { notIn: OVERSIGHT_NOTIFICATION_TYPES.slice() }
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
