import type { Command } from './command.js';
import { UsageError } from './errors/base.js';

interface CommandNode {
  command?: Command;
  children: Map<string, CommandNode>;
}

export class Registry {
  private root: CommandNode = { children: new Map() };

  register(command: Command): void {
    const parts = command.name.split(' ');
    let node = this.root;
    for (const part of parts) {
      if (!node.children.has(part)) {
        node.children.set(part, { children: new Map() });
      }
      node = node.children.get(part)!;
    }
    node.command = command;
  }

  resolve(parts: string[]): { command: Command; remaining: string[] } | null {
    let node = this.root;
    let matched = 0;
    for (let i = 0; i < parts.length; i++) {
      const child = node.children.get(parts[i]!);
      if (!child) break;
      node = child;
      matched = i + 1;
    }
    if (!node.command) return null;
    return { command: node.command, remaining: parts.slice(matched) };
  }

  allCommands(): Command[] {
    const result: Command[] = [];
    const walk = (node: CommandNode) => {
      if (node.command) result.push(node.command);
      for (const child of node.children.values()) walk(child);
    };
    walk(this.root);
    return result;
  }

  printHelp(commandPath?: string[]): void {
    if (commandPath && commandPath.length > 0) {
      const match = this.resolve(commandPath);
      if (!match) throw new UsageError(`未知命令: ${commandPath.join(' ')}`);
      printCommandHelp(match.command);
      return;
    }

    const commands = this.allCommands();
    console.log('用法: my-cli <命令> [选项]\n');
    console.log('可用命令:');
    const maxLen = Math.max(...commands.map((c) => c.name.length));
    for (const cmd of commands) {
      console.log(`  ${cmd.name.padEnd(maxLen + 2)}${cmd.description}`);
    }
    console.log('\n运行 `my-cli help <命令>` 查看具体用法。');
  }
}

function printCommandHelp(cmd: Command): void {
  console.log(`${cmd.name} — ${cmd.description}\n`);
  if (cmd.usage) console.log(`用法: ${cmd.usage}\n`);
  if (cmd.options?.length) {
    console.log('选项:');
    for (const opt of cmd.options) {
      const short = opt.short ? `-${opt.short}, ` : '    ';
      const def = opt.default !== undefined ? ` (默认: ${opt.default})` : '';
      console.log(`  ${short}--${opt.name.padEnd(16)}${opt.description}${def}`);
    }
    console.log();
  }
  if (cmd.examples?.length) {
    console.log('示例:');
    for (const ex of cmd.examples) console.log(`  ${ex}`);
  }
}
