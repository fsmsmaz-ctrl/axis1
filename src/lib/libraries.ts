// ─── v97: المكتبات — بوابات الرؤية والإدارة المشتركة بين مسارات الخادم ──────
// قواعد المكتبات في مكان واحد فلا تختلف حكمة المسارات:
//   • v100 — للمكتبة نفسها ثلاث حالات رؤية (visibility):
//       عام  ('public')  → يراها كل الموظفين.
//       خاص  ('private') → صاحبها حصراً — v101: حتى مدير النظام لا يراها ولا يديرها.
//       برابط ('link')   → مخفية عن القوائم كالخاص، وتُفتح لمن يقدم توكن
//         رابطها الصحيح (أو لصاحبها/مدير النظام).
//   • القاعدة الذهبية (v100): رؤية أي قسم أو ملف داخل المكتبة لا تتجاوز
//     رؤية مكتبته أبداً — الأضيق يفوز. قسم «عام» أو «برابط» داخل مكتبة خاصة
//     يُعامَل خاصاً فعلياً مهما كانت بياناته المخزّنة — فلا تسريب بأي سبب.
//   • v101 — قرار صاحب الموقع: «الخاص» يظهر لصاحبه نفسه فقط دون الإدارة:
//       المكتبة الخاصة: تُرى وتُدار بصاحبها حصراً (حتى مدير النظام لا يراها).
//       القسم الخاص فعلياً: يراه ويديره صاحب القسم وصاحب المكتبة حصراً.
//       العام و«برابط» على ما هما عليه — مدير النظام يملك رؤيتهما وإدارتهما كما كان.
//   • إدارة المكتبة غير الخاصة (تعديل/حذف/إنشاء أقسام): صاحب المكتبة ومدير النظام.
//   • إدارة القسم غير الخاص: صاحب القسم وصاحب المكتبة ومدير النظام.
//   • رفع/حذف ملف: صاحب القسم وصاحب المكتبة ومدير النظام (والرفع من الرافع نفسه يحذف ملفه) —
//     وفي الخاص فعلياً: صاحب القسم وصاحب المكتبة حصراً.
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

/**
 * صاحب المكتبة أو مدير النظام — v101 استثناء الخاص:
 * المكتبة الخاصة تُدار بصاحبها حصراً فلا يدير مدير النظام ما لا يراه.
 */
export function canManageLibrary(user: LibraryActor, lib: { ownerId: string; visibility?: string | null }): boolean {
  if (user.id === lib.ownerId) return true
  if (libraryVisibility(lib.visibility) === 'private') return false // v101: الخاصة لصاحبها حصراً
  return isLibraryAdmin(user)
}

/**
 * صاحب القسم أو صاحب المكتبة أو مدير النظام.
 * v101: effectiveMode === 'private' (الخاص الفعلي بعد قيد المكتبة) →
 * صاحب القسم وصاحب المكتبة حصراً — حتى مدير النظام لا يديره.
 */
export function canManageSection(
  user: LibraryActor,
  sectionOwnerId: string,
  libraryOwnerId: string,
  effectiveMode?: LibVisibility
): boolean {
  if (user.id === sectionOwnerId || user.id === libraryOwnerId) return true
  if (effectiveMode === 'private') return false // v101: الخاص الفعلي بلا استثناء للإدارة
  return isLibraryAdmin(user)
}

/**
 * v100: هل يرى هذا المستخدم هذه المكتبة أصلاً (في القوائم أو مباشرة)؟
 * - عامة: الجميع.
 * - خاصة: صاحبها حصراً — v101: حتى مدير النظام لا يراها في القوائم (قرار صاحب الموقع).
 * - برابط: مخفية عن القوائم (token=null هنا) — تُفتح مباشرة بتوكن رابطها.
 */
export function canSeeLibraryInList(user: LibraryActor, lib: { ownerId: string; visibility?: string | null }): boolean {
  if (user.id === lib.ownerId) return true
  var lv = libraryVisibility(lib.visibility)
  if (lv === 'private') return false // v101: الخاصة لصاحبها فقط — بلا أي استثناء
  if (isLibraryAdmin(user)) return true
  return lv === 'public'
}

/** v100: فتح مكتبة برابطها مباشرة — التوكن الصحيح يفتح مكتبة «برابط» فقط */
export function canOpenLibraryByToken(
  user: LibraryActor,
  lib: { ownerId: string; visibility?: string | null; linkToken?: string | null },
  token?: string | null
): boolean {
  var lv = libraryVisibility(lib.visibility)
  // v101: الخاصة تُفتح لصاحبها حصراً — حتى مدير النظام لا يدخلها (قرار صاحب الموقع)
  if (lv === 'private') return user.id === lib.ownerId
  if (isLibraryAdmin(user) || user.id === lib.ownerId) return true
  if (lv === 'public') return true
  if (lv === 'link') return !!lib.linkToken && !!token && String(token) === lib.linkToken
  return false // الخاصة لا تُفتح برابط أبداً — لصاحبها حصراً
}

/**
 * هل يرى هذا المستخدم هذا القسم؟ (v100 — بوابة المكتبة مطبَّقة دائماً)
 * v101 — قرار صاحب الموقع: «الخاص» يظهر لصاحبه نفسه فقط دون الإدارة:
 *   - صاحب القسم وصاحب المكتبة يرون دائماً (هم الأصل).
 *   - الرؤية الفعلية للقسم = الأضيق بين رؤية القسم ورؤية مكتبته.
 *   - عام → الجميع.
 *   - خاص → لا أحد عدا الأصل (حتى مدير النظام لا يراه — هذا التغيير v101).
 *   - برابط → مدير النظام (ليس خاصاً)، أو من قدم توكن القسم/المكتبة الصحيح.
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
  // v100: الرؤية الفعلية = الأضيق بين القسم ومكتبته (القاعدة الذهبية)
  var mode: LibVisibility = sectionModeOf(section)
  if (libraryGate) {
    var libV = libraryVisibility(libraryGate.visibility)
    if (LIB_VIS_ORDER[mode] > LIB_VIS_ORDER[libV]) mode = libV
  }

  // المدرّون المباشرون (صاحب القسم/صاحب المكتبة) يرون دائماً — هم الأصل
  var directManager = user.id === section.ownerId || (!!libraryOwnerId && user.id === libraryOwnerId)
  if (directManager) return true

  // v101: الخاص الفعلي — حتى مدير النظام لا يراه (قرار صاحب الموقع)
  if (mode === 'private') return false

  // الوضع العام: الجميع
  if (mode === 'public') return true

  // وضع «برابط»: مدير النظام يراه (ليس خاصاً)، أو من قدم توكن القسم/المكتبة
  if (isLibraryAdmin(user)) return true
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
