import { z } from 'zod';

export const configSchema = z.object({
  apiKey: z.string().optional(),
  baseUrl: z.string().url().default('https://api.example.com'),
  region: z.enum(['global', 'cn']).default('global'),
  output: z.enum(['text', 'json']).default('text'),
  timeout: z.number().positive().default(300),
  quiet: z.boolean().default(false),
  verbose: z.boolean().default(false),
  dryRun: z.boolean().default(false),
  nonInteractive: z.boolean().default(false),
});

export type Config = z.infer<typeof configSchema>;
