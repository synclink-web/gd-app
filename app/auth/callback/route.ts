import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/app/lib/supabase-server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  if (code) {
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => cookieStore.getAll(),
          setAll: (cookiesToSet) => {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, {
                ...options,
                sameSite: 'lax',
                secure: true,
                path: '/',
              })
            )
          },
        },
      }
    )

    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    console.log('[callback] user:', data?.user?.id ?? 'null')
    console.log('[callback] error:', error?.message ?? 'none')
    console.log('[callback] session:', data?.session ? 'ok' : 'null')

    if (data?.user) {
      // service clientでRLSをバイパスして確実にonboarding_doneを取得
      try {
        const service = createServiceClient()
        const { data: userData } = await service
          .from('users')
          .select('onboarding_done')
          .eq('id', data.user.id)
          .single()

        const onboardingDone = userData?.onboarding_done ?? false
        console.log('[callback] onboarding_done:', onboardingDone)

        if (!onboardingDone) {
          return NextResponse.redirect(`${origin}/onboarding`)
        }
      } catch (e) {
        console.warn('[callback] users query failed, defaulting to /', e)
        // DBエラーでもonboarding_doneが不明な場合はメイン画面へ（ループを防ぐ）
      }
    }
  }

  return NextResponse.redirect(`${origin}/`)
}
