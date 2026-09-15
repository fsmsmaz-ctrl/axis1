import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { hasPermission, canViewPricing } from '@/lib/auth'
import { db } from '@/lib/db'
import { handleDbError, safeDbOp, sanitizeProject } from '@/lib/api-helpers'

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthUser(req)
    if (!user) {
      return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
    }

    // SECURITY FIX: بوابة قراءة — كانت القائمة (بأسعارها وحقولها المالية) متاحة
    // لأي مستخدم مصادق حتى لو أُلغيت صلاحية projects الخاصة به
    // v18 FIX: من يملك صلاحية safety يحتاج قائمة المشاريع (الاسم فقط) لاختيار
    // المشروع عند إنشاء تقرير سلامة — كان يصمت عليه 403 فتظهر قائمة المشاريع
    // فارغة في نموذج السلامة بلا أي رسالة. الأسعار تبقى محمية بـ canViewPricing كما هي.
    var canReadProjects = hasPermission(user.role, 'projects', user.permissions, user.email) ||
      hasPermission(user.role, 'safety', user.permissions, user.email)
    if (!canReadProjects) {
      return NextResponse.json({ error: 'forbidden', message: 'لا تملك صلاحية عرض المشاريع' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status')

    const where: any = {}
    if (status && status !== 'all') {
      where.status = status
    }

    const result = await safeDbOp(
      () => db.project.findMany({
        where,
        include: {
          manager: { select: { name: true, nameEn: true } },
          engineer: { select: { name: true, nameEn: true } },
          driveLines: { select: { id: true, totalLength: true, completedLength: true, progress: true } },
          _count: {
            select: { driveLines: true, dailyReports: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        // v18 FIX: كان الحد 50 يُسقط المشاريع الأقدم عند تجاوز العدد — فلا تظهر في النماذج
        take: 200,
      }),
      'جلب قائمة المشاريع'
    )

    if (!result.success) return result.response

    var projects = result.data

    // SIMPLE progress: sum of ALL dailyMeters per project (not just approved)
    var projectIds = projects.map(function(p: any) { return p.id })
    var projectMetersMap: Record<string, number> = {}
    if (projectIds.length > 0) {
      try {
        var allMeters = await db.dailyReport.findMany({
          where: { projectId: { in: projectIds } },
          select: { projectId: true, dailyMeters: true },
        })
        for (var m = 0; m < allMeters.length; m++) {
          var pm = allMeters[m]
          if (!projectMetersMap[pm.projectId]) projectMetersMap[pm.projectId] = 0
          projectMetersMap[pm.projectId] += pm.dailyMeters || 0
        }
      } catch (e) { /* ignore */ }
    }

    for (var i = 0; i < projects.length; i++) {
      var p = projects[i]
      var totalLen = p.totalLength || 0
      var completedMeters = projectMetersMap[p.id] || 0
      if (totalLen > 0) {
        p.progress = Math.min((completedMeters / totalLen) * 100, 100)
      } else {
        p.progress = 0
      }
    }

    // v14.2 SECURITY: سعر المتر بيانات سرية — يُحذف من كل مشروع في القائمة
    // إلا للإدارة العليا ومدير المشروع (canViewPricing يستثني admin@axis.om صراحةً)
    var canSeePrice = canViewPricing(user)
    for (var i = 0; i < projects.length; i++) {
      sanitizeProject(projects[i], canSeePrice)
    }

    return NextResponse.json({ projects: projects })
  } catch (error: any) {
    return handleDbError(error, 'جلب قائمة المشاريع')
  }
}

