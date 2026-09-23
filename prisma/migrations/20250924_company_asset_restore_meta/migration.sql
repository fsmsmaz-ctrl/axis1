-- v43: حقول الاستعادة للأصول — الأصل المستعاد يحتفظ بتاريخ تسجيله الأصلي واسم منشئه الأصلي،
-- وتُسجَّل بيانات من أجرى الاستعادة في حقول منفصلة (restoredBy/restoredAt) لا تحل محل الأصل.
-- الرقعة idempotent: الأعمدة والقيد تُضاف فقط إن لم تكن موجودة.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'CompanyAsset' AND column_name = 'restoredById'
  ) THEN
    ALTER TABLE "CompanyAsset" ADD COLUMN "restoredById" TEXT;
    ALTER TABLE "CompanyAsset" ADD COLUMN "restoredAt" TIMESTAMP(3);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"CompanyAsset"'::regclass
      AND conname = 'CompanyAsset_restoredById_fkey'
  ) THEN
    ALTER TABLE "CompanyAsset" ADD CONSTRAINT "CompanyAsset_restoredById_fkey" FOREIGN KEY ("restoredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;
