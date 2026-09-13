-- v14 SECURITY: tokenVersion لإبطال الجلسات عند تغيير كلمة المرور أو التعطيل
-- v14.1: IF NOT EXISTS — آمن حتى لو أُضيف العمود يدوياً مسبقاً (SQL مباشر)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "tokenVersion" INTEGER NOT NULL DEFAULT 0;
