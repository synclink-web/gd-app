import { NextRequest } from 'next/server'

const TTS_ENDPOINT = 'https://texttospeech.googleapis.com/v1/text:synthesize'

export async function POST(request: NextRequest) {
  const { text, voiceName = 'ja-JP-Neural2-B' } = await request.json()

  if (!text || typeof text !== 'string') {
    return Response.json({ error: 'text required' }, { status: 400 })
  }

  const apiKey = process.env.GOOGLE_TTS_API_KEY
  if (!apiKey) {
    console.error('[TTS] GOOGLE_TTS_API_KEY is not set')
    return Response.json({ error: 'TTS not configured' }, { status: 500 })
  }

  const requestBody = {
    input: { text },
    voice: { languageCode: 'ja-JP', name: voiceName },
    audioConfig: { audioEncoding: 'MP3', speakingRate: 1.4 },
  }

  const res = await fetch(`${TTS_ENDPOINT}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  })

  if (!res.ok) {
    const rawBody = await res.text().catch(() => '')
    console.error('[TTS] Google API error status:', res.status, res.statusText)
    console.error('[TTS] Google API error body:', rawBody)
    let detail: unknown = rawBody
    try { detail = JSON.parse(rawBody) } catch { /* keep as string */ }
    return Response.json(
      { error: 'TTS failed', googleStatus: res.status, detail },
      { status: 500 }
    )
  }

  // Google が返す base64 の audioContent をバイナリに変換して返す
  const { audioContent } = await res.json() as { audioContent: string }
  const buffer = Buffer.from(audioContent, 'base64')

  return new Response(buffer, {
    headers: {
      'Content-Type': 'audio/mpeg',
      'Content-Length': buffer.byteLength.toString(),
    },
  })
}
