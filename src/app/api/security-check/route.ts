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
    // v78: القاعدة الجديدة — مدير النظام (العلم أو البريد الرئيسي) يرى كل الأسعار
    verdict: canSee
      ? 'هذا الحساب مسموح له برؤية الأسعار (مدير النظام، أو دور إدارة عليا أو مدير مشروع)'
      : 'هذا الحساب محظور من رؤية الأسعار — الخادم لا يرسل له أي سعر مالي',
    hint: canSee
      ? 'إذا كان هذا حساب مدير النظام فرؤية الأسعار له أصبحت مفعّلة منذ v78 بقرار صاحب الموقع'
      : 'إن كان السعر يظهر لك رغم هذا الرد فالسبب كاش المتصفح حتماً — نفّذ Ctrl+Shift+R أو امسح بيانات الموقع من إعدادات المتصفح',
  })
}
