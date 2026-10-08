// Shared auth types and constants - safe for both client and server

export interface SessionUser {
  id: string
  email: string
  name: string
  nameEn?: string | null
  role: string
  phone?: string | null
  language: string
  permissions?: Record<string, boolean> | null
  tokenVersion?: number
  // v15: علم مدير النظام من قاعدة البيانات (يُقرأ في كل طلب — لا يعتمد على التوكن)
  isSystemAdmin?: boolean
  // v48: صورة الملف الشخصي (data URL) — الشريط الجانبي وصفحة الملف الشخصي
  avatar?: string | null
}

export const SESSION_COOKIE = 'axis_session'
// Session cookie — expires when browser closes (no maxAge)
const SESSION_MAX_AGE = 24 * 60 * 60 // 24 hours (JWT safety net only)

export function getSessionMaxAge(): number {
  return SESSION_MAX_AGE
}

// Session cookie — NO maxAge = deleted when browser closes
export function getCookieOptions() {
  const isProduction = process.env.NODE_ENV === 'production'
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict' as const,
    path: '/',
  }
}

export const MODULE_PERMISSIONS = [
  'projects', 'drive_lines', 'daily_reports', 'safety', 'equipment', 'costs', 'finishings', 'tasks', 'performance', 'notifications', 'oversight',
  // v62: حُذفت صلاحيتا «ملفي الوظيفي» و«الإجازات» مع القسمين — بيانات الموظف ورصيده في الملف الشخصي فقط
] as const

export const MODULE_PERMISSION_LABELS: Record<string, { ar: string; en: string }> = {
  projects:       { ar: 'المشاريع',          en: 'Projects' },
  drive_lines:    { ar: 'خطوط الحفر',       en: 'Drive Lines' },
  daily_reports:  { ar: 'التقارير اليومية',  en: 'Daily Reports' },
  safety:         { ar: 'السلامة',           en: 'Safety' },
  equipment:      { ar: 'المعدات',           en: 'Equipment' },
  costs:          { ar: 'التكاليف والإيرادات', en: 'Costs & Revenue' },
  finishings:     { ar: 'التشطيبات',         en: 'Finishings' },
  tasks:          { ar: 'إدارة المهام',      en: 'Task Management' },
  performance:    { ar: 'تقييم الأداء',      en: 'Performance' },
  notifications:  { ar: 'التنبيهات وسجل المراقبة', en: 'Notifications & Monitor' },
  oversight:      { ar: 'الرقابة العملية',   en: 'Operational Control' },
}

export const REPORT_PERMISSIONS = [
  'rpt_daily_site', 'rpt_production', 'rpt_safety', 'rpt_attendance',
  'rpt_revenue', 'rpt_costs', 'rpt_profit', 'rpt_equipment',
  'rpt_weekly', 'rpt_monthly', 'rpt_handover',
] as const

export const REPORT_LABELS: Record<string, { ar: string; en: string }> = {
  rpt_daily_site:  { ar: 'تقرير الموقع اليومي', en: 'Daily Site Report' },
  rpt_production:  { ar: 'تقرير الإنتاج',        en: 'Production Report' },
  rpt_safety:      { ar: 'تقرير السلامة',        en: 'Safety Report' },
  rpt_attendance:  { ar: 'تقرير الحضور',         en: 'Attendance Report' },
  rpt_revenue:     { ar: 'تقرير الإيرادات',      en: 'Revenue Report' },
  rpt_costs:       { ar: 'تقرير التكاليف',       en: 'Costs Report' },
  rpt_profit:      { ar: 'تقرير الأرباح',        en: 'Profit Report' },
  rpt_equipment:   { ar: 'تقرير المعدات',        en: 'Equipment Report' },
  rpt_weekly:      { ar: 'التقرير الأسبوعي',     en: 'Weekly Report' },
  rpt_monthly:     { ar: 'التقرير الشهري',       en: 'Monthly Report' },
  rpt_handover:    { ar: 'تقرير التسليم',        en: 'Handover Report' },
}

