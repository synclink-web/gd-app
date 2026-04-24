import OpenAI from 'openai'
import { createClient } from '@supabase/supabase-js'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// service_role key で RLS をバイパス
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

export interface Episode {
  id: string
  user_id: string
  occurred_at: string
  topic: string
  summary: string
  emotion: string | null
  followup: string | null
  followup_done: boolean
  importance: number
  created_at: string
}

interface ExtractedEpisode {
  topic: string
  summary: string
  emotion: string | null
  followup: string | null
  importance: number
}

const EXTRACT_PROMPT = `このセッションから記憶すべき重要なエピソードを抽出してください。
1セッションから最大5件まで。なければ空配列。
出力はJSONのみ（マークダウン不要）:
[{
  "topic": "仕事",
  "summary": "新しいプロジェクトで上司との関係に悩んでいた",
  "emotion": "ストレス・不安",
  "followup": "上司との件、その後どうなったか次回聞く",
  "importance": 2
}]
importanceは1(通常)・2(重要)・3(非常に重要)で判定。
followupは次回聞くべきことがあれば記載、なければnull。`

async function embedText(text: string): Promise<number[] | null> {
  try {
    const res = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
    })
    return res.data[0]?.embedding ?? null
  } catch (e) {
    console.warn('[episodes/embed]', e)
    return null
  }
}

interface ExtractEpisodesArgs {
  userId: string
  sessionId: string | null
  messages: Array<{ role: string; content: string }>
}

interface ExtractEpisodesResult {
  generatedCount: number
  insertedCount: number
}

export async function extractEpisodes(
  { userId, sessionId, messages }: ExtractEpisodesArgs
): Promise<ExtractEpisodesResult> {
  console.log('[episodes] extracting from messages:', messages.length)
  const transcript = messages
    .map((m) => `${m.role === 'user' ? 'ユーザー' : 'GD'}: ${m.content}`)
    .join('\n')

  let raw: string
  try {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: EXTRACT_PROMPT },
        { role: 'user',   content: transcript },
      ],
      max_tokens: 800,
      temperature: 0,
    })
    raw = res.choices[0]?.message?.content?.trim() ?? ''
  } catch (e) {
    console.error('[episodes] OpenAI API error:', e)
    throw e
  }

  console.log('[episodes] GPT response:', raw)

  if (!raw || raw === '[]') {
    console.log('[episodes] no episodes to extract')
    return { generatedCount: 0, insertedCount: 0 }
  }

  const jsonMatch = raw.match(/\[[\s\S]*\]/)
  if (!jsonMatch) {
    console.error('[episodes] JSON parse failed, raw:', raw)
    return { generatedCount: 0, insertedCount: 0 }
  }

  let extracted: ExtractedEpisode[]
  try {
    extracted = JSON.parse(jsonMatch[0])
  } catch (e) {
    console.error('[episodes] JSON.parse error:', e, 'raw:', jsonMatch[0])
    return { generatedCount: 0, insertedCount: 0 }
  }

  if (!Array.isArray(extracted) || extracted.length === 0) {
    console.log('[episodes] extracted array empty')
    return { generatedCount: 0, insertedCount: 0 }
  }

  console.log('[episodes] embedding count:', extracted.length)
  console.log('[episodes] using service role:', !!process.env.SUPABASE_SERVICE_ROLE_KEY)

  // embeddingは原因切り分けのため一旦無効化（nullで保存）
  const rows = extracted.map((ep) => ({
    user_id:    userId,
    session_id: sessionId ?? null,
    topic:      ep.topic,
    summary:    ep.summary,
    emotion:    ep.emotion ?? null,
    followup:   ep.followup ?? null,
    importance: ep.importance ?? 1,
    embedding:  null,
  }))

  const { data, error } = await supabaseAdmin
    .from('episodes')
    .insert(rows)
    .select()

  if (error) {
    console.error('[episodes insert error]', error)
    throw error
  }
  console.log('[episodes inserted]', data?.length)

  return { generatedCount: extracted.length, insertedCount: data?.length ?? 0 }
}

