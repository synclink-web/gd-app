import { NextRequest, NextResponse } from 'next/server'

// Supabase の auth cookie は "sb-<project_ref>-auth-token" または
// チャンク分割時 "sb-<project_ref>-auth-token.0" として保存される
const PROJECT_REF = 'fipryjgfwvygajxvgqfy'
const AUTH_COOKIE = `sb-${PROJECT_REF}-auth-token`

export function middleware(request: NextRequest) {
  const hasSession =
    request.cookies.has(AUTH_COOKIE) ||
    request.cookies.has(`${AUTH_COOKIE}.0`)

  if (!hasSession) {
    return NextResponse.redirect(new URL('/auth', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/', '/onboarding'],
}
