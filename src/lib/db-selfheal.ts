// v42: شفاء ذاتي لقيد أصول الشركة في قاعدة البيانات
// قبل v42 كان القيد ON DELETE CASCADE — حذف أي مشروع كان يمسح أصوله (ملك/مستأجر/معار) نهائياً.
// v42 يحوّل القيد إلى ON DELETE SET NULL (نمط v32 للفواتير): الأصول تنجو «بدون مشروع»
// ويمكن إسنادها لمشروع آخر من صفحة المعدات.
// الدالة تعمل مرة واحدة لكل عملية تشغيل (serverless instance) وهي آمنة تماماً (idempotent):
// - إن كان القيد فعلاً SET NULL فلا يُنفَّذ أي DDL
// - أي فشل يُسجَّل في السجل ولا يعطّل الطلب الأصلي

import bcrypt from 'bcryptjs'
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
    // v50: ضمان عمود الصورة أيضاً — findUnique في مسار الدخول يقرأ كل أعمدة النموذج،
    // وأي عمود ناقص يعطّل تسجيل الدخول بالكامل بـ P2022
    var hasAvatar = userCols.some(function(c) { return c.column_name === 'avatar' })
    if (!hasAvatar) {
      await db.$executeRawUnsafe('ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "avatar" TEXT')
      console.warn('v50: User.avatar column created by self-heal')
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


// v52: حساب الزائر — يُنشأ تلقائياً مرة واحدة (نمط الشفاء الذاتي، مثل حساب الأدمن):
// زائر / visitor@axis.om بدور visitor — قراءة فقط لخطوط الحفر وبلا أي أسعار.
// لا يُعاد تفعيله إن عطّله المدير (الإنشاء فقط عند عدم الوجود) وكلمة المرور
// قابلة للتغيير من إدارة المستخدمين كأي مستخدم (مع إبطال الجلسات القديمة).
var v52VisitorChecked = false

export async function ensureVisitorAccount(): Promise<void> {
  if (v52VisitorChecked) return
  v52VisitorChecked = true
  try {
    var existing = await db.user.findUnique({ where: { email: 'visitor@axis.om' }, select: { id: true } })
    if (existing) return
    var passwordHash = await bcrypt.hash('visitor123', 12)
    await db.user.create({
      data: {
        email: 'visitor@axis.om',
        password: passwordHash,
        name: 'زائر',
        nameEn: 'Visitor',
        role: 'visitor',
        language: 'ar',
        active: true,
      },
    })
    console.warn('v52: visitor account created (visitor@axis.om) — read-only drive_lines, no pricing')
  } catch (e) {
    console.error('v52: visitor account seed skipped:', e)
  }
}


// v53 (مُحصَّن في v54): الموارد البشرية — أعمدة الملف الوظيفي على User + جداول الإجازات
// درس v53 الإنتاجي: نحو 35 أمر DDL عبر الاتصال المجمّع قد يتجاوز مهلة دالة Netlify (10 ثوانٍ)
// أو يفشل أحدها فيبقى قسم الملف الوظيفي والإجازات عالقاً على التحميل مع عمل بقية الأقسام.
// المنهج المُحصَّن:
//   • فحص سريع بأمرين فقط — إن اكتمل كل شيء يُثبَّت العلم وينتهي فوراً (مسار سريع دائم)
//   • أعمدة User في أمر ALTER مجمّع واحد (دورة شبكة واحدة بدل 18)
//   • عزل كل جدول في try/catch مستقل — فشل بند لا يوقف البقية (تقارب تدريجي حتى الاكتمال)
var v53HRChecked = false

export async function ensureHRSupport(): Promise<void> {
  if (v53HRChecked) return
  try {
    // فحص موحّد سريع: أعمدة User + جداول HR في أمرين فقط
    var userCols = await db.$queryRawUnsafe<Array<{ column_name: string }>>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name = 'User'"
    )
    var colSet = new Set<string>((userCols || []).map(function(c) { return c.column_name }))
    var hrTables = await db.$queryRawUnsafe<Array<{ table_name: string }>>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('LeaveRequest','LeaveBalance','Holiday','LeavePolicy','LeaveAdjustment')"
    )
    var tableSet = new Set<string>((hrTables || []).map(function(t) { return t.table_name }))

    var colDefs: Record<string, string> = {
      employeeNo: 'TEXT', jobTitle: 'TEXT', department: 'TEXT', workLocation: 'TEXT',
      supervisorId: 'TEXT', joinDate: 'TIMESTAMP(3)', contractStart: 'TIMESTAMP(3)', contractEnd: 'TIMESTAMP(3)',
      baseSalary: 'DOUBLE PRECISION', allowances: 'DOUBLE PRECISION',
      passportNo: 'TEXT', passportExpiry: 'TIMESTAMP(3)', idNo: 'TEXT', idExpiry: 'TIMESTAMP(3)',
      residenceNo: 'TEXT', residenceExpiry: 'TIMESTAMP(3)',
      absenceDays: 'DOUBLE PRECISION NOT NULL DEFAULT 0', lateDays: 'DOUBLE PRECISION NOT NULL DEFAULT 0',
    }
    var needCols = Object.keys(colDefs).filter(function(c) { return !colSet.has(c) })
    var needTables = ['LeaveRequest', 'LeaveBalance', 'Holiday', 'LeavePolicy', 'LeaveAdjustment']
      .filter(function(t) { return !tableSet.has(t) })

    // المسار السريع: كل شيء موجود — ثبّت العلم وارجع فوراً
    if (needCols.length === 0 && needTables.length === 0) {
      v53HRChecked = true
      return
    }

    // 1) كل أعمدة الملف الوظيفي في أمر ALTER واحد
    if (needCols.length > 0) {
      var parts = needCols.map(function(c) { return 'ADD COLUMN IF NOT EXISTS "' + c + '" ' + colDefs[c] })
      await db.$executeRawUnsafe('ALTER TABLE "User" ' + parts.join(', '))
      console.warn('v53: User HR-file columns created by self-heal: ' + needCols.join(','))
    }
    // علاقة المسؤول المباشر — معزولة تماماً: فشلها لا يوقف الشفاء (بريزما لا يشترط قيود FK فعلية)
    try {
      await db.$executeRawUnsafe('ALTER TABLE "User" ADD CONSTRAINT "User_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE')
    } catch (fkErr) {
      var fkMsg = (fkErr as { message?: string })?.message || ''
      if (fkMsg.indexOf('already exists') === -1) console.error('v53: supervisor FK skipped:', fkErr)
    }

    // 2) جداول الموارد البشرية — كل جدول معزول عن الآخر
    if (!tableSet.has('LeaveRequest')) {
      try {
        await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "LeaveRequest" (
  "id" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "startDate" TIMESTAMP(3) NOT NULL,
  "endDate" TIMESTAMP(3) NOT NULL,
  "days" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "reason" TEXT,
  "attachmentName" TEXT,
  "attachmentData" TEXT,
  "substituteName" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "reviewedById" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "reviewNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
)`)
        await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "LeaveRequest_employeeId_status_idx" ON "LeaveRequest"("employeeId", "status")')
        await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "LeaveRequest_status_createdAt_idx" ON "LeaveRequest"("status", "createdAt")')
        try {
          await db.$executeRawUnsafe('ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE')
          await db.$executeRawUnsafe('ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE')
        } catch (fkE) {
          var m1 = (fkE as { message?: string })?.message || ''
          if (m1.indexOf('already exists') === -1) console.error('v53: LeaveRequest FK skipped:', fkE)
        }
        console.warn('v53: LeaveRequest table created by self-heal')
      } catch (e) { console.error('v53: LeaveRequest self-heal skipped:', e) }
    }

    if (!tableSet.has('LeaveBalance')) {
      try {
        await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "LeaveBalance" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "annualTotal" DOUBLE PRECISION NOT NULL DEFAULT 30,
  "carriedOver" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "used" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LeaveBalance_pkey" PRIMARY KEY ("id")
)`)
        await db.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS "LeaveBalance_userId_key" ON "LeaveBalance"("userId")')
        try {
          await db.$executeRawUnsafe('ALTER TABLE "LeaveBalance" ADD CONSTRAINT "LeaveBalance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE')
        } catch (fkE) {
          var m2 = (fkE as { message?: string })?.message || ''
          if (m2.indexOf('already exists') === -1) console.error('v53: LeaveBalance FK skipped:', fkE)
        }
        console.warn('v53: LeaveBalance table created by self-heal')
      } catch (e) { console.error('v53: LeaveBalance self-heal skipped:', e) }
    }

    if (!tableSet.has('Holiday')) {
      try {
        await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "Holiday" (
  "id" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "name" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
)`)
        await db.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS "Holiday_date_key" ON "Holiday"("date")')
        console.warn('v53: Holiday table created by self-heal')
      } catch (e) { console.error('v53: Holiday self-heal skipped:', e) }
    }

    if (!tableSet.has('LeavePolicy')) {
      try {
        await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "LeavePolicy" (
  "id" TEXT NOT NULL,
  "singleton" TEXT NOT NULL DEFAULT 'default',
  "weekendDays" TEXT NOT NULL DEFAULT '5,6',
  "defaultAnnualDays" DOUBLE PRECISION NOT NULL DEFAULT 30,
  "sickAttachRequired" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeavePolicy_pkey" PRIMARY KEY ("id")
)`)
        await db.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS "LeavePolicy_singleton_key" ON "LeavePolicy"("singleton")')
        // الصف الوحيد الافتراضي: نهاية الأسبوع الجمعة والسبت (5,6) و30 يوماً سنوياً
        await db.$executeRawUnsafe(`INSERT INTO "LeavePolicy" ("id", "singleton", "weekendDays", "defaultAnnualDays", "sickAttachRequired", "createdAt")
SELECT md5(random()::text || clock_timestamp()::text), 'default', '5,6', 30, true, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "LeavePolicy")`)
        console.warn('v53: LeavePolicy table + default row created by self-heal')
      } catch (e) { console.error('v53: LeavePolicy self-heal skipped:', e) }
    }

    if (!tableSet.has('LeaveAdjustment')) {
      try {
        await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "LeaveAdjustment" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "delta" DOUBLE PRECISION NOT NULL,
  "reason" TEXT NOT NULL,
  "byId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeaveAdjustment_pkey" PRIMARY KEY ("id")
)`)
        await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "LeaveAdjustment_userId_createdAt_idx" ON "LeaveAdjustment"("userId", "createdAt")')
        try {
          await db.$executeRawUnsafe('ALTER TABLE "LeaveAdjustment" ADD CONSTRAINT "LeaveAdjustment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE')
          await db.$executeRawUnsafe('ALTER TABLE "LeaveAdjustment" ADD CONSTRAINT "LeaveAdjustment_byId_fkey" FOREIGN KEY ("byId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE')
        } catch (fkE) {
          var m3 = (fkE as { message?: string })?.message || ''
          if (m3.indexOf('already exists') === -1) console.error('v53: LeaveAdjustment FK skipped:', fkE)
        }
        console.warn('v53: LeaveAdjustment table created by self-heal')
      } catch (e) { console.error('v53: LeaveAdjustment self-heal skipped:', e) }
    }

    // إعادة الفحص: يُثبَّت العلم فقط عند اكتمال كل شيء (الفشل الجزئي يعيد المحاولة لاحقاً)
    var reTables = await db.$queryRawUnsafe<Array<{ table_name: string }>>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('LeaveRequest','LeaveBalance','Holiday','LeavePolicy','LeaveAdjustment')"
    )
    if ((reTables || []).length >= 5) v53HRChecked = true
  } catch (e) {
    // لا نُثبّت العلم عند الفشل — تُعاد المحاولة في الطلب التالي (أعمدة User حرجة للدخول)
    console.error('v53 HR self-heal skipped (will retry):', e)
  }
}


// v57: شفاء ذاتي لقسم السلامة — عمود DailyReport.safetyLocked وجدول SafetyReport
// أُضيف بعد أن بقي عمود safetyLocked خارج ملفات الـ migrations كلها (آخر migration
// هو 20250926_profile_purchases ولا يذكره) — وأي نقص يظهر عند الحفظ كـ P2022
// «قاعدة البيانات غير مهيأة». الدالة آمنة تماماً (idempotent) وتعمل مرة واحدة لكل تشغيل.
var v57SafetyChecked = false

export async function ensureDailyReportSafety(): Promise<void> {
  if (v57SafetyChecked) return
  try {
    var cols = await db.$queryRawUnsafe<Array<{ column_name: string }>>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name = 'DailyReport'"
    )
    var colSet = new Set<string>((cols || []).map(function(c) { return c.column_name }))
    if (!colSet.has('safetyLocked')) {
      await db.$executeRawUnsafe('ALTER TABLE "DailyReport" ADD COLUMN IF NOT EXISTS "safetyLocked" BOOLEAN NOT NULL DEFAULT false')
      console.warn('v57: DailyReport.safetyLocked column created by self-heal')
    }
    var tables = await db.$queryRawUnsafe<Array<{ table_name: string }>>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'SafetyReport'"
    )
    if ((tables || []).length === 0) {
      // جدول السلامة مفقود كلياً (قاعدة معاد تهيئتها) — إنشاؤه بكل أعمدته
      await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "SafetyReport" (
  "id" TEXT NOT NULL,
  "dailyReportId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "reportDate" TIMESTAMP(3) NOT NULL,
  "ppeAvailable" BOOLEAN NOT NULL DEFAULT false,
  "helmetCheck" BOOLEAN NOT NULL DEFAULT false,
  "bootsCheck" BOOLEAN NOT NULL DEFAULT false,
  "glovesCheck" BOOLEAN NOT NULL DEFAULT false,
  "glassesCheck" BOOLEAN NOT NULL DEFAULT false,
  "workAreaCheck" BOOLEAN NOT NULL DEFAULT false,
  "barriersCheck" BOOLEAN NOT NULL DEFAULT false,
  "shaftCheck" BOOLEAN NOT NULL DEFAULT false,
  "ventilationCheck" BOOLEAN NOT NULL DEFAULT false,
  "electricalCheck" BOOLEAN NOT NULL DEFAULT false,
  "craneCheck" BOOLEAN NOT NULL DEFAULT false,
  "hydraulicCheck" BOOLEAN NOT NULL DEFAULT false,
  "fireExtinguishers" BOOLEAN NOT NULL DEFAULT false,
  "workPermit" BOOLEAN NOT NULL DEFAULT false,
  "toolboxTalk" BOOLEAN NOT NULL DEFAULT false,
  "hazards" TEXT,
  "observations" TEXT,
  "violations" TEXT,
  "incidentType" TEXT,
  "incidentDescription" TEXT,
  "signedBy" TEXT,
  "signedById" TEXT,
  "signedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SafetyReport_pkey" PRIMARY KEY ("id")
)`)
      await db.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS "SafetyReport_dailyReportId_key" ON "SafetyReport"("dailyReportId")')
      try {
        await db.$executeRawUnsafe('ALTER TABLE "SafetyReport" ADD CONSTRAINT "SafetyReport_dailyReportId_fkey" FOREIGN KEY ("dailyReportId") REFERENCES "DailyReport"("id") ON DELETE CASCADE ON UPDATE CASCADE')
        await db.$executeRawUnsafe('ALTER TABLE "SafetyReport" ADD CONSTRAINT "SafetyReport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE')
        await db.$executeRawUnsafe('ALTER TABLE "SafetyReport" ADD CONSTRAINT "SafetyReport_signedById_fkey" FOREIGN KEY ("signedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE')
      } catch (fkE) {
        var fkMsg = (fkE as { message?: string })?.message || ''
        if (fkMsg.indexOf('already exists') === -1) console.error('v57: SafetyReport FK skipped:', fkE)
      }
      console.warn('v57: SafetyReport table created by self-heal')
    }
    v57SafetyChecked = true
  } catch (e) {
    // لا نُثبّت العلم عند الفشل — تُعاد المحاولة في الطلب التالي
    console.error('v57 safety self-heal skipped (will retry):', e)
  }
}
