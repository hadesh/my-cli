import type { Command } from '../command.js';
import type { Config } from '../config/schema.js';
import { loadConfig, saveConfig } from '../config/loader.js';
import { UsageError } from '../errors/base.js';
import { getAllBuiltinDefs } from '../tools/store.js';

export const toolsFactory = {
  getAllBuiltinDefs,
  loadConfig,
  saveConfig,
};

export const toolsCommand: Command = {
  name: 'tools',
  description: '管理内置工具配置',
  usage: 'my-cli tools <list|enable|disable>',
  examples: [
    'my-cli tools list',
    'my-cli tools enable weather',
    'my-cli tools disable weather',
  ],
  async execute(config: Config, flags: Record<string, unknown>, args: string[]) {
    const subcommand = args[0];

    switch (subcommand) {
      case 'list':
        await handleList(config);
        break;

      case 'enable': {
        if (!args[1]) {
          throw new UsageError('用法: my-cli tools enable <name>');
        }
        await handleEnable(args[1]);
        break;
      }

      case 'disable': {
        if (!args[1]) {
          throw new UsageError('用法: my-cli tools disable <name>');
        }
        await handleDisable(args[1]);
        break;
      }

      default:
        process.stdout.write('用法: my-cli tools <list|enable|disable>\n');
        break;
    }
  },
};

async function handleList(config: Config): Promise<void> {
  const builtinTools = config.builtinTools ?? {};
  const defs = toolsFactory.getAllBuiltinDefs();

  if (defs.length === 0) {
    process.stdout.write('暂无内置工具\n');
    return;
  }

  for (const def of defs) {
    const enabled = builtinTools[def.name] !== false;
    const status = enabled ? 'enabled' : 'disabled';
    process.stdout.write(`[${status}] [builtin] ${def.name}: ${def.description}\n`);
  }
}

async function handleEnable(name: string): Promise<void> {
  const defs = toolsFactory.getAllBuiltinDefs();
  if (!defs.some(d => d.name === name)) {
    process.stderr.write(`错误: 未知工具 "${name}"\n`);
    return;
  }
  const config = toolsFactory.loadConfig();
  const builtinTools = { ...(config.builtinTools ?? {}), [name]: true };
  await toolsFactory.saveConfig({ builtinTools });
  process.stdout.write(`工具 "${name}" 已启用\n`);
}

async function handleDisable(name: string): Promise<void> {
  const defs = toolsFactory.getAllBuiltinDefs();
  if (!defs.some(d => d.name === name)) {
    process.stderr.write(`错误: 未知工具 "${name}"\n`);
    return;
  }
  const config = toolsFactory.loadConfig();
  const builtinTools = { ...(config.builtinTools ?? {}), [name]: false };
  await toolsFactory.saveConfig({ builtinTools });
  process.stdout.write(`工具 "${name}" 已禁用\n`);
}