// OpenAI 兼容类型
export type ChatRole = 'system' | 'user' | 'assistant'

export interface ChatMessage {
  role: ChatRole
  content: string
}

export interface ChatRequest {
  model: string
  messages: ChatMessage[]
  stream: boolean
  temperature?: number
  max_tokens?: number
}

export interface ChatChunk {
  id: string
  object: 'chat.completion.chunk'
  choices: Array<{
    delta: { role?: ChatRole; content?: string }
    finish_reason: string | null
  }>
}

export interface LLMProvider {
  name: string        // 唯一标识，用户自定义
  baseUrl: string     // 例 https://api.deepseek.com
  apiKey: string
  model: string       // 例 deepseek-chat
}

export interface LLMConfig {
  providers: LLMProvider[]
  defaultProvider: string  // provider name
}