export const TOGGLABLE_PERMISSIONS = [
  ...MODULE_PERMISSIONS,
  ...REPORT_PERMISSIONS,
] as const

export type TogglablePermission = typeof TOGGLABLE_PERMISSIONS[number]

export const TOGGLABLE_PERMISSION_LABELS: Record<string, { ar: string; en: string }> = {
  ...MODULE_PERMISSION_LABELS,
  ...REPORT_LABELS,
}

// NOTE: 'dashboard' is intentionally NOT granted to employee roles.
// لوحة التحكم متاحة فقط لمدير النظام وحسابات الإدارة العليا (top_management '*').
export const ROLE_PERMISSIONS: Record<string, string[]> = {
  top_management: ['*'],
  project_manager: [
    'projects', 'drive_lines', 'daily_reports', 'safety',
    'equipment', 'costs', 'finishings', 'tasks', 'reports', 'performance', 'notifications', 'oversight',
  ],
  site_engineer: [
    'projects', 'drive_lines', 'daily_reports', 'safety',
    'equipment', 'finishings', 'tasks', 'notifications',
  ],
  // v81: مسؤول السلامة (hse_officer) — أُضيفت صلاحية «خطوط الحفر» بقرار صاحب الموقع:
  // يرى القسم ويُدخل البيانات ويُنشئ خطوط حفر جديدة فقط (إنشاء بلا تعديل/حذف —
  // انظر DRIVE_LINES_CREATE_ONLY_ROLES أدناه).
  // v82: أُضيفت صلاحية «المعدات» الكتابة — يستطيع إضافة معدة/أصل جديد.
  // v83 (قرار صاحب الموقع الجديد): مَن يسجّل معدة يُدخل كافة بياناتها ومن ضمنها
  // الأسعار — أُلغي إخفاء الأموال في قسم المعدات عنه كلياً (حُذفت hideEquipmentMoney)
  // وتستبدلت بالمساءلة: من سجّل يظهر مع كل معدة، وكل تغيير يُسجّل في المفكرة أسفل الصفحة.
  hse_officer: [
    'projects', 'drive_lines', 'equipment', 'safety', 'tasks', 'reports', 'notifications',
  ],
  // v83 (قرار صاحب الموقع): المشرف (الفورمان) يرى قسم المعدات ويسجّل معدات
  // وأصولاً جديدة بكافة بياناتها ومن ضمنها الأسعار — إنشاء فقط (انظر
  // EQUIPMENT_CREATE_ONLY_ROLES و COMPANY_ASSET_CREATE_ONLY_ROLES أدناه)،
  // ويستطيع تعديل ما سجّله هو فقط (بوابة المُنشئ في مسارات المعدات)،
  // وكل ما يفعله يظهر باسمه في مفكرة المعدات أسفل الصفحة.
  foreman: [
    'projects', 'daily_reports', 'finishings', 'equipment', 'tasks', 'reports', 'notifications',
  ],
  accountant: [
    'projects', 'costs', 'tasks', 'reports', 'notifications',
  ],
  // v52: الزائر — يرى قسم خطوط الحفر للقراءة فقط:
  // ليس في WRITE_ROLES.drive_lines فلا أزرار إضافة/تعديل/حذف (والخادم يرفض كتاباته بـ 403)،
  // وليس في PRICING_ALLOWED_ROLES فلا يرى أي سعر إطلاقاً (حظر سرية صارم عميل وخادم).
  visitor: [
    'drive_lines',
  ],
}

// ─── v63: تطبيع دور المستخدم ──────────────────────────────────────
// قاعدة البيانات قد تحمل الدور بمسافة زائدة أو بأحرف كبيرة (تعديل يدوي من
// لوحة Supabase، نسخ ولصق عند الإنشاء...). كان فحص الواجهة يقارن النص حرفياً
// بينما الخادم يطبّع قبل المقارنة — فاختلف الحكم بين الطرفين واختفت لوحة
// التحكم وقسم اعتماد التقارير عن أحد المستخدمين الإداريين. الآن كل فحص دور
// في النظام (واجهة وخادماً) يمر من هنا فتتطابق النتيجة دائماً.
export function normalizeRole(role?: string | null): string {
  return String(role || '').trim().toLowerCase()
}

