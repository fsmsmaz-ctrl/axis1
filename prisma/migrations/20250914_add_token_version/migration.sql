-- SECURITY: إضافة إصدار الجلسة (tokenVersion) لموديل User
-- يُرفع عند تغيير كلمة المرور أو تعطيل الحساب لإبطال كل التوكنات القديمة فوراً
ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
