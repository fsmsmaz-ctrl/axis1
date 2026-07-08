import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, parseNumber, safeDbOp } from '@/lib/api-helpers'

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  const { id } = await params

  try {
    const body = await req.json()

    const updateResult = await safeDbOp(
      () => db.cost.update({
        where: { id },
        data: {
          projectId: body.projectId ? String(body.projectId) : undefined,
          date: body.date ? new Date(body.date) : undefined,
          category: body.category ? String(body.category) : undefined,
          description: body.description ? String(body.description) : undefined,
          amount: body.amount !== undefined ? parseNumber(body.amount, 0) : undefined,
          notes: body.notes !== undefined ? (body.notes ? String(body.notes) : null) : undefined,
        },
      }),
      'تحديث التكلفة'
    )
    if (!updateResult.success) return updateResult.response

    return NextResponse.json({ cost: updateResult.data, success: true })
  } catch (error: any) {
    return handleDbError(error, 'تحديث التكلفة')
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  const { id } = await params

  try {
    const deleteResult = await safeDbOp(
      () => db.cost.delete({ where: { id } }),
      'حذف التكلفة'
    )
    if (!deleteResult.success) return deleteResult.response

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return handleDbError(error, 'حذف التكلفة')
  }
}
