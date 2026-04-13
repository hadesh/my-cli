import type { Command } from '../command.js';
import type { Config } from '../config/schema.js';
import {
  createSession,
  listSessions,
  getSession,
  setActiveSessionId,
  deleteSession,
  getActiveSessionId,
} from '../session/store.js';
import { printTable } from '../output/text.js';
import { UsageError } from '../errors/base.js';

export const sessionCommand: Command = {
  name: 'session',
  description: '管理对话 session',
  usage: 'my-cli session <new|list|switch|delete>',
  examples: [
    'my-cli session new "chat-1"',
    'my-cli session list',
    'my-cli session switch <id>',
    'my-cli session delete <id>',
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

      default:
        throw new UsageError('用法: my-cli session <new|list|switch|delete>');
    }
  },
};