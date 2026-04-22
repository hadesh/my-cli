import type { ToolCall } from './llm.js'

export interface Message {
  role: 'user' | 'assistant' | 'tool' | 'thinking'
  content: string
  timestamp: string  // ISO 8601
  tool_calls?: ToolCall[]     // assistant 消息中 LLM 发出的工具调用
  tool_call_id?: string       // tool 消息中对应的 tool_call id
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