import type { Command } from '../command.js';
import type { Config } from '../config/schema.js';
import type { ChatMessage, LLMProvider, ContentPart, TextContentPart, ToolCall, ChatRole } from '../types/llm.js';
import type { Message, Session } from '../types/session.js';
import { homedir } from 'node:os';
import { basename } from 'node:path';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import chalk from 'chalk';
import { UsageError } from '../errors/base.js';
import { streamChat, streamChatWithTools } from '../llm/client.js';
import { getDefaultProvider, getProvider } from '../llm/config.js';
import { getSession, getOrCreateActiveSession, updateSession, setActiveSessionId } from '../session/store.js';
import { saveConfig } from '../config/loader.js';
import { renderMarkdown } from '../output/markdown.js';
import { getUnifiedToolDefs, executeUnifiedTool } from '../tools/store.js';
import { closeRuntime } from '../mcp/client.js';
import { freeEncoder } from '../utils/tokenizer.js';
import { calcContextStats, formatContextLine, trimMessages } from '../utils/context.js';

function printToolThinking(toolName: string): void {
  let label: string;
  if (toolName.includes('__')) {
    const idx = toolName.indexOf('__');
    const serverName = toolName.slice(0, idx);
    const tName = toolName.slice(idx + 2);
    label = chalk.dim(`▸ 调用 MCP 工具 [${serverName}] ${tName}`);
  } else {
    label = chalk.dim(`▸ 调用工具 [${toolName}]`);
  }
  process.stdout.write(label + '\n');
}

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
  call: streamChatWithTools,
};

export const executorFactory = {
  execute: executeUnifiedTool,
};

export const toolsStoreFactory = {
  loadTools: getUnifiedToolDefs,
};

