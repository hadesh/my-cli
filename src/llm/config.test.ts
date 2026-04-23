import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  loadLLMConfig,
  saveLLMConfig,
  addProvider,
  listProviders,
  getDefaultProvider,
  setDefaultProvider,
} from './config.js';
import { UsageError } from '../errors/base.js';
import type { LLMProvider } from '../types/llm.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

describe('llm/config', () => {
  let tmpDir: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    const randomSuffix = Math.random().toString(36).slice(2, 6);
    tmpDir = `/tmp/my-cli-test-llm-config-${randomSuffix}`;
    process.env.HOME = tmpDir;
    originalHome = process.env.HOME;
  });

  afterEach(() => {
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
  });

  test('loadLLMConfig 文件不存在时返回空配置', async () => {
    const config = await loadLLMConfig();
    expect(config.providers).toEqual([]);
    expect(config.defaultProvider).toBe('');
  });

  test('addProvider 添加 provider 后 listProviders 可见', async () => {
    const provider: LLMProvider = {
      name: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'test-key',
      model: 'deepseek-chat',
    };

    await addProvider(provider);

    const providers = await listProviders();
    expect(providers.length).toBe(1);
    expect(providers[0]!.name).toBe('deepseek');
    expect(providers[0]!.baseUrl).toBe('https://api.deepseek.com');
  });

  test('addProvider 重名时抛出 UsageError', async () => {
    const provider1: LLMProvider = {
      name: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'key1',
      model: 'deepseek-chat',
    };

    const provider2: LLMProvider = {
      name: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'key2',
      model: 'deepseek-chat',
    };

    await addProvider(provider1);

    expect(async () => {
      await addProvider(provider2);
    }).toThrow(UsageError);
  });

  test('setDefaultProvider 设置默认后 getDefaultProvider 返回正确', async () => {
    const provider1: LLMProvider = {
      name: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'key1',
      model: 'deepseek-chat',
    };

    const provider2: LLMProvider = {
      name: 'openai',
      baseUrl: 'https://api.openai.com',
      apiKey: 'key2',
      model: 'gpt-4',
    };

    await addProvider(provider1);
    await addProvider(provider2);

    await setDefaultProvider('openai');

    const defaultProvider = await getDefaultProvider();
    expect(defaultProvider.name).toBe('openai');
  });

  test('setDefaultProvider 不存在的 name 抛出 UsageError', async () => {
    const provider: LLMProvider = {
      name: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'key1',
      model: 'deepseek-chat',
    };

    await addProvider(provider);

    expect(async () => {
      await setDefaultProvider('nonexistent');
    }).toThrow(UsageError);
  });

  test('getDefaultProvider 无配置时抛出 UsageError', async () => {
    expect(async () => {
      await getDefaultProvider();
    }).toThrow(UsageError);
  });

  test('第一个 addProvider 自动成为默认 provider', async () => {
    const provider: LLMProvider = {
      name: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'key1',
      model: 'deepseek-chat',
    };

    await addProvider(provider);

    const defaultProvider = await getDefaultProvider();
    expect(defaultProvider.name).toBe('deepseek');

    // 验证配置文件写入正确
    const configFile = join(tmpDir, '.config', 'my-cli', 'llm-providers.json');
    expect(existsSync(configFile)).toBe(true);
  });
});