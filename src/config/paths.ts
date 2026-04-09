import { homedir } from 'node:os';
import { join } from 'node:path';

export const CONFIG_DIR = join(homedir(), '.config', 'my-cli');
export const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
export const CREDENTIALS_FILE = join(CONFIG_DIR, 'credentials.json');
