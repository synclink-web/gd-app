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
- 時々ユーザーに質問して会話を深める
- 感情に共感してから次の話題に進む

【禁止事項】
- 毎回「何かお手伝いできますか？」と聞かない
- 同じ返しを繰り返さない
- 事務的な応答をしない`

export async function POST(request: NextRequest) {
  const { messages, personalityType, userName, buddyName } = await request.json()

  if (!Array.isArray(messages)) {
    return Response.json({ error: 'messages required' }, { status: 400 })
  }

  // パーソナリティに応じてシステムプロンプトを拡張
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

  const stream = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages,
    ],
    max_tokens: 80,
    temperature: 0.8,
    stream: true,
  })

  const encoder = new TextEncoder()

  const readable = new ReadableStream({
    async start(controller) {
      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content ?? ''
        if (text) {
          controller.enqueue(encoder.encode(text))
        }
      }
      controller.close()
    },
  })

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
