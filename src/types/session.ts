export interface Message {
  role: 'user' | 'assistant'
  content: string
  timestamp: string  // ISO 8601
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