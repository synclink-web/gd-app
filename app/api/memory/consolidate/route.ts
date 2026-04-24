import { NextRequest } from 'next/server'
import OpenAI from 'openai'
import { upsertMemory } from '@/app/lib/memory'
import { extractEpisodes } from '@/app/lib/episodes'
import { createApiClient } from '@/app/lib/supabase-server'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

interface Message {
  role: 'user' | 'assistant'
  content: string
}

export async function POST(request: NextRequest) {
  const supabase = await createApiClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as { messages?: Message[]; sessionId?: string | null }
  const { messages, sessionId = null } = body

  console.log('[consolidate] body', {
    userId: user.id,
    sessionId,
    messagesLength: messages?.length,
  })

  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ ok: false, error: 'No messages provided' }, { status: 400 })
  }

  const transcript = messages
    .map((m) => `${m.role === 'user' ? 'ユーザー' : 'GD'}: ${m.content}`)
    .join('\n')

  // エピソード抽出（await）
  let episodeResult = { generatedCount: 0, insertedCount: 0 }
  try {
    episodeResult = await extractEpisodes({ userId: user.id, sessionId, messages })
    console.log('[consolidate] extractEpisodes result:', episodeResult)
  } catch (e) {
    console.error('[consolidate] extractEpisodes error:', e)
  }

  try {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `以下の会話セッション全体を分析し、以下の3点をJSONで出力してください。
出力はJSONのみ。余分なテキスト不要。
形式:
{
  "emotion_state": "このセッション全体を通じたユーザーの感情傾向（1〜2文）",
  "past_insights": ["GDがユーザーに伝えた重要なアドバイス・気づきの要約"],
  "frequent_topics": ["会話で頻出したテーマ・話題"]
}`,
        },
        { role: 'user', content: transcript },
      ],
      max_tokens: 400,
      temperature: 0,
    })

    const raw = res.choices[0]?.message?.content?.trim() ?? ''
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return Response.json({
        ok: true,
        debug: { userId: user.id, sessionId, messagesLength: messages.length, ...episodeResult },
      })
    }

    const consolidated = JSON.parse(jsonMatch[0])
    await upsertMemory(user.id, {
      emotion_state: consolidated.emotion_state ?? null,
      past_insights: consolidated.past_insights ?? null,
      frequent_topics: consolidated.frequent_topics ?? null,
    })

    return Response.json({
      ok: true,
      debug: {
        userId: user.id,
        sessionId,
        messagesLength: messages.length,
        generatedEpisodesCount: episodeResult.generatedCount,
        insertedEpisodesCount:  episodeResult.insertedCount,
      },
    })
  } catch (e) {
    console.error('[memory/consolidate]', e)
    return Response.json({ ok: false }, { status: 500 })
  }
}
