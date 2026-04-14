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
import { loadTools } from '../tools/store.js';
import { executeToolCommand } from '../tools/executor.js';

export const streamChatFactory = {
  call: streamChat,
};

export const storeFactory = {
  getSession,
  getOrCreateActiveSession,
  updateSession,
  setActiveSessionId,
};

export const toolsStoreFactory = {
  loadTools,
};

export const chatWithToolsFactory = {
  call: chatWithTools,
};

export const executorFactory = {
  execute: executeToolCommand,
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
    
    // 3. 读取 agent.md（动态路径，不使用静态常量）
    const agentMdPath = join(process.env.HOME ?? homedir(), '.config', 'my-cli', 'agent.md');
    let agentMd = '';
    try {
      agentMd = await Bun.file(agentMdPath).text();
    } catch {
      // 文件不存在，agentMd 保持空字符串
    }
    
    // 4. 加载 session（仅读取，此时不写盘）
    let session: Session;
    if (sessionId) {
      session = await storeFactory.getSession(sessionId);
    } else {
      session = await storeFactory.getOrCreateActiveSession();
    }
    
    // 5. 滑动窗口裁剪
    const contextWindow = config.contextWindow ?? 20;
    const recentMessages = session.messages.slice(-contextWindow);
    
    // 6. 构造 messages 数组
    const messages: ChatMessage[] = [];
    if (agentMd) {
      messages.push({ role: 'system', content: agentMd });
    }
    for (const m of recentMessages) {
      messages.push({ role: m.role, content: m.content });
    }
    messages.push({ role: 'user', content: message });

    const allTools = toolsStoreFactory.loadTools();
    const enabledTools = allTools.filter(t => t.enabled);
    if (verbose) {
      process.stderr.write(`[DEBUG] 已加载工具数量: ${allTools.length}，已启用: ${enabledTools.length}\n`);
      for (const t of enabledTools) {
        process.stderr.write(`[DEBUG] 工具: ${t.name} - ${t.description}\n`);
      }
    }
    const toolDefs = enabledTools.map(t => ({
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

      if (enabledTools.length === 0) {
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
              const tool = enabledTools.find(t => t.name === toolName);

              let result: string;
              if (!tool) {
                result = `工具 "${toolName}" 不存在`;
              } else {
                let argsObject: Record<string, string> = {};
                try {
                  const parsed = JSON.parse(toolCall.function.arguments);
                  argsObject = Object.fromEntries(
                    Object.entries(parsed).map(([k, v]) => [k, String(v)])
                  );
                } catch {
                  argsObject = {};
                }
                if (verbose) {
                  process.stderr.write(`[DEBUG] 执行工具 "${toolName}"，参数: ${JSON.stringify(argsObject)}\n`);
                }
                result = await executorFactory.execute(tool.command, argsObject, 30000);
                if (verbose) {
                  process.stderr.write(`[DEBUG] 工具 "${toolName}" 返回结果长度: ${result.length}\n`);
                }
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
    } catch (e) {
      if (verbose) {
        process.stderr.write(`[DEBUG] Error details: ${(e as Error).stack}\n`);
      }
      process.stderr.write(`LLM 调用失败: ${(e as Error).message}\n`);
      return;
    }

    const now = new Date().toISOString();
    session.messages.push({ role: 'user', content: message, timestamp: now });
    session.messages.push({ role: 'assistant', content: fullReply, timestamp: now });
    await storeFactory.updateSession(session);
    await storeFactory.setActiveSessionId(session.id);
  },
};