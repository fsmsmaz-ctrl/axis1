import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { ensureEquipmentLogSupport } from '@/lib/db-selfheal'
import { db } from '@/lib/db'
import { handleDbError } from '@/lib/api-helpers'
import { hasPermission, isSystemAdminAccount } from '@/lib/auth'

// v75: مفكرة المعدات — سجل التغييرات ثنائي اللغة (عربي/إنجليزي)
// v84 (قرار صاحب الموقع): المفكرة الكاملة لمدير النظام فقط — أخُفيت عن بقية
// المستخدمين. مكانه عند الأدوار الأخرى هو السجل المصغر الذي يظهر على كل
// معدة/أصل نفسه (نقاط صغيرة مختصرة باسم صاحب كل تغيير) وسجل المعدة الكامل
// في نافذة تفاصيلها — فتضمن حقوق الجميع دون كشف المفكرة الموحدة.
// مع equipmentId: يُعاد سجل تلك المعدة وحدها لمن يملك صلاحية عرض المعدات.
export async function GET(req: NextRequest) {
  await ensureEquipmentLogSupport()
  try {
    const user = await getAuthUser(req)
    if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
    const { searchParams } = new URL(req.url)
    var equipmentId = searchParams.get('equipmentId') || ''
    // v84: بلا تصفية = المفكرة الكاملة — مدير النظام حصراً
    if (!equipmentId && !isSystemAdminAccount(user)) {
      return NextResponse.json({ error: 'forbidden', message: 'المفكرة الكاملة متاحة لمدير النظام فقط' }, { status: 403 })
    }
    // مع تصفية equipmentId: تُقبل لمن يملك صلاحية عرض المعدات (سجل معدة واحدة)
    if (equipmentId && !hasPermission(user.role, 'equipment', user.permissions, user.email)) {
      return NextResponse.json({ error: 'forbidden', message: 'لا تملك صلاحية عرض سجل المعدات' }, { status: 403 })
    }
    var takeRaw = parseInt(searchParams.get('take') || '40', 10)
    var take = isFinite(takeRaw) ? Math.min(Math.max(takeRaw, 1), 100) : 40
    var logs = await db.equipmentLog.findMany({
      where: equipmentId ? { equipmentId } : {},
      orderBy: { createdAt: 'desc' },
      take,
    })
    return NextResponse.json({ logs })
  } catch (error) {
    return handleDbError(error, 'جلب مفكرة المعدات')
  }
}
