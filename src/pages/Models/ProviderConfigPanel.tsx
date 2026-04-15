import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Clock3, Loader2, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useProviderStore, type ProviderAccount } from '@/stores/providers';
import { hostApiFetch } from '@/lib/host-api';
import {
  PROVIDER_TYPE_INFO,
  resolveProviderApiKeyForSave,
  type ProviderAuthMode,
  type ProviderType,
} from '@/lib/providers';
import { buildProviderAccountId, buildProviderListItems } from '@/lib/provider-accounts';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

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
  output?: string;
  latencyMs?: number;
  error?: string;
  testedAt?: string;
  applied?: boolean;
};

const DEFAULT_PROTOCOL: NonNullable<ProviderAccount['apiProtocol']> = 'openai-completions';

function normalizeConfiguredModelIds(account: ProviderAccount): string[] {
  return Array.from(new Set([account.model || '', ...(account.metadata?.customModels ?? [])].map((value) => value.trim()).filter(Boolean)));
}

function resolveProtocol(account: ProviderAccount, modelId: string): NonNullable<ProviderAccount['apiProtocol']> {
  return account.metadata?.modelProtocols?.[modelId] || account.apiProtocol || DEFAULT_PROTOCOL;
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

function resultTypeLabel(type: ResultType): string {
  switch (type) {
    case 'embedding':
      return 'Embedding';
    case 'vision':
      return '图像';
    case 'reasoning':
      return '推理';
    case 'code':
      return '代码';
    case 'chat':
      return '聊天';
    default:
      return '通用';
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

function formatTimestamp(value?: string): string {
  if (!value) return '未测试';
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

function buildCreateDraft(vendorId: ProviderType): DraftState {
  const vendor = PROVIDER_TYPE_INFO.find((entry) => entry.id === vendorId);
  return {
    mode: 'create',
    accountId: null,
    vendorId,
    label: vendor?.name || vendorId,
    baseUrl: vendor?.defaultBaseUrl || '',
    apiProtocol: DEFAULT_PROTOCOL,
    modelId: vendor?.defaultModelId || '',
    apiKey: '',
    authMode: vendorId === 'ollama' ? 'local' : 'api_key',
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

function formatTestSummary(test?: TestStatus): string {
  if (!test || test.state === 'idle') return '未测试';
  if (test.state === 'running') return '测试中';
  if (test.state === 'error') return '失败';
  return test.applied ? '成功并已应用' : '成功';
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
  const deduped = new Map<string, ModelRow>();

  for (const row of buildProviderListItems(accounts, statuses, vendors, defaultAccountId)
    .flatMap((item) => item.models
      .filter((model) => model.source !== 'recommended')
      .map((model) => ({
        key: `${item.account.id}:${model.id}`,
        account: item.account,
        accountLabel: item.displayName,
        vendorLabel: item.displayVendorName,
        vendorId: item.account.vendorId,
        modelId: model.id,
        isDefault: model.isDefault,
        isGlobalDefault: item.account.id === defaultAccountId && model.isDefault,
        protocol: resolveProtocol(item.account, model.id),
        authMode: item.account.authMode,
        hasCredentials: item.hasConfiguredCredentials,
        resultType: inferResultType(model.id),
      })))) {
    const signature = [
      row.vendorId,
      row.accountLabel.trim().toLowerCase(),
      (row.account.baseUrl || '').trim().toLowerCase(),
      row.modelId.trim().toLowerCase(),
      row.protocol,
    ].join('|');
    if (!deduped.has(signature)) {
      deduped.set(signature, row);
    }
  }

  return [...deduped.values()];
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

  const [sheetOpen, setSheetOpen] = useState(false);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [draftTest, setDraftTest] = useState<TestStatus>({ state: 'idle' });
  const [saving, setSaving] = useState(false);
  const [testingRowKey, setTestingRowKey] = useState<string | null>(null);
  const [resultsByRow, setResultsByRow] = useState<Record<string, TestStatus>>({});
  const [deletingRowKeys, setDeletingRowKeys] = useState<string[]>([]);

  useEffect(() => {
    void refreshProviderSnapshot();
  }, [refreshProviderSnapshot]);

  const rows = useMemo(
    () => buildModelRows(accounts, statuses, vendors, defaultAccountId)
      .filter((row) => !deletingRowKeys.includes(row.key)),
    [accounts, statuses, vendors, defaultAccountId, deletingRowKeys],
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
      output: result.output,
      latencyMs: result.latencyMs,
      error: result.error,
      testedAt: new Date().toISOString(),
      applied: false,
    };
  };

  const handleOpenCreate = () => {
    const nextDraft = buildCreateDraft(vendorOptions[0]?.id || 'custom');
    setDraft(nextDraft);
    setDraftTest({ state: 'idle' });
    setSheetOpen(true);
  };

  const handleOpenEdit = (row: ModelRow) => {
    setDraft(buildRowDraft(row));
    setDraftTest(resultsByRow[row.key] || { state: 'idle' });
    setSheetOpen(true);
  };

  const handleTestRow = async (row: ModelRow) => {
    setTestingRowKey(row.key);
    try {
      const result = await runDraftTest(buildRowDraft(row));
      setResultsByRow((current) => ({ ...current, [row.key]: result }));
      if (result.state === 'success') {
        toast.success(`测试成功 · ${result.latencyMs ?? '—'}ms`);
      } else {
        toast.error(result.error || '测试失败');
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
        await updateAccount(row.account.id, accountUpdate);
      } else {
        await removeAccount(row.account.id);
      }
      await refreshProviderSnapshot();
      toast.success('已删除配置');
    } catch (error) {
      setDeletingRowKeys((current) => current.filter((key) => key !== row.key));
      toast.error(`删除失败: ${error}`);
    }
  };

  const handleSetDefaultModel = async (row: ModelRow) => {
    try {
      const currentModelIds = normalizeConfiguredModelIds(row.account);
      const nextModelIds = [row.modelId, ...currentModelIds.filter((modelId) => modelId !== row.modelId)];
      const nextMetadata = { ...(row.account.metadata ?? {}) };
      const nextCustomModels = nextModelIds.slice(1);
      if (nextCustomModels.length > 0) {
        nextMetadata.customModels = nextCustomModels;
      } else {
        delete nextMetadata.customModels;
      }
      await updateAccount(row.account.id, {
        model: nextModelIds[0],
        metadata: nextMetadata,
      });
      if (defaultAccountId !== row.account.id) {
        await setDefaultAccount(row.account.id);
      }
      toast.success('已设为默认模型');
    } catch (error) {
      toast.error(`设置失败: ${error}`);
    }
  };

  const handleDraftTest = async () => {
    if (!draft) return;
    if (!draft.modelId.trim()) {
      toast.error('需要模型 ID');
      return;
    }
    setDraftTest({ state: 'running' });
    try {
      const result = await runDraftTest(draft);
      setDraftTest(result);
      if (result.state === 'success') {
        toast.success(`测试成功 · ${result.latencyMs ?? '—'}ms`);
      } else {
        toast.error(result.error || '测试失败');
      }
    } catch (error) {
      const failed: TestStatus = {
        state: 'error',
        signature: getDraftSignature(draft),
        error: String(error),
        testedAt: new Date().toISOString(),
      };
      setDraftTest(failed);
      toast.error(String(error));
    }
  };

  const handleApplyDraft = async () => {
    if (!draft || !canApplyDraft) return;
    setSaving(true);
    try {
      const trimmedKey = draft.apiKey.trim();
      const effectiveKey = resolveProviderApiKeyForSave(draft.vendorId, trimmedKey);

      if (draft.mode === 'create') {
        const accountId = buildProviderAccountId(draft.vendorId, null, vendors);
        await createAccount({
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
        if (!defaultAccountId) {
          await setDefaultAccount(accountId);
        }
      } else if (draft.accountId) {
        const account = accounts.find((entry) => entry.id === draft.accountId);
        if (!account) throw new Error('配置不存在');
        const updates = applyModelChangeToAccount(account, draft);
        await updateAccount(draft.accountId, updates, trimmedKey || undefined);
      }

      const nextResult: TestStatus = {
        ...draftTest,
        applied: true,
      };
      const key = draft.mode === 'create'
        ? `${draft.vendorId}:${draft.modelId.trim()}`
        : `${draft.accountId}:${draft.modelId.trim()}`;
      setResultsByRow((current) => ({ ...current, [key]: nextResult }));
      setSheetOpen(false);
      setDraft(null);
      toast.success('已应用到 OpenClaw');
    } catch (error) {
      toast.error(`应用失败: ${error}`);
    } finally {
      setSaving(false);
    }
  };

  const updateDraft = <K extends keyof DraftState>(key: K, value: DraftState[K]) => {
    setDraft((current) => {
      if (!current) return current;
      const next = { ...current, [key]: value };
      if (key === 'vendorId') {
        const vendor = PROVIDER_TYPE_INFO.find((entry) => entry.id === value);
        next.baseUrl = vendor?.defaultBaseUrl || '';
        next.modelId = vendor?.defaultModelId || '';
        next.authMode = value === 'ollama' ? 'local' : 'api_key';
      }
      return next;
    });
  };

  return (
    <TooltipProvider delayDuration={200}>
      <section data-testid="models-config-panel" className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-[28px] font-semibold tracking-[-0.02em] text-foreground">模型配置</h2>
          <p className="mt-1 text-[14px] text-muted-foreground">
            用表格管理厂商、模型、测试结果。测试通过后，才允许应用到 OpenClaw。
          </p>
        </div>
        <Button data-testid="models-config-add-button" className="rounded-full px-4" onClick={handleOpenCreate}>
          <Plus className="mr-2 h-4 w-4" />
          新增配置
        </Button>
      </div>

      {loading && rows.length === 0 ? (
        <div className="flex items-center justify-center rounded-2xl border border-dashed border-black/10 py-16 text-muted-foreground dark:border-white/10">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <div data-testid="models-config-empty-state" className="rounded-2xl border border-dashed border-black/10 px-6 py-14 text-center dark:border-white/10">
          <p className="text-[15px] font-medium text-foreground">还没有模型配置</p>
          <p className="mt-2 text-[13px] text-muted-foreground">先新增一个配置，测试成功后再应用到 OpenClaw。</p>
          <Button className="mt-5 rounded-full px-5" onClick={handleOpenCreate}>新增首个配置</Button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-black/10 dark:border-white/10">
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-left">
              <thead className="bg-black/[0.025] text-[12px] uppercase tracking-[0.08em] text-foreground/45 dark:bg-white/[0.025]">
                <tr>
                  <th className="px-5 py-3 font-medium">模型配置</th>
                  <th className="px-4 py-3 font-medium">能力</th>
                  <th className="px-4 py-3 font-medium">测试结果</th>
                  <th className="px-4 py-3 font-medium">摘要</th>
                  <th className="sticky right-0 z-10 w-[170px] border-l border-black/5 bg-black/[0.025] px-4 py-3 font-medium text-right backdrop-blur-sm dark:border-white/8 dark:bg-white/[0.025]">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/6 text-[14px] dark:divide-white/8">
                {rows.map((row) => {
                  const result = resultsByRow[row.key];
                  return (
                    <tr key={row.key} data-testid="models-config-row" className="align-top">
                      <td className="px-5 py-4">
                        <div className="min-w-[240px]">
                          <div className="flex items-center gap-2">
                            <div className="font-medium text-[15px] text-foreground">{row.modelId}</div>
                            {row.isGlobalDefault ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/12 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                                <Star className="h-3 w-3 fill-current" />
                                全局默认
                              </span>
                            ) : row.isDefault ? (
                              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                                默认
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
                            {resultTypeLabel(row.resultType)}
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
                            <span>{formatTestSummary(result)}</span>
                          </div>
                          <div className="text-[12px] text-foreground/56">
                            {formatTimestamp(result?.testedAt)}
                          </div>
                          <div className="text-[12px] text-foreground/56">
                            {typeof result?.latencyMs === 'number' ? `${result.latencyMs} ms` : '无延迟数据'}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="min-w-[220px] max-w-[320px]">
                          <div className="line-clamp-2 text-[13px] leading-6 text-foreground/68">
                            {result?.output || result?.error || '尚未返回'}
                          </div>
                        </div>
                      </td>
                      <td className="sticky right-0 z-10 w-[170px] border-l border-black/5 bg-background/95 px-4 py-4 backdrop-blur-sm dark:border-white/8 dark:bg-background/95">
                        <div className="flex min-w-[146px] items-center justify-end gap-1.5">
                          {row.isGlobalDefault ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-amber-500/20 bg-amber-500/8 text-amber-600 dark:text-amber-400">
                                  <Star className="h-4 w-4 fill-current" />
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="top">当前全局默认模型</TooltipContent>
                            </Tooltip>
                          ) : (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 rounded-full text-foreground/55 hover:text-amber-600 dark:hover:text-amber-400"
                                  aria-label="设为全局默认"
                                  onClick={() => void handleSetDefaultModel(row)}
                                >
                                  <Star className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="top">设为全局默认</TooltipContent>
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
                            测试
                          </Button>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button data-testid={`models-config-edit-${row.key}`} variant="ghost" size="icon" className="h-8 w-8 rounded-full text-foreground/72" aria-label="编辑模型配置" onClick={() => handleOpenEdit(row)}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="top">编辑</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button data-testid={`models-config-delete-${row.key}`} variant="ghost" size="icon" className="h-8 w-8 rounded-full text-red-500 hover:text-red-600" aria-label="删除模型配置" onClick={() => void handleDeleteRow(row)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="top">删除</TooltipContent>
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
            <SheetTitle>{draft?.mode === 'create' ? '新增模型配置' : '编辑模型配置'}</SheetTitle>
            <SheetDescription>先测试，再应用。只有最近一次测试成功且配置未变，才允许回写到 OpenClaw。</SheetDescription>
          </SheetHeader>

          {draft && (
            <div className="mt-6 space-y-5">
              <div className="space-y-2">
                <Label htmlFor="draft-vendor">厂商</Label>
                <Select id="draft-vendor" value={draft.vendorId} onChange={(event) => updateDraft('vendorId', event.target.value as ProviderType)} disabled={draft.mode === 'edit'}>
                  {vendorOptions.map((vendor) => (
                    <option key={vendor.id} value={vendor.id}>{vendor.name}</option>
                  ))}
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="draft-label">账户名称</Label>
                <Input id="draft-label" value={draft.label} onChange={(event) => updateDraft('label', event.target.value)} />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="draft-model">模型</Label>
                  <Input id="draft-model" value={draft.modelId} onChange={(event) => updateDraft('modelId', event.target.value)} placeholder="gpt-5.4 / glm-5 / qwen3.5-plus" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="draft-protocol">协议</Label>
                  <Select id="draft-protocol" value={draft.apiProtocol} onChange={(event) => updateDraft('apiProtocol', event.target.value as DraftState['apiProtocol'])}>
                    <option value="openai-completions">OpenAI Completions</option>
                    <option value="openai-responses">OpenAI Responses</option>
                    <option value="anthropic-messages">Anthropic Messages</option>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="draft-base-url">Base URL</Label>
                <Input id="draft-base-url" value={draft.baseUrl} onChange={(event) => updateDraft('baseUrl', event.target.value)} placeholder="https://api.example.com/v1" />
              </div>

              {draft.authMode !== 'local' && (
                <div className="space-y-2">
                  <Label htmlFor="draft-api-key">API Key</Label>
                  <Input id="draft-api-key" type="password" value={draft.apiKey} onChange={(event) => updateDraft('apiKey', event.target.value)} placeholder={draft.mode === 'edit' ? '留空表示沿用已保存密钥' : '输入新的 API Key'} />
                </div>
              )}

              <div className="rounded-2xl border border-black/10 bg-black/[0.02] p-4 dark:border-white/10 dark:bg-white/[0.03]">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[13px] font-semibold text-foreground">自动化测试结果</p>
                    <p className="mt-1 text-[12px] text-muted-foreground">发送一次简短探测请求，展示是否可调用、回复摘要和延迟。</p>
                  </div>
                  <span className={cn(
                    'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-medium',
                    draftTest.state === 'success'
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                      : draftTest.state === 'error'
                        ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                        : 'bg-black/5 text-foreground/55 dark:bg-white/6',
                  )}>
                    {formatTestSummary(draftTest)}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-3 text-[13px] text-foreground/72">
                  <div>最近测试：{formatTimestamp(draftTest.testedAt)}</div>
                  <div>回复延迟：{typeof draftTest.latencyMs === 'number' ? `${draftTest.latencyMs} ms` : '—'}</div>
                  <div className="rounded-xl border border-black/6 bg-background px-3 py-2 dark:border-white/8">
                    {draftTest.output || draftTest.error || '尚未测试'}
                  </div>
                </div>
              </div>
            </div>
          )}

          <SheetFooter className="mt-6 gap-2 border-t border-black/10 pt-4 dark:border-white/10">
            <Button variant="outline" onClick={() => setSheetOpen(false)}>取消</Button>
            <Button variant="outline" onClick={() => void handleDraftTest()} disabled={!draft || draftTest.state === 'running'}>
              {draftTest.state === 'running' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              测试连接
            </Button>
            <Button data-testid="models-config-apply-button" onClick={() => void handleApplyDraft()} disabled={!canApplyDraft}>
              应用到 OpenClaw
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
      </section>
    </TooltipProvider>
  );
}
