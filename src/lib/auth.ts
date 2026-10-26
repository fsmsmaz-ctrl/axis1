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
  'projects', 'drive_lines', 'daily_reports', 'safety', 'equipment', 'costs', 'finishings', 'tasks', 'performance',
  // v91: «التقارير» صلاحية قسم كاملة قابلة للمنح والسحب من إدارة المستخدمين —
  // كانت سابقاً مفتاحاً داخلياً في ROLE_PERMISSIONS فقط (لا يظهر في قائمة
  // الصلاحيات) فلم تستطع الإدارة منح قسم التقارير لأي حساب من إدارة الحسابات.
  'reports', 'notifications', 'oversight',
  // v97: «المكتبات» — قسم عام يظهر لكل الموظفين (كل رتبة عدا الزائر):
  // كل موظف يُنشئ مكتباته وأقسامه الخاصة/العامة ويرفع ملفاته
  'libraries',
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
  reports:        { ar: 'التقارير',           en: 'Reports' },
  notifications:  { ar: 'التنبيهات وسجل المراقبة', en: 'Notifications & Monitor' },
  oversight:      { ar: 'الرقابة العملية',   en: 'Operational Control' },
  // v97: المكتبات
  libraries:      { ar: 'المكتبات',           en: 'Libraries' },
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
    'libraries', // v97
  ],
  site_engineer: [
    'projects', 'drive_lines', 'daily_reports', 'safety',
    'equipment', 'finishings', 'tasks', 'notifications',
    'libraries', // v97
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
    'libraries', // v97
  ],
  // v83 (قرار صاحب الموقع): المشرف (الفورمان) يرى قسم المعدات ويسجّل معدات
  // وأصولاً جديدة بكافة بياناتها ومن ضمنها الأسعار — إنشاء فقط (انظر
  // EQUIPMENT_CREATE_ONLY_ROLES و COMPANY_ASSET_CREATE_ONLY_ROLES أدناه)،
  // ويستطيع تعديل ما سجّله هو فقط (بوابة المُنشئ في مسارات المعدات)،
  // وكل ما يفعله يظهر باسمه في مفكرة المعدات أسفل الصفحة.
  foreman: [
    'projects', 'daily_reports', 'finishings', 'equipment', 'tasks', 'reports', 'notifications',
    'libraries', // v97
  ],
  // v85 (قرار صاحب الموقع): رتبة «عامل» — أدنى رتبة تشغيلية أسفل المشرف
  // (الفورمان). يرى المشاريع ومهامه المُكلَّف بها والتنبيهات بحسابه الشخصي،
  // ولا يرى الأسعار ولا التقارير التحليلية ولا لوحة التحكم. الإدارة تستطيع
  // منحه أقساماً إضافية لكل عامل على حدة من إدارة المستخدمين (التخصيص لكل
  // مستخدم يقدم على افتراض الرتبة).
  // v86 (قرار صاحب الموقع): أُضيفت «السلامة» لرؤيته الافتراضية — العامل
  // يُنشئ تقارير السلامة (ومنها يُنشأ التقرير اليومي المرتبط تلقائياً)،
  // والكتابة نفسها محصورة بقائمة بيضاء صريحة في canWrite أدناه.
  worker: [
    'projects', 'daily_reports', 'safety', 'tasks', 'notifications',
    'libraries', // v97: قسم المكتبات عام — كل موظف (ومنهم العامل) يُنشئ مكتبته الخاصة
  ],
  // v89 (قرار صاحب الموقع): رتبة «حامل التصريح» (Permit Holder) — رتبة ميدانية
  // لحامل تصريح العمل (PTW). نفس الرؤية الافتراضية للعامل (مشاريع، تقارير يومية،
  // سلامة، مهام، تنبيهات) لكنه قراءة فقط تماماً: عمداً غائب عن كل قوائم WRITE_ROLES
  // أعلاه فالخادم يرفض أي إنشاء/تعديل/حذف منه بـ403. ومن يملك إدارة المستخدمين
  // يمكنه منحه صلاحيات أقسام محددة لكل مستخدم على حدة (التخصيص يقدّم على افتراض
  // الرتبة كما في بقية الرتب — وليس عليه قائمة بيضاء العامل v86).
  // v91 (قرار صاحب الموقع — التكوين النهائي): حامل التصريح «مثل مسؤول السلامة»
  // في قسم السلامة — ينشئ تقارير السلامة (WRITE_ROLES.safety أدناه) — ماعدا
  // «بيانات العمال» فممنوعة عليه كلياً (WORKERS_DATA_DENIED_ROLES أدناه).
  // وأُضيفت «خطوط الحفر» و«التقارير» لرؤيته الافتراضية: خطوط الحفر معاينة
  // فقط (قيد v90 ثابت حتى مع التخصيص) والتقارير قسم كامل — والكتابة في
  // التقارير اليومية تبقى مرفوضة منه (ليس في WRITE_ROLES.daily_reports).
  permit_holder: [
    'projects', 'drive_lines', 'daily_reports', 'safety', 'tasks', 'reports', 'notifications',
    'libraries', // v97
  ],
  accountant: [
    'projects', 'costs', 'tasks', 'reports', 'notifications',
    'libraries', // v97
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

// ─── v87: إدارة المستخدمين — من يفتح القسم ويدير الحسابات ──────────
// قرار صاحب الموقع: قسم «إدارة المستخدمين» وإنشاء الحسابات الجديدة متاح
// للإدارة كافة (الإدارة العليا ومدير المشروع) وللمدير المالي والإداري
// («المحاسب» سابقاً — v92 غيّرت التسمية المعروضة فقط) — بدل حصره بمدير
// النظام والإدارة العليا. مع صمامات أمان صريحة أدناه:
//   canManageTopAccounts → إدارة حسابات الإدارة العليا نفسها (إنشاءها/
//   تعديلها/حذفها) ومنح دور «إدارة عليا» لمدير النظام والإدارة العليا فقط
//   (منع ترقية الصلاحيات: المدير المالي والإداري أو مدير المشروع لا يستطيع
//   صنع إداري عليا). وإضافة v92: تراتب إدارة المستخدمين أدناه.
export const USER_MANAGE_ROLES = ['top_management', 'project_manager', 'accountant'] as const

export function canManageUsers(user: { role?: string; email?: string } | null | undefined): boolean {
  if (!user) return false
  if (user.email && user.email.toLowerCase().trim() === SYSTEM_ADMIN_EMAIL) return true
  return (USER_MANAGE_ROLES as readonly string[]).includes(normalizeRole(user.role))
}

// v87: من يملك إدارة حسابات الإدارة العليا ومنح دورها — النخبة فقط
export function canManageTopAccounts(user: { role?: string; email?: string } | null | undefined): boolean {
  if (!user) return false
  if (user.email && user.email.toLowerCase().trim() === SYSTEM_ADMIN_EMAIL) return true
  return normalizeRole(user.role) === 'top_management'
}

// H-1 FIX: Role-based access control helper for API routes
// v52: زائر — حساب للمعاينة فقط: قراءة فقط لقسم خطوط الحفر وبلا أي أسعار
// v85: أُضيفت رتبة «عامل» (worker) أسفل المشرف — أدنى رتبة تشغيلية
// v89: أُضيفت رتبة «حامل التصريح» (permit_holder) — رتبة ميدانية قراءة فقط
export const VALID_ROLES = ['top_management', 'project_manager', 'site_engineer', 'hse_officer', 'foreman', 'worker', 'permit_holder', 'accountant', 'visitor'] as const

// ─── v92: تراتب إدارة المستخدمين ──────────────────────────────────
// قرار صاحب الموقع (v92): رتبة «المحاسب» أصبحت «المدير المالي والإداري»
// (المفتاح الداخلي accountant ثابت في قاعدة البيانات — التسمية معروضة فقط)،
// ويملك تعبئة بيانات المستخدمين (إنشاء/تعديل/حذف الحسابات — متاح له منذ v87).
// التدقيق الأمني في v92 أغلق ثغرات ترقية صلاحيات كانت مفتوحة لأن إدارة
// الحسابات لم تكن مدرَّبة:
//   1) كان يستطيع تغيير دوره بنفسه من إدارة المستخدمين إلى «مدير مشروع»
//      فيرى الأسعار السرية (PRICING_ALLOWED_ROLES التي لا تفتحها الصلاحيات
//      المخصصة أصلاً) وإدارة المهام وصلاحيات الموارد البشرية الافتراضية.
//   2) كان يستطيع إنشاء حساب «مدير مشروع» بكلمة مرور يعرفها — ترقية غير مباشرة.
//   3) كان يستطيع إعادة تعيين كلمة مرور مدير مشروع قائم ثم الدخول بحسابه.
//   4) كان يستطيع تعطيل (حذف) حسابات مديري المشاريع وإقفال الإدارة خارج النظام.
// القاعدة الآن: مَن يدير المستخدمين يدير حسابات أدنى رتبته فقط، ولا يعدّل
// دوره ولا صلاحياته ولا كلمة مروره بنفسه من إدارة المستخدمين (كلمة المرور
// من الملف الشخصي بتحقق كلمة المرور الحالية، والدور والصلاحيات لمدير النظام
// والإدارة الأعلى). الإدارة العليا تدير كل من دونها كما كانت، ومدير النظام
// (admin@axis.om أو علم isSystemAdmin) يتجاوز دائماً.
export const USER_TIER_PROTECTED_ROLES: Record<string, string[]> = {
  top_management: [],
  // v93 (تدقيق أمني): حماية الأقران — كان مدير المشروع يستطيع إعادة تعيين كلمة
  // مرور مدير مشروع آخر ثم الدخول بحسابه وامتلاك هويته القائمة (سجلات التدقيق
  // تنسب أفعاله إليه). نفس النمط الذي أغلقه v92 على المدير المالي والإداري
  // ضد مديري المشاريع، والآن مُوحّد بكل طبقة: كل مدير يدير حسابات «أدنى
  // رتبته» حصراً والأقران محميون من بعضهم، ومدير النظام (admin@axis.om أو
  // علم isSystemAdmin) يتجاوز دائماً كما في بقية البوابات.
  project_manager: ['top_management', 'project_manager'],
  accountant: ['top_management', 'project_manager', 'accountant'],
}

// الأدوار التي يستطيع كل مدير «إنشاءها» أو «منحها» — لا دور أعلى من رتبته.
// مبنية من VALID_ROLES أعلاه لتبقى متطابقة معها دائماً.
export const USER_TIER_ASSIGNABLE_ROLES: Record<string, string[]> = {
  top_management: (VALID_ROLES as readonly string[]).slice(),
  project_manager: (VALID_ROLES as readonly string[]).filter(function (r) { return r !== 'top_management' }),
  accountant: ['site_engineer', 'hse_officer', 'foreman', 'worker', 'permit_holder', 'accountant', 'visitor'],
}

// هل يستطيع المحرر (مدير المستخدمين) إدارة حساب الهدف — تعديلاً وحذفاً؟
// حسابات «الإدارة العليا» لمدير النظام حصراً (ومنع حذفها كلياً ثابت في مسار
// الحذف قبل هذا الفحص)، وما فوق رتبة المحرر محمي منه.
export function canManageTargetAccount(
  editor: { role?: string; email?: string; isSystemAdmin?: boolean } | null | undefined,
  targetRole: string
): boolean {
  if (!editor) return false
  if (isSystemAdminAccount(editor)) return true
  var t = normalizeRole(targetRole)
  if (t === 'top_management') return false
  var protectedFor = USER_TIER_PROTECTED_ROLES[normalizeRole(editor.role)]
  if (protectedFor && protectedFor.indexOf(t) !== -1) return false
  return true
}

// هل يستطيع المحرر إنشاء/منح هذا الدور؟ (إنشاء حساب جديد أو تغيير دور حساب قائم)
export function canAssignRoleTo(
  editor: { role?: string; email?: string; isSystemAdmin?: boolean } | null | undefined,
  role: string
): boolean {
  if (!editor) return false
  var r = normalizeRole(role)
  if (!r) return false
  if (isSystemAdminAccount(editor)) return true
  if (r === 'top_management') return canManageTopAccounts(editor)
  var allowed = USER_TIER_ASSIGNABLE_ROLES[normalizeRole(editor.role)]
  return !!allowed && allowed.indexOf(r) !== -1
}

// Roles that can write to each resource
// v85: رتبة «عامل» عمداً غائبة من كل قوائم الكتابة — قراءة فقط بلا أي
// إنشاء/تعديل/حذف في كل أقسام النظام (الخادم يرفض كتاباته بـ 403).
export const WRITE_ROLES: Record<string, string[]> = {
  projects: ['top_management', 'project_manager'],
  drive_lines: ['top_management', 'project_manager', 'site_engineer', 'hse_officer'],
  daily_reports: ['top_management', 'project_manager', 'site_engineer', 'foreman'],
  // v91 (قرار صاحب الموقع): حامل التصريح ينشئ تقارير السلامة مثل مسؤول
  // السلامة — التقرير اليومي المرتبط يُنشأ خادمياً تلقائياً من مسار السلامة
  // نفسه فلا يحتاج أي صلاحية كتابة على التقارير اليومية (تبقى معاينة فقط).
  safety: ['top_management', 'project_manager', 'site_engineer', 'hse_officer', 'permit_holder'],
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
  // v97: المكتبات — كل رتب الموظفين تكتب (إنشاء مكتبات/أقسام ورفع ملفات)
  // بقرار صاحب الموقع: القسم عام لكل الموظفين. الزائر مستثنى عمداً.
  libraries: ['top_management', 'project_manager', 'site_engineer', 'hse_officer', 'foreman', 'worker', 'permit_holder', 'accountant'],
}

// v86 (قرار صاحب الموقع): القائمة البيضاء للعامل — الرتبة «عامل» ممنوعة من
// الكتابة في كل الأقسام ما عدا هذه القائمتين صراحةً:
//   safety        → إنشاء تقارير السلامة وتعديلها (ومنها يُنشأ التقرير اليومي)
//   daily_reports → تعديل التقرير اليومي وتسليمه (إرساله للاعتماد)
// كل ما عداها (خطوط الحفر، المعدات، التكاليف، المهام...) يبقى محظوراً حتى لو
// مُنحت رؤيته من إدارة المستخدمين — فالمنح يفتح الرؤية فقط (نفس قاعدة v85.1)،
// والاعتماد/الحذف/إعادة الإسناد الإدارية وأزرار «إضافة عامل» تبقى مغلقة أمامه.
// v97: أُضيفت «المكتبات» بقرار صاحب الموقع — القسم عام لكل الموظفين والعامل
// يُنشئ مكتبته الخاصة وأقسامه ويرفع ملفاته فيه (يبقى محظوراً في بقية الأقسام كما هو)
const WORKER_WRITE_ALLOWED = ['safety', 'daily_reports', 'libraries'] as const

export function canWrite(userRole: string, resource: string, userPermissions?: Record<string, boolean> | null): boolean {
  // v86: رتبة «عامل» — كتابة بالقائمة البيضاء فقط (WORKER_WRITE_ALLOWED أعلاه)،
  // وكل ما عداه قراءة فقط حتى مع صلاحيات التخصيص من إدارة المستخدمين.
  // بوابات الكتابة كلها تمر من هنا (canWrite/canModifyDriveLines/canModifyEquipment/
  // canEditAnyEquipment/canModifyCompanyAsset/canEditAnyCompanyAsset) — فالحكم من
  // هذه النقطة الواحدة يغطي الواجهة والخادم معاً، ومدير النظام لا يمر من canWrite
  // أصلاً (تجاوزه في دوال البوابات قبل الاستدعاء) فلا يتأثر.
  if (normalizeRole(userRole) === 'worker') {
    return (WORKER_WRITE_ALLOWED as readonly string[]).includes(resource)
  }
  // v90 (قرار صاحب الموقع): رتبة «حامل التصريح» — خطوط الحفر معاينة فقط.
  // الفحص يسبق تجاوز الصلاحيات الفردية عمداً: منح «خطوط الحفر» من إدارة
  // المستخدمين يفتح له الرؤية فقط (عبر hasPermission) بينما تبقى الكتابة
  // (إنشاء/تعديل/حذف) مرفوضة من هذه النقطة في كل بوابات النظام.
  if (resource === 'drive_lines' && (DRIVE_LINES_VIEW_ONLY_ROLES as readonly string[]).includes(normalizeRole(userRole))) {
    return false
  }
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

// ─── v90: خطوط الحفر — أدوار «المعاينة فقط» ─────────────────────
// قرار صاحب الموقع: رتبة «حامل التصريح» (permit_holder) ترى قسم خطوط الحفر
// للقراءة فقط — لا إنشاء ولا تعديل ولا حذف إطلاقاً. والحكم هنا أقوى من
// أدوار «الإنشاء فقط»: يسبق تجاوز الصلاحيات الفردية في canWrite نفسه، فحتى
// لو مُنح المستخدم صلاحية drive_lines من إدارة المستخدمين (التي تفتح الرؤية
// والأزرار معاً افتراضياً لبقية الرتب) تبقى كتابته مرفوضة — الواجهة تخفي
// الأزرار والخادم يرد بـ403. مدير النظام (admin@axis.om أو علم
// isSystemAdmin) يتجاوز دائماً كما في بقية البوابات.
export const DRIVE_LINES_VIEW_ONLY_ROLES = ['permit_holder'] as const

export function canModifyDriveLines(
  user: { role?: string; email?: string; isSystemAdmin?: boolean; permissions?: Record<string, boolean> | null } | null | undefined
): boolean {
  if (!user) return false
  if (user.isSystemAdmin === true) return true
  if (user.email && user.email.toLowerCase().trim() === SYSTEM_ADMIN_EMAIL) return true
  // أدوار الإنشاء فقط: إنشاء نعم — تعديل/حذف لا
  if ((DRIVE_LINES_CREATE_ONLY_ROLES as readonly string[]).includes(normalizeRole(user.role))) return false
  // v90: أدوار المعاينة فقط — لا تعديل ولا حذف حتى مع صلاحيات التخصيص
  if ((DRIVE_LINES_VIEW_ONLY_ROLES as readonly string[]).includes(normalizeRole(user.role))) return false
  return canWrite(user.role || '', 'drive_lines', user.permissions)
}

// ─── v82/v83: المعدات وأصول الشركة — أدوار «الإنشاء فقط» ──────────
// قرار صاحب الموقع (v82): مسؤول السلامة يستطيع إضافة معدة جديدة أو أصل/مستأجر
// جديد — إنشاء فقط بلا تعديل/حذف. نفس نمط خطوط الحفر v81: canWrite تقبل دوره
// في الإنشاء، وcanModifyEquipment/canModifyCompanyAsset ترفضانه في التعديل والحذف.
// v84 (قرار صاحب الموقع الجديد): التعديل فُتح للجميع عبر canEditAnyEquipment /
// canEditAnyCompanyAsset — أدوار «الإنشاء فقط» الآن تعدّل أي معدة/أصل،
// وتظهر كل تغييراتها في السجل المصغر على المعدة نفسها. canModify* أعيد
// تخصيصها لبوابة الحذف فقط (الإدارة حصراً).
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
  // أدوار الإنشاء فقط: إنشاء نعم — حذف/إدارة لا (v84: التعديل عبر canEditAnyEquipment)
  if ((EQUIPMENT_CREATE_ONLY_ROLES as readonly string[]).includes(normalizeRole(user.role))) return false
  return canWrite(user.role || '', 'equipment', user.permissions)
}

export function canModifyCompanyAsset(
  user: { role?: string; email?: string; isSystemAdmin?: boolean; permissions?: Record<string, boolean> | null } | null | undefined
): boolean {
  if (!user) return false
  if (user.isSystemAdmin === true) return true
  if (user.email && user.email.toLowerCase().trim() === SYSTEM_ADMIN_EMAIL) return true
  // أدوار الإنشاء فقط: إنشاء نعم — حذف/إدارة لا (v84: التعديل عبر canEditAnyCompanyAsset)
  if ((COMPANY_ASSET_CREATE_ONLY_ROLES as readonly string[]).includes(normalizeRole(user.role))) return false
  return canWrite(user.role || '', 'company_assets', user.permissions)
}

// ─── v84: أي موظف يملك صلاحية الكتابة يستطيع تعديل أي معدة/أصل ──────────
// قرار صاحب الموقع: أي معدة أو أصل سجّله موظف يمكن لأي موظف آخر تعديل
// بياناته — تُضمن حقوق الجميع عبر المساءلة: كل تعديل يُسجَّل على المعدة/الأصل
// نفسه (سجل مصغر بنقاط صغيرة باسم صاحبه وتوقيته)، والمفكرة الكاملة لمدير
// النظام وحده. الفرق عن canModify*: هنا يتجاوز فحص «أدوار الإنشاء فقط» —
// كل من يجتاز فحص الكتابة (canWrite) على المورد يستطيع التعديل، ومدير
// النظام (العلم من القاعدة أو البريد الرئيسي) يتجاوز دائماً.
// الحذف يبقى محصوراً بـ canModify* (الإدارة) كما هو.
export function canEditAnyEquipment(
  user: { role?: string; email?: string; isSystemAdmin?: boolean; permissions?: Record<string, boolean> | null } | null | undefined
): boolean {
  if (!user) return false
  if (user.isSystemAdmin === true) return true
  if (user.email && user.email.toLowerCase().trim() === SYSTEM_ADMIN_EMAIL) return true
  return canWrite(user.role || '', 'equipment', user.permissions)
}

export function canEditAnyCompanyAsset(
  user: { role?: string; email?: string; isSystemAdmin?: boolean; permissions?: Record<string, boolean> | null } | null | undefined
): boolean {
  if (!user) return false
  if (user.isSystemAdmin === true) return true
  if (user.email && user.email.toLowerCase().trim() === SYSTEM_ADMIN_EMAIL) return true
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

// ─── v91: بيانات العمال — من يُمنع من الوصول إليها ─────────────
// قرار صاحب الموقع: حامل التصريح يشبه مسؤول السلامة في قسم السلامة
// (ينشئ تقارير السلامة) لكنه ممنوع تماماً من «بيانات العمال» — سجل
// العمال وأسماؤهم وأرقامهم ومقاولوهم. ولأن بوابة قراءة سجل العمال
// تمر بصلاحية السلامة نفسها (قائمة العمال تُستهلك من وحدة السلامة)
// فإن هذا الفحص الصريح يسبقها ويحجبها عنه نهائياً حتى لو مُنحت
// صلاحية السلامة له من إدارة المستخدمين: الواجهة تخفي قسم «بيانات
// العمال» كلياً والخادم يرد بـ403. مدير النظام (admin@axis.om أو
// علم isSystemAdmin) يتجاوز دائماً.
export const WORKERS_DATA_DENIED_ROLES = ['permit_holder'] as const

export function canViewWorkersData(
  user: { role?: string; email?: string; isSystemAdmin?: boolean; permissions?: Record<string, boolean> | null } | null | undefined
): boolean {
  if (!user) return false
  if (user.isSystemAdmin === true) return true
  if (user.email && user.email.toLowerCase().trim() === SYSTEM_ADMIN_EMAIL) return true
  if ((WORKERS_DATA_DENIED_ROLES as readonly string[]).includes(normalizeRole(user.role))) return false
  return hasPermission(user.role || '', 'safety', user.permissions, user.email)
}

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
// الافتراض حسب الدور: الإدارة العليا + مدير المشروع + المدير المالي والإداري (v94).
// يملكها حصراً: إنشاء وتعديل الملفات الوظيفية، تحديد المسؤول المباشر لكل موظف،
// تحديد أرصدة الإجازات، تسجيل الغياب والتأخير، تعديل الرصيد مع السبب،
// العطلات والسياسات، والاطلاع على بيانات الرواتب (سرية عن باقي الأدوار حتى المشرفين).
// التاريخ: v66 أضافت «accountant» ثم أُزيلت في v67 بطلب صريح حين كان الدور «محاسباً»؛
//   v94 أعادته بقرار جديد من صاحب الموقع بعد أن أصبح الدور «المدير المالي والإداري» —
//   هو صاحب تعبئة بيانات المستخدمين وتحديد المسؤول المباشر لكل موظف. وبهذا تصير
//   canEdit=true له في الملف الوظيفي فلا تظهر له رسالة «انت غير مكتمل البيانات».
//   التجاوز الفردي (hr_manage=false من مدير النظام) يبقى أعلى من افتراض الدور.
export const HR_MANAGE_ROLES = ['top_management', 'project_manager', 'accountant'] as const
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
