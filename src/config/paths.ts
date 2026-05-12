import { homedir } from 'node:os';
import { join } from 'node:path';

export function getConfigDir(): string {
  if (process.env.MY_CLI_CONFIG_DIR) {
    return process.env.MY_CLI_CONFIG_DIR;
  }
  const home = process.env.HOME ?? homedir();
  return join(home, '.config', 'my-cli');
}

export function getSessionsDir(): string {
  return join(getConfigDir(), 'sessions');
}

export function getLLMConfigFile(): string {
  return join(getConfigDir(), 'llm-providers.json');
}

export function getMCPServersFile(): string {
  return join(getConfigDir(), 'mcp-servers.json');
}

export function getAgentMdFile(): string {
  return join(getConfigDir(), 'agent.md');
}
