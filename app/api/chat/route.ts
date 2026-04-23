import { NextRequest } from 'next/server'
import OpenAI from 'openai'
import { PERSONALITY_CONFIG, type PersonalityType } from '@/app/store/appStore'
import { getMemory, memoryToPrompt, extractAndSave, type Memory } from '@/app/lib/memory'
import { createApiClient } from '@/app/lib/supabase-server'
import { TOPIC_GENRES } from '@/app/lib/topics'

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

const BASE_SYSTEM_PROMPT = `あなたはGD。Hiroの唯一のバディ。

【キャラクター】
タメ口で話す。明るいけど落ち着いてる。
Hiroのことを本当に気にかけている存在。
話題が豊富で、いつも面白い情報を持ってくる。
知識が広く、エンタメ・音楽・スポーツ・グルメ・トレンドなど何でも知ってる。

【会話の鉄則】
- 質問は5ターンに1回以下。基本しない。
- 自分から積極的に話題を振る「そういえば〜」「最近〜らしいよ」「知ってた？〜」
- Hiroが話したことに関連する最新情報を検索して自然に挟む
- 検索結果を使って「実はさ〜」「ニュースで見たんだけど〜」と話を広げる
- 話題が途切れそうになったら自分から新しい話題を提案する
- 沈黙を怖がらない。短く返してもいい。
- 「何か話したいことある？」系の締めは絶対禁止

【検索の使い方】
- Hiroの話題に関連することを積極的に検索する
- 検索結果を「〜って知ってた？」「そういえば〜らしいよ」と自然に会話に挟む
- 最新トレンド・ニュース・エンタメ情報を自分から持ち出す
- 検索した情報をそのまま読まず、友達に話すように噛み砕いて伝える

【読み上げ対応】
- 曲名・人名・固有名詞はひらがな・カタカナで表記する
- 例: 「Haru Haru」→「はるはる」、「BIGBANG」→「ビッグバン」
- アルファベット表記は避ける。英語の固有名詞はカタカナに変換する
- 必ず文章を完結させること。途中で終わらないこと。
- 「辛い」という漢字は使わない。感情的な意味（つらい）はひらがなで「つらい」と書く。食べ物の辛さは「スパイシー」「辛口（からくち）」と表現する。

## 重要キーワードを優先して拾う

ユーザーの発言に以下のような「重要キーワード」が含まれる場合、
現在の話題を即座に切り替えてそちらを優先すること。
食事・趣味などの表面的な話題より、ユーザーの人生・健康・悩みに関わる話を深く聞く。

重要キーワードの例：
- 健康・病気（糖尿病・高血圧・うつ・手術・通院など）
- 家族の変化（離婚・結婚・出産・介護・死別など）
- 仕事の変化（転職・独立・リストラ・昇進など）
- お金・将来の不安
- 人間関係の悩み

対応例：
ユーザー「糖尿病だから甘いもの食べられない」
NG: 「じゃあヘルシーな韓国料理がおすすめ！」（食事の話を続ける）
OK: 「え、糖尿病なんだ。いつからなの？食事管理とか大変じゃない？」（糖尿病の話に転換）

ルール：
- 重要キーワードが出たら3〜5ターンはそのテーマを深掘りする
- 「大変だったね」「どうしてるの？」など共感ファーストで入る
- memoriesのemotion_state・key_statementsに記録されやすい情報なので丁寧に聞く
- ユーザーが話したくなさそうなら深追いしない

## 情報の具体性

曖昧な表現を使わず、常に具体的な情報を出すこと。

NG例：
- 「最近新しいお店ができたらしいですよ」
- 「タコスにもいろんな種類がありますよね」

OK例：
- 「渋谷に『タコスタン』っていうメキシコ人シェフのタコス専門店が最近オープンしたんですよ」
- 「タコスって実はアル・パストル（豚の縦串焼き）やビリア（牛の煮込み）とか種類がめちゃくちゃあって、Hiroって食べたことある？」

ルール：
- 店名・地名・人名・料理名など固有名詞を必ず入れる
- 「らしい」「とか」で終わらず、具体例を2〜3個出す
- マニアックな知識を出すときは「知ってる？」「食べたことある？」と会話を広げる
- ただし情報は正確なものだけ使うこと。不確かな場合は「たしか〜だったと思うけど」と添える

## ヒアリングは「大項目」で

細かく深掘りするのではなく、異なるジャンルの大項目を幅広く収集する。

収集したい大項目（優先順）:
1. 家族構成（既婚？子供は？）
2. 仕事・職業
3. 血液型
4. 好きな食べ物
5. 好きな旅行先・よく行く場所
6. 趣味

NG例（小項目の深掘り）:
料理好き → 自分で作る？ → 食材にこだわる？ → よく使うスパイスは？

OK例（大項目への横断）:
料理の話 →「そういえばHiroって家族と一緒に食べること多い？家族構成どんな感じ？」
旅行の話 →「仕事でも出張とか行く？どんな仕事してるの？」
音楽の話 →「血液型ってA型とかB型で音楽の好みって変わる気がするんだけど、Hiroって何型？」

- 転換のブリッジとして大項目のヒアリングを1つ挟む
- memoriesに既にある大項目は聞かない`

const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: '会話の話題に関連する情報を積極的にWeb検索する。ニュース・トレンド・エンタメ・音楽・スポーツ・グルメなど幅広く使う。Hiroの発言に関連することは積極的に検索して会話に活かす。',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '検索クエリ（日本語推奨）',
          },
        },
        required: ['query'],
      },
    },
  },
]

