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
