import type { Command } from '../command.js';
import type { Config } from '../config/schema.js';
import { loadConfig, saveConfig } from '../config/loader.js';
import { UsageError } from '../errors/base.js';

// 内置工具定义（硬编码，Task 7 的 store.ts 重构后会改为从 store 导入）
const BUILTIN_TOOL_NAMES = ['weather'];

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

  if (BUILTIN_TOOL_NAMES.length === 0) {
    process.stdout.write('暂无内置工具\n');
    return;
  }

  for (const name of BUILTIN_TOOL_NAMES) {
    // 默认 enabled（未在 config 中显式设置为 false 时视为启用）
    const enabled = builtinTools[name] !== false;
    const status = enabled ? 'enabled' : 'disabled';
    process.stdout.write(`[${status}] [builtin] ${name}\n`);
  }
}

async function handleEnable(name: string): Promise<void> {
  if (!BUILTIN_TOOL_NAMES.includes(name)) {
    process.stderr.write(`错误: 未知工具 "${name}"\n`);
    return;
  }
  const config = loadConfig();
  const builtinTools = { ...(config.builtinTools ?? {}), [name]: true };
  await saveConfig({ builtinTools });
  process.stdout.write(`工具 "${name}" 已启用\n`);
}

async function handleDisable(name: string): Promise<void> {
  if (!BUILTIN_TOOL_NAMES.includes(name)) {
    process.stderr.write(`错误: 未知工具 "${name}"\n`);
    return;
  }
  const config = loadConfig();
  const builtinTools = { ...(config.builtinTools ?? {}), [name]: false };
  await saveConfig({ builtinTools });
  process.stdout.write(`工具 "${name}" 已禁用\n`);
}