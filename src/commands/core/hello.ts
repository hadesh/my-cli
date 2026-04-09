import type { Command } from '../../command.js';
import type { Config } from '../../config/schema.js';
import { print } from '../../output/text.js';

export const helloCommand: Command = {
  name: 'hello',
  description: '打招呼，验证 CLI 能正常运行',
  usage: 'my-cli hello [--name <名字>]',
  options: [
    {
      name: 'name',
      short: 'n',
      description: '要打招呼的名字',
      type: 'string',
      default: 'World',
    },
  ],
  examples: ['my-cli hello', 'my-cli hello --name Alice'],
  async execute(config: Config, flags: Record<string, unknown>) {
    const name = (flags['name'] as string | undefined) ?? 'World';
    print(config, `Hello, ${name}!`);
  },
};
