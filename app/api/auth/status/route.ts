import { createApiClient, createServiceClient } from '@/app/lib/supabase-server'

export async function GET() {
  try {
    const supabase = await createApiClient()
    const { data: { user } } = await supabase.auth.getUser()
    console.log('[auth/status] user:', user?.id ?? 'null')

    if (!user) {
      return Response.json({ userId: null, onboardingDone: false })
    }

    const service = createServiceClient()
    const { data } = await service
      .from('users')
      .select('onboarding_done')
      .eq('id', user.id)
      .single()

    const onboardingDone = data?.onboarding_done ?? false
    console.log('[auth/status] onboarding_done:', onboardingDone)

    return Response.json({ userId: user.id, onboardingDone })
  } catch (e) {
    console.error('[auth/status] error:', e)
    return Response.json({ userId: null, onboardingDone: false })
  }
}
