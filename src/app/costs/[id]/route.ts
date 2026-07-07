import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  try {
    const body = await req.json()

    const cost = await db.cost.update({
      where: { id },
      data: {
        projectId: body.projectId,
        date: new Date(body.date),
        category: body.category,
        description: body.description,
        amount: parseFloat(body.amount) || 0,
        notes: body.notes || null,
      },
    })

    return NextResponse.json({ cost, success: true })
  } catch (error) {
    console.error('Update cost error:', error)
    return NextResponse.json({ error: 'Failed to update cost' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  try {
    await db.cost.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete cost error:', error)
    return NextResponse.json({ error: 'Failed to delete cost' }, { status: 500 })
  }
}
