import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { MCPServersConfig, MCPServerConfig } from './types.js';
import { MCP_SERVERS_FILE } from '../config/paths.js';
import { UsageError } from '../errors/base.js';

/**
 * 加载 MCP servers 配置
 * 文件不存在时返回空配置
 */
export async function loadMCPServers(): Promise<MCPServersConfig> {
  try {
    const file = Bun.file(MCP_SERVERS_FILE);
    const content = await file.json();
    return content as MCPServersConfig;
  } catch {
    // 文件不存在时返回空配置
    return { mcpServers: {} };
  }
}

/**
 * 保存 MCP servers 配置
 */
export async function saveMCPServers(config: MCPServersConfig): Promise<void> {
  const dir = join(MCP_SERVERS_FILE, '..');
  
  // 确保父目录存在
  mkdirSync(dir, { recursive: true });
  
  await Bun.write(MCP_SERVERS_FILE, JSON.stringify(config, null, 2));
}

/**
 * 添加 MCP server
 * 重名时抛出 UsageError
 */
export async function addMCPServer(name: string, serverConfig: MCPServerConfig): Promise<void> {
  const config = await loadMCPServers();
  
  // 检查重名
  if (config.mcpServers[name]) {
    throw new UsageError(`MCP server 已存在: ${name}`);
  }
  
  config.mcpServers[name] = serverConfig;
  await saveMCPServers(config);
}

/**
 * 删除 MCP server
 * 不存在时抛出 UsageError
 */
export async function removeMCPServer(name: string): Promise<void> {
  const config = await loadMCPServers();
  
  if (!config.mcpServers[name]) {
    throw new UsageError(`MCP server 不存在: ${name}`);
  }
  
  delete config.mcpServers[name];
  await saveMCPServers(config);
}

/**
 * 启用 MCP server
 * 不存在时抛出 UsageError
 */
export async function enableMCPServer(name: string): Promise<void> {
  const config = await loadMCPServers();
  
  if (!config.mcpServers[name]) {
    throw new UsageError(`MCP server 不存在: ${name}`);
  }
  
  config.mcpServers[name].enabled = true;
  await saveMCPServers(config);
}

/**
 * 禁用 MCP server
 * 不存在时抛出 UsageError
 */
export async function disableMCPServer(name: string): Promise<void> {
  const config = await loadMCPServers();
  
  if (!config.mcpServers[name]) {
    throw new UsageError(`MCP server 不存在: ${name}`);
  }
  
  config.mcpServers[name].enabled = false;
  await saveMCPServers(config);
}