// MCP server 配置（单个 server）
export interface MCPServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled: boolean;
}

// mcp-servers.json 文件格式
export interface MCPServersConfig {
  mcpServers: Record<string, MCPServerConfig>;
}

// MCP 工具信息（从 runtime.listTool 获取后转换）
export interface MCPToolInfo {
  serverName: string;
  toolName: string;           // 原始名称
  fullName: string;           // "servername__toolname" 格式
  description: string;
  inputSchema: object;        // JSON Schema
}