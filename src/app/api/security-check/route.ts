import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { canViewPricing } from '@/lib/auth'

// GET /api/security-check — أداة تشخيص أمنية (v15)
// تُظهر للجلسة الحالية بالضبط: من هي، وما إذا كان الخادم يسمح لها برؤية الأسعار، ولماذا.
// تُظهر بيانات الجلسة نفسها فقط — لا تكشف أي بيانات عن مستخدمين آخرين.
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  const canSee = canViewPricing(user)

  return NextResponse.json({
    email: user.email,
    role: user.role,
    isSystemAdmin: user.isSystemAdmin === true,
    canViewPricing: canSee,
    verdict: canSee
      ? 'هذا الحساب مسموح له برؤية الأسعار (دور إدارة عليا أو مدير مشروع، وليس معلَّماً كمدير نظام)'
      : 'هذا الحساب محظور نهائياً من رؤية الأسعار — الخادم لا يرسل له أي سعر مالي',
    hint: canSee
      ? 'إن كان هذا حساب المشرف ويجب حجب السعر عنه: علم isSystemAdmin غير مرفوع لسجله في قاعدة البيانات — راجع README في حزمة الإصلاح v15'
      : 'إن كان السعر يظهر لك رغم هذا الرد فالسبب كاش المتصفح حتماً — نفّذ Ctrl+Shift+R أو امسح بيانات الموقع من إعدادات المتصفح',
  })
}
