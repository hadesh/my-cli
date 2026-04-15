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
        if (!args[1]) {
          throw new UsageError('用法: my-cli mcp remove <name>');
        }
        await handleRemove(config, args[1]);
        break;

      case 'enable':
        if (!args[1]) {
          throw new UsageError('用法: my-cli mcp enable <name>');
        }
        await handleEnable(config, args[1]);
        break;

      case 'disable':
        if (!args[1]) {
          throw new UsageError('用法: my-cli mcp disable <name>');
        }
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
    const name = await rl.question('Server 名称: ');
    const command = await rl.question('Command (如 npx): ');
    const argsStr = await rl.question('Args (空格分隔，如 -y @modelcontextprotocol/server-filesystem /tmp): ');
    const enabledStr = await rl.question('是否立即启用? (y/n，默认 y): ');

    const argsArray = argsStr.split(' ').filter(Boolean);
    const enabled = enabledStr.trim().toLowerCase() !== 'n';

    await addMCPServer(name.trim(), {
      command: command.trim(),
      args: argsArray,
      enabled,
    });

    success(config, `已添加 MCP server: ${name.trim()}`);
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
    命令: server.command,
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
