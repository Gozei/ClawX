import { readFile, writeFile, mkdir } from 'fs/promises';
import { homedir } from 'os';
import path from 'path';
import { withConfigLock } from './config-mutex';
import { getManagedConfigPath, readOpenClawRuntimeConfig, writeOpenClawRuntimeConfig } from './openclaw-config-assembler';
import { getResourcesDir } from './paths';

export interface SkillSourceConfig {
  id: string;
  label: string;
  enabled: boolean;
  site: string;
  apiQueryEndpoint?: string;
  registry?: string;
  workdir: string;
}

interface SkillSourcesState {
  version: 1;
  updatedAt: string;
  sources: SkillSourceConfig[];
}

const SKILL_SOURCE_CONFIG_NAME = 'skill-sources.json';

function expandHome(filePath: string): string {
  if (filePath.startsWith('~/')) {
    return path.join(homedir(), filePath.slice(2));
  }
  return filePath;
}

function getSourceConfigPath(): string {
  return getManagedConfigPath(SKILL_SOURCE_CONFIG_NAME);
}

function getBundledSourceConfigPath(): string {
  return path.join(getResourcesDir(), SKILL_SOURCE_CONFIG_NAME);
}

function getSourceWorkdir(id: string): string {
  return path.join(homedir(), '.openclaw', 'skill-sources', id);
}

function normalizeUrl(url: string | undefined): string | undefined {
  const trimmed = url?.trim();
  return trimmed ? trimmed.replace(/\/+$/, '') : undefined;
}


export async function buildDefaultSkillSources(): Promise<SkillSourceConfig[]> {
  try {
    const raw = await readFile(getBundledSourceConfigPath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<SkillSourcesState>;
    if (Array.isArray(parsed.sources)) {
      const normalized = parsed.sources
        .map((source) => normalizeSource(source as SkillSourceConfig))
        .filter((source): source is SkillSourceConfig => Boolean(source));
      if (normalized.length > 0) {
        return normalized;
      }
    }
  } catch {
    // Fall through and use an empty default set.
  }
  return [];
}

function normalizeSource(input: SkillSourceConfig): SkillSourceConfig | null {
  const id = input.id.trim();
  const label = input.label.trim();
  const site = normalizeUrl(input.site);
  const apiQueryEndpoint = normalizeUrl(input.apiQueryEndpoint);
  const registry = normalizeUrl(input.registry);
  if (!id || !label || !site) return null;
  return {
    id,
    label,
    enabled: input.enabled !== false,
    site,
    ...(apiQueryEndpoint ? { apiQueryEndpoint } : {}),
    ...(registry ? { registry } : {}),
    workdir: expandHome(input.workdir.trim() || getSourceWorkdir(id)),
  };
}

export async function readSkillSourcesState(): Promise<SkillSourcesState> {
  const filePath = getSourceConfigPath();
  const defaults = await buildDefaultSkillSources();
  let sources: SkillSourceConfig[] = [];

  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as SkillSourcesState;
    if (parsed?.version === 1 && Array.isArray(parsed.sources)) {
      sources = parsed.sources.map(normalizeSource).filter((source): source is SkillSourceConfig => Boolean(source));
    }
  } catch {
    // File not found or invalid, will use defaults
  }

  // Merge logic: Prioritize the order and connection info of defaults
  // 1. Build a map of existing sources from disk for quick lookup
  const diskSourcesMap = new Map(sources.map(s => [s.id, s]));

  // 2. Start the final list with defaults in their preferred order
  const finalSources: SkillSourceConfig[] = defaults.map(def => {
    const existing = diskSourcesMap.get(def.id);
    if (existing) {
      // If exists on disk, keep user's 'enabled' and 'workdir', but force code-defined site/registry
      return {
        ...existing,
        label: def.label,
        site: def.site,
        apiQueryEndpoint: def.apiQueryEndpoint,
        registry: def.registry,
      };
    }
    return def;
  });

  // 3. Add any other custom sources found on disk that are NOT in defaults
  for (const s of sources) {
    if (!defaults.some(d => d.id === s.id)) {
      finalSources.push(s);
    }
  }

  const finalState: SkillSourcesState = {
    version: 1,
    updatedAt: new Date().toISOString(),
    sources: finalSources,
  };

  // Write back to maintain the forced order in the json file
  await writeSkillSourcesState(finalSources);
  return finalState;
}

export async function writeSkillSourcesState(sources: SkillSourceConfig[]): Promise<SkillSourcesState> {
  const normalized = sources.map(normalizeSource).filter((source): source is SkillSourceConfig => Boolean(source));
  const state: SkillSourcesState = {
    version: 1,
    updatedAt: new Date().toISOString(),
    sources: normalized,
  };
  const filePath = getSourceConfigPath();
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  await syncSkillSourceExtraDirs(normalized);
  return state;
}

export async function listSkillSources(): Promise<SkillSourceConfig[]> {
  const state = await readSkillSourcesState();
  return state.sources;
}

export async function getSkillSourceById(sourceId: string): Promise<SkillSourceConfig | undefined> {
  const sources = await listSkillSources();
  return sources.find((source) => source.id === sourceId);
}

export function inferSkillSourceFromBaseDir(baseDir: string | undefined, sources: SkillSourceConfig[]): SkillSourceConfig | undefined {
  const normalizedBaseDir = normalizeForComparison(baseDir);
  if (!normalizedBaseDir) return undefined;
  return sources.find((source) => {
    const sourceRoot = normalizeForComparison(path.join(expandHome(source.workdir), 'skills'));
    return Boolean(sourceRoot) && (normalizedBaseDir === sourceRoot || normalizedBaseDir.startsWith(`${sourceRoot}${path.sep}`));
  });
}

function normalizeForComparison(filePath: string | undefined): string | null {
  if (!filePath) return null;
  try {
    return path.normalize(expandHome(filePath));
  } catch {
    return null;
  }
}

async function syncSkillSourceExtraDirs(sources: SkillSourceConfig[]): Promise<void> {
  await withConfigLock(async () => {
    const runtimeConfig = await readOpenClawRuntimeConfig();
    const skills = (
      runtimeConfig.skills && typeof runtimeConfig.skills === 'object'
        ? { ...(runtimeConfig.skills as Record<string, unknown>) }
        : {}
    ) as Record<string, unknown>;
    const load = (
      skills.load && typeof skills.load === 'object'
        ? { ...(skills.load as Record<string, unknown>) }
        : {}
    ) as Record<string, unknown>;

    const existing = Array.isArray(load.extraDirs)
      ? (load.extraDirs as unknown[]).filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : [];
    const managedDirs = sources.map((source) => path.join(expandHome(source.workdir), 'skills'));
    const merged = Array.from(new Set([...existing, ...managedDirs]));
    load.extraDirs = merged;
    skills.load = load;
    runtimeConfig.skills = skills;
    await writeOpenClawRuntimeConfig(runtimeConfig);
  });
}
