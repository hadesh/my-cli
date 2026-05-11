import { LLMError } from '../errors/base.js';
import type { LLMProvider, ChatMessage, ChatChunk, ToolDefinition, ToolCall, ToolCallStreamResult } from '../types/llm.js';

const DEFAULT_TIMEOUT = 30000;

export async function streamChat(
  provider: LLMProvider,
  messages: ChatMessage[],
  onChunk: (content: string) => void,
  options?: { timeout?: number; verbose?: boolean; onThinkingChunk?: (content: string) => void }
): Promise<{ reply: string; thinking: string }> {
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
  const verbose = options?.verbose ?? false;
  const onThinkingChunk = options?.onThinkingChunk;
  const url = provider.baseUrl;

  if (verbose) {
    process.stderr.write(`[DEBUG] Request URL: ${url}\n`);
    process.stderr.write(`[DEBUG] Model: ${provider.model}\n`);
    process.stderr.write(`[DEBUG] Messages count: ${messages.length}\n`);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${provider.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: provider.model,
        messages,
        stream: true,
      }),
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const body = await response.text();
      if (verbose) {
        process.stderr.write(`[DEBUG] HTTP Status: ${response.status}\n`);
        process.stderr.write(`[DEBUG] Response Body: ${body}\n`);
      }
      throw new LLMError(`LLM API 错误: HTTP ${response.status}: ${body}`);
    }

    if (verbose) {
      process.stderr.write(`[DEBUG] HTTP Status: ${response.status}, streaming started\n`);
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullReply = '';
    let fullThinking = '';
    let hasReceivedData = false;

    while (true) {
      const { done, value } = await reader.read();
      
      if (done) {
        if (verbose) {
          process.stderr.write(`[DEBUG] Stream done, total length: ${fullReply.length}\n`);
        }
        break;
      }

      hasReceivedData = true;
      const chunk = decoder.decode(value, { stream: true });
      
      if (verbose) {
        process.stderr.write(`[DEBUG] Raw chunk: ${JSON.stringify(chunk)}\n`);
      }

      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop()!;

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        
        if (verbose) {
          process.stderr.write(`[DEBUG] Processing line: ${JSON.stringify(trimmed)}\n`);
        }

        if (!trimmed.startsWith('data: ')) {
          if (verbose) {
            process.stderr.write(`[DEBUG] Skipping non-data line\n`);
          }
          continue;
        }

        const data = trimmed.slice(6);
        if (data === '[DONE]') {
          if (verbose) {
            process.stderr.write(`[DEBUG] Received [DONE]\n`);
          }
          return { reply: fullReply, thinking: fullThinking };
        }

        try {
          const parsed: ChatChunk = JSON.parse(data);
          if (verbose) {
            process.stderr.write(`[DEBUG] Parsed chunk: ${JSON.stringify(parsed)}\n`);
          }
          const thinkingContent = parsed.choices?.[0]?.delta?.reasoning_content ?? '';
          if (thinkingContent) {
            if (onThinkingChunk) onThinkingChunk(thinkingContent);
            fullThinking += thinkingContent;
          }
          const content = parsed.choices?.[0]?.delta?.content ?? '';
          if (content) {
            onChunk(content);
            fullReply += content;
          }
        } catch (e) {
          if (verbose) {
            process.stderr.write(`[DEBUG] JSON parse error: ${(e as Error).message}, data: ${data}\n`);
          }
        }
      }
    }

    if (!hasReceivedData && verbose) {
      process.stderr.write(`[DEBUG] Warning: No data received from stream\n`);
    }

    return { reply: fullReply, thinking: fullThinking };
  } catch (e) {
    clearTimeout(timeoutId);
    if ((e as Error).name === 'AbortError') {
      throw new LLMError('请求超时：连接建立超时');
    }
    throw e;
  }
}

