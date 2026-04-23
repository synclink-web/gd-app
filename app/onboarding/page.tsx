'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAppStore } from '@/app/store/appStore'
import type { PersonalityType, TonePreference } from '@/app/lib/characters'
import { getCharacterLabel } from '@/app/lib/characters'
import { createClient } from '@/app/lib/supabase'

// ── 質問定義 ────────────────────────────────────────────────
const Q1 = {
  text: '今の気分に近いのは？',
  options: [
    { label: '目標に向かってガンガン進みたい', value: 'hot' as const },
    { label: '冷静に、効率よくやりたい',       value: 'cool' as const },
    { label: 'まずは心を落ち着けたい',          value: 'heal' as const },
  ],
}
const Q2 = {
  text: '友達に相談するとしたら？',
  options: [
    { label: '「絶対うまくいく！やれ！」と言ってくれる人', value: 'hot' as const },
    { label: '「原因はこれ。解決策はこれ」と言ってくれる人', value: 'cool' as const },
    { label: '「大変だったね、話聞くよ」と言ってくれる人',   value: 'heal' as const },
  ],
}
const Q3 = {
  text: '自分をひとことで言うと？',
  options: [
    { label: '行動派・情熱型', value: 'hot' as const },
    { label: '分析派・論理型', value: 'cool' as const },
    { label: '感情派・共感型', value: 'heal' as const },
  ],
}
const Q4 = {
  text: 'バディの性別は？',
  options: [
    { label: '男性', value: 'male' as const },
    { label: '女性', value: 'female' as const },
  ],
}
const Q5 = {
  text: 'バディの話し方は？',
  options: [
    { label: 'ガツガツ系（遠慮なし）', value: 'aggressive' as const },
    { label: 'さっぱり系（シンプル）', value: 'simple' as const },
    { label: 'ふんわり系（優しめ）',   value: 'gentle' as const },
  ],
}

type HotCoolHeal = 'hot' | 'cool' | 'heal'
type Gender = 'male' | 'female'
type Style = 'aggressive' | 'simple' | 'gentle'

function determinePersonality(q1: HotCoolHeal, q2: HotCoolHeal, q3: HotCoolHeal): HotCoolHeal {
  const votes = [q1, q2, q3]
  const counts: Record<HotCoolHeal, number> = { hot: 0, cool: 0, heal: 0 }
  votes.forEach((v) => counts[v]++)
  const max = Math.max(counts.hot, counts.cool, counts.heal)
  // 同数の場合はQ1優先
  if (counts[q1] === max) return q1
  if (counts.hot === max) return 'hot'
  if (counts.cool === max) return 'cool'
  return 'heal'
}

