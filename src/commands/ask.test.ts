import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { askCommand, streamChatFactory, storeFactory } from './ask.js';
import { CLIError, UsageError, LLMError } from '../errors/base.js';
import { loadConfig } from '../config/loader.js';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { LLMProvider } from '../types/llm.js';
import type { Session } from '../types/session.js';
import type { Config } from '../config/schema.js';

describe('askCommand', () => {
  let tmpDir: string;
  let originalHome: string | undefined;
  let originalStreamChat: typeof streamChatFactory.call;
  let originalGetSession: typeof storeFactory.getSession;
  let originalGetOrCreateActiveSession: typeof storeFactory.getOrCreateActiveSession;
  let originalUpdateSession: typeof storeFactory.updateSession;
  let originalSetActiveSessionId: typeof storeFactory.setActiveSessionId;

  beforeEach(() => {
    tmpDir = `/tmp/my-cli-test-ask-${Math.random().toString(36).slice(2, 6)}`;
    mkdirSync(tmpDir, { recursive: true });
    process.env.HOME = tmpDir;
    originalHome = process.env.HOME;

    originalStreamChat = streamChatFactory.call;
    originalGetSession = storeFactory.getSession;
    originalGetOrCreateActiveSession = storeFactory.getOrCreateActiveSession;
    originalUpdateSession = storeFactory.updateSession;
    originalSetActiveSessionId = storeFactory.setActiveSessionId;

    // 设置基本 session 目录
    mkdirSync(join(tmpDir, '.config', 'my-cli', 'sessions'), { recursive: true });
  });

  afterEach(() => {
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
    streamChatFactory.call = originalStreamChat;
    storeFactory.getSession = originalGetSession;
    storeFactory.getOrCreateActiveSession = originalGetOrCreateActiveSession;
    storeFactory.updateSession = originalUpdateSession;
    storeFactory.setActiveSessionId = originalSetActiveSessionId;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // 测试 1：正常调用 → session 保存 user + assistant 消息
  test('ask saves user and assistant messages to session', async () => {
    // 写入 llm-providers.json
    mkdirSync(join(tmpDir, '.config', 'my-cli'), { recursive: true });
    writeFileSync(
      join(tmpDir, '.config', 'my-cli', 'llm-providers.json'),
      JSON.stringify({
        providers: [{ name: 'test', baseUrl: 'https://api.test.com', apiKey: 'sk-test', model: 'gpt-4' }],
        defaultProvider: 'test',
      })
    );

    // mock streamChat
    streamChatFactory.call = async (provider: LLMProvider, messages: any[], onChunk: (content: string) => void) => {
      onChunk('Hello');
      return 'Hello';
    };

    const config = { contextWindow: 20 } as Config;
    await askCommand.execute(config, {}, ['What is TypeScript?']);

    // 验证 session 文件存在且包含消息
    const sessionsDir = join(tmpDir, '.config', 'my-cli', 'sessions');
    const files = readdirSync(sessionsDir);
    expect(files.length).toBe(1);
    const session = JSON.parse(readFileSync(join(sessionsDir, files[0]), 'utf-8'));
    expect(session.messages).toHaveLength(2);
    expect(session.messages[0].role).toBe('user');
    expect(session.messages[0].content).toBe('What is TypeScript?');
    expect(session.messages[1].role).toBe('assistant');
    expect(session.messages[1].content).toBe('Hello');
  });

  // 测试 2：--session flag 覆盖活跃 session
  test('ask with --session flag updates specified session', async () => {
    // 写入 llm-providers.json
    mkdirSync(join(tmpDir, '.config', 'my-cli'), { recursive: true });
    writeFileSync(
      join(tmpDir, '.config', 'my-cli', 'llm-providers.json'),
      JSON.stringify({
        providers: [{ name: 'test', baseUrl: 'https://api.test.com', apiKey: 'sk-test', model: 'gpt-4' }],
        defaultProvider: 'test',
      })
    );

    // 创建一个 session
    const sessionId = '20260410-123456-test';
    const sessionPath = join(tmpDir, '.config', 'my-cli', 'sessions', `${sessionId}.json`);
    const existingSession: Session = {
      id: sessionId,
      name: 'Test Session',
      createdAt: '2026-04-10T12:34:56.000Z',
      updatedAt: '2026-04-10T12:34:56.000Z',
      messages: [
        { role: 'user', content: 'Previous question', timestamp: '2026-04-10T12:34:56.000Z' },
        { role: 'assistant', content: 'Previous answer', timestamp: '2026-04-10T12:34:57.000Z' },
      ],
    };
    writeFileSync(sessionPath, JSON.stringify(existingSession, null, 2));

    // mock streamChat
    streamChatFactory.call = async (provider: LLMProvider, messages: any[], onChunk: (content: string) => void) => {
      onChunk('New answer');
      return 'New answer';
    };

    const config = { contextWindow: 20 } as Config;
    await askCommand.execute(config, { session: sessionId }, ['New question']);

    // 验证该 session 被更新
    const updatedSession = JSON.parse(readFileSync(sessionPath, 'utf-8'));
    expect(updatedSession.messages).toHaveLength(4);
    expect(updatedSession.messages[2].role).toBe('user');
    expect(updatedSession.messages[2].content).toBe('New question');
    expect(updatedSession.messages[3].role).toBe('assistant');
    expect(updatedSession.messages[3].content).toBe('New answer');
  });

  // 测试 3：--session 不存在的 ID → CLIError
  test('ask with --session nonexistent-id throws CLIError', async () => {
    // 写入 llm-providers.json
    mkdirSync(join(tmpDir, '.config', 'my-cli'), { recursive: true });
    writeFileSync(
      join(tmpDir, '.config', 'my-cli', 'llm-providers.json'),
      JSON.stringify({
        providers: [{ name: 'test', baseUrl: 'https://api.test.com', apiKey: 'sk-test', model: 'gpt-4' }],
        defaultProvider: 'test',
      })
    );

    const config = { contextWindow: 20 } as Config;
    expect(async () => {
      await askCommand.execute(config, { session: 'nonexistent-id-0000' }, ['Hello']);
    }).toThrow(CLIError);
  });

  // 测试 4：未配置 provider → UsageError
  test('ask without provider config throws UsageError', async () => {
    // 不写 llm-providers.json
    const config = { contextWindow: 20 } as Config;
    expect(async () => {
      await askCommand.execute(config, {}, ['Hello']);
    }).toThrow(UsageError);
  });

  // 测试 5：agent.md 不存在 → messages 中无 system 消息
  test('ask without agent.md has no system message', async () => {
    // 写入 llm-providers.json
    mkdirSync(join(tmpDir, '.config', 'my-cli'), { recursive: true });
    writeFileSync(
      join(tmpDir, '.config', 'my-cli', 'llm-providers.json'),
      JSON.stringify({
        providers: [{ name: 'test', baseUrl: 'https://api.test.com', apiKey: 'sk-test', model: 'gpt-4' }],
        defaultProvider: 'test',
      })
    );

    // 不创建 agent.md

    // mock streamChat，捕获传入的 messages
    let capturedMessages: any[] = [];
    streamChatFactory.call = async (provider: LLMProvider, messages: any[], onChunk: (content: string) => void) => {
      capturedMessages = messages;
      onChunk('Hello');
      return 'Hello';
    };

    const config = { contextWindow: 20 } as Config;
    await askCommand.execute(config, {}, ['Hello']);

    // 验证 messages 中没有 role=system 的条目
    expect(capturedMessages.some((m) => m.role === 'system')).toBe(false);
  });

  // 测试 6：agent.md 存在 → messages[0].role === 'system'
  test('ask with agent.md has system message', async () => {
    // 写入 llm-providers.json
    mkdirSync(join(tmpDir, '.config', 'my-cli'), { recursive: true });
    writeFileSync(
      join(tmpDir, '.config', 'my-cli', 'llm-providers.json'),
      JSON.stringify({
        providers: [{ name: 'test', baseUrl: 'https://api.test.com', apiKey: 'sk-test', model: 'gpt-4' }],
        defaultProvider: 'test',
      })
    );

    // 写入 agent.md
    writeFileSync(join(tmpDir, '.config', 'my-cli', 'agent.md'), 'You are helpful.');

    // mock streamChat，捕获传入的 messages
    let capturedMessages: any[] = [];
    streamChatFactory.call = async (provider: LLMProvider, messages: any[], onChunk: (content: string) => void) => {
      capturedMessages = messages;
      onChunk('Hello');
      return 'Hello';
    };

    const config = { contextWindow: 20 } as Config;
    await askCommand.execute(config, {}, ['Hello']);

    // 验证 messages[0].role === 'system' 且 content 包含 "You are helpful."
    expect(capturedMessages[0].role).toBe('system');
    expect(capturedMessages[0].content).toContain('You are helpful.');
  });

  // 测试 7：滑动窗口 — 25 条历史消息时只取最后 20 条
  test('ask sliding window keeps only last 20 messages', async () => {
    // 写入 llm-providers.json
    mkdirSync(join(tmpDir, '.config', 'my-cli'), { recursive: true });
    writeFileSync(
      join(tmpDir, '.config', 'my-cli', 'llm-providers.json'),
      JSON.stringify({
        providers: [{ name: 'test', baseUrl: 'https://api.test.com', apiKey: 'sk-test', model: 'gpt-4' }],
        defaultProvider: 'test',
      })
    );

    // 创建一个有 25 条消息的 session
    const sessionId = '20260410-123456-test';
    const sessionPath = join(tmpDir, '.config', 'my-cli', 'sessions', `${sessionId}.json`);
    const messages: any[] = [];
    for (let i = 0; i < 25; i++) {
      messages.push({
        role: 'user',
        content: `Question ${i}`,
        timestamp: new Date().toISOString(),
      });
      messages.push({
        role: 'assistant',
        content: `Answer ${i}`,
        timestamp: new Date().toISOString(),
      });
    }
    // 只保留 25 条（user + assistant 交替）
    const existingSession: Session = {
      id: sessionId,
      name: 'Test Session',
      createdAt: '2026-04-10T12:34:56.000Z',
      updatedAt: '2026-04-10T12:34:56.000Z',
      messages: messages.slice(0, 25),
    };
    writeFileSync(sessionPath, JSON.stringify(existingSession, null, 2));

    // mock streamChat，捕获 messages
    let capturedMessages: any[] = [];
    streamChatFactory.call = async (provider: LLMProvider, messages: any[], onChunk: (content: string) => void) => {
      capturedMessages = messages;
      onChunk('Hello');
      return 'Hello';
    };

    const config = { contextWindow: 20 } as Config;
    await askCommand.execute(config, { session: sessionId }, ['New question']);

    // 计算历史消息数（减去 system 消息 1 条、user 消息 1 条）
    // 没有 agent.md，所以没有 system 消息
    const historyCount = capturedMessages.length - 1; // 减去最后的 user 消息
    expect(historyCount).toBe(20);
  });

  // 测试 8：LLM 失败时不写盘
  test('ask LLM failure does not write session', async () => {
    // 写入 llm-providers.json
    mkdirSync(join(tmpDir, '.config', 'my-cli'), { recursive: true });
    writeFileSync(
      join(tmpDir, '.config', 'my-cli', 'llm-providers.json'),
      JSON.stringify({
        providers: [{ name: 'test', baseUrl: 'https://api.test.com', apiKey: 'sk-test', model: 'gpt-4' }],
        defaultProvider: 'test',
      })
    );

    // mock streamChat 抛出 LLMError
    streamChatFactory.call = async (provider: LLMProvider, messages: any[], onChunk: (content: string) => void) => {
      throw new LLMError('LLM API 错误: HTTP 500');
    };

    // mock getOrCreateActiveSession 返回内存对象（不写文件）
    let updateSessionCalled = false;
    storeFactory.getOrCreateActiveSession = async () => ({
      id: 'test-id',
      name: 'Test',
      createdAt: '',
      updatedAt: '',
      messages: [],
    });
    storeFactory.updateSession = async () => {
      updateSessionCalled = true;
    };
    storeFactory.setActiveSessionId = async () => {};

    const config = { contextWindow: 20 } as Config;
    await askCommand.execute(config, {}, ['Hello']);

    // 验证 sessions 目录中没有文件
    const sessionsDir = join(tmpDir, '.config', 'my-cli', 'sessions');
    const files = readdirSync(sessionsDir);
    expect(files.length).toBe(0);

    // 验证 updateSession 未被调用
    expect(updateSessionCalled).toBe(false);
  });
});