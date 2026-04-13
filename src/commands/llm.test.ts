import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { llmCommand } from './llm.js';
import { UsageError } from '../errors/base.js';
import { addProvider, listProviders } from '../llm/config.js';
import { loadConfig } from '../config/loader.js';
import type { LLMProvider } from '../types/llm.js';

describe('llm 命令组', () => {
  let tmpDir: string;
  let logs: string[];
  let originalConsoleLog: typeof console.log;
  let originalHome: string | undefined;

  beforeEach(() => {
    const randomSuffix = Math.random().toString(36).slice(2, 6);
    tmpDir = `/tmp/my-cli-test-llm-cmd-${randomSuffix}`;
    process.env.HOME = tmpDir;
    originalHome = process.env.HOME;

    logs = [];
    originalConsoleLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    };
  });

  afterEach(() => {
    console.log = originalConsoleLog;
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
  });

  test('llm list 空配置时打印 "暂无已配置的 LLM provider"', async () => {
    const config = loadConfig({ output: 'text' });

    await llmCommand.execute(config, {}, ['list']);

    expect(logs).toContain('暂无已配置的 LLM provider');
  });

  test('llm use <name> 设置成功后打印确认消息', async () => {
    const config = loadConfig({ output: 'text' });

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

    logs = [];
    await llmCommand.execute(config, {}, ['use', 'openai']);

    expect(logs[0]).toContain('已将 openai 设为默认 provider');
  });

  test('llm use <不存在的name> 抛出 UsageError', async () => {
    const config = loadConfig({ output: 'text' });

    const provider: LLMProvider = {
      name: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'key1',
      model: 'deepseek-chat',
    };

    await addProvider(provider);

    expect(async () => {
      await llmCommand.execute(config, {}, ['use', 'nonexistent']);
    }).toThrow(UsageError);
  });

  test('llm use 无参数抛出 UsageError', async () => {
    const config = loadConfig({ output: 'text' });

    expect(async () => {
      await llmCommand.execute(config, {}, ['use']);
    }).toThrow(UsageError);
  });

  test('未知子命令抛出 UsageError', async () => {
    const config = loadConfig({ output: 'text' });

    expect(async () => {
      await llmCommand.execute(config, {}, ['unknown']);
    }).toThrow(UsageError);
  });

  test('无子命令时抛出 UsageError', async () => {
    const config = loadConfig({ output: 'text' });

    expect(async () => {
      await llmCommand.execute(config, {}, []);
    }).toThrow(UsageError);
  });

  test('llm list 显示表格，默认 provider 带 (*)', async () => {
    const config = loadConfig({ output: 'text' });

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

    logs = [];
    await llmCommand.execute(config, {}, ['use', 'openai']);
    logs = [];
    await llmCommand.execute(config, {}, ['list']);

    expect(logs.some(l => l.includes('deepseek'))).toBe(true);
    expect(logs.some(l => l.includes('openai (*)'))).toBe(true);
    expect(logs.some(l => l.includes('BaseURL') || l.includes('Model'))).toBe(true);
  });
});