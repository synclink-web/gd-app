import { NextRequest } from 'next/server'
import { getMemory } from '@/app/lib/memory'

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('userId')
  if (!userId) {
    return Response.json({ error: 'userId required' }, { status: 400 })
  }

  const memory = await getMemory(userId)
  return Response.json(memory ?? {})
}
