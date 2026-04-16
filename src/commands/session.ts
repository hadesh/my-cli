import type { Command } from '../command.js';
import type { Config } from '../config/schema.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  createSession,
  listSessions,
  getSession,
  setActiveSessionId,
  deleteSession,
  getActiveSessionId,
  getOrCreateActiveSession,
} from '../session/store.js';
import { loadLLMConfig } from '../llm/config.js';
import { printTable } from '../output/text.js';
import { UsageError } from '../errors/base.js';
import { countTokens, freeEncoder } from '../utils/tokenizer.js';
import { calcContextStats, formatContextLine, trimMessages } from '../utils/context.js';

export const sessionCommand: Command = {
  name: 'session',
  description: '管理对话 session',
  usage: 'my-cli session <new|list|switch|delete|info>',
  examples: [
    'my-cli session new "chat-1"',
    'my-cli session list',
    'my-cli session switch <id>',
    'my-cli session delete <id>',
    'my-cli session info',
    'my-cli session info <id>',
  ],
  async execute(config: Config, flags: Record<string, unknown>, args: string[]) {
    const subcommand = args[0];

    switch (subcommand) {
      case 'new': {
        const name = args[1] ?? 'New Chat';
        const session = await createSession(name);
        console.log(`已创建 session: ${session.id}（${session.name}）`);
        break;
      }

      case 'list': {
        const sessions = await listSessions();
        if (sessions.length === 0) {
          console.log('暂无 session');
          break;
        }

        const activeId = await getActiveSessionId();

        printTable(
          config,
          sessions.map((s) => ({
            ID: activeId === s.id ? `* ${s.id}` : s.id,
            名称: s.name,
            消息数: String(s.messages.length),
            最后更新: new Date(s.updatedAt).toLocaleString('zh-CN'),
          })),
        );
        break;
      }

      case 'switch': {
        if (!args[1]) {
          throw new UsageError('用法: my-cli session switch <id>');
        }

        await getSession(args[1]);

        await setActiveSessionId(args[1]);
        console.log(`已切换到 session: ${args[1]}`);
        break;
      }

      case 'delete': {
        if (!args[1]) {
          throw new UsageError('用法: my-cli session delete <id>');
        }

        const activeId = await getActiveSessionId();

        await deleteSession(args[1]);
        console.log(`Session ${args[1]} 已删除`);

        if (activeId === args[1]) {
          console.log('活跃 session 已清除');
        }
        break;
      }

      case 'info': {
        const targetId = args[1];
        const session = targetId
          ? await getSession(targetId)
          : await getOrCreateActiveSession();

        const agentMdPath = join(process.env.HOME ?? homedir(), '.config', 'my-cli', 'agent.md');
        let agentMd = '';
        try {
          agentMd = await Bun.file(agentMdPath).text();
        } catch {
          // agent.md 不存在
        }

        const baseTokens = countTokens(agentMd);

        const userMessages = session.messages.filter(m => m.role === 'user');
        const assistantMessages = session.messages.filter(m => m.role === 'assistant');

        const recentMessages = await trimMessages(session.messages, config);
        const messageText = recentMessages.map(m => m.content).join('');
        const messageTokens = countTokens(messageText);

        const stats = await calcContextStats([agentMd, messageText], config);
        const modelName = config.model?.includes('/')
          ? config.model.split('/').slice(1).join('/')
          : (config.model ?? '');

        printTable(config, [
          { 项目: 'Session ID', 值: session.id },
          { 项目: '名称', 值: session.name },
          { 项目: '消息数', 值: String(session.messages.length) },
          { 项目: '  User 消息', 值: String(userMessages.length) },
          { 项目: '  Assistant 消息', 值: String(assistantMessages.length) },
          { 项目: '---', 值: '---' },
          { 项目: 'Base tokens (agent.md)', 值: String(baseTokens) },
          { 项目: 'Message tokens (对话)', 值: String(messageTokens) },
          { 项目: '上下文', 值: formatContextLine(stats, modelName) },
        ]);
        freeEncoder();
        break;
      }

      default:
        throw new UsageError('用法: my-cli session <new|list|switch|delete|info>');
    }
  },
};