-- v15 SECURITY: علم مدير النظام في قاعدة البيانات
-- الحماية لم تعد تعتمد على مطابقة الإيميل في الكود — بل على علم مباشر في السجل.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isSystemAdmin" BOOLEAN NOT NULL DEFAULT false;

-- رفع العلم لحساب مدير النظام مهما اختلفت حالة الأحرف أو وجود فراغات في البريد
UPDATE "User" SET "isSystemAdmin" = true WHERE LOWER(TRIM(email)) LIKE '%admin@axis.om%';