// ─── Dashboard access (restricted) ─────────────────────────────
// لوحة التحكم مخفية عن كل الموظفين — تظهر فقط لـ:
//   1) مدير النظام (حساب الأدمن الرئيسي)
//   2) الإدارة العليا (دور top_management)
// Enforced in three layers: sidebar nav, landing page, and /api/dashboard.
export const SYSTEM_ADMIN_EMAIL = 'admin@axis.om'
export const DASHBOARD_ALLOWED_ROLES = ['top_management'] as const

export function canAccessDashboard(
  user: { role?: string; email?: string } | null | undefined
): boolean {
  if (!user) return false
  if (user.email && user.email.toLowerCase().trim() === SYSTEM_ADMIN_EMAIL) return true
  // v63: المقارنة عبر normalizeRole — لا اعتماد على شكل النص في قاعدة البيانات
  return (DASHBOARD_ALLOWED_ROLES as readonly string[]).includes(normalizeRole(user.role))
}

// H-1 FIX: Role-based access control helper for API routes
// v52: زائر — حساب للمعاينة فقط: قراءة فقط لقسم خطوط الحفر وبلا أي أسعار
export const VALID_ROLES = ['top_management', 'project_manager', 'site_engineer', 'hse_officer', 'foreman', 'accountant', 'visitor'] as const

// Roles that can write to each resource
export const WRITE_ROLES: Record<string, string[]> = {
  projects: ['top_management', 'project_manager'],
  drive_lines: ['top_management', 'project_manager', 'site_engineer', 'hse_officer'],
  daily_reports: ['top_management', 'project_manager', 'site_engineer', 'foreman'],
  safety: ['top_management', 'project_manager', 'site_engineer', 'hse_officer'],
  // v82: مسؤول السلامة يستطيع «إضافة» معدة جديدة (إنشاء فقط).
  // v83: المشرف (foreman) أيضاً يسجّل معدات جديدة — إنشاء فقط، ويعدّل ما سجّله
  // هو فقط، والتعديل الإداري للقائمة يبقى عبر canModifyEquipment
  equipment: ['top_management', 'project_manager', 'site_engineer', 'hse_officer', 'foreman'],
  costs: ['top_management', 'project_manager', 'accountant'],
  finishings: ['top_management', 'project_manager', 'site_engineer', 'foreman'],
  // إدارة المهام: الإنشاء والتعديل والاعتماد للإدارة العليا ومدير المشروع
  // (مدير النظام admin@axis.om يتجاوز الفحص عبر isTaskManager)
  tasks: ['top_management', 'project_manager'],
  // v82: مسؤول السلامة يستطيع «إضافة» أصل/مستأجر جديد (إنشاء فقط).
  // v83: المشرف (foreman) أيضاً — ويُدخل الأسعار (أُلغي الشطب المالي عنهما)،
  // ويعدّل كلٌّ منهما ما سجّله هو فقط، وكل تغيير يظهر في المفكرة الموحدة
  company_assets: ['top_management', 'project_manager', 'site_engineer', 'accountant', 'hse_officer', 'foreman'],
  // v14: سجلات العمال — الإدارة ومهندسو الموقع والمشرفون
  workers: ['top_management', 'project_manager', 'site_engineer', 'foreman'],
}

export function canWrite(userRole: string, resource: string, userPermissions?: Record<string, boolean> | null): boolean {
  // Check per-user permission override first
  if (userPermissions && typeof userPermissions[resource] === 'boolean') {
    return userPermissions[resource]
  }
  const allowed = WRITE_ROLES[resource]
  if (!allowed) return false
  // v63: تطبيع الدور قبل المقارنة (نفس سبب canAccessDashboard)
  return allowed.includes(normalizeRole(userRole))
}

