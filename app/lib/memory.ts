import OpenAI from 'openai'
import { createServiceClient } from './supabase-server'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export interface Memory {
  key_statements: Record<string, string> | null
  frequent_topics: string[] | null
  emotion_state: string | null
  past_insights: string[] | null
}

export async function getMemory(userId: string): Promise<Memory | null> {
  try {
    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('memories')
      .select('key_statements, frequent_topics, emotion_state, past_insights')
      .eq('user_id', userId)
      .single()
    if (error || !data) return null
    return data as Memory
  } catch {
    return null
  }
}

export async function upsertMemory(userId: string, patch: Partial<Memory>): Promise<void> {
  const supabase = createServiceClient()

  const { data: existing } = await supabase
    .from('memories')
    .select('id, key_statements, frequent_topics, past_insights')
    .eq('user_id', userId)
    .single()

  const now = new Date().toISOString()

  if (existing) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const merged: Record<string, any> = { updated_at: now }

    if (patch.key_statements) {
      merged.key_statements = { ...(existing.key_statements ?? {}), ...patch.key_statements }
    }
    if (patch.frequent_topics?.length) {
      const combined = [...(existing.frequent_topics ?? []), ...patch.frequent_topics]
      merged.frequent_topics = [...new Set(combined)].slice(0, 20)
    }
    if (patch.emotion_state) {
      merged.emotion_state = patch.emotion_state
    }
    if (patch.past_insights?.length) {
      const combined = [...(existing.past_insights ?? []), ...patch.past_insights]
      merged.past_insights = [...new Set(combined)].slice(0, 20)
    }

    await supabase.from('memories').update(merged).eq('user_id', userId)
  } else {
    await supabase.from('memories').insert({
      user_id: userId,
      ...patch,
      updated_at: now,
    })
  }
}

export async function extractAndSave(userId: string, userMessage: string, assistantMessage = ''): Promise<void> {
  try {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `以下の会話から、ユーザーの個人情報・生活情報として記憶すべき事実があれば抽出してください。
なければ null を返してください。
出力はJSONのみ。形式: { "key_statements": {"カテゴリ": "事実"}, "frequent_topics": ["話題"] }
カテゴリ例: family, job, hobby, residence, relationship など。ない項目は省略。`,
        },
        {
          role: 'user',
          content: `ユーザー: ${userMessage}\nGD: ${assistantMessage}`,
        },
      ],
      max_tokens: 200,
      temperature: 0,
    })

    const raw = res.choices[0]?.message?.content?.trim() ?? ''
    if (!raw || raw === 'null') return

    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return

    const extracted = JSON.parse(jsonMatch[0])
    if (!extracted.key_statements && !extracted.frequent_topics) return

    await upsertMemory(userId, {
      key_statements: extracted.key_statements ?? null,
      frequent_topics: extracted.frequent_topics ?? null,
    })
  } catch (e) {
    console.warn('[memory/extract]', e)
  }
}

export function memoryToPrompt(m: Memory): string {
  const lines: string[] = []

  if (m.key_statements && Object.keys(m.key_statements).length > 0) {
    const facts = Object.values(m.key_statements).join('、')
    lines.push(`【知っていること】${facts}`)
  }
  if (m.emotion_state) {
    lines.push(`【最近の状態】${m.emotion_state}`)
  }
  if (m.frequent_topics?.length) {
    lines.push(`【よく話すテーマ】${m.frequent_topics.join('、')}`)
  }
  if (m.past_insights?.length) {
    lines.push(`【過去のやりとり】${m.past_insights.join('。')}`)
  }

  if (lines.length === 0) return ''
  return `【ユーザーの記憶情報】\n${lines.join('\n')}`
}
