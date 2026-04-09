import type { Config } from '../config/schema.js';

export function print(config: Config, data: unknown): void {
  if (config.quiet) return;
  if (config.output === 'json') {
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log(String(data));
  }
}

export function printTable(config: Config, rows: Record<string, unknown>[]): void {
  if (config.quiet) return;
  if (config.output === 'json') {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  if (rows.length === 0) {
    console.log('(无数据)');
    return;
  }
  const keys = Object.keys(rows[0]!);
  const widths = keys.map((k) =>
    Math.max(k.length, ...rows.map((r) => String(r[k] ?? '').length)),
  );
  const header = keys.map((k, i) => k.padEnd(widths[i]!)).join('  ');
  const sep = widths.map((w) => '-'.repeat(w)).join('  ');
  console.log(header);
  console.log(sep);
  for (const row of rows) {
    console.log(keys.map((k, i) => String(row[k] ?? '').padEnd(widths[i]!)).join('  '));
  }
}
