import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProviderAccount } from '../shared/providers/types';
import { getProviderDefaultModel } from './provider-registry';
import { readOpenClawConfig, writeOpenClawConfig } from './channel-config';
import { withConfigLock } from './config-mutex';
import { getOpenClawConfigDir } from './paths';
import { logger } from './logger';
import { resolveRuntimeProviderKeyForAccount, stripOwnProviderPrefix } from '../../shared/providers/runtime-key';

type AgentsModelConfig = {
  primary?: unknown;
  fallbacks?: unknown;
  [key: string]: unknown;
};

type AgentEntry = {
  id?: unknown;
  model?: unknown;
  [key: string]: unknown;
};

type RepairStats = {
  changed: boolean;
  globalModelChanged: boolean;
  agentModelFixes: number;
  sessionModelFixes: number;
};

function getConfiguredModelIds(account: ProviderAccount): string[] {
  return Array.from(new Set([
    (account.model || '').trim(),
    ...(account.metadata?.customModels ?? []).map((modelId) => modelId.trim()),
    getProviderDefaultModel(account.vendorId) || '',
  ].filter(Boolean)));
}

function getRuntimeProviderKey(account: ProviderAccount): string {
  return resolveRuntimeProviderKeyForAccount(account);
}

function buildAvailableModelRefs(
  accounts: ProviderAccount[],
): { refs: string[]; refsByAccountId: Map<string, string[]> } {
  const refs: string[] = [];
  const refsByAccountId = new Map<string, string[]>();

  for (const account of accounts) {
    if (account.enabled === false) continue;
    const providerKey = getRuntimeProviderKey(account);
    const accountRefs = getConfiguredModelIds(account).map((modelId) =>
      `${providerKey}/${stripOwnProviderPrefix(modelId, providerKey)}`);
    refsByAccountId.set(account.id, accountRefs);
    refs.push(...accountRefs);
  }

  return {
    refs: Array.from(new Set(refs)),
    refsByAccountId,
  };
}

function splitModelRef(modelRef: string | null | undefined): { provider: string; model: string } | null {
  const trimmed = (modelRef || '').trim();
  const separator = trimmed.indexOf('/');
  if (separator <= 0 || separator >= trimmed.length - 1) return null;
  return {
    provider: trimmed.slice(0, separator),
    model: trimmed.slice(separator + 1),
  };
}

function resolveModelRef(model: unknown): string | null {
  if (typeof model === 'string' && model.trim()) {
    return model.trim();
  }
  if (model && typeof model === 'object' && !Array.isArray(model)) {
    const primary = (model as AgentsModelConfig).primary;
    return typeof primary === 'string' && primary.trim() ? primary.trim() : null;
  }
  return null;
}

function normalizeModelConfig(model: unknown): AgentsModelConfig {
  return model && typeof model === 'object' && !Array.isArray(model)
    ? { ...(model as AgentsModelConfig) }
    : {};
}

function repairAgentModel(
  entry: AgentEntry,
  availableRefs: Set<string>,
  replacementRef: string | null,
  globalDefaultRef: string | null,
): boolean {
  const currentRef = resolveModelRef(entry.model);
  if (!currentRef || availableRefs.has(currentRef)) {
    return false;
  }

  if (!replacementRef || replacementRef === globalDefaultRef) {
    delete entry.model;
    return true;
  }

  entry.model = { ...normalizeModelConfig(entry.model), primary: replacementRef };
  return true;
}

function getSessionModelRef(entry: Record<string, unknown>): string | null {
  const model = typeof entry.model === 'string' ? entry.model.trim() : '';
  if (splitModelRef(model)) {
    return model;
  }

  const provider = typeof entry.modelProvider === 'string' && entry.modelProvider.trim()
    ? entry.modelProvider.trim()
    : (typeof entry.providerOverride === 'string' && entry.providerOverride.trim() ? entry.providerOverride.trim() : '');
  const modelId = model || (typeof entry.modelOverride === 'string' && entry.modelOverride.trim()
    ? entry.modelOverride.trim()
    : '');

  return provider && modelId ? `${provider}/${modelId}` : null;
}

function setSessionModelRef(entry: Record<string, unknown>, modelRef: string | null): void {
  const parsed = splitModelRef(modelRef);
  if (!parsed) {
    delete entry.modelProvider;
    delete entry.model;
    delete entry.providerOverride;
    delete entry.modelOverride;
    return;
  }

  entry.modelProvider = parsed.provider;
  entry.model = parsed.model;
  entry.providerOverride = parsed.provider;
  entry.modelOverride = parsed.model;
}

function getMutableSessionEntries(document: Record<string, unknown>): Record<string, unknown>[] {
  if (Array.isArray(document.sessions)) {
    return document.sessions.filter((entry): entry is Record<string, unknown> =>
      Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry));
  }

  return Object.entries(document)
    .filter(([sessionKey, entry]) =>
      sessionKey.startsWith('agent:')
      && Boolean(entry)
      && typeof entry === 'object'
      && !Array.isArray(entry))
    .map(([, entry]) => entry as Record<string, unknown>);
}

function getAgentIdFromSessionKey(sessionKey: string | undefined, fallbackAgentId: string): string {
  const parts = (sessionKey || '').split(':');
  return parts[0] === 'agent' && parts[1] ? parts[1] : fallbackAgentId;
}

