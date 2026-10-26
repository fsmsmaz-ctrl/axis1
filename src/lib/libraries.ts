// ─── v97: المكتبات — بوابات الرؤية والإدارة المشتركة بين مسارات الخادم ──────
// قواعد المكتبات في مكان واحد فلا تختلف حكمة المسارات:
//   • المكتبة عامة بالاسم والوصف — يراها كل من يرى القسم.
//   • القسم الخاص يراه صاحبه ومدير النظام فقط (لا يظهر له وجود أصلاً عند غيرهما).
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

/** هل يرى هذا المستخدم القسم؟ (القسم الخاص: صاحبه ومدير النظام فقط) */
export function canViewSection(user: LibraryActor, section: { isPrivate: boolean; ownerId: string }): boolean {
  if (!section.isPrivate) return true
  return user.id === section.ownerId || isLibraryAdmin(user)
}

/** فلترة أقسام مكتبة حسب الرؤية قبل إعادتها للعميل — الخصوصية تُطبَّق خادمياً دائماً */
export function filterVisibleSections<T extends { isPrivate: boolean; ownerId: string }>(
  user: LibraryActor,
  sections: T[]
): T[] {
  return sections.filter((s) => canViewSection(user, s))
}
