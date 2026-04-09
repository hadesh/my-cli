export interface ParsedArgs {
  command: string[];
  flags: Record<string, unknown>;
  positional: string[];
}

export function parseArgs(argv: string[]): ParsedArgs {
  const command: string[] = [];
  const flags: Record<string, unknown> = {};
  const positional: string[] = [];

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i]!;

    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const eqIdx = key.indexOf('=');
      if (eqIdx !== -1) {
        const k = key.slice(0, eqIdx);
        const v = key.slice(eqIdx + 1);
        flags[camel(k)] = v;
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('-')) {
          flags[camel(key)] = next;
          i++;
        } else {
          flags[camel(key)] = true;
        }
      }
    } else if (arg.startsWith('-') && arg.length === 2) {
      flags[arg.slice(1)] = true;
    } else if (command.length === 0 && !arg.startsWith('-')) {
      command.push(arg);
      // 继续收集子命令词（直到遇到 flag 或参数）
      let j = i + 1;
      while (j < argv.length && !argv[j]!.startsWith('-')) {
        const next = argv[j]!;
        // 如果下一个词看起来是值（含空格或数字），停止
        if (/\s/.test(next)) break;
        command.push(next);
        j++;
      }
      i = j - 1;
    } else {
      positional.push(arg);
    }

    i++;
  }

  return { command, flags, positional };
}

function camel(s: string): string {
  return s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}
