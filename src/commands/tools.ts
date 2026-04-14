import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import type { Command } from '../command.js';
import type { Config } from '../config/schema.js';
import type { Tool, ToolParameters } from '../types/tool.js';
import { loadTools, addTool, updateTool, deleteTool } from '../tools/store.js';
import { UsageError } from '../errors/base.js';

export const toolsCommand: Command = {
  name: 'tools',
  description: '管理工具配置',
  usage: 'my-cli tools <add|list|enable|disable|delete>',
  examples: [
    'my-cli tools add',
    'my-cli tools list',
    'my-cli tools enable <name>',
    'my-cli tools disable <name>',
    'my-cli tools delete <name>',
  ],
  async execute(config: Config, flags: Record<string, unknown>, args: string[]) {
    const subcommand = args[0];

    switch (subcommand) {
      case 'add':
        await handleAdd();
        break;

      case 'list':
        await handleList();
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

      case 'delete': {
        if (!args[1]) {
          throw new UsageError('用法: my-cli tools delete <name>');
        }
        await handleDelete(args[1]);
        break;
      }

      default:
        process.stdout.write('用法: my-cli tools <add|list|enable|disable|delete>\n');
        break;
    }
  },
};

// 处理 list 子命令
async function handleList(): Promise<void> {
  const tools = loadTools();

  if (tools.length === 0) {
    process.stdout.write('暂无工具\n');
    return;
  }

  for (const tool of tools) {
    const status = tool.enabled ? 'enabled' : 'disabled';
    const builtin = tool.builtin ? ' [builtin]' : '';
    process.stdout.write(`[${status}]${builtin} ${tool.name}: ${tool.description}\n`);
    process.stdout.write(`  scriptPath: ${tool.scriptPath}\n`);
  }
}

// 处理 add 子命令（交互式）
async function handleAdd(): Promise<void> {
  const rl = readline.createInterface({ input, output });

  try {
    // 基本信息
    const name = await rl.question('工具名称: ');
    const description = await rl.question('工具描述: ');
    const scriptPath = await rl.question('JS/TS 脚本文件路径（绝对路径）: ');
    const paramCountStr = await rl.question('参数数量（整数）: ');
    const paramCount = parseInt(paramCountStr.trim(), 10);

    if (isNaN(paramCount) || paramCount < 0) {
      throw new UsageError('参数数量必须是有效的非负整数');
    }

    // 构建参数定义
    const properties: Record<string, { type: string; description: string }> = {};
    const required: string[] = [];

    for (let i = 0; i < paramCount; i++) {
      process.stdout.write(`\n配置第 ${i + 1} 个参数:\n`);
      const paramName = await rl.question('  参数名称: ');
      const paramTypeStr = await rl.question('  参数类型（string/number/boolean）: ');
      const paramDesc = await rl.question('  参数描述: ');
      const isRequiredStr = await rl.question('  是否必填（y/n）: ');

      const paramType = paramTypeStr.trim() as 'string' | 'number' | 'boolean';
      if (!['string', 'number', 'boolean'].includes(paramType)) {
        throw new UsageError('参数类型必须是 string、number 或 boolean 之一');
      }

      properties[paramName.trim()] = {
        type: paramType,
        description: paramDesc.trim(),
      };

      if (isRequiredStr.trim().toLowerCase() === 'y') {
        required.push(paramName.trim());
      }
    }

    const parameters: ToolParameters = {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
    };

    const tool: Tool = {
      name: name.trim(),
      description: description.trim(),
      enabled: true,
      scriptPath: scriptPath.trim(),
      parameters,
    };

    try {
      await addTool(tool);
      process.stdout.write(`工具 "${tool.name}" 已添加\n`);
    } catch (e) {
      process.stderr.write(`错误: ${(e as Error).message}\n`);
    }
  } finally {
    rl.close();
  }
}

// 处理 enable 子命令
async function handleEnable(name: string): Promise<void> {
  try {
    await updateTool(name, { enabled: true });
    process.stdout.write(`工具 "${name}" 已启用\n`);
  } catch (e) {
    process.stderr.write(`错误: ${(e as Error).message}\n`);
  }
}

// 处理 disable 子命令
async function handleDisable(name: string): Promise<void> {
  try {
    await updateTool(name, { enabled: false });
    process.stdout.write(`工具 "${name}" 已禁用\n`);
  } catch (e) {
    process.stderr.write(`错误: ${(e as Error).message}\n`);
  }
}

// 处理 delete 子命令
async function handleDelete(name: string): Promise<void> {
  try {
    await deleteTool(name);
    process.stdout.write(`工具 "${name}" 已删除\n`);
  } catch (e) {
    process.stderr.write(`错误: ${(e as Error).message}\n`);
  }
}
