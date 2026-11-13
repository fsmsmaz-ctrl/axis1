// ============================================================
// v110 — رفع ملف الفواتير: مسار الاستيراد التلقائي إلى قسم التكاليف
// ============================================================
// POST /api/costs-import  (multipart/form-data)
//   file      : ملف الإكسل (xlsx / xls / csv) — حد 4 ميجابايت
//   mode      : 'analyze' (تحليل ومعاينة فقط بلا أي كتابة) | 'commit' (إنشاء فعلي)
//   projectId : اختياري — يُسند لكل الفواتير المستوردة (أو تُترك «بدون مشروع»)
//
// بوابات الحماية (مطابقة تماماً لبوابات POST /api/costs):
//   - جلسة دخول صحيحة (401)
//   - صلاحية كتابة التكاليف canWrite(role,'costs') (403)
//   - حد معدل الطلبات write (429)
//   - إعادة التحقق الكامل من كل صف على الخادم (المبلغ > 0 و ≤ 10,000,000،
//     التصنيف من القائمة المعتمدة، تاريخ صحيح) — لا ثقة أبداً ببيانات المتصفح
//
// سلامة المعاملة: الإنشاء داخل معاملة واحدة (createMany + سجل تدقيق ملخص)
// — إما يُستورد الملف كاملاً أو لا يُستورد شيء، فلا فواتير ناقصة أبداً.
//
// التوافق مع أداة «استرجاع الفواتير» (v34):
//   - سجل التدقيق الملخص يستخدم action='import' (الاسترجاع يقرأ 'create' فقط)
//   - رسالة الإشعار تبدأ بـ«تم استيراد...» وليس «تم إضافة تكلفة:» عمداً —
//     محلل رسائل الاسترجاع الصارم لن يلتقطها فلن تُنشأ فواتير وهمية يومًا
//   - كل فاتورة مستوردة تحمل في ملاحظاتها «مستوردة من ملف: اسم الملف — صف N»
//     فيسهل تتبعها وحذفها فردياً من جدول التكاليف عند الحاجة
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { safeDbOp, handleDbError } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { canWrite } from '@/lib/auth'
import { notifyUsers } from '@/lib/notify'
import { parseInvoiceWorkbook, MAX_IMPORT_ROWS, MAX_IMPORT_FILE_BYTES } from '@/lib/invoice-import'

