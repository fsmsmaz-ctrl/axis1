-- v48: الملف الشخصي والمشتريات (Profile & Purchases)
-- Idempotent: آمن للتطبيق المتكرر — Netlify لا يشغّل migrate deploy تلقائياً،
-- لذا يوجد نفس المنطق في src/lib/db-selfheal.ts (ensurePurchasesSupport)

-- 1) نقاط الولاء على المستخدم — تُمنح لاحقاً عبر إنجاز المهام (تحديث مستقل)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "points" INTEGER NOT NULL DEFAULT 0;

-- 2) جدول المشتريات: مسودة → مرسلة للمراجعة → معتمدة (تُسجل تلقائياً في التكاليف) / مرفوضة
CREATE TABLE IF NOT EXISTS "Purchase" (
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
);

-- 3) الفهارس
CREATE INDEX IF NOT EXISTS "Purchase_userId_idx" ON "Purchase"("userId");
CREATE INDEX IF NOT EXISTS "Purchase_status_idx" ON "Purchase"("status");
CREATE UNIQUE INDEX IF NOT EXISTS "Purchase_costId_key" ON "Purchase"("costId");

-- 4) المفاتيح الأجنبية
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Purchase_userId_fkey') THEN
        ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Purchase_projectId_fkey') THEN
        ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Purchase_reviewedById_fkey') THEN
        ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Purchase_costId_fkey') THEN
        ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_costId_fkey" FOREIGN KEY ("costId") REFERENCES "Cost"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
