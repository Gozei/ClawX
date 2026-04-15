import { access, copyFile, mkdir, readFile, rename, rm, writeFile } from 'fs/promises';
import { constants } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { withConfigLock } from './config-mutex';

const OPENCLAW_DIR = join(homedir(), '.openclaw');
const OPENCLAW_CONFIG_PATH = join(OPENCLAW_DIR, 'openclaw.json');
const MANAGED_CONFIG_DIR = join(OPENCLAW_DIR, 'deep-ai-worker', 'config');
const MANAGED_BACKUP_DIR = join(OPENCLAW_DIR, 'deep-ai-worker', 'backups');

export type OpenClawConfigRecord = Record<string, unknown>;

export type ManagedSkillsState = {
  version: 1;
  updatedAt: string;
  entries: Record<string, {
    enabled?: boolean;
    apiKey?: string;
    env?: Record<string, string>;
  }>;
};

export type ManagedProvidersState = {
  version: 1;
  updatedAt: string;
  providers: Record<string, Record<string, unknown>>;
  defaultModel?: string;
  defaultFallbacks?: string[];
};

const VALID_COMPACTION_MODES = new Set(['default', 'safeguard']);

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function ensureParentDir(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
}

async function readJsonObject<T extends object>(filePath: string): Promise<T | null> {
  try {
    if (!(await fileExists(filePath))) {
      return null;
    }
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as T : null;
  } catch {
    return null;
  }
}

async function atomicWriteJson(filePath: string, data: unknown, backupCurrent = false): Promise<void> {
  await ensureParentDir(filePath);

  if (backupCurrent && await fileExists(filePath)) {
    const backupPath = join(MANAGED_BACKUP_DIR, `${filePath.endsWith('openclaw.json') ? 'openclaw' : 'config'}.json.bak`);
    await ensureParentDir(backupPath);
    await copyFile(filePath, backupPath);
  }

  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8');

  if (process.platform === 'win32' && await fileExists(filePath)) {
    await rm(filePath, { force: true });
  }

  await rename(tmpPath, filePath);
}

function normalizeAgentsDefaultsCompactionMode(config: OpenClawConfigRecord): void {
  const agents = (config.agents && typeof config.agents === 'object'
    ? config.agents as Record<string, unknown>
    : null);
  if (!agents) return;

  const defaults = (agents.defaults && typeof agents.defaults === 'object'
    ? agents.defaults as Record<string, unknown>
    : null);
  if (!defaults) return;

  const compaction = (defaults.compaction && typeof defaults.compaction === 'object'
    ? defaults.compaction as Record<string, unknown>
    : null);
  if (!compaction) return;

  const mode = compaction.mode;
  if (typeof mode === 'string' && mode.length > 0 && !VALID_COMPACTION_MODES.has(mode)) {
    compaction.mode = 'default';
  }
}

export function applyOpenClawRuntimeDefaults(config: OpenClawConfigRecord): OpenClawConfigRecord {
  const nextConfig = { ...config };
  normalizeAgentsDefaultsCompactionMode(nextConfig);

  const commands = (
    nextConfig.commands && typeof nextConfig.commands === 'object'
      ? { ...(nextConfig.commands as Record<string, unknown>) }
      : {}
  ) as Record<string, unknown>;
  commands.restart = true;
  nextConfig.commands = commands;

  return nextConfig;
}

export async function readOpenClawRuntimeConfig(): Promise<OpenClawConfigRecord> {
  const config = await readJsonObject<OpenClawConfigRecord>(OPENCLAW_CONFIG_PATH);
  return config ?? {};
}

export async function writeOpenClawRuntimeConfig(config: OpenClawConfigRecord): Promise<void> {
  await atomicWriteJson(OPENCLAW_CONFIG_PATH, applyOpenClawRuntimeDefaults(config), true);
}

export function getManagedConfigPath(name: string): string {
  return join(MANAGED_CONFIG_DIR, name);
}

export async function readManagedSkillsState(): Promise<ManagedSkillsState> {
  const managed = await readJsonObject<ManagedSkillsState>(getManagedConfigPath('skills.json'));
  if (managed?.entries && typeof managed.entries === 'object') {
    return managed;
  }

  const runtimeConfig = await readOpenClawRuntimeConfig();
  const runtimeEntries = (
    (runtimeConfig.skills as Record<string, unknown> | undefined)?.entries as Record<string, ManagedSkillsState['entries'][string]> | undefined
  ) ?? {};

  const seededState: ManagedSkillsState = {
    version: 1,
    updatedAt: new Date(0).toISOString(),
    entries: runtimeEntries,
  };
  await atomicWriteJson(getManagedConfigPath('skills.json'), seededState);
  return seededState;
}