export async function POST(req: NextRequest) {
  var user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  // التقاط هوية المستخدم مرة واحدة — النمط نفسه في POST /api/costs
  // (TypeScript يفقد تضييق «ليس فارغاً» داخل الدوال المغلقة لمتغيرات var)
  var userId = user.id

  // نفس بوابة كتابة التكاليف: الإدارة والمدير المالي والإداري فقط
  if (!canWrite(user.role, 'costs', user.permissions)) {
    return NextResponse.json(
      { error: 'forbidden', message: 'رفع ملفات الفواتير متاح للإدارة والمدير المالي والإداري فقط' },
      { status: 403 }
    )
  }

  var rl = checkRateLimit(req, RateLimitPresets.write)
  if (rl.limited) {
    return NextResponse.json(
      { error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار قليلاً' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    )
  }

  try {
    var form = await req.formData()

    var mode = String(form.get('mode') || '')
    if (mode !== 'analyze' && mode !== 'commit') {
      return NextResponse.json({ error: 'invalid_mode', message: 'نمط الطلب غير معروف' }, { status: 400 })
    }

    var file = form.get('file')
    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'no_file', message: 'لم يُرفق ملف — اختر ملف الإكسل أولاً' }, { status: 400 })
    }

    var fileName = (file as File).name || 'invoices.xlsx'
    var lowerName = fileName.toLowerCase()
    if (!/\.(xlsx|xls|csv)$/.test(lowerName)) {
      return NextResponse.json(
        { error: 'unsupported_format', message: 'صيغة الملف غير مدعومة — المسموح: xlsx أو xls أو csv' },
        { status: 400 }
      )
    }

    var buf = Buffer.from(await (file as File).arrayBuffer())
    if (!buf.length) {
      return NextResponse.json({ error: 'empty_file', message: 'الملف فارغ' }, { status: 400 })
    }
    if (buf.length > MAX_IMPORT_FILE_BYTES) {
      return NextResponse.json(
        { error: 'file_too_large', message: 'حجم الملف يتجاوز 4 ميجابايت — قسّم الملف إلى أجزاء أصغر ثم ارفعها تباعاً' },
        { status: 400 }
      )
    }

    // التحليل (قراءة فقط) — النتيجة تُعاد للمعاينة أو تُستخدم للإنشاء مباشرة
    var analysis = parseInvoiceWorkbook(buf, fileName)

    if (!analysis.ok) {
      return NextResponse.json(
        {
          ok: false,
          message: analysis.message || 'تعذر تحليل الملف',
          fileName: analysis.fileName,
          sheetName: analysis.sheetName,
          mapping: analysis.mapping,
          stats: analysis.stats,
          errors: analysis.errors.slice(0, 12),
        },
        { status: 400 }
      )
    }

    if (analysis.rows.length > MAX_IMPORT_ROWS) {
      return NextResponse.json(
        {
          error: 'too_many_rows',
          message: 'عدد الفواتير الصالحة في الملف (' + analysis.rows.length + ') يتجاوز الحد الأقصى (' + MAX_IMPORT_ROWS + ') — قسّم الملف إلى أجزاء ثم ارفعها تباعاً',
        },
        { status: 400 }
      )
    }

    // ── المعاينة: لا كتابة إطلاقاً في قاعدة البيانات ──
    if (mode === 'analyze') {
      return NextResponse.json({
        ok: true,
        mode: 'analyze',
        fileName: analysis.fileName,
        sheetName: analysis.sheetName,
        mapping: analysis.mapping,
        stats: analysis.stats,
        preview: analysis.rows.slice(0, 12),
        errors: analysis.errors.slice(0, 12),
      })
    }

    // ── الإنشاء الفعلي بعد تأكيد الموظف ──

    // إسناد المشروع: يُتحقق من وجوده على الخادم — معرف غير صحيح يتحول إلى «بدون مشروع»
    var projectIdRaw = String(form.get('projectId') || '')
    var projectId: string | null = null
    if (projectIdRaw && projectIdRaw !== 'none') {
      var proj = await safeDbOp(
        () => db.project.findUnique({ where: { id: projectIdRaw }, select: { id: true } }),
        'التحقق من المشروع'
      )
      if (proj.success && proj.data) projectId = projectIdRaw
    }

    // إعادة بناء بيانات الإنشاء من نتائج التحليل على الخادم (كل صف أعيد التحقق منه في المحلل:
    // المبلغ موجب ≤ 10,000,000، تاريخ صحيح، التصنيف من القائمة المعتمدة، الوصف ≤ 1000، الملاحظات ≤ 2000)
    var importData = analysis.rows.map(function(r) {
      return {
        projectId: projectId,
        date: new Date(r.dateISO),
        category: r.category,
        description: r.description,
        amount: r.amount,
        notes: r.notes,
        recordedById: userId,
      }
    })

    var auditId = 'excel-import-' + Date.now()
    var txResult = await safeDbOp(
      () => db.$transaction([
        db.cost.createMany({ data: importData }),
        db.auditLog.create({
          data: {
            userId: userId,
            projectId: projectId,
            action: 'import',
            entity: 'cost',
            entityId: auditId,
            details: 'Excel import: ' + importData.length + ' invoices, total ' + analysis.stats.totalAmount + ' OMR, file: ' + fileName,
          },
        }),
      ]),
      'إنشاء فواتير من ملف الإكسل'
    )
    if (!txResult.success) return txResult.response

    // تنبيه موجّه لذوي صلاحية التكاليف (غير حرج — فشله لا يفشل الاستيراد)
    // الرسالة لا تطابق نمط «تم إضافة تكلفة:» عمداً — انظر تعليق التوافق أعلاه
    Promise.all([
      notifyUsers({
        type: 'cost_overrun',
        title: 'استيراد فواتير من ملف إكسل',
        message: 'تم استيراد ' + importData.length + ' فاتورة من الملف «' + fileName + '» بإجمالي ' + analysis.stats.totalAmount + ' ر.ع — عبر ميزة رفع ملف الفواتير في قسم التكاليف',
        severity: 'info',
        projectId: projectId,
        entityType: 'cost',
        entityId: auditId,
        permissions: ['costs'],
        roles: ['top_management', 'project_manager', 'accountant'],
        excludeUserIds: [userId],
        includeSystemAdmin: true,
        link: 'costs',
      }),
    ]).catch(function() {})

    return NextResponse.json({
      ok: true,
      mode: 'commit',
      created: importData.length,
      totalAmount: analysis.stats.totalAmount,
      skipped: analysis.errors.length,
      fileName: fileName,
      sheetName: analysis.sheetName,
    })
  } catch (error: any) {
    console.error('[costs-import] failed:', error)
    return handleDbError(error, 'استيراد فواتير من ملف')
  }
}
