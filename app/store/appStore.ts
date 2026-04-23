import { create } from 'zustand'

export type VoiceState = 'Idle' | 'Listening' | 'Transcribing' | 'Thinking' | 'Speaking'

export const VOICE_OPTIONS = [
  { label: '女性A', value: 'ja-JP-Neural2-B' },
  { label: '女性B', value: 'ja-JP-Wavenet-A' },
  { label: '男性A', value: 'ja-JP-Neural2-C' },
  { label: '男性B', value: 'ja-JP-Neural2-D' },
] as const

export type VoiceName = typeof VOICE_OPTIONS[number]['value']

export type PersonalityType =
  | 'empathy_gentle'
  | 'logical_direct'
  | 'expressive_energize'
  | 'introvert_calm'
  | 'balanced'

export const PERSONALITY_CONFIG: Record<PersonalityType, { label: string; prompt: string }> = {
  empathy_gentle: {
    label: '共感サポーター',
    prompt: '共感を最優先に。感情に寄り添い、ゆっくり丁寧に話す。解決策より気持ちの整理を重視。',
  },
  logical_direct: {
    label: '論理パートナー',
    prompt: '論理的に整理することを重視。具体的な解決策を提案。テンポよく、無駄なく話す。',
  },
  expressive_energize: {
    label: '熱血コーチ',
    prompt: 'エネルギッシュに背中を押す。ポジティブで明るい。モチベーションを上げることを重視。',
  },
  introvert_calm: {
    label: 'クールメンター',
    prompt: '落ち着いたトーンで本質を突く。俯瞰的な視点で冷静にアドバイス。',
  },
  balanced: {
    label: 'バランス型',
    prompt: '状況に応じて柔軟に対応。共感と論理のバランスを取りながら会話を進める。',
  },
}

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface AppStore {
  voiceState: VoiceState
  transcript: string
  assistantText: string
  messages: Message[]
  error: string | null
  voiceName: VoiceName
  personalityType: PersonalityType | null
  buddyCharacter: string | null
  onboardingDone: boolean
  userName: string    // ユーザーの呼ばれたい名前（空なら「あなた」）
  buddyName: string   // GD の呼び名（デフォルト「GD」）
  userId: string | null  // Supabase auth user ID
  turnCount: number

  setVoiceState: (state: VoiceState) => void
  setTranscript: (text: string) => void
  setAssistantText: (text: string) => void
  appendAssistantText: (chunk: string) => void
  addMessage: (message: Message) => void
  setError: (error: string | null) => void
  setVoiceName: (name: VoiceName) => void
  setPersonalityType: (type: PersonalityType) => void
  setOnboardingDone: (done: boolean) => void
  setUserName: (name: string) => void
  setBuddyName: (name: string) => void
  setUserId: (id: string | null) => void
  incrementTurnCount: () => void
  reset: () => void
  resetSession: () => void
}

export const useAppStore = create<AppStore>((set) => ({
  voiceState: 'Idle',
  transcript: '',
  assistantText: '',
  messages: [],
  error: null,
  voiceName: 'ja-JP-Neural2-B',
  personalityType: null,
  buddyCharacter: null,
  onboardingDone: false,
  userName: '',
  buddyName: 'GD',
  userId: null,
  turnCount: 0,

  setVoiceState: (voiceState) => set({ voiceState }),
  setTranscript: (transcript) => set({ transcript }),
  setAssistantText: (assistantText) => set({ assistantText }),
  appendAssistantText: (chunk) =>
    set((s) => ({ assistantText: s.assistantText + chunk })),
  addMessage: (message) =>
    set((s) => ({ messages: [...s.messages, message] })),
  setError: (error) => set({ error }),
  setVoiceName: (voiceName) => set({ voiceName }),
  setPersonalityType: (type) =>
    set({ personalityType: type, buddyCharacter: PERSONALITY_CONFIG[type].label }),
  setOnboardingDone: (onboardingDone) => set({ onboardingDone }),
  setUserName: (userName) => set({ userName }),
  setBuddyName: (buddyName) => set({ buddyName }),
  setUserId: (userId) => set({ userId }),
  incrementTurnCount: () => set((s) => ({ turnCount: s.turnCount + 1 })),
  reset: () => set({ transcript: '', assistantText: '' }),
  resetSession: () => set({ transcript: '', assistantText: '', messages: [], voiceState: 'Idle', turnCount: 0 }),
}))
