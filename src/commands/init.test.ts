import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { getAgentMdFile, ask, readlineFactory, setReadlineFactory } from './init.js';
import { loadConfig } from '../config/loader.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type * as readline from 'node:readline';
import type { Command } from '../command.js';
import type { Config } from '../config/schema.js';

describe('init 命令', () => {
  let tmpDir: string;
  let logs: string[];
  let originalConsoleLog: typeof console.log;
  let originalHome: string | undefined;
  let originalReadlineCreate: () => readline.Interface;

  beforeEach(() => {
    const randomSuffix = Math.random().toString(36).slice(2, 6);
    tmpDir = `/tmp/my-cli-test-init-${randomSuffix}`;
    process.env.HOME = tmpDir;
    originalHome = process.env.HOME;

    logs = [];
    originalConsoleLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    };

    originalReadlineCreate = readlineFactory.create;
  });

  afterEach(() => {
    console.log = originalConsoleLog;
    readlineFactory.create = originalReadlineCreate;
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
  });

  function ensureDir(filePath: string) {
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  function createMockReadline(inputs: string[]): readline.Interface {
    let inputIndex = 0;
    return {
      question: (q: string, cb: (answer: string) => void) => {
        cb(inputs[inputIndex++] ?? '');
      },
      close: () => {},
    } as readline.Interface;
  }

  async function getInitCommand(): Promise<Command> {
    const module = await import('./init.js');
    return module.initCommand;
  }

  test('正常创建 agent.md，文件包含正确内容', async () => {
    const config = loadConfig({ output: 'text' });

    readlineFactory.create = () => createMockReadline(['TestBot', '编程助手', '简洁', '无特殊注意事项']);

    const initCommand = await getInitCommand();
    await initCommand.execute(config, {}, []);

    const agentMdFile = join(tmpDir, '.config', 'my-cli', 'agent.md');
    expect(existsSync(agentMdFile)).toBe(true);

    const content = readFileSync(agentMdFile, 'utf-8');
    expect(content).toContain('# Agent Profile');
    expect(content).toContain('TestBot');
    expect(content).toContain('编程助手');
    expect(content).toContain('简洁');
    expect(content).toContain('无特殊注意事项');
    expect(logs).toContain('✓ agent.md 已生成');
  });

  test('已存在 + 选N不覆盖，文件内容不变', async () => {
    const config = loadConfig({ output: 'text' });

    const agentMdFile = join(tmpDir, '.config', 'my-cli', 'agent.md');
    ensureDir(agentMdFile);
    writeFileSync(agentMdFile, '# Old Content\n\nOld agent profile.', 'utf-8');

    readlineFactory.create = () => createMockReadline(['N']);

    const initCommand = await getInitCommand();
    await initCommand.execute(config, {}, []);

    const content = readFileSync(agentMdFile, 'utf-8');
    expect(content).toContain('# Old Content');
    expect(content).toContain('Old agent profile');
    expect(logs).toContain('已取消');
  });

  test('已存在 + 选y覆盖，文件内容已更新', async () => {
    const config = loadConfig({ output: 'text' });

    const agentMdFile = join(tmpDir, '.config', 'my-cli', 'agent.md');
    ensureDir(agentMdFile);
    writeFileSync(agentMdFile, '# Old Content\n\nOld agent profile.', 'utf-8');

    readlineFactory.create = () => createMockReadline(['NewBot', '新角色', '新风格', '新注意事项', 'y']);

    const initCommand = await getInitCommand();
    await initCommand.execute(config, {}, []);

    const content = readFileSync(agentMdFile, 'utf-8');
    expect(content).toContain('# Agent Profile');
    expect(content).toContain('NewBot');
    expect(content).toContain('新角色');
    expect(content).toContain('新风格');
    expect(content).toContain('新注意事项');
    expect(logs).toContain('✓ agent.md 已生成');
  });

  test('空名称使用默认值 Assistant', async () => {
    const config = loadConfig({ output: 'text' });

    readlineFactory.create = () => createMockReadline(['', '角色', '风格', '']);

    const initCommand = await getInitCommand();
    await initCommand.execute(config, {}, []);

    const agentMdFile = join(tmpDir, '.config', 'my-cli', 'agent.md');
    const content = readFileSync(agentMdFile, 'utf-8');
    expect(content).toContain('Assistant');
  });

  test('空注意事项时省略注意事项节', async () => {
    const config = loadConfig({ output: 'text' });

    readlineFactory.create = () => createMockReadline(['Bot', '角色', '风格', '']);

    const initCommand = await getInitCommand();
    await initCommand.execute(config, {}, []);

    const agentMdFile = join(tmpDir, '.config', 'my-cli', 'agent.md');
    const content = readFileSync(agentMdFile, 'utf-8');
    expect(content).not.toContain('## 注意事项');
  });

  test('getAgentMdFile 返回正确路径', () => {
    process.env.HOME = '/test-home';
    const path = getAgentMdFile();
    expect(path).toBe('/test-home/.config/my-cli/agent.md');
  });

  test('ask 函数正确包装 rl.question', async () => {
    const mockRl = createMockReadline(['answer']);
    const result = await ask(mockRl, 'question');
    expect(result).toBe('answer');
  });

  test('setReadlineFactory 正确设置工厂函数', () => {
    const mockFn = () => createMockReadline(['test']);
    setReadlineFactory(mockFn);
    expect(readlineFactory.create).toBe(mockFn);
  });
});