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
  'projects', 'drive_lines', 'daily_reports', 'safety', 'equipment', 'costs', 'finishings', 'tasks', 'performance', 'notifications',
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
    'equipment', 'costs', 'finishings', 'tasks', 'reports', 'performance', 'notifications',
  ],
  site_engineer: [
    'projects', 'drive_lines', 'daily_reports', 'safety',
    'equipment', 'finishings', 'tasks', 'notifications',
  ],
  hse_officer: [
    'projects', 'equipment', 'safety', 'tasks', 'reports', 'notifications',
  ],
  foreman: [
    'projects', 'daily_reports', 'finishings', 'tasks', 'reports', 'notifications',
  ],
  accountant: [
    'projects', 'costs', 'tasks', 'reports', 'notifications',
  ],
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
  return (DASHBOARD_ALLOWED_ROLES as readonly string[]).includes(user.role || '')
}

// H-1 FIX: Role-based access control helper for API routes
export const VALID_ROLES = ['top_management', 'project_manager', 'site_engineer', 'hse_officer', 'foreman', 'accountant'] as const

// Roles that can write to each resource
export const WRITE_ROLES: Record<string, string[]> = {
  projects: ['top_management', 'project_manager'],
  drive_lines: ['top_management', 'project_manager', 'site_engineer', 'hse_officer'],
  daily_reports: ['top_management', 'project_manager', 'site_engineer', 'foreman'],
  safety: ['top_management', 'project_manager', 'site_engineer', 'hse_officer'],
  equipment: ['top_management', 'project_manager', 'site_engineer'],
  costs: ['top_management', 'project_manager', 'accountant'],
  finishings: ['top_management', 'project_manager', 'site_engineer', 'foreman'],
  // إدارة المهام: الإنشاء والتعديل والاعتماد للإدارة العليا ومدير المشروع
  // (مدير النظام admin@axis.om يتجاوز الفحص عبر isTaskManager)
  tasks: ['top_management', 'project_manager'],
  company_assets: ['top_management', 'project_manager', 'site_engineer', 'accountant'],
}

export function canWrite(userRole: string, resource: string, userPermissions?: Record<string, boolean> | null): boolean {
  // Check per-user permission override first
  if (userPermissions && typeof userPermissions[resource] === 'boolean') {
    return userPermissions[resource]
  }
  const allowed = WRITE_ROLES[resource]
  if (!allowed) return false
  return allowed.includes(userRole)
}

export function hasPermission(role: string, resource: string, userPermissions?: Record<string, boolean> | null): boolean {
  const isTogglable = (MODULE_PERMISSIONS as readonly string[]).includes(resource) ||
    (REPORT_PERMISSIONS as readonly string[]).includes(resource)

  if (isTogglable && userPermissions && typeof userPermissions[resource] === 'boolean') {
    return userPermissions[resource]
  }

  const perms = ROLE_PERMISSIONS[role] || []
  if (resource.startsWith('rpt_') && perms.includes('reports')) {
    return true
  }

  return perms.includes('*') || perms.includes(resource)
}

export const hasReportPermission = hasPermission

// ─── Task Management helpers ───────────────────────────────────
// مدير المهام: ينشئ ويعدّل ويعيد ويعتمد ويغلق ويرى الكل
// (الإدارة العليا + مدير المشروع + مدير النظام admin@axis.om)
export const TASK_MANAGE_ROLES = ['top_management', 'project_manager'] as const

export function isTaskManager(user: { role?: string; email?: string } | null | undefined): boolean {
  if (!user) return false
  if (user.email && user.email.toLowerCase().trim() === SYSTEM_ADMIN_EMAIL) return true
  return (TASK_MANAGE_ROLES as readonly string[]).includes(user.role || '')
}

