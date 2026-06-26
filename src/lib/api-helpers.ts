// Server-side helper for consistent API error handling
// Used by all API routes to ensure uniform error responses

import { NextResponse } from 'next/server'

export interface ApiError {
  error: string
  message: string
  details?: string
  fields?: string[]
}

/**
 * Handle database errors with specific, helpful messages
 */
export function handleDbError(error: any, operation: string = 'operation'): NextResponse {
  console.error(`Database error during ${operation}:`, error)

  const errorMsg = String(error?.message || error)

  // Schema/table/relation doesn't exist (PostgreSQL / Supabase)
  if (errorMsg.includes('does not exist') || errorMsg.includes('no such table') || errorMsg.includes('relation')) {
    return NextResponse.json({
      error: 'database_not_initialized',
      message: 'قاعدة البيانات غير مهيأة. تأكد من تشغيل migrations على Supabase.',
      details: errorMsg,
    }, { status: 500 })
  }

  // Connection errors (Supabase pooler / network)
  if (errorMsg.includes('ECONNREFUSED') || errorMsg.includes('ENOTFOUND') || errorMsg.includes('connection') || errorMsg.includes('timeout') || errorMsg.includes('pool')) {
    return NextResponse.json({
      error: 'database_connection',
      message: 'فشل الاتصال بقاعدة البيانات. تحقق من إعدادات Supabase وDATABASE_URL.',
      details: errorMsg,
    }, { status: 500 })
  }

  // Unique constraint violation (PostgreSQL)
  if (errorMsg.includes('Unique constraint') || errorMsg.includes('unique constraint') || errorMsg.includes('duplicate key') || errorMsg.includes('UNIQUE constraint failed')) {
    return NextResponse.json({
      error: 'duplicate_entry',
      message: 'القيمة المدخلة موجودة بالفعل. يرجى استخدام قيمة مختلفة.',
      details: errorMsg,
    }, { status: 400 })
  }

  // Foreign key constraint (PostgreSQL)
  if (errorMsg.includes('Foreign key') || errorMsg.includes('foreign key') || errorMsg.includes('FOREIGN KEY constraint failed') || errorMsg.includes('violates foreign key')) {
    return NextResponse.json({
      error: 'invalid_reference',
      message: 'المرجع غير صالح. تأكد من صحة المعرفات المرتبطة.',
      details: errorMsg,
    }, { status: 400 })
  }

  // Required field missing / NOT NULL violation (PostgreSQL)
  if ((errorMsg.includes('required') && errorMsg.includes('null')) || errorMsg.includes('NOT NULL') || errorMsg.includes('null value')) {
    return NextResponse.json({
      error: 'missing_required_field',
      message: 'حقل مطلوب مفقود. يرجى ملء جميع الحقول الإلزامية.',
      details: errorMsg,
    }, { status: 400 })
  }

  // Invalid value
  if (errorMsg.includes('invalid') || errorMsg.includes('Invalid')) {
    return NextResponse.json({
      error: 'invalid_value',
      message: 'قيمة غير صحيحة. يرجى التحقق من البيانات المدخلة.',
      details: errorMsg,
    }, { status: 400 })
  }

  // Generic database error
  return NextResponse.json({
    error: 'database_error',
    message: `فشل في ${operation}. يرجى المحاولة مرة أخرى.`,
    details: errorMsg,
  }, { status: 500 })
}

/**
 * Validate required fields in request body
 */
export function validateRequired(body: any, fields: string[]): NextResponse | null {
  const missing = fields.filter(field => {
    const value = body[field]
    return value === undefined || value === null || value === '' ||
           (typeof value === 'string' && value.trim() === '')
  })

  if (missing.length > 0) {
    return NextResponse.json({
      error: 'missing_fields',
      message: `حقول مطلوبة مفقودة: ${missing.join(', ')}`,
      fields: missing,
    }, { status: 400 })
  }

  return null
}

/**
 * Safely parse a number from request body
 */
export function parseNumber(value: any, defaultValue: number = 0): number {
  if (value === undefined || value === null || value === '') return defaultValue
  const num = parseFloat(String(value))
  return isNaN(num) ? defaultValue : num
}

/**
 * Safely parse a date from request body
 */
export function parseDate(value: any, defaultDaysFromNow: number = 0): Date {
  if (!value) {
    const d = new Date()
    d.setDate(d.getDate() + defaultDaysFromNow)
    return d
  }
  const d = new Date(value)
  if (isNaN(d.getTime())) {
    const fallback = new Date()
    fallback.setDate(fallback.getDate() + defaultDaysFromNow)
    return fallback
  }
  return d
}

/**
 * Safely execute a database operation with error handling
 */
export async function safeDbOp<T>(
  operation: () => Promise<T>,
  opName: string
): Promise<{ success: true; data: T } | { success: false; response: NextResponse }> {
  try {
    const data = await operation()
    return { success: true, data }
  } catch (error) {
    return { success: false, response: handleDbError(error, opName) }
  }
}