export const askCommand: Command = {
  name: 'ask',
  description: '向 LLM 发送消息',
  usage: 'my-cli ask <消息> [--file <路径>] [--session <session-id>] [--provider <name>] [--verbose] [--btw]',
  examples: [
    'my-cli ask 什么是 TypeScript?',
    'my-cli ask "图片里有什么" --file ./photo.jpg',
    'my-cli ask "总结文档" --file ./README.md --file ./CHANGELOG.md',
    'my-cli ask --session 20260410-123456-abcd 继续讨论',
    'my-cli ask --provider deepseek 你好',
    'my-cli ask --btw "随便问一句，不记录"',
  ],
  async execute(config: Config, flags: Record<string, unknown>, args: string[]): Promise<void> {
    const message = args[0];
    const sessionId = flags['session'] as string | undefined;
    const providerName = flags['provider'] as string | undefined;
    const verbose = flags['verbose'] === true;
    const timeout = flags['timeout'] ? parseInt(flags['timeout'] as string, 10) : undefined;
    const btw = flags['btw'] === true;
    const filePaths = flags['file'] as string[] | undefined;
    
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
      agentMd = readFileSync(agentMdPath, 'utf-8');
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
    const recentMessages = (await trimMessages(session.messages, config)) as Message[];
    
    // 构造 messages 数组
    const messages: ChatMessage[] = [];
    if (agentMd) {
      messages.push({ role: 'system', content: agentMd });
    }
    for (const m of recentMessages) {
      if (m.role === 'thinking') continue;
      if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
        messages.push({ role: 'assistant', content: m.content, tool_calls: m.tool_calls as ToolCall[] });
      } else if (m.role === 'tool') {
        const toolCallId = m.tool_call_id;
        const toolMsg: ChatMessage = { role: 'tool', content: m.content };
        if (toolCallId !== undefined) toolMsg.tool_call_id = toolCallId;
        messages.push(toolMsg);
      } else {
        messages.push({ role: m.role as ChatRole, content: m.content });
      }
    }
    if (filePaths && filePaths.length > 0) {
      const { buildAttachmentContentParts } = await import('../utils/file.js');
      const contentParts = await buildAttachmentContentParts(filePaths, message);
      messages.push({ role: 'user', content: contentParts });
    } else {
      messages.push({ role: 'user', content: message });
    }

    // 加载统一工具列表（内置 + MCP）
    const tools = await toolsStoreFactory.loadTools(config);
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
    const pendingMessages: Message[] = [];
    const maxToolCalls = 10;
    const modelName = provider.model;

    try {
      const contentToText = (c: string | ContentPart[]): string => {
        if (typeof c === 'string') return c;
        return c.filter((p): p is TextContentPart => p.type === 'text').map(p => p.text).join('');
      };
      const preStats = await calcContextStats(messages.map(m => contentToText(m.content)), config);
      process.stdout.write(chalk.dim.italic(formatContextLine(preStats, modelName)));
      process.stdout.write('\n');
      freeEncoder();

      process.stderr.write('思考中...\n');

      if (tools.length === 0) {
        const opts: { timeout?: number; verbose?: boolean; onThinkingChunk?: (content: string) => void } = { verbose };
        if (timeout !== undefined) opts.timeout = timeout;
        if (verbose) opts.onThinkingChunk = (c) => process.stderr.write(chalk.dim(c));
        const { reply, thinking } = await streamChatFactory.call(provider, messages, () => {}, opts);
        fullReply = reply;
        if (thinking) {
          pendingMessages.push({ role: 'thinking', content: thinking, timestamp: new Date().toISOString() });
        }
      } else {
        let toolCallCount = 0;

        while (toolCallCount < maxToolCalls) {
          const toolOpts: { timeout?: number; verbose?: boolean } = { verbose };
          if (timeout !== undefined) toolOpts.timeout = timeout;
          const streamResult = await chatWithToolsFactory.call(provider, messages, toolDefs, () => {}, toolOpts);

          if (verbose) {
            process.stderr.write(`[DEBUG] streamChatWithTools toolCalls: ${JSON.stringify(streamResult.toolCalls)}\n`);
            process.stderr.write(`[DEBUG] streamChatWithTools reply length: ${streamResult.reply.length}\n`);
          }

          if (streamResult.toolCalls && streamResult.toolCalls.length > 0) {
            toolCallCount++;
            if (verbose) {
              process.stderr.write(`[DEBUG] 第 ${toolCallCount} 次工具调用: ${streamResult.toolCalls.map(c => c.function.name).join(', ')}\n`);
            }

            const assistantToolMsg: ChatMessage = {
              role: 'assistant',
              content: '',
              tool_calls: streamResult.toolCalls,
            };
            messages.push(assistantToolMsg);
            const now = new Date().toISOString();
            const assistantPendingMsg: Message = {
              role: 'assistant',
              content: '',
              timestamp: now,
              tool_calls: streamResult.toolCalls,
            };
            pendingMessages.push(assistantPendingMsg);

            for (const toolCall of streamResult.toolCalls) {
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
                printToolThinking(toolName);
                const startTime = Date.now();
                const unifiedTool = tools.find(t => t.name === toolName);
                if (!unifiedTool) throw new Error(`未知工具: ${toolName}`);
                result = await executorFactory.execute(unifiedTool, argsObject);
                process.stderr.write(chalk.dim(`  ✓ 完成 (${Date.now() - startTime}ms)\n`));
              } catch (e) {
                result = `工具 "${toolName}" 执行失败: ${(e as Error).message}`;
              }
              if (verbose) {
                process.stderr.write(`[DEBUG] 工具 "${toolName}" 返回结果长度: ${result.length}\n`);
              }

              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: result,
              });
              pendingMessages.push({
                role: 'tool',
                content: result,
                timestamp: new Date().toISOString(),
                tool_call_id: toolCall.id,
              });
            }
          } else {
            fullReply = streamResult.reply;
            if (streamResult.thinking) {
              pendingMessages.push({ role: 'thinking', content: streamResult.thinking, timestamp: new Date().toISOString() });
            }
            break;
          }

          if (toolCallCount >= maxToolCalls) {
            fullReply = streamResult.reply;
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
    } finally {
      await closeRuntime();
    }

    if (!btw) {
      const now = new Date().toISOString();
      const userMsg: Message = { role: 'user', content: message, timestamp: now };
      if (filePaths && filePaths.length > 0) {
        userMsg.attachments = filePaths.map(p => ({ name: basename(p), path: p }));
      }
      session.messages.push(userMsg);
      for (const m of pendingMessages) {
        session.messages.push(m);
      }
      const assistantMsg: Message = { role: 'assistant', content: fullReply, timestamp: now };
      session.messages.push(assistantMsg);
      await storeFactory.updateSession(session);
      await storeFactory.setActiveSessionId(session.id);
    }

    await saveConfig({ model: `${provider.name}/${provider.model}` });
  },
};