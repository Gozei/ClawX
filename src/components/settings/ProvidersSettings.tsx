/**
 * Providers Settings Component
 * Manage AI provider configurations and API keys
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Trash2,
  Edit,
  Eye,
  EyeOff,
  Check,
  X,
  Loader2,
  Key,
  ExternalLink,
  Copy,
  XCircle,
  ChevronDown,
  CheckCircle2,
  Tags,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { modalCardClasses, modalOverlayClasses } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import {
  useProviderStore,
  type ProviderAccount,
  type ProviderVendorInfo,
} from '@/stores/providers';
import {
  PROVIDER_TYPE_INFO,
  getProviderDocsUrl,
  type ProviderType,
  getProviderIconUrl,
  resolveProviderApiKeyForSave,
  resolveProviderModelForSave,
  shouldShowProviderModelId,
  shouldInvertInDark,
} from '@/lib/providers';
import {
  buildProviderAccountId,
  buildProviderListItems,
  hasConfiguredCredentials,
  type ProviderListItem,
  type ProviderModelSummary,
} from '@/lib/provider-accounts';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { invokeIpc } from '@/lib/api-client';
import { useSettingsStore } from '@/stores/settings';
import { hostApiFetch } from '@/lib/host-api';
import { subscribeHostEvent } from '@/lib/host-events';
import { useBranding } from '@/lib/branding';

const inputClasses = 'h-[44px] rounded-xl font-mono text-[13px] bg-white dark:bg-card border-black/10 dark:border-white/10 focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:border-blue-500 shadow-sm transition-all text-foreground placeholder:text-foreground/40';
const labelClasses = 'text-[14px] text-foreground/80 font-bold';
type ArkMode = 'apikey' | 'codeplan';
type ProviderTestResult = {
  valid: boolean;
  error?: string;
  model?: string;
  output?: string;
  latencyMs?: number;
};
type ProviderModelChipState = 'passed' | 'failed' | 'untested';
type ModelProtocol = ProviderAccount['apiProtocol'];
type EditableModelRow = { id: string; protocol: ModelProtocol };

function normalizeFallbackProviderIds(ids?: string[]): string[] {
  return Array.from(new Set((ids ?? []).filter(Boolean)));
}

function getProtocolBaseUrlPlaceholder(
  apiProtocol: ProviderAccount['apiProtocol'],
): string {
  if (apiProtocol === 'anthropic-messages') {
    return 'https://api.example.com/anthropic';
  }
  return 'https://api.example.com/v1';
}

function fallbackProviderIdsEqual(a?: string[], b?: string[]): boolean {
  const left = normalizeFallbackProviderIds(a).sort();
  const right = normalizeFallbackProviderIds(b).sort();
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function normalizeFallbackModels(models?: string[]): string[] {
  return Array.from(new Set((models ?? []).map((model) => model.trim()).filter(Boolean)));
}

function fallbackModelsEqual(a?: string[], b?: string[]): boolean {
  const left = normalizeFallbackModels(a);
  const right = normalizeFallbackModels(b);
  return left.length === right.length && left.every((model, index) => model === right[index]);
}

function normalizeConfiguredModelIds(models?: string[]): string[] {
  return Array.from(new Set((models ?? []).map((model) => model.trim()).filter(Boolean)));
}

function getConfiguredModelIds(account: ProviderAccount): string[] {
  return normalizeConfiguredModelIds([account.model || '', ...(account.metadata?.customModels ?? [])]);
}

function getEditableModelIds(item: ProviderListItem): string[] {
  return normalizeConfiguredModelIds([
    item.resolvedModel || '',
    ...item.aliases.flatMap((alias) => getConfiguredModelIds(alias)),
  ]);
}

function getModelProtocolMap(account: ProviderAccount): Record<string, ModelProtocol> {
  const raw = (account.metadata as Record<string, unknown> | undefined)?.modelProtocols;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const supported: ModelProtocol[] = ['openai-completions', 'openai-responses', 'anthropic-messages'];
  const entries = Object.entries(raw as Record<string, unknown>)
    .filter(([key, value]) => key && typeof value === 'string' && supported.includes(value as ModelProtocol));
  return Object.fromEntries(entries) as Record<string, ModelProtocol>;
}

function buildEditableModelRows(item: ProviderListItem, account: ProviderAccount): EditableModelRow[] {
  const ids = getEditableModelIds(item);
  const protocolMap = getModelProtocolMap(account);
  const defaultProtocol = account.apiProtocol || 'openai-completions';
  return ids.map((id) => ({
    id,
    protocol: protocolMap[id] || defaultProtocol,
  }));
}

function configuredModelIdsEqual(a?: string[], b?: string[]): boolean {
  const left = normalizeConfiguredModelIds(a);
  const right = normalizeConfiguredModelIds(b);
  return left.length === right.length && left.every((model, index) => model === right[index]);
}

function getUserAgentHeader(headers?: Record<string, string>): string {
  if (!headers) return '';
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === 'user-agent') {
      return value;
    }
  }
  return '';
}

function mergeHeadersWithUserAgent(
  headers: Record<string, string> | undefined,
  userAgent: string,
): Record<string, string> {
  const next = Object.fromEntries(
    Object.entries(headers ?? {}).filter(([key]) => key.toLowerCase() !== 'user-agent'),
  );
  const normalizedUserAgent = userAgent.trim();
  if (normalizedUserAgent) {
    next['User-Agent'] = normalizedUserAgent;
  }
  return next;
}

function isArkCodePlanMode(
  vendorId: string,
  baseUrl: string | undefined,
  modelId: string | undefined,
  codePlanPresetBaseUrl?: string,
  codePlanPresetModelId?: string,
): boolean {
  if (vendorId !== 'ark' || !codePlanPresetBaseUrl || !codePlanPresetModelId) return false;
  return (baseUrl || '').trim() === codePlanPresetBaseUrl && (modelId || '').trim() === codePlanPresetModelId;
}

function shouldShowUserAgentField(account: ProviderAccount): boolean {
  return account.vendorId === 'custom';
}

function shouldShowUserAgentFieldForNewProvider(providerType: ProviderType | null): boolean {
  return providerType === 'custom';
}

function getAuthModeLabel(
  authMode: ProviderAccount['authMode'],
  t: (key: string) => string
): string {
  switch (authMode) {
    case 'api_key':
      return t('aiProviders.authModes.apiKey');
    case 'oauth_device':
      return t('aiProviders.authModes.oauthDevice');
    case 'oauth_browser':
      return t('aiProviders.authModes.oauthBrowser');
    case 'local':
      return t('aiProviders.authModes.local');
    default:
      return authMode;
  }
}

export function ProvidersSettings() {
  const { t } = useTranslation('settings');
  const devModeUnlocked = useSettingsStore((state) => state.devModeUnlocked);
  const {
    statuses,
    accounts,
    vendors,
    defaultAccountId,
    loading,
    refreshProviderSnapshot,
    createAccount,
    removeAccount,
    updateAccount,
    setDefaultAccount,
    validateAccountApiKey,
    getAccountApiKey,
  } = useProviderStore();

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const vendorMap = new Map(vendors.map((vendor) => [vendor.id, vendor]));
  const existingVendorIds = new Set(accounts.map((account) => account.vendorId));
  const displayProviders = useMemo(
    () => buildProviderListItems(accounts, statuses, vendors, defaultAccountId),
    [accounts, statuses, vendors, defaultAccountId],
  );

  // Fetch providers on mount
  useEffect(() => {
    refreshProviderSnapshot();
  }, [refreshProviderSnapshot]);

  const handleAddProvider = async (
    type: ProviderType,
    name: string,
    apiKey: string,
    options?: {
      baseUrl?: string;
      model?: string;
      metadata?: ProviderAccount['metadata'];
      authMode?: ProviderAccount['authMode'];
      apiProtocol?: ProviderAccount['apiProtocol'];
      headers?: Record<string, string>;
    }
  ) => {
    const vendor = vendorMap.get(type);
    const id = buildProviderAccountId(type, null, vendors);
    const effectiveApiKey = resolveProviderApiKeyForSave(type, apiKey);
    try {
      await createAccount({
        id,
        vendorId: type,
        label: name,
        authMode: options?.authMode || vendor?.defaultAuthMode || (type === 'ollama' ? 'local' : 'api_key'),
        baseUrl: options?.baseUrl,
        apiProtocol: options?.apiProtocol,
        headers: options?.headers,
        model: options?.model,
        metadata: options?.metadata,
        enabled: true,
        isDefault: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }, effectiveApiKey);

      // Auto-set as default if no default is currently configured
      if (!defaultAccountId) {
        await setDefaultAccount(id);
      }

      setShowAddDialog(false);
      toast.success(t('aiProviders.toast.added'));
    } catch (error) {
      toast.error(`${t('aiProviders.toast.failedAdd')}: ${error}`);
    }
  };

  const handleDeleteProvider = async (item: ProviderListItem) => {
    try {
      const accountIds = Array.from(new Set(item.aliases.map((account) => account.id)));
      for (const accountId of accountIds) {
        await removeAccount(accountId);
      }
      toast.success(t('aiProviders.toast.deleted'));
    } catch (error) {
      toast.error(`${t('aiProviders.toast.failedDelete')}: ${error}`);
    }
  };

  const handleSetDefault = async (providerId: string) => {
    try {
      await setDefaultAccount(providerId);
      toast.success(t('aiProviders.toast.defaultUpdated'));
    } catch (error) {
      toast.error(`${t('aiProviders.toast.failedDefault')}: ${error}`);
    }
  };

  return (
    <div data-testid="providers-settings" className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 data-testid="providers-settings-title" className="text-3xl font-serif text-foreground font-normal tracking-tight" style={{ fontFamily: 'Georgia, Cambria, "Times New Roman", Times, serif' }}>
          {t('aiProviders.title', 'AI Providers')}
        </h2>
        <Button data-testid="providers-add-button" onClick={() => setShowAddDialog(true)} className="rounded-full px-5 h-9 shadow-none font-medium text-[13px]">
          <Plus className="h-4 w-4 mr-2" />
          {t('aiProviders.add')}
        </Button>
      </div>

      {loading && displayProviders.length === 0 ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground bg-black/5 dark:bg-white/5 rounded-3xl border border-transparent border-dashed">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : displayProviders.length === 0 ? (
        <div data-testid="providers-empty-state" className="flex flex-col items-center justify-center py-20 text-muted-foreground bg-black/5 dark:bg-white/5 rounded-3xl border border-transparent border-dashed">
          <Key className="h-12 w-12 mb-4 opacity-50" />
          <h3 className="text-[15px] font-medium mb-1 text-foreground">{t('aiProviders.empty.title')}</h3>
          <p className="text-[13px] text-center mb-6 max-w-sm">
            {t('aiProviders.empty.desc')}
          </p>
          <Button onClick={() => setShowAddDialog(true)} className="rounded-full px-6 h-10 bg-[#0a84ff] hover:bg-[#007aff] text-white">
            <Plus className="h-4 w-4 mr-2" />
            {t('aiProviders.empty.cta')}
          </Button>
        </div>
      ) : (
        <div data-testid="providers-list" className="space-y-3">
          {displayProviders.map((item) => (
            <ProviderCard
              key={item.account.id}
              item={item}
              allProviders={displayProviders}
              isDefault={item.account.id === defaultAccountId}
              isEditing={editingProvider === item.account.id}
              onEdit={() => setEditingProvider(item.account.id)}
              onCancelEdit={() => setEditingProvider(null)}
              onDelete={() => handleDeleteProvider(item)}
              onSetDefault={() => handleSetDefault(item.account.id)}
              onSaveEdits={async (payload) => {
                await updateAccount(item.account.id, payload.updates ?? {}, payload.newApiKey);
                setEditingProvider(null);
              }}
              onValidateKey={(key, options) => validateAccountApiKey(item.account.id, key, options)}
              onGetStoredKey={() => getAccountApiKey(item.account.id)}
              devModeUnlocked={devModeUnlocked}
            />
          ))}
        </div>
      )}

      {/* Add Provider Dialog */}
      {showAddDialog && (
        <AddProviderDialog
          existingVendorIds={existingVendorIds}
          vendors={vendors}
          onClose={() => setShowAddDialog(false)}
          onAdd={handleAddProvider}
          onValidateKey={(type, key, options) => validateAccountApiKey(type, key, options)}
          devModeUnlocked={devModeUnlocked}
        />
      )}
    </div>
  );
}

