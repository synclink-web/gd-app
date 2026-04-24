import { createApiClient, createServiceClient } from '@/app/lib/supabase-server'

export async function GET() {
  // 認証チェック（エラー時はログインなしとして扱う）
  let userId: string | null = null
  try {
    const supabase = await createApiClient()
    const { data: { user } } = await supabase.auth.getUser()
    userId = user?.id ?? null
    console.log('[auth/status] user:', userId ?? 'null')
  } catch (e) {
    console.error('[auth/status] auth error:', e)
  }

  if (!userId) {
    return Response.json({ userId: null, onboardingDone: false, personalityType: null, tonePreference: null, userName: null })
  }

  // DBクエリ（エラー時は認証済みとして楽観的にtrueを返す＝onboardingループを防ぐ）
  try {
    const service = createServiceClient()
    const { data } = await service
      .from('users')
      .select('onboarding_done, personality_type, tone_preference, name')
      .eq('id', userId)
      .single()

    // 判定はonboarding_doneのみ。name=nullでも影響しない。
    const onboardingDone  = data?.onboarding_done  ?? false
    const personalityType = data?.personality_type ?? null
    const tonePreference  = data?.tone_preference  ?? null
    const userName        = data?.name             ?? null
    console.log('[auth/status] onboarding_done:', onboardingDone, 'personality:', personalityType, 'tone:', tonePreference, 'name:', userName)

    return Response.json({ userId, onboardingDone, personalityType, tonePreference, userName })
  } catch (e) {
    console.error('[auth/status] DB error:', e)
    // 認証済みだがDB障害 → onboardingに飛ばさず楽観的にtrueを返す
    return Response.json({ userId, onboardingDone: true, personalityType: null, tonePreference: null, userName: null })
  }
}
