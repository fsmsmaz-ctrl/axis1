// ─── v97: المكتبات — بوابات الرؤية والإدارة المشتركة بين مسارات الخادم ──────
// قواعد المكتبات في مكان واحد فلا تختلف حكمة المسارات:
//   • v100 — للمكتبة نفسها ثلاث حالات رؤية (visibility):
//       عام  ('public')  → يراها كل الموظفين.
//       خاص  ('private') → صاحبها ومدير النظام فقط — لا تظهر لغيرهم إطلاقاً.
//       برابط ('link')   → مخفية عن القوائم كالخاص، وتُفتح لمن يقدم توكن
//         رابطها الصحيح (أو لصاحبها/مدير النظام).
//   • القاعدة الذهبية (v100): رؤية أي قسم أو ملف داخل المكتبة لا تتجاوز
//     رؤية مكتبته أبداً — الأضيق يفوز. قسم «عام» أو «برابط» داخل مكتبة خاصة
//     يُعامَل خاصاً فعلياً مهما كانت بياناته المخزّنة — فلا تسريب بأي سبب.
//   • إدارة المكتبة (تعديل/حذف/إنشاء أقسام): صاحب المكتبة ومدير النظام.
//   • إدارة القسم (تعديل/حذف): صاحب القسم وصاحب المكتبة ومدير النظام.
//   • رفع/حذف ملف: صاحب القسم وصاحب المكتبة ومدير النظام (والرفع من الرافع نفسه يحذف ملفه).
// مدير النظام = العلم من قاعدة البيانات أو البريد الرئيسي (نفس تعريف النظام كله).
import { isSystemAdminAccount } from '@/lib/auth'
import { libraryVisibility, sectionModeOf, LIB_VIS_ORDER, type LibVisibility } from '@/lib/lib-visibility'

export interface LibraryActor {
  id: string
  role?: string
  email?: string
  isSystemAdmin?: boolean
}

/** v100: بوابة المكتبة — ما يحتاجه الحكم من بيانات المكتبة المالكة */
export interface LibraryGate {
  visibility?: string | null
  linkToken?: string | null
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
 * v100: هل يرى هذا المستخدم هذه المكتبة أصلاً (في القوائم أو مباشرة)؟
 * - عامة: الجميع.
 * - خاصة: صاحبها ومدير النظام فقط — مهما كان السبب.
 * - برابط: مخفية عن القوائم (token=null هنا) — تُفتح مباشرة بتوكن رابطها.
 */
export function canSeeLibraryInList(user: LibraryActor, lib: { ownerId: string; visibility?: string | null }): boolean {
  if (isLibraryAdmin(user) || user.id === lib.ownerId) return true
  return libraryVisibility(lib.visibility) === 'public'
}

/** v100: فتح مكتبة برابطها مباشرة — التوكن الصحيح يفتح مكتبة «برابط» فقط */
export function canOpenLibraryByToken(
  user: LibraryActor,
  lib: { ownerId: string; visibility?: string | null; linkToken?: string | null },
  token?: string | null
): boolean {
  if (isLibraryAdmin(user) || user.id === lib.ownerId) return true
  var lv = libraryVisibility(lib.visibility)
  if (lv === 'public') return true
  if (lv === 'link') return !!lib.linkToken && !!token && String(token) === lib.linkToken
  return false // الخاصة لا تُفتح برابط أبداً — لصاحبها والإدارة فقط
}

/**
 * هل يرى هذا المستخدم هذا القسم؟ (v100 — بوابة المكتبة مطبَّقة دائماً)
 * - المدرّون (صاحب القسم/المكتبة/مدير النظام) يرون كل شيء.
 * - ثم تُحسب الرؤية الفعلية للقسم = الأضيق بين رؤية القسم ورؤية مكتبته:
 *     عام → الجميع.
 *     خاص → المدرّون فقط.
 *     برابط → من قدم توكن القسم أو توكن المكتبة (أيهما صحيح).
 * libraryGate اختياري توافقاً مع الاستدعاءات القديمة — والمسارات كلها
 * تمرّره في v100 حتى لا يفلت قسم من قيد مكتبته أبداً.
 */
export function canViewSection(
  user: LibraryActor,
  section: { isPrivate: boolean; ownerId: string; linkToken?: string | null },
  token?: string | null,
  libraryOwnerId?: string,
  libraryGate?: LibraryGate
): boolean {
  // المدرّون أولاً — هم يرون دائماً
  var manager = user.id === section.ownerId || (!!libraryOwnerId && user.id === libraryOwnerId) || isLibraryAdmin(user)
  if (manager) return true

  // v100: الرؤية الفعلية = الأضيق بين القسم ومكتبته (القاعدة الذهبية)
  var mode: LibVisibility = sectionModeOf(section)
  if (libraryGate) {
    var libV = libraryVisibility(libraryGate.visibility)
    if (LIB_VIS_ORDER[mode] > LIB_VIS_ORDER[libV]) mode = libV
  }

  if (mode === 'public') return true
  if (mode === 'private') return false // لغير المدرّين — وفُحصوا أعلاه
  // وضع «برابط»: توكن القسم أو توكن المكتبة — أيهما قُدِّم وصحّ يكفي
  var secTokenOk = !!section.linkToken && !!token && String(token) === section.linkToken
  var libTokenOk = !!libraryGate?.linkToken && !!token && String(token) === libraryGate.linkToken
  return secTokenOk || libTokenOk
}

/**
 * فلترة أقسام مكتبة حسب الرؤية قبل إعادتها للعميل — الخصوصية تُطبَّق خادمياً دائماً.
 * v100: تستلم بوابة المكتبة كاملة (الرؤية + التوكن) فتُطبَّق القاعدة الذهبية —
 * أقسام «برابط» والمكتبات «برابط» تُخفى عن القوائم عدا المدرّين، والدخول
 * إليها يكون بالرابط فقط — لا يمرر هنا توكن أبداً (التوكن مسار الرابط المباشر حصراً).
 */
export function filterVisibleSections<T extends { isPrivate: boolean; ownerId: string; linkToken?: string | null }>(
  user: LibraryActor,
  sections: T[],
  library: { ownerId?: string; visibility?: string | null; linkToken?: string | null }
): T[] {
  return sections.filter((s) =>
    canViewSection(user, s, null, library.ownerId, { visibility: library.visibility, linkToken: library.linkToken })
  )
}
