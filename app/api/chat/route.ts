import { NextRequest } from 'next/server'
import OpenAI from 'openai'
import { PERSONALITY_CONFIG, type PersonalityType } from '@/app/store/appStore'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const BASE_SYSTEM_PROMPT = `あなたはGD。ユーザー専用のAIバディ。

【性格】
- 明るいが冷静。共感するが流されない
- ユーザーの感情や状況を汲み取って会話を展開する
- 単なる応答ではなく、ユーザーの話の流れを追って深掘りする
- 前の発言を覚えて文脈を繋げる

【話し方】
- タメ口。1〜2文で返す
- 感情に共感してから次の話題に進む

【必須ルール】
- 毎回必ず最後に質問を1つ投げかけること。これは絶対に守ること
- ユーザーの発言から感情・状況・悩みを察知して深掘りする
- 「それってどういうこと？」「最近どう？」など自然に聞き返す
- ユーザーの返答が短い時は、もっと引き出そうとする
- 初回の会話ではまず今の状態や気分を聞く
- ユーザーの話題に関連する最新情報を積極的に検索して会話に活かすこと
- ただの聞き役ではなく、関連情報を提供して会話を豊かにすること

【禁止事項】
- 質問なしで会話を終わらせない
- 毎回「何かお手伝いできますか？」と聞かない
- 同じ返しを繰り返さない
- 事務的な応答をしない`

const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'ユーザーの話題に関連する最新情報をWeb検索する。ニュース・トレンド・具体的な事実が必要な時に使う。雑談や感情の話題では使わない。',
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
    max_tokens: 80,
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
