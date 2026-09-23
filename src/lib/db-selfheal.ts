// v42: شفاء ذاتي لقيد أصول الشركة في قاعدة البيانات
// قبل v42 كان القيد ON DELETE CASCADE — حذف أي مشروع كان يمسح أصوله (ملك/مستأجر/معار) نهائياً.
// v42 يحوّل القيد إلى ON DELETE SET NULL (نمط v32 للفواتير): الأصول تنجو «بدون مشروع»
// ويمكن إسنادها لمشروع آخر من صفحة المعدات.
// الدالة تعمل مرة واحدة لكل عملية تشغيل (serverless instance) وهي آمنة تماماً (idempotent):
// - إن كان القيد فعلاً SET NULL فلا يُنفَّذ أي DDL
// - أي فشل يُسجَّل في السجل ولا يعطّل الطلب الأصلي

import { db } from '@/lib/db'

var v42FkChecked = false

export async function ensureCompanyAssetFk(): Promise<void> {
  if (v42FkChecked) return
  v42FkChecked = true
  try {
    // confdeltype: 'c' = CASCADE, 'n' = SET NULL, 'r' = RESTRICT, 'a' = NO ACTION
    var rows = await db.$queryRaw<Array<{ confdeltype: string }>>`
      SELECT confdeltype FROM pg_constraint
      WHERE conrelid = '"CompanyAsset"'::regclass
        AND conname = 'CompanyAsset_projectId_fkey'
      LIMIT 1`
    if (Array.isArray(rows) && rows.length > 0 && rows[0].confdeltype !== 'n') {
      await db.$executeRawUnsafe('ALTER TABLE "CompanyAsset" DROP CONSTRAINT IF EXISTS "CompanyAsset_projectId_fkey"')
      await db.$executeRawUnsafe('ALTER TABLE "CompanyAsset" ADD CONSTRAINT "CompanyAsset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE')
      console.warn('v42: CompanyAsset.projectId FK -> ON DELETE SET NULL (assets survive project deletion)')
    }
  } catch (e) {
    console.error('v42: CompanyAsset FK self-heal skipped:', e)
  }
}