interface ProviderCardProps {
  item: ProviderListItem;
  allProviders: ProviderListItem[];
  isDefault: boolean;
  isEditing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
  onSetDefault: () => void;
  onSaveEdits: (payload: { newApiKey?: string; updates?: Partial<ProviderAccount> }) => Promise<void>;
  onValidateKey: (
    key: string,
    options?: { baseUrl?: string; apiProtocol?: ProviderAccount['apiProtocol'] }
  ) => Promise<{ valid: boolean; error?: string; model?: string; output?: string; latencyMs?: number }>;
  onGetStoredKey: () => Promise<string | null>;
  devModeUnlocked: boolean;
}



function ProviderCard({
  item,
  allProviders,
  isDefault,
  isEditing,
  onEdit,
  onCancelEdit,
  onDelete,
  onSetDefault,
  onSaveEdits,
  onValidateKey,
  onGetStoredKey,
  devModeUnlocked,
}: ProviderCardProps) {
  const { t, i18n } = useTranslation('settings');
  const branding = useBranding();
  const { account, vendor, status } = item;
  const [newKey, setNewKey] = useState('');
  const [initialStoredKey, setInitialStoredKey] = useState('');
  const [displayName, setDisplayName] = useState(account.label || '');
  const [baseUrl, setBaseUrl] = useState(account.baseUrl || '');
  const [apiProtocol, setApiProtocol] = useState<ProviderAccount['apiProtocol']>(account.apiProtocol || 'openai-completions');
  const [userAgent, setUserAgent] = useState(getUserAgentHeader(account.headers));
  const [modelRows, setModelRows] = useState<EditableModelRow[]>(buildEditableModelRows(item, account));
  const [fallbackModelsText, setFallbackModelsText] = useState(
    normalizeFallbackModels(account.fallbackModels).join('\n')
  );
  const [fallbackProviderIds, setFallbackProviderIds] = useState<string[]>(
    normalizeFallbackProviderIds(account.fallbackAccountIds)
  );
  const [showKey, setShowKey] = useState(false);
  const [showFallback, setShowFallback] = useState(false);
  const [validating, setValidating] = useState(false);
  const [providerTesting, setProviderTesting] = useState(false);
  const [testingModelId, setTestingModelId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingDefaultModel, setSavingDefaultModel] = useState<string | null>(null);
  const [editingUsageModelId, setEditingUsageModelId] = useState<string | null>(null);
  const [usageTagsDraft, setUsageTagsDraft] = useState('');
  const [arkMode, setArkMode] = useState<ArkMode>('apikey');
  const [testResult, setTestResult] = useState<ProviderTestResult | null>(null);
  const [modelTestResults, setModelTestResults] = useState<Record<string, ProviderTestResult>>({});
  const [modelTestConfigKeys, setModelTestConfigKeys] = useState<Record<string, string>>({});
  const [validatedTestSignature, setValidatedTestSignature] = useState<string | null>(null);

  const typeInfo = PROVIDER_TYPE_INFO.find((t) => t.id === account.vendorId);
  const providerDocsUrl = getProviderDocsUrl(typeInfo, i18n.language);
  const showModelIdField = shouldShowProviderModelId(typeInfo, devModeUnlocked);
  const codePlanPreset = typeInfo?.codePlanPresetBaseUrl && typeInfo?.codePlanPresetModelId
    ? {
      baseUrl: typeInfo.codePlanPresetBaseUrl,
      modelId: typeInfo.codePlanPresetModelId,
    }
    : null;
  const effectiveDocsUrl = account.vendorId === 'ark' && arkMode === 'codeplan'
    ? (typeInfo?.codePlanDocsUrl || providerDocsUrl)
    : providerDocsUrl;
  const canEditModelConfig = Boolean(typeInfo?.showBaseUrl || showModelIdField);
  const showUserAgentField = shouldShowUserAgentField(account);
  const modelIds = useMemo(
    () => normalizeConfiguredModelIds(modelRows.map((row) => row.id)),
    [modelRows],
  );
  const modelProtocolMap = useMemo(
    () => Object.fromEntries(
      modelRows
        .map((row) => [row.id.trim(), row.protocol] as const)
        .filter(([id]) => Boolean(id)),
    ) as Record<string, ModelProtocol>,
    [modelRows],
  );

  useEffect(() => {
    let active = true;
    if (isEditing) {
      setNewKey('');
      setInitialStoredKey('');
      setDisplayName(account.label || '');
      setShowKey(true);
      setBaseUrl(account.baseUrl || '');
      setApiProtocol(account.apiProtocol || 'openai-completions');
      setUserAgent(getUserAgentHeader(account.headers));
      setModelRows(buildEditableModelRows(item, account));
      setFallbackModelsText(normalizeFallbackModels(account.fallbackModels).join('\n'));
      setFallbackProviderIds(normalizeFallbackProviderIds(account.fallbackAccountIds));
      setModelTestResults({});
      setModelTestConfigKeys({});
      setValidatedTestSignature(null);
      setTestResult(null);
      setArkMode(
        isArkCodePlanMode(
          account.vendorId,
          account.baseUrl,
          account.model,
          typeInfo?.codePlanPresetBaseUrl,
          typeInfo?.codePlanPresetModelId,
        ) ? 'codeplan' : 'apikey'
      );
      void onGetStoredKey().then((storedKey) => {
        if (!active) return;
        const normalized = storedKey || '';
        setInitialStoredKey(normalized);
        setNewKey((current) => current || normalized);
      }).catch(() => {
        if (!active) return;
        setInitialStoredKey('');
      });
    }
    return () => {
      active = false;
    };
  }, [isEditing]);

  useEffect(() => {
    setModelTestResults((current) => Object.fromEntries(
      Object.entries(current).filter(([model]) => modelIds.includes(model)),
    ));
    setModelTestConfigKeys((current) => Object.fromEntries(
      Object.entries(current).filter(([model]) => modelIds.includes(model)),
    ));
  }, [modelIds]);

  const fallbackOptions = allProviders.filter((candidate) => candidate.account.id !== account.id);
  const normalizedNewKey = newKey.trim();
  const normalizedInitialStoredKey = initialStoredKey.trim();
  const apiKeyChanged = normalizedNewKey !== normalizedInitialStoredKey;
  const hasMeaningfulApiKeyUpdate = Boolean(normalizedNewKey) && apiKeyChanged;
  const resolvedBaseUrl = baseUrl.trim() || account.baseUrl || undefined;
  const defaultRowProtocol = modelRows[0]?.protocol;
  const resolvedProtocol = (account.vendorId === 'custom' || account.vendorId === 'ollama')
    ? (defaultRowProtocol || apiProtocol || account.apiProtocol)
    : account.apiProtocol;
  const currentModelTestConfigKey = JSON.stringify({
    apiKey: normalizedNewKey || normalizedInitialStoredKey,
    baseUrl: resolvedBaseUrl || '',
    apiProtocol: resolvedProtocol || '',
  });
  const getModelTestConfigKey = (modelId: string) => JSON.stringify({
    apiKey: normalizedNewKey || normalizedInitialStoredKey,
    baseUrl: resolvedBaseUrl || '',
    apiProtocol: modelProtocolMap[modelId] || resolvedProtocol || '',
  });
  const currentTestSignature = JSON.stringify({
    config: currentModelTestConfigKey,
    models: modelIds,
    protocols: modelProtocolMap,
  });
  const resolvedModelId = modelIds[0] || item.resolvedModel || account.model || undefined;
  const failedModelIds = modelIds.filter((model) => modelTestConfigKeys[model] === getModelTestConfigKey(model) && modelTestResults[model] && !modelTestResults[model].valid);
  const passedModelIds = modelIds.filter((model) => modelTestConfigKeys[model] === getModelTestConfigKey(model) && modelTestResults[model]?.valid);
  const modelsRequiringTest = modelIds.filter((model) => !(modelTestConfigKeys[model] === getModelTestConfigKey(model) && modelTestResults[model]?.valid));
  const hasValidatedCurrentTests = validatedTestSignature === currentTestSignature;

  const getModelChipState = (model: string): ProviderModelChipState => {
    if (modelTestConfigKeys[model] !== getModelTestConfigKey(model)) {
      return 'untested';
    }

    if (modelTestResults[model]?.valid) {
      return 'passed';
    }

    if (modelTestResults[model]) {
      return 'failed';
    }

    return 'untested';
  };
  useEffect(() => {
    if (!isEditing) return;
    setValidatedTestSignature(null);
    setTestResult(null);
  }, [isEditing, currentTestSignature]);

  const runConnectionTest = async (modelOverride?: string, protocolOverride?: ModelProtocol) => {
    const storedKey = await onGetStoredKey();
    return hostApiFetch<ProviderTestResult>(`/api/provider-accounts/${encodeURIComponent(account.id)}/test`, {
      method: 'POST',
      body: JSON.stringify({
        apiKey: normalizedNewKey || storedKey,
        baseUrl: resolvedBaseUrl,
        apiProtocol: protocolOverride || resolvedProtocol,
        model: modelOverride || resolvedModelId,
      }),
    });
  };

  const validateTestInputs = async (modelOverride?: string): Promise<string | null> => {
    const storedKey = await onGetStoredKey();
    const effectiveApiKey = (normalizedNewKey || storedKey || '').trim();
    const modelsToValidate = modelOverride ? [modelOverride] : modelIds;

    if (typeInfo?.showBaseUrl && !resolvedBaseUrl?.trim()) {
      return t('aiProviders.toast.baseUrlRequired', '基础 URL 不能为空');
    }

    if (showModelIdField && modelsToValidate.some((model) => !model.trim())) {
      return t('aiProviders.toast.modelRequired', '需要模型 ID');
    }

    if (typeInfo?.requiresApiKey && !effectiveApiKey) {
      return t('aiProviders.toast.apiKeyRequired', 'API Key 不能为空');
    }

    return null;
  };

  const runBatchModelTests = async (modelsToTest: string[]): Promise<Record<string, ProviderTestResult>> => {
    const settledResults = await Promise.all(modelsToTest.map(async (modelToTest) => {
      try {
        const result = await runConnectionTest(modelToTest, modelProtocolMap[modelToTest]);
        return [modelToTest, result] as const;
      } catch (error) {
        return [modelToTest, {
          valid: false,
          error: String(error),
          model: modelToTest,
        } as ProviderTestResult] as const;
      }
    }));
    const nextResults: Record<string, ProviderTestResult> = Object.fromEntries(settledResults);
    setModelTestResults((current) => ({ ...current, ...nextResults }));
    setModelTestConfigKeys((current) => ({
      ...current,
      ...Object.fromEntries(modelsToTest.map((model) => [model, getModelTestConfigKey(model)])),
    }));
    return nextResults;
  };

  const buildBatchTestSummary = (
    modelsToTest: string[],
    results: Record<string, ProviderTestResult>,
  ): ProviderTestResult => {
    const failures = modelsToTest
      .map((model) => results[model])
      .filter((result): result is ProviderTestResult & { model: string } => Boolean(result?.model) && !result.valid);
    const passedCount = modelsToTest.length - failures.length;
    const latencyValues = modelsToTest
      .map((model) => results[model]?.latencyMs)
      .filter((latency): latency is number => typeof latency === 'number');

    return {
      valid: failures.length === 0,
      model: modelsToTest.join(', '),
      output: t('aiProviders.toast.batchTestSummary', '{{passed}} / {{total}} 个模型测试通过', {
        passed: passedCount,
        total: modelsToTest.length,
      }),
      error: failures.length > 0
        ? failures.map((result) => `${result.model}: ${result.error || t('aiProviders.toast.testFailed', '连接测试失败')}`).join('\n')
        : undefined,
      latencyMs: latencyValues.length > 0
        ? Math.round(latencyValues.reduce((sum, value) => sum + value, 0) / latencyValues.length)
        : undefined,
    };
  };

  const buildTestSuccessMessage = (result: ProviderTestResult): string => {
    const parts = [
      result.model ? `${t('aiProviders.toast.testModel', '模型')}: ${result.model}` : '',
      typeof result.latencyMs === 'number' ? `${t('aiProviders.toast.testLatency', '耗时')}: ${result.latencyMs}ms` : '',
      result.output ? `${t('aiProviders.toast.testOutput', '输出')}: ${result.output}` : '',
    ].filter(Boolean);

    return parts.join(' | ') || t('aiProviders.toast.testSuccess', '连接测试成功');
  };

  const handleAddModelRow = () => {
    if (failedModelIds.length > 0) {
      toast.warning(t('aiProviders.toast.removeFailedModelsBeforeAdd', '请先删除测试失败的模型 ID，再继续添加'));
      return;
    }
    setModelRows((current) => ([...current, { id: '', protocol: resolvedProtocol || 'openai-completions' }]));
    setTestResult(null);
  };

  const handleRemoveModelId = (rowIndex: number, modelIdToRemove: string) => {
    setModelRows((current) => current.filter((_, index) => index !== rowIndex));
    setModelTestResults((current) => {
      const next = { ...current };
      delete next[modelIdToRemove];
      return next;
    });
    setModelTestConfigKeys((current) => {
      const next = { ...current };
      delete next[modelIdToRemove];
      return next;
    });
    setTestResult(null);
  };

  const handleModelRowChange = (rowIndex: number, nextId: string) => {
    setModelRows((current) => current.map((row, index) => (
      index === rowIndex ? { ...row, id: nextId } : row
    )));
    setTestResult(null);
  };

  const handleModelRowProtocolChange = (rowIndex: number, protocol: ModelProtocol) => {
    setModelRows((current) => current.map((row, index) => (
      index === rowIndex ? { ...row, protocol } : row
    )));
    setTestResult(null);
  };

  const handleProviderTestConnection = async () => {
    setProviderTesting(true);
    try {
      const inputError = await validateTestInputs();
      if (inputError) {
        toast.error(inputError);
        return;
      }

      if (isEditing && showModelIdField) {
        if (modelIds.length === 0) {
          toast.error(t('aiProviders.toast.modelRequired', '需要模型 ID'));
          return;
        }

        if (modelsRequiringTest.length === 0) {
          if (passedModelIds.length > 0) {
            setValidatedTestSignature(currentTestSignature);
            setTestResult(buildBatchTestSummary(modelIds, modelTestResults));
            toast.success(t('aiProviders.toast.reusePassedModelTests', '已沿用已通过的模型测试结果'));
          }
          return;
        }

        const results = await runBatchModelTests(modelsRequiringTest);
        const mergedResults = { ...modelTestResults, ...results };
        const summary = buildBatchTestSummary(modelIds, mergedResults);
        setTestResult(summary);

        const nextFailedModelIds = modelIds.filter((model) => {
          const result = mergedResults[model];
          const modelConfigKey = getModelTestConfigKey(model);
          const isCurrentConfig = (modelsRequiringTest.includes(model) ? modelConfigKey : modelTestConfigKeys[model]) === modelConfigKey;
          return isCurrentConfig && result && !result.valid;
        });
        if (nextFailedModelIds.length > 0) {
          setValidatedTestSignature(null);
          toast.error(t('aiProviders.toast.testFailedModels', '以下模型测试失败：{{models}}', {
            models: nextFailedModelIds.join(', '),
          }));
          return;
        }

        const nextPassedModelIds = modelIds.filter((model) => {
          const result = mergedResults[model];
          const modelConfigKey = getModelTestConfigKey(model);
          const isCurrentConfig = (modelsRequiringTest.includes(model) ? modelConfigKey : modelTestConfigKeys[model]) === modelConfigKey;
          return isCurrentConfig && Boolean(result?.valid);
        });
        if (nextPassedModelIds.length > 0) {
          setValidatedTestSignature(currentTestSignature);
        }

        toast.success(t('aiProviders.toast.testAllModelsPassed', '{{count}} 个模型测试通过', {
          count: modelsRequiringTest.length,
        }));
        return;
      }

      const result = await runConnectionTest();
      setTestResult(result);

      if (!result.valid) {
        toast.error(result.error || t('aiProviders.toast.testFailed', '连接测试失败'));
        return;
      }

      const parts = [
        result.model ? `${t('aiProviders.toast.testModel', '模型')}: ${result.model}` : '',
        typeof result.latencyMs === 'number' ? `${t('aiProviders.toast.testLatency', '耗时')}: ${result.latencyMs}ms` : '',
        result.output ? `${t('aiProviders.toast.testOutput', '输出')}: ${result.output}` : '',
      ].filter(Boolean);
      toast.success(parts.join(' | ') || t('aiProviders.toast.testSuccess', '连接测试成功'));
    } catch (error) {
      toast.error(`${t('aiProviders.toast.testFailed', '连接测试失败')}: ${error}`);
    } finally {
      setProviderTesting(false);
      setTestingModelId(null);
    }
  };

  const handleModelTestConnection = async (modelOverride: string) => {
    setTestingModelId(modelOverride);
    try {
      const inputError = await validateTestInputs(modelOverride);
      if (inputError) {
        toast.error(inputError);
        return;
      }

      const result = await runConnectionTest(modelOverride, modelProtocolMap[modelOverride]);
      const nextResults = { ...modelTestResults, [modelOverride]: result };
      const nextConfigKeys = { ...modelTestConfigKeys, [modelOverride]: getModelTestConfigKey(modelOverride) };
      setModelTestResults((current) => ({ ...current, [modelOverride]: result }));
      setModelTestConfigKeys((current) => ({ ...current, [modelOverride]: getModelTestConfigKey(modelOverride) }));
      if (!result.valid) {
        setValidatedTestSignature(null);
        toast.error(result.error || t('aiProviders.toast.testFailed', '连接测试失败'));
      } else if (modelIds.every((model) => nextConfigKeys[model] === getModelTestConfigKey(model) && nextResults[model]?.valid)) {
        setValidatedTestSignature(currentTestSignature);
        toast.success(buildTestSuccessMessage(result));
      } else {
        toast.success(buildTestSuccessMessage(result));
      }
    } catch (error) {
      toast.error(`${t('aiProviders.toast.testFailed', '连接测试失败')}: ${error}`);
      const nextResults = {
        ...modelTestResults,
        [modelOverride]: {
          valid: false,
          error: String(error),
          model: modelOverride,
        },
      };
      setModelTestResults((current) => ({
        ...current,
        [modelOverride]: {
          valid: false,
          error: String(error),
          model: modelOverride,
        },
      }));
      setModelTestConfigKeys((current) => ({ ...current, [modelOverride]: getModelTestConfigKey(modelOverride) }));
      setValidatedTestSignature(null);
      if (modelIds.every((model) => modelTestConfigKeys[model] === getModelTestConfigKey(model) && nextResults[model]?.valid)) {
        setValidatedTestSignature(currentTestSignature);
      }
    } finally {
      setTestingModelId(null);
    }
  };

  const handleSetDefaultModel = async (modelIdToSet: string) => {
    setSavingDefaultModel(modelIdToSet);
    try {
      await onSaveEdits({ updates: { model: modelIdToSet } });
      toast.success(t('aiProviders.toast.defaultUpdated', '默认模型已更新'));
    } catch (error) {
      toast.error(`${t('aiProviders.toast.failedUpdate')}: ${error}`);
    } finally {
      setSavingDefaultModel(null);
    }
  };

  const handleSaveUsageTags = async (modelIdToSet: string) => {
    const nextTags = Array.from(new Set(usageTagsDraft.split(/[,，\n]/).map((tag) => tag.trim()).filter(Boolean)));
    const currentTags = { ...(account.metadata?.modelUsageTags ?? {}) };
    if (nextTags.length > 0) {
      currentTags[modelIdToSet] = nextTags;
    } else {
      delete currentTags[modelIdToSet];
    }

    try {
      await onSaveEdits({
        updates: {
          metadata: {
            ...(account.metadata ?? {}),
            modelUsageTags: currentTags,
          },
        },
      });
      setEditingUsageModelId(null);
      toast.success(t('aiProviders.toast.updated'));
    } catch (error) {
      toast.error(`${t('aiProviders.toast.failedUpdate')}: ${error}`);
    }
  };

  const toggleFallbackProvider = (providerId: string) => {
    setFallbackProviderIds((current) => (
      current.includes(providerId)
        ? current.filter((id) => id !== providerId)
        : [...current, providerId]
    ));
  };

  const handleSaveEdits = async () => {
    setSaving(true);
    try {
      const payload: { newApiKey?: string; updates?: Partial<ProviderAccount> } = {};
      const normalizedDisplayName = displayName.trim();
      const normalizedFallbackModels = normalizeFallbackModels(fallbackModelsText.split('\n'));

      if (providerTesting || Boolean(testingModelId)) {
        toast.warning(t('aiProviders.toast.testInProgressBeforeSave', '请等待测试完成后再保存'));
        setSaving(false);
        return;
      }

      if (hasMeaningfulApiKeyUpdate) {
        setValidating(true);
        const result = await onValidateKey(normalizedNewKey, {
          baseUrl: baseUrl.trim() || undefined,
          apiProtocol: (account.vendorId === 'custom' || account.vendorId === 'ollama') ? resolvedProtocol : undefined,
        });
        setValidating(false);
        if (!result.valid) {
          toast.error(result.error || t('aiProviders.toast.invalidKey'));
          setSaving(false);
          return;
        }
        payload.newApiKey = normalizedNewKey;
      }

      {
        if (showModelIdField && modelIds.length === 0) {
          toast.error(t('aiProviders.toast.modelRequired'));
          setSaving(false);
          return;
        }

        if (showModelIdField) {
          const inputError = await validateTestInputs();
          if (inputError) {
            toast.error(inputError);
            setSaving(false);
            return;
          }
          setProviderTesting(true);
          const testResults = await runBatchModelTests(modelIds);
          const summary = buildBatchTestSummary(modelIds, testResults);
          setTestResult(summary);
          setProviderTesting(false);
          const failedIds = modelIds.filter((modelId) => !testResults[modelId]?.valid);
          if (failedIds.length > 0) {
            setValidatedTestSignature(null);
            toast.error(t('aiProviders.toast.testFailedModels', '以下模型测试失败：{{models}}', {
              models: failedIds.join(', '),
            }));
            setSaving(false);
            return;
          }
          setValidatedTestSignature(currentTestSignature);
          toast.success(t('aiProviders.toast.testAllModelsPassed', '{{count}} 个模型测试通过', {
            count: modelIds.length,
          }));
        }

        const updates: Partial<ProviderAccount> = {};
        if (normalizedDisplayName && normalizedDisplayName !== account.label) {
          updates.label = normalizedDisplayName;
        }
        if (typeInfo?.showBaseUrl && (baseUrl.trim() || undefined) !== (account.baseUrl || undefined)) {
          updates.baseUrl = baseUrl.trim() || undefined;
        }
        const defaultModelProtocol = modelProtocolMap[modelIds[0]];
        if ((account.vendorId === 'custom' || account.vendorId === 'ollama') && defaultModelProtocol && defaultModelProtocol !== account.apiProtocol) {
          updates.apiProtocol = defaultModelProtocol;
        }
        if (showModelIdField && (modelIds[0] || undefined) !== (account.model || undefined)) {
          updates.model = modelIds[0] || undefined;
        }
        if (showModelIdField) {
          const nextCustomModels = modelIds.slice(1);
          const currentCustomModels = normalizeConfiguredModelIds(account.metadata?.customModels);
          if (configuredModelIdsEqual(nextCustomModels, currentCustomModels) === false) {
            const nextMetadata = { ...(account.metadata ?? {}) };
            if (nextCustomModels.length > 0) {
              nextMetadata.customModels = nextCustomModels;
            } else {
              delete nextMetadata.customModels;
            }
            const nextModelProtocols = Object.fromEntries(
              modelIds
                .map((modelId) => [modelId, modelProtocolMap[modelId]] as const)
                .filter(([, protocol]) => Boolean(protocol)),
            );
            if (Object.keys(nextModelProtocols).length > 0) {
              nextMetadata.modelProtocols = nextModelProtocols;
            } else {
              delete (nextMetadata as Record<string, unknown>).modelProtocols;
            }
            updates.metadata = nextMetadata;
          } else {
            const currentProtocols = getModelProtocolMap(account);
            const nextProtocols = Object.fromEntries(
              modelIds
                .map((modelId) => [modelId, modelProtocolMap[modelId]] as const)
                .filter(([, protocol]) => Boolean(protocol)),
            ) as Record<string, ModelProtocol>;
            if (JSON.stringify(currentProtocols) !== JSON.stringify(nextProtocols)) {
              const nextMetadata = { ...(account.metadata ?? {}) } as Record<string, unknown>;
              if (Object.keys(nextProtocols).length > 0) {
                nextMetadata.modelProtocols = nextProtocols;
              } else {
                delete nextMetadata.modelProtocols;
              }
              updates.metadata = nextMetadata as ProviderAccount['metadata'];
            }
          }
        }
        const existingUserAgent = getUserAgentHeader(account.headers).trim();
        const nextUserAgent = userAgent.trim();
        if (nextUserAgent !== existingUserAgent) {
          updates.headers = mergeHeadersWithUserAgent(account.headers, nextUserAgent);
        }
        if (!fallbackModelsEqual(normalizedFallbackModels, account.fallbackModels)) {
          updates.fallbackModels = normalizedFallbackModels;
        }
        if (!fallbackProviderIdsEqual(fallbackProviderIds, account.fallbackAccountIds)) {
          updates.fallbackAccountIds = normalizeFallbackProviderIds(fallbackProviderIds);
        }
        if (Object.keys(updates).length > 0) {
          payload.updates = updates;
        }
      }

      // Keep Ollama key optional in UI, but persist a placeholder when
      // editing legacy configs that have no stored key.
      if (account.vendorId === 'ollama' && !status?.hasKey && !payload.newApiKey) {
        payload.newApiKey = resolveProviderApiKeyForSave(account.vendorId, '') as string;
      }

      if (!payload.newApiKey && !payload.updates) {
        onCancelEdit();
        setSaving(false);
        return;
      }

      await onSaveEdits(payload);
      setNewKey('');
      toast.success(t('aiProviders.toast.updated'));
    } catch (error) {
      toast.error(`${t('aiProviders.toast.failedUpdate')}: ${error}`);
    } finally {
      setProviderTesting(false);
      setTestingModelId(null);
      setSaving(false);
      setValidating(false);
    }
  };

  const currentInputClasses = isDefault
    ? "h-[40px] rounded-xl font-mono text-[13px] bg-white dark:bg-card border-black/10 dark:border-white/10 focus-visible:ring-2 focus-visible:ring-blue-500/50 shadow-sm"
    : inputClasses;

  const currentLabelClasses = isDefault ? "text-[13px] text-muted-foreground" : labelClasses;
  const currentSectionLabelClasses = isDefault ? "text-[14px] font-bold text-foreground/80" : labelClasses;
  const configuredModels = item.models.filter((model) => model.source !== 'recommended');
  const modelCountLabel = t('aiProviders.card.modelCount', '共 {{count}} 个模型', { count: configuredModels.length });

  return (
    <div
      data-testid={`provider-card-${account.id}`}
      className={cn(
        "group flex flex-col p-4 rounded-2xl transition-all relative overflow-hidden hover:bg-black/5 dark:hover:bg-white/5",
        isDefault
          ? "bg-black/[0.04] dark:bg-white/[0.06] border border-black/10 dark:border-white/10"
          : "bg-transparent border border-black/10 dark:border-white/10"
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="h-[42px] w-[42px] shrink-0 flex items-center justify-center text-foreground border border-black/5 dark:border-white/10 rounded-full bg-black/5 dark:bg-white/5 shadow-sm group-hover:scale-105 transition-transform">
            {getProviderIconUrl(account.vendorId) ? (
              <img src={getProviderIconUrl(account.vendorId)} alt={typeInfo?.name || account.vendorId} className={cn('h-5 w-5', shouldInvertInDark(account.vendorId) && 'dark:invert')} />
            ) : (
              <span className="text-xl">{vendor?.icon || typeInfo?.icon || '⚙️'}</span>
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span data-testid={`provider-name-${account.id}`} className="font-semibold text-[15px]">{item.displayName}</span>
              {isDefault && (
                <span className="flex items-center gap-1 font-mono text-[10px] font-medium px-2 py-0.5 rounded-full bg-black/[0.04] dark:bg-white/[0.08] border-0 shadow-none text-foreground/70">
                  <Check className="h-3 w-3" />
                  {t('aiProviders.card.default')}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5 text-[13px] text-muted-foreground">
              <span>{item.displayVendorName}</span>
              <span className="w-1 h-1 rounded-full bg-black/20 dark:bg-white/20" />
              <span>{getAuthModeLabel(account.authMode, t)}</span>
              {item.resolvedModel && (
                <>
                  <span className="w-1 h-1 rounded-full bg-black/20 dark:bg-white/20" />
                  <span className="truncate max-w-[220px]">{item.resolvedModel}</span>
                </>
              )}
              <span className="w-1 h-1 rounded-full bg-black/20 dark:bg-white/20" />
              <span className="flex items-center gap-1">
                {item.hasConfiguredCredentials ? (
                  <><div className="w-1.5 h-1.5 rounded-full bg-green-500" /> {t('aiProviders.card.configured')}</>
                ) : (
                  <><div className="w-1.5 h-1.5 rounded-full bg-red-500" /> {t('aiProviders.dialog.apiKeyMissing')}</>
                )}
              </span>
              {item.aliases.length > 1 && (
                <>
                  <span className="w-1 h-1 rounded-full bg-black/20 dark:bg-white/20" />
                  <span className="truncate max-w-[160px]">
                    {t('aiProviders.card.mergedAliases', '已合并 {{count}} 个重复配置', { count: item.aliases.length })}
                  </span>
                </>
              )}
              {((account.fallbackModels?.length ?? 0) > 0 || (account.fallbackAccountIds?.length ?? 0) > 0) && (
                <>
                  <span className="w-1 h-1 rounded-full bg-black/20 dark:bg-white/20" />
                  <span className="truncate max-w-[150px]" title={t('aiProviders.sections.fallback')}>
                    {t('aiProviders.sections.fallback')}: {[
                      ...normalizeFallbackModels(account.fallbackModels),
                      ...normalizeFallbackProviderIds(account.fallbackAccountIds)
                        .map((fallbackId) => allProviders.find((candidate) => candidate.account.id === fallbackId)?.account.label)
                        .filter(Boolean),
                    ].join(', ')}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {!isEditing && (
          <div className="flex items-center gap-1">
            {!isDefault && (
            <Button
              data-testid={`provider-set-default-${account.id}`}
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full text-muted-foreground hover:text-blue-600 hover:bg-white dark:hover:bg-card shadow-sm"
                onClick={onSetDefault}
                title={t('aiProviders.card.setDefault')}
              >
                <Check className="h-4 w-4" />
              </Button>
            )}
            <Button
              data-testid={`provider-test-${account.id}`}
              variant="outline"
              className="h-8 rounded-full px-3 border-black/10 dark:border-white/10 bg-white/80 dark:bg-card/80 hover:bg-white dark:hover:bg-card shadow-sm text-[12px]"
              onClick={() => void handleProviderTestConnection()}
              title={t('aiProviders.card.testConnection', '测试连接')}
              disabled={providerTesting || saving}
            >
              {providerTesting && !saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1 h-3.5 w-3.5" />}
              {t('aiProviders.card.testButton', '测试')}
            </Button>
            <Button
              data-testid={`provider-edit-${account.id}`}
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-white dark:hover:bg-card shadow-sm"
              onClick={onEdit}
              title={t('aiProviders.card.editKey')}
            >
              <Edit className="h-4 w-4" />
            </Button>
            <Button
              data-testid={`provider-delete-${account.id}`}
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full text-muted-foreground hover:text-destructive hover:bg-white dark:hover:bg-card shadow-sm"
              onClick={onDelete}
              title={t('aiProviders.card.delete')}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {!isEditing && configuredModels.length > 0 && (
        <div className="mt-4 rounded-2xl border border-black/5 dark:border-white/10 bg-white/40 dark:bg-white/[0.03] px-4 py-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-[13px] font-semibold text-foreground">
                {t('aiProviders.card.modelListTitle', '可用模型')}
              </p>
              <p className="mt-1 text-[12px] text-muted-foreground">
                {modelCountLabel}
              </p>
            </div>
            {item.resolvedModel ? (
              <div className="rounded-full bg-[#eff6ff] px-3 py-1 text-[11px] font-medium text-[#2563eb] dark:bg-[#172554] dark:text-[#93c5fd]">
                {t('aiProviders.card.defaultModel', '默认模型')}: {item.resolvedModel}
              </div>
            ) : null}
          </div>

          <div className="space-y-2">
            {configuredModels.map((model, index) => (
              <ProviderModelRow
                key={`${item.account.id}-${model.id}`}
                model={model}
                index={index}
                defaultLabel={t('aiProviders.card.default', '默认')}
                usageLabel={t('aiProviders.card.primaryUse', '主要场景')}
                setDefaultLabel={t('aiProviders.card.setDefaultModel', '设为默认')}
                testLabel={t('aiProviders.card.testModelCta', '测试该模型')}
                usageEditLabel={t('aiProviders.card.editUsageTags', '标注用途')}
                usagePlaceholder={t('aiProviders.card.usageTagsPlaceholder', '例如：公文写作，客服，代码')}
                testButtonTestId={`provider-model-test-${item.account.id}-${encodeURIComponent(model.id)}`}
                onSetDefault={() => void handleSetDefaultModel(model.id)}
                onTest={() => void handleModelTestConnection(model.id)}
                isSettingDefault={savingDefaultModel === model.id}
                isTesting={testingModelId === model.id}
                testResult={modelTestResults[model.id] || null}
                isEditingUsage={editingUsageModelId === model.id}
                usageDraft={editingUsageModelId === model.id ? usageTagsDraft : model.manualUsageTags.join('，')}
                onStartEditUsage={() => {
                  setEditingUsageModelId(model.id);
                  setUsageTagsDraft(model.manualUsageTags.join('，'));
                }}
                onUsageDraftChange={setUsageTagsDraft}
                onCancelEditUsage={() => setEditingUsageModelId(null)}
                onSaveUsage={() => void handleSaveUsageTags(model.id)}
              />
            ))}
          </div>
        </div>
      )}

      {isEditing && (
        <div className="space-y-6 mt-4 pt-4 border-t border-black/5 dark:border-white/5">
          {effectiveDocsUrl && (
            <div className="flex justify-end -mt-2 mb-2">
              <a
                href={effectiveDocsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[12px] text-blue-500 hover:text-blue-600 font-medium inline-flex items-center gap-1"
              >
                {t('aiProviders.dialog.customDoc')}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor={`provider-edit-name-${account.id}`} className={currentLabelClasses}>
              {t('aiProviders.dialog.displayName')}
            </Label>
            <Input
              id={`provider-edit-name-${account.id}`}
              data-testid={`provider-edit-name-${account.id}`}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={account.label || (typeInfo?.id === 'custom' ? t('aiProviders.custom') : typeInfo?.name || '')}
              className={cn(currentInputClasses, 'font-sans')}
            />
          </div>
          {canEditModelConfig && (
            <div className="space-y-3">
              <p className={currentSectionLabelClasses}>{t('aiProviders.sections.model')}</p>
              {typeInfo?.showBaseUrl && (
                <div className="space-y-1.5">
                  <Label className={currentLabelClasses}>{t('aiProviders.dialog.baseUrl')}</Label>
                  <Input
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder={getProtocolBaseUrlPlaceholder(resolvedProtocol)}
                    className={currentInputClasses}
                  />
                </div>
              )}
              {showModelIdField && (
                <div className="space-y-1.5 pt-2">
                  <div className="flex items-center gap-2">
                    <Label className={currentLabelClasses}>{t('aiProviders.dialog.model', '模型')}</Label>
                    <Button
                      type="button"
                      data-testid={`provider-edit-add-model-${account.id}`}
                      variant="outline"
                      onClick={handleAddModelRow}
                      className="h-9 rounded-xl border-black/10 dark:border-white/10 bg-white dark:bg-card hover:bg-black/5 dark:hover:bg-white/10 px-3"
                    >
                      {t('aiProviders.dialog.addModelRow', '新增模型')}
                    </Button>
                  </div>
                  <div className="space-y-2">
                    <div className="grid gap-2 grid-cols-[minmax(0,1fr)_220px_44px]">
                      <p className="text-center text-[12px] text-muted-foreground">{t('aiProviders.dialog.modelId', '模型ID')}</p>
                      <p className="text-center text-[12px] text-muted-foreground">{t('aiProviders.dialog.protocol', '协议')}</p>
                      <p className="text-center text-[12px] text-muted-foreground">{t('aiProviders.dialog.delete', '删除')}</p>
                    </div>
                    {modelRows.map((row, index) => {
                      const modelId = row.id.trim();
                      const modelState = modelId ? getModelChipState(modelId) : 'untested';
                      const modelResult = modelId ? modelTestResults[modelId] : null;
                      return (
                        <div
                          key={`${account.id}-model-row-${index}`}
                          className="grid gap-2 grid-cols-[minmax(0,1fr)_220px_44px]"
                        >
                          <div>
                            <Input
                              data-testid={`provider-edit-model-input-${account.id}-${index}`}
                              value={row.id}
                              onChange={(e) => handleModelRowChange(index, e.target.value)}
                              placeholder={typeInfo?.modelIdPlaceholder || 'provider/model-id'}
                              className={cn(
                                currentInputClasses,
                                modelState === 'passed' && 'border-emerald-500/60 focus-visible:border-emerald-500',
                                modelState === 'failed' && 'border-red-500/60 focus-visible:border-red-500',
                              )}
                            />
                            {modelResult && modelState === 'passed' && (
                              <p className="mt-1 text-[12px] text-emerald-600 dark:text-emerald-400">
                                {t('aiProviders.toast.testSuccess', '连接测试成功')}
                              </p>
                            )}
                            {modelResult && modelState === 'failed' && (
                              <p className="mt-1 text-[12px] text-red-600 dark:text-red-400">
                                {modelResult.error || t('aiProviders.toast.testFailed', '连接测试失败')}
                              </p>
                            )}
                          </div>
                          <Select
                            value={row.protocol}
                            onChange={(e) => handleModelRowProtocolChange(index, e.target.value as ModelProtocol)}
                            className={cn(currentInputClasses, 'font-sans')}
                          >
                            <option value="openai-completions">{t('aiProviders.protocols.openaiCompletions', 'OpenAI Completions')}</option>
                            <option value="openai-responses">{t('aiProviders.protocols.openaiResponses', 'OpenAI Responses')}</option>
                            <option value="anthropic-messages">{t('aiProviders.protocols.anthropic', 'Anthropic')}</option>
                          </Select>
                          <Button
                            type="button"
                            variant="outline"
                            data-testid={`provider-edit-remove-model-${account.id}-${index}`}
                            onClick={() => handleRemoveModelId(index, modelId)}
                            className="rounded-xl border-black/10 dark:border-white/10 bg-white dark:bg-card hover:bg-black/5 dark:hover:bg-white/10"
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {account.vendorId === 'ark' && codePlanPreset && (
                <div className="space-y-1.5 pt-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label className={currentLabelClasses}>{t('aiProviders.dialog.codePlanPreset')}</Label>
                    {typeInfo?.codePlanDocsUrl && (
                      <a
                        href={typeInfo.codePlanDocsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[12px] text-blue-500 hover:text-blue-600 font-medium inline-flex items-center gap-1"
                      >
                        {t('aiProviders.dialog.codePlanDoc')}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                  <div className="flex gap-2 text-[13px]">
                    <button
                      type="button"
                      onClick={() => {
                        setArkMode('apikey');
                        setBaseUrl(typeInfo?.defaultBaseUrl || '');
                        if (modelIds[0] === codePlanPreset.modelId) {
                          setModelIds((current) => normalizeConfiguredModelIds([
                            typeInfo?.defaultModelId || '',
                            ...current.slice(1),
                          ]));
                        }
                      }}
                      className={cn("flex-1 py-1.5 px-3 rounded-lg border transition-colors", arkMode === 'apikey' ? "bg-white dark:bg-card border-black/20 dark:border-white/20 shadow-sm font-medium" : "border-transparent bg-black/5 dark:bg-white/5 text-muted-foreground hover:bg-black/10 dark:hover:bg-white/10")}
                    >
                      {t('aiProviders.authModes.apiKey')}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setArkMode('codeplan');
                        setBaseUrl(codePlanPreset.baseUrl);
                        setModelIds((current) => normalizeConfiguredModelIds([codePlanPreset.modelId, ...current.slice(1)]));
                      }}
                      className={cn("flex-1 py-1.5 px-3 rounded-lg border transition-colors", arkMode === 'codeplan' ? "bg-white dark:bg-card border-black/20 dark:border-white/20 shadow-sm font-medium" : "border-transparent bg-black/5 dark:bg-white/5 text-muted-foreground hover:bg-black/10 dark:hover:bg-white/10")}
                    >
                      {t('aiProviders.dialog.codePlanMode')}
                    </button>
                  </div>
                  {arkMode === 'codeplan' && (
                    <p className="text-[12px] text-muted-foreground">
                      {t('aiProviders.dialog.codePlanPresetDesc')}
                    </p>
                  )}
                </div>
              )}
              {showUserAgentField && (
                <div className="space-y-1.5 pt-2">
                  <Label className={currentLabelClasses}>{t('aiProviders.dialog.userAgent')}</Label>
                  <Input
                    value={userAgent}
                    onChange={(e) => setUserAgent(e.target.value)}
                    placeholder={t('aiProviders.dialog.userAgentPlaceholder', { userAgentProduct: branding.userAgentProduct })}
                    className={currentInputClasses}
                  />
                </div>
              )}
            </div>
          )}
          <div className="space-y-3">
            <button
              onClick={() => setShowFallback(!showFallback)}
              className="flex items-center justify-between w-full text-[14px] font-bold text-foreground/80 hover:text-foreground transition-colors"
            >
              <span>{t('aiProviders.sections.fallback')}</span>
              <ChevronDown className={cn("h-4 w-4 transition-transform", showFallback && "rotate-180")} />
            </button>
            {showFallback && (
              <div className="space-y-3 pt-2">
                <div className="space-y-1.5">
                  <Label className={currentLabelClasses}>{t('aiProviders.dialog.fallbackModelIds')}</Label>
                  <textarea
                    value={fallbackModelsText}
                    onChange={(e) => setFallbackModelsText(e.target.value)}
                    placeholder={t('aiProviders.dialog.fallbackModelIdsPlaceholder')}
                    className="min-h-24 w-full rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-card px-3 py-2 text-[13px] font-mono outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:border-blue-500 shadow-sm transition-all text-foreground placeholder:text-foreground/40"
                  />
                  <p className="text-[12px] text-muted-foreground">
                    {t('aiProviders.dialog.fallbackModelIdsHelp')}
                  </p>
                </div>
                <div className="space-y-2 pt-1">
                  <Label className={currentLabelClasses}>{t('aiProviders.dialog.fallbackProviders')}</Label>
                  {fallbackOptions.length === 0 ? (
                    <p className="text-[13px] text-muted-foreground">{t('aiProviders.dialog.noFallbackOptions')}</p>
                  ) : (
                    <div className={cn("space-y-2 rounded-xl border border-black/10 dark:border-white/10 p-3 shadow-sm", isDefault ? "bg-white dark:bg-card" : "bg-[#eeece3] dark:bg-muted")}>
                      {fallbackOptions.map((candidate) => (
                        <label key={candidate.account.id} className="flex items-center gap-3 text-[13px] cursor-pointer group/label">
                          <input
                            type="checkbox"
                            checked={fallbackProviderIds.includes(candidate.account.id)}
                            onChange={() => toggleFallbackProvider(candidate.account.id)}
                            className="rounded border-black/20 dark:border-white/20 text-blue-500 focus:ring-blue-500/50"
                          />
                          <span className="font-medium group-hover/label:text-blue-500 transition-colors">{candidate.account.label}</span>
                          <span className="text-[12px] text-muted-foreground">
                            {candidate.account.model || candidate.vendor?.name || candidate.account.vendorId}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label className={currentSectionLabelClasses}>{t('aiProviders.dialog.apiKey')}</Label>
                <p className="text-[12px] text-muted-foreground">
                  {hasConfiguredCredentials(account, status)
                    ? t('aiProviders.dialog.apiKeyConfigured')
                    : t('aiProviders.dialog.apiKeyMissing')}
                </p>
              </div>
              {hasConfiguredCredentials(account, status) ? (
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-green-600 dark:text-green-500 bg-green-500/10 px-2 py-1 rounded-md">
                  <div className="w-1.5 h-1.5 rounded-full bg-current" />
                  {t('aiProviders.card.configured')}
                </div>
              ) : null}
            </div>
            {typeInfo?.apiKeyUrl && (
              <div className="flex justify-start">
                <a
                  href={typeInfo.apiKeyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[13px] text-blue-500 hover:text-blue-600 hover:underline flex items-center gap-1"
                  tabIndex={-1}
                >
                  {t('aiProviders.oauth.getApiKey')} <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}
              <div className="space-y-1.5 pt-1">
                <Label className={currentLabelClasses}>{t('aiProviders.dialog.replaceApiKey')}</Label>
                <div className="relative flex-1">
                  <Input
                    type={showKey ? 'text' : 'password'}
                    placeholder={typeInfo?.requiresApiKey ? typeInfo?.placeholder : (typeInfo?.id === 'ollama' ? t('aiProviders.notRequired') : t('aiProviders.card.editKey'))}
                    value={newKey}
                    onChange={(e) => setNewKey(e.target.value)}
                    className={cn(currentInputClasses, 'pr-10')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              <p className="text-[12px] text-muted-foreground">
                {t('aiProviders.dialog.replaceApiKeyHelp')}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  data-testid={`provider-edit-test-${account.id}`}
                  variant="outline"
                  onClick={() => void handleProviderTestConnection()}
                  className="rounded-xl border-black/10 dark:border-white/10 bg-white dark:bg-card hover:bg-black/5 dark:hover:bg-white/10"
                  disabled={providerTesting || saving}
                >
                  {providerTesting && !saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                  {t('aiProviders.card.testButton', '测试')}
                </Button>
                <Button
                  type="button"
                  data-testid={`provider-edit-save-${account.id}`}
                  onClick={handleSaveEdits}
                  className={cn(
                    'rounded-xl px-4 border-black/10 dark:border-white/10 font-medium text-foreground',
                    isDefault
                      ? 'h-[40px] bg-white dark:bg-card hover:bg-black/5 dark:hover:bg-white/10'
                      : 'h-[44px] bg-white dark:bg-card hover:bg-black/5 dark:hover:bg-white/10 shadow-sm'
                  )}
                  disabled={validating || saving}
                >
                  {validating || saving ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="mr-2 h-4 w-4" />
                  )}
                  {t('aiProviders.dialog.save', 'Save')}
                </Button>
                <Button
                  type="button"
                  data-testid={`provider-edit-cancel-${account.id}`}
                  variant="ghost"
                  onClick={onCancelEdit}
                  className={cn(
                    'rounded-xl border border-black/10 dark:border-white/10',
                    isDefault
                      ? 'h-[40px] bg-transparent hover:bg-black/5 dark:hover:bg-white/10'
                      : 'h-[44px] bg-white dark:bg-card hover:bg-black/5 dark:hover:bg-white/10 shadow-sm'
                  )}
                >
                  {t('aiProviders.dialog.cancel', 'Cancel')}
                </Button>
                {failedModelIds.map((model) => (
                  <div
                    key={model}
                    className="inline-flex max-w-full items-center rounded-full bg-red-500/10 px-3 py-1 text-[12px] font-medium text-red-600 dark:text-red-300"
                  >
                    <span className="break-all font-mono">{model}</span>
                  </div>
                ))}
              </div>
              {failedModelIds.length > 0 ? (
                <p className="text-[12px] text-red-500">
                  {t('aiProviders.card.failedModelsHint', '请先删除测试失败的模型 ID，才能继续添加或保存。')}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ProviderModelRow({
  model,
  index,
  defaultLabel,
  usageLabel,
  setDefaultLabel,
  testLabel,
  testButtonTestId,
  usageEditLabel,
  usagePlaceholder,
  onSetDefault,
  onTest,
  isSettingDefault,
  isTesting,
  testResult,
  isEditingUsage,
  usageDraft,
  onStartEditUsage,
  onUsageDraftChange,
  onCancelEditUsage,
  onSaveUsage,
}: {
  model: ProviderModelSummary;
  index: number;
  defaultLabel: string;
  usageLabel: string;
  setDefaultLabel: string;
  testLabel: string;
  testButtonTestId?: string;
  usageEditLabel: string;
  usagePlaceholder: string;
  onSetDefault: () => void;
  onTest: () => void;
  isSettingDefault: boolean;
  isTesting: boolean;
  testResult: ProviderTestResult | null;
  isEditingUsage: boolean;
  usageDraft: string;
  onStartEditUsage: () => void;
  onUsageDraftChange: (value: string) => void;
  onCancelEditUsage: () => void;
  onSaveUsage: () => void;
}) {
  return (
    <div className="ml-3 rounded-xl border border-black/5 bg-black/[0.025] px-4 py-3 dark:border-white/8 dark:bg-white/[0.03]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
        <span className="w-6 shrink-0 text-[12px] font-semibold text-muted-foreground">
          {index + 1}.
        </span>
        <div className="min-w-0">
          <div className="break-all text-[14px] font-semibold text-foreground">{model.id}</div>
          {model.label !== model.id ? (
            <div className="text-[11px] text-muted-foreground">{model.label}</div>
          ) : null}
        </div>
        {model.isDefault ? (
          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
            {defaultLabel}
          </span>
        ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!model.isDefault && (
            <button
              type="button"
              onClick={onSetDefault}
              disabled={isSettingDefault}
              className="inline-flex items-center gap-1 rounded-full bg-[#2563eb] px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSettingDefault ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              {setDefaultLabel}
            </button>
          )}
          <button
            type="button"
            onClick={onTest}
            disabled={isTesting}
            data-testid={testButtonTestId}
            className="inline-flex items-center gap-1 rounded-full border border-black/10 bg-white px-3 py-1.5 text-[12px] font-medium text-foreground/80 transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-white/[0.03] dark:hover:bg-white/[0.06]"
          >
            {isTesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            {isTesting ? '测试中...' : testLabel}
          </button>
          <button
            type="button"
            onClick={onStartEditUsage}
            className="inline-flex items-center gap-1 rounded-full border border-black/10 bg-white px-3 py-1.5 text-[12px] font-medium text-foreground/80 transition hover:bg-black/5 dark:border-white/10 dark:bg-white/[0.03] dark:hover:bg-white/[0.06]"
          >
            <Tags className="h-3.5 w-3.5" />
            {usageEditLabel}
          </button>
        </div>
      </div>
      <div className="mt-1 pl-8 text-[12px] text-muted-foreground">
        {usageLabel}: {model.usageTags.join(' / ')}
      </div>
      {testResult ? (
        <div
          className={cn(
            'mt-3 ml-8 rounded-xl border px-3 py-2 text-[12px]',
            testResult.valid
              ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300'
              : 'border-red-500/20 bg-red-500/5 text-red-700 dark:text-red-300',
          )}
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-medium">{testResult.valid ? '连接成功' : '连接失败'}</span>
            {testResult.model ? <span>模型：{testResult.model}</span> : null}
            {typeof testResult.latencyMs === 'number' ? <span>耗时：{testResult.latencyMs}ms</span> : null}
          </div>
          {testResult.output ? (
            <div className="mt-1 break-words text-foreground/80 dark:text-white/80">
              输出：{testResult.output}
            </div>
          ) : null}
          {!testResult.valid && testResult.error ? (
            <div className="mt-1 break-words text-red-700 dark:text-red-300">
              错误：{testResult.error}
            </div>
          ) : null}
        </div>
      ) : null}
      {isEditingUsage ? (
        <div className="mt-3 pl-8">
          <Input
            value={usageDraft}
            onChange={(e) => onUsageDraftChange(e.target.value)}
            placeholder={usagePlaceholder}
            className="h-[40px] rounded-xl border-black/10 bg-white text-[13px] dark:border-white/10 dark:bg-white/[0.03]"
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={onSaveUsage}
              className="rounded-full bg-[#2563eb] px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-[#1d4ed8]"
            >
              保存用途
            </button>
            <button
              type="button"
              onClick={onCancelEditUsage}
              className="rounded-full border border-black/10 bg-white px-3 py-1.5 text-[12px] font-medium text-foreground/70 transition hover:bg-black/5 dark:border-white/10 dark:bg-white/[0.03]"
            >
              取消
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

interface AddProviderDialogProps {
  existingVendorIds: Set<string>;
  vendors: ProviderVendorInfo[];
  onClose: () => void;
  onAdd: (
    type: ProviderType,
    name: string,
    apiKey: string,
    options?: {
      baseUrl?: string;
      model?: string;
      metadata?: ProviderAccount['metadata'];
      authMode?: ProviderAccount['authMode'];
      apiProtocol?: ProviderAccount['apiProtocol'];
      headers?: Record<string, string>;
    }
  ) => Promise<void>;
  onValidateKey: (
    type: string,
    apiKey: string,
    options?: { baseUrl?: string; apiProtocol?: ProviderAccount['apiProtocol'] }
  ) => Promise<{ valid: boolean; error?: string }>;
  devModeUnlocked: boolean;
}

function AddProviderDialog({
  existingVendorIds,
  vendors,
  onClose,
  onAdd,
  onValidateKey,
  devModeUnlocked,
}: AddProviderDialogProps) {
  const { t, i18n } = useTranslation('settings');
  const branding = useBranding();
  const [selectedType, setSelectedType] = useState<ProviderType | null>(null);
  const [name, setName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [modelRows, setModelRows] = useState<EditableModelRow[]>([{ id: '', protocol: 'openai-completions' }]);
  const [apiProtocol, setApiProtocol] = useState<ProviderAccount['apiProtocol']>('openai-completions');
  const [showAdvancedConfig, setShowAdvancedConfig] = useState(false);
  const [userAgent, setUserAgent] = useState('');
  const [arkMode, setArkMode] = useState<ArkMode>('apikey');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  // OAuth Flow State
  const [oauthFlowing, setOauthFlowing] = useState(false);
  const [oauthData, setOauthData] = useState<{
    mode: 'device';
    verificationUri: string;
    userCode: string;
    expiresIn: number;
  } | {
    mode: 'manual';
    authorizationUrl: string;
    message?: string;
  } | null>(null);
  const [manualCodeInput, setManualCodeInput] = useState('');
  const [oauthError, setOauthError] = useState<string | null>(null);
  // For providers that support both OAuth and API key, let the user choose.
  // Default to the vendor's declared auth mode instead of hard-coding OAuth.
  const [authMode, setAuthMode] = useState<'oauth' | 'apikey'>('apikey');

  const typeInfo = PROVIDER_TYPE_INFO.find((t) => t.id === selectedType);
  const providerDocsUrl = getProviderDocsUrl(typeInfo, i18n.language);
  const showModelIdField = shouldShowProviderModelId(typeInfo, devModeUnlocked);
  const codePlanPreset = typeInfo?.codePlanPresetBaseUrl && typeInfo?.codePlanPresetModelId
    ? {
      baseUrl: typeInfo.codePlanPresetBaseUrl,
      modelId: typeInfo.codePlanPresetModelId,
    }
    : null;
  const effectiveDocsUrl = selectedType === 'ark' && arkMode === 'codeplan'
    ? (typeInfo?.codePlanDocsUrl || providerDocsUrl)
    : providerDocsUrl;
  const isOAuth = typeInfo?.isOAuth ?? false;
  const supportsApiKey = typeInfo?.supportsApiKey ?? false;
  const vendorMap = new Map(vendors.map((vendor) => [vendor.id, vendor]));
  const selectedVendor = selectedType ? vendorMap.get(selectedType) : undefined;
  const showUserAgentInAddDialog = shouldShowUserAgentFieldForNewProvider(selectedType);
  const modelIds = useMemo(
    () => normalizeConfiguredModelIds(modelRows.map((row) => row.id)),
    [modelRows],
  );
  const modelProtocolMap = useMemo(
    () => Object.fromEntries(
      modelRows
        .map((row) => [row.id.trim(), row.protocol] as const)
        .filter(([id]) => Boolean(id)),
    ) as Record<string, ModelProtocol>,
    [modelRows],
  );
  const defaultModelId = modelIds[0] || '';
  const resolvedProtocol = (selectedType === 'custom' || selectedType === 'ollama')
    ? (modelProtocolMap[defaultModelId] || apiProtocol)
    : apiProtocol;
  const preferredOAuthMode = selectedVendor?.supportedAuthModes.includes('oauth_browser')
    ? 'oauth_browser'
    : (selectedVendor?.supportedAuthModes.includes('oauth_device')
      ? 'oauth_device'
      : (selectedType === 'google' ? 'oauth_browser' : null));
  // Effective OAuth mode: pure OAuth providers, or dual-mode with oauth selected
  const useOAuthFlow = isOAuth && (!supportsApiKey || authMode === 'oauth');
  const dialogInputClasses = cn(inputClasses, 'bg-background dark:bg-muted');

  useEffect(() => {
    if (!selectedVendor || !isOAuth || !supportsApiKey) {
      return;
    }
    setAuthMode(selectedVendor.defaultAuthMode === 'api_key' ? 'apikey' : 'oauth');
  }, [selectedVendor, isOAuth, supportsApiKey]);

  useEffect(() => {
    if (selectedType !== 'ark') {
      setArkMode('apikey');
      return;
    }
    setArkMode(
      isArkCodePlanMode(
        'ark',
        baseUrl,
        defaultModelId,
        typeInfo?.codePlanPresetBaseUrl,
        typeInfo?.codePlanPresetModelId,
      ) ? 'codeplan' : 'apikey'
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedType]);

  // Keep refs to the latest values so event handlers see the current dialog state.
  const latestRef = React.useRef({ selectedType, typeInfo, onAdd, onClose, t });
  const pendingOAuthRef = React.useRef<{ accountId: string; label: string } | null>(null);
  useEffect(() => {
    latestRef.current = { selectedType, typeInfo, onAdd, onClose, t };
  });

  // Manage OAuth events
  useEffect(() => {
    const handleCode = (data: unknown) => {
      const payload = data as Record<string, unknown>;
      if (payload?.mode === 'manual') {
        setOauthData({
          mode: 'manual',
          authorizationUrl: String(payload.authorizationUrl || ''),
          message: typeof payload.message === 'string' ? payload.message : undefined,
        });
      } else {
        setOauthData({
          mode: 'device',
          verificationUri: String(payload.verificationUri || ''),
          userCode: String(payload.userCode || ''),
          expiresIn: Number(payload.expiresIn || 300),
        });
      }
      setOauthError(null);
    };

    const handleSuccess = async (data: unknown) => {
      setOauthFlowing(false);
      setOauthData(null);
      setManualCodeInput('');
      setValidationError(null);

      const { onClose: close, t: translate } = latestRef.current;
      const payload = (data as { accountId?: string } | undefined) || undefined;
      const accountId = payload?.accountId || pendingOAuthRef.current?.accountId;

      // device-oauth.ts already saved the provider config to the backend,
      // including the dynamically resolved baseUrl for the region (e.g. CN vs Global).
      // If we call add() here with undefined baseUrl, it will overwrite and erase it!
      // So we just fetch the latest list from the backend to update the UI.
      try {
        const store = useProviderStore.getState();
        await store.refreshProviderSnapshot();

        // OAuth sign-in should immediately become active default to avoid
        // leaving runtime on an API-key-only provider/model.
        if (accountId) {
          await store.setDefaultAccount(accountId);
        }
      } catch (err) {
        console.error('Failed to refresh providers after OAuth:', err);
      }

      pendingOAuthRef.current = null;
      close();
      toast.success(translate('aiProviders.toast.added'));
    };

    const handleError = (data: unknown) => {
      setOauthError((data as { message: string }).message);
      setOauthData(null);
      pendingOAuthRef.current = null;
    };

    const offCode = subscribeHostEvent('oauth:code', handleCode);
    const offSuccess = subscribeHostEvent('oauth:success', handleSuccess);
    const offError = subscribeHostEvent('oauth:error', handleError);

    return () => {
      offCode();
      offSuccess();
      offError();
    };
  }, []);

  const handleStartOAuth = async () => {
    if (!selectedType) return;

    const hasMinimax = existingVendorIds.has('minimax-portal') || existingVendorIds.has('minimax-portal-cn');
    if ((selectedType === 'minimax-portal' || selectedType === 'minimax-portal-cn') && hasMinimax) {
      toast.error(t('aiProviders.toast.minimaxConflict'));
      return;
    }

    setOauthFlowing(true);
    setOauthData(null);
    setManualCodeInput('');
    setOauthError(null);

    try {
      const vendor = vendorMap.get(selectedType);
      const supportsMultipleAccounts = vendor?.supportsMultipleAccounts ?? selectedType === 'custom';
      const accountId = supportsMultipleAccounts ? `${selectedType}-${crypto.randomUUID()}` : selectedType;
      const label = name || (typeInfo?.id === 'custom' ? t('aiProviders.custom') : typeInfo?.name) || selectedType;
      pendingOAuthRef.current = { accountId, label };
      await hostApiFetch('/api/providers/oauth/start', {
        method: 'POST',
        body: JSON.stringify({ provider: selectedType, accountId, label }),
      });
    } catch (e) {
      setOauthError(String(e));
      setOauthFlowing(false);
      pendingOAuthRef.current = null;
    }
  };

  const handleCancelOAuth = async () => {
    setOauthFlowing(false);
    setOauthData(null);
    setManualCodeInput('');
    setOauthError(null);
    pendingOAuthRef.current = null;
    await hostApiFetch('/api/providers/oauth/cancel', {
      method: 'POST',
    });
  };

  const handleSubmitManualOAuthCode = async () => {
    const value = manualCodeInput.trim();
    if (!value) return;
    try {
      await hostApiFetch('/api/providers/oauth/submit', {
        method: 'POST',
        body: JSON.stringify({ code: value }),
      });
      setOauthError(null);
    } catch (error) {
      setOauthError(String(error));
    }
  };

  const availableTypes = PROVIDER_TYPE_INFO.filter((type) => {
    // Skip providers that are temporarily hidden from the UI.
    if (type.hidden) return false;

    // MiniMax portal variants are mutually exclusive — hide BOTH variants
    // when either one already exists (account may have vendorId of either variant).
    const hasMinimax = existingVendorIds.has('minimax-portal') || existingVendorIds.has('minimax-portal-cn');
    if ((type.id === 'minimax-portal' || type.id === 'minimax-portal-cn') && hasMinimax) return false;

    const vendor = vendorMap.get(type.id);
    if (!vendor) {
      return !existingVendorIds.has(type.id) || type.id === 'custom';
    }
    return vendor.supportsMultipleAccounts || !existingVendorIds.has(type.id);
  });

  const handleAdd = async () => {
    if (!selectedType) return;

    const hasMinimax = existingVendorIds.has('minimax-portal') || existingVendorIds.has('minimax-portal-cn');
    if ((selectedType === 'minimax-portal' || selectedType === 'minimax-portal-cn') && hasMinimax) {
      toast.error(t('aiProviders.toast.minimaxConflict'));
      return;
    }

    setSaving(true);
    setValidationError(null);

    try {
      // Validate key first if the provider requires one and a key was entered
      const requiresKey = typeInfo?.requiresApiKey ?? false;
      if (requiresKey && !apiKey.trim()) {
        setValidationError(t('aiProviders.toast.invalidKey')); // reusing invalid key msg or should add 'required' msg? null checks
        setSaving(false);
        return;
      }
      if (requiresKey && apiKey) {
        const result = await onValidateKey(selectedType, apiKey, {
          baseUrl: baseUrl.trim() || undefined,
          apiProtocol: (selectedType === 'custom' || selectedType === 'ollama') ? resolvedProtocol : undefined,
        });
        if (!result.valid) {
          setValidationError(result.error || t('aiProviders.toast.invalidKey'));
          setSaving(false);
          return;
        }
      }

      const requiresModel = showModelIdField;
      if (requiresModel && modelIds.length === 0) {
        setValidationError(t('aiProviders.toast.modelRequired'));
        setSaving(false);
        return;
      }

      await onAdd(
        selectedType,
        name || (typeInfo?.id === 'custom' ? t('aiProviders.custom') : typeInfo?.name) || selectedType,
        apiKey.trim(),
        {
          baseUrl: baseUrl.trim() || undefined,
          apiProtocol: (selectedType === 'custom' || selectedType === 'ollama') ? resolvedProtocol : undefined,
          headers: userAgent.trim() ? { 'User-Agent': userAgent.trim() } : undefined,
          model: resolveProviderModelForSave(typeInfo, defaultModelId, devModeUnlocked),
          metadata: {
            ...(modelIds.length > 1 ? { customModels: modelIds.slice(1) } : {}),
            ...(Object.keys(modelProtocolMap).length > 0 ? { modelProtocols: modelProtocolMap } : {}),
          },
          authMode: useOAuthFlow ? (preferredOAuthMode || 'oauth_device') : selectedType === 'ollama'
            ? 'local'
            : (isOAuth && supportsApiKey && authMode === 'apikey')
              ? 'api_key'
              : vendorMap.get(selectedType)?.defaultAuthMode || 'api_key',
        }
      );
    } catch {
      // error already handled via toast in parent
    } finally {
      setSaving(false);
    }
  };

  return (
    <div data-testid="add-provider-dialog" className={modalOverlayClasses}>
      <Card
        data-testid="add-provider-dialog-card"
        className={cn(modalCardClasses, 'max-w-2xl rounded-3xl border-0 shadow-2xl bg-background dark:bg-card')}
      >
        <CardHeader className="relative pb-2 shrink-0">
          <CardTitle className="text-2xl font-serif font-normal">{t('aiProviders.dialog.title')}</CardTitle>
          <CardDescription className="text-[15px] mt-1 text-foreground/70">
            {t('aiProviders.dialog.desc')}
          </CardDescription>
          <Button
            data-testid="add-provider-close-button"
            variant="ghost"
            size="icon"
            className="absolute right-4 top-4 rounded-full h-8 w-8 -mr-2 -mt-2 text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="overflow-y-auto flex-1 p-6">
          {!selectedType ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {availableTypes.map((type) => (
                <button
                  data-testid={`add-provider-type-${type.id}`}
                  key={type.id}
                  onClick={() => {
                    setSelectedType(type.id);
                    setName(type.id === 'custom' ? t('aiProviders.custom') : type.name);
                    setBaseUrl(type.defaultBaseUrl || '');
                    setModelRows([{
                      id: type.defaultModelId || '',
                      protocol: 'openai-completions',
                    }]);
                    setUserAgent('');
                    setShowAdvancedConfig(false);
                    setArkMode('apikey');
                  }}
                  className="p-4 rounded-2xl border border-black/5 dark:border-white/5 hover:bg-black/5 dark:hover:bg-white/5 transition-colors text-center group"
                >
                  <div className="h-12 w-12 mx-auto mb-3 flex items-center justify-center bg-black/5 dark:bg-white/5 rounded-xl shadow-sm border border-black/5 dark:border-white/5 group-hover:scale-105 transition-transform">
                    {getProviderIconUrl(type.id) ? (
                      <img src={getProviderIconUrl(type.id)} alt={type.name} className={cn('h-6 w-6', shouldInvertInDark(type.id) && 'dark:invert')} />
                    ) : (
                      <span className="text-2xl">{type.icon}</span>
                    )}
                  </div>
                  <p className="font-medium text-[13px]">{type.id === 'custom' ? t('aiProviders.custom') : type.name}</p>
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex items-center gap-3 p-4 rounded-2xl bg-white dark:bg-card border border-black/5 dark:border-white/5 shadow-sm">
                <div className="h-10 w-10 shrink-0 flex items-center justify-center bg-black/5 dark:bg-white/5 rounded-xl">
                  {getProviderIconUrl(selectedType!) ? (
                    <img src={getProviderIconUrl(selectedType!)} alt={typeInfo?.name} className={cn('h-6 w-6', shouldInvertInDark(selectedType!) && 'dark:invert')} />
                  ) : (
                    <span className="text-xl">{typeInfo?.icon}</span>
                  )}
                </div>
                <div>
                  <p className="font-semibold text-[15px]">{typeInfo?.id === 'custom' ? t('aiProviders.custom') : typeInfo?.name}</p>
                  <button
                  onClick={() => {
                    setSelectedType(null);
                    setValidationError(null);
                    setBaseUrl('');
                    setModelRows([{ id: '', protocol: 'openai-completions' }]);
                    setUserAgent('');
                    setShowAdvancedConfig(false);
                    setArkMode('apikey');
                  }}
                  className="text-[13px] text-blue-500 hover:text-blue-600 font-medium"
                >
                    {t('aiProviders.dialog.change')}
                  </button>
                  {effectiveDocsUrl && (
                    <>
                      <span className="mx-2 text-foreground/20">|</span>
                      <a
                        href={effectiveDocsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[13px] text-blue-500 hover:text-blue-600 font-medium inline-flex items-center gap-1"
                      >
                        {t('aiProviders.dialog.customDoc')}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </>
                  )}
                </div>
              </div>

              <div className="space-y-6 bg-transparent p-0">
                <div className="space-y-2.5">
                  <Label htmlFor="name" className={labelClasses}>{t('aiProviders.dialog.displayName')}</Label>
                  <Input
                    data-testid="add-provider-name-input"
                    id="name"
                    placeholder={typeInfo?.id === 'custom' ? t('aiProviders.custom') : typeInfo?.name}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className={dialogInputClasses}
                  />
                </div>

                {/* Auth mode toggle for providers supporting both */}
                {isOAuth && supportsApiKey && (
                  <div className="flex rounded-xl border border-black/10 dark:border-white/10 overflow-hidden text-[13px] font-medium shadow-sm bg-background dark:bg-muted p-1 gap-1">
                    <button
                      onClick={() => setAuthMode('oauth')}
                      className={cn(
                        'flex-1 py-2 px-3 rounded-lg transition-colors',
                        authMode === 'oauth' ? 'bg-black/5 dark:bg-white/10 text-foreground' : 'text-muted-foreground hover:bg-black/5 dark:hover:bg-white/5'
                      )}
                    >
                      {t('aiProviders.oauth.loginMode')}
                    </button>
                    <button
                      onClick={() => setAuthMode('apikey')}
                      className={cn(
                        'flex-1 py-2 px-3 rounded-lg transition-colors',
                        authMode === 'apikey' ? 'bg-black/5 dark:bg-white/10 text-foreground' : 'text-muted-foreground hover:bg-black/5 dark:hover:bg-white/5'
                      )}
                    >
                      {t('aiProviders.oauth.apikeyMode')}
                    </button>
                  </div>
                )}

                {/* API Key input — shown for non-OAuth providers or when apikey mode is selected */}
                {(!isOAuth || (supportsApiKey && authMode === 'apikey')) && (
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="apiKey" className={labelClasses}>{t('aiProviders.dialog.apiKey')}</Label>
                      {typeInfo?.apiKeyUrl && (
                        <a
                          href={typeInfo.apiKeyUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[13px] text-blue-500 hover:text-blue-600 font-medium flex items-center gap-1"
                          tabIndex={-1}
                        >
                          {t('aiProviders.oauth.getApiKey')} <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                    <div className="relative">
                      <Input
                        data-testid="add-provider-api-key-input"
                        id="apiKey"
                        type={showKey ? 'text' : 'password'}
                        placeholder={typeInfo?.id === 'ollama' ? t('aiProviders.notRequired') : typeInfo?.placeholder}
                        value={apiKey}
                        onChange={(e) => {
                          setApiKey(e.target.value);
                          setValidationError(null);
                        }}
                        className={dialogInputClasses}
                      />
                      <button
                        type="button"
                        onClick={() => setShowKey(!showKey)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    {validationError && (
                      <p className="text-[13px] text-red-500 font-medium">{validationError}</p>
                    )}
                    <p className="text-[12px] text-muted-foreground">
                      {t('aiProviders.dialog.apiKeyStored')}
                    </p>
                  </div>
                )}

                {typeInfo?.showBaseUrl && (
                  <div className="space-y-2.5">
                    <Label htmlFor="baseUrl" className={labelClasses}>{t('aiProviders.dialog.baseUrl')}</Label>
                    <Input
                      data-testid="add-provider-base-url-input"
                      id="baseUrl"
                      placeholder={getProtocolBaseUrlPlaceholder(resolvedProtocol)}
                      value={baseUrl}
                      onChange={(e) => setBaseUrl(e.target.value)}
                      className={dialogInputClasses}
                    />
                  </div>
                )}

                {showModelIdField && (
                  <div className="space-y-2.5">
                    <div className="flex items-center gap-2">
                      <Label className={labelClasses}>{t('aiProviders.dialog.model', '模型')}</Label>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setModelRows((current) => [...current, { id: '', protocol: resolvedProtocol }])}
                        className="h-9 rounded-xl border-black/10 dark:border-white/10 bg-white dark:bg-card hover:bg-black/5 dark:hover:bg-white/10 px-3"
                      >
                        {t('aiProviders.dialog.addModelRow', '新增模型')}
                      </Button>
                    </div>
                    <div className="grid gap-2 grid-cols-[minmax(0,1fr)_220px_44px]">
                      <p className="text-center text-[12px] text-muted-foreground">{t('aiProviders.dialog.modelId', '模型ID')}</p>
                      <p className="text-center text-[12px] text-muted-foreground">{t('aiProviders.dialog.protocol', '协议')}</p>
                      <p className="text-center text-[12px] text-muted-foreground">{t('aiProviders.dialog.delete', '删除')}</p>
                    </div>
                    <div className="space-y-2">
                      {modelRows.map((row, index) => (
                        <div key={`add-model-row-${index}`} className="grid gap-2 grid-cols-[minmax(0,1fr)_220px_44px]">
                          <Input
                            data-testid={`add-provider-model-id-input-${index}`}
                            placeholder={typeInfo?.modelIdPlaceholder || 'provider/model-id'}
                            value={row.id}
                            onChange={(e) => {
                              setModelRows((current) => current.map((item, itemIndex) => (
                                itemIndex === index ? { ...item, id: e.target.value } : item
                              )));
                              setValidationError(null);
                            }}
                            className={dialogInputClasses}
                          />
                          <Select
                            value={row.protocol}
                            onChange={(e) => {
                              setModelRows((current) => current.map((item, itemIndex) => (
                                itemIndex === index ? { ...item, protocol: e.target.value as ModelProtocol } : item
                              )));
                              setValidationError(null);
                            }}
                            className={cn(dialogInputClasses, 'font-sans')}
                          >
                            <option value="openai-completions">{t('aiProviders.protocols.openaiCompletions', 'OpenAI Completions')}</option>
                            <option value="openai-responses">{t('aiProviders.protocols.openaiResponses', 'OpenAI Responses')}</option>
                            <option value="anthropic-messages">{t('aiProviders.protocols.anthropic', 'Anthropic')}</option>
                          </Select>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                              setModelRows((current) => current.filter((_, itemIndex) => itemIndex !== index));
                              setValidationError(null);
                            }}
                            className="rounded-xl border-black/10 dark:border-white/10 bg-white dark:bg-card hover:bg-black/5 dark:hover:bg-white/10"
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {selectedType === 'ark' && codePlanPreset && (
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <Label className={labelClasses}>{t('aiProviders.dialog.codePlanPreset')}</Label>
                      {typeInfo?.codePlanDocsUrl && (
                        <a
                          href={typeInfo.codePlanDocsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[13px] text-blue-500 hover:text-blue-600 font-medium inline-flex items-center gap-1"
                          tabIndex={-1}
                        >
                          {t('aiProviders.dialog.codePlanDoc')}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                    <div className="flex gap-2 text-[13px]">
                      <button
                        type="button"
                        onClick={() => {
                          setArkMode('apikey');
                          setBaseUrl(typeInfo?.defaultBaseUrl || '');
                          if (defaultModelId.trim() === codePlanPreset.modelId) {
                            setModelRows((current) => ([
                              { id: typeInfo?.defaultModelId || '', protocol: resolvedProtocol },
                              ...current.slice(1),
                            ]));
                          }
                          setValidationError(null);
                        }}
                        className={cn("flex-1 py-1.5 px-3 rounded-lg border transition-colors", arkMode === 'apikey' ? "bg-white dark:bg-card border-black/20 dark:border-white/20 shadow-sm font-medium" : "border-transparent bg-black/5 dark:bg-white/5 text-muted-foreground hover:bg-black/10 dark:hover:bg-white/10")}
                      >
                        {t('aiProviders.authModes.apiKey')}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setArkMode('codeplan');
                          setBaseUrl(codePlanPreset.baseUrl);
                          setModelRows((current) => ([
                            { id: codePlanPreset.modelId, protocol: resolvedProtocol },
                            ...current.slice(1),
                          ]));
                          setValidationError(null);
                        }}
                        className={cn("flex-1 py-1.5 px-3 rounded-lg border transition-colors", arkMode === 'codeplan' ? "bg-white dark:bg-card border-black/20 dark:border-white/20 shadow-sm font-medium" : "border-transparent bg-black/5 dark:bg-white/5 text-muted-foreground hover:bg-black/10 dark:hover:bg-white/10")}
                      >
                        {t('aiProviders.dialog.codePlanMode')}
                      </button>
                    </div>
                    {arkMode === 'codeplan' && (
                      <p className="text-[12px] text-muted-foreground">
                        {t('aiProviders.dialog.codePlanPresetDesc')}
                      </p>
                    )}
                  </div>
                )}
                {showUserAgentInAddDialog && (
                  <div className="space-y-2.5">
                    <button
                      type="button"
                      onClick={() => setShowAdvancedConfig((value) => !value)}
                      className="flex items-center justify-between w-full text-[14px] font-bold text-foreground/80 hover:text-foreground transition-colors"
                    >
                      <span>{t('aiProviders.dialog.advancedConfig')}</span>
                      <ChevronDown className={cn("h-4 w-4 transition-transform", showAdvancedConfig && "rotate-180")} />
                    </button>
                    {showAdvancedConfig && (
                      <div className="space-y-2.5 pt-1">
                        <Label htmlFor="userAgent" className={labelClasses}>{t('aiProviders.dialog.userAgent')}</Label>
                        <Input
                          id="userAgent"
                          placeholder={t('aiProviders.dialog.userAgentPlaceholder', { userAgentProduct: branding.userAgentProduct })}
                          value={userAgent}
                          onChange={(e) => setUserAgent(e.target.value)}
                          className={dialogInputClasses}
                        />
                      </div>
                    )}
                  </div>
                )}
                {/* Device OAuth Trigger — only shown when in OAuth mode */}
                {useOAuthFlow && (
                  <div className="space-y-4 pt-2">
                    <div className="rounded-xl bg-blue-500/10 border border-blue-500/20 p-5 text-center">
                      <p className="text-[13px] font-medium text-blue-600 dark:text-blue-400 mb-4 block">
                        {t('aiProviders.oauth.loginPrompt')}
                      </p>
                      <Button
                        onClick={handleStartOAuth}
                        disabled={oauthFlowing}
                        className="w-full rounded-full h-[42px] font-semibold bg-[#0a84ff] hover:bg-[#007aff] text-white shadow-sm"
                      >
                        {oauthFlowing ? (
                          <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{t('aiProviders.oauth.waiting')}</>
                        ) : (
                          t('aiProviders.oauth.loginButton')
                        )}
                      </Button>
                    </div>

                    {/* OAuth Active State Modal / Inline View */}
                    {oauthFlowing && (
                      <div className="mt-4 p-5 border border-black/10 dark:border-white/10 rounded-2xl bg-white dark:bg-card shadow-sm relative overflow-hidden">
                        {/* Background pulse effect */}
                        <div className="absolute inset-0 bg-blue-500/5 animate-pulse" />

                        <div className="relative z-10 flex flex-col items-center justify-center text-center space-y-5">
                          {oauthError ? (
                            <div className="text-red-500 space-y-3">
                              <XCircle className="h-10 w-10 mx-auto" />
                              <p className="font-semibold text-[15px]">{t('aiProviders.oauth.authFailed')}</p>
                              <p className="text-[13px] opacity-80">{oauthError}</p>
                              <Button variant="outline" size="sm" onClick={handleCancelOAuth} className="mt-2 rounded-full px-6 h-9">
                                Try Again
                              </Button>
                            </div>
                          ) : !oauthData ? (
                            <div className="space-y-4 py-6">
                              <Loader2 className="h-10 w-10 animate-spin text-blue-500 mx-auto" />
                              <p className="text-[13px] font-medium text-muted-foreground animate-pulse">{t('aiProviders.oauth.requestingCode')}</p>
                            </div>
                          ) : oauthData.mode === 'manual' ? (
                            <div className="space-y-4 w-full">
                              <div className="space-y-2">
                                <h3 className="font-semibold text-[16px] text-foreground">Complete OpenAI Login</h3>
                                <p className="text-[13px] text-muted-foreground text-left bg-black/5 dark:bg-white/5 p-4 rounded-xl">
                                  {oauthData.message || 'Open the authorization page, complete login, then paste the callback URL or code below.'}
                                </p>
                              </div>

                              <Button
                                variant="secondary"
                                className="w-full rounded-full h-[42px] font-semibold"
                                onClick={() => invokeIpc('shell:openExternal', oauthData.authorizationUrl)}
                              >
                                <ExternalLink className="h-4 w-4 mr-2" />
                                Open Authorization Page
                              </Button>

                              <Input
                                placeholder="Paste callback URL or code"
                                value={manualCodeInput}
                                onChange={(e) => setManualCodeInput(e.target.value)}
                                className={dialogInputClasses}
                              />

                              <Button
                                className="w-full rounded-full h-[42px] font-semibold bg-[#0a84ff] hover:bg-[#007aff] text-white"
                                onClick={handleSubmitManualOAuthCode}
                                disabled={!manualCodeInput.trim()}
                              >
                                Submit Code
                              </Button>

                              <Button variant="ghost" className="w-full rounded-full h-[42px] font-semibold text-muted-foreground" onClick={handleCancelOAuth}>
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            <div className="space-y-5 w-full">
                              <div className="space-y-2">
                                <h3 className="font-semibold text-[16px] text-foreground">{t('aiProviders.oauth.approveLogin')}</h3>
                                <div className="text-[13px] text-muted-foreground text-left mt-2 space-y-1.5 bg-black/5 dark:bg-white/5 p-4 rounded-xl">
                                  <p>1. {t('aiProviders.oauth.step1')}</p>
                                  <p>2. {t('aiProviders.oauth.step2')}</p>
                                  <p>3. {t('aiProviders.oauth.step3')}</p>
                                </div>
                              </div>

                              <div className="flex items-center justify-center gap-3 p-4 bg-background dark:bg-muted border border-black/5 dark:border-white/5 rounded-xl shadow-inner">
                                <code className="text-3xl font-mono tracking-[0.2em] font-bold text-foreground">
                                  {oauthData.userCode}
                                </code>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-10 w-10 rounded-full hover:bg-black/5 dark:hover:bg-white/10"
                                  onClick={() => {
                                    navigator.clipboard.writeText(oauthData.userCode);
                                    toast.success(t('aiProviders.oauth.codeCopied'));
                                  }}
                                >
                                  <Copy className="h-5 w-5" />
                                </Button>
                              </div>

                              <Button
                                variant="secondary"
                                className="w-full rounded-full h-[42px] font-semibold"
                                onClick={() => invokeIpc('shell:openExternal', oauthData.verificationUri)}
                              >
                                <ExternalLink className="h-4 w-4 mr-2" />
                                {t('aiProviders.oauth.openLoginPage')}
                              </Button>

                              <div className="flex items-center justify-center gap-2 text-[13px] font-medium text-muted-foreground pt-2">
                                <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                                <span>{t('aiProviders.oauth.waitingApproval')}</span>
                              </div>

                              <Button variant="ghost" className="w-full rounded-full h-[42px] font-semibold text-muted-foreground" onClick={handleCancelOAuth}>
                                Cancel
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <Separator className="bg-black/10 dark:bg-white/10" />

              <div className="flex justify-end gap-3">
                <Button
                  onClick={handleAdd}
                  className={cn("rounded-full px-8 h-[42px] text-[13px] font-semibold bg-[#0a84ff] hover:bg-[#007aff] text-white shadow-sm", useOAuthFlow && "hidden")}
                  disabled={!selectedType || saving || (showModelIdField && modelIds.length === 0)}
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : null}
                  {t('aiProviders.dialog.add')}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
