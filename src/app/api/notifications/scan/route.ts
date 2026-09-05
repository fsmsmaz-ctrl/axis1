import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { runScanThrottled } from '@/lib/report-watch'

// تشغيل فحص التأخيرات (تقارير لم تُسلّم/تُعتمد، سلامة ناقصة،
// تشطيب غير مكتمل، جاهزية تقييم الأداء) وإصدار التنبيهات الموجهة.
// الفحص مقيَّد زمنياً (مرة كل 10 دقائق) ما لم يُطلب فرضه force=true،
// وفرض التنفيذ متاح لمدير النظام والإدارة العليا فقط.
export async function POST(req: NextRequest) {
  var user = await getAuthUser(req)
  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  var force = false
  try {
    var body = await req.json()
    force = body?.force === true
  } catch (e) {
    force = false
  }

  if (force && user.role !== 'top_management') {
    var isSystemAdmin = (user.email || '').toLowerCase().trim() === 'admin@axis.om'
    if (!isSystemAdmin) {
      return NextResponse.json({ error: 'forbidden', message: 'فرض الفحص متاح لمدير النظام والإدارة العليا فقط' }, { status: 403 })
    }
  }

  var result = await runScanThrottled(force)
  return NextResponse.json({ success: true, created: result.created, skipped: result.skipped })
}