// ─── v81: خطوط الحفر — أدوار «الإنشاء فقط» ─────────────────────
// قرار صاحب الموقع: مسؤول السلامة يُنشئ خطوط حفر جديدة ويُدخل بياناتها،
// لكنه لا يعدّل ولا يحذف خطوطاً قائمة (هذه للإدارة العليا ومدير المشروع
// ومهندس الموقع). الفرق بين canWrite (تشمل الإنشاء) و canModifyDriveLines
// (تعديل/حذف): أدوار هذه القائمة تُقبل في الأولى وتُرفض في الثانية.
// مدير النظام (admin@axis.om أو علم isSystemAdmin) يتجاوز دائماً.
// الأسعار مستقلة تماماً عن هذا الملف: مسؤول السلامة لا يرى أي سعر
// (canViewPricing لا تمنحه شيئاً) والخادم يُعقّم ردوده من السعر أصلاً.
export const DRIVE_LINES_CREATE_ONLY_ROLES = ['hse_officer'] as const

export function canModifyDriveLines(
  user: { role?: string; email?: string; isSystemAdmin?: boolean; permissions?: Record<string, boolean> | null } | null | undefined
): boolean {
  if (!user) return false
  if (user.isSystemAdmin === true) return true
  if (user.email && user.email.toLowerCase().trim() === SYSTEM_ADMIN_EMAIL) return true
  // أدوار الإنشاء فقط: إنشاء نعم — تعديل/حذف لا
  if ((DRIVE_LINES_CREATE_ONLY_ROLES as readonly string[]).includes(normalizeRole(user.role))) return false
  return canWrite(user.role || '', 'drive_lines', user.permissions)
}

// ─── v82/v83: المعدات وأصول الشركة — أدوار «الإنشاء فقط» ──────────
// قرار صاحب الموقع (v82): مسؤول السلامة يستطيع إضافة معدة جديدة أو أصل/مستأجر
// جديد — إنشاء فقط بلا تعديل/حذف. نفس نمط خطوط الحفر v81: canWrite تقبل دوره
// في الإنشاء، وcanModifyEquipment/canModifyCompanyAsset ترفضانه في التعديل والحذف.
// قرار صاحب الموقع (v83 — توسعة ورفع الحظر المالي):
//   1) المشرف (foreman) يُضاف لدورَي «الإنشاء فقط» في المعدات والأصول.
//   2) مَن سجّل المعدة/الأصل يستطيع تعديل ما سجّله هو — بوابة المُنشئ
//      (createdById === user.id) في مسارات المعدات والأصول والصيانة.
//   3) أُلغي إخفاء الأسعار عن هذين الدورين كلياً (حُذفت hideEquipmentMoney
//      التي كانت تُعقّم الردود وتشطب الحقول المالية) — البديل مساءلة كاملة:
//      كل معدة تُظهر مَن سجّلها، وكل تغيير (إنشاء/تعديل/حذف/صيانة/أصل)
//      يُسجّل باسم صاحبه وتوقيته في مفكرة المعدات أسفل الصفحة.
// مدير النظام (admin@axis.om أو علم isSystemAdmin) يتجاوز دائماً.
export const EQUIPMENT_CREATE_ONLY_ROLES = ['hse_officer', 'foreman'] as const
export const COMPANY_ASSET_CREATE_ONLY_ROLES = ['hse_officer', 'foreman'] as const

export function canModifyEquipment(
  user: { role?: string; email?: string; isSystemAdmin?: boolean; permissions?: Record<string, boolean> | null } | null | undefined
): boolean {
  if (!user) return false
  if (user.isSystemAdmin === true) return true
  if (user.email && user.email.toLowerCase().trim() === SYSTEM_ADMIN_EMAIL) return true
  // أدوار الإنشاء فقط: إنشاء نعم — تعديل/حذف/صيانة لا
  if ((EQUIPMENT_CREATE_ONLY_ROLES as readonly string[]).includes(normalizeRole(user.role))) return false
  return canWrite(user.role || '', 'equipment', user.permissions)
}

