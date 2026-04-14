import { homedir } from 'node:os';
import { join } from 'node:path';

export const CONFIG_DIR = join(homedir(), '.config', 'my-cli');
export const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
export const CREDENTIALS_FILE = join(CONFIG_DIR, 'credentials.json');
export const SESSIONS_DIR = join(CONFIG_DIR, 'sessions');
export const AGENT_MD_FILE = join(CONFIG_DIR, 'agent.md');
export const LLM_CONFIG_FILE = join(CONFIG_DIR, 'llm-providers.json');
export const TOOLS_CONFIG_FILE = join(CONFIG_DIR, 'tools.json');
