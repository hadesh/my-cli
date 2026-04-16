/**
 * MCP Client - 封装 mcporter runtime 为 lazy singleton
 * 提供工具发现、调用、LLM function calling 格式转换等功能
 */

import { createRuntime, type Runtime, createCallResult, type ServerDefinition } from 'mcporter';
import type { MCPToolInfo } from './types.js';
import { loadMCPServers } from './config.js';

// lazy singleton runtime 实例
let _runtime: Runtime | null = null;

/**
 * 获取或初始化 Runtime 实例（lazy singleton）
 * 只加载 enabled: true 的 server
 */
async function getRuntime(): Promise<Runtime> {
  if (_runtime) {
    return _runtime;
  }

  const config = await loadMCPServers();

  const serverDefs: ServerDefinition[] = [];
  for (const [name, server] of Object.entries(config.mcpServers)) {
    if (!server.enabled) continue;

    if (server.type === 'remote') {
      serverDefs.push({
        name,
        command: {
          kind: 'http',
          url: new URL(server.url),
          ...(server.headers ? { headers: server.headers } : {}),
        },
      });
    } else {
      const [cmd, ...rest] = server.command;
      serverDefs.push({
        name,
        command: {
          kind: 'stdio',
          command: cmd,
          args: rest,
          cwd: process.cwd(),
        },
        ...(server.env ? { env: server.env } : {}),
      });
    }
  }

  _runtime = await createRuntime({ servers: serverDefs });
  return _runtime;
}

/**
 * 关闭 Runtime 并释放资源
 */
export async function closeRuntime(): Promise<void> {
  if (_runtime) {
    await _runtime.close();
    _runtime = null;
  }
}

/**
 * 获取所有 enabled MCP server 的工具列表
 * 对每个 server 调用 runtime.listTools，捕获异常打印 warn 并跳过
 * @returns MCPToolInfo 数组
 */
export async function listAllMCPTools(): Promise<MCPToolInfo[]> {
  const runtime = await getRuntime();
  const config = await loadMCPServers();

  const enabledServerNames = Object.entries(config.mcpServers)
    .filter(([, server]) => server.enabled)
    .map(([name]) => name);

  // 无 enabled server 时直接返回空数组
  if (enabledServerNames.length === 0) {
    return [];
  }

  const tools: MCPToolInfo[] = [];

  for (const serverName of enabledServerNames) {
    try {
      // 使用 includeSchema: true 获取完整 JSON Schema
      const serverTools = await runtime.listTools(serverName, { includeSchema: true });

      for (const tool of serverTools) {
        tools.push({
          serverName,
          toolName: tool.name,
          fullName: `${serverName}__${tool.name}`,
          description: tool.description,
          inputSchema: tool.inputSchema,
        });
      }
    } catch (error) {
      // 打印 warn 并继续下一个 server，不抛异常
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn(`[MCP] 获取 server "${serverName}" 工具列表失败: ${errorMessage}`);
      // 继续处理其他 server
    }
  }

  return tools;
}

/**
 * 调用指定的 MCP 工具
 * @param fullName 工具全名（格式：servername__toolname）
 * @param args 工具参数
 * @returns 工具调用结果的文本
 */
export async function callMCPTool(fullName: string, args: Record<string, unknown>): Promise<string> {
  // 拆分 fullName
  const parts = fullName.split('__', 2);
  if (parts.length !== 2) {
    throw new Error(`无效的 fullName 格式: ${fullName}，期望格式: servername__toolname`);
  }

  const [serverName, toolName] = parts;

  const runtime = await getRuntime();

  try {
    // 调用工具
    const result = await runtime.callTool(serverName, toolName, { args });

    // 使用 createCallResult 提取文本结果
    try {
      const callResult = createCallResult(result);
      const text = callResult.text();
      if (text !== undefined) {
        return text;
      }
    } catch {
      // 无法提取文本，使用 JSON 序列化 fallback
    }

    // JSON.stringify fallback
    return JSON.stringify(result);
  } catch (error) {
    // 打印 warn 后 re-throw
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn(`[MCP] 调用工具 "${fullName}" 失败: ${errorMessage}`);
    throw error;
  }
}

/**
 * 获取所有工具转换为 LLM function calling 格式
 * @returns OpenAI 风格的 tool definitions 数组
 */
export async function getMCPToolDefs(): Promise<
  { type: 'function'; function: { name: string; description: string; parameters: object } }[]
> {
  const tools = await listAllMCPTools();

  return tools.map(tool => ({
    type: 'function' as const,
    function: {
      name: tool.fullName,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));
}
