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
  permissions?: Record<string, boolean> | null
}

export const SESSION_COOKIE = 'axis_session'
const SESSION_MAX_AGE = 7 * 24 * 60 * 60 // 7 days in seconds

export function getSessionMaxAge(): number {
  return SESSION_MAX_AGE
}

// Cookie options — secure on production (Netlify HTTPS), relaxed on localhost
export function getCookieOptions() {
  const isProduction = process.env.NODE_ENV === 'production'
  return {
    httpOnly: false,        // Allow JS to read cookie for localStorage backup
    secure: isProduction,   // true on Netlify (HTTPS), false on localhost (HTTP)
    sameSite: 'lax' as const,
    maxAge: SESSION_MAX_AGE,
    path: '/',
  }
}

// ─── Module access permissions (sidebar navigation) ───
export const MODULE_PERMISSIONS = [
  'dashboard', 'projects', 'drive_lines', 'daily_reports', 'safety', 'equipment', 'costs', 'finishings', 'performance',
] as const

// ─── Report type permissions ───
export const REPORT_PERMISSIONS = [
  'report_daily_site', 'report_production', 'report_safety', 'report_attendance',
  'report_revenue', 'report_costs', 'report_profit', 'report_equipment',
  'report_weekly', 'report_monthly', 'report_handover',
] as const

// ─── All togglable permissions combined ───
export const TOGGLABLE_PERMISSIONS = [
  ...MODULE_PERMISSIONS,
  ...REPORT_PERMISSIONS,
] as const

export type TogglablePermission = typeof TOGGLABLE_PERMISSIONS[number]

export const TOGGLABLE_PERMISSION_LABELS: Record<string, { ar: string; en: string; group: 'modules' | 'reports' }> = {
  // ─── Modules ───
  dashboard:         { ar: 'لوحة التحكم', en: 'Dashboard', group: 'modules' },
  projects:          { ar: 'المشاريع', en: 'Projects', group: 'modules' },
  drive_lines:       { ar: 'خطوط الحفر', en: 'Drilling Lines', group: 'modules' },
  daily_reports:     { ar: 'التقارير اليومية', en: 'Daily Reports', group: 'modules' },
  safety:            { ar: 'السلامة', en: 'Safety', group: 'modules' },
  equipment:         { ar: 'المعدات', en: 'Equipment', group: 'modules' },
  costs:             { ar: 'التكاليف والإيرادات', en: 'Costs & Revenue', group: 'modules' },
  finishings:        { ar: 'التشطيبات', en: 'Finishings', group: 'modules' },
  performance:       { ar: 'تقييم الأداء', en: 'Performance', group: 'modules' },
  // ─── Reports ───
  report_daily_site: { ar: 'تقرير الموقع اليومي', en: 'Daily Site Report', group: 'reports' },
  report_production: { ar: 'تقرير الإنتاج اليومي', en: 'Production Report', group: 'reports' },
  report_safety:     { ar: 'تقرير السلامة', en: 'Safety Report', group: 'reports' },
  report_attendance: { ar: 'تقرير الحضور', en: 'Attendance Report', group: 'reports' },
  report_revenue:    { ar: 'تقرير الإيرادات', en: 'Revenue Report', group: 'reports' },
  report_costs:      { ar: 'تقرير التكاليف', en: 'Cost Report', group: 'reports' },
  report_profit:     { ar: 'تقرير صافي الربح', en: 'Profit Report', group: 'reports' },
  report_equipment:  { ar: 'تقرير المعدات', en: 'Equipment Report', group: 'reports' },
  report_weekly:     { ar: 'تقرير الإنجاز الأسبوعي', en: 'Weekly Progress', group: 'reports' },
  report_monthly:    { ar: 'تقرير شهري للإدارة', en: 'Monthly Management', group: 'reports' },
  report_handover:   { ar: 'تقرير تسليم الأعمال', en: 'Handover Report', group: 'reports' },
}

// Role permissions matrix (base permissions per role)
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
    'dashboard', 'projects', 'equipment', 'safety', 'reports', 'notifications',
  ],
  foreman: [
    'dashboard', 'projects', 'daily_reports', 'reports', 'notifications',
  ],
  accountant: [
    'dashboard', 'projects', 'costs', 'reports', 'notifications',
  ],
}

/**
 * Check if a user has access to a resource.
 * For togglable resources: custom permissions override role defaults.
 * For non-togglable resources (notifications): role only.
 */
export function hasPermission(role: string, resource: string, customPermissions?: string[]): boolean {
  if (customPermissions && customPermissions.length > 0) {
    return customPermissions.includes(resource)
  }
  const perms = ROLE_PERMISSIONS[role] || []
  return perms.includes('*') || perms.includes(resource)
}

  if (isTogglable && userPermissions && typeof userPermissions[resource] === 'boolean') {
    return userPermissions[resource]
  }

  const perms = ROLE_PERMISSIONS[role] || []
  return perms.includes('*') || perms.includes(resource)
}

/**
 * Check if a user has access to a specific report type.
 * Falls back to role-based "reports" permission if no custom report permission is set.
 */
export function hasReportPermission(
  role: string,
  reportId: string,
  userPermissions?: Record<string, boolean> | null
): boolean {
  const permKey = `report_${reportId}`

  // If custom permission is explicitly set, use it
  if (userPermissions && typeof userPermissions[permKey] === 'boolean') {
    return userPermissions[permKey]
  }

  // Otherwise, if the role has general "reports" access, allow all reports
  const perms = ROLE_PERMISSIONS[role] || []
  return perms.includes('*') || perms.includes('reports')
}
