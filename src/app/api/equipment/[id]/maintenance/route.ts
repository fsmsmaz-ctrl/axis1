import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  var user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Rate limit write operations
  var rl = checkRateLimit(req, RateLimitPresets.write)
  if (rl.limited) {
    return NextResponse.json(
      { error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار قليلاً' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    )
  }

  var { id } = await params
  var body = await req.json()

  try {
    var maintenance = await db.equipmentMaintenance.create({
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
    return handleDbError(error, 'إنشاء سجل الصيانة')
  }
}
