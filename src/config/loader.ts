import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { configSchema, type Config } from './schema.js';
import { homedir } from 'node:os';
import { join } from 'node:path';

function getConfigDir(): string {
  const home = process.env.HOME ?? homedir();
  return join(home, '.config', 'my-cli');
}

function getConfigFile(): string {
  return join(getConfigDir(), 'config.json');
}

function readFileConfig(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(getConfigFile(), 'utf-8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function readEnvConfig(): Record<string, unknown> {
  const env: Record<string, unknown> = {};
  if (process.env['MY_CLI_API_KEY']) env['apiKey'] = process.env['MY_CLI_API_KEY'];
  if (process.env['MY_CLI_BASE_URL']) env['baseUrl'] = process.env['MY_CLI_BASE_URL'];
  if (process.env['MY_CLI_REGION']) env['region'] = process.env['MY_CLI_REGION'];
  if (process.env['MY_CLI_OUTPUT']) env['output'] = process.env['MY_CLI_OUTPUT'];
  return env;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const fileConfig = readFileConfig();
  const envConfig = readEnvConfig();

  const merged = { ...fileConfig, ...envConfig, ...overrides };
  return configSchema.parse(merged);
}

export async function saveConfig(partial: Partial<Config>): Promise<void> {
  const existing = readFileConfig();
  const merged = { ...existing, ...partial };
  mkdirSync(getConfigDir(), { recursive: true });
  writeFileSync(getConfigFile(), JSON.stringify(merged, null, 2), 'utf-8');
}
