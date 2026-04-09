import type { Config } from './config/schema.js';

export interface OptionDef {
  name: string;
  short?: string;
  description: string;
  type: 'string' | 'boolean' | 'number';
  default?: unknown;
}

export interface Command {
  name: string;
  description: string;
  usage?: string;
  options?: OptionDef[];
  examples?: string[];
  execute(config: Config, flags: Record<string, unknown>, args: string[]): Promise<void>;
}
