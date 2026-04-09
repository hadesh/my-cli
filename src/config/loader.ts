import { readFileSync } from 'node:fs';
import { configSchema, type Config } from './schema.js';
import { CONFIG_FILE } from './paths.js';

function readFileConfig(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8')) as Record<string, unknown>;
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
