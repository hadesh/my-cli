import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { askCommand, streamChatFactory, storeFactory, toolsStoreFactory, chatWithToolsFactory, executorFactory } from './ask.js';
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
  let originalLoadTools: typeof toolsStoreFactory.loadTools;
  let originalChatWithTools: typeof chatWithToolsFactory.call;
  let originalExecutorExecute: typeof executorFactory.execute;

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
    originalLoadTools = toolsStoreFactory.loadTools;
    originalChatWithTools = chatWithToolsFactory.call;
    originalExecutorExecute = executorFactory.execute;

    mkdirSync(join(tmpDir, '.config', 'my-cli', 'sessions'), { recursive: true });

    toolsStoreFactory.loadTools = async () => [];
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
    toolsStoreFactory.loadTools = originalLoadTools;
    chatWithToolsFactory.call = originalChatWithTools;
    executorFactory.execute = originalExecutorExecute;
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
      return { reply: 'Hello', thinking: '' };
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
      return { reply: 'New answer', thinking: '' };
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
      return { reply: 'Hello', thinking: '' };
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
      return { reply: 'Hello', thinking: '' };
    };

    const config = { contextWindow: 20 } as Config;
    await askCommand.execute(config, {}, ['Hello']);

    // 验证 messages[0].role === 'system' 且 content 包含 "You are helpful."
    expect(capturedMessages[0].role).toBe('system');
    expect(capturedMessages[0].content).toContain('You are helpful.');
  });

  // 测试 7：滑动窗口 — 25 条历史消息时只取最后 20 条
  test('ask 默认保留全部历史消息（不截断）', async () => {
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
      return { reply: 'Hello', thinking: '' };
    };

    const config = { contextWindow: 20 } as Config;
    await askCommand.execute(config, { session: sessionId }, ['New question']);

    const historyCount = capturedMessages.length - 1;
    expect(historyCount).toBe(25);
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

  // FC 测试 1：无工具时走原有 streamChat 路径
  test('ask without tools uses streamChat path', async () => {
    mkdirSync(join(tmpDir, '.config', 'my-cli'), { recursive: true });
    writeFileSync(
      join(tmpDir, '.config', 'my-cli', 'llm-providers.json'),
      JSON.stringify({
        providers: [{ name: 'test', baseUrl: 'https://api.test.com', apiKey: 'sk-test', model: 'gpt-4' }],
        defaultProvider: 'test',
      })
    );

    // mock loadTools 返回空数组
    toolsStoreFactory.loadTools = () => [];

    let streamChatCalled = false;
    streamChatFactory.call = async (provider: LLMProvider, messages: any[], onChunk: (content: string) => void) => {
      streamChatCalled = true;
      return { reply: 'Hello without tools', thinking: '' };
    };

    const config = { contextWindow: 20 } as Config;
    await askCommand.execute(config, {}, ['Hello']);

    expect(streamChatCalled).toBe(true);

    // 验证 session 保存了消息
    const sessionsDir = join(tmpDir, '.config', 'my-cli', 'sessions');
    const files = readdirSync(sessionsDir);
    expect(files.length).toBe(1);
    const session = JSON.parse(readFileSync(join(sessionsDir, files[0]), 'utf-8'));
    expect(session.messages[1].role).toBe('assistant');
    expect(session.messages[1].content).toBe('Hello without tools');
  });

  // FC 测试 2：有工具、LLM 一轮直接返回无 tool_calls
  test('ask with tools but LLM returns no tool_calls uses streamChat', async () => {
    mkdirSync(join(tmpDir, '.config', 'my-cli'), { recursive: true });
    writeFileSync(
      join(tmpDir, '.config', 'my-cli', 'llm-providers.json'),
      JSON.stringify({
        providers: [{ name: 'test', baseUrl: 'https://api.test.com', apiKey: 'sk-test', model: 'gpt-4' }],
        defaultProvider: 'test',
      })
    );

    // mock 返回有工具但工具未调用
    toolsStoreFactory.loadTools = () => [{
      name: 'get_weather',
      description: '获取天气',
      enabled: true,
      command: 'echo {{location}}',
      parameters: { type: 'object', properties: { location: { type: 'string', description: '城市' } }, required: ['location'] }
    }];

    // mock chatWithTools 返回无 tool_calls
    chatWithToolsFactory.call = async () => ({
      choices: [{ message: { role: 'assistant', content: '直接回答' }, finish_reason: 'stop' }]
    });

    let streamChatCalled = false;
    streamChatFactory.call = async (provider: LLMProvider, messages: any[], onChunk: (content: string) => void) => {
      streamChatCalled = true;
      onChunk('Stream reply');
      return { reply: 'Stream reply', thinking: '' };
    };

    const config = { contextWindow: 20 } as Config;
    await askCommand.execute(config, {}, ['Hello']);

    expect(streamChatCalled).toBe(true);
  });

  // FC 测试 3：有工具、LLM 返回 tool_calls、执行后第二轮返回正常回复
  test('ask with tools and tool_calls executes tool and continues', async () => {
    mkdirSync(join(tmpDir, '.config', 'my-cli'), { recursive: true });
    writeFileSync(
      join(tmpDir, '.config', 'my-cli', 'llm-providers.json'),
      JSON.stringify({
        providers: [{ name: 'test', baseUrl: 'https://api.test.com', apiKey: 'sk-test', model: 'gpt-4' }],
        defaultProvider: 'test',
      })
    );

    // mock 返回有工具
    toolsStoreFactory.loadTools = () => [{
      name: 'get_weather',
      description: '获取天气',
      enabled: true,
      command: 'echo {{location}}',
      parameters: { type: 'object', properties: { location: { type: 'string', description: '城市' } }, required: ['location'] }
    }];

    let chatWithToolsCallCount = 0;
    chatWithToolsFactory.call = async () => {
      chatWithToolsCallCount++;
      if (chatWithToolsCallCount === 1) {
        // 第一次返回有 tool_calls
        return {
          choices: [{
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"location":"Beijing"}' } }]
            },
            finish_reason: 'tool_calls'
          }]
        };
      } else {
        // 第二次返回无 tool_calls
        return {
          choices: [{ message: { role: 'assistant', content: '北京天气晴朗' }, finish_reason: 'stop' }]
        };
      }
    };

    // mock 执行器
    executorFactory.execute = async () => '晴天 25°C';

    let streamChatCalled = false;
    streamChatFactory.call = async (provider: LLMProvider, messages: any[], onChunk: (content: string) => void) => {
      streamChatCalled = true;
      onChunk('北京天气晴朗');
      return { reply: '北京天气晴朗', thinking: '' };
    };

    const config = { contextWindow: 20 } as Config;
    await askCommand.execute(config, {}, ['北京天气怎么样']);

    // chatWithTools 应该被调用两次
    expect(chatWithToolsCallCount).toBe(2);
    // streamChat 应该被调用一次（最后一轮）
    expect(streamChatCalled).toBe(true);

    // 验证 session 保存了完整链路：user + assistant(tool_calls) + tool + assistant(final)
    const sessionsDir = join(tmpDir, '.config', 'my-cli', 'sessions');
    const files = readdirSync(sessionsDir);
    const session = JSON.parse(readFileSync(join(sessionsDir, files[0]), 'utf-8'));
    expect(session.messages).toHaveLength(4);
    expect(session.messages[0].role).toBe('user');
    expect(session.messages[1].role).toBe('assistant');
    expect(session.messages[1].tool_calls).toBeDefined();
    expect(session.messages[1].tool_calls[0].function.name).toBe('get_weather');
    expect(session.messages[2].role).toBe('tool');
    expect(session.messages[2].content).toBe('晴天 25°C');
    expect(session.messages[3].role).toBe('assistant');
    expect(session.messages[3].content).toBe('北京天气晴朗');
  });
});