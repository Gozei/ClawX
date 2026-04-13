import { hostApiFetch } from '@/lib/host-api';
import type {
  ProviderAccount,
  ProviderType,
  ProviderVendorInfo,
  ProviderWithKeyInfo,
} from '@/lib/providers';
import { getRecommendedModelOptions } from '@/lib/providers';

export interface ProviderSnapshot {
  accounts: ProviderAccount[];
  statuses: ProviderWithKeyInfo[];
  vendors: ProviderVendorInfo[];
  defaultAccountId: string | null;
}

export interface ProviderListItem {
  account: ProviderAccount;
  vendor?: ProviderVendorInfo;
  status?: ProviderWithKeyInfo;
  aliases: ProviderAccount[];
  displayName: string;
  displayVendorName: string;
  resolvedModel?: string;
  hasConfiguredCredentials: boolean;
  models: ProviderModelSummary[];
}

export interface ProviderModelSummary {
  id: string;
  label: string;
  isDefault: boolean;
  source: 'default' | 'configured' | 'recommended';
  usageTags: string[];
  manualUsageTags: string[];
}

function normalizeBaseUrl(baseUrl?: string): string {
  return (baseUrl || '').trim().replace(/\/+$/, '').toLowerCase();
}

function getFriendlyProviderIdentity(account: ProviderAccount): {
  displayName?: string;
  displayVendorName?: string;
  canonicalKey?: string;
} {
  const baseUrl = normalizeBaseUrl(account.baseUrl);

  if (baseUrl.includes('open.bigmodel.cn')) {
    return {
      displayName: '智谱 Z.ai',
      displayVendorName: '智谱兼容接口',
      canonicalKey: 'zai',
    };
  }

  if (baseUrl.includes('api.deepseek.com')) {
    return {
      displayName: 'DeepSeek',
      displayVendorName: 'DeepSeek 兼容接口',
      canonicalKey: 'deepseek',
    };
  }

  if (baseUrl.includes('dashscope.aliyuncs.com') || baseUrl.includes('coding.dashscope.aliyuncs.com')) {
    return {
      displayName: '阿里百炼 / Qwen',
      displayVendorName: '阿里百炼兼容接口',
      canonicalKey: 'qwen',
    };
  }

  if (baseUrl.includes('api.openai.com')) {
    return {
      displayName: 'OpenAI',
      displayVendorName: 'OpenAI 官方接口',
      canonicalKey: 'openai',
    };
  }

  return {};
}

function isGeneratedCustomLabel(label: string): boolean {
  const normalized = label.trim().toLowerCase();
  return normalized.startsWith('custom-') || normalized === 'custom';
}

function getResolvedDisplayName(
  account: ProviderAccount,
  vendor?: ProviderVendorInfo,
): string {
  const friendly = getFriendlyProviderIdentity(account);
  if (friendly.displayName) {
    return friendly.displayName;
  }

  if (!account.label.trim() || isGeneratedCustomLabel(account.label)) {
    return vendor?.name || account.vendorId;
  }

  return account.label;
}

function getResolvedVendorName(
  account: ProviderAccount,
  vendor?: ProviderVendorInfo,
): string {
  const friendly = getFriendlyProviderIdentity(account);
  return friendly.displayVendorName || vendor?.name || account.vendorId;
}

function getResolvedModel(
  account: ProviderAccount,
  status?: ProviderWithKeyInfo,
  aliases: ProviderAccount[] = [],
): string | undefined {
  return getConfiguredModelIds(account)[0]
    || status?.model
    || aliases.flatMap((candidate) => getConfiguredModelIds(candidate)).find(Boolean)
    || undefined;
}

function getCanonicalProviderKey(account: ProviderAccount, vendor?: ProviderVendorInfo): string {
  // 自定义提供商按账号独立展示，避免不同账号模型被合并到同一张卡片
  if (account.vendorId === 'custom') {
    return `custom-account:${account.id}`;
  }

  const friendly = getFriendlyProviderIdentity(account);
  if (friendly.canonicalKey) {
    return friendly.canonicalKey;
  }

  return [
    account.vendorId,
    normalizeBaseUrl(account.baseUrl),
    (vendor?.name || '').trim().toLowerCase(),
  ].join('|');
}

function prettifyModelLabel(modelId: string): string {
  if (!modelId) return '';
  const direct = getRecommendedModelOptions('custom', {}).find((option) => option.value === modelId)?.label;
  if (direct) return direct;
  const stripped = modelId.includes('/') ? modelId.split('/').pop() || modelId : modelId;
  return stripped.replace(/[-_]/g, ' ');
}

function normalizeConfiguredModelIds(models?: string[]): string[] {
  return Array.from(new Set((models ?? []).map((model) => model.trim()).filter(Boolean)));
}

function getConfiguredModelIds(account: ProviderAccount): string[] {
  return normalizeConfiguredModelIds([account.model || '', ...(account.metadata?.customModels ?? [])]);
}

