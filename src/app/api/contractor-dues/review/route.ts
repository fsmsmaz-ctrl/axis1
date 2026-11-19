// ============================================================
// v123 — المراجعة الفنية لأطوال المقاول (المهندس)
// AXIS Pipe Jacking Management System
// ============================================================
// POST /api/contractor-dues/review — قرار المهندس على الخط المكتمل:
//   approve     اعتماد الأطوال → الحالة Verified + إنشاء مسودة الفاتورة
//               الوحيدة آلياً + إشعار أصحاب الاعتماد المالي
//   correction  طلب تعديل → الأطوال المسجلة غير صحيحة، يعود الخط إلى
//               Completed مع الملاحظات وإشعار المسؤول عن الإدخال
//   reject      رفض → مشكلة جوهرية تمنع اعتماد الأعمال، يعود الخط
//               إلى Completed مع سبب الرفض وإشعار المسؤول
// المستحقات لا تنتقل للمرحلة المالية إطلاقاً إلا بعد اعتماد المهندس.
// الصلاحية: contractor_tech_review (مربوطة بالحساب User ID من إدارة
// المستخدمين) أو مدير النظام — مفروضة من الخادم.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { canWrite, canReviewContractorTechnical, SYSTEM_ADMIN_EMAIL } from '@/lib/auth'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { createDraftInvoiceForLine, round3 } from '@/lib/contractor-dues'
import { ensureContractorDuesSupport } from '@/lib/db-selfheal'
import { db } from '@/lib/db'
import { notifyUsers } from '@/lib/notify'

export const dynamic = 'force-dynamic'

function str(v: unknown, max: number): string {
  var s = String(v == null ? '' : v).trim()
  return s.slice(0, max)
}
function isAdminEmail(email: string): boolean {
  return String(email || '').toLowerCase().trim() === SYSTEM_ADMIN_EMAIL
}