export function canModifyCompanyAsset(
  user: { role?: string; email?: string; isSystemAdmin?: boolean; permissions?: Record<string, boolean> | null } | null | undefined
): boolean {
  if (!user) return false
  if (user.isSystemAdmin === true) return true
  if (user.email && user.email.toLowerCase().trim() === SYSTEM_ADMIN_EMAIL) return true
  // أدوار الإنشاء فقط: إنشاء نعم — تعديل/حذف لا
  if ((COMPANY_ASSET_CREATE_ONLY_ROLES as readonly string[]).includes(normalizeRole(user.role))) return false
  return canWrite(user.role || '', 'company_assets', user.permissions)
}

// v83: حُذفت hideEquipmentMoney التي كانت تُعقّم الأسعار عن مسؤول السلامة —
// قرار صاحب الموقع: مَن يسجّل معدة يُدخل كافة بياناتها ومن ضمنها الأسعار،
// والمساءلة تكون عبر مفكرة المعدات (كل تغيير باسم صاحبه وتوقيته).

export function hasPermission(
  role: string,
  resource: string,
  userPermissions?: Record<string, boolean> | null,
  email?: string | null
): boolean {
  // مدير النظام (admin@axis.om) يتجاوز كل فحوصات الصلاحيات دائماً —
  // يضمن ظهور كل الأقسام له حتى لو تضرر سجل الصلاحيات المخصص في قاعدة البيانات
  // (نفس نمط canAccessDashboard و isTaskManager)
  if (email && email.toLowerCase().trim() === SYSTEM_ADMIN_EMAIL) return true

  const isTogglable = (MODULE_PERMISSIONS as readonly string[]).includes(resource) ||
    (REPORT_PERMISSIONS as readonly string[]).includes(resource)

  if (isTogglable && userPermissions && typeof userPermissions[resource] === 'boolean') {
    return userPermissions[resource]
  }

  // v63: تطبيع الدور قبل البحث في صلاحيات الرتبة
  const perms = ROLE_PERMISSIONS[normalizeRole(role)] || []
  if (resource.startsWith('rpt_') && perms.includes('reports')) {
    return true
  }

  return perms.includes('*') || perms.includes(resource)
}

export const hasReportPermission = hasPermission

// ─── Pricing confidentiality (v14.1 — محدَّثة في v78) ──────────
// سعر خط الحفر (pricePerMeter) وسعر المشروع الاحتياطي والإيرادات المشتقة
// (dailyRevenue) بيانات مالية سرية — تظهر فقط لمن يسمح بهذه الدالة:
//   1) الإدارة العليا (top_management)
//   2) مدير المشروع (project_manager)
//   3) v78 — مدير النظام (علم isSystemAdmin في القاعدة أو البريد الرئيسي):
//      قرار صاحب الموقع الجديد — رفع الحجز السابق (v15) وإظهار كل الأسعار
//      لمدير النظام وحده، دون أي تغيير في حجبها عن بقية الأدوار.
// هذا حظر سرية صارم لغير الثلاثة أعلاه — لا تخضع الصلاحيات المخصصة
// (permissions) هنا، فحتى لو مُنحت صلاحية drive_lines أو costs لمستخدم
// آخر تبقى الأسعار مخفية عنه.
export const PRICING_ALLOWED_ROLES = ['top_management', 'project_manager'] as const

