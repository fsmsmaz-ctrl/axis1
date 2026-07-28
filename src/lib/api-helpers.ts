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

  if (errorMsg.includes('does not exist') || errorMsg.includes('no such table') || errorMsg.includes('relation')) {
    return NextResponse.json({
      error: 'database_not_initialized',
      message: 'قاعدة البيانات غير مهيأة. تأكد من تشغيل migrations على Supabase.',
      details: errorMsg,
    }, { status: 500 })
  }

  if (errorMsg.includes('ECONNREFUSED') || errorMsg.includes('ENOTFOUND') || errorMsg.includes('connection') || errorMsg.includes('timeout') || errorMsg.includes('pool')) {
    return NextResponse.json({
      error: 'database_connection',
      message: 'فشل الاتصال بقاعدة البيانات. تحكد من إعدادات Supabase وDATABASE_URL.',
      details: errorMsg,
    }, { status: 500 })
  }

  if (errorMsg.includes('Unique constraint') || errorMsg.includes('unique constraint') || errorMsg.includes('duplicate key') || errorMsg.includes('UNIQUE constraint failed')) {
    return NextResponse.json({
      error: 'duplicate_entry',
      message: 'القيمة المدخلة موجودة بالفعل. يرجى استخدام قيمة مختلفة.',
      details: errorMsg,
    }, { status: 400 })
  }

  if (errorMsg.includes('Foreign key') || errorMsg.includes('foreign key') || errorMsg.includes('FOREIGN KEY constraint failed') || errorMsg.includes('violates foreign key')) {
    return NextResponse.json({
      error: 'invalid_reference',
      message: 'المرجع غير صالح. تأكد من صحة المعرفات المرتبطة.',
      details: errorMsg,
    }, { status: 400 })
  }

  if ((errorMsg.includes('required') && errorMsg.includes('null')) || errorMsg.includes('NOT NULL') || errorMsg.includes('null value')) {
    return NextResponse.json({
      error: 'missing_required_field',
      message: 'حقل مطلوب مفقود. يرجى ملء جميع الحقول الإلزامية.',
      details: errorMsg,
    }, { status: 400 })
  }

  if (errorMsg.includes('invalid') || errorMsg.includes('Invalid')) {
    return NextResponse.json({
      error: 'invalid_value',
      message: 'قيمة غير صحيحة. يرجى التحقق من البيانات المدخلة.',
      details: errorMsg,
    }, { status: 400 })
  }

  return NextResponse.json({
    error: 'database_error',
    message: `فشل في ${operation}. يرجى المحاولة مرة أخرى.`,
    details: errorMsg,
  }, { status: 500 })
}

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

export function parseNumber(value: any, defaultValue: number = 0): number {
  if (value === undefined || value === null || value === '') return defaultValue
  const num = parseFloat(String(value))
  return isNaN(num) ? defaultValue : num
}

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

export async function safeDbOp(
  operation: () => Promise<any>,
  opName: string
): Promise<{ success: boolean; data?: any; response?: NextResponse }> {
  try {
    const data = await operation()
    return { success: true, data }
  } catch (error) {
    return { success: false, response: handleDbError(error, opName) }
  }
}

// ==================== Change Tracking for Audit Logs ====================

export interface FieldLabel {
  ar: string
  en: string
}

// Common field labels for audit log display
export const fieldLabels: Record<string, FieldLabel> = {
  // Project fields
  code: { ar: 'رقم المشروع', en: 'Project Code' },
  name: { ar: 'الاسم', en: 'Name' },
  client: { ar: 'العميل', en: 'Client' },
  location: { ar: 'الموقع', en: 'Location' },
  contractNumber: { ar: 'رقم العقد', en: 'Contract No.' },
  workType: { ar: 'نوع العمل', en: 'Work Type' },
  pipeDiameter: { ar: 'قطر الأنابيب', en: 'Pipe Diameter' },
  totalLength: { ar: 'الطول الإجمالي', en: 'Total Length' },
  pricePerMeter: { ar: 'السعر/متر', en: 'Price/Meter' },
  soilType: { ar: 'نوع التربة', en: 'Soil Type' },
  startDate: { ar: 'تاريخ البدء', en: 'Start Date' },
  expectedEnd: { ar: 'التاريخ المتوقع', en: 'Expected End' },
  status: { ar: 'الحالة', en: 'Status' },
  notes: { ar: 'ملاحظات', en: 'Notes' },
  progress: { ar: 'التقدم', en: 'Progress' },
  // Equipment fields
  number: { ar: 'الرقم', en: 'Number' },
  type: { ar: 'النوع', en: 'Type' },
  dailyHours: { ar: 'ساعات التشغيل/يوم', en: 'Daily Hours' },
  lastMaintenance: { ar: 'آخر صيانة', en: 'Last Maintenance' },
  nextMaintenance: { ar: 'الصيانة القادمة', en: 'Next Maintenance' },
  // Cost fields
  date: { ar: 'التاريخ', en: 'Date' },
  category: { ar: 'التصنيف', en: 'Category' },
  description: { ar: 'الوصف', en: 'Description' },
  amount: { ar: 'المبلغ', en: 'Amount' },
  // Company Asset fields
  itemType: { ar: 'نوع الغرض', en: 'Item Type' },
  quantity: { ar: 'الكمية', en: 'Quantity' },
  ownership: { ar: 'نوع الملكية', en: 'Ownership' },
  supplier: { ar: 'الجهة المانحة', en: 'Supplier' },
  rentalCost: { ar: 'تكلفة الإيجار', en: 'Rental Cost' },
  rentalStart: { ar: 'بداية الإيجار', en: 'Rental Start' },
  rentalEnd: { ar: 'نهاية الإيجار', en: 'Rental End' },
  responsibleId: { ar: 'المسؤول', en: 'Responsible' },
  // Finishing fields
  siteCleaned: { ar: 'تنظيف الموقع', en: 'Site Cleaned' },
  wasteRemoved: { ar: 'إزالة النفايات', en: 'Waste Removed' },
  shaftClosed: { ar: 'إغلاق البئر', en: 'Shaft Closed' },
  siteRestored: { ar: 'إعادة الموقع', en: 'Site Restored' },
  lineHandover: { ar: 'تسليم الخط', en: 'Line Handover' },
  clientNotes: { ar: 'ملاحظات العميل', en: 'Client Notes' },
  handoverStatus: { ar: 'حالة التسليم', en: 'Handover Status' },
  projectId: { ar: 'المشروع', en: 'Project' },
}

