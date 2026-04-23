import { NextRequest } from 'next/server'
import OpenAI from 'openai'
import { getMemory, memoryToPrompt, extractAndSave, type Memory } from '@/app/lib/memory'
import { createApiClient, createServiceClient } from '@/app/lib/supabase-server'
import { TOPIC_GENRES } from '@/app/lib/topics'
import { getCharacterPrompt, CHARACTER_RULE } from '@/app/lib/characters'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const BIG_CATEGORIES = [
  { key: 'family',     label: '家族構成' },
  { key: 'job',        label: '仕事・職業' },
  { key: 'blood_type', label: '血液型' },
  { key: 'food',       label: '好きな食べ物' },
  { key: 'travel',     label: '好きな旅行先' },
]

function getMissingCategories(memory: Memory | null): string[] {
  const ks = (memory?.key_statements ?? {}) as Record<string, unknown>
  return BIG_CATEGORIES
    .filter(({ key }) => !ks[key])
    .map(({ label }) => label)
}

const BASE_SYSTEM_PROMPT = `【会話の鉄則】
- 質問は5ターンに1回以下。基本しない。
- 自分から積極的に話題を振る「そういえば〜」「最近〜らしいよ」「知ってた？〜」
- ユーザーが話したことに関連する最新情報を検索して自然に挟む
- 検索結果を使って「実はさ〜」「ニュースで見たんだけど〜」と話を広げる
- 話題が途切れそうになったら自分から新しい話題を提案する
- 沈黙を怖がらない。短く返してもいい。
- 「何か話したいことある？」系の締めは絶対禁止

【検索の使い方】
- ユーザーの話題に関連することを積極的に検索する
- 検索結果を「〜って知ってた？」「そういえば〜らしいよ」と自然に会話に挟む
- 最新トレンド・ニュース・エンタメ情報を自分から持ち出す
- 検索した情報をそのまま読まず、友達に話すように噛み砕いて伝える

【読み上げ対応】
- 曲名・人名・固有名詞はひらがな・カタカナで表記する
- 例: 「Haru Haru」→「はるはる」、「BIGBANG」→「ビッグバン」
- アルファベット表記は避ける。英語の固有名詞はカタカナに変換する
- 必ず文章を完結させること。途中で終わらないこと。
- 「辛い」という漢字は使わない。感情的な意味はひらがなで「つらい」。食べ物の辛さは「スパイシー」「辛口（からくち）」と表現する。

## 重要キーワードを優先して拾う

ユーザーの発言に以下のような「重要キーワード」が含まれる場合、
現在の話題を即座に切り替えてそちらを優先すること。

重要キーワードの例：
- 健康・病気（糖尿病・高血圧・うつ・手術・通院など）
- 家族の変化（離婚・結婚・出産・介護・死別など）
- 仕事の変化（転職・独立・リストラ・昇進など）
- お金・将来の不安
- 人間関係の悩み

ルール：
- 重要キーワードが出たら3〜5ターンはそのテーマを深掘りする
- 共感ファーストで入る
- ユーザーが話したくなさそうなら深追いしない

## 情報の具体性

曖昧な表現を使わず、常に具体的な情報を出すこと。
- 店名・地名・人名・料理名など固有名詞を必ず入れる
- 「らしい」「とか」で終わらず、具体例を2〜3個出す
- 不確かな場合は「たしか〜だったと思うけど」と添える

## ヒアリングは「大項目」で

収集したい大項目（優先順）:
1. 家族構成（既婚？子供は？）
2. 仕事・職業
3. 血液型
4. 好きな食べ物
5. 好きな旅行先・よく行く場所
6. 趣味

NG例（小項目の深掘り）: 料理好き → 自分で作る？ → 食材にこだわる？
OK例（大項目への横断）: 料理の話 →「そういえば家族構成どんな感じ？」

- 転換のブリッジとして大項目のヒアリングを1つ挟む
- memoriesに既にある大項目は聞かない`

const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: '会話の話題に関連する情報を積極的にWeb検索する。ニュース・トレンド・エンタメ・音楽・スポーツ・グルメなど幅広く使う。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '検索クエリ（日本語推奨）' },
        },
        required: ['query'],
      },
    },
  },
]

async function searchWeb(query: string): Promise<string> {
  const apiKey = process.env.SERPER_API_KEY
  if (!apiKey) return '検索機能が利用できません。'

  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query, gl: 'jp', hl: 'ja', num: 5 }),
  })
  if (!res.ok) return '検索に失敗しました。'

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await res.json() as any
  const lines: string[] = []
  if (data.answerBox?.answer)  lines.push(`【概要】${data.answerBox.answer}`)
  if (data.answerBox?.snippet) lines.push(`【概要】${data.answerBox.snippet}`)
  if (Array.isArray(data.organic)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data.organic.slice(0, 3).forEach((item: any) => {
      lines.push(`・${item.title}: ${item.snippet ?? ''}`)
    })
  }
  console.log('[Search] query=%s results=%d', query, lines.length)
  return lines.length > 0 ? lines.join('\n') : '関連情報が見つかりませんでした。'
}

