import { LLMError } from '../errors/base.js';
import type { LLMProvider, ChatMessage, ChatChunk, ToolDefinition, ChatResponse } from '../types/llm.js';

const DEFAULT_TIMEOUT = 30000;

export async function streamChat(
  provider: LLMProvider,
  messages: ChatMessage[],
  onChunk: (content: string) => void,
  options?: { timeout?: number; verbose?: boolean }
): Promise<string> {
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
  const verbose = options?.verbose ?? false;
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
          return fullReply;
        }

        try {
          const parsed: ChatChunk = JSON.parse(data);
          if (verbose) {
            process.stderr.write(`[DEBUG] Parsed chunk: ${JSON.stringify(parsed)}\n`);
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

    return fullReply;
  } catch (e) {
    clearTimeout(timeoutId);
    if ((e as Error).name === 'AbortError') {
      throw new LLMError('请求超时：连接建立超时');
    }
    throw e;
  }
}

export async function chatWithTools(
  provider: LLMProvider,
  messages: ChatMessage[],
  tools: ToolDefinition[],
  options?: { timeout?: number }
): Promise<ChatResponse> {
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
  const url = provider.baseUrl;

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
        tools,
        stream: false,
      }),
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new LLMError(`LLM API 错误: HTTP ${response.status}`);
    }

    return await response.json() as ChatResponse;
  } catch (e) {
    clearTimeout(timeoutId);
    if ((e as Error).name === 'AbortError') {
      throw new LLMError('请求超时：连接建立超时');
    }
    throw e;
  }
}
