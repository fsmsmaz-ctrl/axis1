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

var v43RestoreMetaChecked = false

// v43: أعمدة الاستعادة — الأصل المستعاد يحتفظ بتاريخه الأصلي ومنشئه الأصلي،
// وبيانات من أجرى الاستعادة تُخزَّن في restoredBy/restoredAt (منفصلة تماماً عن المنشئ الأصلي).
export async function ensureCompanyAssetRestoreMeta(): Promise<void> {
  if (v43RestoreMetaChecked) return
  v43RestoreMetaChecked = true
  try {
    var cols = await db.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'CompanyAsset' AND column_name IN ('restoredById', 'restoredAt')`
    var found = new Set<string>((cols || []).map(function(c: any) { return c.column_name }))
    if (!found.has('restoredById')) {
      await db.$executeRawUnsafe('ALTER TABLE "CompanyAsset" ADD COLUMN IF NOT EXISTS "restoredById" TEXT')
      await db.$executeRawUnsafe('ALTER TABLE "CompanyAsset" ADD CONSTRAINT "CompanyAsset_restoredById_fkey" FOREIGN KEY ("restoredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE')
    }
    if (!found.has('restoredAt')) {
      await db.$executeRawUnsafe('ALTER TABLE "CompanyAsset" ADD COLUMN IF NOT EXISTS "restoredAt" TIMESTAMP(3)')
    }
    if (!found.has('restoredById') || !found.has('restoredAt')) {
      console.warn('v43: CompanyAsset restore-meta columns ready (original creator/date preserved on restore)')
    }
  } catch (e) {
    console.error('v43: CompanyAsset restore-meta self-heal skipped:', e)
  }
}