function inferUsageTags(modelId: string): string[] {
  const normalized = modelId.toLowerCase();
  const tags = new Set<string>();

  if (normalized.includes('coder') || normalized.includes('code')) tags.add('代码开发');
  if (normalized.includes('vision') || normalized.includes('vl')) tags.add('图像理解');
  if (normalized.includes('reason') || normalized.includes('r1') || normalized.includes('think')) tags.add('复杂推理');
  if (normalized.includes('long')) tags.add('长文档');
  if (normalized.includes('flash') || normalized.includes('turbo') || normalized.includes('mini')) tags.add('快速响应');
  if (normalized.includes('qwen') || normalized.includes('glm') || normalized.includes('gpt') || normalized.includes('claude') || normalized.includes('gemini')) {
    tags.add('通用对话');
  }
  if (normalized.includes('qwen') || normalized.includes('glm')) tags.add('中文写作');
  if (normalized.includes('gpt-5') || normalized.includes('glm-5') || normalized.includes('claude-opus') || normalized.includes('gemini-3-pro')) {
    tags.add('Role 编排');
  }

  if (tags.size === 0) {
    tags.add('通用任务');
  }

  return [...tags].slice(0, 3);
}

function getManualUsageTags(
  primary: ProviderAccount,
  aliases: ProviderAccount[],
  modelId: string,
): string[] {
  const sources = [primary, ...aliases];
  for (const source of sources) {
    const tags = source.metadata?.modelUsageTags?.[modelId];
    if (Array.isArray(tags) && tags.length > 0) {
      return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
    }
  }
  return [];
}

function buildProviderModels(
  primary: ProviderAccount,
  aliases: ProviderAccount[],
  status?: ProviderWithKeyInfo,
): ProviderModelSummary[] {
  const defaultModel = getResolvedModel(primary, status, aliases);
  const recommended = getRecommendedModelOptions(primary.vendorId, {
    baseUrl: primary.baseUrl,
    apiProtocol: primary.apiProtocol,
  });
  const configuredModels = normalizeConfiguredModelIds([
    ...getConfiguredModelIds(primary),
    ...aliases.flatMap((alias) => getConfiguredModelIds(alias)),
  ]);

  const entries = new Map<string, ProviderModelSummary>();
  const upsert = (modelId: string | undefined, source: ProviderModelSummary['source']) => {
    const normalized = modelId?.trim();
    if (!normalized) return;
    const existing = entries.get(normalized);
    const isDefault = normalized === defaultModel;
    if (existing) {
      existing.isDefault = existing.isDefault || isDefault;
      if (existing.source === 'recommended' && source !== 'recommended') {
        existing.source = source;
      }
      return;
    }
    entries.set(normalized, {
      id: normalized,
      label: prettifyModelLabel(normalized),
      isDefault,
      source,
      manualUsageTags: getManualUsageTags(primary, aliases, normalized),
      usageTags: [],
    });
  };

  upsert(defaultModel, 'default');
  for (const modelId of configuredModels) {
    upsert(modelId, modelId === defaultModel ? 'default' : 'configured');
  }
  for (const option of recommended) upsert(option.value, 'recommended');

  return [...entries.values()].map((entry) => ({
    ...entry,
    usageTags: Array.from(new Set([...entry.manualUsageTags, ...inferUsageTags(entry.id)])).slice(0, 4),
  })).sort((left, right) => {
    if (left.isDefault) return -1;
    if (right.isDefault) return 1;
    const sourceRank = { default: 0, configured: 1, recommended: 2 } as const;
    if (sourceRank[left.source] !== sourceRank[right.source]) {
      return sourceRank[left.source] - sourceRank[right.source];
    }
    return left.id.localeCompare(right.id);
  });
}

function pickPrimaryListAccount(
  accounts: ProviderAccount[],
  defaultAccountId: string | null,
  statusMap: Map<string, ProviderWithKeyInfo>,
): ProviderAccount {
  return [...accounts].sort((left, right) => {
    if (left.id === defaultAccountId) return -1;
    if (right.id === defaultAccountId) return 1;

    const leftConfigured = hasConfiguredCredentials(left, statusMap.get(left.id));
    const rightConfigured = hasConfiguredCredentials(right, statusMap.get(right.id));
    if (leftConfigured !== rightConfigured) {
      return leftConfigured ? -1 : 1;
    }

    const leftHasModel = Boolean(left.model || statusMap.get(left.id)?.model);
    const rightHasModel = Boolean(right.model || statusMap.get(right.id)?.model);
    if (leftHasModel !== rightHasModel) {
      return leftHasModel ? -1 : 1;
    }

    const leftGenerated = isGeneratedCustomLabel(left.label);
    const rightGenerated = isGeneratedCustomLabel(right.label);
    if (leftGenerated !== rightGenerated) {
      return leftGenerated ? 1 : -1;
    }

    return right.updatedAt.localeCompare(left.updatedAt);
  })[0];
}

