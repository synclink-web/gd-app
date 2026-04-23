import { create } from 'zustand'
export { TOPIC_GENRES } from '@/app/lib/topics'
export type { PersonalityType, TonePreference } from '@/app/lib/characters'
import type { PersonalityType, TonePreference } from '@/app/lib/characters'
import { getVoiceForTone, getCharacterLabel } from '@/app/lib/characters'

export type VoiceState = 'Idle' | 'Listening' | 'Transcribing' | 'Thinking' | 'Speaking'

export const VOICE_OPTIONS = [
  { label: '女性A', value: 'ja-JP-Neural2-B' },
  { label: '女性B', value: 'ja-JP-Wavenet-A' },
  { label: '男性A', value: 'ja-JP-Neural2-C' },
  { label: '男性B', value: 'ja-JP-Neural2-D' },
] as const

export type VoiceName = typeof VOICE_OPTIONS[number]['value']

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
  tonePreference: TonePreference | null
  buddyCharacter: string | null
  onboardingDone: boolean
  userName: string
  buddyName: string
  userId: string | null
  turnCount: number
  topicHistory: string[]

  setVoiceState: (state: VoiceState) => void
  setTranscript: (text: string) => void
  setAssistantText: (text: string) => void
  appendAssistantText: (chunk: string) => void
  addMessage: (message: Message) => void
  setError: (error: string | null) => void
  setVoiceName: (name: VoiceName) => void
  setCharacter: (pt: PersonalityType, tone: TonePreference) => void
  setOnboardingDone: (done: boolean) => void
  setUserName: (name: string) => void
  setBuddyName: (name: string) => void
  setUserId: (id: string | null) => void
  incrementTurnCount: () => void
  addTopic: (topic: string) => void
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
  tonePreference: null,
  buddyCharacter: null,
  onboardingDone: false,
  userName: '',
  buddyName: 'GD',
  userId: null,
  turnCount: 0,
  topicHistory: [],

  setVoiceState: (voiceState) => set({ voiceState }),
  setTranscript: (transcript) => set({ transcript }),
  setAssistantText: (assistantText) => set({ assistantText }),
  appendAssistantText: (chunk) =>
    set((s) => ({ assistantText: s.assistantText + chunk })),
  addMessage: (message) =>
    set((s) => ({ messages: [...s.messages, message] })),
  setError: (error) => set({ error }),
  setVoiceName: (voiceName) => set({ voiceName }),
  setCharacter: (pt, tone) => set({
    personalityType: pt,
    tonePreference: tone,
    voiceName: getVoiceForTone(tone),
    buddyCharacter: getCharacterLabel(pt, tone),
  }),
  setOnboardingDone: (onboardingDone) => set({ onboardingDone }),
  setUserName: (userName) => set({ userName }),
  setBuddyName: (buddyName) => set({ buddyName }),
  setUserId: (userId) => set({ userId }),
  incrementTurnCount: () => set((s) => ({ turnCount: s.turnCount + 1 })),
  addTopic: (topic) => set((s) => ({ topicHistory: [...s.topicHistory, topic].slice(-5) })),
  reset: () => set({ transcript: '', assistantText: '' }),
  resetSession: () => set({
    transcript: '', assistantText: '', messages: [],
    voiceState: 'Idle', turnCount: 0, topicHistory: [],
  }),
}))
