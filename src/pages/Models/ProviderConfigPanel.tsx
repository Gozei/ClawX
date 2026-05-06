import { useEffect, useMemo, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { AlertCircle, CheckCircle2, Clock3, Loader2, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useAgentsStore } from '@/stores/agents';
import { useProviderStore, type ProviderAccount } from '@/stores/providers';
import { confirmGatewayImpact } from '@/lib/gateway-impact-confirm';
import { hostApiFetch } from '@/lib/host-api';
import {
  PROVIDER_TYPE_INFO,
  getRecommendedModelOptions,
  resolveProviderApiKeyForSave,
  type ProviderAuthMode,
  type ProviderType,
  type ProviderVendorInfo,
} from '@/lib/providers';
import { buildConfiguredModelEntries, buildProviderAccountId } from '@/lib/provider-accounts';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useChatStore } from '@/stores/chat';

type ProviderConnectionTestResult = {
  valid: boolean;
  error?: string;
  model?: string;
  output?: string;
  latencyMs?: number;
};

type ResultType = 'chat' | 'reasoning' | 'code' | 'embedding' | 'vision' | 'general';

type ModelRow = {
  key: string;
  account: ProviderAccount;
  accountLabel: string;
  vendorLabel: string;
  vendorId: ProviderType;
  modelId: string;
  isDefault: boolean;
  isGlobalDefault: boolean;
  protocol: NonNullable<ProviderAccount['apiProtocol']>;
  authMode: ProviderAuthMode;
  hasCredentials: boolean;
  resultType: ResultType;
};

type DraftState = {
  mode: 'create' | 'edit';
  accountId: string | null;
  vendorId: ProviderType;
  label: string;
  baseUrl: string;
  apiProtocol: NonNullable<ProviderAccount['apiProtocol']>;
  modelId: string;
  apiKey: string;
  authMode: ProviderAuthMode;
  originalModelId?: string;
  wasDefault?: boolean;
};

type TestStatus = {
  state: 'idle' | 'running' | 'success' | 'error';
  signature?: string;
  cacheSignature?: string;
  model?: string;
  output?: string;
  latencyMs?: number;
  error?: string;
  testedAt?: string;
  applied?: boolean;
};

const DEFAULT_PROTOCOL: NonNullable<ProviderAccount['apiProtocol']> = 'openai-completions';
const TEST_RESULT_CACHE_STORAGE_KEY = 'clawx.models.testResults.v1';

const VENDOR_DISPLAY_NAMES: Partial<Record<ProviderType, string>> = {
  google: 'Google Gemini',
  bigmodel: '智谱 AI',
  ark: '火山方舟',
  moonshot: '月之暗面 Kimi',
  siliconflow: '硅基流动',
  deepseek: 'DeepSeek',
  'minimax-portal': 'MiniMax（国际）',
  'minimax-portal-cn': 'MiniMax（中国）',
  modelstudio: '通义千问 / 阿里云百炼',
  custom: '自定义',
};

const PROVIDER_FORM_DEFAULTS: Partial<Record<ProviderType, {
  baseUrl?: string;
  apiProtocol?: NonNullable<ProviderAccount['apiProtocol']>;
}>> = {
  anthropic: {
    baseUrl: 'https://api.anthropic.com/v1',
    apiProtocol: 'anthropic-messages',
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    apiProtocol: 'openai-responses',
  },
  google: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    apiProtocol: DEFAULT_PROTOCOL,
  },
  'minimax-portal': {
    baseUrl: 'https://api.minimax.io/anthropic',
    apiProtocol: 'anthropic-messages',
  },
  'minimax-portal-cn': {
    baseUrl: 'https://api.minimaxi.com/anthropic',
    apiProtocol: 'anthropic-messages',
  },
};

function getVendorDefaults(
  vendorId: ProviderType,
  vendors: ProviderVendorInfo[] = [],
): {
  label: string;
  baseUrl: string;
  apiProtocol: NonNullable<ProviderAccount['apiProtocol']>;
  modelId: string;
  authMode: ProviderAuthMode;
} {
  const vendor = vendors.find((entry) => entry.id === vendorId);
  const staticInfo = PROVIDER_TYPE_INFO.find((entry) => entry.id === vendorId);
  const fallback = PROVIDER_FORM_DEFAULTS[vendorId];
  const displayName = VENDOR_DISPLAY_NAMES[vendorId] || vendor?.name || staticInfo?.name || vendorId;

  return {
    label: displayName,
    baseUrl: vendor?.defaultBaseUrl || vendor?.providerConfig?.baseUrl || staticInfo?.defaultBaseUrl || fallback?.baseUrl || '',
    apiProtocol: vendor?.providerConfig?.api || fallback?.apiProtocol || DEFAULT_PROTOCOL,
    modelId: vendor?.defaultModelId || staticInfo?.defaultModelId || '',
    authMode: vendor?.defaultAuthMode || (vendorId === 'ollama' ? 'local' : 'api_key'),
  };
}

function getVendorDisplayName(vendorId: ProviderType, vendors: ProviderVendorInfo[] = []): string {
  return getVendorDefaults(vendorId, vendors).label;
}

function getModelPlaceholder(
  draft: Pick<DraftState, 'vendorId' | 'baseUrl' | 'apiProtocol'>,
  recommendedModels: Array<{ value: string }>,
): string {
  const staticInfo = PROVIDER_TYPE_INFO.find((entry) => entry.id === draft.vendorId);
  return recommendedModels[0]?.value || staticInfo?.modelIdPlaceholder || 'gpt-5.4 / glm-5 / qwen3.5-plus';
}

function formatRecommendedModels(recommendedModels: Array<{ value: string; label: string }>, separator: string): string {
  return recommendedModels.slice(0, 3).map((model) => model.label || model.value).join(separator);
}

