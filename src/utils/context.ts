import type { Config } from '../config/schema.js';
import { loadLLMConfig } from '../llm/config.js';
import { countTokens } from './tokenizer.js';

export interface ContextStats {
  totalTokens: number;
  contextLimit: number | undefined;
}

export async function calcContextStats(texts: string[], config: Config): Promise<ContextStats> {
  const totalTokens = countTokens(texts.join(''));

  let contextLimit: number | undefined;
  if (config.model) {
    const [providerName, modelId] = config.model.split('/');
    if (providerName && modelId) {
      const llmConfig = await loadLLMConfig();
      const provider = llmConfig.providers.find(p => p.name === providerName);
      contextLimit = provider?.models?.[modelId]?.limit?.context;
    }
  }

  return { totalTokens, contextLimit };
}

export function formatContextLine(stats: ContextStats, modelName?: string): string {
  const { totalTokens, contextLimit } = stats;
  const kStr = totalTokens >= 1000
    ? `${(totalTokens / 1000).toFixed(1)}K`
    : String(totalTokens);

  const contextPart = contextLimit
    ? `context: ${kStr} (${((totalTokens / contextLimit) * 100).toFixed(1)}%)`
    : `context: ${kStr}`;

  return modelName ? `${modelName}, ${contextPart}` : contextPart;
}

export async function trimMessages(
  messages: Array<{ role: string; content: string }>,
  config: Config
): Promise<Array<{ role: string; content: string }>> {
  let result = [...messages];

  if (!config.model) return result;

  const [providerName, modelId] = config.model.split('/');
  if (!providerName || !modelId) return result;

  const llmConfig = await loadLLMConfig();
  const provider = llmConfig.providers.find(p => p.name === providerName);
  const contextLimit = provider?.models?.[modelId]?.limit?.context;

  if (!contextLimit) return result;

  const triggerRatio = 0.8;
  const targetRatio = 0.5;

  const getTokens = () => countTokens(result.map(m => m.content).join(''));

  if (getTokens() / contextLimit > triggerRatio) {
    while (result.length > 1 && getTokens() / contextLimit > targetRatio) {
      result = result.slice(1);
    }
  }

  return result;
}
