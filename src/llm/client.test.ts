import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { streamChat, chatWithTools } from './client.js';
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

    expect(result).toBe('Hello World');
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

    expect(result).toBe('');
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

    expect(result).toBe('Hello');
    expect(chunksReceived).toEqual(['Hello']);
  });
});

describe('chatWithTools', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  it('正常非流式响应，返回 ChatResponse', async () => {
    global.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            choices: [
              {
                message: { role: 'assistant', content: '答案', tool_calls: undefined },
                finish_reason: 'stop',
              },
            ],
          }),
      } as Response)
    );

    const tools: ToolDefinition[] = [];
    const result = await chatWithTools(mockProvider, mockMessages, tools);
    global.fetch = originalFetch;

    expect(result.choices[0].message.content).toBe('答案');
    expect(result.choices[0].finish_reason).toBe('stop');
  });

  it('返回 tool_calls，正确解析', async () => {
    global.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: null,
                  tool_calls: [
                    {
                      id: 'call_123',
                      type: 'function',
                      function: { name: 'get_weather', arguments: '{"city":"Beijing"}' },
                    },
                  ],
                },
                finish_reason: 'tool_calls',
              },
            ],
          }),
      } as Response)
    );

    const tools: ToolDefinition[] = [
      {
        type: 'function',
        function: { name: 'get_weather', description: '获取天气', parameters: {} },
      },
    ];
    const result = await chatWithTools(mockProvider, mockMessages, tools);
    global.fetch = originalFetch;

    expect(result.choices[0].message.tool_calls).toBeDefined();
    expect(result.choices[0].message.tool_calls?.length).toBe(1);
    expect(result.choices[0].message.tool_calls?.[0].function.name).toBe('get_weather');
    expect(result.choices[0].message.tool_calls?.[0].function.arguments).toBe('{"city":"Beijing"}');
  });

  it('HTTP 401 错误，抛出 LLMError 含 401', async () => {
    global.fetch = mock(() =>
      Promise.resolve({
        ok: false,
        status: 401,
      } as Response)
    );

    const tools: ToolDefinition[] = [];
    try {
      await chatWithTools(mockProvider, mockMessages, tools);
      global.fetch = originalFetch;
      expect.unreachable('应该抛出 LLMError');
    } catch (error) {
      global.fetch = originalFetch;
      expect(error).toBeInstanceOf(LLMError);
      expect((error as LLMError).message).toContain('401');
    }
  });
});