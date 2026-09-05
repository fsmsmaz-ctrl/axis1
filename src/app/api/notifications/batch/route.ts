import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { safeDbOp } from '@/lib/api-helpers'

// تعليم كل تنبيهات المستخدم الحالية كمقروءة في طلب واحد.
// ملاحظة: المسار الثابت batch له الأولوية على المسار الديناميكي [id]
// في App Router — سابقاً كان الطلب يصل إلى [id] ويفشل بخطأ 404.
export async function PUT(req: NextRequest) {
  var user = await getAuthUser(req)
  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  // تعليم التنبيهات الموجهة للمستخدم نفسه فقط (userId = user.id)
  // بالإضافة إلى التنبيهات العامة (userId = null) — لا نلمس تنبيهات مستخدمين آخرين
  var updateResult = await safeDbOp(
    () => db.notification.updateMany({
      where: {
        read: false,
        OR: [{ userId: user!.id }, { userId: null }],
      },
      data: { read: true },
    }),
    'تعليم التنبيهات كمقروءة'
  )
  if (!updateResult.success) return updateResult.response

  return NextResponse.json({ success: true, updated: updateResult.data.count })
}

                                     
