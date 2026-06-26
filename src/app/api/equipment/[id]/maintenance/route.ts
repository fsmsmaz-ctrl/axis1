import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const body = await req.json()

  try {
    const maintenance = await db.equipmentMaintenance.create({
      data: {
        equipmentId: id,
        date: new Date(body.date),
        type: body.type,
        description: body.description,
        cost: parseFloat(body.cost) || 0,
        partsUsed: body.partsUsed,
        performedById: user.id,
      },
    })

    // Update equipment last maintenance
    await db.equipment.update({
      where: { id },
      data: {
        lastMaintenance: new Date(body.date),
        status: body.setStatus || 'operational',
      },
    })

    return NextResponse.json({ maintenance })
  } catch (error) {
    console.error('Create maintenance error:', error)
    return NextResponse.json({ error: 'Failed to create maintenance record' }, { status: 500 })
  }
}