function getProtocolHelp(t: TFunction<'settings'>, draft: DraftState, vendorName: string): string {
  if (draft.vendorId === 'custom') {
    return t('aiProviders.modelsConfig.help.protocolCustom');
  }
  return t('aiProviders.modelsConfig.help.protocolVendor', { vendor: vendorName });
}

function getBaseUrlHelp(t: TFunction<'settings'>, draft: DraftState, vendorName: string): string {
  if (draft.vendorId === 'custom') {
    return t('aiProviders.modelsConfig.help.baseUrlCustom');
  }
  if (draft.authMode === 'local') {
    return t('aiProviders.modelsConfig.help.baseUrlLocal');
  }
  return t('aiProviders.modelsConfig.help.baseUrlVendor', { vendor: vendorName });
}

function getApiKeyHelp(t: TFunction<'settings'>, draft: DraftState, vendorName: string): string {
  const savedKeyText = draft.mode === 'edit' ? t('aiProviders.modelsConfig.help.apiKeySavedSuffix') : '';
  if (draft.vendorId === 'custom') {
    return t('aiProviders.modelsConfig.help.apiKeyCustom', { savedKeyText });
  }
  return t('aiProviders.modelsConfig.help.apiKeyVendor', { vendor: vendorName, savedKeyText });
}

function normalizeConfiguredModelIds(account: ProviderAccount): string[] {
  return Array.from(new Set([account.model || '', ...(account.metadata?.customModels ?? [])].map((value) => value.trim()).filter(Boolean)));
}

function normalizeProviderUrl(value?: string): string {
  return (value || '').trim().replace(/\/+$/, '').toLowerCase();
}

function normalizeModelId(value: string): string {
  return value.trim().toLowerCase();
}

function getVendorDefaultBaseUrl(vendorId: ProviderType): string {
  return PROVIDER_TYPE_INFO.find((entry) => entry.id === vendorId)?.defaultBaseUrl || '';
}

function getRowDuplicateScope(row: ModelRow): string {
  return normalizeProviderUrl(row.account.baseUrl || getVendorDefaultBaseUrl(row.vendorId)) || `vendor:${row.vendorId}`;
}

function getRowDuplicateKey(row: ModelRow): string {
  return [
    row.vendorId,
    getRowDuplicateScope(row),
    row.protocol,
    normalizeModelId(row.modelId),
  ].join('|');
}

function shouldPreferModelRow(candidate: ModelRow, current: ModelRow): boolean {
  if (candidate.isGlobalDefault !== current.isGlobalDefault) return candidate.isGlobalDefault;
  if (candidate.isDefault !== current.isDefault) return candidate.isDefault;
  if (candidate.hasCredentials !== current.hasCredentials) return candidate.hasCredentials;
  return candidate.account.updatedAt.localeCompare(current.account.updatedAt) > 0;
}

function collapseDuplicateModelRows(rows: ModelRow[]): ModelRow[] {
  const byIdentity = new Map<string, ModelRow>();
  for (const row of rows) {
    const key = getRowDuplicateKey(row);
    const current = byIdentity.get(key);
    if (!current || shouldPreferModelRow(row, current)) {
      byIdentity.set(key, row);
    }
  }
  return [...byIdentity.values()];
}

function getDraftDuplicateScope(draft: DraftState): string {
  return normalizeProviderUrl(draft.baseUrl || getVendorDefaultBaseUrl(draft.vendorId)) || `vendor:${draft.vendorId}`;
}

function findOriginalDraftRow(rows: ModelRow[], draft: DraftState): ModelRow | undefined {
  if (!draft.accountId || !draft.originalModelId) {
    return undefined;
  }
  const originalModelId = normalizeModelId(draft.originalModelId);
  return rows.find((row) => row.account.id === draft.accountId && normalizeModelId(row.modelId) === originalModelId);
}

function hasDraftProviderModelIdentityChanged(rows: ModelRow[], draft: DraftState): boolean {
  if (draft.mode === 'create') {
    return true;
  }
  const originalRow = findOriginalDraftRow(rows, draft);
  if (!originalRow) {
    return true;
  }
  return getDraftDuplicateScope(draft) !== getRowDuplicateScope(originalRow)
    || normalizeModelId(draft.modelId) !== normalizeModelId(originalRow.modelId);
}

function findDuplicateDraftModel(rows: ModelRow[], draft: DraftState): ModelRow | null {
  const modelId = normalizeModelId(draft.modelId);
  if (!modelId || !hasDraftProviderModelIdentityChanged(rows, draft)) {
    return null;
  }

  const scope = getDraftDuplicateScope(draft);
  return rows.find((row) => {
    const isOriginalRow = draft.accountId === row.account.id
      && normalizeModelId(draft.originalModelId || '') === normalizeModelId(row.modelId);
    return !isOriginalRow && getRowDuplicateScope(row) === scope && normalizeModelId(row.modelId) === modelId;
  }) ?? null;
}

function duplicateModelMessage(t: TFunction<'settings'>, row: ModelRow): string {
  return t('aiProviders.modelsConfig.toast.duplicateModel', {
    target: `${row.account.baseUrl || getVendorDefaultBaseUrl(row.vendorId) || row.vendorLabel} / ${row.modelId}`,
  });
}

function inferResultType(modelId: string): ResultType {
  const normalized = modelId.toLowerCase();
  if (normalized.includes('embed')) return 'embedding';
  if (normalized.includes('vision') || normalized.includes('vl')) return 'vision';
  if (normalized.includes('reason') || normalized.includes('r1') || normalized.includes('think')) return 'reasoning';
  if (normalized.includes('code') || normalized.includes('coder')) return 'code';
  if (normalized.includes('chat') || normalized.includes('glm') || normalized.includes('gpt') || normalized.includes('qwen') || normalized.includes('claude') || normalized.includes('gemini')) return 'chat';
  return 'general';
}

