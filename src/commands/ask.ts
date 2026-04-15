import type { Command } from '../command.js';
import type { Config } from '../config/schema.js';
import type { ChatMessage, LLMProvider } from '../types/llm.js';
import type { Session } from '../types/session.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { UsageError } from '../errors/base.js';
import { streamChat, chatWithTools } from '../llm/client.js';
import { getDefaultProvider, getProvider } from '../llm/config.js';
import { getSession, getOrCreateActiveSession, updateSession, setActiveSessionId } from '../session/store.js';
import { renderMarkdown } from '../output/markdown.js';
import { getUnifiedToolDefs, executeUnifiedTool } from '../tools/store.js';
import { closeRuntime } from '../mcp/client.js';
import { countTokens, freeEncoder } from '../utils/tokenizer.js';
import { calcContextStats, formatContextLine } from '../utils/context.js';

export const streamChatFactory = {
  call: streamChat,
};

export const storeFactory = {
  getSession,
  getOrCreateActiveSession,
  updateSession,
  setActiveSessionId,
};

export const chatWithToolsFactory = {
  call: chatWithTools,
};

export const askCommand: Command = {
  name: 'ask',
  description: '向 LLM 发送消息',
  usage: 'my-cli ask <消息> [--session <session-id>] [--provider <name>] [--verbose]',
  examples: [
    'my-cli ask 什么是 TypeScript?',
    'my-cli ask --session 20260410-123456-abcd 继续讨论',
    'my-cli ask --provider deepseek 你好',
    'my-cli ask --verbose 你好',
  ],
  async execute(config: Config, flags: Record<string, unknown>, args: string[]): Promise<void> {
    const message = args[0];
    const sessionId = flags['session'] as string | undefined;
    const providerName = flags['provider'] as string | undefined;
    const verbose = flags['verbose'] === true;
    const timeout = flags['timeout'] ? parseInt(flags['timeout'] as string, 10) : undefined;
    
    if (!message) {
      throw new UsageError('请提供消息内容');
    }
    
    let provider: LLMProvider;
    if (providerName) {
      const p = await getProvider(providerName);
      if (!p) {
        throw new UsageError(`Provider 不存在: ${providerName}`);
      }
      provider = p;
    } else {
      provider = await getDefaultProvider();
    }
    
    // 读取 agent.md
    const agentMdPath = join(process.env.HOME ?? homedir(), '.config', 'my-cli', 'agent.md');
    let agentMd = '';
    try {
      agentMd = await Bun.file(agentMdPath).text();
    } catch {
      // 文件不存在，agentMd 保持空字符串
    }
    
    // 加载 session
    let session: Session;
    if (sessionId) {
      session = await storeFactory.getSession(sessionId);
    } else {
      session = await storeFactory.getOrCreateActiveSession();
    }
    
    // 滑动窗口裁剪
    const contextWindow = config.contextWindow ?? 20;
    const recentMessages = session.messages.slice(-contextWindow);
    
    // 构造 messages 数组
    const messages: ChatMessage[] = [];
    if (agentMd) {
      messages.push({ role: 'system', content: agentMd });
    }
    for (const m of recentMessages) {
      messages.push({ role: m.role, content: m.content });
    }
    messages.push({ role: 'user', content: message });

    // 加载统一工具列表（内置 + MCP）
    const tools = await getUnifiedToolDefs(config);
    if (verbose) {
      process.stderr.write(`[DEBUG] 已加载工具数量: ${tools.length}\n`);
      for (const t of tools) {
        process.stderr.write(`[DEBUG] 工具: ${t.name} (${t.source}) - ${t.description}\n`);
      }
    }
    const toolDefs = tools.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      }
    }));
    if (verbose && toolDefs.length > 0) {
      process.stderr.write(`[DEBUG] toolDefs: ${JSON.stringify(toolDefs, null, 2)}\n`);
    }

    let partialReply = '';
    process.once('SIGINT', async () => {
      if (partialReply) {
        const now = new Date().toISOString();
        session.messages.push({ role: 'user', content: message, timestamp: now });
        session.messages.push({ role: 'assistant', content: partialReply, timestamp: now });
        await storeFactory.updateSession(session);
        await storeFactory.setActiveSessionId(session.id);
      }
      process.exit(0);
    });

    let fullReply = '';
    const maxToolCalls = 10;

    try {
      process.stderr.write('思考中...\n');

      if (tools.length === 0) {
        fullReply = await streamChatFactory.call(provider, messages, () => {
        }, { timeout, verbose });
      } else {
        let toolCallCount = 0;
        let lastResponseContent: string | null = null;

        while (toolCallCount < maxToolCalls) {
          const response = await chatWithToolsFactory.call(provider, messages, toolDefs, { timeout, verbose });
          const choice = response.choices[0];
          const assistantMessage = choice.message;

          if (verbose) {
            process.stderr.write(`[DEBUG] chatWithTools 响应 tool_calls: ${JSON.stringify(assistantMessage.tool_calls ?? null)}\n`);
            process.stderr.write(`[DEBUG] chatWithTools 响应 content: ${assistantMessage.content ?? '(空)'}\n`);
          }

          if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
            toolCallCount++;
            lastResponseContent = assistantMessage.content ?? '';
            if (verbose) {
              process.stderr.write(`[DEBUG] 第 ${toolCallCount} 次工具调用: ${assistantMessage.tool_calls.map(c => c.function.name).join(', ')}\n`);
            }

            messages.push({
              role: 'assistant',
              content: assistantMessage.content ?? '',
              tool_calls: assistantMessage.tool_calls
            });

            for (const toolCall of assistantMessage.tool_calls) {
              const toolName = toolCall.function.name;
              let result: string;
              let argsObject: Record<string, unknown> = {};
              try {
                argsObject = JSON.parse(toolCall.function.arguments);
              } catch {
                argsObject = {};
              }
              if (verbose) {
                process.stderr.write(`[DEBUG] 执行工具 "${toolName}"，参数: ${JSON.stringify(argsObject)}\n`);
              }
              try {
                result = await executeUnifiedTool(toolName, argsObject);
              } catch (e) {
                result = `工具 "${toolName}" 执行失败: ${(e as Error).message}`;
              }
              if (verbose) {
                process.stderr.write(`[DEBUG] 工具 "${toolName}" 返回结果长度: ${result.length}\n`);
              }

              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: result
              });
            }
          } else {
            lastResponseContent = assistantMessage.content ?? '';

            if (toolCallCount === 0) {
              fullReply = await streamChatFactory.call(provider, messages, () => {
              }, { timeout, verbose });
            } else {
              messages.push({
                role: 'assistant',
                content: assistantMessage.content ?? ''
              });
              fullReply = await streamChatFactory.call(provider, messages, () => {
              }, { timeout, verbose });
            }
            break;
          }

          if (toolCallCount >= maxToolCalls) {
            fullReply = lastResponseContent ?? '';
            break;
          }
        }
      }

      const rendered = renderMarkdown(fullReply);
      process.stdout.write(rendered + '\n');

      const allTexts = messages.map(m => m.content ?? '');
      allTexts.push(fullReply);
      const stats = await calcContextStats(allTexts, config);
      freeEncoder();
      process.stderr.write(`\n${formatContextLine(stats)}\n`);
    } catch (e) {
      if (verbose) {
        process.stderr.write(`[DEBUG] Error details: ${(e as Error).stack}\n`);
      }
      process.stderr.write(`LLM 调用失败: ${(e as Error).message}\n`);
      return;
    } finally {
      await closeRuntime();
    }

    const now = new Date().toISOString();
    session.messages.push({ role: 'user', content: message, timestamp: now });
    session.messages.push({ role: 'assistant', content: fullReply, timestamp: now });
    await storeFactory.updateSession(session);
    await storeFactory.setActiveSessionId(session.id);
  },
};