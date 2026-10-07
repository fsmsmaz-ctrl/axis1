import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { ensureEquipmentLogSupport } from '@/lib/db-selfheal'
import { db } from '@/lib/db'
import { handleDbError } from '@/lib/api-helpers'
import { hasPermission } from '@/lib/auth'

// v75: مفكرة المعدات — سجل التغييرات ثنائي اللغة (عربي/إنجليزي)
// كل من يملك صلاحية عرض المعدات يرى المفكرة (قراءة فقط — الكتابة عبر مسارات المعدات فقط)
export async function GET(req: NextRequest) {
  await ensureEquipmentLogSupport()
  try {
    const user = await getAuthUser(req)
    if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
    if (!hasPermission(user.role, 'equipment', user.permissions, user.email)) {
      return NextResponse.json({ error: 'forbidden', message: 'لا تملك صلاحية عرض مفكرة المعدات' }, { status: 403 })
    }
    const { searchParams } = new URL(req.url)
    var equipmentId = searchParams.get('equipmentId') || ''
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
