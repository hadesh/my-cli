// OpenAI 兼容类型
export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'

// 多模态内容类型（OpenAI 格式）
export interface TextContentPart {
  type: 'text'
  text: string
}

export interface ImageContentPart {
  type: 'image_url'
  image_url: {
    url: string
    detail?: 'auto' | 'low' | 'high'
  }
}

export type ContentPart = TextContentPart | ImageContentPart

export interface ChatMessage {
  role: ChatRole
  content: string | ContentPart[]
  tool_call_id?: string    // tool 消息专用（role === 'tool' 时使用）
  tool_calls?: ToolCall[]  // assistant 消息专用（LLM 返回 tool_calls 时）
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
    delta: { role?: ChatRole; content?: string; reasoning_content?: string }
    finish_reason: string | null
  }>
}

export type Modality = 'text' | 'image' | 'audio' | 'video'

export interface ThinkingOption {
  type: 'enabled' | 'disabled'
  budgetTokens?: number
}

export interface ModelOptions {
  thinking?: ThinkingOption
  [key: string]: unknown
}

export interface ModelInfo {
  name: string
  modalities?: {
    input: Modality[]
    output: Modality[]
  }
  options?: ModelOptions
  limit?: {
    context: number  // 上下文窗口（tokens）
    output: number   // 最大输出（tokens）
  }
}

export type ModelMap = Record<string, ModelInfo>

export interface LLMProvider {
  name: string        // 唯一标识，用户自定义
  baseUrl: string     // 例 https://api.deepseek.com
  apiKey: string
  model: string       // 例 deepseek-chat
  models?: ModelMap
}

export interface LLMConfig {
  providers: LLMProvider[]
  defaultProvider: string  // provider name
}

// Function Calling 扩展类型（Qwen 兼容）

export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: object
  }
}

export interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string  // JSON 字符串
  }
}

// 非流式 LLM 响应（用于 chatWithTools）
export interface ChatResponse {
  choices: Array<{
    message: {
      role: 'assistant'
      content: string | null
      tool_calls?: ToolCall[]
      reasoning_content?: string | null
    }
    finish_reason: string
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}