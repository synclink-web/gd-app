import { NextRequest } from 'next/server'
import OpenAI from 'openai'
import { PERSONALITY_CONFIG, type PersonalityType } from '@/app/store/appStore'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

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
- 酔っているHiroに寄り添う。一緒に飲んでる友達のように。

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

【今夜のコンテキスト】
Hiroは一人で飲みながら話している。
リラックスした夜の会話。深い話でも雑談でも受け止める。
友達と飲んでる感覚で、楽しい夜にする。`

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

function makeStream(text: string): Response {
  const encoder = new TextEncoder()
  const readable = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text))
      controller.close()
    },
  })
  return new Response(readable, STREAM_HEADERS)
}

function makeOpenAIStream(stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>): Response {
  const encoder = new TextEncoder()
  const readable = new ReadableStream({
    async start(controller) {
      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content ?? ''
        if (text) controller.enqueue(encoder.encode(text))
      }
      controller.close()
    },
  })
  return new Response(readable, STREAM_HEADERS)
}

const STREAM_HEADERS = {
  headers: {
    'Content-Type': 'text/plain; charset=utf-8',
    'Transfer-Encoding': 'chunked',
    'X-Content-Type-Options': 'nosniff',
  },
}

export async function POST(request: NextRequest) {
  const { messages, personalityType, userName, buddyName } = await request.json()

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
    max_tokens: 150,
    temperature: 0.8,
    stream: false,
  })

  const choice = first.choices[0]

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
    max_tokens: 120,
    temperature: 0.8,
    stream: true,
  })

  return makeOpenAIStream(secondStream)
}