export async function readManagedProvidersState(): Promise<ManagedProvidersState> {
  const managed = await readJsonObject<ManagedProvidersState>(getManagedConfigPath('providers.json'));
  if (managed?.providers && typeof managed.providers === 'object') {
    return managed;
  }

  const runtimeConfig = await readOpenClawRuntimeConfig();
  const models = runtimeConfig.models as Record<string, unknown> | undefined;
  const providers =
    models?.providers && typeof models.providers === 'object'
      ? (models.providers as Record<string, Record<string, unknown>>)
      : {};

  const agents = runtimeConfig.agents as Record<string, unknown> | undefined;
  const defaults =
    agents?.defaults && typeof agents.defaults === 'object'
      ? (agents.defaults as Record<string, unknown>)
      : undefined;
  const modelConfig =
    defaults?.model && typeof defaults.model === 'object'
      ? (defaults.model as Record<string, unknown>)
      : undefined;

  const seededState: ManagedProvidersState = {
    version: 1,
    updatedAt: new Date(0).toISOString(),
    providers,
    defaultModel: typeof modelConfig?.primary === 'string' ? modelConfig.primary : undefined,
    defaultFallbacks: Array.isArray(modelConfig?.fallbacks)
      ? (modelConfig?.fallbacks as string[]).filter((value): value is string => typeof value === 'string')
      : [],
  };
  await atomicWriteJson(getManagedConfigPath('providers.json'), seededState);
  return seededState;
}

export async function writeManagedSkillsState(
  entries: ManagedSkillsState['entries'],
): Promise<ManagedSkillsState> {
  const state: ManagedSkillsState = {
    version: 1,
    updatedAt: new Date().toISOString(),
    entries,
  };
  await atomicWriteJson(getManagedConfigPath('skills.json'), state);
  return state;
}

export async function writeManagedProvidersState(
  providers: ManagedProvidersState['providers'],
  options?: {
    defaultModel?: string;
    defaultFallbacks?: string[];
  },
): Promise<ManagedProvidersState> {
  const state: ManagedProvidersState = {
    version: 1,
    updatedAt: new Date().toISOString(),
    providers,
    defaultModel: options?.defaultModel,
    defaultFallbacks: options?.defaultFallbacks ?? [],
  };
  await atomicWriteJson(getManagedConfigPath('providers.json'), state);
  return state;
}

export function applyManagedProvidersToRuntimeConfig(
  runtimeConfig: OpenClawConfigRecord,
  managedState: ManagedProvidersState,
): OpenClawConfigRecord {
  const nextRuntimeConfig: OpenClawConfigRecord = { ...runtimeConfig };

  const models = (
    nextRuntimeConfig.models && typeof nextRuntimeConfig.models === 'object'
      ? { ...(nextRuntimeConfig.models as Record<string, unknown>) }
      : {}
  ) as Record<string, unknown>;
  models.providers = managedState.providers;
  nextRuntimeConfig.models = models;

  const agents = (
    nextRuntimeConfig.agents && typeof nextRuntimeConfig.agents === 'object'
      ? { ...(nextRuntimeConfig.agents as Record<string, unknown>) }
      : {}
  ) as Record<string, unknown>;
  const defaults = (
    agents.defaults && typeof agents.defaults === 'object'
      ? { ...(agents.defaults as Record<string, unknown>) }
      : {}
  ) as Record<string, unknown>;

  if (managedState.defaultModel) {
    defaults.model = {
      primary: managedState.defaultModel,
      fallbacks: managedState.defaultFallbacks ?? [],
    };
  } else if ('model' in defaults) {
    delete defaults.model;
  }

  agents.defaults = defaults;
  nextRuntimeConfig.agents = agents;

  return nextRuntimeConfig;
}

export async function syncManagedSkillsToOpenClawConfig(
  managedState: ManagedSkillsState,
): Promise<void> {
  await withConfigLock(async () => {
    const runtimeConfig = await readOpenClawRuntimeConfig();
    const currentSkills = (
      runtimeConfig.skills && typeof runtimeConfig.skills === 'object' && !Array.isArray(runtimeConfig.skills)
        ? { ...(runtimeConfig.skills as Record<string, unknown>) }
        : {}
    );

    currentSkills.entries = managedState.entries;
    runtimeConfig.skills = currentSkills;

    await writeOpenClawRuntimeConfig(runtimeConfig);
  });
}
