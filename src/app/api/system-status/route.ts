// v57: تشخيص النظام — أداة كشف ذاتي لسبب تعطّل الأقسام
// تُجيب بالضبط عن الأسئلة التي كنا نخمّنها: هل قاعدة البيانات متصلة وبأي سرعة؟
// هل كل الجداول الحرجة موجودة؟ هل كل الأعمدة الحرجة موجودة؟
// أي قسم «لا يفتح» أو تقرير «لا يُنشأ» سببه غالباً بند في هذه القائمة —
// والآن يظهر للمستخدم مباشرة بدل رسائل عامة مربكة.
// GET /api/system-status — تتطلب تسجيل الدخول (متاحة لكل المستخدمين لأنها لا تكشف أي بيانات)

import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

var APP_VERSION = 'v59'

// الجداول الحرجة لعمل الأقسام المتعثرة (السلامة + الموارد البشرية) وبقية الأقسام الأساسية
var CRITICAL_TABLES = [
  { name: 'User', label: 'المستخدمون' },
  { name: 'Project', label: 'المشاريع' },
  { name: 'DriveLine', label: 'خطوط الحفر' },
  { name: 'DailyReport', label: 'التقارير اليومية' },
  { name: 'SafetyReport', label: 'تقارير السلامة' },
  { name: 'Worker', label: 'العمال' },
  { name: 'Cost', label: 'التكاليف' },
  { name: 'Task', label: 'المهام' },
  { name: 'Purchase', label: 'المشتريات' },
  { name: 'Notification', label: 'الإشعارات' },
  { name: 'AuditLog', label: 'سجل التدقيق' },
  { name: 'LeaveRequest', label: 'طلبات الإجازات' },
  { name: 'LeaveBalance', label: 'أرصدة الإجازات' },
  { name: 'Holiday', label: 'العطلات الرسمية' },
  { name: 'LeavePolicy', label: 'سياسة الإجازات' },
  { name: 'LeaveAdjustment', label: 'تعديلات الرصيد' },
]

// الأعمدة الحرجة التي أُضيفت للنموذج بعد آخر migration وتُقرأ في مسارات فعّالة
var CRITICAL_COLUMNS: Array<{ table: string; column: string; label: string }> = [
  { table: 'DailyReport', column: 'safetyLocked', label: 'قفل تقرير السلامة (إنشاء تقارير السلامة)' },
  { table: 'User', column: 'avatar', label: 'صورة الملف الشخصي' },
  { table: 'User', column: 'points', label: 'نقاط الملف الشخصي' },
  { table: 'User', column: 'employeeNo', label: 'الرقم الوظيفي' },
  { table: 'User', column: 'jobTitle', label: 'المسمى الوظيفي' },
  { table: 'User', column: 'department', label: 'القسم' },
  { table: 'User', column: 'workLocation', label: 'موقع العمل' },
  { table: 'User', column: 'supervisorId', label: 'المسؤول المباشر' },
  { table: 'User', column: 'joinDate', label: 'تاريخ التعيين' },
  { table: 'User', column: 'contractStart', label: 'بداية العقد' },
  { table: 'User', column: 'contractEnd', label: 'نهاية العقد' },
  { table: 'User', column: 'baseSalary', label: 'الراتب الأساسي' },
  { table: 'User', column: 'allowances', label: 'البدلات' },
  { table: 'User', column: 'passportNo', label: 'رقم الجواز' },
  { table: 'User', column: 'passportExpiry', label: 'انتهاء الجواز' },
  { table: 'User', column: 'idNo', label: 'رقم الهوية' },
  { table: 'User', column: 'idExpiry', label: 'انتهاء الهوية' },
  { table: 'User', column: 'residenceNo', label: 'رقم الإقامة' },
  { table: 'User', column: 'residenceExpiry', label: 'انتهاء الإقامة' },
  { table: 'User', column: 'absenceDays', label: 'أيام الغياب' },
  { table: 'User', column: 'lateDays', label: 'أيام التأخير' },
]

export async function GET(req: NextRequest) {
  var me = await getAuthUser(req)
  if (!me) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  var result: any = {
    version: APP_VERSION,
    time: new Date().toISOString(),
    db: { connected: false, latencyMs: null as number | null },
    missingTables: [] as Array<{ name: string; label: string }>,
    missingColumns: [] as Array<{ table: string; column: string; label: string }>,
    ok: false,
  }

  // 1) فحص الاتصال وقياس زمن الاستجابة
  var t0 = Date.now()
  try {
    await db.$queryRaw`SELECT 1`
    result.db.connected = true
    result.db.latencyMs = Date.now() - t0
  } catch (e) {
    result.db.error = 'تعذر الاتصال بقاعدة البيانات — إن كانت قاعدة Supabase متوقفة (Paused) فأعد تشغيلها من لوحة Supabase ثم أعد المحاولة'
    return NextResponse.json(result)
  }

  try {
    // 2) الجداول الحرجة — استعلام واحد
    var names = CRITICAL_TABLES.map(function(t) { return "'" + t.name + "'" }).join(',')
    var tables = await db.$queryRawUnsafe<Array<{ table_name: string }>>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN (" + names + ')'
    )
    var tableSet = new Set<string>((tables || []).map(function(t) { return t.table_name }))
    for (var i = 0; i < CRITICAL_TABLES.length; i++) {
      var ct = CRITICAL_TABLES[i]
      if (!tableSet.has(ct.name)) result.missingTables.push(ct)
    }

    // 3) الأعمدة الحرجة — استعلام واحد لكل الجداول المعنية
    var colTables = Array.from(new Set(CRITICAL_COLUMNS.map(function(c) { return c.table })))
      .map(function(t) { return "'" + t + "'" }).join(',')
    var cols = await db.$queryRawUnsafe<Array<{ table_name: string; column_name: string }>>(
      "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN (" + colTables + ')'
    )
    var colKey = new Set<string>((cols || []).map(function(c) { return c.table_name + '.' + c.column_name }))
    for (var j = 0; j < CRITICAL_COLUMNS.length; j++) {
      var cc = CRITICAL_COLUMNS[j]
      if (!colKey.has(cc.table + '.' + cc.column)) result.missingColumns.push(cc)
    }

    result.ok = result.missingTables.length === 0 && result.missingColumns.length === 0
    // خلاصة جاهزة للقراءة مباشرة (وللقطة شاشة تُرسل لنا)
    if (result.ok) {
      result.summary = 'كل شيء سليم — قاعدة البيانات متصلة (' + result.db.latencyMs + 'ms) وكل الجداول والأعمدة الحرجة موجودة. إن استمرت مشكلة بقسم معين فالسبب على الأرجح مؤقت (مهلة المنصة) — أعد المحاولة بعد قليل.'
    } else {
      var parts: string[] = []
      if (result.missingTables.length) {
        parts.push('جداول مفقودة: ' + result.missingTables.map(function(t) { return t.label }).join('، '))
      }
      if (result.missingColumns.length) {
        parts.push('حقول مفقودة: ' + result.missingColumns.map(function(c) { return c.label }).join('، '))
      }
      result.summary = 'وجدنا سبب المشكلة — ' + parts.join(' — ') + '. افتح القسم المتعثر مرة أخرى: نظام الشفاء الذاتي سينشئ الناقص تلقائياً عند أول محاولة، ثم أعد فحص التشخيص للتأكد.'
    }
    return NextResponse.json(result)
  } catch (e) {
    result.db.error = 'فشل فحص بنية قاعدة البيانات — ' + String((e as { message?: string })?.message || e).slice(0, 200)
    return NextResponse.json(result)
  }
}
