// ─── v97: المكتبات — بوابات الرؤية والإدارة المشتركة بين مسارات الخادم ──────
// قواعد المكتبات في مكان واحد فلا تختلف حكمة المسارات:
//   • المكتبة عامة بالاسم والوصف — يراها كل من يرى القسم.
//   • v98 — ثلاث حالات رؤية للقسم:
//       عام  (isPrivate=false وبدون linkToken) → يراه جميع الموظفين.
//       خاص  (isPrivate=true  وبدون linkToken) → صاحبه ومدير النظام فقط.
//       برابط (linkToken موجود) → مخفي عن القوائم كالخاص تماماً، ويُفتح فقط
//         لمن يقدم التوكن الصحيح مع الطلب (أو لصاحبه/صاحب المكتبة/مدير النظام).
//   • إدارة المكتبة (تعديل/حذف/إنشاء أقسام): صاحب المكتبة ومدير النظام.
//   • إدارة القسم (تعديل/حذف): صاحب القسم وصاحب المكتبة ومدير النظام.
//   • رفع/حذف ملف: صاحب القسم وصاحب المكتبة ومدير النظام (والرفع من الرافع نفسه يحذف ملفه).
// مدير النظام = العلم من قاعدة البيانات أو البريد الرئيسي (نفس تعريف النظام كله).
import { isSystemAdminAccount } from '@/lib/auth'

export interface LibraryActor {
  id: string
  role?: string
  email?: string
  isSystemAdmin?: boolean
}

export function isLibraryAdmin(user: LibraryActor | null | undefined): boolean {
  return !!user && isSystemAdminAccount(user)
}

/** صاحب المكتبة أو مدير النظام */
export function canManageLibrary(user: LibraryActor, ownerId: string): boolean {
  return user.id === ownerId || isLibraryAdmin(user)
}

/** صاحب القسم أو صاحب المكتبة أو مدير النظام */
export function canManageSection(user: LibraryActor, sectionOwnerId: string, libraryOwnerId: string): boolean {
  return user.id === sectionOwnerId || user.id === libraryOwnerId || isLibraryAdmin(user)
}

/**
 * v98: هل يرى هذا المستخدم هذا القسم؟
 * - عام: الجميع.
 * - خاص: صاحبه ومدير النظام فقط.
 * - برابط: المدرّون دائماً، أو أي موظف قدم التوكن الصحيح مع الطلب.
 * libraryOwnerId اختياري — يُمرَّر كلما توفر (المسارات تحمله أصلاً) ليُعرف
 * صاحب المكتبة بدقة؛ وحين يغيب يُكتفى بمالك القسم ومدير النظام.
 */
export function canViewSection(
  user: LibraryActor,
  section: { isPrivate: boolean; ownerId: string; linkToken?: string | null },
  token?: string | null,
  libraryOwnerId?: string
): boolean {
  // v98: وضع «برابط» — التوكن يفصل الحكم عن القوائم كلياً
  if (section.linkToken) {
    if (token && String(token) === section.linkToken) return true
    if (libraryOwnerId && user.id === libraryOwnerId) return true
    return user.id === section.ownerId || isLibraryAdmin(user)
  }
  if (!section.isPrivate) return true
  return user.id === section.ownerId || isLibraryAdmin(user)
}

/**
 * فلترة أقسام مكتبة حسب الرؤية قبل إعادتها للعميل — الخصوصية تُطبَّق خادمياً دائماً.
 * v98: أقسام «برابط» تُخفى من القوائم عن الجميع عدا المدرّين — الدخول إليها
 * يكون بالرابط فقط، فلا يمرر هنا توكن أبداً (التوكن مسار الرابط المباشر حصراً).
 */
export function filterVisibleSections<T extends { isPrivate: boolean; ownerId: string; linkToken?: string | null }>(
  user: LibraryActor,
  sections: T[],
  libraryOwnerId?: string
): T[] {
  return sections.filter((s) => canViewSection(user, s, null, libraryOwnerId))
}
