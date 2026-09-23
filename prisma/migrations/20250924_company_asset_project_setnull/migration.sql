-- v42: أصول الشركة تنجو من حذف المشروع (نمط v32 للفواتير) — SetNull بدل Cascade
-- قبل v42: حذف أي مشروع كان يمسح أصوله (ملك/مستأجر/معار) نهائياً من قاعدة البيانات.
-- بعد v42: الأصول تنجو بقاعدة البيانات «بدون مشروع» ويمكن إسنادها لمشروع آخر من صفحة المعدات.
-- الرقعة idempotent: إن كان القيد فعلأ SET NULL لا يُنفَّذ أي تغيير.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"CompanyAsset"'::regclass
      AND conname = 'CompanyAsset_projectId_fkey'
      AND confdeltype = 'n'
  ) THEN
    ALTER TABLE "CompanyAsset" DROP CONSTRAINT IF EXISTS "CompanyAsset_projectId_fkey";
    ALTER TABLE "CompanyAsset" ADD CONSTRAINT "CompanyAsset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;
