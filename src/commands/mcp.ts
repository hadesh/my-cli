import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import type { Command } from '../command.js';
import type { Config } from '../config/schema.js';
import {
  loadMCPServers,
  addMCPServer,
  removeMCPServer,
  enableMCPServer,
  disableMCPServer,
} from '../mcp/config.js';
import { printTable } from '../output/text.js';
import { success } from '../output/formatter.js';
import { UsageError } from '../errors/base.js';

export const mcpCommand: Command = {
  name: 'mcp',
  description: '管理 MCP server 配置',
  usage: 'my-cli mcp <add|list|remove|enable|disable>',
  examples: [
    'my-cli mcp add',
    'my-cli mcp list',
    'my-cli mcp remove myserver',
    'my-cli mcp enable myserver',
    'my-cli mcp disable myserver',
  ],
  async execute(config: Config, flags: Record<string, unknown>, args: string[]) {
    const subcommand = args[0];

    switch (subcommand) {
      case 'add':
        await handleAdd(config);
        break;

      case 'list':
        await handleList(config);
        break;

      case 'remove':
        if (!args[1]) throw new UsageError('用法: my-cli mcp remove <name>');
        await handleRemove(config, args[1]);
        break;

      case 'enable':
        if (!args[1]) throw new UsageError('用法: my-cli mcp enable <name>');
        await handleEnable(config, args[1]);
        break;

      case 'disable':
        if (!args[1]) throw new UsageError('用法: my-cli mcp disable <name>');
        await handleDisable(config, args[1]);
        break;

      default:
        throw new UsageError('用法: my-cli mcp <add|list|remove|enable|disable>');
    }
  },
};

async function handleAdd(config: Config): Promise<void> {
  const rl = readline.createInterface({ input, output });

  try {
    const name = (await rl.question('Server 名称: ')).trim();
    if (!name) throw new UsageError('Server 名称不能为空');

    const typeInput = (await rl.question('类型 (local/remote，默认 local): ')).trim().toLowerCase();
    const type = typeInput === 'remote' ? 'remote' : 'local';

    const enabledStr = (await rl.question('是否立即启用? (y/n，默认 y): ')).trim().toLowerCase();
    const enabled = enabledStr !== 'n';

    if (type === 'remote') {
      const url = (await rl.question('远程 URL (如 https://mcp.example.com/mcp): ')).trim();
      if (!url) throw new UsageError('远程 URL 不能为空');

      const headersStr = (await rl.question('请求头 (可选，格式 Key:Value，多个用逗号分隔): ')).trim();
      const headers: Record<string, string> = {};
      if (headersStr) {
        for (const pair of headersStr.split(',')) {
          const idx = pair.indexOf(':');
          if (idx > 0) {
            headers[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
          }
        }
      }

      await addMCPServer(name, {
        type: 'remote',
        url,
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
        enabled,
      });
    } else {
      const commandStr = (await rl.question('命令 (空格分隔，如 npx -y @modelcontextprotocol/server-filesystem /tmp): ')).trim();
      if (!commandStr) throw new UsageError('命令不能为空');
      const command = commandStr.split(/\s+/).filter(Boolean);

      await addMCPServer(name, {
        type: 'local',
        command,
        enabled,
      });
    }

    success(config, `已添加 MCP server: ${name}`);
  } finally {
    rl.close();
  }
}

async function handleList(config: Config): Promise<void> {
  const serversConfig = await loadMCPServers();
  const servers = Object.entries(serversConfig.mcpServers);

  if (servers.length === 0) {
    console.log('暂无已配置的 MCP server');
    return;
  }

  const rows = servers.map(([name, server]) => ({
    名称: name,
    类型: server.type,
    地址: server.type === 'remote' ? server.url : server.command.join(' '),
    状态: server.enabled ? '启用' : '禁用',
  }));

  printTable(config, rows);
}

async function handleRemove(config: Config, name: string): Promise<void> {
  await removeMCPServer(name);
  success(config, `已删除 MCP server: ${name}`);
}

async function handleEnable(config: Config, name: string): Promise<void> {
  await enableMCPServer(name);
  success(config, `已启用 MCP server: ${name}`);
}

async function handleDisable(config: Config, name: string): Promise<void> {
  await disableMCPServer(name);
  success(config, `已禁用 MCP server: ${name}`);
}
