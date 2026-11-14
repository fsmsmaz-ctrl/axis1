// ============================================================
// v114 — التشغيل اليومي الآلي لخوارزمية «فاتورة المقاول»
// ============================================================
// يُستدعى من Vercel Cron (معرَّف في vercel.json) مرة واحدة يومياً
// صباحاً — فيصدر النظام فواتير كل 10 أمتار من خطوط الحفر ويصحح
// أي تغيّر دون تدخل بشري حتى لو لم يفتح أحد النظام.
//
// الأمان:
//  - إن ضُبط متغير البيئة CRON_SECRET في Vercel فلا يُقبل أي
//    استدعاء إلا بتوقيع Vercel الرسمي (Authorization: Bearer).
//  - إن لم يُضبط يبقى المسار آمناً لأن العملية رجعية حكيمة:
//    تنشئ الناقص فقط وتصحح المتغير وتحذف الزائد بالبصمة،
//    ولا تُرجع أي بيانات حساسة — فقط عدّادات ملخصة.
// GET /api/cron/contractor-invoices
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { syncContractorInvoices } from '@/lib/contractor-invoices'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  var secret = process.env.CRON_SECRET
  if (secret) {
    var auth = req.headers.get('authorization') || ''
    if (auth !== 'Bearer ' + secret) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
  }

  var result = await syncContractorInvoices({ force: true })

  return NextResponse.json({
    ok: !result.error,
    job: 'contractor-invoices',
    created: result.created,
    updated: result.updated,
    deleted: result.deleted,
    createdAmount: result.createdAmount,
    linesChecked: result.linesChecked,
    skippedNoPrice: result.skippedNoPrice,
    error: result.error || null,
    time: new Date().toISOString(),
  })
}
