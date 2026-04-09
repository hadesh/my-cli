import type { Config } from '../config/schema.js';
import { print } from './text.js';

export function success(config: Config, message: string): void {
  print(config, `✓ ${message}`);
}

export function warn(config: Config, message: string): void {
  if (!config.quiet) console.warn(`⚠ ${message}`);
}

export function info(config: Config, message: string): void {
  if (!config.quiet && config.verbose) console.log(`ℹ ${message}`);
}