export async function POST(req: NextRequest) {
  var me = await getAuthUser(req)
  if (!me) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })

  var rl = checkRateLimit(req, RateLimitPresets.write)
  if (rl.limited) {
    return NextResponse.json({ error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })
  }

  // الصلاحية من الخادم — المراجعة الفنية محصورة بحساب المهندس المخوّل
  if (!canReviewContractorTechnical(me)) {
    return NextResponse.json({ error: 'forbidden', message: 'المراجعة الفنية لأطوال المقاول محصورة بحساب المهندس المخوّل — صلاحية contractor_tech_review تُمنح من إدارة المستخدمين' }, { status: 403 })
  }

  var body: any = null
  try { body = await req.json() } catch { body = null }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'bad_request', message: 'طلب غير صالح' }, { status: 400 })
  }

  var driveLineId = str(body.driveLineId, 64)
  var decision = str(body.decision, 20)
  var note = str(body.note, 1000)
  if (!driveLineId) return NextResponse.json({ error: 'bad_request', message: 'معرف خط الحفر مطلوب' }, { status: 400 })
  if (['approve', 'correction', 'reject'].indexOf(decision) === -1) {
    return NextResponse.json({ error: 'bad_request', message: 'القرار يجب أن يكون: approve أو correction أو reject' }, { status: 400 })
  }
  if (decision !== 'approve' && note.length < 3) {
    return NextResponse.json({ error: 'bad_request', message: 'ملاحظات التعديل أو سبب الرفض إجبارية (3 أحرف على الأقل)' }, { status: 400 })
  }

  try { await ensureContractorDuesSupport() } catch (e: any) {
    console.error('[contractor-dues review] self-heal failed:', e)
  }

  var line = await db.driveLine.findUnique({
    where: { id: driveLineId },
    include: { project: { select: { name: true } } },
  })
  if (!line) return NextResponse.json({ error: 'not_found', message: 'خط الحفر غير موجود' }, { status: 404 })
  if (line.status !== 'pending_verification') {
    return NextResponse.json({ error: 'bad_request', message: 'هذا الخط ليس بانتظار المراجعة الفنية — حالته الحالية: ' + line.status }, { status: 400 })
  }

  var email = String(me.email || '').toLowerCase().trim()
  var isSystemAdmin = me.isSystemAdmin === true || isAdminEmail(email)
  var costsWrite = canWrite(me.role, 'costs', me.permissions) || isSystemAdmin

  // ── الاعتماد الفني: Verified + إنشاء مسودة الفاتورة الوحيدة آلياً ──
  if (decision === 'approve') {
    // حساب الأطوال للإشعار قبل التحديث
    var agg = await db.dailyReport.aggregate({
      where: { driveLineId: line.id, status: 'approved' },
      _sum: { dailyMeters: true, pipeJackedMeters: true },
    })
    var excavated = round3(Math.max(0, Number(agg._sum.dailyMeters) || 0))
    var piped = round3(Math.max(0, Number(agg._sum.pipeJackedMeters) || 0))

    await db.driveLine.update({
      where: { id: line.id },
      data: {
        status: 'verified',
        verifiedById: me.id,
        verifiedByName: me.name,
        verifiedAt: new Date(),
        verificationNote: note || null,
      },
    })

    await db.auditLog.create({
      data: {
        userId: me.id,
        projectId: line.projectId,
        action: 'approve',
        entity: 'drive_line',
        entityId: line.id,
        details: 'اعتماد فني للأطوال — الخط ' + line.lineNumber + ' — الحفر الفعلي: ' + excavated + ' م، الأنابيب المدفوعة: ' + piped + ' م' + (note ? ' — ملاحظات: ' + note : ''),
      },
    })

    // إنشاء مسودة الفاتورة الوحيدة — النظام يفعلها تلقائياً بعد الاعتماد
    var draft = await createDraftInvoiceForLine(line.id, { id: me.id, name: me.name })
    if (!draft.ok) {
      // الخط معتمد فنياً لكن لا مستحق جديد (كل الأطوال مسويتاً سابقاً) — ليس خطأً
      try {
        await notifyUsers({
          type: 'contractor_line_verified',
          title: 'اعتماد فني لأطوال خط حفر — بلا مستحق جديد',
          message: 'اعتمد المهندس ' + me.name + ' أطوال الخط ' + line.lineNumber + ' (الحفر الفعلي: ' + excavated + ' م). ' + (draft.message || 'لا يوجد مستحق جديد لإنشاء فاتورة — كل الأطوال سبق تسويتها مالياً.'),
          severity: 'info',
          entityType: 'drive_line',
          entityId: line.id,
          link: 'costs',
          permissions: ['contractor_finance_review', 'costs'],
          includeSystemAdmin: true,
        })
      } catch (nE) {
        console.error('[contractor-dues review] notify (no dues) failed (non-fatal):', nE)
      }
      return NextResponse.json({ ok: true, status: 'verified', invoice: null, message: 'اعتمدت أطوال الخط ' + line.lineNumber + '. ' + (draft.message || '') })
    }

    return NextResponse.json({
      ok: true,
      status: 'verified',
      invoice: draft.invoice,
      message: 'اعتمدت أطوال الخط ' + line.lineNumber + ' — أُنشئت مسودة الفاتورة ' + draft.invoice.invoiceNo + ' بصافي ' + draft.invoice.netAmount + ' ر.ع وأُرسلت للاعتماد المالي',
    })
  }

  // ── طلب تعديل أو رفض: يعود الخط إلى Completed مع الملاحظات وإشعار المسؤول ──
  await db.driveLine.update({
    where: { id: line.id },
    data: {
      status: 'completed',
      verificationNote: (decision === 'correction' ? 'طلب تعديل: ' : 'مرفوض: ') + note,
      verifiedById: null,
      verifiedByName: null,
      verifiedAt: null,
    },
  })

  await db.auditLog.create({
    data: {
      userId: me.id,
      projectId: line.projectId,
      action: decision === 'correction' ? 'update' : 'reject',
      entity: 'drive_line',
      entityId: line.id,
      details: (decision === 'correction' ? 'طلب تعديل أطوال' : 'رفض أطوال') + ' — الخط ' + line.lineNumber + ' — ' + note,
    },
  })

  try {
    await notifyUsers({
      type: 'contractor_line_' + (decision === 'correction' ? 'correction' : 'rejected'),
      title: decision === 'correction' ? 'المهندس طلب تعديل أطوال خط حفر' : 'المهندس رفض أطوال خط حفر',
      message: 'الخط ' + line.lineNumber + ' (' + (line.project ? line.project.name : '') + ') — ' + (decision === 'correction' ? 'طلب تعديل الأطوال المسجلة وإعادة إدخال الصحيحة' : 'رُفضت الأطوال لوجود مشكلة جوهرية تمنع اعتماد الأعمال') + ' — بواسطة: ' + me.name + ' — الملاحظات: ' + note,
      severity: 'critical',
      entityType: 'drive_line',
      entityId: line.id,
      link: 'costs',
      permissions: costsWrite ? ['costs'] : ['daily_reports'],
      roles: costsWrite ? [] : ['project_manager', 'site_engineer'],
      includeSystemAdmin: true,
    })
  } catch (nE) {
    console.error('[contractor-dues review] notify submitter failed (non-fatal):', nE)
  }

  return NextResponse.json({
    ok: true,
    status: 'completed',
    message: decision === 'correction'
      ? 'أُعيد الخط ' + line.lineNumber + ' للمسؤول مع ملاحظات التعديل — سيصله إشعار فوري'
      : 'رُفضت أطوال الخط ' + line.lineNumber + ' وسُجل السبب — سيصله إشعار فوري',
  })
}
