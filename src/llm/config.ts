import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { LLMConfig, LLMProvider } from '../types/llm.js';
import { UsageError } from '../errors/base.js';

/**
 * 获取 LLM 配置文件路径（支持测试隔离）
 */
function getLLMConfigFile(): string {
  const home = process.env.HOME ?? homedir();
  return join(home, '.config', 'my-cli', 'llm-providers.json');
}

/**
 * 加载 LLM 配置
 * 文件不存在时返回空配置
 */
export async function loadLLMConfig(): Promise<LLMConfig> {
  const filePath = getLLMConfigFile();
  
  try {
    const file = Bun.file(filePath);
    const content = await file.json();
    return content as LLMConfig;
  } catch {
    // 文件不存在时返回空配置
    return { providers: [], defaultProvider: '' };
  }
}

/**
 * 保存 LLM 配置
 */
export async function saveLLMConfig(config: LLMConfig): Promise<void> {
  const filePath = getLLMConfigFile();
  const dir = join(filePath, '..');
  
  // 确保父目录存在
  mkdirSync(dir, { recursive: true });
  
  await Bun.write(filePath, JSON.stringify(config, null, 2));
}

/**
 * 添加 Provider
 * 重名时抛出 UsageError
 * 第一个添加的 provider 自动成为默认
 */
export async function addProvider(provider: LLMProvider): Promise<void> {
  const config = await loadLLMConfig();
  
  // 检查重名
  const existing = config.providers.find(p => p.name === provider.name);
  if (existing) {
    throw new UsageError(`provider 已存在: ${provider.name}`);
  }
  
  config.providers.push(provider);
  
  // 如果当前无默认 provider，则自动设为默认
  if (!config.defaultProvider) {
    config.defaultProvider = provider.name;
  }
  
  await saveLLMConfig(config);
}

/**
 * 列出所有 Provider
 */
export async function listProviders(): Promise<LLMProvider[]> {
  const config = await loadLLMConfig();
  return config.providers;
}

/**
 * 获取默认 Provider
 * 无配置或找不到时抛出 UsageError
 */
export async function getDefaultProvider(): Promise<LLMProvider> {
  const config = await loadLLMConfig();
  
  if (!config.defaultProvider) {
    throw new UsageError('请先运行 my-cli llm add 添加 LLM 服务');
  }
  
  const provider = config.providers.find(p => p.name === config.defaultProvider);
  if (!provider) {
    throw new UsageError('请先运行 my-cli llm add 添加 LLM 服务');
  }
  
  return provider;
}

export async function getProvider(name: string): Promise<LLMProvider | undefined> {
  const config = await loadLLMConfig();
  return config.providers.find(p => p.name === name);
}
export async function setDefaultProvider(name: string): Promise<void> {
  const config = await loadLLMConfig();

  const provider = config.providers.find(p => p.name === name);
  if (!provider) {
    throw new UsageError(`Provider 不存在: ${name}`);
  }

  config.defaultProvider = name;
  await saveLLMConfig(config);
}

export async function setProviderModel(providerName: string, model: string): Promise<void> {
  const config = await loadLLMConfig();

  const provider = config.providers.find(p => p.name === providerName);
  if (!provider) {
    throw new UsageError(`Provider 不存在: ${providerName}`);
  }

  if (provider.models && !provider.models[model]) {
    throw new UsageError(`Model 不存在: ${model}`);
  }

  provider.model = model;
  await saveLLMConfig(config);
}

export async function getProviderModels(providerName: string): Promise<Record<string, unknown> | null> {
  const config = await loadLLMConfig();

  const provider = config.providers.find(p => p.name === providerName);
  if (!provider) {
    return null;
  }

  return provider.models || {};
}

export async function getModelInfo(providerName: string, modelId: string): Promise<Record<string, unknown> | null> {
  const config = await loadLLMConfig();

  const provider = config.providers.find(p => p.name === providerName);
  if (!provider || !provider.models) {
    return null;
  }

  return provider.models[modelId] || null;
}