function resultTypeLabel(t: TFunction<'settings'>, type: ResultType): string {
  switch (type) {
    case 'embedding':
      return 'Embedding';
    case 'vision':
      return t('aiProviders.modelsConfig.resultTypes.vision');
    case 'reasoning':
      return t('aiProviders.modelsConfig.resultTypes.reasoning');
    case 'code':
      return t('aiProviders.modelsConfig.resultTypes.code');
    case 'chat':
      return t('aiProviders.modelsConfig.resultTypes.chat');
    default:
      return t('aiProviders.modelsConfig.resultTypes.general');
  }
}

function protocolLabel(protocol: NonNullable<ProviderAccount['apiProtocol']>): string {
  switch (protocol) {
    case 'openai-responses':
      return 'Responses';
    case 'anthropic-messages':
      return 'Anthropic';
    default:
      return 'Completions';
  }
}

function formatTimestamp(t: TFunction<'settings'>, value?: string): string {
  if (!value) return t('aiProviders.modelsConfig.status.notTested');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function buildRowDraft(row: ModelRow): DraftState {
  return {
    mode: 'edit',
    accountId: row.account.id,
    vendorId: row.vendorId,
    label: row.account.label,
    baseUrl: row.account.baseUrl || '',
    apiProtocol: row.protocol,
    modelId: row.modelId,
    apiKey: '',
    authMode: row.authMode,
    originalModelId: row.modelId,
    wasDefault: row.isDefault,
  };
}

function buildCreateDraft(vendorId: ProviderType, vendors: ProviderVendorInfo[] = []): DraftState {
  const defaults = getVendorDefaults(vendorId, vendors);
  return {
    mode: 'create',
    accountId: null,
    vendorId,
    label: defaults.label,
    baseUrl: defaults.baseUrl,
    apiProtocol: defaults.apiProtocol,
    modelId: defaults.modelId,
    apiKey: '',
    authMode: defaults.authMode,
  };
}

function getDraftSignature(draft: DraftState): string {
  return JSON.stringify({
    vendorId: draft.vendorId,
    label: draft.label.trim(),
    baseUrl: draft.baseUrl.trim(),
    apiProtocol: draft.apiProtocol,
    modelId: draft.modelId.trim(),
    apiKey: draft.apiKey.trim(),
    authMode: draft.authMode,
  });
}

function getResultCacheSignature(draft: Pick<DraftState, 'vendorId' | 'baseUrl' | 'apiProtocol' | 'modelId' | 'authMode'>): string {
  return JSON.stringify({
    vendorId: draft.vendorId,
    baseUrl: draft.baseUrl.trim(),
    apiProtocol: draft.apiProtocol,
    modelId: draft.modelId.trim(),
    authMode: draft.authMode,
  });
}

function readCachedTestResults(): Record<string, TestStatus> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(TEST_RESULT_CACHE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, TestStatus>;
  } catch {
    return {};
  }
}

function writeCachedTestResults(results: Record<string, TestStatus>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(TEST_RESULT_CACHE_STORAGE_KEY, JSON.stringify(results));
  } catch {
    // Best-effort UI cache only; connection testing should not fail because persistence is unavailable.
  }
}

function getCachedResult(test: TestStatus | undefined, cacheSignature: string): TestStatus | undefined {
  if (!test || test.state === 'running') return undefined;
  return test.cacheSignature === cacheSignature ? test : undefined;
}

function getRowCacheKey(row: ModelRow): string {
  return `${row.account.id}:${row.modelId.trim()}`;
}

function formatTestSummary(t: TFunction<'settings'>, test?: TestStatus): string {
  if (!test || test.state === 'idle') return t('aiProviders.modelsConfig.status.notTested');
  if (test.state === 'running') return t('aiProviders.modelsConfig.status.testing');
  if (test.state === 'error') return t('aiProviders.modelsConfig.status.failed');
  return test.applied ? t('aiProviders.modelsConfig.status.successApplied') : t('aiProviders.modelsConfig.status.success');
}

function formatConnectionTestOutput(
  t: TFunction<'settings'>,
  test: TestStatus | undefined,
  fallbackModelId?: string,
  emptyLabel?: string,
): string {
  const empty = emptyLabel ?? t('aiProviders.modelsConfig.status.noOutput');
  if (!test) return empty;
  if (test.state === 'success') {
    const testedModel = test.model?.trim() || fallbackModelId?.trim();
    return testedModel
      ? t('aiProviders.modelsConfig.status.connectionSuccessModel', { model: testedModel })
      : test.output || t('aiProviders.modelsConfig.status.connectionSuccess');
  }
  return test.error || test.output || empty;
}

function getStatusTone(test?: TestStatus): string {
  if (test?.state === 'success') {
    return 'text-emerald-600 dark:text-emerald-400';
  }
  if (test?.state === 'error') {
    return 'text-red-600 dark:text-red-400';
  }
  return 'text-foreground/55';
}

function buildModelRows(accounts: ProviderAccount[], statuses: ReturnType<typeof useProviderStore.getState>['statuses'], vendors: ReturnType<typeof useProviderStore.getState>['vendors'], defaultAccountId: string | null): ModelRow[] {
  const rows = buildConfiguredModelEntries(accounts, statuses, vendors, defaultAccountId).map((entry) => ({
    key: entry.key,
    account: entry.account,
    accountLabel: entry.displayName,
    vendorLabel: entry.displayVendorName,
    vendorId: entry.vendorId,
    modelId: entry.modelId,
    isDefault: entry.isDefault,
    isGlobalDefault: entry.isGlobalDefault,
    protocol: entry.protocol,
    authMode: entry.account.authMode,
    hasCredentials: entry.hasConfiguredCredentials,
    resultType: inferResultType(entry.modelId),
  }));
  return collapseDuplicateModelRows(rows);
}

