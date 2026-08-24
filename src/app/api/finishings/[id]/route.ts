import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params

    const finishing = await db.finishing.findUnique({
      where: { id },
      include: {
        project: { select: { id: true, name: true, code: true, client: true } },
        signedByUser: { select: { name: true, nameEn: true } },
      },
    })

    if (!finishing) {
      return NextResponse.json({ error: 'Finishing not found' }, { status: 404 })
    }

    return NextResponse.json({ finishing })
  } catch (error) {
    console.error('Get finishing error:', error)
    return NextResponse.json({ error: 'Failed to fetch finishing' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const body = await req.json()

    const finishing = await db.finishing.update({
      where: { id },
      data: {
        siteCleaned: !!body.siteCleaned,
        wasteRemoved: !!body.wasteRemoved,
        shaftClosed: !!body.shaftClosed,
        siteRestored: !!body.siteRestored,
        lineHandover: !!body.lineHandover,
        clientNotes: body.clientNotes,
        handoverStatus: body.handoverStatus,
      },
    })

    return NextResponse.json({ finishing })
  } catch (error) {
    console.error('Update finishing error:', error)
    return NextResponse.json({ error: 'Failed to update finishing' }, { status: 500 })
  }
}