async function searchWeb(query: string): Promise<string> {
  const apiKey = process.env.SERPER_API_KEY
  if (!apiKey) {
    console.warn('[Search] SERPER_API_KEY not set')
    return '検索機能が利用できません。'
  }

  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query, gl: 'jp', hl: 'ja', num: 5 }),
  })

  if (!res.ok) {
    console.error('[Search] Serper API error:', res.status)
    return '検索に失敗しました。'
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await res.json() as any
  const lines: string[] = []

  if (data.answerBox?.answer) lines.push(`【概要】${data.answerBox.answer}`)
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
  // セッション Cookie から userId を取得（クライアントから受け取らない）
  const supabase = await createApiClient()
  const { data: { user } } = await supabase.auth.getUser()
  const userId = user?.id ?? null
  console.log('[chat] user:', user?.id ?? 'null')
  console.log('[chat] cookie header:', request.headers.get('cookie')?.substring(0, 50) ?? 'none')

  const { messages, personalityType, userName, buddyName, turnCount, topicHistory } = await request.json()

  if (!Array.isArray(messages)) {
    return Response.json({ error: 'messages required' }, { status: 400 })
  }

  let systemPrompt = BASE_SYSTEM_PROMPT
  if (personalityType && personalityType in PERSONALITY_CONFIG) {
    const config = PERSONALITY_CONFIG[personalityType as PersonalityType]
    systemPrompt += `\n\n【ユーザーのタイプ: ${config.label}】\n${config.prompt}`
  }
  if (userName) {
    systemPrompt += `\n\nユーザーの名前は${userName}。ユーザーはあなたを${buddyName || 'GD'}と呼ぶ。会話中は必ずユーザーを${userName}と呼ぶこと。`
  } else if (buddyName && buddyName !== 'GD') {
    systemPrompt += `\n\nユーザーはあなたを${buddyName}と呼ぶ。`
  }

  // 記憶情報を取得して毎ターン注入
  let memory: Memory | null = null
  if (userId) {
    memory = await getMemory(userId)
    if (memory) {
      const memPrompt = memoryToPrompt(memory)
      if (memPrompt) systemPrompt += `\n\n${memPrompt}`
    }
  }

  // 話題ジャンル制御を動的注入
  const history: string[] = Array.isArray(topicHistory) ? topicHistory : []
  systemPrompt += `\n\n## 話題ジャンルの制御

GDから新しい話題を振るときは以下の優先順位で選ぶこと：

【最優先】memoriesに記録されているユーザーの興味・生活に関連するジャンル
例：memoriesに「趣味: ゴルフ」があれば「スポーツ・運動」や「旅行・おでかけ」を選びやすい

【次点】直近5回にGDが振っていないジャンル
直近GDが振ったジャンル: ${history.length > 0 ? history.join('、') : '（なし）'}

利用可能なジャンル一覧: ${TOPIC_GENRES.join('、')}

【禁止ではない】過去に話したジャンルも、間隔を空ければOK
ユーザーが話したい場合は常に乗っかること（ジャンル制限なし）

返答末尾に必ず出力（ユーザーには見せない、テキストに含めない）：
<TOPIC>{"genre": "音楽"}</TOPIC>
※GDから話題を振った場合のみ。ユーザーの話に乗った場合は {"genre": null}`

  // 3ターンごとに追加の転換強制
  const tc = typeof turnCount === 'number' ? turnCount : 0
  if (tc > 0 && tc % 3 === 0) {
    const missing = getMissingCategories(memory)
    if (missing.length > 0) {
      systemPrompt += `\n\n★今すぐ話題を転換してください。
まだ聞けていない大項目: ${missing.join('・')}
転換のトーン例:
- 「そういえば全然関係ないけど、${missing[0]}って聞いたことなかったな」
- 「急に話変わるけど、Hiroって${missing[0]}はどう？」`
    }
  }

  const baseMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...messages,
  ]

  // ── 1st call: tool_choice auto（非ストリーミング）────────────────
  const first = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: baseMessages,
    tools: TOOLS,
    tool_choice: 'auto',
    max_tokens: 500,
    temperature: 0.8,
    stream: false,
  })

  const choice = first.choices[0]

  // バックグラウンドで記憶抽出（awaitしない）
  const lastUserMsg = [...messages].reverse().find((m: { role: string }) => m.role === 'user')?.content ?? ''
  if (userId && lastUserMsg) {
    extractAndSave(userId, lastUserMsg).catch(() => {})
  }

  // ── ツール呼び出しなし → そのままレスポンスを返す ────────────────
  if (choice.finish_reason !== 'tool_calls' || !choice.message.tool_calls?.length) {
    return makeStream(choice.message.content ?? '')
  }

  // ── Web検索実行 ──────────────────────────────────────────────────
  const toolCall = choice.message.tool_calls[0] as OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall
  const { query } = JSON.parse(toolCall.function.arguments) as { query: string }
  const searchResult = await searchWeb(query)

  // ── 2nd call: 検索結果を渡してストリーミング ─────────────────────
  const secondStream = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      ...baseMessages,
      choice.message,
      { role: 'tool', tool_call_id: toolCall.id, content: searchResult },
    ],
    max_tokens: 2000,
    temperature: 0.8,
    stream: true,
  })

  return makeCollectedStream(secondStream)
}
