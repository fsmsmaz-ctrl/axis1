// ─────────────────────────────────────────────────────────────────────────────
// v96 — طبقة النطاق (Domain Layer) — قواعد العمل النقية
// ─────────────────────────────────────────────────────────────────────────────
// قوانين هذه الطبقة (Clean Architecture — تنظيم تدريجي آمن):
//   • منطق عمل نقي فقط: دوال وقواعد تُختبر بذاتها ولا تعرف شيئاً عن
//     React أو fetch أو قاعدة البيانات أو الكوكيز.
//   • تُستورد من طبقات أعلى (المكونات، مسارات API) ولا تستورد منها أبداً.
//   • لا ملفات عرض (UI) هنا ولا نداءات شبكة — لذلك لا 'use client' ولا 'use server'.
//   • نواة قواعد العمل المشتركة (الصلاحيات والأدوار) تعيش في src/lib/auth.ts
//     وهي نقية أصلاً وتُقرأ من الخادم والواجهة معاً — بقيَت بمكانها حفاظاً على
//     مسارات الاستيراد القائمة، وهذه الوحدة امتداد لها وليست بديلاً عنها.
//
// سجل النقل: الدوال الثلاث أدناه كانت تعيش داخل app-shell.tsx منذ البداية
// ونُقلت هنا حرفياً في v96 (نفس المنطق بايت ببايت) لتفصل قواعد العمل عن العرض —
// لا تغيير في السلوك إطلاقاً.
// ─────────────────────────────────────────────────────────────────────────────

import {
  ROLE_PERMISSIONS,
  MODULE_PERMISSIONS,
  REPORT_PERMISSIONS,
  HR_MANAGE_ROLES,
  HR_MANAGE_PERMISSION_KEY,
  normalizeRole,
} from '@/lib/auth'

/**
 * افتراضات صلاحيات الدور: يبني خريطة (صلاحية → مسموح/ممنوع) لكل مفاتيح
 * الأقسام وتقاريرها ومفتاح إدارة الموظفين، انطلاقاً من دور المستخدم.
 * - الدور ذو الصلاحية الشاملة ('*') يُفعّل كل شيء.
 * - صلاحيات التقارير: كل الأدوار تراها افتراضياً (منذ البداية).
 * - v67: مفتاح تعديل بيانات الموظفين يتبع افتراض الدور
 *   (الإدارة العليا + مدير المشروع) ويُتَجاوز فردياً لكل مستخدم.
 */
export function getRoleDefaults(role: string): Record<string, boolean> {
  const defs: Record<string, boolean> = {}
  // صلاحيات الأقسام من الدور
  const rolePerms = ROLE_PERMISSIONS[normalizeRole(role)] || []
  const hasAll = rolePerms.includes('*')
  for (const key of MODULE_PERMISSIONS) {
    defs[key] = hasAll || rolePerms.includes(key)
  }
  // صلاحيات التقارير: كل الأدوار ترى التقارير افتراضياً
  for (const key of REPORT_PERMISSIONS) {
    defs[key] = hasAll || rolePerms.includes('reports')
  }
  // v67: صلاحية تعديل بيانات الموظفين — افتراض الدور (الإدارة العليا + مدير المشروع)
  // ومدير النظام يسمح ويمنع لكل مستخدم على حدة عبر التجاوز اليدوي
  defs[HR_MANAGE_PERMISSION_KEY] = hasAll || (HR_MANAGE_ROLES as readonly string[]).includes(normalizeRole(role))
  return defs
}

/**
 * الصلاحية الفعلية: التجاوز الفردي (إن وُجد) يتقدم على افتراض الدور —
 * نفس ترتيب الفحص الذي تطبقه بوابة الخادم في auth.ts.
 */
export function getEffective(key: string, role: string, customPerms: Record<string, boolean>): boolean {
  if (typeof customPerms[key] === 'boolean') return customPerms[key]
  return getRoleDefaults(role)[key] ?? false
}

/**
 * تبديل صلاحية في نموذج إدارة المستخدمين: العودة إلى قيمة الدور الافتراضية
 * تُلغي التجاوز بدل تخزينه (خريطة نظيفة تحفظ الفروق الجوهرية فقط).
 */
export function togglePerm(key: string, role: string, current: Record<string, boolean>): Record<string, boolean> {
  const defaults = getRoleDefaults(role)
  const currentVal = getEffective(key, role, current)
  const newVal = !currentVal
  // العودة إلى القيمة الافتراضية تحذف التجاوز (أنظف)
  if (newVal === defaults[key]) {
    const next = { ...current }
    delete next[key]
    return next
  }
  return { ...current, [key]: newVal }
}
