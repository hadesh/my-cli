import { get_encoding, type Tiktoken } from 'tiktoken';

// 使用 cl100k_base 编码（兼容 GPT-4 / 大多数现代模型）
let encoder: Tiktoken | null = null;

function getEncoder(): Tiktoken {
  if (!encoder) {
    encoder = get_encoding('cl100k_base');
  }
  return encoder;
}

export function countTokens(text: string): number {
  if (!text) return 0;
  return getEncoder().encode(text).length;
}

export function freeEncoder(): void {
  if (encoder) {
    encoder.free();
    encoder = null;
  }
}
