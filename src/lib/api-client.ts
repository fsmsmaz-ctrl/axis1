// Centralized API client with session management
// Uses localStorage directly (synchronous) for maximum reliability
// Falls back to cookie-based auth if token is missing

'use client'

import { useAppStore } from '@/lib/store'

const TOKEN_KEY = 'axis_token'

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
 * Get the JWT token from localStorage (synchronous, always available)
 * This is more reliable than reading from Zustand store because
 * localStorage is synchronously available on every render
 */
function getStoredToken(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

/**
 * Save the JWT token to localStorage AND Zustand store
 */
export function saveStoredToken(token: string): void {
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(TOKEN_KEY, token)
    } catch {
      // ignore
    }
  }
  // Also save to Zustand for UI state
  try {
    useAppStore.getState().setToken(token)
  } catch {
    // ignore
  }
}

/**
 * Remove the JWT token from localStorage AND Zustand store
 */
export function clearStoredToken(): void {
  if (typeof window !== 'undefined') {
    try {
      localStorage.removeItem(TOKEN_KEY)
    } catch {
      // ignore
    }
  }
  try {
    useAppStore.getState().setToken(null)
  } catch {
    // ignore
  }
}

/**
 * Authenticated fetch - drop-in replacement for fetch()
 * Automatically adds Authorization header with JWT token from localStorage
 * Use this for ALL API requests to ensure authentication works
 */
export async function authedFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  // Read token synchronously from localStorage
  const token = getStoredToken()

  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  }

  // Add Authorization header if we have a token
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  // Set Content-Type for requests with body
  if (options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json'
  }

  const res = await fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  })

  // If unauthorized, clear session (but don't throw - let caller handle the 401)
  if (res.status === 401) {
    const state = useAppStore.getState()
    state.setUser(null)
    state.setToken(null)
    // Also clear localStorage
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem(TOKEN_KEY)
      } catch {
        // ignore
      }
    }
  }

  return res
}

/**
 * Make an authenticated API request.
 * Sends token via BOTH cookie AND Authorization header for maximum compatibility.
 * Automatically handles 401 errors by clearing the session.
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
      return {
        data: null,
        error: 'session_expired',
        status: 401,
        ok: false,
      }
    }

    // Try to parse JSON response
    let data: any = null
    try {
      data = await result.json()
    } catch {
      // Response might not have a body
    }

    if (!result.ok) {
      return {
        data: null,
        error: data?.error || `Request failed with status ${result.status}`,
        message: data?.message || data?.details || null,
        status: result.status,
        ok: false,
      }
    }

    return {
      data,
      error: null,
      status: result.status,
      ok: true,
    }
  } catch (error) {
    return {
      data: null,
      error: 'network_error',
      status: 0,
      ok: false,
    }
  }
}

/**
 * Get the localized error message based on error code
 */
export function getErrorMessage(error: string, isRtl: boolean, customMessage?: string | null): string {
  const messages: Record<string, { ar: string; en: string }> = {
    session_expired: {
      ar: 'انتهت الجلسة - يرجى إعادة تسجيل الدخول',
      en: 'Session expired - please login again',
    },
    network_error: {
      ar: 'فشل الاتصال بالخادم - تحقق من اتصالك بالإنترنت',
      en: 'Failed to connect to server - check your internet connection',
    },
    unauthorized: {
      ar: 'غير مصرح - يرجى تسجيل الدخول',
      en: 'Unauthorized - please login',
    },
    not_found: {
      ar: 'غير موجود',
      en: 'Not found',
    },
    forbidden: {
      ar: 'لا تملك صلاحية لهذا الإجراء',
      en: 'You do not have permission for this action',
    },
    validation_error: {
      ar: 'بيانات غير صحيحة',
      en: 'Invalid data',
    },
    missing_fields: {
      ar: 'يرجى ملء جميع الحقول المطلوبة',
      en: 'Please fill all required fields',
    },
    invalid_date: {
      ar: 'صيغة التاريخ غير صحيحة',
      en: 'Invalid date format',
    },
    duplicate_code: {
      ar: 'رمز المشروع مستخدم بالفعل',
      en: 'Project code already exists',
    },
    database_not_initialized: {
      ar: 'قاعدة البيانات غير مهيأة - يرجى التواصل مع المدير',
      en: 'Database not initialized - please contact administrator',
    },
    database_readonly: {
      ar: 'قاعدة البيانات للقراءة فقط - تحقق من الصلاحيات',
      en: 'Database is read-only - check permissions',
    },
    create_failed: {
      ar: 'فشل في الإنشاء',
      en: 'Failed to create',
    },
    database_error: {
      ar: 'خطأ في قاعدة البيانات',
      en: 'Database error',
    },
    init_failed: {
      ar: 'فشل في التهيئة',
      en: 'Initialization failed',
    },
    internal_error: {
      ar: 'خطأ داخلي في الخادم',
      en: 'Internal server error',
    },
  }

  const msg = messages[error]
  if (msg) {
    const baseMsg = isRtl ? msg.ar : msg.en
    // If there's a custom message with details, append it
    if (customMessage && customMessage !== baseMsg) {
      return `${baseMsg}: ${customMessage}`
    }
    return baseMsg
  }

  // If there's a custom message, use it
  if (customMessage) {
    return customMessage
  }

  // Default error message
  return isRtl ? 'حدث خطأ، يرجى المحاولة مرة أخرى' : 'An error occurred, please try again'
}