export async function fetchProviderSnapshot(): Promise<ProviderSnapshot> {
  const [accounts, statuses, vendors, defaultInfo] = await Promise.all([
    hostApiFetch<ProviderAccount[]>('/api/provider-accounts'),
    hostApiFetch<ProviderWithKeyInfo[]>('/api/providers'),
    hostApiFetch<ProviderVendorInfo[]>('/api/provider-vendors'),
    hostApiFetch<{ accountId: string | null }>('/api/provider-accounts/default'),
  ]);

  return {
    accounts,
    statuses,
    vendors,
    defaultAccountId: defaultInfo.accountId,
  };
}

export function hasConfiguredCredentials(
  account: ProviderAccount,
  status?: ProviderWithKeyInfo,
): boolean {
  if (account.authMode === 'oauth_device' || account.authMode === 'oauth_browser' || account.authMode === 'local') {
    return true;
  }
  return status?.hasKey ?? false;
}

export function pickPreferredAccount(
  accounts: ProviderAccount[],
  defaultAccountId: string | null,
  vendorId: ProviderType | string,
  statusMap: Map<string, ProviderWithKeyInfo>,
): ProviderAccount | null {
  const sameVendor = accounts.filter((account) => account.vendorId === vendorId);
  if (sameVendor.length === 0) return null;

  return (
    (defaultAccountId ? sameVendor.find((account) => account.id === defaultAccountId) : undefined)
    || sameVendor.find((account) => hasConfiguredCredentials(account, statusMap.get(account.id)))
    || sameVendor[0]
  );
}

export function buildProviderAccountId(
  vendorId: ProviderType,
  existingAccountId: string | null,
  vendors: ProviderVendorInfo[],
): string {
  if (existingAccountId) {
    return existingAccountId;
  }

  const vendor = vendors.find((candidate) => candidate.id === vendorId);
  return vendor?.supportsMultipleAccounts ? `${vendorId}-${crypto.randomUUID()}` : vendorId;
}

export function legacyProviderToAccount(provider: ProviderWithKeyInfo): ProviderAccount {
  return {
    id: provider.id,
    vendorId: provider.type,
    label: provider.name,
    authMode: provider.type === 'ollama' ? 'local' : 'api_key',
    baseUrl: provider.baseUrl,
    headers: provider.headers,
    model: provider.model,
    fallbackModels: provider.fallbackModels,
    fallbackAccountIds: provider.fallbackProviderIds,
    enabled: provider.enabled,
    isDefault: false,
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt,
  };
}

export function buildProviderListItems(
  accounts: ProviderAccount[],
  statuses: ProviderWithKeyInfo[],
  vendors: ProviderVendorInfo[],
  defaultAccountId: string | null,
): ProviderListItem[] {
  const safeAccounts = accounts ?? [];
  const safeStatuses = statuses ?? [];
  const safeVendors = vendors ?? [];
  const vendorMap = new Map(safeVendors.map((vendor) => [vendor.id, vendor]));
  const statusMap = new Map(safeStatuses.map((status) => [status.id, status]));

  if (safeAccounts.length > 0) {
    const groupedAccounts = new Map<string, ProviderAccount[]>();
    for (const account of safeAccounts) {
      const vendor = vendorMap.get(account.vendorId);
      const groupKey = getCanonicalProviderKey(account, vendor);
      const group = groupedAccounts.get(groupKey) ?? [];
      group.push(account);
      groupedAccounts.set(groupKey, group);
    }

    return Array.from(groupedAccounts.values())
      .map((group) => {
        const primary = pickPrimaryListAccount(group, defaultAccountId, statusMap);
        const vendor = vendorMap.get(primary.vendorId);
        const status = statusMap.get(primary.id);
        return {
          account: primary,
          vendor,
          status,
          aliases: group,
          displayName: getResolvedDisplayName(primary, vendor),
          displayVendorName: getResolvedVendorName(primary, vendor),
          resolvedModel: getResolvedModel(primary, status, group),
          hasConfiguredCredentials: group.some((candidate) =>
            hasConfiguredCredentials(candidate, statusMap.get(candidate.id))),
          models: buildProviderModels(primary, group, status),
        };
      })
      .sort((left, right) => {
        if (left.account.id === defaultAccountId) return -1;
        if (right.account.id === defaultAccountId) return 1;
        return right.account.updatedAt.localeCompare(left.account.updatedAt);
      });
  }

  return safeStatuses.map((status) => ({
    account: legacyProviderToAccount(status),
    vendor: vendorMap.get(status.type),
    status,
    aliases: [legacyProviderToAccount(status)],
    displayName: status.name,
    displayVendorName: vendorMap.get(status.type)?.name || status.type,
    resolvedModel: status.model,
    hasConfiguredCredentials: status.hasKey,
    models: buildProviderModels(legacyProviderToAccount(status), [legacyProviderToAccount(status)], status),
  }));
}
