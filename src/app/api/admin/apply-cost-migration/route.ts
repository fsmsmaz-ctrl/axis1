import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { checkRateLimit } from '@/lib/rate-limit'

// v35: تطبيق ترقية v32 يدوياً بنقرة واحدة — بلا انتظار بناء Netlify
// ---------------------------------------------------------------------
// الخلفية: ترقية 20250922_cost_project_nullable (Cost.projectId يصبح اختيارياً + FK يصبح
// ON DELETE SET NULL) لم تُطبق على قاعدة البيانات رغم نشر الكود — فيفشل استرجاع الفواتير
// بلا مشروع ويفشل حفظ أي فاتورة «بدون مشروع».
// هذا المسار ينفذ نفس SQL الترقية مباشرة عبر اتصال التشغيل نفسه (القاعدة الصحيحة قطعاً)،
// وهو آمن وإيقاعي (idempotent):
//   1) DROP NOT NULL — إعادة تنفيذه على عمود اختياري بالفعل لا تفعل شيئاً
//   2) DROP CONSTRAINT IF EXISTS — آمن دائماً
//   3) إضافة FK فقط إن لم يوجد (فحص pg_constraint) — فلا يفشل عند التكرار
// وإذا طبّقها هذا المسار يدوياً فإن بناء Netlify اللاحق سيسجل الترقية في _prisma_migrations
// وينفذها من جديد دون ضرر (SQL قابل لإعادة التنفيذ) ثم يتجاوزها دائماً بعدها.
// POST /api/admin/apply-cost-migration — للإدارة العليا ومدير النظام فقط

var ADD_FK_SQL = 'DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = \'Cost_projectId_fkey\') THEN ALTER TABLE "Cost" ADD CONSTRAINT "Cost_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END $$;'

async function isProjectIdNullable(): Promise<string> {
  var colInfo: any = await db.$queryRaw`SELECT is_nullable FROM information_schema.columns WHERE table_name = 'Cost' AND column_name = 'projectId'`
  return colInfo && colInfo.length > 0 ? String(colInfo[0].is_nullable) : 'UNKNOWN'
}

export async function POST(req: NextRequest) {
  var user = await getAuthUser(req)
  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  var isSystemAdmin = (user.email || '').toLowerCase().trim() === 'admin@axis.om'
  if (user.role !== 'top_management' && !isSystemAdmin) {
    return NextResponse.json({ error: 'forbidden', message: 'تطبيق الترقية متاح للإدارة العليا فقط' }, { status: 403 })
  }

  var rl = checkRateLimit(req, { maxRequests: 3, windowSeconds: 300, keyPrefix: 'apply-cost-migration' })
  if (rl.limited) {
    return NextResponse.json(
      { error: 'too_many_requests', message: 'طلبات كثيرة جداً — حاول بعد قليل' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    )
  }

  try {
    var before = await isProjectIdNullable()
    if (before === 'YES') {
      return NextResponse.json({
        applied: false,
        alreadyApplied: true,
        before: before,
        message: 'الترقية مطبقة أصلاً — عمود Cost.projectId اختياري بالفعل',
      })
    }

    var steps: Array<{ step: string; ok: boolean; error?: string }> = []

    try {
      await db.$executeRawUnsafe('ALTER TABLE "Cost" ALTER COLUMN "projectId" DROP NOT NULL;')
      steps.push({ step: 'DROP NOT NULL', ok: true })
    } catch (e: any) {
      steps.push({ step: 'DROP NOT NULL', ok: false, error: String(e && e.message ? e.message : e) })
    }

    try {
      await db.$executeRawUnsafe('ALTER TABLE "Cost" DROP CONSTRAINT IF EXISTS "Cost_projectId_fkey";')
      steps.push({ step: 'DROP CONSTRAINT IF EXISTS', ok: true })
    } catch (e: any) {
      steps.push({ step: 'DROP CONSTRAINT IF EXISTS', ok: false, error: String(e && e.message ? e.message : e) })
    }

    try {
      await db.$executeRawUnsafe(ADD_FK_SQL)
      steps.push({ step: 'ADD CONSTRAINT SET NULL (إن لم يوجد)', ok: true })
    } catch (e: any) {
      steps.push({ step: 'ADD CONSTRAINT SET NULL (إن لم يوجد)', ok: false, error: String(e && e.message ? e.message : e) })
    }

    var after = await isProjectIdNullable()

    db.auditLog.create({
      data: {
        userId: user.id,
        action: 'update',
        entity: 'cost',
        entityId: 'apply-cost-migration-' + Date.now(),
        details: 'تطبيق ترقية v32 يدوياً (Cost.projectId اختياري + FK SET NULL) — النتيجة: ' + before + ' → ' + after + ' (بواسطة ' + (user.name || user.email) + ')',
      },
    }).catch(function() {})

    var applied = after === 'YES'
    return NextResponse.json({
      applied: applied,
      before: before,
      after: after,
      steps: steps,
      message: applied
        ? 'تم تطبيق الترقية بنجاح — قاعدة البيانات جاهزة الآن للاسترجاع وفواتير «بدون مشروع»'
        : 'لم تكتمل الترقية — راجع خطوات التنفيذ في الاستجابة (قد تكون صلاحيات مستخدم قاعدة البيانات غير كافية)',
    })
  } catch (error: any) {
    console.error('[apply-cost-migration] failed:', error)
    return NextResponse.json(
      { error: 'apply_migration_failed', message: 'فشل تطبيق الترقية — راجع سجلات الخادم' },
      { status: 500 }
    )
  }
}
