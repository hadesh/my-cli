import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import type { Command } from '../command.js';
import type { Config } from '../config/schema.js';
import type { LLMProvider } from '../types/llm.js';
import {
  addProvider,
  listProviders,
  setProviderModel,
  loadLLMConfig,
  getProviderModels,
  getModelInfo,
} from '../llm/config.js';
import { printTable } from '../output/text.js';
import { UsageError } from '../errors/base.js';
import { info } from '../output/formatter.js';
import type { ModelInfo } from '../types/llm.js';

export const llmCommand: Command = {
  name: 'llm',
  description: '管理 LLM provider 配置',
  usage: 'my-cli llm <add|list|use|models>',
  examples: [
    'my-cli llm add',
    'my-cli llm list',
    'my-cli llm use <provider-name>',
    'my-cli llm models [provider-name]',
    'my-cli llm models <provider-name> <model-id>',
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
        if (!args[1] || !args[2]) {
          throw new UsageError('用法: my-cli llm use <provider-name> <model-id>');
        }
        await handleUse(args[1], args[2]);
        break;

      case 'models':
        await handleModels(config, args[1], args[2]);
        break;

      default:
        throw new UsageError('用法: my-cli llm <add|list|use|models>');
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

async function handleUse(providerName: string, modelId: string): Promise<void> {
  await setProviderModel(providerName, modelId);
  console.log(`已将 provider ${providerName} 的默认模型设为 ${modelId}`);
}

async function handleModels(config: Config, providerName?: string, modelId?: string): Promise<void> {
  const llmConfig = await loadLLMConfig();

  if (!providerName) {
    if (!llmConfig.defaultProvider) {
      throw new UsageError('请先运行 my-cli llm add 添加 LLM 服务，或指定 provider 名称');
    }
    providerName = llmConfig.defaultProvider;
  }

  const provider = llmConfig.providers.find(p => p.name === providerName);
  if (!provider) {
    throw new UsageError(`Provider 不存在: ${providerName}`);
  }

  if (modelId) {
    const modelInfo = await getModelInfo(providerName, modelId);
    if (!modelInfo) {
      throw new UsageError(`Model 不存在: ${modelId}`);
    }

    info(`Model: ${modelId}`);
    console.log();

    const infoData = modelInfo as ModelInfo;

    if (infoData.limit) {
      console.log(`上下文窗口: ${infoData.limit.context.toLocaleString()} tokens`);
      console.log(`最大输出: ${infoData.limit.output.toLocaleString()} tokens`);
    }

    if (infoData.modalities) {
      console.log(`输入模态: ${infoData.modalities.input.join(', ')}`);
      console.log(`输出模态: ${infoData.modalities.output.join(', ')}`);
    }

    if (infoData.options) {
      console.log(`选项: ${JSON.stringify(infoData.options, null, 2)}`);
    }

    return;
  }

  const models = await getProviderModels(providerName);
  const modelKeys = models ? Object.keys(models) : [];

  if (modelKeys.length === 0) {
    console.log(`Provider ${providerName} 未配置 models`);
    return;
  }

  const rows = modelKeys.map(modelId => {
    const model = (models as Record<string, ModelInfo>)[modelId];
    return {
      Model: modelId,
      Context: model.limit?.context ? `${(model.limit.context / 1000).toFixed(0)}K` : '-',
      Output: model.limit?.output ? `${(model.limit.output / 1000).toFixed(0)}K` : '-',
    };
  });

  printTable(config, rows);
}