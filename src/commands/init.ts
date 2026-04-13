import type { Command } from '../command.js';
import type { Config } from '../config/schema.js';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import * as readline from 'node:readline';

/**
 * 动态获取 agent.md 文件路径
 * 使用 process.env.HOME 以支持测试环境隔离
 */
export function getAgentMdFile(): string {
  const home = process.env.HOME ?? homedir();
  return join(home, '.config', 'my-cli', 'agent.md');
}

export function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

export function generateAgentMdContent(
  name: string,
  role: string,
  style: string,
  notes: string,
): string {
  let content = `# Agent Profile

你的名字是 ${name}。

## 角色
${role}

## 回答风格
${style}
`;

  if (notes.trim() !== '') {
    content += `
## 注意事项
${notes}
`;
  }

  return content;
}

/**
 * readline 接口工厂对象
 * 用于测试时注入 mock
 */
export const readlineFactory = {
  create: () =>
    readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    }),
};

export function setReadlineFactory(fn: () => readline.Interface) {
  readlineFactory.create = fn;
}

export const initCommand: Command = {
  name: 'init',
  description: '交互式生成 agent.md 配置文件',
  usage: 'my-cli init',
  examples: ['my-cli init'],
  async execute(config: Config, flags: Record<string, unknown>, args: string[]): Promise<void> {
    const rl = readlineFactory.create();

    try {
      const nameInput = await ask(rl, '助手名称（默认 Assistant）: ');
      const name = nameInput.trim() === '' ? 'Assistant' : nameInput.trim();

      const role = await ask(rl, '角色设定（如：你是一个专注于 TypeScript 的编程助手）: ');
      const style = await ask(rl, '回答风格（如：简洁、详细、代码优先）: ');
      const notes = await ask(rl, '注意事项（可空）: ');

      const agentMdFile = getAgentMdFile();

      if (existsSync(agentMdFile)) {
        const overwrite = await ask(rl, 'agent.md 已存在，是否覆盖？(y/N): ');
        if (overwrite.toLowerCase() !== 'y') {
          console.log('已取消');
          rl.close();
          return;
        }
      }

      const dir = dirname(agentMdFile);
      mkdirSync(dir, { recursive: true });

      const content = generateAgentMdContent(name, role, style, notes);
      writeFileSync(agentMdFile, content, 'utf-8');

      console.log('✓ agent.md 已生成');
    } finally {
      rl.close();
    }
  },
};