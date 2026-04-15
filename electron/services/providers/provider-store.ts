import type { ProviderAccount, ProviderConfig, ProviderType } from '../../shared/providers/types';
import { getProviderDefinition } from '../../shared/providers/registry';
import { getClawXProviderStore } from './store-instance';


function inferAuthMode(type: ProviderType): ProviderAccount['authMode'] {
  if (type === 'ollama') {
    return 'local';
  }

  const definition = getProviderDefinition(type);
  if (definition?.defaultAuthMode) {
    return definition.defaultAuthMode;
  }

  return 'api_key';
}

export function providerConfigToAccount(
  config: ProviderConfig,
  options?: { isDefault?: boolean },
): ProviderAccount {
  return {
    id: config.id,
    vendorId: config.type,
    label: config.name,
    authMode: inferAuthMode(config.type),
    baseUrl: config.baseUrl,
    apiProtocol: config.apiProtocol || (config.type === 'custom' || config.type === 'ollama'
      ? 'openai-completions'
      : getProviderDefinition(config.type)?.providerConfig?.api),
    headers: config.headers,
    model: config.model,
    metadata: config.metadata,
    fallbackModels: config.fallbackModels,
    fallbackAccountIds: config.fallbackProviderIds,
    enabled: config.enabled,
    isDefault: options?.isDefault ?? false,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  };
}

export function providerAccountToConfig(account: ProviderAccount): ProviderConfig {
  return {
    id: account.id,
    name: account.label,
    type: account.vendorId,
    baseUrl: account.baseUrl,
    apiProtocol: account.apiProtocol,
    headers: account.headers,
    model: account.model,
    metadata: account.metadata,
    fallbackModels: account.fallbackModels,
    fallbackProviderIds: account.fallbackAccountIds,
    enabled: account.enabled,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

export async function listProviderAccounts(): Promise<ProviderAccount[]> {
  const store = await getClawXProviderStore();
  const accounts = store.get('providerAccounts') as Record<string, ProviderAccount> | undefined;
  return Object.values(accounts ?? {});
}

export async function getProviderAccount(accountId: string): Promise<ProviderAccount | null> {
  const store = await getClawXProviderStore();
  const accounts = store.get('providerAccounts') as Record<string, ProviderAccount> | undefined;
  return accounts?.[accountId] ?? null;
}

export async function saveProviderAccount(account: ProviderAccount): Promise<void> {
  const store = await getClawXProviderStore();
  const accounts = (store.get('providerAccounts') ?? {}) as Record<string, ProviderAccount>;
  accounts[account.id] = account;
  store.set('providerAccounts', accounts);
}

export async function deleteProviderAccount(accountId: string): Promise<void> {
  const store = await getClawXProviderStore();
  const accounts = (store.get('providerAccounts') ?? {}) as Record<string, ProviderAccount>;
  delete accounts[accountId];
  store.set('providerAccounts', accounts);

  if (store.get('defaultProviderAccountId') === accountId) {
    store.delete('defaultProviderAccountId');
  }
}

export async function setDefaultProviderAccount(accountId: string): Promise<void> {
  const store = await getClawXProviderStore();
  store.set('defaultProviderAccountId', accountId);

  const accounts = (store.get('providerAccounts') ?? {}) as Record<string, ProviderAccount>;
  for (const account of Object.values(accounts)) {
    account.isDefault = account.id === accountId;
  }
  store.set('providerAccounts', accounts);
}

export async function getDefaultProviderAccountId(): Promise<string | undefined> {
  const store = await getClawXProviderStore();
  return store.get('defaultProviderAccountId') as string | undefined;
}

export async function listSuppressedProviderKeys(): Promise<string[]> {
  const store = await getClawXProviderStore();
  const keys = store.get('suppressedProviderKeys') as string[] | undefined;
  return Array.isArray(keys) ? [...new Set(keys.filter(Boolean))] : [];
}

export async function suppressProviderKeys(keys: string[]): Promise<void> {
  const normalizedKeys = Array.from(new Set(keys.map((key) => key.trim()).filter(Boolean)));
  if (normalizedKeys.length === 0) {
    return;
  }

  const store = await getClawXProviderStore();
  const existing = store.get('suppressedProviderKeys') as string[] | undefined;
  const next = Array.from(new Set([...(existing ?? []), ...normalizedKeys]));
  store.set('suppressedProviderKeys', next);
}

export async function unsuppressProviderKeys(keys: string[]): Promise<void> {
  const normalizedKeys = new Set(keys.map((key) => key.trim()).filter(Boolean));
  if (normalizedKeys.size === 0) {
    return;
  }

  const store = await getClawXProviderStore();
  const existing = store.get('suppressedProviderKeys') as string[] | undefined;
  if (!Array.isArray(existing) || existing.length === 0) {
    return;
  }

  const next = existing.filter((key) => !normalizedKeys.has(key));
  if (next.length > 0) {
    store.set('suppressedProviderKeys', next);
    return;
  }

  store.delete('suppressedProviderKeys');
}
