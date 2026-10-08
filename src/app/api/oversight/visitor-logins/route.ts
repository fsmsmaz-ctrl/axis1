// ============================================================
// v78: متابعة دخول الزائر — API قسم «دخول الزائر» في الرقابة العملية
// GET /api/oversight/visitor-logins
// يعرض حصرياً دخولات حساب الزائر (دور visitor): عدّادات الشهر الحالي،
// توزيع آخر 6 أشهر، وآخر 50 دخولاً بتاريخها ووقتها ونوع جهازها.
// البوابة: نفس بوابة الرقابة العملية (isOversightViewer) — الإدارة
// العليا ومديرو المشاريع ومدير النظام فقط. لا تُرسل أي بيانات عن
// حسابات أخرى إطلاقاً — الجدول نفسه لا يُسجّل إلا دور الزائر.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { isOversightViewer } from '@/lib/oversight'
import { ensureVisitorLoginSupport } from '@/lib/visitor-login'

export async function GET(req: NextRequest) {
  var user = await getAuthUser(req)
  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }
  if (!isOversightViewer(user)) {
    return NextResponse.json({ error: 'forbidden', message: 'هذا القسم متاح للإدارة العليا ومديري المشاريع ومدير النظام فقط' }, { status: 403 })
  }

  // الشفاء الذاتي — الجدول قد لا يكون مطبقاً بعد على بيئة حديثة النشر
  try {
    await ensureVisitorLoginSupport()
  } catch {}

  try {
    var now = new Date()
    // آخر 6 أشهر — يتسق مع توزيع الشهور المعروض في الواجهة
    var since = new Date(now.getTime() - 183 * 24 * 3600 * 1000)
    var rows = await db.visitorLogin.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    })

    // حدود الشهر واليوم بتوقيت UTC — اتفاقية بقية النظام (v70)
    var monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    var h24 = new Date(now.getTime() - 24 * 3600 * 1000)
    var d30 = new Date(now.getTime() - 30 * 24 * 3600 * 1000)

    var monthMap: Record<string, number> = {}
    var thisMonth = 0
    var last24h = 0
    var last30 = 0
    for (var i = 0; i < rows.length; i++) {
      var d = rows[i].createdAt
      var key = d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0')
      monthMap[key] = (monthMap[key] || 0) + 1
      if (d >= monthStart) thisMonth++
      if (d >= d30) last30++
      if (d >= h24) last24h++
    }

    // توزيع آخر 6 أشهر تصاعدياً — الشهر كرقم index ليُسمّيه العميل بلغته
    var months: Array<{ key: string; year: number; month: number; count: number }> = []
    for (var m = 5; m >= 0; m--) {
      var md = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - m, 1))
      var k = md.getUTCFullYear() + '-' + String(md.getUTCMonth() + 1).padStart(2, '0')
      months.push({ key: k, year: md.getUTCFullYear(), month: md.getUTCMonth(), count: monthMap[k] || 0 })
    }

    var logins: Array<{ id: string; createdAt: string; device: string }> = []
    for (var j = 0; j < rows.length && j < 50; j++) {
      logins.push({
        id: rows[j].id,
        createdAt: rows[j].createdAt.toISOString(),
        device: rows[j].device,
      })
    }

    return NextResponse.json({
      thisMonth: thisMonth,
      last24h: last24h,
      last30: last30,
      months: months,
      lastLogin: rows.length ? rows[0].createdAt.toISOString() : null,
      logins: logins,
    })
  } catch (e) {
    console.error('v78: visitor-logins query failed:', e)
    // فشل غير إسقاطي — أصفار آمنة بدل 500 يكسر التبويب (نمط عدادات الرقابة v21)
    return NextResponse.json({
      thisMonth: 0, last24h: 0, last30: 0, months: [], lastLogin: null, logins: [], degraded: true,
    })
  }
}
