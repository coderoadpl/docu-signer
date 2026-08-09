import { randomUUID } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, parse, resolve } from 'node:path';

import { z } from 'zod';

import { DEFAULT_DEV_PORT } from '#core/contract/index.js';

export const DEFAULT_DEV_API_URL = `http://default.localhost:${String(DEFAULT_DEV_PORT)}`;

const profileSchema = z
  .object({
    token: z.string().nullable(),
  })
  .strict();

const canonicalOriginSchema = z
  .url()
  .refine(
    (value) => URL.canParse(value) && new URL(value).origin === value,
    'must be a canonical URL origin',
  );

export const cliConfigSchema = z
  .object({
    version: z.literal(3),
    currentOrigin: canonicalOriginSchema,
    profiles: z.record(canonicalOriginSchema, profileSchema),
  })
  .strict();

const legacyConfigSchema = z
  .object({
    apiUrl: z.unknown().optional(),
    token: z.string().nullable().default(null),
    tenant: z.string().nullable().default(null),
  })
  .strict();

const packageMarkerSchema = z.object({ name: z.string() });
const recordSchema = z.record(z.string(), z.unknown());

export type CliConfig = z.output<typeof cliConfigSchema>;
export type CliProfile = z.output<typeof profileSchema>;
export type CliOriginSource = 'flag' | 'env' | 'repo' | 'stored';

interface CliEnv {
  APP_CLI_API_URL?: string | undefined;
}

export interface ResolveCliConfigInput {
  config: CliConfig;
  cwd: string;
  env: CliEnv;
  apiUrl?: string;
}

export interface ResolvedCliConfig {
  apiUrl: string;
  origin: string;
  originSource: CliOriginSource;
  profile: CliProfile;
}

const configDirectory = z
  .string()
  .trim()
  .min(1)
  .optional()
  .parse(process.env['PODPISY_CLI_CONFIG_DIR']);
const configFile = join(
  configDirectory ?? join(homedir(), '.config', 'agentproofarch'),
  'config.json',
);

const emptyConfig = (): CliConfig => ({
  version: 3,
  currentOrigin: DEFAULT_DEV_API_URL,
  profiles: {},
});

export const apiOrigin = (apiUrl: string): string => new URL(apiUrl).origin;

const atomicWriteConfig = (config: CliConfig): void => {
  const configDir = dirname(configFile);
  mkdirSync(configDir, { recursive: true });
  const tempFile = join(configDir, `.config.json.${String(process.pid)}.${randomUUID()}.tmp`);
  try {
    writeFileSync(tempFile, `${JSON.stringify(config, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    renameSync(tempFile, configFile);
  } catch (error) {
    rmSync(tempFile, { force: true });
    throw error;
  }
};

const legacyOrigin = (apiUrl: unknown): string => {
  const parsed = z.url().safeParse(apiUrl);
  return parsed.success ? apiOrigin(parsed.data) : DEFAULT_DEV_API_URL;
};

const migrateLegacyConfig = (legacy: z.output<typeof legacyConfigSchema>): CliConfig => {
  const origin = legacyOrigin(legacy.apiUrl);
  const migrated = cliConfigSchema.parse({
    version: 3,
    currentOrigin: origin,
    profiles: {
      [origin]: {
        token: legacy.token,
      },
    },
  });
  atomicWriteConfig(migrated);
  console.error(
    `podpisy: migrated ${configFile} to per-origin profiles (${origin})`,
  );
  return migrated;
};

export const loadConfig = (): CliConfig => {
  let text: string;
  try {
    text = readFileSync(configFile, 'utf8');
  } catch (error) {
    const parsed = z.object({ code: z.string().optional() }).safeParse(error);
    if (parsed.success && parsed.data.code === 'ENOENT') return emptyConfig();
    throw new Error(
      `podpisy: could not read ${configFile}: ${String(error)}`,
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `podpisy: invalid ${configFile}: malformed JSON (${String(error)})`,
    );
  }

  const current = cliConfigSchema.safeParse(raw);
  if (current.success) return current.data;

  const record = recordSchema.safeParse(raw);
  if (record.success && Object.hasOwn(record.data, 'version')) {
    if (record.data['version'] !== 3) return emptyConfig();
    throw new Error(
      `podpisy: invalid ${configFile}: ${current.error.issues
        .map((issue) => issue.message)
        .join('; ')}`,
    );
  }
  if (record.success && Object.hasOwn(record.data, 'profiles')) return emptyConfig();

  const legacy = legacyConfigSchema.safeParse(raw);
  if (legacy.success) return migrateLegacyConfig(legacy.data);

  throw new Error(
    `podpisy: invalid ${configFile}: ${current.error.issues
      .map((issue) => issue.message)
      .join('; ')}`,
  );
};

export const saveConfig = (config: CliConfig): void => {
  atomicWriteConfig(cliConfigSchema.parse(config));
};

const isPodpisyRepo = (cwd: string): boolean => {
  let directory = resolve(cwd);
  const root = parse(directory).root;
  while (true) {
    try {
      const marker: unknown = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
      const parsed = packageMarkerSchema.safeParse(marker);
      if (parsed.success && parsed.data.name === 'podpisy') return true;
    } catch {}
    if (directory === root) return false;
    directory = dirname(directory);
  }
};

export const resolveCliConfig = (input: ResolveCliConfigInput): ResolvedCliConfig => {
  const apiSelection =
    input.apiUrl !== undefined
      ? { apiUrl: input.apiUrl, originSource: 'flag' as const }
      : input.env.APP_CLI_API_URL !== undefined
        ? { apiUrl: input.env.APP_CLI_API_URL, originSource: 'env' as const }
        : isPodpisyRepo(input.cwd)
          ? { apiUrl: DEFAULT_DEV_API_URL, originSource: 'repo' as const }
          : { apiUrl: input.config.currentOrigin, originSource: 'stored' as const };
  const origin = apiOrigin(apiSelection.apiUrl);
  const profile = input.config.profiles[origin] ?? { token: null };
  return { ...apiSelection, origin, profile };
};

export const updateOriginProfile = (
  config: CliConfig,
  origin: string,
  patch: Partial<CliProfile>,
  setCurrent: boolean,
): CliConfig => {
  const profile = config.profiles[origin] ?? { token: null };
  return cliConfigSchema.parse({
    ...config,
    currentOrigin: setCurrent ? origin : config.currentOrigin,
    profiles: {
      ...config.profiles,
      [origin]: { ...profile, ...patch },
    },
  });
};
