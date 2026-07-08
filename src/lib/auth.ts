// Shared auth types and constants - safe for both client and server
// This file does NOT import any server-only modules (no db, no fs, no crypto)

export interface SessionUser {
  id: string
  email: string
  name: string
  nameEn?: string | null
  role: string
  phone?: string | null
  language: string
  permissions?: string[]
}

export const SESSION_COOKIE = 'axis_session'
const SESSION_MAX_AGE = 7 * 24 * 60 * 60 // 7 days in seconds

export function getSessionMaxAge(): number {
  return SESSION_MAX_AGE
}

// Cookie options that work across HTTP, HTTPS, and reverse proxies (Caddy)
export function getCookieOptions() {
  return {
    httpOnly: false,        // Allow JS to read cookie for localStorage backup
    secure: false,          // Work on both HTTP (localhost) and HTTPS (preview)
    sameSite: 'lax' as const,
    maxAge: SESSION_MAX_AGE,
    path: '/',
  }
}

// Role permissions matrix
export const ROLE_PERMISSIONS: Record<string, string[]> = {
  top_management: ['*'],
  project_manager: [
    'dashboard', 'projects', 'drive_lines', 'daily_reports', 'safety',
    'equipment', 'costs', 'finishings', 'reports', 'performance', 'notifications',
  ],
  site_engineer: [
    'dashboard', 'projects', 'drive_lines', 'daily_reports', 'safety',
    'equipment', 'finishings', 'notifications',
  ],
  hse_officer: [
    'dashboard', 'projects', 'daily_reports', 'safety', 'notifications',
  ],
  foreman: [
    'dashboard', 'projects', 'daily_reports', 'equipment', 'notifications',
  ],
  accountant: [
    'dashboard', 'projects', 'costs', 'reports', 'notifications',
  ],
}

export function hasPermission(role: string, resource: string, customPermissions?: string[]): boolean {
  if (customPermissions && customPermissions.length > 0) {
    return customPermissions.includes(resource)
  }
  const perms = ROLE_PERMISSIONS[role] || []
  return perms.includes('*') || perms.includes(resource)
}

// Single alias — declared once only
export const hasReportPermission = hasPermission

// Togglable permission labels (bilingual) for user management UI
export const TOGGLABLE_PERMISSION_LABELS: Record<string, { ar: string; en: string }> = {
  dashboard: { ar: 'لوحة التحكم', en: 'Dashboard' },
  projects: { ar: 'المشاريع', en: 'Projects' },
  drive_lines: { ar: 'خطوط الحفر', en: 'Drive Lines' },
  daily_reports: { ar: 'التقارير اليومية', en: 'Daily Reports' },
  safety: { ar: 'السلامة', en: 'Safety' },
  equipment: { ar: 'المعدات', en: 'Equipment' },
  costs: { ar: 'التكاليف والإيرادات', en: 'Costs & Revenue' },
  finishings: { ar: 'التشطيبات', en: 'Finishings' },
  performance: { ar: 'تقييم الأداء', en: 'Performance' },
  reports: { ar: 'التقارير', en: 'Reports' },
  notifications: { ar: 'التنبيهات', en: 'Notifications' },
  users: { ar: 'إدارة المستخدمين', en: 'User Management' },
  report_daily: { ar: 'تقرير يومي', en: 'Daily Report' },
  report_safety: { ar: 'تقرير السلامة', en: 'Safety Report' },
  report_production: { ar: 'تقرير الإنتاج', en: 'Production Report' },
  report_cost: { ar: 'تقرير التكاليف', en: 'Cost Report' },
  report_performance: { ar: 'تقرير الأداء', en: 'Performance Report' },
  report_equipment: { ar: 'تقرير المعدات', en: 'Equipment Report' },
}

// Module (section) permissions — array of keys
export const MODULE_PERMISSIONS = [
  'dashboard', 'projects', 'drive_lines', 'daily_reports', 'safety',
  'equipment', 'costs', 'finishings', 'performance', 'reports', 'notifications', 'users',
] as const

// Report permissions — array of keys
export const REPORT_PERMISSIONS = [
  'report_daily', 'report_safety', 'report_production', 'report_cost', 'report_performance', 'report_equipment',
] as const

// Combined list of all togglable permissions
export const TOGGLABLE_PERMISSIONS = [...MODULE_PERMISSIONS, ...REPORT_PERMISSIONS] as const
