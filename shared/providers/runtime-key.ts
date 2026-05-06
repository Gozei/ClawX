export const GOOGLE_OAUTH_RUNTIME_PROVIDER = 'google-gemini-cli';
export const OPENAI_OAUTH_RUNTIME_PROVIDER = 'openai-codex';

const MULTI_INSTANCE_PROVIDER_TYPES = new Set(['custom', 'ollama']);

const PROVIDER_KEY_ALIASES: Record<string, string> = {
  'minimax-portal-cn': 'minimax-portal',
};

type ProviderAccountLike = {
  id: string;
  vendorId: string;
  authMode?: string;
  metadata?: {
    runtimeProviderKey?: string;
  } | null;
};

type ProviderConfigLike = {
  id: string;
  type: string;
  metadata?: {
    runtimeProviderKey?: string;
  } | null;
};

function normalizeRuntimeProviderKey(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function getOpenClawProviderKeyForProvider(type: string, providerId: string): string {
  if (MULTI_INSTANCE_PROVIDER_TYPES.has(type)) {
    if (providerId && !providerId.startsWith(`${type}-`) && !providerId.includes('-')) {
      return providerId;
    }
    const prefix = `${type}-`;
    if (providerId.startsWith(prefix)) {
      const tail = providerId.slice(prefix.length);
      if (tail.length === 8 && !tail.includes('-')) {
        return providerId;
      }
    }
    const suffix = providerId.replace(/-/g, '').slice(0, 8);
    return `${type}-${suffix}`;
  }

  return PROVIDER_KEY_ALIASES[type] ?? type;
}

export function resolveRuntimeProviderKeyForAccount(account: ProviderAccountLike): string {
  const metadataKey = normalizeRuntimeProviderKey(account.metadata?.runtimeProviderKey);
  if (metadataKey) return metadataKey;

  if (account.authMode === 'oauth_browser') {
    if (account.vendorId === 'google') return GOOGLE_OAUTH_RUNTIME_PROVIDER;
    if (account.vendorId === 'openai') return OPENAI_OAUTH_RUNTIME_PROVIDER;
  }

  return getOpenClawProviderKeyForProvider(account.vendorId, account.id);
}

export function resolveRuntimeProviderKeyForConfig(
  config: ProviderConfigLike,
  account?: ProviderAccountLike | null,
): string {
  if (account) {
    return resolveRuntimeProviderKeyForAccount(account);
  }
  const metadataKey = normalizeRuntimeProviderKey(config.metadata?.runtimeProviderKey);
  if (metadataKey) return metadataKey;
  return getOpenClawProviderKeyForProvider(config.type, config.id);
}

export function splitModelRef(modelRef: string | null | undefined): { providerKey: string; modelId: string } | null {
  const trimmed = (modelRef || '').trim();
  const separatorIndex = trimmed.indexOf('/');
  if (separatorIndex <= 0 || separatorIndex >= trimmed.length - 1) return null;
  return {
    providerKey: trimmed.slice(0, separatorIndex),
    modelId: trimmed.slice(separatorIndex + 1),
  };
}

export function stripOwnProviderPrefix(modelId: string, providerKey: string): string {
  const normalizedModel = modelId.trim();
  const normalizedProvider = providerKey.trim();
  if (!normalizedModel || !normalizedProvider) return normalizedModel;
  return normalizedModel.startsWith(`${normalizedProvider}/`)
    ? normalizedModel.slice(normalizedProvider.length + 1)
    : normalizedModel;
}

export function normalizeModelRef(modelRef: string, knownProviderKeys?: Set<string>): string {
  const parsed = splitModelRef(modelRef);
  if (!parsed) return modelRef.trim();
  if (knownProviderKeys && !knownProviderKeys.has(parsed.providerKey)) {
    return modelRef.trim();
  }
  return `${parsed.providerKey}/${stripOwnProviderPrefix(parsed.modelId, parsed.providerKey)}`;
}
