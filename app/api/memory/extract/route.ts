import { NextRequest } from 'next/server'
import OpenAI from 'openai'
import { upsertMemory } from '@/app/lib/memory'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export async function POST(request: NextRequest) {
  const { userId, userMessage, assistantMessage } = await request.json()

  if (!userId || !userMessage) {
    return Response.json({ error: 'userId and userMessage required' }, { status: 400 })
  }

  try {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `以下の会話から、ユーザーの個人情報・生活情報として記憶すべき事実があれば抽出してください。
なければ null を返してください。
出力はJSONのみ。余分なテキスト不要。
形式: { "key_statements": {"カテゴリ名": "事実"}, "frequent_topics": ["話題1"] }
カテゴリ例: family, job, hobby, residence, relationship など
ない項目は省略すること。`,
        },
        {
          role: 'user',
          content: `ユーザー: ${userMessage}\nアシスタント: ${assistantMessage ?? ''}`,
        },
      ],
      max_tokens: 200,
      temperature: 0,
    })

    const raw = res.choices[0]?.message?.content?.trim() ?? ''
    if (!raw || raw === 'null') return Response.json({ ok: true, extracted: null })

    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return Response.json({ ok: true, extracted: null })

    const extracted = JSON.parse(jsonMatch[0])
    if (!extracted.key_statements && !extracted.frequent_topics) {
      return Response.json({ ok: true, extracted: null })
    }

    await upsertMemory(userId, {
      key_statements: extracted.key_statements ?? null,
      frequent_topics: extracted.frequent_topics ?? null,
    })

    return Response.json({ ok: true, extracted })
  } catch (e) {
    console.error('[memory/extract]', e)
    return Response.json({ ok: false }, { status: 500 })
  }
}
