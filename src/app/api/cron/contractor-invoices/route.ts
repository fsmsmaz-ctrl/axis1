// ============================================================
// v116 — التشغيل اليومي لفواتير المقاول (بدون تسجيل آلي)
// ============================================================
// يُستدعى من Vercel Cron (معرَّف في vercel.json) مرة واحدة يومياً:
//  1) ينفذ التنظيف الرجعي: يحذف كل فواتير «فاتورة المقاول» التي
//     سجلتها خوارزمية v114 آلياً (إن وُجدت) بلا تدخل بشري.
//  2) يحسب مقترحات الفواتير بانتظار الموافقة ويرسل تنبيهاً واحداً
//     في اليوم لذوي صلاحية التكاليف بعددهم — التسجيل نفسه لا يتم
//     إلا بعد إدخال السعر يدوياً واعتماد الفاتورة من النافذة
//     المنبثقة بقسم الإيرادات والتكاليف.
//
// الأمان:
//  - إن ضُبط متغير البيئة CRON_SECRET في Vercel فلا يُقبل أي
//    استدعاء إلا بتوقيع Vercel الرسمي (Authorization: Bearer).
//  - إن لم يُضبط يبقى المسار آمناً لأنه لا يرجع أي بيانات حساسة —
//    فقط عدّادات ملخصة.
// GET /api/cron/contractor-invoices
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { maintainContractorInvoices, listPendingContractorInvoices } from '@/lib/contractor-invoices'
import { notifyUsers } from '@/lib/notify'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  var secret = process.env.CRON_SECRET
  if (secret) {
    var auth = req.headers.get('authorization') || ''
    if (auth !== 'Bearer ' + secret) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
  }

  // 1) التنظيف الرجعي لفواتير v114 الآلية
  var maint = await maintainContractorInvoices({ force: true })

  // 2) مقترحات بانتظار الموافقة — قراءة فقط بلا أي تسجيل
  var pendingRes = await listPendingContractorInvoices({ force: true })

  if (!pendingRes.error && pendingRes.count > 0) {
    try {
      await notifyUsers({
        type: 'contractor_invoice_approval',
        title: 'فواتير مقاول بانتظار الموافقة',
        message: 'توجد ' + pendingRes.count + ' فاتورة مقاول ولّدها النظام (فاتورة لكل 10 أمتار من خطوط الحفر) بانتظار إدخال السعر يدوياً واعتمادها في قسم التكاليف — لن تُسجل أي منها دون موافقتكم.',
        severity: 'info',
        entityType: 'cost',
        entityId: 'contractor-invoices-pending',
        permissions: ['costs'],
        roles: ['top_management', 'project_manager', 'accountant'],
        includeSystemAdmin: true,
        link: 'costs',
        dedupeHours: 24,
      })
    } catch (e) {
      console.error('[cron contractor-invoices] notify failed:', e)
    }
  }

  return NextResponse.json({
    ok: !maint.error && !pendingRes.error,
    job: 'contractor-invoices',
    legacyDeleted: maint.deleted,
    pendingCount: pendingRes.count,
    truncated: pendingRes.truncated,
    linesChecked: pendingRes.linesChecked,
    skippedNoPrice: pendingRes.skippedNoPrice,
    error: maint.error || pendingRes.error || null,
    time: new Date().toISOString(),
  })
}
