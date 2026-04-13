import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { sessionCommand } from './session.js';
import { CLIError } from '../errors/base.js';
import { loadConfig } from '../config/loader.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

describe('session 命令组', () => {
  let tmpDir: string;
  let logs: string[];
  let originalConsoleLog: typeof console.log;
  let originalHome: string | undefined;

  beforeEach(() => {
    const randomSuffix = Math.random().toString(36).slice(2, 6);
    tmpDir = `/tmp/my-cli-test-session-cmd-${randomSuffix}`;
    process.env.HOME = tmpDir;
    originalHome = process.env.HOME;

    logs = [];
    originalConsoleLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    };
  });

  afterEach(() => {
    console.log = originalConsoleLog;
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
  });

  test('session new 创建 session 并返回正确 ID 格式', async () => {
    const config = loadConfig({ output: 'text' });

    await sessionCommand.execute(config, {}, ['new', 'my-chat']);

    expect(logs.length).toBe(1);
    const log = logs[0];
    const idMatch = log.match(/已创建 session: (\d{8}-\d{6}-[a-z0-9]{4})/);
    expect(idMatch).not.toBeNull();

    const id = idMatch![1];
    expect(id).toMatch(/^\d{8}-\d{6}-[a-z0-9]{4}$/);
    expect(log).toContain('my-chat');

    const sessionFile = join(tmpDir, '.config', 'my-cli', 'sessions', `${id}.json`);
    expect(existsSync(sessionFile)).toBe(true);
  });

  test('session new 默认名称为 "New Chat"', async () => {
    const config = loadConfig({ output: 'text' });

    await sessionCommand.execute(config, {}, ['new']);

    expect(logs[0]).toContain('New Chat');
  });

  test('session list 无 session 时输出 "暂无 session"', async () => {
    const config = loadConfig({ output: 'text' });

    await sessionCommand.execute(config, {}, ['list']);

    expect(logs).toContain('暂无 session');
  });

  test('session list 有 session 时显示表格', async () => {
    const config = loadConfig({ output: 'text' });

    await sessionCommand.execute(config, {}, ['new', 'chat-1']);
    await sessionCommand.execute(config, {}, ['new', 'chat-2']);

    logs = [];
    await sessionCommand.execute(config, {}, ['list']);

    expect(logs.length).toBeGreaterThan(2);
    expect(logs.some(l => l.includes('chat-1'))).toBe(true);
    expect(logs.some(l => l.includes('chat-2'))).toBe(true);
    expect(logs.some(l => l.includes('ID') || l.includes('名称'))).toBe(true);
  });

  test('session list 活跃 session ID 前加 *', async () => {
    const config = loadConfig({ output: 'text' });

    await sessionCommand.execute(config, {}, ['new', 'active-chat']);
    const activeLog = logs[0];
    const activeIdMatch = activeLog.match(/已创建 session: (\d{8}-\d{6}-[a-z0-9]{4})/);
    const activeId = activeIdMatch![1];

    logs = [];
    await sessionCommand.execute(config, {}, ['list']);

    expect(logs.some(l => l.includes(`* ${activeId}`))).toBe(true);
  });

  test('session switch 切换活跃 session', async () => {
    const config = loadConfig({ output: 'text' });

    await sessionCommand.execute(config, {}, ['new', 'first']);
    const firstLog = logs[0];
    const firstId = firstLog.match(/已创建 session: (\d{8}-\d{6}-[a-z0-9]{4})/)![1];

    await sessionCommand.execute(config, {}, ['new', 'second']);
    const secondLog = logs[1];
    const secondId = secondLog.match(/已创建 session: (\d{8}-\d{6}-[a-z0-9]{4})/)![1];

    logs = [];
    await sessionCommand.execute(config, {}, ['switch', firstId]);

    expect(logs[0]).toContain(`已切换到 session: ${firstId}`);

    const cfg = loadConfig();
    expect(cfg.activeSessionId).toBe(firstId);
  });

  test('session switch 不存在的 session 抛出 CLIError', async () => {
    const config = loadConfig({ output: 'text' });

    expect(async () => {
      await sessionCommand.execute(config, {}, ['switch', 'nonexistent-id']);
    }).toThrow(CLIError);
  });

  test('session switch 无参数抛出 UsageError', async () => {
    const config = loadConfig({ output: 'text' });

    expect(async () => {
      await sessionCommand.execute(config, {}, ['switch']);
    }).toThrow();
  });

  test('session delete 删除 session 文件', async () => {
    const config = loadConfig({ output: 'text' });

    await sessionCommand.execute(config, {}, ['new', 'to-delete']);
    const id = logs[0].match(/已创建 session: (\d{8}-\d{6}-[a-z0-9]{4})/)![1];

    const sessionFile = join(tmpDir, '.config', 'my-cli', 'sessions', `${id}.json`);
    expect(existsSync(sessionFile)).toBe(true);

    logs = [];
    await sessionCommand.execute(config, {}, ['delete', id]);

    expect(logs[0]).toContain(`Session ${id} 已删除`);
    expect(existsSync(sessionFile)).toBe(false);
  });

  test('session delete 活跃 session 时显示额外提示', async () => {
    const config = loadConfig({ output: 'text' });

    await sessionCommand.execute(config, {}, ['new', 'active-to-delete']);
    const id = logs[0].match(/已创建 session: (\d{8}-\d{6}-[a-z0-9]{4})/)![1];

    logs = [];
    await sessionCommand.execute(config, {}, ['delete', id]);

    expect(logs).toContain('活跃 session 已清除');

    const cfg = loadConfig();
    expect(cfg.activeSessionId).toBeUndefined();
  });

  test('session delete 无参数抛出 UsageError', async () => {
    const config = loadConfig({ output: 'text' });

    expect(async () => {
      await sessionCommand.execute(config, {}, ['delete']);
    }).toThrow();
  });

  test('无子命令时抛出 UsageError', async () => {
    const config = loadConfig({ output: 'text' });

    expect(async () => {
      await sessionCommand.execute(config, {}, []);
    }).toThrow();
  });

  test('未知子命令时抛出 UsageError', async () => {
    const config = loadConfig({ output: 'text' });

    expect(async () => {
      await sessionCommand.execute(config, {}, ['unknown']);
    }).toThrow();
  });
});