async function repairSessionStores(
  availableRefs: Set<string>,
  agentDefaultRefs: Map<string, string | null>,
  globalFallbackRef: string | null,
): Promise<number> {
  const agentsRoot = join(getOpenClawConfigDir(), 'agents');
  let fixes = 0;
  let agentDirs: Array<{ name: string; isDirectory: () => boolean }>;

  try {
    agentDirs = await readdir(agentsRoot, { withFileTypes: true }) as Array<{ name: string; isDirectory: () => boolean }>;
  } catch {
    return 0;
  }

  for (const agentDir of agentDirs) {
    if (!agentDir.isDirectory()) continue;
    const sessionsJsonPath = join(agentsRoot, agentDir.name, 'sessions', 'sessions.json');
    let document: Record<string, unknown>;
    try {
      document = JSON.parse(await readFile(sessionsJsonPath, 'utf8')) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (!document || typeof document !== 'object' || Array.isArray(document)) continue;

    let changed = false;
    for (const entry of getMutableSessionEntries(document)) {
      const currentRef = getSessionModelRef(entry);
      if (!currentRef || availableRefs.has(currentRef)) continue;

      const sessionKey = typeof entry.key === 'string' ? entry.key : undefined;
      const agentId = getAgentIdFromSessionKey(sessionKey, agentDir.name);
      const replacementRef = agentDefaultRefs.get(agentId) ?? globalFallbackRef;
      setSessionModelRef(entry, replacementRef);
      changed = true;
      fixes += 1;
    }

    if (changed) {
      await writeFile(sessionsJsonPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
    }
  }

  return fixes;
}

export async function repairInvalidModelReferences(
  accounts: ProviderAccount[],
  defaultAccountId: string | null,
): Promise<RepairStats> {
  return withConfigLock(async () => {
    const { refs, refsByAccountId } = buildAvailableModelRefs(accounts);
    const availableRefs = new Set(refs);
    const preferredGlobalRef = (defaultAccountId ? refsByAccountId.get(defaultAccountId)?.[0] : undefined)
      || refs[0]
      || null;

    const config = await readOpenClawConfig();
    const agents = config.agents && typeof config.agents === 'object' && !Array.isArray(config.agents)
      ? { ...(config.agents as Record<string, unknown>) }
      : {};
    const defaults = agents.defaults && typeof agents.defaults === 'object' && !Array.isArray(agents.defaults)
      ? { ...(agents.defaults as Record<string, unknown>) }
      : {};
    const defaultModel = normalizeModelConfig(defaults.model);

    let changedConfig = false;
    let globalModelChanged = false;
    let agentModelFixes = 0;

    const currentGlobalRef = resolveModelRef(defaultModel);
    let globalDefaultRef = currentGlobalRef && availableRefs.has(currentGlobalRef)
      ? currentGlobalRef
      : preferredGlobalRef;

    if (currentGlobalRef !== globalDefaultRef) {
      if (globalDefaultRef) {
        defaultModel.primary = globalDefaultRef;
        defaultModel.fallbacks = Array.isArray(defaultModel.fallbacks)
          ? (defaultModel.fallbacks as unknown[]).filter((ref): ref is string =>
            typeof ref === 'string' && availableRefs.has(ref))
          : [];
        defaults.model = defaultModel;
      } else {
        delete defaults.model;
      }
      agents.defaults = defaults;
      config.agents = agents;
      changedConfig = true;
      globalModelChanged = true;
    } else if (Array.isArray(defaultModel.fallbacks)) {
      const nextFallbacks = (defaultModel.fallbacks as unknown[]).filter((ref): ref is string =>
        typeof ref === 'string' && availableRefs.has(ref));
      if (nextFallbacks.length !== defaultModel.fallbacks.length) {
        defaultModel.fallbacks = nextFallbacks;
        defaults.model = defaultModel;
        agents.defaults = defaults;
        config.agents = agents;
        changedConfig = true;
      }
    }

    const entries = Array.isArray(agents.list) ? [...(agents.list as AgentEntry[])] : [];
    const agentDefaultRefs = new Map<string, string | null>();
    for (const entry of entries) {
      const agentId = typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : null;
      if (!agentId) continue;
      const changed = repairAgentModel(entry, availableRefs, globalDefaultRef, globalDefaultRef);
      if (changed) {
        changedConfig = true;
        agentModelFixes += 1;
      }
      const effectiveRef = resolveModelRef(entry.model) || globalDefaultRef;
      agentDefaultRefs.set(agentId, effectiveRef && availableRefs.has(effectiveRef) ? effectiveRef : null);
    }

    if (entries.length > 0) {
      agents.list = entries;
      config.agents = agents;
    }

    if (changedConfig) {
      await writeOpenClawConfig(config);
    }

    const sessionModelFixes = await repairSessionStores(availableRefs, agentDefaultRefs, globalDefaultRef);
    const changed = changedConfig || sessionModelFixes > 0;
    if (changed) {
      logger.info('[model-reference-repair] Repaired invalid model references', {
        globalModelChanged,
        agentModelFixes,
        sessionModelFixes,
      });
    }

    return {
      changed,
      globalModelChanged,
      agentModelFixes,
      sessionModelFixes,
    };
  });
}
