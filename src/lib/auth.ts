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

// Togglable permission labels (bilingual) for user management UI — modules only
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
}

// Report labels (bilingual) — separate from module labels to avoid key collisions
// Keys match the report IDs used in reports-page.tsx exactly
export const REPORT_LABELS: Record<string, { ar: string; en: string }> = {
  daily_site: { ar: 'التقرير اليومي للموقع', en: 'Daily Site Report' },
  production: { ar: 'تقرير الإنتاج اليومي', en: 'Daily Production Report' },
  safety: { ar: 'تقرير السلامة اليومي', en: 'Daily Safety Report' },
  attendance: { ar: 'تقرير الحضور', en: 'Attendance Report' },
  revenue: { ar: 'تقرير الإيرادات', en: 'Revenue Report' },
  costs: { ar: 'تقرير التكاليف', en: 'Cost Report' },
  profit: { ar: 'تقرير صافي الربح', en: 'Profit Report' },
  equipment: { ar: 'تقرير المعدات', en: 'Equipment Report' },
  weekly: { ar: 'تقرير الإنجاز الأسبوعي', en: 'Weekly Progress Report' },
  monthly: { ar: 'تقرير شهري للإدارة', en: 'Monthly Management Report' },
  handover: { ar: 'تقرير تسليم الأعمال', en: 'Handover Report' },
}

// Module (section) permissions — array of keys
export const MODULE_PERMISSIONS = [
  'dashboard', 'projects', 'drive_lines', 'daily_reports', 'safety',
  'equipment', 'costs', 'finishings', 'performance', 'reports', 'notifications', 'users',
] as const

// Report permissions — array of keys (matches report IDs in reports-page.tsx)
export const REPORT_PERMISSIONS = [
  'daily_site', 'production', 'safety', 'attendance', 'revenue', 'costs',
  'profit', 'equipment', 'weekly', 'monthly', 'handover',
] as const

// Combined list of all togglable permissions
export const TOGGLABLE_PERMISSIONS = [...MODULE_PERMISSIONS, ...REPORT_PERMISSIONS] as const
