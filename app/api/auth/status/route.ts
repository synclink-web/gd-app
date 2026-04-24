import { createApiClient, createServiceClient } from '@/app/lib/supabase-server'

export async function GET() {
  try {
    const supabase = await createApiClient()
    const { data: { user } } = await supabase.auth.getUser()
    console.log('[auth/status] user:', user?.id ?? 'null')

    if (!user) {
      return Response.json({ userId: null, onboardingDone: false, personalityType: null, tonePreference: null })
    }

    const service = createServiceClient()
    const { data } = await service
      .from('users')
      .select('onboarding_done, personality_type, tone_preference, name')
      .eq('id', user.id)
      .single()

    // onboarding完了はonboarding_doneのみで判定。name=nullでも影響しない。
    const onboardingDone  = data?.onboarding_done  ?? false
    const personalityType = data?.personality_type ?? null
    const tonePreference  = data?.tone_preference  ?? null
    const userName        = data?.name             ?? null
    console.log('[auth/status] onboarding_done:', onboardingDone, 'personality:', personalityType, 'tone:', tonePreference, 'name:', userName)

    return Response.json({ userId: user.id, onboardingDone, personalityType, tonePreference, userName })
  } catch (e) {
    console.error('[auth/status] error:', e)
    return Response.json({ userId: null, onboardingDone: false, personalityType: null, tonePreference: null })
  }
}
