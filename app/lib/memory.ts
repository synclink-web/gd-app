import OpenAI from 'openai'
import { createServiceClient } from './supabase-server'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export interface KeyStatements {
  family?: string
  job?: string
  food?: string
  blood_type?: string
  health?: string
  location?: string
  hobby?: string
  travel?: string
  other?: Record<string, string>
}

export interface Memory {
  key_statements: KeyStatements | null
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
      const existingKs = (existing.key_statements as Record<string, unknown>) ?? {}
      const newKs = patch.key_statements as Record<string, unknown>
      // "other" は深くマージ、他は上書き
      const mergedOther = {
        ...(existingKs.other as Record<string, string> ?? {}),
        ...(newKs.other as Record<string, string> ?? {}),
      }
      merged.key_statements = {
        ...existingKs,
        ...newKs,
        ...(Object.keys(mergedOther).length > 0 ? { other: mergedOther } : {}),
      }
    }

    if (patch.frequent_topics?.length) {
      const combined = [...(existing.frequent_topics ?? []), ...patch.frequent_topics]
      merged.frequent_topics = [...new Set(combined)].slice(-10)
    }

    if (patch.emotion_state) {
      merged.emotion_state = patch.emotion_state.slice(0, 200)
    }

    if (patch.past_insights?.length) {
      const combined = [...(existing.past_insights ?? []), ...patch.past_insights]
      merged.past_insights = [...new Set(combined)].slice(-10)
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

const EXTRACT_SYSTEM_PROMPT = `以下の会話から、ユーザーの事実情報を抽出してください。
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
{"key_statements": {"food": "韓国料理が好き"}, "frequent_topics": ["韓国料理"]}`

export async function extractAndSave(userId: string, userMessage: string, assistantMessage = ''): Promise<void> {
  try {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: EXTRACT_SYSTEM_PROMPT },
        { role: 'user', content: `ユーザー: ${userMessage}\nGD: ${assistantMessage}` },
      ],
      max_tokens: 300,
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

export function memoryToPrompt(m: Memory, userName = 'あなた'): string {
  const ks = (m.key_statements ?? {}) as Record<string, unknown>
  const lines: string[] = []

  if (ks.family)     lines.push(`・家族: ${ks.family}`)
  if (ks.job)        lines.push(`・仕事: ${ks.job}`)
  if (ks.food)       lines.push(`・好きな食べ物: ${ks.food}`)
  if (ks.health)     lines.push(`・健康: ${ks.health}`)
  if (ks.location)   lines.push(`・よく行く場所: ${ks.location}`)
  if (ks.hobby)      lines.push(`・趣味: ${ks.hobby}`)
  if (ks.blood_type) lines.push(`・血液型: ${ks.blood_type}`)
  if (ks.travel)     lines.push(`・旅行先: ${ks.travel}`)
  if (m.frequent_topics?.length) {
    lines.push(`・よく話すテーマ: ${m.frequent_topics.join('、')}`)
  }
  if (m.emotion_state) lines.push(`・最近の状態: ${m.emotion_state}`)

  if (lines.length === 0) return ''

  return `## ${userName}について知っていること
${lines.join('\n')}

この情報を自然に会話に活かすこと。
知っている情報は改めて聞かない。
「前に言ってたね」「〇〇が好きだもんね」と自然に使う。`
}
