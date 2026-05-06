import { app } from 'electron';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  normalizeModelRef,
  resolveRuntimeProviderKeyForAccount,
  splitModelRef,
  stripOwnProviderPrefix,
} from '../../shared/providers/runtime-key';
import type { ProviderAccount, ProviderProtocol } from '../shared/providers/types';
import { readOpenClawConfig, writeOpenClawConfig } from '../utils/channel-config';
import { withConfigLock } from '../utils/config-mutex';
import { logger } from '../utils/logger';
import { getOpenClawConfigDir } from '../utils/paths';

type JsonRecord = Record<string, unknown>;

export type StartupModelNamingRepairReport = {
  changed: boolean;
  providerStoreFixes: number;
  runtimeConfigFixes: number;
  sessionFixes: number;
  filesChanged: string[];
};

const PROVIDER_STORE_FILE_NAME = 'clawx-providers.json';
const SUPPORTED_PROTOCOLS = new Set<ProviderProtocol>([
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
]);

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asMutableRecord(value: unknown): JsonRecord | null {
  return isRecord(value) ? value : null;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

async function readJsonFile(filePath: string): Promise<JsonRecord | null> {
  try {
    const content = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(content) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function writeJsonFile(filePath: string, value: JsonRecord): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function normalizeStringList(values: unknown, providerKey: string): { changed: boolean; values: string[] } {
  if (!Array.isArray(values)) {
    return { changed: values !== undefined, values: [] };
  }

  const next: string[] = [];
  const seen = new Set<string>();
  let changed = false;

  for (const value of values) {
    const trimmed = readString(value);
    if (!trimmed) {
      changed = true;
      continue;
    }
    const normalized = stripOwnProviderPrefix(trimmed, providerKey);
    if (normalized !== trimmed) {
      changed = true;
    }
    if (seen.has(normalized)) {
      changed = true;
      continue;
    }
    seen.add(normalized);
    next.push(normalized);
  }

  if (next.length !== values.length) {
    changed = true;
  }
  return { changed, values: next };
}

function normalizeModelProtocolMap(value: unknown, providerKey: string): { changed: boolean; value?: Record<string, ProviderProtocol> } {
  if (value === undefined) {
    return { changed: false };
  }
  if (!isRecord(value)) {
    return { changed: true };
  }

  const next: Record<string, ProviderProtocol> = {};
  let changed = false;
  for (const [rawModelId, rawProtocol] of Object.entries(value)) {
    const modelId = stripOwnProviderPrefix(rawModelId.trim(), providerKey);
    if (!modelId || typeof rawProtocol !== 'string' || !SUPPORTED_PROTOCOLS.has(rawProtocol as ProviderProtocol)) {
      changed = true;
      continue;
    }
    if (modelId !== rawModelId) {
      changed = true;
    }
    next[modelId] = rawProtocol as ProviderProtocol;
  }

  if (Object.keys(next).length !== Object.keys(value).length) {
    changed = true;
  }
  return { changed, value: Object.keys(next).length > 0 ? next : undefined };
}

function normalizeModelUsageTagsMap(value: unknown, providerKey: string): { changed: boolean; value?: Record<string, string[]> } {
  if (value === undefined) {
    return { changed: false };
  }
  if (!isRecord(value)) {
    return { changed: true };
  }

  const next: Record<string, string[]> = {};
  let changed = false;
  for (const [rawModelId, rawTags] of Object.entries(value)) {
    const modelId = stripOwnProviderPrefix(rawModelId.trim(), providerKey);
    const tags = Array.isArray(rawTags)
      ? Array.from(new Set(rawTags.map(readString).filter((tag): tag is string => Boolean(tag))))
      : [];
    if (!modelId || tags.length === 0) {
      changed = true;
      continue;
    }
    if (modelId !== rawModelId || !Array.isArray(rawTags) || tags.length !== rawTags.length) {
      changed = true;
    }
    next[modelId] = tags;
  }

  if (Object.keys(next).length !== Object.keys(value).length) {
    changed = true;
  }
  return { changed, value: Object.keys(next).length > 0 ? next : undefined };
}

function collectRuntimeProviderKeys(runtimeConfig: JsonRecord | null): Set<string> {
  const providers = asMutableRecord(asMutableRecord(runtimeConfig?.models)?.providers);
  return new Set(providers ? Object.keys(providers).filter(Boolean) : []);
}

function resolveProviderStoreRuntimeKey(account: JsonRecord, runtimeProviderKeys: Set<string>): string {
  const metadata = asMutableRecord(account.metadata);
  const metadataKey = readString(metadata?.runtimeProviderKey);
  if (metadataKey) {
    return metadataKey;
  }

  const id = readString(account.id) || '';
  const vendorId = readString(account.vendorId) || '';
  if ((vendorId === 'custom' || vendorId === 'ollama') && runtimeProviderKeys.has(id)) {
    return id;
  }

  return resolveRuntimeProviderKeyForAccount({
    id,
    vendorId,
    authMode: readString(account.authMode),
    metadata: metadata as ProviderAccount['metadata'] | undefined,
  });
}

function repairProviderAccount(account: JsonRecord, runtimeProviderKeys: Set<string>): number {
  const providerKey = resolveProviderStoreRuntimeKey(account, runtimeProviderKeys);
  let fixes = 0;

  const metadata = asMutableRecord(account.metadata) ?? {};
  if ((account.metadata === undefined || !isRecord(account.metadata)) && Object.keys(metadata).length > 0) {
    account.metadata = metadata;
  }

  const legacyKey = resolveRuntimeProviderKeyForAccount({
    id: readString(account.id) || '',
    vendorId: readString(account.vendorId) || '',
    authMode: readString(account.authMode),
  });
  const shouldPersistRuntimeKey =
    metadata.runtimeProviderKey !== providerKey
    && (
      providerKey !== legacyKey
      || (
        (readString(account.vendorId) === 'custom' || readString(account.vendorId) === 'ollama')
        && runtimeProviderKeys.has(providerKey)
      )
    );
  if (shouldPersistRuntimeKey) {
    metadata.runtimeProviderKey = providerKey;
    account.metadata = metadata;
    fixes += 1;
  }

  const model = readString(account.model);
  if (model) {
    const normalized = stripOwnProviderPrefix(model, providerKey);
    if (normalized !== account.model) {
      account.model = normalized;
      fixes += 1;
    }
  } else if (account.model !== undefined) {
    delete account.model;
    fixes += 1;
  }

  const customModels = normalizeStringList(metadata.customModels, providerKey);
  if (customModels.changed) {
    fixes += 1;
  }
  if (customModels.values.length > 0) {
    metadata.customModels = customModels.values;
  } else if (metadata.customModels !== undefined) {
    delete metadata.customModels;
  }

  const fallbackModels = normalizeStringList(account.fallbackModels, providerKey);
  if (fallbackModels.changed) {
    fixes += 1;
  }
  if (fallbackModels.values.length > 0) {
    account.fallbackModels = fallbackModels.values;
  } else if (account.fallbackModels !== undefined) {
    delete account.fallbackModels;
  }

  const protocols = normalizeModelProtocolMap(metadata.modelProtocols, providerKey);
  if (protocols.changed) {
    fixes += 1;
  }
  if (protocols.value) {
    metadata.modelProtocols = protocols.value;
  } else if (metadata.modelProtocols !== undefined) {
    delete metadata.modelProtocols;
  }

  const usageTags = normalizeModelUsageTagsMap(metadata.modelUsageTags, providerKey);
  if (usageTags.changed) {
    fixes += 1;
  }
  if (usageTags.value) {
    metadata.modelUsageTags = usageTags.value;
  } else if (metadata.modelUsageTags !== undefined) {
    delete metadata.modelUsageTags;
  }

  return fixes;
}

async function repairProviderStore(runtimeProviderKeys: Set<string>): Promise<{ fixes: number; filePath: string | null }> {
  const filePath = join(app.getPath('userData'), PROVIDER_STORE_FILE_NAME);
  const document = await readJsonFile(filePath);
  if (!document) {
    return { fixes: 0, filePath: null };
  }

  const accounts = asMutableRecord(document.providerAccounts);
  if (!accounts) {
    return { fixes: 0, filePath: null };
  }

  let fixes = 0;
  for (const account of Object.values(accounts)) {
    if (isRecord(account)) {
      fixes += repairProviderAccount(account, runtimeProviderKeys);
    }
  }

  if (fixes > 0) {
    await writeJsonFile(filePath, document);
  }
  return { fixes, filePath: fixes > 0 ? filePath : null };
}

function repairRuntimeProviderModels(config: JsonRecord): number {
  const providers = asMutableRecord(asMutableRecord(config.models)?.providers);
  if (!providers) {
    return 0;
  }

  let fixes = 0;
  for (const [providerKey, providerConfig] of Object.entries(providers)) {
    const models = asMutableRecord(providerConfig)?.models;
    if (!Array.isArray(models)) {
      continue;
    }

    for (let index = 0; index < models.length; index += 1) {
      const entry = models[index];
      if (typeof entry === 'string') {
        const normalized = stripOwnProviderPrefix(entry, providerKey);
        if (normalized !== entry) {
          models[index] = normalized;
          fixes += 1;
        }
        continue;
      }
      if (!isRecord(entry)) {
        continue;
      }
      for (const key of ['id', 'name'] as const) {
        const value = readString(entry[key]);
        if (!value) continue;
        const normalized = stripOwnProviderPrefix(value, providerKey);
        if (normalized !== entry[key]) {
          entry[key] = normalized;
          fixes += 1;
        }
      }
    }
  }
  return fixes;
}

function repairModelConfigObject(value: unknown, knownProviderKeys: Set<string>): number {
  if (!isRecord(value)) {
    return 0;
  }

  let fixes = 0;
  const primary = readString(value.primary);
  if (primary) {
    const normalized = normalizeModelRef(primary, knownProviderKeys);
    if (normalized !== value.primary) {
      value.primary = normalized;
      fixes += 1;
    }
  }

  if (Array.isArray(value.fallbacks)) {
    const next = Array.from(new Set(value.fallbacks
      .map(readString)
      .filter((ref): ref is string => Boolean(ref))
      .map((ref) => normalizeModelRef(ref, knownProviderKeys))));
    if (JSON.stringify(next) !== JSON.stringify(value.fallbacks)) {
      value.fallbacks = next;
      fixes += 1;
    }
  }

  return fixes;
}

function repairRuntimeAgentModelRefs(config: JsonRecord, knownProviderKeys: Set<string>): number {
  const agents = asMutableRecord(config.agents);
  if (!agents) {
    return 0;
  }

  let fixes = 0;
  fixes += repairModelConfigObject(asMutableRecord(agents.defaults)?.model, knownProviderKeys);

  const list = agents.list;
  if (Array.isArray(list)) {
    for (const entry of list) {
      if (isRecord(entry)) {
        fixes += repairModelConfigObject(entry.model, knownProviderKeys);
      }
    }
  }

  return fixes;
}

async function repairRuntimeConfig(): Promise<{ fixes: number; filePath: string | null; runtimeProviderKeys: Set<string> }> {
  const filePath = join(getOpenClawConfigDir(), 'openclaw.json');
  const config = await readOpenClawConfig() as JsonRecord;
  const runtimeProviderKeys = collectRuntimeProviderKeys(config);
  const fixes = repairRuntimeProviderModels(config) + repairRuntimeAgentModelRefs(config, runtimeProviderKeys);

  if (fixes > 0) {
    await writeOpenClawConfig(config);
  }
  return { fixes, filePath: fixes > 0 ? filePath : null, runtimeProviderKeys };
}

function getSessionEntries(document: JsonRecord): JsonRecord[] {
  if (Array.isArray(document.sessions)) {
    return document.sessions.filter(isRecord);
  }

  return Object.values(document).filter(isRecord);
}

function repairSessionEntry(entry: JsonRecord, knownProviderKeys: Set<string>): number {
  let fixes = 0;
  const modelProvider = readString(entry.modelProvider) || readString(entry.providerOverride);
  const model = readString(entry.model) || readString(entry.modelOverride);

  if (model) {
    const parsedModel = splitModelRef(model);
    if (parsedModel && (!modelProvider || modelProvider === parsedModel.providerKey || knownProviderKeys.has(parsedModel.providerKey))) {
      const normalizedModelId = stripOwnProviderPrefix(parsedModel.modelId, parsedModel.providerKey);
      if (entry.modelProvider !== parsedModel.providerKey) {
        entry.modelProvider = parsedModel.providerKey;
        fixes += 1;
      }
      if (entry.model !== normalizedModelId) {
        entry.model = normalizedModelId;
        fixes += 1;
      }
      if (entry.providerOverride !== parsedModel.providerKey) {
        entry.providerOverride = parsedModel.providerKey;
        fixes += 1;
      }
      if (entry.modelOverride !== normalizedModelId) {
        entry.modelOverride = normalizedModelId;
        fixes += 1;
      }
      return fixes;
    }
  }

  if (modelProvider && model) {
    const normalizedModelId = stripOwnProviderPrefix(model, modelProvider);
    if (entry.model !== normalizedModelId) {
      entry.model = normalizedModelId;
      fixes += 1;
    }
    if (entry.modelProvider !== modelProvider) {
      entry.modelProvider = modelProvider;
      fixes += 1;
    }
    if (entry.providerOverride !== modelProvider) {
      entry.providerOverride = modelProvider;
      fixes += 1;
    }
    if (entry.modelOverride !== normalizedModelId) {
      entry.modelOverride = normalizedModelId;
      fixes += 1;
    }
  }

  return fixes;
}

async function repairSessionStores(knownProviderKeys: Set<string>): Promise<{ fixes: number; files: string[] }> {
  const agentsRoot = join(getOpenClawConfigDir(), 'agents');
  let agentDirs: Array<{ name: string; isDirectory: () => boolean }>;

  try {
    agentDirs = await readdir(agentsRoot, { withFileTypes: true }) as Array<{ name: string; isDirectory: () => boolean }>;
  } catch {
    return { fixes: 0, files: [] };
  }

  let fixes = 0;
  const files: string[] = [];
  for (const agentDir of agentDirs) {
    if (!agentDir.isDirectory()) continue;
    const filePath = join(agentsRoot, agentDir.name, 'sessions', 'sessions.json');
    const document = await readJsonFile(filePath);
    if (!document) continue;

    let fileFixes = 0;
    for (const entry of getSessionEntries(document)) {
      fileFixes += repairSessionEntry(entry, knownProviderKeys);
    }

    if (fileFixes > 0) {
      await writeJsonFile(filePath, document);
      files.push(filePath);
      fixes += fileFixes;
    }
  }

  return { fixes, files };
}

export async function runStartupModelNamingRepair(): Promise<StartupModelNamingRepairReport> {
  return withConfigLock(async () => {
    const runtimeResult = await repairRuntimeConfig();
    const providerResult = await repairProviderStore(runtimeResult.runtimeProviderKeys);
    const sessionResult = await repairSessionStores(runtimeResult.runtimeProviderKeys);
    const filesChanged = [
      runtimeResult.filePath,
      providerResult.filePath,
      ...sessionResult.files,
    ].filter((filePath): filePath is string => Boolean(filePath));

    const report = {
      changed: filesChanged.length > 0,
      providerStoreFixes: providerResult.fixes,
      runtimeConfigFixes: runtimeResult.fixes,
      sessionFixes: sessionResult.fixes,
      filesChanged,
    };

    if (report.changed) {
      logger.info('[startup-self-check] Repaired model naming references', {
        providerStoreFixes: report.providerStoreFixes,
        runtimeConfigFixes: report.runtimeConfigFixes,
        sessionFixes: report.sessionFixes,
        filesChanged: report.filesChanged,
      });
    }

    return report;
  });
}
