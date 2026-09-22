-- v32: الفواتير مستقلة عن المشاريع
-- 1) projectId يصبح اختيارياً لتقبل الفواتير المسترجعة «بدون مشروع»
-- 2) حذف المشروع لا يمسح فواتيره بعد الآن (SetNull بدل Cascade)

-- AlterTable
ALTER TABLE "Cost" ALTER COLUMN "projectId" DROP NOT NULL;

-- ForeignKey
ALTER TABLE "Cost" DROP CONSTRAINT IF EXISTS "Cost_projectId_fkey";
ALTER TABLE "Cost" ADD CONSTRAINT "Cost_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
