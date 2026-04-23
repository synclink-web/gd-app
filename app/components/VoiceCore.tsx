'use client'

import { useEffect, useRef, useState, type RefObject } from 'react'
import { useAppStore } from '@/app/store/appStore'

const SENTENCE_RE = /([^。！？\n]+[。！？\n])/g

// ── グローバル AudioContext（一度作ったら使い回す） ─────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let globalAudioCtx: AudioContext | null = null

function getAudioCtx(): AudioContext {
  if (!globalAudioCtx) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Ctor = (window as any).AudioContext ?? (window as any).webkitAudioContext
    globalAudioCtx = new Ctor() as AudioContext
  }
  return globalAudioCtx
}

// ── モジュールレベルのデバッグログ ──────────────────────────
let _onNewLog: ((logs: string[]) => void) | null = null
let _logBuffer: string[] = []

function dbg(msg: string) {
  const ts = new Date().toISOString().slice(11, 19)
  const line = `${ts} ${msg}`
  console.log('[TTS-DBG]', msg)
  _logBuffer = [..._logBuffer.slice(-9), line]
  _onNewLog?.([..._logBuffer])
}

// ── TTSQueue：AudioContext経由でシリアル再生 ─────────────────
class TTSQueue {
  private queue: Array<{ url: string; resolve: () => void }> = []
  private isPlaying = false
  private currentSource: AudioBufferSourceNode | null = null

  enqueue(url: string): Promise<void> {
    dbg(`enqueue: ${url.substring(0, 30)}`)
    return new Promise<void>((resolve) => {
      this.queue.push({ url, resolve })
      if (!this.isPlaying) this.processNext()
    })
  }

  private processNext(): void {
    if (this.queue.length === 0) {
      this.isPlaying = false
      return
    }
    this.isPlaying = true
    const item = this.queue.shift()!
    this.playOnce(item.url).then(() => {
      item.resolve()
      this.processNext()
    })
  }

  private async playOnce(url: string): Promise<void> {
    dbg(`playOnce: ${url.substring(0, 30)}`)
    return new Promise<void>(async (resolve) => {
      try {
        const ctx = getAudioCtx()

        // suspended なら resume（iOSバックグラウンド復帰後など）
        if (ctx.state === 'suspended') {
          dbg(`ctx suspended, resuming...`)
          await ctx.resume()
          dbg(`ctx resumed: ${ctx.state}`)
        }

        dbg(`fetch blob url`)
        const response = await fetch(url)
        const arrayBuffer = await response.arrayBuffer()
        dbg(`decodeAudioData size=${arrayBuffer.byteLength}`)
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer)
        dbg(`decoded duration=${audioBuffer.duration.toFixed(2)}s`)

        const source = ctx.createBufferSource()
        source.buffer = audioBuffer
        source.connect(ctx.destination)
        this.currentSource = source

        source.onended = () => {
          dbg(`ended duration=${audioBuffer.duration.toFixed(2)}s`)
          URL.revokeObjectURL(url)
          if (this.currentSource === source) this.currentSource = null
          resolve()
        }

        dbg('source.start(0)')
        source.start(0)
      } catch (e) {
        dbg(`playOnce error: ${(e as Error)?.name} ${(e as Error)?.message}`)
        console.error('[TTS] AudioContext play error:', e)
        URL.revokeObjectURL(url)
        resolve()
      }
    })
  }

  stop(): void {
    dbg(`stop: clearing ${this.queue.length} queued`)
    for (const { resolve } of this.queue) resolve()
    this.queue = []
    this.isPlaying = false
    if (this.currentSource) {
      try { this.currentSource.stop() } catch { /* already stopped */ }
      this.currentSource = null
    }
  }
}

interface Props {
  startRef?: RefObject<(() => void) | null>
  interruptRef?: RefObject<(() => void) | null>
  endRef?: RefObject<(() => void) | null>
}

