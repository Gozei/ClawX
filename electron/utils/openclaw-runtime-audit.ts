import { logger } from './logger';
import {
  readManagedProvidersState,
  readManagedSkillsState,
  readOpenClawRuntimeConfig,
  writeOpenClawRuntimeConfig,
  type OpenClawConfigRecord,
} from './openclaw-config-assembler';

type RuntimeProviderEntry = {
  baseUrl?: string;
  api?: string;
  models?: Array<{ id?: string; name?: string }>;
};

type ProviderFamily = 'qwen' | 'glm' | 'deepseek' | 'openai' | 'claude' | 'gemini' | 'unknown';

function parseModelRef(modelRef: string): { providerKey: string; modelId: string } | null {
  const trimmed = modelRef.trim();
  const separatorIndex = trimmed.indexOf('/');
  if (separatorIndex <= 0 || separatorIndex >= trimmed.length - 1) {
    return null;
  }

  return {
    providerKey: trimmed.slice(0, separatorIndex),
    modelId: trimmed.slice(separatorIndex + 1),
  };
}

function inferProviderFamilyFromModelId(modelId: string): ProviderFamily {
  const normalized = modelId.trim().toLowerCase();
  if (!normalized) return 'unknown';
  if (normalized.startsWith('qwen')) return 'qwen';
  if (normalized.startsWith('glm')) return 'glm';
  if (normalized.startsWith('deepseek')) return 'deepseek';
  if (normalized.startsWith('gpt')) return 'openai';
  if (normalized.startsWith('claude')) return 'claude';
  if (normalized.startsWith('gemini')) return 'gemini';
  return 'unknown';
}

function inferProviderFamilyFromRuntimeEntry(providerKey: string, entry: RuntimeProviderEntry): ProviderFamily {
  const normalizedKey = providerKey.toLowerCase();
  const baseUrl = (entry.baseUrl || '').toLowerCase();
  const firstModelId = entry.models?.find((model) => typeof model?.id === 'string')?.id || '';

  if (baseUrl.includes('dashscope.aliyuncs.com') || normalizedKey.includes('qwen')) return 'qwen';
  if (baseUrl.includes('open.bigmodel.cn') || normalizedKey.includes('zai') || firstModelId.startsWith('glm')) return 'glm';
  if (baseUrl.includes('deepseek.com') || normalizedKey.includes('deepseek') || firstModelId.startsWith('deepseek')) return 'deepseek';
  if (baseUrl.includes('api.openai.com') || normalizedKey.includes('openai') || firstModelId.startsWith('gpt')) return 'openai';
  if (baseUrl.includes('anthropic.com') || normalizedKey.includes('claude') || firstModelId.startsWith('claude')) return 'claude';
  if (baseUrl.includes('googleapis.com') || normalizedKey.includes('gemini') || firstModelId.startsWith('gemini')) return 'gemini';
  return inferProviderFamilyFromModelId(firstModelId);
}

function reconcileModelRef(
  modelRef: string,
  providers: Record<string, RuntimeProviderEntry>,
  preferredProviderKey?: string,
): string {
  const parsed = parseModelRef(modelRef);
  if (!parsed) {
    return modelRef;
  }

  if (providers[parsed.providerKey]) {
    return modelRef;
  }

  const family = inferProviderFamilyFromModelId(parsed.modelId);
  if (family === 'unknown') {
    return modelRef;
  }

  const candidates = Object.entries(providers)
    .filter(([providerKey, entry]) => inferProviderFamilyFromRuntimeEntry(providerKey, entry) === family)
    .map(([providerKey]) => providerKey);

  if (candidates.length === 0) {
    return modelRef;
  }

  const nextProviderKey = preferredProviderKey && candidates.includes(preferredProviderKey)
    ? preferredProviderKey
    : candidates.length === 1
      ? candidates[0]
      : null;

  if (!nextProviderKey || nextProviderKey === parsed.providerKey) {
    return modelRef;
  }

  return `${nextProviderKey}/${parsed.modelId}`;
}

export function repairRuntimeAgentModelReferences(
  config: OpenClawConfigRecord,
): { config: OpenClawConfigRecord; changed: boolean; repairedAgents: string[] } {
  const nextConfig: OpenClawConfigRecord = structuredClone(config);
  const models = (nextConfig.models && typeof nextConfig.models === 'object'
    ? nextConfig.models as Record<string, unknown>
    : {}) as Record<string, unknown>;
  const providers = (models.providers && typeof models.providers === 'object'
    ? models.providers as Record<string, RuntimeProviderEntry>
    : {}) as Record<string, RuntimeProviderEntry>;

  const agentsRoot = (nextConfig.agents && typeof nextConfig.agents === 'object'
    ? nextConfig.agents as Record<string, unknown>
    : {}) as Record<string, unknown>;
  const defaults = (agentsRoot.defaults && typeof agentsRoot.defaults === 'object'
    ? agentsRoot.defaults as Record<string, unknown>
    : {}) as Record<string, unknown>;
  const defaultModel = (defaults.model && typeof defaults.model === 'object'
    ? defaults.model as Record<string, unknown>
    : null);
  const preferredDefaultProviderKey = typeof defaultModel?.primary === 'string'
    ? parseModelRef(defaultModel.primary)?.providerKey
    : undefined;

  let changed = false;
  const repairedAgents: string[] = [];

  if (defaultModel && typeof defaultModel.primary === 'string') {
    const nextPrimary = reconcileModelRef(defaultModel.primary, providers, preferredDefaultProviderKey);
    if (nextPrimary !== defaultModel.primary) {
      defaultModel.primary = nextPrimary;
      changed = true;
    }
  }

  const entries = Array.isArray(agentsRoot.list) ? agentsRoot.list as Array<Record<string, unknown>> : [];
  for (const entry of entries) {
    const model = (entry.model && typeof entry.model === 'object'
      ? entry.model as Record<string, unknown>
      : null);
    if (!model || typeof model.primary !== 'string') {
      continue;
    }

    const nextPrimary = reconcileModelRef(model.primary, providers, preferredDefaultProviderKey);
    if (nextPrimary !== model.primary) {
      model.primary = nextPrimary;
      changed = true;
      repairedAgents.push(typeof entry.id === 'string' ? entry.id : '(unknown)');
    }
  }

  return { config: nextConfig, changed, repairedAgents };
}

export async function auditAndRepairOpenClawRuntimeConfig(): Promise<void> {
  await readManagedProvidersState();
  await readManagedSkillsState();

  const runtimeConfig = await readOpenClawRuntimeConfig();
  const repaired = repairRuntimeAgentModelReferences(runtimeConfig);
  if (!repaired.changed) {
    return;
  }

  await writeOpenClawRuntimeConfig(repaired.config);
  logger.info('[openclaw-audit] Repaired stale agent model provider references', {
    repairedAgents: repaired.repairedAgents,
  });
}