function applyModelChangeToAccount(account: ProviderAccount, draft: DraftState): Partial<ProviderAccount> {
  const currentModelIds = normalizeConfiguredModelIds(account);
  const originalModelId = draft.originalModelId?.trim();
  const nextModelId = draft.modelId.trim();
  const remaining = currentModelIds.filter((modelId) => modelId !== originalModelId);

  const nextModelIds = Array.from(new Set((draft.wasDefault
    ? [nextModelId, ...remaining]
    : [
        ...(currentModelIds[0] && currentModelIds[0] !== originalModelId ? [currentModelIds[0]] : []),
        nextModelId,
        ...remaining.filter((modelId) => modelId !== currentModelIds[0]),
      ]).filter(Boolean)));

  const nextMetadata = { ...(account.metadata ?? {}) };
  const nextCustomModels = nextModelIds.slice(1);
  if (nextCustomModels.length > 0) {
    nextMetadata.customModels = nextCustomModels;
  } else {
    delete nextMetadata.customModels;
  }

  const nextProtocols = { ...(account.metadata?.modelProtocols ?? {}) };
  if (originalModelId && originalModelId !== nextModelId) {
    delete nextProtocols[originalModelId];
  }
  nextProtocols[nextModelId] = draft.apiProtocol;
  nextMetadata.modelProtocols = nextProtocols;

  return {
    label: draft.label.trim(),
    baseUrl: draft.baseUrl.trim() || undefined,
    apiProtocol: draft.apiProtocol,
    model: nextModelIds[0],
    metadata: nextMetadata,
  };
}

function removeModelFromAccount(account: ProviderAccount, modelId: string): Partial<ProviderAccount> | null {
  const currentModelIds = normalizeConfiguredModelIds(account);
  if (currentModelIds.length <= 1) return null;
  const remaining = currentModelIds.filter((current) => current !== modelId);
  const nextMetadata = { ...(account.metadata ?? {}) };
  const nextCustomModels = remaining.slice(1);
  if (nextCustomModels.length > 0) {
    nextMetadata.customModels = nextCustomModels;
  } else {
    delete nextMetadata.customModels;
  }
  const nextProtocols = { ...(account.metadata?.modelProtocols ?? {}) };
  delete nextProtocols[modelId];
  nextMetadata.modelProtocols = nextProtocols;

  return {
    model: remaining[0],
    metadata: nextMetadata,
  };
}

