import type { Config } from '../config/schema.js';
import { AuthError, HttpError, NetworkError } from '../errors/base.js';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  query?: Record<string, string | number | boolean>;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface StreamOptions extends RequestOptions {
  onChunk: (chunk: string) => void;
}

function buildUrl(baseUrl: string, path: string, query?: Record<string, string | number | boolean>): string {
  const url = new URL(path, baseUrl.endsWith('/') ? baseUrl : baseUrl + '/');
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

function buildHeaders(config: Config, extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'User-Agent': 'my-cli/0.1.0',
    ...extra,
  };
  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }
  return headers;
}

async function parseResponseBody(res: Response): Promise<unknown> {
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    return res.json();
  }
  return res.text();
}

async function throwIfError(res: Response): Promise<void> {
  if (res.ok) return;

  const body = await parseResponseBody(res);
  const message =
    res.status === 401 || res.status === 403
      ? '认证失败，请检查 API Key 或重新登录'
      : (typeof body === 'object' && body !== null && 'message' in body
          ? String((body as Record<string, unknown>)['message'])
          : res.statusText);

  if (res.status === 401 || res.status === 403) {
    throw new AuthError(message);
  }
  throw new HttpError(res.status, message, body);
}

export async function requestJson<T>(config: Config, options: RequestOptions): Promise<T> {
  const url = buildUrl(config.baseUrl, options.path, options.query);
  const headers = buildHeaders(config, options.headers);
  const timeoutMs = options.timeoutMs ?? config.timeout * 1000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      method: options.method ?? 'GET',
      headers,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new NetworkError(`请求超时（>${timeoutMs}ms）: ${url}`);
    }
    throw new NetworkError(`网络错误: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timer);
  }

  await throwIfError(res);
  return parseResponseBody(res) as Promise<T>;
}

export async function requestStream(config: Config, options: StreamOptions): Promise<void> {
  const url = buildUrl(config.baseUrl, options.path, options.query);
  const headers = buildHeaders(config, {
    ...options.headers,
    Accept: 'text/event-stream',
  });
  const timeoutMs = options.timeoutMs ?? config.timeout * 1000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      method: options.method ?? 'POST',
      headers,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new NetworkError(`流式请求超时（>${timeoutMs}ms）: ${url}`);
    }
    throw new NetworkError(`网络错误: ${err instanceof Error ? err.message : String(err)}`);
  }

  await throwIfError(res);

  if (!res.body) {
    clearTimeout(timer);
    return;
  }

  const decoder = new TextDecoder();
  const reader = res.body.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      options.onChunk(decoder.decode(value, { stream: true }));
    }
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}
