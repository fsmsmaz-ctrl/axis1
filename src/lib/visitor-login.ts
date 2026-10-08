// ============================================================
// v78: متابعة دخول الزائر — أدوات التسجيل والكشف (خادم فقط)
// Visitor login monitoring for the visitor account (role = visitor).
// الفكرة: كل دخول ناجح بحساب دوره «زائر» يُسجَّل بتاريخه ووقته ونوع
// الجهاز (من User-Agent) — ليقرأه قسم «دخول الزائر» في الرقابة العملية.
// لا يُسجَّل أي حساب آخر — الحصر لدور الزائر شرط صريح من صاحب الموقع.
// ============================================================

import { db } from '@/lib/db'
import { normalizeRole } from '@/lib/auth'

export type DeviceType = 'mobile' | 'tablet' | 'desktop'

// كشف نوع الجهاز من نص User-Agent — تغطية الحالات الشائعة:
//   iPad / تابلت أندرويد بلا كلمة mobile / iPadOS 13+ (يقدّم نفسه كـ Mac مع لمس)
export function detectDeviceType(uaRaw: string): DeviceType {
  var u = String(uaRaw || '').toLowerCase()
  if (!u) return 'desktop'
  if (/ipad|tablet|playbook|silk|kindle/.test(u)) return 'tablet'
  // iPadOS 13+ يرسل UA كـ Macintosh مع وجود دعم اللمس
  if (/macintosh/.test(u) && /touch/.test(u)) return 'tablet'
  if (/android/.test(u)) return /mobile/.test(u) ? 'mobile' : 'tablet'
  if (/mobi|iphone|ipod|windows phone/.test(u)) return 'mobile'
  return 'desktop'
}

export var DEVICE_LABELS: Record<DeviceType, { ar: string; en: string }> = {
  mobile: { ar: 'هاتف', en: 'Mobile' },
  tablet: { ar: 'تابلت', en: 'Tablet' },
  desktop: { ar: 'كمبيوتر', en: 'Desktop' },
}

// ─── الشفاء الذاتي: إنشاء جدول VisitorLogin (نمط v75 مع EquipmentLog) ──
// العلم على مستوى الوحدة: نجاح واحد يثبّته والمسار يصبح فورياً دائماً؛
// الفشل لا يثبّت العلم فيُعاد الفحص في الطلب التالي.
var v78VisitorLoginChecked = false

export async function ensureVisitorLoginSupport(): Promise<void> {
  if (v78VisitorLoginChecked) return
  try {
    await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "VisitorLogin" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "email" TEXT,
  "device" TEXT NOT NULL DEFAULT 'desktop',
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VisitorLogin_pkey" PRIMARY KEY ("id")
)`)
    await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "VisitorLogin_createdAt_idx" ON "VisitorLogin"("createdAt")')
    v78VisitorLoginChecked = true
  } catch (e) {
    console.error('v78: visitor login self-heal skipped (will retry):', e)
  }
}

// ─── تسجيل دخول ناجح لحساب الزائر فقط ─────────────────────────────
// يُستدعى من مسار الدخول بإطلاق غير حاجب (fire-and-forget) — أي فشل
// هنا لا يجب أن يعطل تسجيل الدخول أو يبطئه أبداً. الحصر بدور visitor:
// حساب الزائر الوحيد حالياً (visitor@axis.om) وأي حساب زائر مستقبلي.
export async function recordVisitorLogin(
  user: { id?: string; email?: string; role?: string },
  userAgent: string
): Promise<void> {
  try {
    if (normalizeRole(user.role || '') !== 'visitor') return
    await ensureVisitorLoginSupport()
    await db.visitorLogin.create({
      data: {
        userId: user.id || null,
        email: String(user.email || '').toLowerCase().trim() || null,
        device: detectDeviceType(userAgent),
        userAgent: String(userAgent || '').slice(0, 250) || null,
      },
    })
  } catch (e) {
    console.error('v78: visitor login record failed (non-blocking):', e)
  }
}