export function ProviderConfigPanel() {
  const { t } = useTranslation('settings');
  const {
    accounts,
    statuses,
    vendors,
    defaultAccountId,
    loading,
    refreshProviderSnapshot,
    createAccount,
    updateAccount,
    removeAccount,
    setDefaultAccount,
  } = useProviderStore();
  const fetchAgents = useAgentsStore((state) => state.fetchAgents);
  const loadSessions = useChatStore((state) => state.loadSessions);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [draftTest, setDraftTest] = useState<TestStatus>({ state: 'idle' });
  const [saving, setSaving] = useState(false);
  const [testingRowKey, setTestingRowKey] = useState<string | null>(null);
  const [resultsByRow, setResultsByRow] = useState<Record<string, TestStatus>>(() => readCachedTestResults());
  const [deletingRowKeys, setDeletingRowKeys] = useState<string[]>([]);

  useEffect(() => {
    void refreshProviderSnapshot();
  }, [refreshProviderSnapshot]);

  const rows = useMemo(
    () => buildModelRows(accounts, statuses, vendors, defaultAccountId),
    [accounts, statuses, vendors, defaultAccountId],
  );

  const vendorOptions = useMemo(
    () => vendors.filter((vendor) => vendor.hidden !== true),
    [vendors],
  );

  const draftSignature = draft ? getDraftSignature(draft) : '';
  const canApplyDraft = Boolean(
    draft
    && draftTest.state === 'success'
    && draftTest.signature === draftSignature
    && !saving,
  );
  const draftVendorId = draft?.vendorId;
  const draftBaseUrl = draft?.baseUrl;
  const draftApiProtocol = draft?.apiProtocol;
  const draftVendorName = draft ? getVendorDisplayName(draft.vendorId, vendorOptions) : '';
  const draftRecommendedModels = useMemo(
    () => draftVendorId
      ? getRecommendedModelOptions(draftVendorId, {
        baseUrl: draftBaseUrl,
        apiProtocol: draftApiProtocol,
      })
      : [],
    [draftApiProtocol, draftBaseUrl, draftVendorId],
  );

  const runDraftTest = async (payload: DraftState): Promise<TestStatus> => {
    const result = await hostApiFetch<ProviderConnectionTestResult>('/api/provider-drafts/test', {
      method: 'POST',
      body: JSON.stringify({
        accountId: payload.accountId,
        vendorId: payload.vendorId,
        apiKey: payload.apiKey.trim() || undefined,
        baseUrl: payload.baseUrl.trim() || undefined,
        apiProtocol: payload.apiProtocol,
        model: payload.modelId.trim(),
        authMode: payload.authMode,
      }),
    });
    return {
      state: result.valid ? 'success' : 'error',
      signature: getDraftSignature(payload),
      cacheSignature: getResultCacheSignature(payload),
      model: result.model || payload.modelId.trim(),
      output: result.output,
      latencyMs: result.latencyMs,
      error: result.error,
      testedAt: new Date().toISOString(),
      applied: false,
    };
  };

  const setCachedRowResult = (rowKey: string, result: TestStatus) => {
    if (result.state === 'running') {
      setResultsByRow((current) => ({ ...current, [rowKey]: result }));
      return;
    }
    setResultsByRow((current) => {
      const next = { ...current, [rowKey]: result };
      writeCachedTestResults(next);
      return next;
    });
  };

  const removeCachedRowResult = (rowKey: string) => {
    setResultsByRow((current) => {
      if (!current[rowKey]) return current;
      const next = { ...current };
      delete next[rowKey];
      writeCachedTestResults(next);
      return next;
    });
  };

  const handleOpenCreate = () => {
    const nextDraft = buildCreateDraft(vendorOptions[0]?.id || 'custom', vendorOptions);
    setDraft(nextDraft);
    setDraftTest({ state: 'idle' });
    setSheetOpen(true);
  };

  const handleOpenEdit = (row: ModelRow) => {
    const rowDraft = buildRowDraft(row);
    setDraft(rowDraft);
    setDraftTest(getCachedResult(resultsByRow[getRowCacheKey(row)], getResultCacheSignature(rowDraft)) || { state: 'idle' });
    setSheetOpen(true);
  };

  const handleTestRow = async (row: ModelRow) => {
    setTestingRowKey(row.key);
    try {
      const result = await runDraftTest(buildRowDraft(row));
      setCachedRowResult(getRowCacheKey(row), result);
      if (result.state === 'success') {
        toast.success(t('aiProviders.modelsConfig.toast.testSuccess', { latency: result.latencyMs ?? '-' }));
      } else {
        toast.error(result.error || t('aiProviders.modelsConfig.toast.testFailed'));
      }
    } catch (error) {
      toast.error(String(error));
    } finally {
      setTestingRowKey(null);
    }
  };

  const handleDeleteRow = async (row: ModelRow) => {
    setDeletingRowKeys((current) => current.includes(row.key) ? current : [...current, row.key]);
    try {
      const accountUpdate = removeModelFromAccount(row.account, row.modelId);
      if (accountUpdate) {
        const updated = await updateAccount(row.account.id, accountUpdate);
        if (!updated) return;
      } else {
        const removed = await removeAccount(row.account.id);
        if (!removed) return;
      }
      removeCachedRowResult(getRowCacheKey(row));
      await refreshProviderSnapshot();
      await fetchAgents();
      await loadSessions();
      toast.success(t('aiProviders.modelsConfig.toast.deleted'));
    } catch (error) {
      toast.error(t('aiProviders.modelsConfig.toast.deleteFailed', { error: String(error) }));
    } finally {
      setDeletingRowKeys((current) => current.filter((key) => key !== row.key));
    }
  };

  const handleSetDefaultModel = async (row: ModelRow) => {
    try {
      const confirmed = await confirmGatewayImpact({
        mode: 'refresh',
        willApplyChanges: true,
      });
      if (!confirmed) return;

      const currentModelIds = normalizeConfiguredModelIds(row.account);
      const nextModelIds = [row.modelId, ...currentModelIds.filter((modelId) => modelId !== row.modelId)];
      const nextMetadata = { ...(row.account.metadata ?? {}) };
      const nextCustomModels = nextModelIds.slice(1);
      if (nextCustomModels.length > 0) {
        nextMetadata.customModels = nextCustomModels;
      } else {
        delete nextMetadata.customModels;
      }
      const updateResult = await hostApiFetch<{ success: boolean; error?: string }>(`/api/provider-accounts/${encodeURIComponent(row.account.id)}`, {
        method: 'PUT',
        body: JSON.stringify({
          updates: {
            model: nextModelIds[0],
            metadata: nextMetadata,
          },
        }),
      });
      if (!updateResult.success) {
        throw new Error(updateResult.error || 'Failed to update provider account');
      }

      if (defaultAccountId !== row.account.id) {
        const defaultResult = await hostApiFetch<{ success: boolean; error?: string }>('/api/provider-accounts/default', {
          method: 'PUT',
          body: JSON.stringify({ accountId: row.account.id }),
        });
        if (!defaultResult.success) {
          throw new Error(defaultResult.error || 'Failed to set default provider account');
        }
      }

      await refreshProviderSnapshot();
      await fetchAgents();
      toast.success(t('aiProviders.modelsConfig.toast.defaultUpdated'));
    } catch (error) {
      toast.error(t('aiProviders.modelsConfig.toast.defaultFailed', { error: String(error) }));
    }
  };

  const handleDraftTest = async () => {
    if (!draft) return;
    if (!draft.modelId.trim()) {
      toast.error(t('aiProviders.modelsConfig.toast.modelRequired'));
      return;
    }
    const duplicate = findDuplicateDraftModel(rows, draft);
    if (duplicate) {
      toast.error(duplicateModelMessage(t, duplicate));
      return;
    }
    setDraftTest({ state: 'running' });
    try {
      const result = await runDraftTest(draft);
      setDraftTest(result);
      if (result.state === 'success') {
        toast.success(t('aiProviders.modelsConfig.toast.testSuccess', { latency: result.latencyMs ?? '-' }));
      } else {
        toast.error(result.error || t('aiProviders.modelsConfig.toast.testFailed'));
      }
    } catch (error) {
      const failed: TestStatus = {
        state: 'error',
        signature: getDraftSignature(draft),
        cacheSignature: getResultCacheSignature(draft),
        error: String(error),
        testedAt: new Date().toISOString(),
      };
      setDraftTest(failed);
      toast.error(String(error));
    }
  };

  const handleApplyDraft = async () => {
    if (!draft || !canApplyDraft) return;
    const duplicate = findDuplicateDraftModel(rows, draft);
    if (duplicate) {
      toast.error(duplicateModelMessage(t, duplicate));
      return;
    }
    setSaving(true);
    try {
      const trimmedKey = draft.apiKey.trim();
      const effectiveKey = resolveProviderApiKeyForSave(draft.vendorId, trimmedKey);
      let appliedRowKey: string | null = null;

      if (draft.mode === 'create') {
        const accountId = buildProviderAccountId(draft.vendorId, null, vendors);
        const created = await createAccount({
          id: accountId,
          vendorId: draft.vendorId,
          label: draft.label.trim(),
          authMode: draft.authMode,
          baseUrl: draft.baseUrl.trim() || undefined,
          apiProtocol: draft.apiProtocol,
          model: draft.modelId.trim(),
          enabled: true,
          isDefault: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          metadata: {
            modelProtocols: {
              [draft.modelId.trim()]: draft.apiProtocol,
            },
          },
        }, effectiveKey);
        if (!created) return;
        if (!defaultAccountId) {
          const setDefault = await setDefaultAccount(accountId, { skipImpactConfirm: true });
          if (!setDefault) return;
        }
        appliedRowKey = `${accountId}:${draft.modelId.trim()}`;
      } else if (draft.accountId) {
        const account = accounts.find((entry) => entry.id === draft.accountId);
        if (!account) throw new Error(t('aiProviders.modelsConfig.toast.configMissing'));
        const updates = applyModelChangeToAccount(account, draft);
        const updated = await updateAccount(draft.accountId, updates, trimmedKey || undefined);
        if (!updated) return;
        if (draft.originalModelId && draft.originalModelId !== draft.modelId.trim()) {
          removeCachedRowResult(`${draft.accountId}:${draft.originalModelId}`);
        }
        appliedRowKey = `${draft.accountId}:${draft.modelId.trim()}`;
      }

      const nextResult: TestStatus = {
        ...draftTest,
        applied: true,
      };
      if (appliedRowKey) {
        setCachedRowResult(appliedRowKey, nextResult);
      }
      setSheetOpen(false);
      setDraft(null);
      await fetchAgents();
      await loadSessions();
      toast.success(t('aiProviders.modelsConfig.toast.applied'));
    } catch (error) {
      toast.error(t('aiProviders.modelsConfig.toast.applyFailed', { error: String(error) }));
    } finally {
      setSaving(false);
    }
  };

  const updateDraft = <K extends keyof DraftState>(key: K, value: DraftState[K]) => {
    setDraft((current) => {
      if (!current) return current;
      const next = { ...current, [key]: value };
      if (key === 'vendorId') {
        const defaults = getVendorDefaults(value as ProviderType, vendorOptions);
        next.label = defaults.label;
        next.baseUrl = defaults.baseUrl;
        next.apiProtocol = defaults.apiProtocol;
        next.modelId = defaults.modelId;
        next.authMode = defaults.authMode;
      }
      return next;
    });
  };

  return (
    <TooltipProvider delayDuration={200}>
      <section data-testid="models-config-panel" className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-[28px] font-semibold tracking-[-0.02em] text-foreground">{t('aiProviders.modelsConfig.title')}</h2>
          <p className="mt-1 text-[14px] text-muted-foreground">
            {t('aiProviders.modelsConfig.description')}
          </p>
        </div>
        <Button data-testid="models-config-add-button" className="rounded-full px-4" onClick={handleOpenCreate}>
          <Plus className="mr-2 h-4 w-4" />
          {t('aiProviders.modelsConfig.actions.add')}
        </Button>
      </div>

      {loading && rows.length === 0 ? (
        <div className="flex items-center justify-center rounded-2xl border border-dashed border-black/10 py-16 text-muted-foreground dark:border-white/10">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <div data-testid="models-config-empty-state" className="rounded-2xl border border-dashed border-black/10 px-6 py-14 text-center dark:border-white/10">
          <p className="text-[15px] font-medium text-foreground">{t('aiProviders.modelsConfig.empty.title')}</p>
          <p className="mt-2 text-[13px] text-muted-foreground">{t('aiProviders.modelsConfig.empty.description')}</p>
          <Button className="mt-5 rounded-full px-5" onClick={handleOpenCreate}>{t('aiProviders.modelsConfig.empty.cta')}</Button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-black/10 dark:border-white/10">
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-left">
              <thead className="bg-black/[0.025] text-[12px] uppercase tracking-[0.08em] text-foreground/45 dark:bg-white/[0.025]">
                <tr>
                  <th className="px-5 py-3 font-medium">{t('aiProviders.modelsConfig.columns.config')}</th>
                  <th className="px-4 py-3 font-medium">{t('aiProviders.modelsConfig.columns.capability')}</th>
                  <th className="px-4 py-3 font-medium">{t('aiProviders.modelsConfig.columns.testResult')}</th>
                  <th className="px-4 py-3 font-medium">{t('aiProviders.modelsConfig.columns.summary')}</th>
                  <th className="sticky right-0 z-10 w-[170px] border-l border-black/5 bg-black/[0.025] px-4 py-3 font-medium text-right backdrop-blur-sm dark:border-white/8 dark:bg-white/[0.025]">
                    {t('aiProviders.modelsConfig.columns.actions')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/6 text-[14px] dark:divide-white/8">
                {rows.map((row) => {
                  const result = resultsByRow[row.key];
                  const isDeleting = deletingRowKeys.includes(row.key);
                  const deleteDisabled = isDeleting || row.isGlobalDefault;
                  return (
                    <tr key={row.key} data-testid="models-config-row" className="align-top">
                      <td className="px-5 py-4">
                        <div className="min-w-[240px]">
                          <div className="flex items-center gap-2">
                            <div className="font-medium text-[15px] text-foreground">{row.modelId}</div>
                            {row.isGlobalDefault ? (
                              <span
                                data-testid={`models-config-global-default-badge-${row.key}`}
                                className="inline-flex items-center gap-1 rounded-full bg-amber-500/12 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400"
                              >
                                <Star className="h-3 w-3 fill-current" />
                                {t('aiProviders.modelsConfig.badges.globalDefault')}
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-1 text-[13px] text-foreground/64">
                            {row.accountLabel} · {row.vendorLabel}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex min-w-[150px] flex-wrap gap-2">
                          <span className="rounded-full bg-black/5 px-2.5 py-1 text-[12px] font-medium text-foreground/70 dark:bg-white/6">
                            {resultTypeLabel(t, row.resultType)}
                          </span>
                          <span className="rounded-full bg-black/5 px-2.5 py-1 text-[12px] font-medium text-foreground/70 dark:bg-white/6">
                            {protocolLabel(row.protocol)}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="min-w-[150px] space-y-1.5">
                          <div className={cn('flex items-center gap-1.5 text-[13px] font-medium', getStatusTone(result))}>
                            {result?.state === 'success' ? <CheckCircle2 className="h-3.5 w-3.5" /> : result?.state === 'error' ? <AlertCircle className="h-3.5 w-3.5" /> : <Clock3 className="h-3.5 w-3.5" />}
                            <span>{formatTestSummary(t, result)}</span>
                          </div>
                          <div className="text-[12px] text-foreground/56">
                            {formatTimestamp(t, result?.testedAt)}
                          </div>
                          <div className="text-[12px] text-foreground/56">
                            {typeof result?.latencyMs === 'number' ? `${result.latencyMs} ms` : t('aiProviders.modelsConfig.status.noLatency')}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="min-w-[220px] max-w-[320px]">
                          <div className="line-clamp-2 text-[13px] leading-6 text-foreground/68">
                            {formatConnectionTestOutput(t, result, row.modelId)}
                          </div>
                        </div>
                      </td>
                      <td className="sticky right-0 z-10 w-[170px] border-l border-black/5 bg-background/95 px-4 py-4 backdrop-blur-sm dark:border-white/8 dark:bg-background/95">
                        <div className="flex min-w-[146px] items-center justify-end gap-1.5">
                          {row.isGlobalDefault ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span
                                  data-testid={`models-config-global-default-indicator-${row.key}`}
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-amber-500/20 bg-amber-500/8 text-amber-600 dark:text-amber-400"
                                >
                                  <Star className="h-4 w-4 fill-current" />
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="top">{t('aiProviders.modelsConfig.tooltips.currentGlobalDefault')}</TooltipContent>
                            </Tooltip>
                          ) : (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  data-testid={`models-config-set-global-default-${row.key}`}
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 rounded-full text-foreground/55 hover:text-amber-600 dark:hover:text-amber-400"
                                  aria-label={t('aiProviders.modelsConfig.actions.setGlobalDefault')}
                                  onClick={() => void handleSetDefaultModel(row)}
                                >
                                  <Star className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="top">{t('aiProviders.modelsConfig.actions.setGlobalDefault')}</TooltipContent>
                            </Tooltip>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 rounded-full px-3 text-[12px]"
                            onClick={() => void handleTestRow(row)}
                            disabled={testingRowKey === row.key}
                            data-testid={`models-config-test-${row.key}`}
                          >
                            {testingRowKey === row.key ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                            {t('aiProviders.modelsConfig.actions.test')}
                          </Button>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button data-testid={`models-config-edit-${row.key}`} variant="ghost" size="icon" className="h-8 w-8 rounded-full text-foreground/72" aria-label={t('aiProviders.modelsConfig.actions.editConfig')} onClick={() => handleOpenEdit(row)}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="top">{t('aiProviders.modelsConfig.actions.edit')}</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                data-testid={`models-config-delete-${row.key}`}
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 rounded-full text-red-500 hover:text-red-600"
                                aria-label={t('aiProviders.modelsConfig.actions.deleteConfig')}
                                onClick={() => void handleDeleteRow(row)}
                                disabled={deleteDisabled}
                              >
                                {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                              {row.isGlobalDefault
                                ? t('aiProviders.modelsConfig.tooltips.currentGlobalDefault')
                                : t('aiProviders.modelsConfig.actions.delete')}
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent data-testid="models-config-sheet" side="right" className="w-[540px] max-w-[540px] overflow-y-auto border-l border-black/10 px-5 py-5 dark:border-white/10">
          <SheetHeader>
            <SheetTitle>{draft?.mode === 'create' ? t('aiProviders.modelsConfig.sheet.createTitle') : t('aiProviders.modelsConfig.sheet.editTitle')}</SheetTitle>
            <SheetDescription>{t('aiProviders.modelsConfig.sheet.description')}</SheetDescription>
          </SheetHeader>

          {draft && (
            <div className="mt-6 space-y-5">
              <div className="space-y-2">
                <Label htmlFor="draft-vendor">{t('aiProviders.modelsConfig.fields.vendor')}</Label>
                <Select
                  id="draft-vendor"
                  data-testid="models-config-sheet-vendor-select"
                  value={draft.vendorId}
                  onChange={(event) => updateDraft('vendorId', event.target.value as ProviderType)}
                  disabled={draft.mode === 'edit'}
                >
                  {vendorOptions.map((vendor) => (
                    <option key={vendor.id} value={vendor.id}>{getVendorDisplayName(vendor.id, vendorOptions)}</option>
                  ))}
                </Select>
                <p className="text-[12px] leading-5 text-muted-foreground">{t('aiProviders.modelsConfig.help.vendor')}</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="draft-label">{t('aiProviders.modelsConfig.fields.accountName')}</Label>
                <Input
                  id="draft-label"
                  data-testid="models-config-sheet-label-input"
                  value={draft.label}
                  onChange={(event) => updateDraft('label', event.target.value)}
                />
                <p className="text-[12px] leading-5 text-muted-foreground">{t('aiProviders.modelsConfig.help.accountName')}</p>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="draft-model">{t('aiProviders.modelsConfig.fields.modelId')}</Label>
                  <Input
                    id="draft-model"
                    data-testid="models-config-sheet-model-input"
                    list={draftRecommendedModels.length > 0 ? 'models-config-model-recommendations' : undefined}
                    value={draft.modelId}
                    onChange={(event) => updateDraft('modelId', event.target.value)}
                    placeholder={getModelPlaceholder(draft, draftRecommendedModels)}
                  />
                  {draftRecommendedModels.length > 0 ? (
                    <datalist id="models-config-model-recommendations">
                      {draftRecommendedModels.map((model) => (
                        <option key={model.value} value={model.value}>{model.label}</option>
                      ))}
                    </datalist>
                  ) : null}
                  <p className="text-[12px] leading-5 text-muted-foreground">
                    {draftRecommendedModels.length > 0
                      ? t('aiProviders.modelsConfig.help.modelRecommended', { models: formatRecommendedModels(draftRecommendedModels, t('aiProviders.modelsConfig.listSeparator')) })
                      : t('aiProviders.modelsConfig.help.model')}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="draft-protocol">{t('aiProviders.modelsConfig.fields.protocol')}</Label>
                  <Select
                    id="draft-protocol"
                    data-testid="models-config-sheet-protocol-select"
                    value={draft.apiProtocol}
                    onChange={(event) => updateDraft('apiProtocol', event.target.value as DraftState['apiProtocol'])}
                    disabled={draft.vendorId !== 'custom'}
                  >
                    <option value="openai-completions">{t('aiProviders.modelsConfig.protocolOptions.openaiCompletions')}</option>
                    <option value="openai-responses">OpenAI Responses</option>
                    <option value="anthropic-messages">Anthropic Messages</option>
                  </Select>
                  <p className="text-[12px] leading-5 text-muted-foreground">{getProtocolHelp(t, draft, draftVendorName)}</p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="draft-base-url">{t('aiProviders.modelsConfig.fields.baseUrl')}</Label>
                <Input
                  id="draft-base-url"
                  data-testid="models-config-sheet-base-url-input"
                  value={draft.baseUrl}
                  onChange={(event) => updateDraft('baseUrl', event.target.value)}
                  placeholder="https://api.example.com/v1"
                />
                <p className="text-[12px] leading-5 text-muted-foreground">{getBaseUrlHelp(t, draft, draftVendorName)}</p>
              </div>

              {draft.authMode !== 'local' && (
                <div className="space-y-2">
                  <Label htmlFor="draft-api-key">{t('aiProviders.modelsConfig.fields.apiKey')}</Label>
                  <Input id="draft-api-key" type="password" value={draft.apiKey} onChange={(event) => updateDraft('apiKey', event.target.value)} placeholder={draft.mode === 'edit' ? t('aiProviders.modelsConfig.placeholders.keepSavedKey') : t('aiProviders.modelsConfig.placeholders.apiKey', { vendor: draftVendorName })} />
                  <p className="text-[12px] leading-5 text-muted-foreground">{getApiKeyHelp(t, draft, draftVendorName)}</p>
                </div>
              )}

              <div className="rounded-2xl border border-black/10 bg-black/[0.02] p-4 dark:border-white/10 dark:bg-white/[0.03]">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[13px] font-semibold text-foreground">{t('aiProviders.modelsConfig.testCard.title')}</p>
                    <p className="mt-1 text-[12px] text-muted-foreground">{t('aiProviders.modelsConfig.testCard.description', { vendor: draftVendorName })}</p>
                  </div>
                  <span className={cn(
                    'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-medium',
                    draftTest.state === 'success'
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                      : draftTest.state === 'error'
                        ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                        : 'bg-black/5 text-foreground/55 dark:bg-white/6',
                  )}>
                    {formatTestSummary(t, draftTest)}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-3 text-[13px] text-foreground/72">
                  <div>{t('aiProviders.modelsConfig.testCard.lastTest', { value: formatTimestamp(t, draftTest.testedAt) })}</div>
                  <div>{t('aiProviders.modelsConfig.testCard.latency', { value: typeof draftTest.latencyMs === 'number' ? `${draftTest.latencyMs} ms` : '-' })}</div>
                  <div className="rounded-xl border border-black/6 bg-background px-3 py-2 dark:border-white/8">
                    {formatConnectionTestOutput(t, draftTest, draft.modelId, t('aiProviders.modelsConfig.status.notTested'))}
                  </div>
                </div>
              </div>
            </div>
          )}

          <SheetFooter className="mt-6 gap-2 border-t border-black/10 pt-4 dark:border-white/10">
            <Button variant="outline" onClick={() => setSheetOpen(false)}>{t('aiProviders.modelsConfig.actions.cancel')}</Button>
            <Button
              data-testid="models-config-sheet-test-button"
              variant="outline"
              onClick={() => void handleDraftTest()}
              disabled={!draft || draftTest.state === 'running'}
            >
              {draftTest.state === 'running' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t('aiProviders.modelsConfig.actions.testConnection')}
            </Button>
            <Button data-testid="models-config-apply-button" onClick={() => void handleApplyDraft()} disabled={!canApplyDraft}>
              {t('aiProviders.modelsConfig.actions.apply')}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
      </section>
    </TooltipProvider>
  );
}
