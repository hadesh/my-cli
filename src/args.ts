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
