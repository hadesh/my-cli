import { parseArgs } from './args.js';
import { loadConfig } from './config/loader.js';
import type { Config } from './config/schema.js';
import { handleError } from './errors/handler.js';
import { UsageError } from './errors/base.js';
import { Registry } from './registry.js';
import { helloCommand } from './commands/core/hello.js';
import { weatherCommand } from './commands/core/weather.js';
import { sessionCommand } from './commands/session.js';
import { llmCommand } from './commands/llm.js';
import { initCommand } from './commands/init.js';
import { askCommand } from './commands/ask.js';

const VERSION = '0.1.0';

const registry = new Registry();
registry.register(helloCommand);
registry.register(weatherCommand);
registry.register(sessionCommand);
registry.register(llmCommand);
registry.register(initCommand);
registry.register(askCommand);

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv[0] === 'help') {
    const topic = argv.slice(1);
    registry.printHelp(topic.length > 0 ? topic : undefined);
    return;
  }

  if (argv[0] === '--version' || argv[0] === '-v') {
    console.log(VERSION);
    return;
  }

  const parsed = parseArgs(argv);

  const configOverrides: Partial<Config> = {};
  if (typeof parsed.flags['output'] === 'string') {
    const v = parsed.flags['output'];
    if (v === 'text' || v === 'json') configOverrides.output = v;
  }
  if (parsed.flags['quiet'] === true) configOverrides.quiet = true;
  if (parsed.flags['verbose'] === true) configOverrides.verbose = true;
  if (parsed.flags['dry-run'] === true || parsed.flags['dryRun'] === true) {
    configOverrides.dryRun = true;
  }

  const config = loadConfig(configOverrides);

  if (parsed.flags['help'] === true || parsed.flags['h'] === true) {
    registry.printHelp(parsed.command);
    return;
  }

  const match = registry.resolve(parsed.command);
  if (!match) {
    throw new UsageError(
      `未知命令: ${parsed.command.join(' ')}\n\n运行 \`my-cli help\` 查看所有命令。`,
    );
  }

  await match.command.execute(config, parsed.flags, [...match.remaining, ...parsed.positional]);
}

main().catch(handleError);