export function canViewPricing(user: { role?: string; email?: string; isSystemAdmin?: boolean } | null | undefined): boolean {
  if (!user) return false
  // v78 (قرار صاحب الموقع): مدير النظام يرى كل الأسعار — عكس قاعدة v15
  // السابقة التي حجبتها عنه تماماً. الطبقة الأولى: علم قاعدة البيانات.
  if (user.isSystemAdmin === true) return true
  var email = (user.email || '').toLowerCase().trim()
  // الطبقة الثانية: البريد الرئيسي لمدير النظام
  if (email === SYSTEM_ADMIN_EMAIL) return true
  // جلسة بلا بريد = لا أسعار (طبقة v15 تبقى كما هي لغير مدير النظام)
  if (!email) return false
  // v63: تطبيع الدور قبل المقارنة
  return (PRICING_ALLOWED_ROLES as readonly string[]).includes(normalizeRole(user.role))
}

// ─── v53: الموارد البشرية ──────────────────────────────────────
// صلاحية تعديل بيانات الموظفين (v67): قابلة للمنح والسحب لكل مستخدم على حدة
// من إدارة المستخدمين — مدير النظام هو من يسمح ويمنع.
// مفاتيح الصلاحية في كائن permissions للمستخدم: 'hr_manage'
// الافتراض حسب الدور: الإدارة العليا + مدير المشروع (v67 — مكان المحاسب).
// يملكها حصراً: إنشاء وتعديل الملفات الوظيفية، تحديد أرصدة الإجازات،
// تسجيل الغياب والتأخير، تعديل الرصيد مع السبب، العطلات والسياسات،
// والاطلاع على بيانات الرواتب (سرية عن باقي الأدوار حتى المشرفين).
// التاريخ: v66 أضافت «accountant» ثم أُزيلت في v67 بطلب صريح.
export const HR_MANAGE_ROLES = ['top_management', 'project_manager'] as const
export const HR_MANAGE_PERMISSION_KEY = 'hr_manage'

export function isHRManager(user: { role?: string; email?: string; isSystemAdmin?: boolean; permissions?: Record<string, boolean> | null } | null | undefined): boolean {
  if (!user) return false
  if (user.isSystemAdmin === true) return true
  if (user.email && user.email.toLowerCase().trim() === SYSTEM_ADMIN_EMAIL) return true
  // v67: التجاوز الصريح من إدارة المستخدمين يقدم على افتراض الدور —
  // مدير النظام يسمح ويمنع أي موظف بصرف النظر عن رتبته
  var p = user.permissions
  if (p && typeof p[HR_MANAGE_PERMISSION_KEY] === 'boolean') {
    return p[HR_MANAGE_PERMISSION_KEY]
  }
  // v64: تطبيع الدور (نفس منطق v63) — لا انكسار لو كان نص الدور في القاعدة غير نظيف
  return (HR_MANAGE_ROLES as readonly string[]).includes(normalizeRole(user.role))
}

// ─── v75: مدير النظام — الوحيد الذي يرى أرشيف المعدات المحذوفة ──────────
// (نفس تعريف canAccessDashboard/isHRManager: العلم من القاعدة أو البريد الرئيسي)
export function isSystemAdminAccount(user: { email?: string; isSystemAdmin?: boolean } | null | undefined): boolean {
  if (!user) return false
  if (user.isSystemAdmin === true) return true
  return !!user.email && user.email.toLowerCase().trim() === SYSTEM_ADMIN_EMAIL
}

// ─── Task Management helpers ───────────────────────────────────
// مدير المهام: ينشئ ويعدّل ويعيد ويعتمد ويغلق ويرى الكل
// (الإدارة العليا + مدير المشروع + مدير النظام admin@axis.om)
export const TASK_MANAGE_ROLES = ['top_management', 'project_manager'] as const

export function isTaskManager(user: { role?: string; email?: string } | null | undefined): boolean {
  if (!user) return false
  if (user.email && user.email.toLowerCase().trim() === SYSTEM_ADMIN_EMAIL) return true
  // v65: تطبيع الدور (نفس منطق v63/v64) — كل فحوصات الدور تمر من normalizeRole
  return (TASK_MANAGE_ROLES as readonly string[]).includes(normalizeRole(user.role))
}