export default function VoiceCore({ startRef, interruptRef, endRef }: Props) {
  const recognitionRef       = useRef<SpeechRecognition | null>(null)
  const isProcessingRef      = useRef(false)
  const sessionRef           = useRef(0)
  const recognitionGenRef    = useRef(0)
  const pendingTranscriptRef = useRef<string | null>(null)
  const srDebounceRef        = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasGreetedRef        = useRef(false)
  const audioUnlockedRef     = useRef(false)
  const ttsQueueRef          = useRef(new TTSQueue())

  const [debugLogs, setDebugLogs] = useState<string[]>([])
  const [showDebug, setShowDebug] = useState(true)

  useEffect(() => {
    _onNewLog = setDebugLogs
    return () => { _onNewLog = null }
  }, [])

  const storeRef = useRef(useAppStore.getState())
  useEffect(() => useAppStore.subscribe((s) => { storeRef.current = s }), [])

  // ── iOS AudioContext アンロック（ユーザージェスチャー内で同期的に呼ぶ） ──
  const unlockAudioForIOS = () => {
    if (audioUnlockedRef.current) return
    audioUnlockedRef.current = true
    dbg('unlock: creating AudioContext')

    try {
      const ctx = getAudioCtx()
      dbg(`ctx state: ${ctx.state}`)

      // 無音バッファを再生してiOSのAutoplay制限を解除
      const buffer = ctx.createBuffer(1, 1, 22050)
      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.connect(ctx.destination)
      source.start(0)
      dbg('unlock: silent buffer started')

      // suspend状態なら resume
      if (ctx.state === 'suspended') {
        ctx.resume().then(() => dbg(`unlock resume: ${ctx.state}`)).catch(() => {})
      }
    } catch (e) {
      dbg(`unlock error: ${(e as Error)?.message}`)
    }
  }

  // ── マイク許諾の事前取得 ──────────────────────────────────
  const acquireMic = async (): Promise<boolean> => {
    if (!navigator.mediaDevices?.getUserMedia) return true
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000,
        },
      })
      stream.getTracks().forEach((t) => t.stop())
      dbg('mic permission ok')
      return true
    } catch (err) {
      const name = (err as DOMException)?.name
      dbg(`mic denied: ${name}`)
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        storeRef.current.setError('マイクの使用を許可してください')
        storeRef.current.setVoiceState('Idle')
      }
      return false
    }
  }

  // ── TTS 停止 ─────────────────────────────────────────────
  const interruptTTS = () => {
    ttsQueueRef.current.stop()
    isProcessingRef.current = false
  }

  // ── TTS 再生（TTSQueue経由） ──────────────────────────────
  const playSentence = async (text: string, mySession: number): Promise<void> => {
    if (sessionRef.current !== mySession) return
    dbg(`fetch TTS: "${text.slice(0, 20)}"`)

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
        dbg(`TTS HTTP ${res.status}, retry`)
        await new Promise<void>((r) => setTimeout(r, 1000))
        if (sessionRef.current !== mySession) return
        res = await doFetch()
        if (sessionRef.current !== mySession) return
        if (!res.ok) { dbg(`TTS retry failed ${res.status}`); return }
      }

      const blob = await res.blob()
      if (sessionRef.current !== mySession) return
      if (blob.size === 0) { dbg('TTS empty blob'); return }

      const url = URL.createObjectURL(blob)
      dbg(`blob ok size=${blob.size}`)
      if (sessionRef.current !== mySession) { URL.revokeObjectURL(url); return }

      await ttsQueueRef.current.enqueue(url)
    } catch (err) {
      dbg(`playSentence error: ${(err as Error)?.message}`)
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
    store.incrementTurnCount()

    try {
      const allMessages = useAppStore.getState().messages
      const messages    = allMessages.slice(-10)
      const { personalityType, userName, buddyName, turnCount, topicHistory } = useAppStore.getState()
      const chatRes = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, personalityType, userName, buddyName, turnCount, topicHistory }),
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
        // <<GENRE:...>> マーカーを表示テキストから除外
        const displayChunk = chunk.replace(/<<GENRE:[^>]*>>/g, '')
        if (displayChunk) storeRef.current.appendAssistantText(displayChunk)

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

      const genreMatch = fullText.match(/<<GENRE:([^>]*)>>/)
      const detectedGenre = genreMatch?.[1] ?? null
      const cleanFullText = fullText.replace(/<<GENRE:[^>]*>>/g, '').trim()

      const remaining = pendingBuffer.join('').replace(/<<GENRE:[^>]*>>/g, '').trim()
      if (remaining) ttsQueue = ttsQueue.then(() => playSentence(remaining, mySession))

      if (detectedGenre && detectedGenre !== 'null') {
        useAppStore.getState().addTopic(detectedGenre)
      }
      storeRef.current.setAssistantText(cleanFullText)
      storeRef.current.addMessage({ role: 'assistant', content: cleanFullText })

      ttsQueue
        .then(() => {
          if (sessionRef.current !== mySession) return
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

  // ── SpeechRecognition ────────────────────────────────────
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
    recognition.continuous     = true
    recognition.interimResults = true

    recognition.onstart  = () => { storeRef.current.setVoiceState('Listening') }

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      if (storeRef.current.voiceState !== 'Listening') return

      let interimText = ''
      let finalText = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript
        if (event.results[i].isFinal) finalText += t
        else interimText += t
      }

      if (finalText.trim()) {
        pendingTranscriptRef.current = finalText.trim()
        recognition.stop()
      } else if (interimText) {
        storeRef.current.setTranscript(interimText)
      }
    }

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return
      console.error('[SR] error:', event.error)
      if (event.error === 'network') {
        setTimeout(() => { if (recognitionGenRef.current === myGen) startListening() }, 500)
        return
      }
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        storeRef.current.setError('マイクへのアクセスが拒否されました')
        storeRef.current.setVoiceState('Idle')
        isProcessingRef.current = false
        return
      }
      setTimeout(() => { if (recognitionGenRef.current === myGen) startListening() }, 500)
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

  const startListening = () => {
    if (srDebounceRef.current !== null) clearTimeout(srDebounceRef.current)
    srDebounceRef.current = setTimeout(_doStartListening, 300)
  }

  // ── 初回挨拶 + リスニング開始 ─────────────────────────────
  const greetAndStart = async () => {
    // ユーザージェスチャー内でAudioContextをunlock（同期）
    unlockAudioForIOS()

    const permitted = await acquireMic()
    if (!permitted) return

    // AudioContext unlock完了待ち
    await new Promise<void>((r) => setTimeout(r, 300))

    if (hasGreetedRef.current) {
      startListening()
      return
    }
    hasGreetedRef.current = true

    const mySession = ++sessionRef.current
    isProcessingRef.current = true

    const { userName } = useAppStore.getState()
    const greeting = userName
      ? `${userName}、最近どう？何か話したいことある？`
      : `最近どう？何か話したいことある？`

    storeRef.current.setAssistantText(greeting)
    storeRef.current.addMessage({ role: 'assistant', content: greeting })
    storeRef.current.setVoiceState('Speaking')

    playSentence(greeting, mySession).then(() => {
      if (sessionRef.current !== mySession) return
      storeRef.current.setAssistantText('')
      isProcessingRef.current = false
      startListening()
    })
  }

  const tapInterrupt = () => {
    sessionRef.current++
    interruptTTS()
    startListening()
  }

  const endSession = () => {
    sessionRef.current++
    if (srDebounceRef.current !== null) clearTimeout(srDebounceRef.current)
    recognitionRef.current?.abort()
    interruptTTS()
    hasGreetedRef.current = false

    const { messages } = useAppStore.getState()
    if (messages.length > 1) {
      fetch('/api/memory/consolidate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages }),
        keepalive: true,
      }).catch(() => {})
    }

    storeRef.current.resetSession()
  }

  useEffect(() => {
    if (startRef)     startRef.current     = greetAndStart
    if (interruptRef) interruptRef.current = tapInterrupt
    if (endRef)       endRef.current       = endSession
  })

  useEffect(() => {
    return () => {
      if (srDebounceRef.current !== null) clearTimeout(srDebounceRef.current)
      recognitionRef.current?.abort()
      ttsQueueRef.current.stop()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── デバッグパネル ────────────────────────────────────────
  return (
    <div
      style={{ position: 'fixed', bottom: 8, right: 8, zIndex: 9999, width: 260, maxWidth: '90vw' }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        onClick={() => setShowDebug((v) => !v)}
        style={{
          fontSize: 10, padding: '2px 6px', background: 'rgba(0,0,0,0.6)',
          color: '#0f0', border: '1px solid #0f0', borderRadius: 4,
          cursor: 'pointer', display: 'block', marginLeft: 'auto',
        }}
      >
        {showDebug ? 'hide log' : 'show log'}
      </button>
      {showDebug && (
        <div style={{
          background: 'rgba(0,0,0,0.75)', color: '#0f0', fontSize: 9,
          fontFamily: 'monospace', padding: 6, borderRadius: 4,
          marginTop: 2, maxHeight: 160, overflowY: 'auto',
        }}>
          {debugLogs.length === 0
            ? <span style={{ color: '#666' }}>no logs yet</span>
            : debugLogs.map((l, i) => <div key={i}>{l}</div>)
          }
        </div>
      )}
    </div>
  )
}
