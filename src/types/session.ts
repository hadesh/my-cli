import type { ToolCall } from './llm.js'

export interface AttachmentMeta {
  name: string
  path: string
}

export interface Message {
  role: 'user' | 'assistant' | 'tool' | 'thinking'
  content: string
  timestamp: string
  tool_calls?: ToolCall[]
  tool_call_id?: string
  attachments?: AttachmentMeta[]
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

export interface Session {
  id: string          // YYYYMMDD-HHmmss-<4位随机>
  name: string        // 用户自定义名称，默认 "New Chat"
  createdAt: string   // ISO 8601
  updatedAt: string
  messages: Message[]
}

export interface SessionIndex {
  sessions: string[]  // session id 列表
  activeSessionId: string | null
}