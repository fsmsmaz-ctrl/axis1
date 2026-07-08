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

// Resources that admin can toggle per-user
export const TOGGLABLE_PERMISSIONS = [
  'drive_lines', 'daily_reports', 'safety', 'equipment', 'costs', 'finishings', 'performance',
] as const

export type TogglablePermission = typeof TOGGLABLE_PERMISSIONS[number]

export const TOGGLABLE_PERMISSION_LABELS: Record<string, { ar: string; en: string }> = {
  drive_lines: { ar: 'خطوط الحفر', en: 'Drive Lines' },
  daily_reports: { ar: 'التقارير اليومية', en: 'Daily Reports' },
  safety: { ar: 'السلامة', en: 'Safety' },
  equipment: { ar: 'المعدات', en: 'Equipment' },
  costs: { ar: 'التكاليف والإيرادات', en: 'Costs & Revenue' },
  finishings: { ar: 'التشطيبات', en: 'Finishings' },
  performance: { ar: 'تقييم الأداء', en: 'Performance' },
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

export function hasPermission(role: string, resource: string, userPermissions?: Record<string, boolean> | null): boolean {
  // If resource is non-togglable (dashboard, projects, reports, notifications), use role only
  const isTogglable = (TOGGLABLE_PERMISSIONS as readonly string[]).includes(resource)

  if (isTogglable && userPermissions && typeof userPermissions[resource] === 'boolean') {
    return userPermissions[resource]
  }

  const perms = ROLE_PERMISSIONS[role] || []
  return perms.includes('*') || perms.includes(resource)
}
