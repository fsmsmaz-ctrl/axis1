import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, safeDbOp } from '@/lib/api-helpers'
import { canWrite } from '@/lib/auth'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser(req)
    if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
    const { id } = await params
    const result = await safeDbOp(
      () => db.finishing.findUnique({
        where: { id },
        include: { project: { select: { id: true, name: true, code: true, client: true } }, signedByUser: { select: { name: true, nameEn: true } } },
      }),
      'جلب التشطيب'
    )
    if (!result.success) return result.response
    if (!result.data) return NextResponse.json({ error: 'not_found', message: 'التشطيب غير موجود' }, { status: 404 })
    return NextResponse.json({ finishing: result.data })
  } catch (error) {
    return handleDbError(error, 'جلب التشطيب')
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser(req)
    if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
    if (!canWrite(user.role, 'finishings', user.permissions)) {
      return NextResponse.json({ error: 'forbidden', message: 'لا تملك صلاحية لتعديل التشطيبات' }, { status: 403 })
    }
    const { id } = await params
    const body = await req.json()
    const result = await safeDbOp(
      () => db.finishing.update({
        where: { id },
        data: {
          siteCleaned: !!body.siteCleaned, wasteRemoved: !!body.wasteRemoved, shaftClosed: !!body.shaftClosed,
          siteRestored: !!body.siteRestored, lineHandover: !!body.lineHandover,
          clientNotes: body.clientNotes, handoverStatus: body.handoverStatus,
        },
      }),
      'تحديث التشطيب'
    )
    if (!result.success) return result.response
    return NextResponse.json({ finishing: result.data })
  } catch (error) {
    return handleDbError(error, 'تحديث التشطيب')
  }
}
