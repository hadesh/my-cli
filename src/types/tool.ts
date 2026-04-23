// 工具参数 JSON Schema
export interface ToolParameters {
  type: 'object'
  properties: Record<string, { type: string; description: string }>
  required?: string[]
}

// 内置工具定义（代码直调,不经过脚本）
export interface BuiltinToolDef {
  name: string           // 唯一标识,LLM 调用时使用
  description: string    // 工具功能描述,发给 LLM
  enabled: boolean       // 默认启用状态
  parameters: ToolParameters
}

// 统一工具类型（内置工具 + MCP 工具的统一视图）
export interface UnifiedTool {
  name: string           // 内置工具：直接名称；MCP 工具：servername__toolname
  description: string
  parameters: ToolParameters
  source: 'builtin' | 'mcp'
}