'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAppStore, PERSONALITY_CONFIG, type PersonalityType } from '@/app/store/appStore'
import { createClient } from '@/app/lib/supabase'

// ── 質問定義 ────────────────────────────────────────────────
const QUESTIONS = [
  {
    key: 'q1' as const,
    text: '悩んだ時、どうしたい？',
    options: [
      { label: '話を聞いてほしい', sub: '気持ちに寄り添ってほしい', value: 'empathy' },
      { label: '解決策がほしい', sub: '具体的なアドバイスがほしい', value: 'logical' },
    ],
  },
  {
    key: 'q2' as const,
    text: '人と話す時、どっちが多い？',
    options: [
      { label: '自分が話す', sub: '話すことで整理できる', value: 'expressive' },
      { label: '相手の話を聞く', sub: '聞く方が落ち着く', value: 'receptive' },
    ],
  },
  {
    key: 'q3' as const,
    text: '気持ちの整理、どっちが好き？',
    options: [
      { label: '声に出して話す', sub: '言葉にすると楽になる', value: 'extrovert' },
      { label: '頭の中で考える', sub: '静かに考えたい', value: 'introvert' },
    ],
  },
  {
    key: 'q4' as const,
    text: '背中を押してほしい時は？',
    options: [
      { label: '優しく背中を押して', sub: 'そっと寄り添ってほしい', value: 'gentle' },
      { label: 'ズバッと言ってほしい', sub: 'はっきりした言葉が好き', value: 'direct' },
    ],
  },
  {
    key: 'q5' as const,
    text: '今のテンションは？',
    options: [
      { label: '上げていきたい', sub: 'エネルギーを充電したい', value: 'energize' },
      { label: '落ち着きたい', sub: 'ゆっくりしたい気分', value: 'calm' },
    ],
  },
] as const

type AnswerKey = typeof QUESTIONS[number]['key']
type Answers = Record<AnswerKey, string>

// ── パーソナリティ判定 ──────────────────────────────────────
function determinePersonality(a: Answers): PersonalityType {
  if (a.q1 === 'empathy'    && a.q4 === 'gentle')   return 'empathy_gentle'
  if (a.q1 === 'logical'    && a.q4 === 'direct')    return 'logical_direct'
  if (a.q2 === 'expressive' && a.q5 === 'energize')  return 'expressive_energize'
  if (a.q3 === 'introvert'  && a.q5 === 'calm')      return 'introvert_calm'
  return 'balanced'
}

// ── キャラクターアイコン ─────────────────────────────────────
const PERSONALITY_ICON: Record<PersonalityType, string> = {
  empathy_gentle:     '🤝',
  logical_direct:     '🧠',
  expressive_energize:'🔥',
  introvert_calm:     '🌙',
  balanced:           '⚖️',
}

// ── コンポーネント ───────────────────────────────────────────
export default function OnboardingPage() {
  const router = useRouter()
  const { setPersonalityType, setOnboardingDone } = useAppStore()

  const [step, setStep]         = useState(0)  // 0-4: questions, 5: result
  const [answers, setAnswers]   = useState<Partial<Answers>>({})
  const [result, setResult]     = useState<PersonalityType | null>(null)
  const [fading, setFading]     = useState(false)
  const [saving, setSaving]     = useState(false)

  const question = step < 5 ? QUESTIONS[step] : null

  const handleAnswer = (value: string) => {
    if (fading) return
    const key = QUESTIONS[step].key
    const newAnswers = { ...answers, [key]: value } as Answers

    if (step < 4) {
      setFading(true)
      setTimeout(() => {
        setAnswers(newAnswers)
        setStep(step + 1)
        setFading(false)
      }, 180)
    } else {
      const type = determinePersonality(newAnswers)
      setAnswers(newAnswers)
      setResult(type)
      setFading(true)
      setTimeout(() => {
        setStep(5)
        setFading(false)
      }, 180)
    }
  }

  const handleComplete = async () => {
    if (!result || saving) return
    setSaving(true)

    setPersonalityType(result)
    setOnboardingDone(true)
    localStorage.setItem('onboarding_done', 'true')
    localStorage.setItem('personality_type', result)

    // Supabase 保存（未認証時はスキップ）
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const a = answers as Answers
        await Promise.all([
          supabase.from('onboarding_answers').insert({
            user_id: user.id,
            q1_use_purpose:    a.q1,
            q2_personality_pref: a.q2,
            q3_current_mood:   a.q3,
            q4_talk_style:     a.q4,
            q5_main_concern:   a.q5,
          }),
          supabase.from('users').update({
            onboarding_done: true,
            personality_type: result,
          }).eq('id', user.id),
        ])
      }
    } catch (e) {
      console.warn('[Onboarding] Supabase save skipped:', e)
    }

    router.push('/')
  }

  const config = result ? PERSONALITY_CONFIG[result] : null

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 px-6">
      <div className="w-full max-w-sm flex flex-col items-center gap-8">

        {/* プログレスバー */}
        {step < 5 && (
          <div className="w-full flex flex-col items-center gap-3">
            <p className="text-xs text-zinc-500 tracking-widest uppercase">
              {step + 1} / {QUESTIONS.length}
            </p>
            <div className="w-full h-1 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-zinc-300 rounded-full transition-all duration-500"
                style={{ width: `${((step + 1) / QUESTIONS.length) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* 質問ステップ */}
        {step < 5 && question && (
          <div
            className={`w-full flex flex-col items-center gap-6 transition-opacity duration-180 ${fading ? 'opacity-0' : 'opacity-100'}`}
          >
            <h1 className="text-2xl font-bold text-zinc-100 text-center leading-snug">
              {question.text}
            </h1>

            <div className="w-full flex flex-col gap-3">
              {question.options.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => handleAnswer(opt.value)}
                  className="w-full rounded-2xl bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 px-6 py-5 text-left transition-colors duration-150 group"
                >
                  <p className="text-base font-semibold text-zinc-100 group-hover:text-white">
                    {opt.label}
                  </p>
                  <p className="text-sm text-zinc-500 mt-0.5 group-hover:text-zinc-400">
                    {opt.sub}
                  </p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 結果ステップ */}
        {step === 5 && result && config && (
          <div
            className={`w-full flex flex-col items-center gap-6 transition-opacity duration-180 ${fading ? 'opacity-0' : 'opacity-100'}`}
          >
            <div className="flex flex-col items-center gap-3">
              <div className="text-6xl">{PERSONALITY_ICON[result]}</div>
              <p className="text-xs text-zinc-500 uppercase tracking-widest">あなたのGDタイプ</p>
              <h1 className="text-3xl font-bold text-zinc-100">{config.label}</h1>
            </div>

            <div className="w-full rounded-2xl bg-zinc-800/60 border border-zinc-700 px-6 py-5">
              <p className="text-sm text-zinc-300 leading-relaxed">{config.prompt}</p>
            </div>

            <button
              onClick={handleComplete}
              disabled={saving}
              className="w-full rounded-2xl bg-zinc-100 hover:bg-white active:bg-zinc-200 text-zinc-900 font-semibold py-4 text-base transition-colors duration-150 disabled:opacity-50"
            >
              {saving ? '準備中...' : 'GDと話し始める'}
            </button>
          </div>
        )}

      </div>
    </div>
  )
}