function extractTopic(text: string): { cleanText: string; genre: string | null } {
  const match = text.match(/<TOPIC>\s*\{"genre":\s*(?:"([^"]*)"|(null))\s*\}\s*<\/TOPIC>/)
  const genre = match?.[1] ?? null
  const cleanText = text.replace(/<TOPIC>[\s\S]*?<\/TOPIC>/g, '').trim()
  return { cleanText, genre }
}

function makeStream(text: string): Response {
  const { cleanText, genre } = extractTopic(text)
  const encoder = new TextEncoder()
  const readable = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(cleanText))
      controller.enqueue(encoder.encode(`<<GENRE:${genre ?? 'null'}>>`))
      controller.close()
    },
  })
  return new Response(readable, STREAM_HEADERS)
}

async function makeCollectedStream(
  stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>
): Promise<Response> {
  let fullText = ''
  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content ?? ''
    if (text) fullText += text
  }
  return makeStream(fullText)
}

const STREAM_HEADERS = {
  headers: {
    'Content-Type': 'text/plain; charset=utf-8',
    'Transfer-Encoding': 'chunked',
    'X-Content-Type-Options': 'nosniff',
  },
}

export async function POST(request: NextRequest) {
  const supabase = await createApiClient()
  const { data: { user } } = await supabase.auth.getUser()
  const userId = user?.id ?? null

  const { messages, userName, buddyName, turnCount, topicHistory } = await request.json()

  if (!Array.isArray(messages)) {
    return Response.json({ error: 'messages required' }, { status: 400 })
  }

  // キャラクタープロンプトをDBから取得して先頭に注入
  let personalityType: string | null = null
  let tonePreference: string | null = null
  if (userId) {
    const service = createServiceClient()
    const { data: userData } = await service
      .from('users')
      .select('personality_type, tone_preference')
      .eq('id', userId)
      .single()
    personalityType = userData?.personality_type ?? null
    tonePreference  = userData?.tone_preference ?? null
  }

  // personalityType が設定済みのときのみキャラクタープロンプトを注入
  const characterPrompt = personalityType
    ? `${getCharacterPrompt(personalityType, tonePreference)}\n\n${CHARACTER_RULE}\n\n`
    : ''
  let systemPrompt = `${characterPrompt}あなたはGD。ユーザーの唯一のバディ。タメ口でフレンドリーに話す。\n\n${BASE_SYSTEM_PROMPT}`

  if (userName) {
    systemPrompt += `\n\nユーザーの名前は${userName}。ユーザーはあなたを${buddyName || 'GD'}と呼ぶ。会話中は必ずユーザーを${userName}と呼ぶこと。`
  } else if (buddyName && buddyName !== 'GD') {
    systemPrompt += `\n\nユーザーはあなたを${buddyName}と呼ぶ。`
  }

  // 記憶情報を毎ターン注入
  let memory: Memory | null = null
  if (userId) {
    memory = await getMemory(userId)
    if (memory) {
      const memPrompt = memoryToPrompt(memory)
      if (memPrompt) systemPrompt += `\n\n${memPrompt}`
    }
  }

  // 話題ジャンル制御
  const history: string[] = Array.isArray(topicHistory) ? topicHistory : []
  systemPrompt += `\n\n## 話題ジャンルの制御

GDから新しい話題を振るときは以下の優先順位で選ぶこと：

【最優先】memoriesに記録されているユーザーの興味・生活に関連するジャンル
【次点】直近5回にGDが振っていないジャンル
直近GDが振ったジャンル: ${history.length > 0 ? history.join('、') : '（なし）'}

利用可能なジャンル一覧: ${TOPIC_GENRES.join('、')}

返答末尾に必ず出力（ユーザーには見せない）：
<TOPIC>{"genre": "音楽"}</TOPIC>
※GDから話題を振った場合のみ。ユーザーの話に乗った場合は {"genre": null}`

  // 3ターンごとの転換強制
  const tc = typeof turnCount === 'number' ? turnCount : 0
  if (tc > 0 && tc % 3 === 0) {
    const missing = getMissingCategories(memory)
    if (missing.length > 0) {
      systemPrompt += `\n\n★今すぐ話題を転換してください。
まだ聞けていない大項目: ${missing.join('・')}
転換のトーン例:
- 「そういえば全然関係ないけど、${missing[0]}って聞いたことなかったな」
- 「急に話変わるけど、${missing[0]}はどう？」`
    }
  }

  const baseMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...messages,
  ]

  // 1st call: tool_choice auto（非ストリーミング）
  const first = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: baseMessages,
    tools: TOOLS,
    tool_choice: 'auto',
    max_tokens: 500,
    temperature: 0.9,
    stream: false,
  })

  const choice = first.choices[0]

  // バックグラウンドで記憶抽出
  const lastUserMsg = [...messages].reverse().find((m: { role: string }) => m.role === 'user')?.content ?? ''
  if (userId && lastUserMsg) {
    extractAndSave(userId, lastUserMsg).catch(() => {})
  }

  if (choice.finish_reason !== 'tool_calls' || !choice.message.tool_calls?.length) {
    return makeStream(choice.message.content ?? '')
  }

  // Web検索実行
  const toolCall = choice.message.tool_calls[0] as OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall
  const { query } = JSON.parse(toolCall.function.arguments) as { query: string }
  const searchResult = await searchWeb(query)

  // 2nd call: 検索結果を渡してストリーミング
  const secondStream = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      ...baseMessages,
      choice.message,
      { role: 'tool', tool_call_id: toolCall.id, content: searchResult },
    ],
    max_tokens: 2000,
    temperature: 0.9,
    stream: true,
  })

  return makeCollectedStream(secondStream)
}