export async function getRecentEpisodes(userId: string, limit = 10): Promise<Episode[]> {
  try {
    const supabase = supabaseAdmin
    const { data, error } = await supabase
      .from('episodes')
      .select('id, user_id, occurred_at, topic, summary, emotion, followup, followup_done, importance, created_at')
      .eq('user_id', userId)
      .order('occurred_at', { ascending: false })
      .limit(limit)
    if (error || !data) return []
    // followup未完了を先頭に
    return (data as Episode[]).sort((a, b) => {
      if (!a.followup_done && b.followup_done) return -1
      if (a.followup_done && !b.followup_done) return 1
      return 0
    })
  } catch {
    return []
  }
}

export async function searchRelatedEpisodes(
  userId: string,
  queryText: string,
  limit = 5
): Promise<Episode[]> {
  try {
    const embedding = await embedText(queryText)
    if (!embedding) return []

    const supabase = supabaseAdmin
    const { data, error } = await supabase.rpc('match_episodes', {
      query_embedding: `[${embedding.join(',')}]`,
      match_user_id:   userId,
      match_count:     limit,
    })
    if (error || !data) return []
    return data as Episode[]
  } catch {
    return []
  }
}

export async function getPendingFollowups(userId: string): Promise<Episode[]> {
  try {
    const supabase = supabaseAdmin
    const { data, error } = await supabase
      .from('episodes')
      .select('id, user_id, occurred_at, topic, summary, emotion, followup, followup_done, importance, created_at')
      .eq('user_id', userId)
      .eq('followup_done', false)
      .not('followup', 'is', null)
      .order('importance', { ascending: false })
      .order('occurred_at', { ascending: false })
      .limit(3)
    if (error || !data) return []
    return data as Episode[]
  } catch {
    return []
  }
}

export async function markFollowupDone(episodeId: string): Promise<void> {
  try {
    const supabase = supabaseAdmin
    await supabase
      .from('episodes')
      .update({ followup_done: true })
      .eq('id', episodeId)
  } catch (e) {
    console.warn('[episodes/markFollowupDone]', e)
  }
}

export function episodesToPrompt(
  recent: Episode[],
  related: Episode[],
  followups: Episode[],
  turnCount: number
): string {
  const parts: string[] = []

  if (recent.length > 0) {
    const lines = recent.map((ep) => {
      const date = new Date(ep.occurred_at).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })
      const emotion = ep.emotion ? `（感情: ${ep.emotion}）` : ''
      const fu = !ep.followup_done && ep.followup ? `\n  ※次回確認: ${ep.followup}` : ''
      return `- [${date}] ${ep.topic}: ${ep.summary}${emotion}${fu}`
    })
    parts.push(`## 最近の出来事（記憶）\n${lines.join('\n')}`)
  }

  // 直近と重複しないものだけ追加
  const recentIds = new Set(recent.map((e) => e.id))
  const uniqueRelated = related.filter((e) => !recentIds.has(e.id)).slice(0, 3)
  if (uniqueRelated.length > 0) {
    const lines = uniqueRelated.map((ep) => {
      const emotion = ep.emotion ? `（感情: ${ep.emotion}）` : ''
      return `- ${ep.topic}: ${ep.summary}${emotion}`
    })
    parts.push(`## 関連する過去の記憶\n${lines.join('\n')}`)
  }

  // フォローアップはセッション開始時（turnCount === 1）のみ注入
  if (turnCount === 1 && followups.length > 0) {
    const lines = followups.map((ep) => `- ${ep.followup}`)
    parts.push(`## 次回必ず確認すること（自然な「そういえば〜」で切り出すこと）\n${lines.join('\n')}`)
  }

  return parts.join('\n\n')
}
