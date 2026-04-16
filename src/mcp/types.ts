// 本地命令模式（stdio transport）
export interface MCPLocalServerConfig {
  type: 'local';
  command: string[];   // 完整命令数组，如 ["npx", "-y", "@modelcontextprotocol/server-filesystem"]
  env?: Record<string, string>;
  enabled: boolean;
}

// 远程 HTTP/SSE 模式
export interface MCPRemoteServerConfig {
  type: 'remote';
  url: string;                          // HTTP/SSE endpoint URL
  headers?: Record<string, string>;     // 可选请求头（如 Authorization）
  enabled: boolean;
}

// discriminated union
export type MCPServerConfig = MCPLocalServerConfig | MCPRemoteServerConfig;

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