import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { streamChat, streamChatWithTools } from './client.js';
import { LLMError } from '../errors/base.js';
import type { LLMProvider, ChatMessage, ToolDefinition } from '../types/llm.js';

const mockProvider: LLMProvider = {
  name: 'test',
  baseUrl: 'https://api.test.com',
  apiKey: 'sk-test',
  model: 'test-model',
};

const mockMessages: ChatMessage[] = [
  { role: 'user', content: 'Hello' },
];

/**
 * 构造 SSE 响应流
 */
function makeSseBody(lines: string[]): ReadableStream<Uint8Array> {
  const text = lines.join('\n') + '\n';
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

describe('streamChat', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  // 每个测试后恢复 fetch（bun:test 的 afterEach 不稳定，手动在每个测试末尾恢复）

  it('正常 SSE 流（多 chunk 拼接）', async () => {
    const sseLines = [
      'data: {"id":"1","object":"chat.completion.chunk","choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}',
      'data: {"id":"2","object":"chat.completion.chunk","choices":[{"delta":{"content":" World"},"finish_reason":null}]}',
      'data: [DONE]',
    ];

    const chunksReceived: string[] = [];
    const onChunk = (content: string) => chunksReceived.push(content);

    global.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        body: makeSseBody(sseLines),
      } as Response)
    );

    const result = await streamChat(mockProvider, mockMessages, onChunk);
    global.fetch = originalFetch;

    expect(result.reply).toBe('Hello World');
    expect(chunksReceived).toEqual(['Hello', ' World']);
  });

  it('API 返回 401 → 抛出 LLMError', async () => {
    global.fetch = mock(() =>
      Promise.resolve({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
        body: null,
      } as Response)
    );

    try {
      await streamChat(mockProvider, mockMessages, () => {});
      global.fetch = originalFetch;
      expect.unreachable('应该抛出 LLMError');
    } catch (error) {
      global.fetch = originalFetch;
      expect(error).toBeInstanceOf(LLMError);
      expect((error as LLMError).message).toContain('401');
    }
  });

  it('API 返回 500 → 抛出 LLMError', async () => {
    global.fetch = mock(() =>
      Promise.resolve({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
        body: null,
      } as Response)
    );

    try {
      await streamChat(mockProvider, mockMessages, () => {});
      global.fetch = originalFetch;
      expect.unreachable('应该抛出 LLMError');
    } catch (error) {
      global.fetch = originalFetch;
      expect(error).toBeInstanceOf(LLMError);
      expect((error as LLMError).message).toContain('500');
    }
  });

  it('空 content delta（role-only chunk）→ 不调用 onChunk', async () => {
    const sseLines = [
      'data: {"id":"1","object":"chat.completion.chunk","choices":[{"delta":{"role":"assistant"},"finish_reason":null}]}',
      'data: [DONE]',
    ];

    const chunksReceived: string[] = [];
    const onChunk = (content: string) => chunksReceived.push(content);

    global.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        body: makeSseBody(sseLines),
      } as Response)
    );

    const result = await streamChat(mockProvider, mockMessages, onChunk);
    global.fetch = originalFetch;

    expect(result.reply).toBe('');
    expect(chunksReceived).toEqual([]);
  });

  it('[DONE] 后不再处理后续数据', async () => {
    const sseLines = [
      'data: {"id":"1","object":"chat.completion.chunk","choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}',
      'data: [DONE]',
      'data: {"id":"2","object":"chat.completion.chunk","choices":[{"delta":{"content":"Extra"},"finish_reason":null}]}',
    ];

    const chunksReceived: string[] = [];
    const onChunk = (content: string) => chunksReceived.push(content);

    global.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        body: makeSseBody(sseLines),
      } as Response)
    );

    const result = await streamChat(mockProvider, mockMessages, onChunk);
    global.fetch = originalFetch;

    expect(result.reply).toBe('Hello');
    expect(chunksReceived).toEqual(['Hello']);
  });
});

describe('streamChatWithTools', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  it('finish_reason=stop，返回 reply 且 toolCalls 为 null', async () => {
    global.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        body: makeSseBody([
          'data: {"id":"1","object":"chat.completion.chunk","choices":[{"delta":{"content":"答案"},"finish_reason":null}]}',
          'data: {"id":"1","object":"chat.completion.chunk","choices":[{"delta":{},"finish_reason":"stop"}]}',
          'data: [DONE]',
        ]),
      } as Response)
    );

    const tools: ToolDefinition[] = [];
    const chunks: string[] = [];
    const result = await streamChatWithTools(mockProvider, mockMessages, tools, (c) => chunks.push(c));
    global.fetch = originalFetch;

    expect(result.reply).toBe('答案');
    expect(result.toolCalls).toBeNull();
    expect(chunks).toEqual(['答案']);
  });

  it('finish_reason=tool_calls，返回解析后的 toolCalls', async () => {
    global.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        body: makeSseBody([
          'data: {"id":"1","object":"chat.completion.chunk","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_123","type":"function","function":{"name":"get_weather","arguments":""}}]},"finish_reason":null}]}',
          'data: {"id":"1","object":"chat.completion.chunk","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"city\\":\\"Beijing\\"}"}}]},"finish_reason":null}]}',
          'data: {"id":"1","object":"chat.completion.chunk","choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
          'data: [DONE]',
        ]),
      } as Response)
    );

    const tools: ToolDefinition[] = [
      { type: 'function', function: { name: 'get_weather', description: '获取天气', parameters: {} } },
    ];
    const result = await streamChatWithTools(mockProvider, mockMessages, tools, () => {});
    global.fetch = originalFetch;

    expect(result.toolCalls).toBeDefined();
    expect(result.toolCalls!.length).toBe(1);
    expect(result.toolCalls![0].function.name).toBe('get_weather');
    expect(result.toolCalls![0].function.arguments).toBe('{"city":"Beijing"}');
    expect(result.reply).toBe('');
  });

  it('HTTP 401 错误，抛出 LLMError 含 401', async () => {
    global.fetch = mock(() =>
      Promise.resolve({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      } as unknown as Response)
    );

    const tools: ToolDefinition[] = [];
    try {
      await streamChatWithTools(mockProvider, mockMessages, tools, () => {});
      global.fetch = originalFetch;
      expect.unreachable('应该抛出 LLMError');
    } catch (error) {
      global.fetch = originalFetch;
      expect(error).toBeInstanceOf(LLMError);
      expect((error as LLMError).message).toContain('401');
    }
  });
});