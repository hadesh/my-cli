export interface ParsedArgs {
  command: string[];
  flags: Record<string, unknown>;
  positional: string[];
}

export function parseArgs(argv: string[]): ParsedArgs {
  // 需要聚合为数组的 flag 名称（经过 camel 转换后）
  const ARRAY_FLAGS = new Set(['file']);

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
        const k = camel(key.slice(0, eqIdx));
        const v = key.slice(eqIdx + 1);
        if (ARRAY_FLAGS.has(k)) {
          const existing = flags[k];
          flags[k] = Array.isArray(existing) ? [...(existing as string[]), v] : [v];
        } else {
          flags[k] = v;
        }
      } else {
        const k = camel(key);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('-')) {
          if (ARRAY_FLAGS.has(k)) {
            const existing = flags[k];
            flags[k] = Array.isArray(existing) ? [...(existing as string[]), next] : [next];
          } else {
            flags[k] = next;
          }
          i++;
        } else {
          flags[k] = true;
        }
      }
    } else if (arg.startsWith('-') && arg.length === 2) {
      flags[arg.slice(1)] = true;
    } else if (command.length === 0 && !arg.startsWith('-')) {
      command.push(arg);
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
