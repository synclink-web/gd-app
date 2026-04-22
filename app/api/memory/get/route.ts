import { NextRequest } from 'next/server'
import { getMemory } from '@/app/lib/memory'
import { createApiClient } from '@/app/lib/supabase-server'

export async function GET(_request: NextRequest) {
  const supabase = await createApiClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const memory = await getMemory(user.id)
  return Response.json(memory ?? {})
}
