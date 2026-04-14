// 工具参数 JSON Schema
export interface ToolParameters {
  type: 'object'
  properties: Record<string, { type: string; description: string }>
  required?: string[]
}

// 单个工具定义（持久化格式）
export interface Tool {
  name: string           // 唯一标识，LLM 调用时使用
  description: string    // 工具功能描述，发给 LLM
  enabled: boolean       // 是否在 ask 中启用
  command: string        // Shell 命令模板，如 "curl {{url}}"
  parameters: ToolParameters
}

// tools.json 文件格式
export interface ToolsConfig {
  tools: Tool[]
}