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


// v48: الملف الشخصي والمشتريات — إنشاء عمود النقاط وجدول Purchase تلقائياً
// (Netlify لا يشغّل migrate deploy — درس v44: الشفاء يُربط بالمسارات المستخدمة فعلياً)
var v48PurchasesChecked = false

export async function ensurePurchasesSupport(): Promise<void> {
  if (v48PurchasesChecked) return
  v48PurchasesChecked = true
  try {
    // 1) عمود النقاط على المستخدم — تُمنح لاحقاً عبر المهام (تحديث مستقل)
    var userCols = await db.$queryRawUnsafe<Array<{ column_name: string }>>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'User'"
    )
    var hasPoints = userCols.some(function(c) { return c.column_name === 'points' })
    if (!hasPoints) {
      await db.$executeRawUnsafe('ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "points" INTEGER NOT NULL DEFAULT 0')
      console.warn('v48: User.points column created by self-heal')
    }
    // 2) جدول المشتريات
    var purchaseTables = await db.$queryRawUnsafe<Array<{ table_name: string }>>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'Purchase'"
    )
    if (purchaseTables.length === 0) {
      await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "Purchase" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "notes" TEXT,
  "amount" DOUBLE PRECISION NOT NULL,
  "invoiceImage" TEXT,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "projectId" TEXT,
  "reviewNote" TEXT,
  "reviewedById" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "costId" TEXT,
  "submittedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
)`)
      await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "Purchase_userId_idx" ON "Purchase"("userId")')
      await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "Purchase_status_idx" ON "Purchase"("status")')
      await db.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS "Purchase_costId_key" ON "Purchase"("costId")')
      await db.$executeRawUnsafe('ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE')
      await db.$executeRawUnsafe('ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE')
      await db.$executeRawUnsafe('ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE')
      await db.$executeRawUnsafe('ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_costId_fkey" FOREIGN KEY ("costId") REFERENCES "Cost"("id") ON DELETE SET NULL ON UPDATE CASCADE')
      console.warn('v48: Purchase table created by self-heal')
    }
  } catch (e) {
    console.error('v48 purchases self-heal skipped:', e)
  }
}
