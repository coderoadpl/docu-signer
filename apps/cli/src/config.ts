import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';

const cliConfigSchema = z.object({
  apiUrl: z.string().default('http://localhost:47100'),
  token: z.string().nullable().default(null),
  tenant: z.string().nullable().default(null),
});

export type CliConfig = z.output<typeof cliConfigSchema>;

const configDir = join(homedir(), '.config', 'agentproofarch');
const configFile = join(configDir, 'config.json');

export const loadConfig = (): CliConfig => {
  try {
    const raw: unknown = JSON.parse(readFileSync(configFile, 'utf8'));
    const parsed = cliConfigSchema.safeParse(raw);
    if (parsed.success) return parsed.data;
  } catch {
    // first run: no config yet
  }
  return cliConfigSchema.parse({});
};

export const saveConfig = (config: CliConfig): void => {
  mkdirSync(configDir, { recursive: true });
  writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);
  chmodSync(configFile, 0o600);
};
