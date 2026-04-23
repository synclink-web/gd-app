import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

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
                httpOnly: true,
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
      const { data: userData } = await supabase
        .from('users')
        .select('onboarding_done')
        .eq('id', data.user.id)
        .single()

      const onboardingDone = userData?.onboarding_done ?? false
      console.log('[callback] onboarding_done:', onboardingDone)

      if (!onboardingDone) {
        return NextResponse.redirect(`${origin}/onboarding`)
      }
    }
  }

  return NextResponse.redirect(`${origin}/`)
}
