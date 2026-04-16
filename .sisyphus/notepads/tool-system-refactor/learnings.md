# Learnings - tool-system-refactor

## 项目技术栈
- Bun + TypeScript
- 入口：src/main.ts
- 命令注册：src/registry.ts（树形 Registry）
- 配置：~/.config/my-cli/config.json（zod schema 校验）
- 错误类：src/errors/base.ts（CLIError/UsageError/AuthError/NetworkError/LLMError）

## 关键路径常量（src/config/paths.ts）
- CONFIG_DIR = ~/.config/my-cli
- 需新增：MCP_SERVERS_FILE = path.join(CONFIG_DIR, 'mcp-servers.json')

## mcporter API（已研究确认）
- 安装：bun add mcporter
- createRuntime({ mcpServers: { name: { command, args, env } } }) → Runtime
- runtime.listTools(serverName, { includeSchema: true }) → ServerToolInfo[]
- runtime.callTool(serverName, toolName, { args }) → unknown
- createCallResult(result).text() 提取文本结果
- runtime.close() 释放资源
- 配置格式：{ "mcpServers": { "name": { "command": "...", "args": [...] } } }

## 命名规范
- MCP 工具：servername__toolname（双下划线）
- 内置工具：直接用 toolDef.name（如 weather）

## 参照模式
- src/llm/config.ts → mcp/config.ts 的读写模式
- src/commands/llm.ts → mcp 命令的子命令路由模式
- src/commands/session.ts → 错误处理和输出格式