// ── コンポーネント ────────────────────────────────────────
export default function OnboardingPage() {
  const router = useRouter()
  const { setCharacter, setOnboardingDone, setUserName } = useAppStore()

  const [step, setStep]     = useState(0)  // 0=Q1 1=Q2 2=Q3 3=Q4 4=Q5 5=Result
  const [fading, setFading] = useState(false)
  const [saving, setSaving] = useState(false)

  const [q1, setQ1] = useState<HotCoolHeal | null>(null)
  const [q2, setQ2] = useState<HotCoolHeal | null>(null)
  const [q3, setQ3] = useState<HotCoolHeal | null>(null)
  const [gender, setGender] = useState<Gender | null>(null)
  const [style, setStyle]   = useState<Style | null>(null)

  const goNext = () => {
    setFading(true)
    setTimeout(() => { setStep((s) => s + 1); setFading(false) }, 160)
  }

  const handleQ1 = (v: HotCoolHeal) => { if (fading) return; setQ1(v); goNext() }
  const handleQ2 = (v: HotCoolHeal) => { if (fading) return; setQ2(v); goNext() }
  const handleQ3 = (v: HotCoolHeal) => { if (fading) return; setQ3(v); goNext() }
  const handleQ4 = (v: Gender)      => { if (fading) return; setGender(v); goNext() }
  const handleQ5 = (v: Style)       => { if (fading) return; setStyle(v); goNext() }

  const personality = q1 && q2 && q3 ? determinePersonality(q1, q2, q3) : null
  const tonePreference = gender && style ? `${gender}_${style}` as TonePreference : null
  const charLabel = getCharacterLabel(personality, tonePreference)

  const handleComplete = async () => {
    if (!personality || !tonePreference || saving) return
    setSaving(true)

    setCharacter(personality, tonePreference)
    setOnboardingDone(true)
    setUserName('')

    localStorage.setItem('onboarding_done',    'true')
    localStorage.setItem('personality_type',   personality)
    localStorage.setItem('tone_preference',    tonePreference)

    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        await supabase.from('users').update({
          onboarding_done:  true,
          personality_type: personality,
          tone_preference:  tonePreference,
        }).eq('id', user.id)
      }
    } catch (e) {
      console.warn('[Onboarding] Supabase save skipped:', e)
    }

    router.push('/')
  }

  const transitionCls = `transition-opacity duration-160 ${fading ? 'opacity-0' : 'opacity-100'}`

  // ── 選択肢ボタン ─────────────────────────────────────────
  const OptionBtn = ({ label, onClick }: { label: string; onClick: () => void }) => (
    <button
      onClick={onClick}
      className="w-full rounded-2xl bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 px-6 py-5 text-left text-base font-medium text-zinc-100 transition-colors duration-150"
    >
      {label}
    </button>
  )

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 px-6">
      <div className="w-full max-w-sm flex flex-col items-center gap-8">

        {/* プログレスバー */}
        {step < 5 && (
          <div className="w-full flex flex-col items-center gap-3">
            <p className="text-xs text-zinc-500 tracking-widest uppercase">
              {step + 1} / 5
            </p>
            <div className="w-full h-1 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-zinc-300 rounded-full transition-all duration-500"
                style={{ width: `${((step + 1) / 5) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* ── Q1 ── */}
        {step === 0 && (
          <div className={`w-full flex flex-col gap-5 ${transitionCls}`}>
            <h1 className="text-2xl font-bold text-zinc-100 text-center">{Q1.text}</h1>
            <div className="flex flex-col gap-3">
              {Q1.options.map((o) => <OptionBtn key={o.value} label={o.label} onClick={() => handleQ1(o.value)} />)}
            </div>
          </div>
        )}

        {/* ── Q2 ── */}
        {step === 1 && (
          <div className={`w-full flex flex-col gap-5 ${transitionCls}`}>
            <h1 className="text-2xl font-bold text-zinc-100 text-center">{Q2.text}</h1>
            <div className="flex flex-col gap-3">
              {Q2.options.map((o) => <OptionBtn key={o.value} label={o.label} onClick={() => handleQ2(o.value)} />)}
            </div>
          </div>
        )}

        {/* ── Q3 ── */}
        {step === 2 && (
          <div className={`w-full flex flex-col gap-5 ${transitionCls}`}>
            <h1 className="text-2xl font-bold text-zinc-100 text-center">{Q3.text}</h1>
            <div className="flex flex-col gap-3">
              {Q3.options.map((o) => <OptionBtn key={o.value} label={o.label} onClick={() => handleQ3(o.value)} />)}
            </div>
          </div>
        )}

        {/* ── Q4 ── */}
        {step === 3 && (
          <div className={`w-full flex flex-col gap-5 ${transitionCls}`}>
            <h1 className="text-2xl font-bold text-zinc-100 text-center">{Q4.text}</h1>
            <div className="flex flex-col gap-3">
              {Q4.options.map((o) => <OptionBtn key={o.value} label={o.label} onClick={() => handleQ4(o.value)} />)}
            </div>
          </div>
        )}

        {/* ── Q5 ── */}
        {step === 4 && (
          <div className={`w-full flex flex-col gap-5 ${transitionCls}`}>
            <h1 className="text-2xl font-bold text-zinc-100 text-center">{Q5.text}</h1>
            <div className="flex flex-col gap-3">
              {Q5.options.map((o) => <OptionBtn key={o.value} label={o.label} onClick={() => handleQ5(o.value)} />)}
            </div>
          </div>
        )}

        {/* ── 結果 ── */}
        {step === 5 && personality && tonePreference && (
          <div className="w-full flex flex-col items-center gap-6">
            <div className="flex flex-col items-center gap-2">
              <p className="text-xs text-zinc-500 uppercase tracking-widest">あなたのバディ</p>
              <h1 className="text-4xl font-bold text-zinc-100">{charLabel}</h1>
            </div>
            <button
              onClick={handleComplete}
              disabled={saving}
              className="w-full rounded-2xl bg-zinc-100 hover:bg-white active:bg-zinc-200 text-zinc-900 font-semibold py-4 text-base transition-colors duration-150 disabled:opacity-50"
            >
              {saving ? '準備中...' : '話し始める'}
            </button>
          </div>
        )}

      </div>
    </div>
  )
}
