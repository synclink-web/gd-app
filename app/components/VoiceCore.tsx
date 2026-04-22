'use client'

import { useEffect, useRef, type RefObject } from 'react'
import { useAppStore } from '@/app/store/appStore'

const SENTENCE_RE = /([^。！？\n]+[。！？\n])/g

interface Props {
  startRef?: RefObject<(() => void) | null>
  interruptRef?: RefObject<(() => void) | null>
}

export default function VoiceCore({ startRef, interruptRef }: Props) {
  const recognitionRef       = useRef<SpeechRecognition | null>(null)
  const isProcessingRef      = useRef(false)
  const currentAudioRef      = useRef<HTMLAudioElement | null>(null)
  const currentBlobUrlRef    = useRef<string | null>(null)
  const sessionRef           = useRef(0)
  const recognitionGenRef    = useRef(0)
  const pendingTranscriptRef = useRef<string | null>(null)
  const srDebounceRef        = useRef<ReturnType<typeof setTimeout> | null>(null)

  const storeRef = useRef(useAppStore.getState())
  useEffect(() => useAppStore.subscribe((s) => { storeRef.current = s }), [])

  // ── TTS 停止 ─────────────────────────────────────────────
  const interruptTTS = () => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause()
      currentAudioRef.current.onended = null
      currentAudioRef.current.onerror = null
      currentAudioRef.current = null
    }
    if (currentBlobUrlRef.current) {
      URL.revokeObjectURL(currentBlobUrlRef.current)
      currentBlobUrlRef.current = null
    }
    isProcessingRef.current = false
  }

  // ── TTS 再生（HTMLAudioElement） ──────────────────────────
  const playSentence = async (text: string, mySession: number): Promise<void> => {
    if (sessionRef.current !== mySession) return
    console.log('[TTS] speak session=%d:', mySession, text.slice(0, 40))

    try {
      const voiceName = useAppStore.getState().voiceName
      const doFetch = () => fetch('/api/voice/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voiceName }),
      })

      let res = await doFetch()
      if (sessionRef.current !== mySession) return

      if (!res.ok) {
        console.warn('[TTS] failed status=%d, retrying in 1s', res.status)
        await new Promise<void>((r) => setTimeout(r, 1000))
        if (sessionRef.current !== mySession) return
        res = await doFetch()
        if (sessionRef.current !== mySession) return
        if (!res.ok) {
          console.error('[TTS] retry also failed status=%d, skipping sentence', res.status)
          return
        }
        console.log('[TTS] retry succeeded')
      }

      const blob = await res.blob()
      if (sessionRef.current !== mySession) return
      if (blob.size === 0) { console.warn('[TTS] empty blob'); return }

      const url = URL.createObjectURL(blob)
      currentBlobUrlRef.current = url

      return new Promise<void>((resolve) => {
        if (sessionRef.current !== mySession) {
          URL.revokeObjectURL(url)
          currentBlobUrlRef.current = null
          resolve()
          return
        }

        const audio = new Audio(url)
        currentAudioRef.current = audio
        let safetyTimerId: ReturnType<typeof setTimeout> | null = null

        const cleanup = () => {
          if (safetyTimerId !== null) clearTimeout(safetyTimerId)
          URL.revokeObjectURL(url)
          if (currentBlobUrlRef.current === url) currentBlobUrlRef.current = null
          if (currentAudioRef.current === audio)  currentAudioRef.current  = null
        }

        audio.onloadedmetadata = () => {
          safetyTimerId = setTimeout(() => {
            console.warn('[TTS] safety timeout')
            cleanup()
            resolve()
          }, audio.duration * 1000 + 3000)
        }

        audio.onended = () => { cleanup(); resolve() }

        audio.onerror = (e) => {
          console.error('[TTS] audio error:', e)
          cleanup()
          resolve()
        }

        audio.play().catch((e) => {
          console.error('[TTS] play() rejected:', e)
          cleanup()
          resolve()
        })
      })
    } catch (err) {
      console.error('[TTS] error:', err)
    }
  }

  // ── Chat + TTS pipeline ───────────────────────────────────
  const handleTranscript = async (text: string) => {
    recognitionRef.current?.stop()

    const mySession = ++sessionRef.current
    isProcessingRef.current = true
    const store = storeRef.current

    store.setTranscript(text)
    store.addMessage({ role: 'user', content: text })
    store.setAssistantText('')
    store.setVoiceState('Thinking')

    try {
      const allMessages = useAppStore.getState().messages
      const messages    = allMessages.slice(-10)
      const personalityType = useAppStore.getState().personalityType
      const chatRes = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, personalityType }),
      })
      if (!chatRes.ok || !chatRes.body) throw new Error('Chat API error')

      const reader  = chatRes.body.getReader()
      const decoder = new TextDecoder()
      let fullText = ''
      const pendingBuffer: string[] = []
      let ttsQueue: Promise<void> = Promise.resolve()

      store.setVoiceState('Speaking')

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        fullText += chunk
        storeRef.current.appendAssistantText(chunk)

        pendingBuffer.push(chunk)
        const combined = pendingBuffer.join('')
        const matches  = combined.match(SENTENCE_RE)
        if (matches) {
          matches.forEach((s) => {
            ttsQueue = ttsQueue.then(() => playSentence(s, mySession))
          })
          pendingBuffer.length = 0
          const remainder = combined.replace(SENTENCE_RE, '')
          if (remainder) pendingBuffer.push(remainder)
        }
      }

      const remaining = pendingBuffer.join('').trim()
      if (remaining) ttsQueue = ttsQueue.then(() => playSentence(remaining, mySession))

      storeRef.current.addMessage({ role: 'assistant', content: fullText })

      ttsQueue
        .then(() => {
          if (sessionRef.current !== mySession) return
          console.log('[Pipeline] TTS done, restarting listening')
          isProcessingRef.current = false
          startListening()
        })
        .catch((err) => {
          if (sessionRef.current !== mySession) return
          console.error('[Pipeline] TTS error:', err)
          isProcessingRef.current = false
          startListening()
        })
    } catch (err) {
      if (sessionRef.current !== mySession) return
      console.error('[Pipeline] error:', err)
      storeRef.current.setError('エラーが発生しました')
      storeRef.current.setVoiceState('Idle')
      isProcessingRef.current = false
    }
  }

  // ── SpeechRecognition（実体） ─────────────────────────────
  const _doStartListening = () => {
    srDebounceRef.current = null

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR: typeof SpeechRecognition | undefined = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition
    if (!SR) {
      storeRef.current.setError('このブラウザは音声認識に対応していません（Chrome推奨）')
      return
    }

    const myGen = ++recognitionGenRef.current
    recognitionRef.current?.abort()

    const recognition = new SR()
    recognitionRef.current = recognition
    recognition.lang           = 'ja-JP'
    recognition.continuous     = false
    recognition.interimResults = false

    recognition.onstart = () => {
      console.log('[SR] started gen:', myGen)
      storeRef.current.setVoiceState('Listening')
    }

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      if (storeRef.current.voiceState !== 'Listening') {
        console.log('[SR] ignored result (not Listening)')
        return
      }
      const text = event.results[0][0].transcript.trim()
      console.log('[SR] result:', text)
      if (!text) return
      pendingTranscriptRef.current = text
    }

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return
      console.error('[SR] error:', event.error)
      if (event.error === 'network') {
        setTimeout(() => {
          if (recognitionGenRef.current === myGen) startListening()
        }, 500)
        return
      }
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        storeRef.current.setError('マイクへのアクセスが拒否されました')
        storeRef.current.setVoiceState('Idle')
        isProcessingRef.current = false
        return
      }
      setTimeout(() => {
        if (recognitionGenRef.current === myGen) startListening()
      }, 500)
    }

    recognition.onend = () => {
      if (recognitionGenRef.current !== myGen) return

      const transcript = pendingTranscriptRef.current
      if (transcript) {
        pendingTranscriptRef.current = null
        handleTranscript(transcript)
        return
      }

      if (storeRef.current.voiceState === 'Listening') startListening()
    }

    try {
      recognition.start()
    } catch (err) {
      console.error('[SR] start error:', err)
      storeRef.current.setVoiceState('Idle')
    }
  }

  // ── startListening（debounce ラッパー） ───────────────────
  const startListening = () => {
    if (srDebounceRef.current !== null) clearTimeout(srDebounceRef.current)
    srDebounceRef.current = setTimeout(_doStartListening, 300)
  }

  // ── タップ割り込み ───────────────────────────────────────
  const tapInterrupt = () => {
    console.log('[Tap] interrupt TTS, start listening')
    sessionRef.current++
    interruptTTS()
    startListening()
  }

  useEffect(() => {
    if (startRef)     startRef.current     = startListening
    if (interruptRef) interruptRef.current = tapInterrupt
  })

  useEffect(() => {
    startListening()
    return () => {
      if (srDebounceRef.current !== null) clearTimeout(srDebounceRef.current)
      recognitionRef.current?.abort()
      interruptTTS()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}
