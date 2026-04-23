import { weatherToolDef, weatherExecutor } from './builtin/weather.js'
import {
  readFileToolDef, writeFileToolDef, appendFileToolDef,
  readFileExecutorExport, writeFileExecutorExport, appendFileExecutorExport,
} from './builtin/file.js'
import { getMCPToolDefs, callMCPTool } from '../mcp/client.js'
import type { BuiltinToolDef, UnifiedTool } from '../types/tool.js'
import type { Config } from '../config/schema.js'
import type { ToolExecutor } from './base.js'

// 所有内置工具定义（硬编码注册表）
const BUILTIN_DEFS: BuiltinToolDef[] = [weatherToolDef, readFileToolDef, writeFileToolDef, appendFileToolDef]

// 内置工具执行器映射
const BUILTIN_EXECUTORS: Record<string, ToolExecutor> = {
  weather: weatherExecutor,
  read_file: readFileExecutorExport,
  write_file: writeFileExecutorExport,
  append_file: appendFileExecutorExport,
}

/**
 * 返回所有内置工具定义列表
 */
export function getAllBuiltinDefs(): BuiltinToolDef[] {
  return BUILTIN_DEFS
}

/**
 * 根据 config.builtinTools 过滤，返回已启用的内置工具定义
 * 默认启用（config.builtinTools[name] 未设置时视为 true）
 */
export function getEnabledBuiltinDefs(config: Config): BuiltinToolDef[] {
  return BUILTIN_DEFS.filter(d => config.builtinTools?.[d.name] !== false)
}

/**
 * 根据名称返回内置工具执行器
 */
export function getBuiltinExecutor(name: string): ToolExecutor | undefined {
  return BUILTIN_EXECUTORS[name]
}

/**
 * 聚合内置工具 + MCP 工具，返回统一格式（供 ask.ts 使用）
 */
export async function getUnifiedToolDefs(config: Config): Promise<UnifiedTool[]> {
  // 内置工具（已启用的）
  const builtins: UnifiedTool[] = getEnabledBuiltinDefs(config).map(d => ({
    name: d.name,
    description: d.description,
    parameters: d.parameters,
    source: 'builtin' as const,
  }))

  // MCP 工具（从 client 获取，失败时已在 client 内部降级）
  const mcpDefs = await getMCPToolDefs()
  const mcps: UnifiedTool[] = mcpDefs.map(d => ({
    name: d.function.name,
    description: d.function.description,
    parameters: d.function.parameters as import('../types/tool.js').ToolParameters,
    source: 'mcp' as const,
  }))

  return [...builtins, ...mcps]
}

/**
 * 根据工具名称执行工具
 * - 内置工具：直接调用 executor.execute()
 * - MCP 工具（servername__toolname 格式）：通过 callMCPTool 调用
 */
export async function executeUnifiedTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  const executor = getBuiltinExecutor(name)
  if (executor) {
    return executor.execute(args as Record<string, string>)
  }
  // MCP 工具（包含 __ 的名称）
  return callMCPTool(name, args)
}
