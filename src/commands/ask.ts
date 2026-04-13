import type { Command } from '../command.js';
import type { Config } from '../config/schema.js';
import type { ChatMessage, LLMProvider } from '../types/llm.js';
import type { Session } from '../types/session.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { UsageError } from '../errors/base.js';
import { streamChat } from '../llm/client.js';
import { getDefaultProvider, getProvider } from '../llm/config.js';
import { getSession, getOrCreateActiveSession, updateSession, setActiveSessionId } from '../session/store.js';
import { renderMarkdown } from '../output/markdown.js';

export const streamChatFactory = {
  call: streamChat,
};

export const storeFactory = {
  getSession,
  getOrCreateActiveSession,
  updateSession,
  setActiveSessionId,
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
    
    // 7. SIGINT 处理（在 streamChat 调用前注册）
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
    
    // 8. 调用 streamChat
    let fullReply = '';
    
    try {
      process.stderr.write('思考中...\n');
      
      fullReply = await streamChatFactory.call(provider, messages, () => {
      }, { timeout, verbose });
      
      const rendered = renderMarkdown(fullReply);
      process.stdout.write(rendered + '\n');
    } catch (e) {
      if (verbose) {
        process.stderr.write(`[DEBUG] Error details: ${(e as Error).stack}\n`);
      }
      process.stderr.write(`LLM 调用失败: ${(e as Error).message}\n`);
      return;
    }
    
    // 9. LLM 成功后才写盘
    const now = new Date().toISOString();
    session.messages.push({ role: 'user', content: message, timestamp: now });
    session.messages.push({ role: 'assistant', content: fullReply, timestamp: now });
    await storeFactory.updateSession(session);
    await storeFactory.setActiveSessionId(session.id);
  },
};