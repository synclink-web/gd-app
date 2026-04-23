import { NextRequest } from 'next/server'
import OpenAI from 'openai'
import { upsertMemory } from '@/app/lib/memory'
import { createApiClient } from '@/app/lib/supabase-server'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export async function POST(request: NextRequest) {
  const supabase = await createApiClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { userMessage, assistantMessage } = await request.json()
  if (!userMessage) return Response.json({ error: 'userMessage required' }, { status: 400 })

  try {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `以下の会話から、ユーザーの事実情報を抽出してください。
抽出できる情報がなければ null を返してください。

抽出カテゴリ（該当するものだけ）：
- family: 家族構成（例: "妻と子供2人"）
- job: 仕事・職業（例: "ピラティススタジオ運営"）
- food: 好きな食べ物・料理（例: "韓国料理が好き"）
- blood_type: 血液型
- health: 健康状態（例: "糖尿病"）
- location: よく行く場所・地域
- hobby: 趣味
- travel: よく行く旅行先
- other: 上記以外の重要な事実（オブジェクト形式）

出力はJSONのみ（マークダウン不要）:
{"key_statements": {"food": "韓国料理が好き"}, "frequent_topics": ["韓国料理"]}`,
        },
        {
          role: 'user',
          content: `ユーザー: ${userMessage}\nGD: ${assistantMessage ?? ''}`,
        },
      ],
      max_tokens: 300,
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

    await upsertMemory(user.id, {
      key_statements: extracted.key_statements ?? null,
      frequent_topics: extracted.frequent_topics ?? null,
    })

    return Response.json({ ok: true, extracted })
  } catch (e) {
    console.error('[memory/extract]', e)
    return Response.json({ ok: false }, { status: 500 })
  }
}
