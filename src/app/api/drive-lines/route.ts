import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, validateRequired, parseNumber, safeDbOp, sanitizeDriveLine } from '@/lib/api-helpers'
import { canWrite, hasPermission, canViewPricing } from '@/lib/auth'
import { notifyUsers } from '@/lib/notify'

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthUser(req)
    if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })

    // SECURITY FIX: خطوط الحفر تحمل أسعار المتر — بوابة قراءة بالصلاحية
    if (!hasPermission(user.role, 'drive_lines', user.permissions, user.email)) {
      return NextResponse.json({ error: 'forbidden', message: 'لا تملك صلاحية عرض خطوط الحفر' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const projectId = searchParams.get('projectId')
    const where: any = {}
    if (projectId) where.projectId = projectId

    const result = await safeDbOp(
      () => db.driveLine.findMany({
        where,
        include: { project: { select: { id: true, name: true, code: true, pricePerMeter: true } } },
        orderBy: [{ projectId: 'asc' }, { lineNumber: 'asc' }],
        take: 200,
      }), 'جلب خطوط الحفر'
    )
    if (!result.success) return result.response

    var driveLines = result.data

    // v14.2 SECURITY FIX (الثغرة الرئيسية): كان هذا المسار يُرجع سعر المتر لكل من
    // يفتح صفحة خطوط الحفر — بما في ذلك المشرف العام. التعقيم هنا يحذف
    // pricePerMeter من كل خط ومن المشروع المضمّن فيه قبل الإرسال،
    // إلا للإدارة العليا ومدير المشروع فقط (canViewPricing يستثني admin@axis.om صراحةً).
    var canSeePrice = canViewPricing(user)
    for (var k = 0; k < driveLines.length; k++) {
      sanitizeDriveLine(driveLines[k], canSeePrice)
    }

    // Dynamic progress: calculate from MAX endReading of daily reports (single query)
    if (driveLines.length > 0) {
      try {
        var dlIds: string[] = driveLines.map(function(dl: any) { return dl.id })
        var maxReadings = await (db.dailyReport.groupBy as any)({
          by: ['driveLineId'],
          where: { driveLineId: { in: dlIds } },
          _max: { endReading: true },
        })
        // Build map: driveLineId -> maxEndReading
        var readingMap: Record<string, number> = {}
        for (var i = 0; i < maxReadings.length; i++) {
          var dlKey = String(maxReadings[i].driveLineId || '')
          readingMap[dlKey] = maxReadings[i]._max.endReading || 0
        }
        // Apply to each drive line
        for (var j = 0; j < driveLines.length; j++) {
          var dl = driveLines[j]
          var completedLength = readingMap[dl.id] || 0
          var progress = dl.totalLength > 0 ? (completedLength / dl.totalLength) * 100 : 0
          dl.completedLength = completedLength
          dl.progress = Math.min(progress, 100)
          dl.status = progress >= 100 ? 'completed' : (completedLength > 0 ? 'in_progress' : dl.status)
        }
      } catch (e) {
        // Keep stored values if dynamic calc fails
      }
    }

    return NextResponse.json({ driveLines: driveLines })
  } catch (error: any) {
    return handleDbError(error, 'جلب خطوط الحفر')
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser(req)
    if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })

    if (!canWrite(user.role, 'drive_lines', user.permissions)) {
      return NextResponse.json({ error: 'forbidden', message: 'لا تملك صلاحية لإنشاء خطوط حفر' }, { status: 403 })
    }

    const body = await req.json()
    const validationError = validateRequired(body, ['projectId', 'lineNumber', 'startPoint', 'endPoint', 'totalLength', 'diameter', 'pipeType', 'soilType'])
    if (validationError) return validationError

    const createResult = await safeDbOp(
      () => db.driveLine.create({
        data: {
          projectId: String(body.projectId), lineNumber: String(body.lineNumber).trim(),
          startPoint: String(body.startPoint).trim(), endPoint: String(body.endPoint).trim(),
          totalLength: parseNumber(body.totalLength, 0), diameter: String(body.diameter),
          pipeType: String(body.pipeType), soilType: String(body.soilType),
          depth: parseNumber(body.depth, 0), status: String(body.status || 'not_started'),
          // v13: سعر المتر الخاص بهذا الخط (فارغ = بدون سعر حتى إدخاله)
          // v14.2 SECURITY: السعر يُقبل فقط من الإدارة العليا ومدير المشروع
          // (canViewPricing يستثني المشرف العام) — غيرهم يُنشأ الخط بلا سعر
          pricePerMeter: canViewPricing(user) && (body.pricePerMeter !== undefined && body.pricePerMeter !== null && String(body.pricePerMeter) !== '')
            ? parseNumber(body.pricePerMeter, 0)
            : null,
          completedLength: 0, progress: 0, problems: body.problems ? String(body.problems) : null,
        },
      }), 'إنشاء خط الحفر'
    )
    if (!createResult.success) return createResult.response

    Promise.all([
      safeDbOp(() => db.auditLog.create({
        data: {
          userId: user.id, projectId: String(body.projectId),
          action: 'create', entity: 'drive_line', entityId: createResult.data.id,
          details: 'إنشاء خط حفر: ' + String(body.lineNumber).trim() + ' (' + String(body.startPoint).trim() + ' → ' + String(body.endPoint).trim() + ')',
        },
      }), 'سجل التدقيق'),
    ]).catch(function() {})

    // ── تنبيه اكتمال خط الحفر إذا أُنشئ بحالة مكتملة مباشرة ──
    if (String(body.status || 'not_started') === 'completed') {
      notifyUsers({
        type: 'drive_line_completed',
        title: 'اكتمال خط حفر',
        message: 'تم اكتمال خط الحفر رقم ' + String(body.lineNumber).trim() + ' (' + String(body.startPoint).trim() + ' → ' + String(body.endPoint).trim() + ') بطول ' + parseNumber(body.totalLength, 0) + ' متر بنجاح — يمكنك مراجعة بياناته وإصدار التشطيب.',
        severity: 'info',
        projectId: String(body.projectId),
        link: 'driveLines',
        entityType: 'drive_line',
        entityId: createResult.data.id,
        permissions: ['drive_lines', 'finishings'],
        roles: ['top_management', 'project_manager'],
        excludeUserIds: [user.id],
      }).catch(function() {})
    }

    // v14.2 SECURITY: الرد مُعقّم — لا سعر مالي لمستخدم غير مصرح له
    return NextResponse.json({ driveLine: sanitizeDriveLine(createResult.data, canViewPricing(user)), success: true })
  } catch (error: any) {
    return handleDbError(error, 'إنشاء خط الحفر')
  }
}

