import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import type { Command } from '../command.js';
import type { Config } from '../config/schema.js';
import type { LLMProvider } from '../types/llm.js';
import {
  addProvider,
  listProviders,
  setDefaultProvider,
  loadLLMConfig,
} from '../llm/config.js';
import { printTable } from '../output/text.js';
import { UsageError } from '../errors/base.js';

export const llmCommand: Command = {
  name: 'llm',
  description: '管理 LLM provider 配置',
  usage: 'my-cli llm <add|list|use>',
  examples: [
    'my-cli llm add',
    'my-cli llm list',
    'my-cli llm use deepseek',
  ],
  async execute(config: Config, flags: Record<string, unknown>, args: string[]) {
    const subcommand = args[0];

    switch (subcommand) {
      case 'add':
        await handleAdd();
        break;

      case 'list':
        await handleList(config);
        break;

      case 'use':
        if (!args[1]) {
          throw new UsageError('用法: my-cli llm use <name>');
        }
        await handleUse(args[1]);
        break;

      default:
        throw new UsageError('用法: my-cli llm <add|list|use>');
    }
  },
};

async function handleAdd(): Promise<void> {
  const rl = readline.createInterface({ input, output });

  try {
    const name = await rl.question('Provider 名称: ');
    const baseUrl = await rl.question('Base URL (如 https://api.deepseek.com): ');
    const apiKey = await rl.question('API Key: ');
    const model = await rl.question('Model (如 deepseek-chat): ');

    const provider: LLMProvider = {
      name: name.trim(),
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim(),
      model: model.trim(),
    };

    await addProvider(provider);
    console.log(`已添加 provider: ${provider.name}`);
  } finally {
    rl.close();
  }
}

async function handleList(config: Config): Promise<void> {
  const providers = await listProviders();

  if (providers.length === 0) {
    console.log('暂无已配置的 LLM provider');
    return;
  }

  const llmConfig = await loadLLMConfig();
  const defaultName = llmConfig.defaultProvider;

  const rows = providers.map((p) => ({
    名称: p.name === defaultName ? `${p.name} (*)` : p.name,
    BaseURL: p.baseUrl,
    Model: p.model,
  }));

  printTable(config, rows);
}

async function handleUse(name: string): Promise<void> {
  await setDefaultProvider(name);
  console.log(`已将 ${name} 设为默认 provider`);
}