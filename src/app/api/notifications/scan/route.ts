import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { normalizeRole , SYSTEM_ADMIN_EMAIL } from '@/lib/auth'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { runScanThrottled } from '@/lib/report-watch'
import { runTaskScanThrottled } from '@/lib/task-watch'

// v20 — تشغيل الفحصين الدوريين خارج مسارات القراءة:
//  1) مراقب التقارير: تقارير لم تُسلّم/لم تُعتمد، سلامة ناقصة،
//     تشطيب غير مكتمل، جاهزية تقييم الأداء
//  2) مراقب المهام: مواعيد خلال 24 ساعة / تأخيرات / بانتظار المراجعة
// تستدعيه الواجهة عند فتح قسم التنبيهات أو قسم الرقابة بشكل غير
// معترَض عليه (fire-and-forget) — أي فشل أو مهلة هنا لا تعطل تحميل
// البيانات إطلاقاً، ومنع التكرار عبر entityId يحمي من التنبيهات المزدوجة.
// الفحص مقيَّد زمنياً (مرة كل 10 دقائق) ما لم يُطلب فرضه force=true،
// وفرض التنفيذ متاح لمدير النظام والإدارة العليا فقط.
export async function POST(req: NextRequest) {
  var user = await getAuthUser(req)
  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }
  // v74: تحصين — الفحص اليدوي (خصوصاً force) مكلف خادمياً ولا ينبغي استدعاؤه بلا حد
  var rl = checkRateLimit(req, RateLimitPresets.write)
  if (rl.limited) {
    return NextResponse.json({ error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار قليلاً' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })
  }

  var force = false
  try {
    var body = await req.json()
    force = body?.force === true
  } catch (e) {
    force = false
  }

  if (force && normalizeRole(user.role) !== 'top_management') {
    var isSystemAdmin = (user.email || '').toLowerCase().trim() === SYSTEM_ADMIN_EMAIL
    if (!isSystemAdmin) {
      return NextResponse.json({ error: 'forbidden', message: 'فرض الفحص متاح لمدير النظام والإدارة العليا فقط' }, { status: 403 })
    }
  }

  // v20: الفحصان بالتوازي لتنفيذ الاثنين ضمن مهلة الدالة نفسها —
  // وأي فشل في أحدهما لا يُفشل الآخر ولا النداء كله.
  var [reports, tasks] = await Promise.all([
    runScanThrottled(force).catch(() => ({ created: 0, skipped: true })),
    runTaskScanThrottled(force).catch(() => ({ created: 0, skipped: true })),
  ])

  return NextResponse.json({
    success: true,
    created: (reports.created || 0) + (tasks.created || 0),
    skipped: reports.skipped === true && tasks.skipped === true,
  })
}