export async function streamChatWithTools(
  provider: LLMProvider,
  messages: ChatMessage[],
  tools: ToolDefinition[],
  onChunk: (content: string) => void,
  options?: { timeout?: number; verbose?: boolean; onThinkingChunk?: (content: string) => void }
): Promise<ToolCallStreamResult> {
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
  const verbose = options?.verbose ?? false;
  const onThinkingChunk = options?.onThinkingChunk;
  const url = provider.baseUrl;

  if (verbose) {
    process.stderr.write(`[DEBUG] streamChatWithTools 请求 URL: ${url}\n`);
    process.stderr.write(`[DEBUG] streamChatWithTools tools 数量: ${tools.length}\n`);
    if (tools.length > 0) {
      process.stderr.write(`[DEBUG] streamChatWithTools tools 名称: ${tools.map(t => t.function.name).join(', ')}\n`);
    }
    process.stderr.write(`[DEBUG] streamChatWithTools messages 数量: ${messages.length}\n`);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${provider.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: provider.model,
        messages,
        ...(tools.length > 0 ? { tools } : {}),
        stream: true,
      }),
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const body = await response.text();
      if (verbose) {
        process.stderr.write(`[DEBUG] HTTP Status: ${response.status}\n`);
        process.stderr.write(`[DEBUG] Response Body: ${body}\n`);
      }
      throw new LLMError(`LLM API 错误: HTTP ${response.status}: ${body}`);
    }

    if (verbose) {
      process.stderr.write(`[DEBUG] HTTP Status: ${response.status}, streaming started\n`);
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullReply = '';
    let fullThinking = '';

    const toolCallBuffers = new Map<number, {
      id: string; type: string; name: string; arguments: string
    }>();

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        if (verbose) {
          process.stderr.write(`[DEBUG] Stream done, reply length: ${fullReply.length}\n`);
        }
        break;
      }

      const chunk = decoder.decode(value, { stream: true });

      if (verbose) {
        process.stderr.write(`[DEBUG] Raw chunk: ${JSON.stringify(chunk)}\n`);
      }

      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop()!;

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (verbose) {
          process.stderr.write(`[DEBUG] Processing line: ${JSON.stringify(trimmed)}\n`);
        }

        if (!trimmed.startsWith('data: ')) {
          if (verbose) {
            process.stderr.write(`[DEBUG] Skipping non-data line\n`);
          }
          continue;
        }

        const data = trimmed.slice(6);
        if (data === '[DONE]') {
          if (verbose) {
            process.stderr.write(`[DEBUG] Received [DONE]\n`);
          }
          return { reply: fullReply, thinking: fullThinking, toolCalls: null };
        }

        try {
          const parsed: ChatChunk = JSON.parse(data);
          if (verbose) {
            process.stderr.write(`[DEBUG] Parsed chunk: ${JSON.stringify(parsed)}\n`);
          }

          const choice = parsed.choices?.[0];
          if (!choice) continue;

          const delta = choice.delta;
          const finishReason = choice.finish_reason;

          const thinkingContent = delta?.reasoning_content ?? '';
          if (thinkingContent) {
            if (onThinkingChunk) onThinkingChunk(thinkingContent);
            fullThinking += thinkingContent;
          }

          const content = delta?.content ?? '';
          if (content) {
            onChunk(content);
            fullReply += content;
          }

          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index;
              if (!toolCallBuffers.has(idx)) {
                toolCallBuffers.set(idx, {
                  id: tc.id ?? '',
                  type: tc.type ?? 'function',
                  name: tc.function?.name ?? '',
                  arguments: tc.function?.arguments ?? '',
                });
              } else {
                const buf = toolCallBuffers.get(idx)!;
                buf.arguments += tc.function?.arguments ?? '';
              }
            }
          }

          if (finishReason === 'tool_calls') {
            const parsedToolCalls: ToolCall[] = [];
            for (const [, buf] of toolCallBuffers) {
              let parsedArgs: unknown;
              try {
                parsedArgs = JSON.parse(buf.arguments);
              } catch (e) {
                if (verbose) {
                  console.error(`[DEBUG] tool_call arguments JSON.parse 失败，保留原始字符串: ${buf.arguments}`, e);
                }
                parsedArgs = buf.arguments;
              }
              parsedToolCalls.push({
                id: buf.id,
                type: 'function',
                function: {
                  name: buf.name,
                  arguments: typeof parsedArgs === 'string'
                    ? parsedArgs
                    : JSON.stringify(parsedArgs),
                },
              });
            }
            return { reply: '', thinking: fullThinking, toolCalls: parsedToolCalls };
          }

          if (finishReason !== null && finishReason !== 'tool_calls') {
            return { reply: fullReply, thinking: fullThinking, toolCalls: null };
          }
        } catch (e) {
          if (verbose) {
            process.stderr.write(`[DEBUG] JSON parse error: ${(e as Error).message}, data: ${data}\n`);
          }
        }
      }
    }

    return { reply: fullReply, thinking: fullThinking, toolCalls: null };
  } catch (e) {
    clearTimeout(timeoutId);
    if ((e as Error).name === 'AbortError') {
      throw new LLMError('请求超时：连接建立超时');
    }
    throw e;
  }
}
