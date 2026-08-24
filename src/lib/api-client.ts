// Centralized API client
// C-2 FIX: Relies on httpOnly cookie only — no localStorage token, no Authorization header

'use client'

import { useAppStore } from '@/lib/store'

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: any
  headers?: Record<string, string>
}

interface ApiResult<T = any> {
  data: T | null
  error: string | null
  message?: string | null
  status: number
  ok: boolean
}

/**
 * Clear session on 401 (called from authedFetch)
 */
function clearClientSession(): void {
  try {
    useAppStore.getState().setUser(null)
  } catch {}
}

/**
 * Authenticated fetch — uses httpOnly cookie for auth (credentials: 'include')
 */
export async function authedFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  }

  if (options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json'
  }

  const res = await fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  })

  if (res.status === 401) {
    clearClientSession()
  }

  return res
}

/**
 * Make an authenticated API request.
 */
export async function apiRequest<T = any>(
  url: string,
  options: ApiOptions = {}
): Promise<ApiResult<T>> {
  try {
    const result = await authedFetch(url, {
      method: options.method || 'GET',
      headers: options.headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    })

    if (result.status === 401) {
      return { data: null, error: 'session_expired', status: 401, ok: false }
    }

    let data: any = null
    try {
      data = await result.json()
    } catch {}

    if (!result.ok) {
      return {
        data: null,
        error: data?.error || `Request failed with status ${result.status}`,
        message: data?.message || null,
        status: result.status,
        ok: false,
      }
    }

    return { data, error: null, status: result.status, ok: true }
  } catch {
    return { data: null, error: 'network_error', status: 0, ok: false }
  }
}

/**
 * Legacy function kept for backward compatibility.
 * No longer stores token — session is managed via httpOnly cookie.
 */
export function saveStoredToken(_token: string): void {
  // No-op: token is in httpOnly cookie only
}

/**
 * Legacy function kept for backward compatibility.
 */
export function clearStoredToken(): void {
  clearClientSession()
}

export function getErrorMessage(error: string, isRtl: boolean, customMessage?: string | null): string {
  const messages: Record<string, { ar: string; en: string }> = {
    session_expired: { ar: 'انتهت الجلسة - يرجى إعادة تسجيل الدخول', en: 'Session expired - please login again' },
    network_error: { ar: 'فشل الاتصال بالخادم - تحقق من اتصالك بالإنترنت', en: 'Failed to connect to server - check your internet connection' },
    unauthorized: { ar: 'غير مصرح - يرجى تسجيل الدخول', en: 'Unauthorized - please login' },
    not_found: { ar: 'غير موجود', en: 'Not found' },
    forbidden: { ar: 'لا تملك صلاحية لهذا الإجراء', en: 'You do not have permission for this action' },
    validation_error: { ar: 'بيانات غير صحيحة', en: 'Invalid data' },
    missing_fields: { ar: 'يرجى ملء جميع الحقول المطلوبة', en: 'Please fill all required fields' },
    invalid_date: { ar: 'صيغة التاريخ غير صحيحة', en: 'Invalid date format' },
    duplicate_code: { ar: 'رمز المشروع مستخدم بالفعل', en: 'Project code already exists' },
    database_not_initialized: { ar: 'قاعدة البيانات غير مهيأة - يرجى التواصل مع المدير', en: 'Database not initialized - please contact administrator' },
    database_readonly: { ar: 'قاعدة البيانات للقراءة فقط - تحقق من الصلاحيات', en: 'Database is read-only - check permissions' },
    create_failed: { ar: 'فشل في الإنشاء', en: 'Failed to create' },
    database_error: { ar: 'خطأ في قاعدة البيانات', en: 'Database error' },
    init_failed: { ar: 'فشل في التهيئة', en: 'Initialization failed' },
    internal_error: { ar: 'خطأ داخلي في الخادم', en: 'Internal server error' },
    too_many_requests: { ar: 'طلبات كثيرة جداً - يرجى الانتظار', en: 'Too many requests - please wait' },
  }

  const msg = messages[error]
  if (msg) {
    const baseMsg = isRtl ? msg.ar : msg.en
    if (customMessage && customMessage !== baseMsg) {
      return `${baseMsg}: ${customMessage}`
    }
    return baseMsg
  }

  if (customMessage) return customMessage
  return isRtl ? 'حدث خطأ، يرجى المحاولة مرة أخرى' : 'An error occurred, please try again'
}
