'use client'

import { useRef, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import VoiceCore from '@/app/components/VoiceCore'
import { createClient } from '@/app/lib/supabase'
import { useAppStore, type VoiceState } from '@/app/store/appStore'
import type { PersonalityType, TonePreference } from '@/app/lib/characters'

const STATE_LABEL: Record<VoiceState, string> = {
  Idle: 'タップして開始',
  Listening: '聞いています',
  Transcribing: '認識中...',
  Thinking: '考えています...',
  Speaking: '話しています',
}

const STATE_COLOR: Record<VoiceState, string> = {
  Idle: 'bg-zinc-600',
  Listening: 'bg-green-400',
  Transcribing: 'bg-yellow-400',
  Thinking: 'bg-blue-400',
  Speaking: 'bg-purple-400',
}

const PULSE_STATES: VoiceState[] = ['Listening', 'Transcribing', 'Thinking', 'Speaking']

export default function Home() {
  const router = useRouter()
  const {
    voiceState, transcript, assistantText, error,
    buddyCharacter, messages,
    setCharacter, setOnboardingDone, setUserName, setBuddyName, setUserId,
  } = useAppStore()

  const startRef     = useRef<(() => void) | null>(null)
  const interruptRef = useRef<(() => void) | null>(null)
  const endRef       = useRef<(() => void) | null>(null)
  const [ready, setReady] = useState(false)

  const hasSession = messages.length > 0

  useEffect(() => { void (async () => {
    // サーバーサイドAPIでonboarding状態を確認（iOS Safari ITP対策）
    try {
      const res = await fetch('/api/auth/status')
      const { userId, onboardingDone, personalityType, tonePreference } =
        await res.json() as {
          userId: string | null
          onboardingDone: boolean
          personalityType: PersonalityType | null
          tonePreference: TonePreference | null
        }
      console.log('[page] user:', userId ?? 'null')
      console.log('[page] onboarding_done from DB:', onboardingDone)

      if (!onboardingDone) {
        router.push('/onboarding')
        return
      }

      if (userId) {
        setUserId(userId)
        localStorage.setItem('onboarding_done', 'true')
      }

      // DBからキャラクター情報を優先復元、なければlocalStorageから
      const pt   = personalityType ?? localStorage.getItem('personality_type') as PersonalityType | null
      const tone = tonePreference  ?? localStorage.getItem('tone_preference')  as TonePreference | null
      if (pt && tone) setCharacter(pt, tone)

    } catch {
      const done = localStorage.getItem('onboarding_done')
      if (!done) { router.push('/onboarding'); return }

      const pt   = localStorage.getItem('personality_type') as PersonalityType | null
      const tone = localStorage.getItem('tone_preference')  as TonePreference | null
      if (pt && tone) setCharacter(pt, tone)
    }

    const storedUserName = localStorage.getItem('user_name')
    if (storedUserName) setUserName(storedUserName)
    const storedBuddyName = localStorage.getItem('buddy_name')
    if (storedBuddyName) setBuddyName(storedBuddyName)

    setOnboardingDone(true)
    setReady(true)
  })() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleLogout = async () => {
    endRef.current?.()
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/auth')
  }

  const handleTap = () => {
    if (voiceState === 'Idle' && startRef.current) {
      startRef.current()
    } else if (voiceState === 'Speaking' && interruptRef.current) {
      interruptRef.current()
    }
  }

  if (!ready) return <div className="min-h-screen bg-zinc-950" />

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 px-4 select-none"
      onClick={handleTap}
    >
      <VoiceCore startRef={startRef} interruptRef={interruptRef} endRef={endRef} />

      <div className="flex flex-col items-center gap-10 w-full max-w-md">
        {buddyCharacter && (
          <p className="text-xs text-zinc-600 tracking-widest uppercase">
            {buddyCharacter}
          </p>
        )}

        <div className="flex flex-col items-center gap-3">
          <div
            className={`h-24 w-24 rounded-full ${STATE_COLOR[voiceState]} ${
              PULSE_STATES.includes(voiceState) ? 'animate-pulse' : ''
            } ${voiceState === 'Idle' || voiceState === 'Speaking' ? 'cursor-pointer active:scale-95' : ''} shadow-lg shadow-black/40 transition-all duration-500`}
          />
          <span className="text-lg font-medium text-zinc-300 tracking-wide">
            {STATE_LABEL[voiceState]}
          </span>
          {voiceState === 'Idle' && (
            <p className="text-sm text-zinc-500 mt-1">
              画面をタップするとマイクが起動します
            </p>
          )}
          {voiceState === 'Speaking' && (
            <p className="text-sm text-zinc-500 mt-1">
              タップして割り込む
            </p>
          )}
        </div>

        {transcript && (
          <div className="w-full rounded-2xl bg-zinc-800 px-5 py-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-1">
              あなた
            </p>
            <p className="text-base text-zinc-100 leading-relaxed">{transcript}</p>
          </div>
        )}

        {assistantText && (
          <div className="w-full rounded-2xl bg-zinc-800/60 px-5 py-4 border border-zinc-700">
            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-1">
              AI
            </p>
            <p className="text-base text-zinc-100 leading-relaxed">{assistantText}</p>
          </div>
        )}

        {error && (
          <div className="w-full rounded-2xl bg-red-900/40 border border-red-700 px-5 py-4">
            <p className="text-sm text-red-300">{error}</p>
          </div>
        )}

        {/* 会話終了 / ログアウト */}
        <div
          className="flex flex-col items-center gap-2 pb-10"
          onClick={(e) => e.stopPropagation()}
        >
          {hasSession && (
            <button
              onClick={() => endRef.current?.()}
              className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors py-1 px-3"
            >
              会話を終了する
            </button>
          )}
          <button
            onClick={handleLogout}
            className="text-xs text-zinc-700 hover:text-zinc-500 transition-colors py-1 px-3"
          >
            ログアウト
          </button>
        </div>
      </div>
    </div>
  )
}