// Ownership/Status value labels
const valueLabels: Record<string, Record<string, string>> = {
  ownership: {
    owned: 'ملك الشركة', rented: 'مستأجر', borrowed: 'معار',
  },
  status: {
    not_started: 'لم يبدأ', in_progress: 'قيد التنفيذ', suspended: 'معلق', completed: 'مكتمل',
    operational: 'تعمل', stopped: 'متوقفة', maintenance_needed: 'تحتاج صيانة',
    available: 'متاح', in_use: 'قيد الاستخدام', returned: 'تم الإرجاع', damaged: 'متلف',
    draft: 'مسودة', submitted: 'مقدم', approved: 'معتمد', rejected: 'مرفوض',
    pending: 'معلق', accepted: 'مقبول', needs_revision: 'يحتاج مراجعة',
  },
  handoverStatus: {
    pending: 'معلق', accepted: 'مقبول', needs_revision: 'يحتاج مراجعة', rejected: 'مرفوض',
  },
  workType: {
    pipe_jacking: 'Pipe Jacking', microtunneling: 'Microtunneling', hdd: 'HDD', auger_boring: 'Auger Boring',
  },
  category: {
    labor: 'أيدي عاملة', housing: 'سكن', transport: 'نقل', fuel: 'وقود',
    maintenance: 'صيانة', parts: 'قطع غيار', oil: 'زيت', safety: 'سلامة', rental: 'إيجار', other: 'أخرى',
  },
}

function formatValue(key: string, value: any): string {
  if (value === null || value === undefined) return '—'
  if (value === true) return '✓ نعم'
  if (value === false) return '✗ لا'
  if (value instanceof Date) return value.toLocaleDateString('ar-EG')
  if (typeof value === 'string' && value.match(/^\d{4}-\d{2}-\d{2}/)) {
    return new Date(value).toLocaleDateString('ar-EG')
  }
  if (typeof value === 'number') return String(value)
  // Check value labels
  const mapped = valueLabels[key]?.[String(value)]
  if (mapped) return mapped
  return String(value)
}

export interface ChangeDiff {
  field: string
  fieldEn: string
  old: string
  new: string
}

export interface AuditChangeDetails {
  summary: string
  changes: ChangeDiff[]
}

/**
 * Compare old and new data objects, return structured changes for audit log.
 * Pass the raw DB record as `oldData` and the request body as `newData`.
 * `skipFields` are relation fields or fields to ignore.
 */
export function getChangesDiff(
  oldData: Record<string, any>,
  newData: Record<string, any>,
  options?: {
    skipFields?: string[]
    labelOverrides?: Record<string, FieldLabel>
    valueOverrides?: Record<string, Record<string, string>>
  }
): AuditChangeDetails {
  const skipFields = new Set(options?.skipFields || [
    'id', 'createdAt', 'updatedAt', 'projectId', 'cuid',
  ])
  const labelOverrides = options?.labelOverrides || {}
  const changes: ChangeDiff[] = []

  for (const key of Object.keys(newData)) {
    if (skipFields.has(key)) continue

    const oldVal = oldData[key]
    let newVal = newData[key]

    // Normalize for comparison
    let oldNorm = oldVal
    let newNorm = newVal

    // Handle dates
    if (oldVal instanceof Date) oldNorm = oldVal.toISOString().split('T')[0]
    if (typeof newVal === 'string' && newVal.match(/^\d{4}-\d{2}-\d{2}/)) {
      newNorm = newVal
    } else if (newVal instanceof Date) {
      newNorm = newVal.toISOString().split('T')[0]
    }

    // Handle numbers
    if (typeof oldVal === 'number' && typeof newVal === 'string') {
      newNorm = parseFloat(newVal)
      if (isNaN(newNorm)) newNorm = newVal
    }

    // Handle empty strings vs null
    if (newNorm === '' && (oldNorm === null || oldNorm === undefined)) continue
    if (oldNorm === '' && (newNorm === null || newNorm === undefined)) continue

    // Compare
    if (String(oldNorm) === String(newNorm)) continue

    const label = labelOverrides[key] || fieldLabels[key] || { ar: key, en: key }

    changes.push({
      field: label.ar,
      fieldEn: label.en,
      old: formatValue(key, oldVal),
      new: formatValue(key, newVal),
    })
  }

  return { summary: '', changes }
}

/**
 * Build a JSON string for audit log `details` field.
 * If no changes, returns a simple summary string.
 */
export function buildAuditDetails(
  oldData: Record<string, any>,
  newData: Record<string, any>,
  summary: string,
  options?: Parameters<typeof getChangesDiff>[2]
): string {
  const diff = getChangesDiff(oldData, newData, options)
  diff.summary = summary
  if (diff.changes.length === 0) {
    return summary
  }
  return JSON.stringify(diff)
}
