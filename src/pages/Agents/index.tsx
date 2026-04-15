import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowDown, ArrowUp, Bot, Check, Plus, RefreshCw, Settings2, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { modalCardClasses, modalOverlayClasses } from '@/components/ui/modal';
import { getSelectIconStyle, selectBaseClasses } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { useAgentsStore } from '@/stores/agents';
import { useGatewayStore } from '@/stores/gateway';
import { useProviderStore } from '@/stores/providers';
import { useSkillsStore } from '@/stores/skills';
import { useChatStore } from '@/stores/chat';
import { hostApiFetch } from '@/lib/host-api';
import { buildProviderListItems } from '@/lib/provider-accounts';
import { subscribeHostEvent } from '@/lib/host-events';
import { CHANNEL_ICONS, CHANNEL_NAMES, type ChannelType } from '@/types/channel';
import type { AgentProfileType, AgentSummary, AgentWorkflowNode } from '@/types/agent';
import type { ProviderAccount, ProviderVendorInfo, ProviderWithKeyInfo } from '@/lib/providers';
import type { Skill } from '@/types/skill';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/layout/PageHeader';
import telegramIcon from '@/assets/channels/telegram.svg';
import discordIcon from '@/assets/channels/discord.svg';
import whatsappIcon from '@/assets/channels/whatsapp.svg';
import wechatIcon from '@/assets/channels/wechat.svg';
import dingtalkIcon from '@/assets/channels/dingtalk.svg';
import feishuIcon from '@/assets/channels/feishu.svg';
import wecomIcon from '@/assets/channels/wecom.svg';
import qqIcon from '@/assets/channels/qq.svg';

interface ChannelAccountItem {
  accountId: string;
  name: string;
  configured: boolean;
  status: 'connected' | 'connecting' | 'disconnected' | 'error';
  lastError?: string;
  isDefault: boolean;
  agentId?: string;
}

interface ChannelGroupItem {
  channelType: string;
  defaultAccountId: string;
  status: 'connected' | 'connecting' | 'disconnected' | 'error';
  accounts: ChannelAccountItem[];
}

interface RuntimeProviderOption {
  runtimeProviderKey: string;
  accountId: string;
  label: string;
  modelIdPlaceholder?: string;
  configuredModelId?: string;
  suggestedModelIds: string[];
}

type AgentTriggerMode = 'manual' | 'channel' | 'schedule' | 'webhook';

interface AgentProfileOption {
  id: AgentProfileType;
  label: string;
  description: string;
}

interface AgentRuntimeSummary {
  lastActiveAt: number | null;
  sessionCount: number;
  latestModel: string | null;
  recentSessions: Array<{
    key: string;
    label: string;
    preview: string | null;
    updatedAt: number | null;
    model: string | null;
    triggerSource: AgentTriggerMode | 'unknown';
    status: 'active' | 'idle';
  }>;
}

function toSafeText(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function toSafeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => toSafeText(item)).filter(Boolean);
}

function summarizeNames(values: string[], emptyLabel: string): string {
  if (values.length === 0) return emptyLabel;
  if (values.length <= 2) return values.join('、');
  return `${values.slice(0, 2).join('、')} +${values.length - 2}`;
}

interface WorkflowTemplate {
  id: string;
  label: string;
  description: string;
  steps: AgentWorkflowNode[];
}

interface WorkflowStepTypeOption {
  id: AgentWorkflowNode['type'];
  label: string;
  description: string;
}

interface WorkflowFailureOption {
  id: NonNullable<AgentWorkflowNode['onFailure']>;
  label: string;
  description: string;
}

function formatRelativeTime(timestamp: number | null, locale: string): string {
  if (!timestamp || !Number.isFinite(timestamp)) return '-';
  const diffMs = Date.now() - timestamp;
  const diffMinutes = Math.max(1, Math.round(diffMs / 60000));
  const formatter = new Intl.RelativeTimeFormat(locale.startsWith('zh') ? 'zh-CN' : locale, { numeric: 'auto' });
  if (diffMinutes < 60) return formatter.format(-diffMinutes, 'minute');
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return formatter.format(-diffHours, 'hour');
  const diffDays = Math.round(diffHours / 24);
  return formatter.format(-diffDays, 'day');
}

function inferTriggerSourceFromSessionKey(sessionKey: string): AgentTriggerMode | 'unknown' {
  if (!sessionKey) return 'unknown';
  if (sessionKey.includes(':cron:') || sessionKey.includes('cron:')) return 'schedule';
  if (sessionKey.includes(':webhook:') || sessionKey.includes('webhook:')) return 'webhook';
  if (sessionKey.includes(':channel:') || sessionKey.includes(':telegram:') || sessionKey.includes(':wechat:') || sessionKey.includes(':discord:') || sessionKey.includes(':feishu:')) {
    return 'channel';
  }
  if (sessionKey.startsWith('agent:')) return 'manual';
  return 'unknown';
}

function inferRuntimeStatus(updatedAt: number | null): 'active' | 'idle' {
  if (!updatedAt) return 'idle';
  return Date.now() - updatedAt <= 30 * 60 * 1000 ? 'active' : 'idle';
}

function createWorkflowNode(
  partial?: Partial<AgentWorkflowNode>,
  index = 0,
): AgentWorkflowNode {
  return {
    id: partial?.id || `step-${Date.now()}-${index}`,
    type: partial?.type || 'instruction',
    title: partial?.title || '',
    target: partial?.target || null,
    onFailure: partial?.onFailure || 'continue',
    inputSpec: partial?.inputSpec || null,
    outputSpec: partial?.outputSpec || null,
    modelRef: partial?.modelRef || null,
    code: partial?.code || null,
  };
}

function normalizeWorkflowNodesFromAgent(agent: AgentSummary): AgentWorkflowNode[] {
  if (Array.isArray(agent.workflowNodes) && agent.workflowNodes.length > 0) {
    return agent.workflowNodes.map((node, index) => createWorkflowNode(node, index));
  }
  const fallbackSteps = toSafeStringArray(agent.workflowSteps);
  if (fallbackSteps.length === 0) {
    return [createWorkflowNode(undefined, 0)];
  }
  return fallbackSteps.map((step, index) => createWorkflowNode({ title: step, type: 'instruction' }, index));
}

function resolveRuntimeProviderKey(account: ProviderAccount): string {
  if (account.authMode === 'oauth_browser') {
    if (account.vendorId === 'google') return 'google-gemini-cli';
    if (account.vendorId === 'openai') return 'openai-codex';
  }

  if (account.vendorId === 'custom' || account.vendorId === 'ollama') {
    const suffix = account.id.replace(/-/g, '').slice(0, 8);
    return `${account.vendorId}-${suffix}`;
  }

  if (account.vendorId === 'minimax-portal-cn') {
    return 'minimax-portal';
  }

  return account.vendorId;
}

function splitModelRef(modelRef: string | null | undefined): { providerKey: string; modelId: string } | null {
  const value = (modelRef || '').trim();
  if (!value) return null;
  const separatorIndex = value.indexOf('/');
  if (separatorIndex <= 0 || separatorIndex >= value.length - 1) return null;
  return {
    providerKey: value.slice(0, separatorIndex),
    modelId: value.slice(separatorIndex + 1),
  };
}

function hasConfiguredProviderCredentials(
  account: ProviderAccount,
  statusById: Map<string, ProviderWithKeyInfo>,
): boolean {
  if (account.authMode === 'oauth_device' || account.authMode === 'oauth_browser' || account.authMode === 'local') {
    return true;
  }
  return statusById.get(account.id)?.hasKey ?? false;
}

function buildRuntimeProviderOptions(
  providerAccounts: ProviderAccount[],
  providerStatuses: ProviderWithKeyInfo[],
  providerVendors: ProviderVendorInfo[],
  providerDefaultAccountId: string | null,
): RuntimeProviderOption[] {
  const providerItems = buildProviderListItems(
    providerAccounts,
    providerStatuses,
    providerVendors,
    providerDefaultAccountId,
  );
  const vendorMap = new Map<string, ProviderVendorInfo>(providerVendors.map((vendor) => [vendor.id, vendor]));
  const statusById = new Map<string, ProviderWithKeyInfo>(providerStatuses.map((status) => [status.id, status]));
  const entries = providerAccounts
    .filter((account) => account.enabled && hasConfiguredProviderCredentials(account, statusById))
    .sort((left, right) => {
      if (left.id === providerDefaultAccountId) return -1;
      if (right.id === providerDefaultAccountId) return 1;
      return right.updatedAt.localeCompare(left.updatedAt);
    });

  const deduped = new Map<string, RuntimeProviderOption>();
  for (const account of entries) {
    const runtimeProviderKey = resolveRuntimeProviderKey(account);
    if (!runtimeProviderKey || deduped.has(runtimeProviderKey)) continue;
    const vendor = vendorMap.get(account.vendorId);
    const label = `${account.label} (${vendor?.name || account.vendorId})`;
    const configuredModelId = account.model
      ? (account.model.startsWith(`${runtimeProviderKey}/`)
        ? account.model.slice(runtimeProviderKey.length + 1)
        : account.model)
      : undefined;
    const suggestedModelIds = providerItems
      .find((item) => item.aliases.some((alias) => alias.id === account.id))
      ?.models
      .map((model) => model.id)
      .filter(Boolean) || [];

    deduped.set(runtimeProviderKey, {
      runtimeProviderKey,
      accountId: account.id,
      label,
      modelIdPlaceholder: vendor?.modelIdPlaceholder,
      configuredModelId,
      suggestedModelIds,
    });
  }

  return [...deduped.values()];
}

export function Agents() {
  const { t } = useTranslation('agents');
  const gatewayStatus = useGatewayStore((state) => state.status);
  const refreshProviderSnapshot = useProviderStore((state) => state.refreshProviderSnapshot);
  const lastGatewayStateRef = useRef(gatewayStatus.state);
  const {
    agents,
    loading,
    error,
    fetchAgents,
    createAgent,
    deleteAgent,
  } = useAgentsStore();
  const [channelGroups, setChannelGroups] = useState<ChannelGroupItem[]>([]);
  const [hasCompletedInitialLoad, setHasCompletedInitialLoad] = useState(() => agents.length > 0);

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const [agentToDelete, setAgentToDelete] = useState<AgentSummary | null>(null);

  const fetchChannelAccounts = useCallback(async () => {
    try {
      const response = await hostApiFetch<{ success: boolean; channels?: ChannelGroupItem[] }>('/api/channels/accounts');
      setChannelGroups(response.channels || []);
    } catch {
      // Keep the last rendered snapshot when channel account refresh fails.
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void Promise.all([fetchAgents(), fetchChannelAccounts(), refreshProviderSnapshot()]).finally(() => {
      if (mounted) {
        setHasCompletedInitialLoad(true);
      }
    });
    return () => {
      mounted = false;
    };
  }, [fetchAgents, fetchChannelAccounts, refreshProviderSnapshot]);

  useEffect(() => {
    const unsubscribe = subscribeHostEvent('gateway:channel-status', () => {
      void fetchChannelAccounts();
    });
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [fetchChannelAccounts]);

  useEffect(() => {
    const previousGatewayState = lastGatewayStateRef.current;
    lastGatewayStateRef.current = gatewayStatus.state;

    if (previousGatewayState !== 'running' && gatewayStatus.state === 'running') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void fetchChannelAccounts();
    }
  }, [fetchChannelAccounts, gatewayStatus.state]);

  const activeAgent = useMemo(
    () => agents.find((agent) => agent.id === activeAgentId) ?? null,
    [activeAgentId, agents],
  );

  const visibleAgents = useMemo(
    () => [...agents].sort((left, right) => Number(right.isDefault) - Number(left.isDefault)),
    [agents],
  );
  const visibleChannelGroups = channelGroups;
  const isUsingStableValue = loading && hasCompletedInitialLoad;
  const handleRefresh = () => {
    void Promise.all([fetchAgents(), fetchChannelAccounts()]);
  };

  if (loading && !hasCompletedInitialLoad) {
    return (
      <div data-testid="agents-page" className="flex flex-col -m-6 dark:bg-background min-h-[calc(100vh-2.5rem)] items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div data-testid="agents-page" className="flex flex-col -m-6 dark:bg-background h-[calc(100vh-2.5rem)] overflow-hidden">
      <div className="w-full max-w-5xl mx-auto flex flex-col h-full p-10 pt-16">
        <PageHeader
          title={t('title')}
          subtitle={t('subtitle')}
          actions={(
            <>
              <Button
                data-testid="agents-refresh-button"
                variant="outline"
                onClick={handleRefresh}
                className="h-10 rounded-lg px-4 text-[13px] font-medium border-[#d4dceb] bg-white text-[#223047] shadow-none hover:bg-[#f3f6fb] dark:border-white/10 dark:bg-transparent dark:text-white dark:hover:bg-white/6"
              >
                <RefreshCw className={cn('h-3.5 w-3.5 mr-2', isUsingStableValue && 'animate-spin')} />
                {t('refresh')}
              </Button>
              <Button
                data-testid="agents-add-button"
                onClick={() => setShowAddDialog(true)}
                className="h-10 rounded-lg px-4 text-[13px] font-medium shadow-none"
              >
                <Plus className="h-3.5 w-3.5 mr-2" />
                {t('addAgent')}
              </Button>
            </>
          )}
        />

        <div className="flex-1 overflow-y-auto pr-2 pb-10 min-h-0 -mr-2">
          {gatewayStatus.state !== 'running' && (
            <div className="mb-8 p-4 rounded-xl border border-yellow-500/50 bg-yellow-500/10 flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
              <span className="text-yellow-700 dark:text-yellow-400 text-sm font-medium">
                {t('gatewayWarning')}
              </span>
            </div>
          )}

          {error && (
            <div className="mb-8 p-4 rounded-xl border border-destructive/50 bg-destructive/10 flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-destructive" />
              <span className="text-destructive text-sm font-medium">
                {error}
              </span>
            </div>
          )}

          <div
            data-testid="agents-card-grid"
            className="grid grid-cols-1 gap-4 pt-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          >
            {visibleAgents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                channelGroups={visibleChannelGroups}
                onOpenSettings={() => setActiveAgentId(agent.id)}
                onDelete={() => setAgentToDelete(agent)}
              />
            ))}
          </div>
        </div>
      </div>

      {showAddDialog && (
        <AddAgentDialog
          onClose={() => setShowAddDialog(false)}
          onCreate={async (name, options) => {
            await createAgent(name, options);
            setShowAddDialog(false);
            toast.success(t('toast.agentCreated'));
          }}
        />
      )}

      {activeAgent && (
        <AgentSettingsModal
          agent={activeAgent}
          channelGroups={visibleChannelGroups}
          onClose={() => setActiveAgentId(null)}
        />
      )}

      <ConfirmDialog
        open={!!agentToDelete}
        title={t('deleteDialog.title')}
        message={agentToDelete ? t('deleteDialog.message', { name: agentToDelete.name }) : ''}
        confirmLabel={t('common:actions.delete')}
        cancelLabel={t('common:actions.cancel')}
        variant="destructive"
        onConfirm={async () => {
          if (!agentToDelete) return;
          try {
            await deleteAgent(agentToDelete.id);
            const deletedId = agentToDelete.id;
            setAgentToDelete(null);
            if (activeAgentId === deletedId) {
              setActiveAgentId(null);
            }
            toast.success(t('toast.agentDeleted'));
          } catch (error) {
            toast.error(t('toast.agentDeleteFailed', { error: String(error) }));
          }
        }}
        onCancel={() => setAgentToDelete(null)}
      />
    </div>
  );
}

function AgentOverviewCard({
  agent,
  channelGroups,
  onOpenSettings,
  onDelete,
}: {
  agent: AgentSummary;
  channelGroups: ChannelGroupItem[];
  onOpenSettings: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation('agents');
  const safeAgentName = toSafeText(agent.name, agent.id);
  const safeProfileTypeLabel = agent.profileType
    ? t(`profileTypes.${agent.profileType}.label`)
    : t('profileTypes.specialist.label');
  const safeObjective = toSafeText(agent.objective);
  const safeDescription = toSafeText(agent.description);
  const roleDescription = safeDescription || safeObjective || t(`profileTypes.${agent.profileType || 'specialist'}.description`);
  void channelGroups;

  return (
    <div
      data-testid="agent-overview-card"
      className={cn(
        'group relative flex h-full min-h-[232px] flex-col overflow-hidden rounded-[18px] border px-5 pb-4 pt-5 transition-all',
        'border-black/8 bg-white shadow-[0_18px_40px_rgba(15,23,42,0.08)] hover:-translate-y-0.5 hover:shadow-[0_22px_48px_rgba(15,23,42,0.12)]',
        'dark:border-white/8 dark:bg-white/[0.03] dark:shadow-none dark:hover:bg-white/[0.05]',
        agent.isDefault && 'ring-1 ring-primary/30'
      )}
    >
      {!agent.isDefault && (
        <Button
          variant="ghost"
          size="icon"
          className="pointer-events-none absolute right-4 top-4 h-9 w-9 shrink-0 rounded-xl text-muted-foreground opacity-0 transition-all duration-200 group-hover:pointer-events-auto group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive"
          onClick={onDelete}
          title={t('deleteAgent')}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      )}

      <div className="relative flex justify-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
          <Bot className="h-6 w-6" />
        </div>
        {agent.isDefault && (
          <Badge
            data-testid="agent-default-badge"
            variant="secondary"
            className="absolute left-1/2 top-1/2 ml-9 flex -translate-y-1/2 items-center gap-1 whitespace-nowrap rounded-md border-0 bg-primary/14 px-2.5 py-1 text-[11px] font-medium text-primary shadow-none"
          >
            <Check className="h-3 w-3" />
            {t('defaultBadge')}
          </Badge>
        )}
      </div>

      <div className="mt-5 flex min-h-[28px] items-center justify-center">
        <h2
          data-testid="agent-title"
          className="w-full break-keep px-2 text-center text-[18px] font-semibold leading-7 tracking-[-0.02em] text-foreground"
        >
          {safeAgentName}
        </h2>
      </div>

      <div className="mt-2.5 flex justify-center">
        <Badge
          data-testid="agent-role-type-badge"
          variant="outline"
          className="rounded-md border-black/10 bg-black/[0.03] px-3 py-1 text-[12px] font-medium text-foreground/82 dark:border-white/10 dark:bg-white/[0.04]"
        >
          {safeProfileTypeLabel}
        </Badge>
      </div>

      <p
        data-testid="agent-role-description"
        className="mt-3.5 min-h-[48px] line-clamp-2 text-center text-[14px] leading-6 text-foreground/68"
      >
        {roleDescription}
      </p>

      <Button
        data-testid="agent-open-settings-button"
        variant="outline"
        onClick={onOpenSettings}
        title={t('settings')}
        className="pointer-events-none mt-auto h-10 w-full rounded-lg border-black/10 bg-white/70 text-[13px] font-medium text-foreground opacity-0 shadow-none transition-all duration-200 group-hover:pointer-events-auto group-hover:opacity-100 hover:bg-black/5 dark:border-white/10 dark:bg-white/[0.04] dark:hover:bg-white/[0.08]"
      >
        <Settings2 className="mr-2 h-4 w-4" />
        {t('settings')}
      </Button>
    </div>
  );
}

function AgentCard({
  agent,
  channelGroups,
  onOpenSettings,
  onDelete,
}: {
  agent: AgentSummary;
  channelGroups: ChannelGroupItem[];
  onOpenSettings: () => void;
  onDelete: () => void;
}) {
  return (
    <AgentOverviewCard
      agent={agent}
      channelGroups={channelGroups}
      onOpenSettings={onOpenSettings}
      onDelete={onDelete}
    />
  );
}

const inputClasses = 'h-[44px] rounded-lg font-mono text-[13px] bg-background dark:bg-muted border-black/10 dark:border-white/10 focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:border-blue-500 shadow-sm transition-all text-foreground placeholder:text-foreground/40';
const selectClasses = cn(selectBaseClasses, 'h-[44px] rounded-lg border-black/10 bg-background dark:bg-muted shadow-sm transition-all focus-visible:border-blue-500 focus-visible:ring-blue-500/50 dark:border-white/10');
const workflowSelectClasses = cn(selectClasses, 'mt-2');
const labelClasses = 'text-[14px] text-foreground/80 font-bold';
const selectIconStyle = getSelectIconStyle();

function ChannelLogo({ type }: { type: ChannelType }) {
  switch (type) {
    case 'telegram':
      return <img src={telegramIcon} alt="Telegram" className="w-[20px] h-[20px] dark:invert" />;
    case 'discord':
      return <img src={discordIcon} alt="Discord" className="w-[20px] h-[20px] dark:invert" />;
    case 'whatsapp':
      return <img src={whatsappIcon} alt="WhatsApp" className="w-[20px] h-[20px] dark:invert" />;
    case 'wechat':
      return <img src={wechatIcon} alt="WeChat" className="w-[20px] h-[20px] dark:invert" />;
    case 'dingtalk':
      return <img src={dingtalkIcon} alt="DingTalk" className="w-[20px] h-[20px] dark:invert" />;
    case 'feishu':
      return <img src={feishuIcon} alt="Feishu" className="w-[20px] h-[20px] dark:invert" />;
    case 'wecom':
      return <img src={wecomIcon} alt="WeCom" className="w-[20px] h-[20px] dark:invert" />;
    case 'qqbot':
      return <img src={qqIcon} alt="QQ" className="w-[20px] h-[20px] dark:invert" />;
    default:
      return <span className="text-[20px] leading-none">{CHANNEL_ICONS[type] || '💬'}</span>;
  }
}

function AddAgentDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (
    name: string,
    options: {
      inheritWorkspace: boolean;
      studio?: {
        profileType?: AgentProfileType | null;
        description?: string | null;
        objective?: string | null;
        boundaries?: string | null;
        outputContract?: string | null;
      };
    },
  ) => Promise<void>;
}) {
  const { t } = useTranslation('agents');
  const [name, setName] = useState('');
  const [inheritWorkspace, setInheritWorkspace] = useState(false);
  const [profileType, setProfileType] = useState<AgentProfileType>('specialist');
  const [objective, setObjective] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const profileOptions = useMemo<AgentProfileOption[]>(() => ([
    {
      id: 'specialist',
      label: t('profileTypes.specialist.label'),
      description: t('profileTypes.specialist.description'),
    },
    {
      id: 'executor',
      label: t('profileTypes.executor.label'),
      description: t('profileTypes.executor.description'),
    },
    {
      id: 'coordinator',
      label: t('profileTypes.coordinator.label'),
      description: t('profileTypes.coordinator.description'),
    },
  ]), [t]);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onCreate(name.trim(), {
        inheritWorkspace,
        studio: {
          profileType,
          objective: objective.trim() || null,
          description: description.trim() || null,
        },
      });
    } catch (error) {
      toast.error(t('toast.agentCreateFailed', { error: String(error) }));
      setSaving(false);
      return;
    }
    setSaving(false);
  };

  return (
    <div data-testid="add-agent-dialog" className={modalOverlayClasses}>
      <Card
        data-testid="add-agent-dialog-card"
        className={cn(modalCardClasses, 'max-w-md rounded-3xl border-0 shadow-2xl bg-background dark:bg-card')}
      >
        <CardHeader className="pb-2 shrink-0">
          <CardTitle className="text-2xl font-serif font-normal tracking-tight">
            {t('createDialog.title')}
          </CardTitle>
          <CardDescription className="text-[15px] mt-1 text-foreground/70">
            {t('createDialog.description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex-1 space-y-6 overflow-y-auto p-6 pt-4">
          <div className="space-y-2.5">
            <Label htmlFor="agent-name" className={labelClasses}>{t('createDialog.nameLabel')}</Label>
            <Input
              id="agent-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('createDialog.namePlaceholder')}
              className={inputClasses}
            />
          </div>
          <div className="space-y-2.5">
            <Label htmlFor="agent-profile-type" className={labelClasses}>{t('createDialog.profileTypeLabel')}</Label>
            <select
              id="agent-profile-type"
              value={profileType}
              onChange={(event) => setProfileType(event.target.value as AgentProfileType)}
              className={selectClasses}
              style={selectIconStyle}
            >
              {profileOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="text-[13px] text-foreground/60">
              {profileOptions.find((option) => option.id === profileType)?.description}
            </p>
          </div>
          <div className="space-y-2.5">
            <Label htmlFor="agent-objective" className={labelClasses}>{t('createDialog.objectiveLabel')}</Label>
            <textarea
              id="agent-objective"
              value={objective}
              onChange={(event) => setObjective(event.target.value)}
              placeholder={t('createDialog.objectivePlaceholder')}
              className="min-h-24 w-full rounded-2xl border border-black/10 bg-background px-4 py-3 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 dark:border-white/10 dark:bg-muted"
            />
          </div>
          <div className="space-y-2.5">
            <Label htmlFor="agent-role" className={labelClasses}>{t('createDialog.roleLabel')}</Label>
            <textarea
              id="agent-role"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t('createDialog.rolePlaceholder')}
              className="min-h-24 w-full rounded-2xl border border-black/10 bg-background px-4 py-3 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 dark:border-white/10 dark:bg-muted"
            />
          </div>
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="inherit-workspace" className={labelClasses}>{t('createDialog.inheritWorkspaceLabel')}</Label>
              <p className="text-[13px] text-foreground/60">{t('createDialog.inheritWorkspaceDescription')}</p>
            </div>
            <Switch
              id="inherit-workspace"
              checked={inheritWorkspace}
              onCheckedChange={setInheritWorkspace}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={onClose}
              className="h-9 text-[13px] font-medium rounded-full px-4 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 shadow-none text-foreground/80 hover:text-foreground"
            >
              {t('common:actions.cancel')}
            </Button>
            <Button
              onClick={() => void handleSubmit()}
              data-testid="add-agent-save-button"
              disabled={saving || !name.trim()}
              className="h-9 text-[13px] font-medium rounded-full px-4 shadow-none"
            >
              {saving ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  {t('creating')}
                </>
              ) : (
                t('common:actions.save')
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function AgentSettingsModal({
  agent,
  channelGroups,
  onClose,
}: {
  agent: AgentSummary;
  channelGroups: ChannelGroupItem[];
  onClose: () => void;
}) {
  const translation = useTranslation('agents');
  const { t } = translation;
  const currentLanguage = translation.i18n?.language || 'zh-CN';
  const navigate = useNavigate();
  const { updateAgent, updateAgentStudio, defaultModelRef, agents } = useAgentsStore();
  const gatewayRpc = useGatewayStore((state) => state.rpc);
  const switchSession = useChatStore((state) => state.switchSession);
  const loadHistory = useChatStore((state) => state.loadHistory);
  const sessionLabels = useChatStore((state) => state.sessionLabels);
  const providerAccounts = useProviderStore((state) => state.accounts);
  const providerStatuses = useProviderStore((state) => state.statuses);
  const providerVendors = useProviderStore((state) => state.vendors);
  const providerDefaultAccountId = useProviderStore((state) => state.defaultAccountId);
  const skills = useSkillsStore((state) => state.skills);
  const fetchSkills = useSkillsStore((state) => state.fetchSkills);
  const safeAgentName = useMemo(() => toSafeText(agent.name, agent.id), [agent.id, agent.name]);
  const safeModelDisplay = useMemo(() => toSafeText(agent.modelDisplay, t('none')), [agent.modelDisplay, t]);
  const safeChannelTypes = useMemo(() => toSafeStringArray(agent.channelTypes), [agent.channelTypes]);
  const safeSkillIds = useMemo(() => toSafeStringArray(agent.skillIds), [agent.skillIds]);
  const safeWorkflowSteps = useMemo(() => toSafeStringArray(agent.workflowSteps), [agent.workflowSteps]);
  const safeWorkflowNodes = useMemo(() => normalizeWorkflowNodesFromAgent(agent), [agent]);
  const safeTriggerModes = useMemo(() => toSafeStringArray(agent.triggerModes), [agent.triggerModes]);
  const safeDescription = useMemo(() => toSafeText(agent.description), [agent.description]);
  const safeObjective = useMemo(() => toSafeText(agent.objective), [agent.objective]);
  const safeBoundaries = useMemo(() => toSafeText(agent.boundaries), [agent.boundaries]);
  const safeOutputContract = useMemo(() => toSafeText(agent.outputContract), [agent.outputContract]);
  const safeProfileType = useMemo<AgentProfileType>(() => {
    if (agent.profileType === 'executor' || agent.profileType === 'coordinator') return agent.profileType;
    return 'specialist';
  }, [agent.profileType]);
  const safeSkillIdsKey = useMemo(() => safeSkillIds.join('|'), [safeSkillIds]);
  const safeWorkflowStepsKey = useMemo(() => safeWorkflowSteps.join('|'), [safeWorkflowSteps]);
  const safeTriggerModesKey = useMemo(() => safeTriggerModes.join('|'), [safeTriggerModes]);
  const [name, setName] = useState(safeAgentName);
  const [profileType, setProfileType] = useState<AgentProfileType>(safeProfileType);
  const [description, setDescription] = useState(safeDescription);
  const [objective, setObjective] = useState(safeObjective);
  const [boundaries, setBoundaries] = useState(safeBoundaries);
  const [outputContract, setOutputContract] = useState(safeOutputContract);
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>(safeSkillIds);
  const [workflowNodes, setWorkflowNodes] = useState<AgentWorkflowNode[]>(safeWorkflowNodes);
  const [selectedTriggerModes, setSelectedTriggerModes] = useState<string[]>(safeTriggerModes.length > 0 ? safeTriggerModes : ['manual']);
  const [skillQuery, setSkillQuery] = useState('');
  const [runtimeSummary, setRuntimeSummary] = useState<AgentRuntimeSummary>({
    lastActiveAt: null,
    sessionCount: 0,
    latestModel: null,
    recentSessions: [],
  });
  const [loadingRuntime, setLoadingRuntime] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [savingStudio, setSavingStudio] = useState(false);
  const [showModelModal, setShowModelModal] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  useEffect(() => {
    setName(safeAgentName);
    setProfileType(safeProfileType);
    setDescription(safeDescription);
    setObjective(safeObjective);
    setBoundaries(safeBoundaries);
    setOutputContract(safeOutputContract);
    setSelectedSkillIds(safeSkillIds);
    setWorkflowNodes(safeWorkflowNodes);
    setSelectedTriggerModes(safeTriggerModes.length > 0 ? safeTriggerModes : ['manual']);
    setSkillQuery('');
  }, [
    agent.id,
    safeAgentName,
    safeBoundaries,
    safeDescription,
    safeObjective,
    safeOutputContract,
    safeProfileType,
    safeSkillIds,
    safeTriggerModes,
    safeWorkflowNodes,
  ]);

  useEffect(() => {
    void fetchSkills();
  }, [fetchSkills]);

  useEffect(() => {
    let cancelled = false;

    const loadRuntimeSummary = async () => {
      setLoadingRuntime(true);
      try {
        const result = await gatewayRpc<{ sessions?: Array<Record<string, unknown>> }>('sessions.list', {});
        if (cancelled) return;
        const agentSessionPrefix = `agent:${agent.id}:`;
        const matchingSessions = (Array.isArray(result.sessions) ? result.sessions : [])
          .map((session) => ({
            key: toSafeText(session.key),
            model: toSafeText(session.model) || null,
            updatedAt: typeof session.updatedAt === 'number'
              ? session.updatedAt
              : (typeof session.updatedAt === 'string' ? Number(new Date(session.updatedAt)) : undefined),
          }))
          .filter((session) => Boolean(session.key) && session.key.startsWith(agentSessionPrefix));

        const sortedByUpdatedAt = [...matchingSessions].sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0));
        setRuntimeSummary({
          lastActiveAt: sortedByUpdatedAt[0]?.updatedAt ?? null,
          sessionCount: matchingSessions.length,
          latestModel: sortedByUpdatedAt.find((session) => session.model)?.model || null,
          recentSessions: sortedByUpdatedAt.slice(0, 6).map((session) => ({
            key: session.key,
            label: sessionLabels[session.key] || session.key.split(':').slice(2).join(':') || session.key,
            preview: sessionLabels[session.key] || null,
            updatedAt: session.updatedAt ?? null,
            model: session.model,
            triggerSource: inferTriggerSourceFromSessionKey(session.key),
            status: inferRuntimeStatus(session.updatedAt ?? null),
          })),
        });
      } catch {
        if (!cancelled) {
          setRuntimeSummary({
            lastActiveAt: null,
            sessionCount: 0,
            latestModel: null,
            recentSessions: [],
          });
        }
      } finally {
        if (!cancelled) {
          setLoadingRuntime(false);
        }
      }
    };

    void loadRuntimeSummary();
    return () => {
      cancelled = true;
    };
  }, [agent.id, gatewayRpc, sessionLabels]);

  const hasNameChanges = name.trim() !== safeAgentName;
  const normalizedWorkflowNodes = workflowNodes
    .map((node, index) => createWorkflowNode({
      ...node,
      title: node.title.trim(),
      target: node.target?.trim() || null,
      inputSpec: node.inputSpec?.trim() || null,
      outputSpec: node.outputSpec?.trim() || null,
      modelRef: node.modelRef?.trim() || null,
      code: node.code?.trim() || null,
    }, index))
    .filter((node) => node.title);
  const normalizedWorkflowSteps = normalizedWorkflowNodes.map((node) => (
    node.target ? `${node.title} · ${node.target}` : node.title
  ));
  const normalizedTriggerModes = Array.from(new Set(selectedTriggerModes.map((mode) => mode.trim()).filter(Boolean)));
  const hasStudioChanges = profileType !== safeProfileType
    || description.trim() !== safeDescription.trim()
    || objective.trim() !== safeObjective.trim()
    || boundaries.trim() !== safeBoundaries.trim()
    || outputContract.trim() !== safeOutputContract.trim()
    || selectedSkillIds.join('|') !== safeSkillIdsKey
    || normalizedWorkflowSteps.join('|') !== safeWorkflowStepsKey
    || normalizedTriggerModes.join('|') !== safeTriggerModesKey;

  const handleRequestClose = () => {
    if (savingName || savingStudio || hasNameChanges || hasStudioChanges) {
      setShowCloseConfirm(true);
      return;
    }
    onClose();
  };

  const handleSaveName = async () => {
    if (!name.trim() || name.trim() === safeAgentName) return;
    setSavingName(true);
    try {
      await updateAgent(agent.id, name.trim());
      toast.success(t('toast.agentUpdated'));
    } catch (error) {
      toast.error(t('toast.agentUpdateFailed', { error: String(error) }));
    } finally {
      setSavingName(false);
    }
  };

  const handleToggleSkill = (skillId: string) => {
    setSelectedSkillIds((current) => (
      current.includes(skillId)
        ? current.filter((id) => id !== skillId)
        : [...current, skillId]
    ));
  };

  const handleWorkflowNodeChange = <K extends keyof AgentWorkflowNode>(
    index: number,
    field: K,
    value: AgentWorkflowNode[K],
  ) => {
    setWorkflowNodes((current) => current.map((node, nodeIndex) => (
      nodeIndex === index ? { ...node, [field]: value } : node
    )));
  };

  const handleAddWorkflowStep = () => {
    setWorkflowNodes((current) => [...current, createWorkflowNode(undefined, current.length)]);
  };

  const handleRemoveWorkflowStep = (index: number) => {
    setWorkflowNodes((current) => {
      const next = current.filter((_, stepIndex) => stepIndex !== index);
      return next.length > 0 ? next : [createWorkflowNode(undefined, 0)];
    });
  };

  const handleMoveWorkflowStep = (index: number, direction: 'up' | 'down') => {
    setWorkflowNodes((current) => {
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= current.length) {
        return current;
      }
      const next = [...current];
      const [item] = next.splice(index, 1);
      next.splice(targetIndex, 0, item);
      return next;
    });
  };

  const handleToggleTriggerMode = (mode: AgentTriggerMode) => {
    setSelectedTriggerModes((current) => {
      if (current.includes(mode)) {
        if (current.length === 1) return current;
        return current.filter((item) => item !== mode);
      }
      return [...current, mode];
    });
  };

  const handleSaveStudio = async () => {
    setSavingStudio(true);
    try {
      await updateAgentStudio(agent.id, {
        description: description.trim() || null,
        profileType,
        objective: objective.trim() || null,
        boundaries: boundaries.trim() || null,
        outputContract: outputContract.trim() || null,
        skillIds: selectedSkillIds,
        workflowSteps: normalizedWorkflowSteps,
        workflowNodes: normalizedWorkflowNodes,
        triggerModes: normalizedTriggerModes,
      });
      toast.success(t('toast.agentStudioUpdated'));
    } catch (error) {
      toast.error(t('toast.agentStudioUpdateFailed', { error: String(error) }));
    } finally {
      setSavingStudio(false);
    }
  };

  const assignedChannels = channelGroups.flatMap((group) =>
    group.accounts
      .filter((account) => account.agentId === agent.id)
      .map((account) => ({
        channelType: group.channelType as ChannelType,
        accountId: account.accountId,
        name:
          account.accountId === 'default'
            ? t('settingsDialog.mainAccount')
            : account.name || account.accountId,
        error: account.lastError,
      })),
  );
  const assignedSkillDetails = selectedSkillIds
    .map((skillId) => skills.find((skill) => skill.id === skillId))
    .filter(Boolean) as Skill[];
  const enabledSkills = skills.filter((skill) => !skill.isCore);
  const recommendedSkills = enabledSkills.filter((skill) => skill.enabled);
  const runtimeProviderOptions = useMemo(
    () => buildRuntimeProviderOptions(
      providerAccounts,
      providerStatuses,
      providerVendors,
      providerDefaultAccountId,
    ),
    [providerAccounts, providerDefaultAccountId, providerStatuses, providerVendors],
  );
  const visibleSkills = recommendedSkills.length > 0 ? recommendedSkills : skills;
  const normalizedSkillQuery = skillQuery.trim().toLowerCase();
  const filteredSkills = visibleSkills
    .filter((skill) => {
      if (!normalizedSkillQuery) return true;
      const haystack = [skill.name, skill.description, skill.id]
        .map((value) => toSafeText(value).toLowerCase())
        .join(' ');
      return haystack.includes(normalizedSkillQuery);
    })
    .sort((left, right) => {
      const leftSelected = selectedSkillIds.includes(left.id) ? 1 : 0;
      const rightSelected = selectedSkillIds.includes(right.id) ? 1 : 0;
      if (leftSelected !== rightSelected) {
        return rightSelected - leftSelected;
      }
      return left.name.localeCompare(right.name, 'zh-CN');
    });
  const channelSummary = assignedChannels.map((channel) => `${CHANNEL_NAMES[channel.channelType]} · ${channel.name}`);
  const workflowTemplates = useMemo<WorkflowTemplate[]>(() => [
    {
      id: 'support',
      label: t('settingsDialog.workflowTemplates.support.label'),
      description: t('settingsDialog.workflowTemplates.support.description'),
      steps: [
        createWorkflowNode({ type: 'instruction', title: t('settingsDialog.workflowTemplates.support.steps.0') }, 0),
        createWorkflowNode({ type: 'skill', title: t('settingsDialog.workflowTemplates.support.steps.1') }, 1),
        createWorkflowNode({ type: 'model', title: t('settingsDialog.workflowTemplates.support.steps.2') }, 2),
        createWorkflowNode({ type: 'channel', title: t('settingsDialog.workflowTemplates.support.steps.3') }, 3),
      ],
    },
    {
      id: 'ops',
      label: t('settingsDialog.workflowTemplates.ops.label'),
      description: t('settingsDialog.workflowTemplates.ops.description'),
      steps: [
        createWorkflowNode({ type: 'instruction', title: t('settingsDialog.workflowTemplates.ops.steps.0') }, 0),
        createWorkflowNode({ type: 'skill', title: t('settingsDialog.workflowTemplates.ops.steps.1') }, 1),
        createWorkflowNode({ type: 'model', title: t('settingsDialog.workflowTemplates.ops.steps.2') }, 2),
        createWorkflowNode({ type: 'channel', title: t('settingsDialog.workflowTemplates.ops.steps.3') }, 3),
      ],
    },
    {
      id: 'research',
      label: t('settingsDialog.workflowTemplates.research.label'),
      description: t('settingsDialog.workflowTemplates.research.description'),
      steps: [
        createWorkflowNode({ type: 'instruction', title: t('settingsDialog.workflowTemplates.research.steps.0') }, 0),
        createWorkflowNode({ type: 'skill', title: t('settingsDialog.workflowTemplates.research.steps.1') }, 1),
        createWorkflowNode({ type: 'model', title: t('settingsDialog.workflowTemplates.research.steps.2') }, 2),
        createWorkflowNode({ type: 'instruction', title: t('settingsDialog.workflowTemplates.research.steps.3') }, 3),
      ],
    },
    {
      id: 'multiAgent',
      label: t('settingsDialog.workflowTemplates.multiAgent.label'),
      description: t('settingsDialog.workflowTemplates.multiAgent.description'),
      steps: [
        createWorkflowNode({ type: 'instruction', title: t('settingsDialog.workflowTemplates.multiAgent.steps.0'), outputSpec: 'taskBrief' }, 0),
        createWorkflowNode({ type: 'agent', title: t('settingsDialog.workflowTemplates.multiAgent.steps.1'), inputSpec: 'taskBrief', outputSpec: 'specialistDraft' }, 1),
        createWorkflowNode({ type: 'skill', title: t('settingsDialog.workflowTemplates.multiAgent.steps.2'), inputSpec: 'specialistDraft', outputSpec: 'validatedDraft' }, 2),
        createWorkflowNode({ type: 'model', title: t('settingsDialog.workflowTemplates.multiAgent.steps.3'), inputSpec: 'validatedDraft', outputSpec: 'finalAnswer' }, 3),
      ],
    },
  ], [t]);
  const workflowStepTypeOptions = useMemo<WorkflowStepTypeOption[]>(() => ([
    {
      id: 'instruction',
      label: t('settingsDialog.workflowStepTypes.instruction.label'),
      description: t('settingsDialog.workflowStepTypes.instruction.description'),
    },
    {
      id: 'skill',
      label: t('settingsDialog.workflowStepTypes.skill.label'),
      description: t('settingsDialog.workflowStepTypes.skill.description'),
    },
    {
      id: 'model',
      label: t('settingsDialog.workflowStepTypes.model.label'),
      description: t('settingsDialog.workflowStepTypes.model.description'),
    },
    {
      id: 'channel',
      label: t('settingsDialog.workflowStepTypes.channel.label'),
      description: t('settingsDialog.workflowStepTypes.channel.description'),
    },
    {
      id: 'agent',
      label: t('settingsDialog.workflowStepTypes.agent.label'),
      description: t('settingsDialog.workflowStepTypes.agent.description'),
    },
  ]), [t]);
  const workflowFailureOptions = useMemo<WorkflowFailureOption[]>(() => ([
    {
      id: 'continue',
      label: t('settingsDialog.workflowFailureModes.continue.label'),
      description: t('settingsDialog.workflowFailureModes.continue.description'),
    },
    {
      id: 'retry',
      label: t('settingsDialog.workflowFailureModes.retry.label'),
      description: t('settingsDialog.workflowFailureModes.retry.description'),
    },
    {
      id: 'handoff',
      label: t('settingsDialog.workflowFailureModes.handoff.label'),
      description: t('settingsDialog.workflowFailureModes.handoff.description'),
    },
  ]), [t]);
  const profileOptions = useMemo<AgentProfileOption[]>(() => ([
    {
      id: 'specialist',
      label: t('profileTypes.specialist.label'),
      description: t('profileTypes.specialist.description'),
    },
    {
      id: 'executor',
      label: t('profileTypes.executor.label'),
      description: t('profileTypes.executor.description'),
    },
    {
      id: 'coordinator',
      label: t('profileTypes.coordinator.label'),
      description: t('profileTypes.coordinator.description'),
    },
  ]), [t]);
  const workflowModelSuggestionsByProvider = useMemo(() => {
    const suggestions = new Map<string, string[]>();
    for (const option of runtimeProviderOptions) {
      const current = suggestions.get(option.runtimeProviderKey) || [];
      const next = new Set(current);
      for (const modelId of option.suggestedModelIds) next.add(modelId);
      if (option.configuredModelId) next.add(option.configuredModelId);
      const parsedDefault = splitModelRef(defaultModelRef);
      if (parsedDefault && parsedDefault.providerKey === option.runtimeProviderKey && parsedDefault.modelId) {
        next.add(parsedDefault.modelId);
      }
      const parsedAgent = splitModelRef(agent.modelRef);
      if (parsedAgent && parsedAgent.providerKey === option.runtimeProviderKey && parsedAgent.modelId) {
        next.add(parsedAgent.modelId);
      }
      suggestions.set(option.runtimeProviderKey, [...next]);
    }
    return suggestions;
  }, [agent.modelRef, defaultModelRef, runtimeProviderOptions]);
  const triggerModeOptions = useMemo<Array<{ id: AgentTriggerMode; label: string; description: string }>>(() => ([
    {
      id: 'manual',
      label: t('settingsDialog.triggerModes.manual.label'),
      description: t('settingsDialog.triggerModes.manual.description'),
    },
    {
      id: 'channel',
      label: t('settingsDialog.triggerModes.channel.label'),
      description: t('settingsDialog.triggerModes.channel.description'),
    },
    {
      id: 'schedule',
      label: t('settingsDialog.triggerModes.schedule.label'),
      description: t('settingsDialog.triggerModes.schedule.description'),
    },
    {
      id: 'webhook',
      label: t('settingsDialog.triggerModes.webhook.label'),
      description: t('settingsDialog.triggerModes.webhook.description'),
    },
  ]), [t]);
  const triggerSourceLabel = useCallback((mode: AgentTriggerMode | 'unknown') => {
    if (mode === 'unknown') return t('settingsDialog.triggerModes.unknown.label');
    return t(`settingsDialog.triggerModes.${mode}.label`);
  }, [t]);
  const runtimeStatusLabel = useCallback((status: 'active' | 'idle') => (
    t(`settingsDialog.runtimeStatuses.${status}`)
  ), [t]);

  const handleOpenRuntimeSession = useCallback(async (sessionKey: string) => {
    switchSession(sessionKey);
    navigate('/');
    await loadHistory(true);
  }, [loadHistory, navigate, switchSession]);

  const handleApplyWorkflowTemplate = (template: WorkflowTemplate) => {
    setWorkflowNodes(template.steps.map((step, index) => createWorkflowNode(step, index)));
  };

  const handleWorkflowModelProviderChange = (index: number, providerKey: string) => {
    const currentNode = workflowNodes[index];
    const currentModel = splitModelRef(currentNode?.target || '');
    const suggestedModelId = workflowModelSuggestionsByProvider.get(providerKey)?.[0]
      || runtimeProviderOptions.find((option) => option.runtimeProviderKey === providerKey)?.configuredModelId
      || '';
    const nextModelId = currentModel?.providerKey === providerKey
      ? currentModel.modelId
      : suggestedModelId;
    handleWorkflowNodeChange(index, 'target', providerKey && nextModelId ? `${providerKey}/${nextModelId}` : '');
  };

  const handleWorkflowModelIdChange = (index: number, modelId: string) => {
    const currentNode = workflowNodes[index];
    const parsed = splitModelRef(currentNode?.target || '');
    const providerKey = parsed?.providerKey || runtimeProviderOptions[0]?.runtimeProviderKey || '';
    handleWorkflowNodeChange(index, 'target', providerKey && modelId.trim() ? `${providerKey}/${modelId.trim()}` : modelId.trim());
  };
  const availableAgentTargets = agents.filter((candidate) => candidate.id !== agent.id);

  return (
    <div className={modalOverlayClasses}>
      <Card data-testid="agent-settings-dialog" className={cn(modalCardClasses, 'max-w-5xl rounded-3xl border-0 shadow-2xl bg-background dark:bg-card')}>
        <CardHeader className="flex flex-row items-start justify-between pb-2 shrink-0">
          <div>
            <CardTitle className="text-2xl font-serif font-normal tracking-tight">
              {t('settingsDialog.title', { name: safeAgentName })}
            </CardTitle>
            <CardDescription className="text-[15px] mt-1 text-foreground/70">
            {t('settingsDialog.description')}
          </CardDescription>
        </div>
          <Button
            data-testid="agent-settings-close-button"
            variant="ghost"
            size="icon"
            onClick={handleRequestClose}
            className="rounded-full h-8 w-8 -mr-2 -mt-2 text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5"
          >
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="pt-4 overflow-y-auto flex-1 p-6">
          <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="space-y-6">
              <div className="space-y-2.5">
                <Label htmlFor="agent-settings-name" className={labelClasses}>{t('settingsDialog.nameLabel')}</Label>
                <div className="flex gap-2">
                  <Input
                    id="agent-settings-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className={inputClasses}
                  />
                  <Button
                    variant="outline"
                    onClick={() => void handleSaveName()}
                    disabled={savingName || !name.trim() || name.trim() === safeAgentName}
                    className="h-[44px] text-[13px] font-medium rounded-xl px-4 border-black/10 dark:border-white/10 bg-background dark:bg-muted hover:bg-black/5 dark:hover:bg-white/5 shadow-none text-foreground/80 hover:text-foreground"
                  >
                    {savingName ? <RefreshCw className="h-4 w-4 animate-spin" /> : t('common:actions.save')}
                  </Button>
                </div>
              </div>

              <Tabs defaultValue="overview" className="space-y-4">
                <TabsList className="h-auto rounded-2xl bg-black/[0.04] p-1 dark:bg-white/[0.08]">
                  <TabsTrigger value="overview" className="rounded-xl px-4 py-2">{t('settingsDialog.tabs.overview')}</TabsTrigger>
                  <TabsTrigger value="skills" className="rounded-xl px-4 py-2">{t('settingsDialog.tabs.skills')}</TabsTrigger>
                  <TabsTrigger value="workflow" className="rounded-xl px-4 py-2">{t('settingsDialog.tabs.workflow')}</TabsTrigger>
                  <TabsTrigger value="runtime" className="rounded-xl px-4 py-2">{t('settingsDialog.tabs.runtime')}</TabsTrigger>
                  <TabsTrigger value="channels" className="rounded-xl px-4 py-2">{t('settingsDialog.tabs.channels')}</TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-1 rounded-2xl bg-black/5 dark:bg-white/5 border border-transparent p-4">
                      <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground/80 font-medium">
                        {t('settingsDialog.agentIdLabel')}
                      </p>
                      <p className="font-mono text-[13px] text-foreground">{agent.id}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowModelModal(true)}
                      data-testid="agent-model-summary-card"
                      className="space-y-1 rounded-2xl bg-black/5 dark:bg-white/5 border border-transparent p-4 text-left hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
                    >
                      <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground/80 font-medium">
                        {t('settingsDialog.modelLabel')}
                      </p>
                      <p className="text-[13.5px] text-foreground">
                        {safeModelDisplay}
                        {agent.inheritedModel ? ` (${t('inherited')})` : ''}
                      </p>
                      <p className="font-mono text-[12px] text-foreground/70 break-all">
                        {agent.modelRef || defaultModelRef || '-'}
                      </p>
                    </button>
                  </div>

                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="rounded-2xl bg-black/5 p-4 dark:bg-white/5">
                      <p className="text-[12px] text-muted-foreground">{t('settingsDialog.overview.skills')}</p>
                      <p className="mt-2 text-2xl font-semibold text-foreground">{selectedSkillIds.length}</p>
                      <p className="mt-1 text-[12px] text-muted-foreground">
                        {summarizeNames(assignedSkillDetails.map((skill) => skill.name), t('none'))}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-black/5 p-4 dark:bg-white/5">
                      <p className="text-[12px] text-muted-foreground">{t('settingsDialog.overview.workflow')}</p>
                      <p className="mt-2 text-2xl font-semibold text-foreground">{normalizedWorkflowSteps.length}</p>
                      <p className="mt-1 text-[12px] text-muted-foreground">
                        {normalizedWorkflowSteps[0] || t('settingsDialog.workflowEmpty')}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-black/5 p-4 dark:bg-white/5">
                      <p className="text-[12px] text-muted-foreground">{t('settingsDialog.overview.channels')}</p>
                      <p className="mt-2 text-2xl font-semibold text-foreground">{assignedChannels.length || safeChannelTypes.length}</p>
                      <p className="mt-1 text-[12px] text-muted-foreground">
                        {summarizeNames(channelSummary, t('none'))}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-black/5 p-4 dark:bg-white/5">
                      <p className="text-[12px] text-muted-foreground">{t('settingsDialog.overview.triggers')}</p>
                      <p className="mt-2 text-2xl font-semibold text-foreground">{normalizedTriggerModes.length}</p>
                      <p className="mt-1 text-[12px] text-muted-foreground">
                        {summarizeNames(normalizedTriggerModes.map((mode) => t(`settingsDialog.triggerModes.${mode}.label`)), t('none'))}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2.5">
                    <Label htmlFor="agent-profile-type" className={labelClasses}>{t('settingsDialog.profileTypeLabel')}</Label>
                    <select
                      id="agent-profile-type"
                      value={profileType}
                      onChange={(event) => setProfileType(event.target.value as AgentProfileType)}
                      className={selectClasses}
                      style={selectIconStyle}
                    >
                      {profileOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <p className="text-[13px] text-foreground/60">
                      {profileOptions.find((option) => option.id === profileType)?.description}
                    </p>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2.5">
                      <Label htmlFor="agent-objective" className={labelClasses}>{t('settingsDialog.objectiveLabel')}</Label>
                      <textarea
                        id="agent-objective"
                        value={objective}
                        onChange={(event) => setObjective(event.target.value)}
                        placeholder={t('settingsDialog.objectivePlaceholder')}
                        className="min-h-28 w-full rounded-2xl border border-black/10 bg-background px-4 py-3 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 dark:border-white/10 dark:bg-muted"
                      />
                    </div>
                    <div className="space-y-2.5">
                      <Label htmlFor="agent-output-contract" className={labelClasses}>{t('settingsDialog.outputContractLabel')}</Label>
                      <textarea
                        id="agent-output-contract"
                        value={outputContract}
                        onChange={(event) => setOutputContract(event.target.value)}
                        placeholder={t('settingsDialog.outputContractPlaceholder')}
                        className="min-h-28 w-full rounded-2xl border border-black/10 bg-background px-4 py-3 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 dark:border-white/10 dark:bg-muted"
                      />
                    </div>
                  </div>

                  <div className="space-y-2.5">
                    <Label htmlFor="agent-description" className={labelClasses}>{t('settingsDialog.descriptionLabel')}</Label>
                    <textarea
                      id="agent-description"
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      placeholder={t('settingsDialog.descriptionPlaceholder')}
                      className="min-h-28 w-full rounded-2xl border border-black/10 bg-background px-4 py-3 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 dark:border-white/10 dark:bg-muted"
                    />
                  </div>
                  <div className="space-y-2.5">
                    <Label htmlFor="agent-boundaries" className={labelClasses}>{t('settingsDialog.boundariesLabel')}</Label>
                    <textarea
                      id="agent-boundaries"
                      value={boundaries}
                      onChange={(event) => setBoundaries(event.target.value)}
                      placeholder={t('settingsDialog.boundariesPlaceholder')}
                      className="min-h-28 w-full rounded-2xl border border-black/10 bg-background px-4 py-3 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 dark:border-white/10 dark:bg-muted"
                    />
                  </div>
                </TabsContent>

                <TabsContent value="skills" className="space-y-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-xl font-serif text-foreground font-normal tracking-tight">{t('settingsDialog.skillsTitle')}</h3>
                      <p className="mt-1 text-[14px] text-foreground/70">{t('settingsDialog.skillsDescription')}</p>
                    </div>
                    <Badge variant="secondary" className="rounded-full px-3 py-1">
                      {t('skillCount', { count: selectedSkillIds.length })}
                    </Badge>
                  </div>
                  <div className="grid gap-3">
                    {recommendedSkills.length === 0 && skills.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-black/10 bg-black/5 p-4 text-[13px] text-muted-foreground dark:border-white/10 dark:bg-white/5">
                        {t('settingsDialog.skillsEmpty')}
                      </div>
                    ) : filteredSkills.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-black/10 bg-black/5 p-4 text-[13px] text-muted-foreground dark:border-white/10 dark:bg-white/5">
                        {t('settingsDialog.skillsNoMatch')}
                      </div>
                    ) : (
                      <>
                        <div className="rounded-2xl border border-black/5 bg-white/70 p-4 dark:border-white/10 dark:bg-white/[0.04]">
                          <Label htmlFor="agent-skill-search" className={labelClasses}>
                            {t('settingsDialog.skillsSearchLabel')}
                          </Label>
                          <Input
                            id="agent-skill-search"
                            value={skillQuery}
                            onChange={(event) => setSkillQuery(event.target.value)}
                            placeholder={t('settingsDialog.skillsSearchPlaceholder')}
                            className={cn(inputClasses, 'mt-2')}
                          />
                        </div>
                        {filteredSkills.map((skill) => {
                          const selected = selectedSkillIds.includes(skill.id);
                          return (
                            <label key={skill.id} className="flex items-start gap-3 rounded-2xl border border-black/5 bg-white/70 p-4 transition-colors hover:bg-white dark:border-white/10 dark:bg-white/[0.04] dark:hover:bg-white/[0.06]">
                              <Switch checked={selected} onCheckedChange={() => handleToggleSkill(skill.id)} />
                              <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-lg">{skill.icon || '🧩'}</span>
                                <p className="text-[15px] font-semibold text-foreground">{skill.name}</p>
                                {!skill.enabled && (
                                  <Badge variant="secondary" className="rounded-full px-2.5 py-0.5 text-[11px]">
                                    {t('settingsDialog.skillDisabled')}
                                  </Badge>
                                )}
                              </div>
                              <p className="mt-1 text-[13px] text-muted-foreground">{skill.description || skill.id}</p>
                              <p className="mt-2 font-mono text-[12px] text-foreground/60">{skill.id}</p>
                            </div>
                          </label>
                          );
                        })}
                      </>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="workflow" className="space-y-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-xl font-serif text-foreground font-normal tracking-tight">{t('settingsDialog.workflowTitle')}</h3>
                      <p className="mt-1 text-[14px] text-foreground/70">{t('settingsDialog.workflowDescription')}</p>
                    </div>
                    <Button variant="outline" onClick={handleAddWorkflowStep} className="rounded-full px-4">
                      <Plus className="mr-2 h-4 w-4" />
                      {t('settingsDialog.addWorkflowStep')}
                    </Button>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <p className="text-[13px] font-medium text-foreground">{t('settingsDialog.workflowTemplatesTitle')}</p>
                      <p className="mt-1 text-[13px] text-muted-foreground">{t('settingsDialog.workflowTemplatesDescription')}</p>
                    </div>
                    <div className="grid gap-3 md:grid-cols-3">
                      {workflowTemplates.map((template) => (
                        <button
                          key={template.id}
                          type="button"
                          onClick={() => handleApplyWorkflowTemplate(template)}
                          className="rounded-2xl border border-black/5 bg-white/70 p-4 text-left transition-colors hover:bg-white dark:border-white/10 dark:bg-white/[0.04] dark:hover:bg-white/[0.06]"
                        >
                          <p className="text-[14px] font-semibold text-foreground">{template.label}</p>
                          <p className="mt-1 text-[12px] text-muted-foreground">{template.description}</p>
                          <p className="mt-3 text-[12px] text-foreground/70">
                            {template.steps.slice(0, 2).map((step) => step.title).join(' → ')}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-3">
                    {workflowNodes.map((step, index) => (
                      <div key={`${agent.id}-workflow-${index}`} className="flex items-start gap-3 rounded-2xl border border-black/5 bg-white/70 p-4 dark:border-white/10 dark:bg-white/[0.04]">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black/5 text-[13px] font-semibold text-foreground dark:bg-white/[0.08]">
                          {index + 1}
                        </div>
                        <div className="flex-1 space-y-3">
                          <div className="grid gap-3 md:grid-cols-[180px_1fr]">
                            <div>
                              <Label className="text-[12px] text-foreground/70">{t('settingsDialog.workflowStepTypeLabel')}</Label>
                              <select
                                value={step.type}
                                onChange={(event) => handleWorkflowNodeChange(index, 'type', event.target.value as AgentWorkflowNode['type'])}
                                className={workflowSelectClasses}
                                style={selectIconStyle}
                              >
                                {workflowStepTypeOptions.map((option) => (
                                  <option key={option.id} value={option.id}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <Label className="text-[12px] text-foreground/70">{t('settingsDialog.workflowStepTitleLabel')}</Label>
                              <Input
                                value={step.title}
                                onChange={(event) => handleWorkflowNodeChange(index, 'title', event.target.value)}
                                placeholder={t('settingsDialog.workflowStepPlaceholder', { index: index + 1 })}
                                className={cn(inputClasses, 'mt-2')}
                              />
                            </div>
                          </div>
                          <p className="text-[12px] text-muted-foreground">
                            {workflowStepTypeOptions.find((option) => option.id === step.type)?.description}
                          </p>
                          {step.type === 'skill' ? (
                            <div>
                              <Label className="text-[12px] text-foreground/70">{t('settingsDialog.workflowStepTargetLabel')}</Label>
                              <select
                                value={step.target || ''}
                                onChange={(event) => handleWorkflowNodeChange(index, 'target', event.target.value)}
                                className={workflowSelectClasses}
                                style={selectIconStyle}
                              >
                                <option value="">{t('settingsDialog.workflowTargetPlaceholders.skill')}</option>
                                {assignedSkillDetails.map((skill) => (
                                  <option key={skill.id} value={skill.id}>
                                    {skill.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          ) : null}
                          {step.type === 'agent' ? (
                            <div>
                              <Label className="text-[12px] text-foreground/70">{t('settingsDialog.workflowStepTargetLabel')}</Label>
                              <select
                                value={step.target || ''}
                                onChange={(event) => handleWorkflowNodeChange(index, 'target', event.target.value)}
                                className={workflowSelectClasses}
                                style={selectIconStyle}
                              >
                                <option value="">{t('settingsDialog.workflowTargetPlaceholders.agent')}</option>
                                {availableAgentTargets.map((candidate) => (
                                  <option key={candidate.id} value={candidate.id}>
                                    {candidate.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          ) : null}
                          {step.type === 'model' ? (
                            (() => {
                              const selectedModel = splitModelRef(step.target || agent.modelRef || defaultModelRef || '');
                              const selectedProviderKey = selectedModel?.providerKey || runtimeProviderOptions[0]?.runtimeProviderKey || '';
                              const suggestedModels = selectedProviderKey
                                ? (workflowModelSuggestionsByProvider.get(selectedProviderKey) || [])
                                : [];
                              return (
                                <div className="space-y-3">
                                  <div className="grid gap-3 md:grid-cols-2">
                                    <div>
                                      <Label className="text-[12px] text-foreground/70">{t('settingsDialog.modelProviderLabel')}</Label>
                                      <select
                                        value={selectedProviderKey}
                                        onChange={(event) => handleWorkflowModelProviderChange(index, event.target.value)}
                                        className={workflowSelectClasses}
                                        style={selectIconStyle}
                                      >
                                        <option value="">{t('settingsDialog.modelProviderPlaceholder')}</option>
                                        {runtimeProviderOptions.map((option) => (
                                          <option key={option.runtimeProviderKey} value={option.runtimeProviderKey}>
                                            {option.label}
                                          </option>
                                        ))}
                                      </select>
                                    </div>
                                    <div>
                                      <Label className="text-[12px] text-foreground/70">{t('settingsDialog.workflowStepTargetLabel')}</Label>
                                      <Input
                                        value={selectedModel?.modelId || ''}
                                        onChange={(event) => handleWorkflowModelIdChange(index, event.target.value)}
                                        placeholder={
                                          runtimeProviderOptions.find((option) => option.runtimeProviderKey === selectedProviderKey)?.modelIdPlaceholder
                                          || agent.modelRef
                                          || defaultModelRef
                                          || t('settingsDialog.workflowTargetPlaceholders.model')
                                        }
                                        className={cn(inputClasses, 'mt-2')}
                                      />
                                    </div>
                                  </div>
                                  {suggestedModels.length > 0 ? (
                                    <div>
                                      <Label className="text-[12px] text-foreground/70">{t('settingsDialog.workflowSuggestedModelsLabel')}</Label>
                                      <div className="mt-2 flex flex-wrap gap-2">
                                        {suggestedModels.map((modelId) => (
                                          <button
                                            key={modelId}
                                            type="button"
                                            onClick={() => handleWorkflowModelIdChange(index, modelId)}
                                            className={cn(
                                              'rounded-full border px-3 py-1.5 text-[12px] transition-colors',
                                              selectedModel?.modelId === modelId
                                                ? 'border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300'
                                                : 'border-black/10 bg-white/70 text-foreground/70 hover:bg-white dark:border-white/10 dark:bg-white/[0.04] dark:hover:bg-white/[0.06]',
                                            )}
                                          >
                                            {modelId}
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                  ) : null}
                                </div>
                              );
                            })()
                          ) : null}
                          {step.type !== 'model' ? (
                            <div>
                              <Label className="text-[12px] text-foreground/70">{t('settingsDialog.workflowStepModelRefLabel')}</Label>
                              <Input
                                value={step.modelRef || ''}
                                onChange={(event) => handleWorkflowNodeChange(index, 'modelRef', event.target.value)}
                                placeholder={t('settingsDialog.workflowTargetPlaceholders.modelRef')}
                                className={cn(inputClasses, 'mt-2')}
                              />
                              <p className="mt-2 text-[12px] text-muted-foreground">{t('settingsDialog.workflowStepModelRefDescription')}</p>
                            </div>
                          ) : null}
                          {step.type === 'channel' ? (
                            <div>
                              <Label className="text-[12px] text-foreground/70">{t('settingsDialog.workflowStepTargetLabel')}</Label>
                              <select
                                value={step.target || ''}
                                onChange={(event) => handleWorkflowNodeChange(index, 'target', event.target.value)}
                                className={workflowSelectClasses}
                                style={selectIconStyle}
                              >
                                <option value="">{t('settingsDialog.workflowTargetPlaceholders.channel')}</option>
                                {assignedChannels.map((channel) => {
                                  const value = `${channel.channelType}:${channel.accountId}`;
                                  return (
                                    <option key={value} value={value}>
                                      {CHANNEL_NAMES[channel.channelType]} · {channel.name}
                                    </option>
                                  );
                                })}
                              </select>
                            </div>
                          ) : null}
                          <div className="grid gap-3 md:grid-cols-2">
                            <div>
                              <Label className="text-[12px] text-foreground/70">{t('settingsDialog.workflowInputSpecLabel')}</Label>
                              <textarea
                                value={step.inputSpec || ''}
                                onChange={(event) => handleWorkflowNodeChange(index, 'inputSpec', event.target.value)}
                                placeholder={t('settingsDialog.workflowInputSpecPlaceholder')}
                                className="mt-2 min-h-24 w-full rounded-2xl border border-black/10 bg-background px-4 py-3 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 dark:border-white/10 dark:bg-muted"
                              />
                            </div>
                            <div>
                              <Label className="text-[12px] text-foreground/70">{t('settingsDialog.workflowOutputSpecLabel')}</Label>
                              <textarea
                                value={step.outputSpec || ''}
                                onChange={(event) => handleWorkflowNodeChange(index, 'outputSpec', event.target.value)}
                                placeholder={t('settingsDialog.workflowOutputSpecPlaceholder')}
                                className="mt-2 min-h-24 w-full rounded-2xl border border-black/10 bg-background px-4 py-3 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 dark:border-white/10 dark:bg-muted"
                              />
                            </div>
                          </div>
                          <div>
                            <Label className="text-[12px] text-foreground/70">{t('settingsDialog.workflowCodeLabel')}</Label>
                            <textarea
                              value={step.code || ''}
                              onChange={(event) => handleWorkflowNodeChange(index, 'code', event.target.value)}
                              placeholder={t('settingsDialog.workflowCodePlaceholder')}
                              className="mt-2 min-h-24 w-full rounded-2xl border border-black/10 bg-background px-4 py-3 font-mono text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 dark:border-white/10 dark:bg-muted"
                            />
                            <p className="mt-2 text-[12px] text-muted-foreground">{t('settingsDialog.workflowCodeDescription')}</p>
                          </div>
                          <div>
                            <Label className="text-[12px] text-foreground/70">{t('settingsDialog.workflowFailureModeLabel')}</Label>
                            <select
                              value={step.onFailure || 'continue'}
                              onChange={(event) => handleWorkflowNodeChange(index, 'onFailure', event.target.value as NonNullable<AgentWorkflowNode['onFailure']>)}
                              className={workflowSelectClasses}
                              style={selectIconStyle}
                            >
                              {workflowFailureOptions.map((option) => (
                                <option key={option.id} value={option.id}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                            <p className="mt-2 text-[12px] text-muted-foreground">
                              {workflowFailureOptions.find((option) => option.id === (step.onFailure || 'continue'))?.description}
                            </p>
                          </div>
                        </div>
                        <div className="flex flex-col gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleMoveWorkflowStep(index, 'up')}
                            disabled={index === 0}
                            className="rounded-full"
                          >
                            <ArrowUp className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleMoveWorkflowStep(index, 'down')}
                            disabled={index === workflowNodes.length - 1}
                            className="rounded-full"
                          >
                            <ArrowDown className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => handleRemoveWorkflowStep(index)} className="rounded-full">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </TabsContent>

                <TabsContent value="runtime" className="space-y-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-xl font-serif text-foreground font-normal tracking-tight">{t('settingsDialog.runtimeTitle')}</h3>
                      <p className="mt-1 text-[14px] text-foreground/70">{t('settingsDialog.runtimeDescription')}</p>
                    </div>
                    <Badge variant="secondary" className="rounded-full px-3 py-1">
                      {t('triggerCount', { count: normalizedTriggerModes.length })}
                    </Badge>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    {triggerModeOptions.map((option) => {
                      const selected = normalizedTriggerModes.includes(option.id);
                      return (
                        <label key={option.id} className="flex items-start gap-3 rounded-2xl border border-black/5 bg-white/70 p-4 transition-colors hover:bg-white dark:border-white/10 dark:bg-white/[0.04] dark:hover:bg-white/[0.06]">
                          <Switch checked={selected} onCheckedChange={() => handleToggleTriggerMode(option.id)} />
                          <div className="min-w-0 flex-1">
                            <p className="text-[15px] font-semibold text-foreground">{option.label}</p>
                            <p className="mt-1 text-[13px] text-muted-foreground">{option.description}</p>
                          </div>
                        </label>
                      );
                    })}
                  </div>

                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="rounded-2xl bg-black/5 p-4 dark:bg-white/5">
                      <p className="text-[12px] text-muted-foreground">{t('settingsDialog.runtimeCards.lastActive')}</p>
                      <p className="mt-2 text-[18px] font-semibold text-foreground">
                        {loadingRuntime ? t('settingsDialog.runtimeLoading') : formatRelativeTime(runtimeSummary.lastActiveAt, currentLanguage)}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-black/5 p-4 dark:bg-white/5">
                      <p className="text-[12px] text-muted-foreground">{t('settingsDialog.runtimeCards.sessionCount')}</p>
                      <p className="mt-2 text-[18px] font-semibold text-foreground">{runtimeSummary.sessionCount}</p>
                    </div>
                    <div className="rounded-2xl bg-black/5 p-4 dark:bg-white/5">
                      <p className="text-[12px] text-muted-foreground">{t('settingsDialog.runtimeCards.latestModel')}</p>
                      <p className="mt-2 text-[18px] font-semibold text-foreground break-all">
                        {runtimeSummary.latestModel || agent.modelRef || defaultModelRef || '-'}
                      </p>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-black/5 bg-white/70 p-4 dark:border-white/10 dark:bg-white/[0.04]">
                    <p className="text-[13px] font-medium text-foreground">{t('settingsDialog.runtimeChecklistTitle')}</p>
                    <div className="mt-3 space-y-2 text-[13px] text-muted-foreground">
                      <p>{selectedSkillIds.length > 0 ? '-' : 'o'} {t('settingsDialog.runtimeChecklist.skillsReady', { count: selectedSkillIds.length })}</p>
                      <p>{normalizedWorkflowSteps.length > 0 ? '-' : 'o'} {t('settingsDialog.runtimeChecklist.workflowReady', { count: normalizedWorkflowSteps.length })}</p>
                      <p>{assignedChannels.length > 0 ? '-' : 'o'} {t('settingsDialog.runtimeChecklist.channelsReady', { count: assignedChannels.length || safeChannelTypes.length })}</p>
                      <p>{normalizedTriggerModes.length > 0 ? '-' : 'o'} {t('settingsDialog.runtimeChecklist.triggersReady', { count: normalizedTriggerModes.length })}</p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <p className="text-[13px] font-medium text-foreground">{t('settingsDialog.runtimeRecentTitle')}</p>
                      <p className="mt-1 text-[13px] text-muted-foreground">{t('settingsDialog.runtimeRecentDescription')}</p>
                    </div>
                    {runtimeSummary.recentSessions.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-black/10 bg-black/5 p-4 text-[13px] text-muted-foreground dark:border-white/10 dark:bg-white/5">
                        {t('settingsDialog.runtimeRecentEmpty')}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {runtimeSummary.recentSessions.map((session) => (
                          <div
                            key={session.key}
                            className="rounded-2xl border border-black/5 bg-white/70 p-4 dark:border-white/10 dark:bg-white/[0.04]"
                          >
                            <div className="flex items-start justify-between gap-4">
                              <div className="min-w-0">
                                <p className="text-[14px] font-semibold text-foreground truncate">{session.label}</p>
                                <p className="mt-1 text-[12px] text-foreground/70 line-clamp-2">
                                  {session.preview || session.key}
                                </p>
                              </div>
                              <div className="flex flex-wrap items-center justify-end gap-2">
                                <Badge variant="secondary" className="rounded-full px-2.5 py-0.5 text-[11px]">
                                  {triggerSourceLabel(session.triggerSource)}
                                </Badge>
                                <Badge
                                  variant="secondary"
                                  className={cn(
                                    'rounded-full px-2.5 py-0.5 text-[11px]',
                                    session.status === 'active'
                                      ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                      : 'bg-black/5 text-foreground/70 dark:bg-white/[0.08]',
                                  )}
                                >
                                  {runtimeStatusLabel(session.status)}
                                </Badge>
                              </div>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-[12px] text-muted-foreground">
                              <span>{t('settingsDialog.runtimeRecentFields.time')}: {formatRelativeTime(session.updatedAt, currentLanguage)}</span>
                              <span>{t('settingsDialog.runtimeRecentFields.model')}: {session.model || '-'}</span>
                            </div>
                            <div className="mt-4 flex justify-end">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => void handleOpenRuntimeSession(session.key)}
                                className="rounded-full"
                              >
                                {t('settingsDialog.runtimeOpenSession')}
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="channels" className="space-y-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                    <h3 className="text-xl font-serif text-foreground font-normal tracking-tight">{t('settingsDialog.channelsTitle')}</h3>
                    <p className="text-[14px] text-foreground/70 mt-1">{t('settingsDialog.channelsDescription')}</p>
                    </div>
                    <Button variant="outline" onClick={() => navigate('/channels')} className="rounded-full px-4">
                      {t('settingsDialog.openChannels')}
                    </Button>
                  </div>
                  {assignedChannels.length === 0 && safeChannelTypes.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 p-4 text-[13.5px] text-muted-foreground">
                      {t('settingsDialog.noChannels')}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {assignedChannels.map((channel) => (
                        <div key={`${channel.channelType}-${channel.accountId}`} className="flex items-center justify-between rounded-2xl bg-black/5 dark:bg-white/5 border border-transparent p-4">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="h-[40px] w-[40px] shrink-0 flex items-center justify-center text-foreground bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10 rounded-full shadow-sm">
                              <ChannelLogo type={channel.channelType} />
                            </div>
                            <div className="min-w-0">
                              <p className="text-[15px] font-semibold text-foreground">{channel.name}</p>
                              <p className="text-[13.5px] text-muted-foreground">
                                {CHANNEL_NAMES[channel.channelType]} · {channel.accountId === 'default' ? t('settingsDialog.mainAccount') : channel.accountId}
                              </p>
                              {channel.error && <p className="text-xs text-destructive mt-1">{channel.error}</p>}
                            </div>
                          </div>
                        </div>
                      ))}
                      {assignedChannels.length === 0 && safeChannelTypes.length > 0 && (
                        <div className="rounded-2xl border border-dashed border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 p-4 text-[13.5px] text-muted-foreground">
                          {t('settingsDialog.channelsManagedInChannels')}
                        </div>
                      )}
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </div>

            <div className="space-y-4">
              <div className="rounded-3xl border border-black/5 bg-white/70 p-5 shadow-sm dark:border-white/10 dark:bg-white/[0.04]">
                <p className="text-[12px] uppercase tracking-[0.08em] text-muted-foreground">{t('settingsDialog.rightRailTitle')}</p>
                <div className="mt-4 space-y-4">
                  <div>
                    <p className="text-[12px] text-muted-foreground">{t('settingsDialog.modelLabel')}</p>
                    <p className="mt-1 text-[14px] font-semibold text-foreground">{safeModelDisplay}</p>
                    <p className="mt-1 font-mono text-[12px] text-foreground/60 break-all">{agent.modelRef || defaultModelRef || '-'}</p>
                  </div>
                  <div>
                    <p className="text-[12px] text-muted-foreground">{t('settingsDialog.profileTypeLabel')}</p>
                    <p className="mt-1 text-[14px] font-semibold text-foreground">
                      {profileOptions.find((option) => option.id === profileType)?.label || '-'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[12px] text-muted-foreground">{t('settingsDialog.skillsTitle')}</p>
                    <p className="mt-1 text-[14px] font-semibold text-foreground">{selectedSkillIds.length}</p>
                  </div>
                  <div>
                    <p className="text-[12px] text-muted-foreground">{t('settingsDialog.workflowTitle')}</p>
                    <p className="mt-1 text-[14px] font-semibold text-foreground">{normalizedWorkflowSteps.length}</p>
                  </div>
                  <div>
                    <p className="text-[12px] text-muted-foreground">{t('settingsDialog.runtimeTitle')}</p>
                    <p className="mt-1 text-[14px] font-semibold text-foreground">{normalizedTriggerModes.length}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
        <CardFooter className="shrink-0 border-t border-black/5 dark:border-white/10 bg-background/95 dark:bg-card/95 backdrop-blur px-6 py-4">
          <div className="flex w-full items-center justify-between gap-3">
            <p className="text-[13px] text-foreground/60">
              {hasStudioChanges ? t('settingsDialog.pendingStudioChanges') : t('settingsDialog.studioSavedHint')}
            </p>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => setShowModelModal(true)} className="rounded-full">
                {t('settingsDialog.saveModelOverride')}
              </Button>
              <Button onClick={() => void handleSaveStudio()} disabled={savingStudio || !hasStudioChanges} className="rounded-full">
                {savingStudio ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : null}
                {t('settingsDialog.saveStudio')}
              </Button>
            </div>
          </div>
        </CardFooter>
      </Card>
      {showModelModal && (
        <AgentModelModal
          agent={agent}
          onClose={() => setShowModelModal(false)}
        />
      )}
      <ConfirmDialog
        open={showCloseConfirm}
        title={t('settingsDialog.unsavedChangesTitle')}
        message={t('settingsDialog.unsavedChangesMessage')}
        confirmLabel={t('settingsDialog.closeWithoutSaving')}
        cancelLabel={t('common:actions.cancel')}
        onConfirm={() => {
          setShowCloseConfirm(false);
          setName(safeAgentName);
          setProfileType(safeProfileType);
          setDescription(safeDescription);
          setObjective(safeObjective);
          setBoundaries(safeBoundaries);
          setOutputContract(safeOutputContract);
          onClose();
        }}
        onCancel={() => setShowCloseConfirm(false)}
      />
    </div>
  );
}

function AgentModelModal({
  agent,
  onClose,
}: {
  agent: AgentSummary;
  onClose: () => void;
}) {
  const { t } = useTranslation('agents');
  const providerAccounts = useProviderStore((state) => state.accounts);
  const providerStatuses = useProviderStore((state) => state.statuses);
  const providerVendors = useProviderStore((state) => state.vendors);
  const providerDefaultAccountId = useProviderStore((state) => state.defaultAccountId);
  const { updateAgentModel, defaultModelRef } = useAgentsStore();
  const [selectedRuntimeProviderKey, setSelectedRuntimeProviderKey] = useState('');
  const [modelIdInput, setModelIdInput] = useState('');
  const [setAsDefaultRole, setSetAsDefaultRole] = useState(agent.isDefault);
  const [savingModel, setSavingModel] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  const runtimeProviderOptions = useMemo(
    () => buildRuntimeProviderOptions(
      providerAccounts,
      providerStatuses,
      providerVendors,
      providerDefaultAccountId,
    ),
    [providerAccounts, providerDefaultAccountId, providerStatuses, providerVendors],
  );

  useEffect(() => {
    const override = splitModelRef(agent.overrideModelRef);
    if (override) {
      setSelectedRuntimeProviderKey(override.providerKey);
      setModelIdInput(override.modelId);
      return;
    }

    const effective = splitModelRef(agent.modelRef || defaultModelRef);
    if (effective) {
      setSelectedRuntimeProviderKey(effective.providerKey);
      setModelIdInput(effective.modelId);
      return;
    }

    setSelectedRuntimeProviderKey(runtimeProviderOptions[0]?.runtimeProviderKey || '');
    setModelIdInput('');
  }, [agent.modelRef, agent.overrideModelRef, defaultModelRef, runtimeProviderOptions]);

  useEffect(() => {
    setSetAsDefaultRole(agent.isDefault);
  }, [agent.id, agent.isDefault]);

  const selectedProvider = runtimeProviderOptions.find((option) => option.runtimeProviderKey === selectedRuntimeProviderKey) || null;
  const selectedProviderModelSuggestions = selectedProvider?.suggestedModelIds || [];
  const trimmedModelId = modelIdInput.trim();
  const nextModelRef = selectedRuntimeProviderKey && trimmedModelId
    ? `${selectedRuntimeProviderKey}/${trimmedModelId}`
    : '';
  const normalizedDefaultModelRef = (defaultModelRef || '').trim();
  const isUsingDefaultModelInForm = Boolean(normalizedDefaultModelRef) && nextModelRef === normalizedDefaultModelRef;
  const currentOverrideModelRef = (agent.overrideModelRef || '').trim();
  const desiredOverrideModelRef = nextModelRef && nextModelRef !== normalizedDefaultModelRef
    ? nextModelRef
    : null;
  const modelChanged = (desiredOverrideModelRef || '') !== currentOverrideModelRef;
  const makeDefaultRequested = setAsDefaultRole && !agent.isDefault;
  const hasPendingModelChanges = modelChanged || makeDefaultRequested;

  const handleRequestClose = () => {
    if (savingModel || hasPendingModelChanges) {
      setShowCloseConfirm(true);
      return;
    }
    onClose();
  };

  const handleSaveModel = async () => {
    if (modelChanged) {
      if (!selectedRuntimeProviderKey) {
        toast.error(t('toast.agentModelProviderRequired'));
        return;
      }
      if (!trimmedModelId) {
        toast.error(t('toast.agentModelIdRequired'));
        return;
      }
      if (!nextModelRef.includes('/')) {
        toast.error(t('toast.agentModelInvalid'));
        return;
      }
    }
    if (!hasPendingModelChanges) return;

    setSavingModel(true);
    try {
      await updateAgentModel(agent.id, desiredOverrideModelRef, { setAsDefault: makeDefaultRequested });
      toast.success(t('toast.agentModelSettingsUpdated'));
      onClose();
    } catch (error) {
      toast.error(t('toast.agentModelSettingsUpdateFailed', { error: String(error) }));
    } finally {
      setSavingModel(false);
    }
  };

  const handleUseDefaultModel = () => {
    const parsedDefault = splitModelRef(normalizedDefaultModelRef);
    if (!parsedDefault) {
      setSelectedRuntimeProviderKey('');
      setModelIdInput('');
      return;
    }
    setSelectedRuntimeProviderKey(parsedDefault.providerKey);
    setModelIdInput(parsedDefault.modelId);
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4">
      <Card data-testid="agent-model-dialog" className="w-full max-w-xl rounded-3xl border-0 shadow-2xl bg-background dark:bg-card overflow-hidden">
        <CardHeader className="flex flex-row items-start justify-between pb-2">
          <div>
            <CardTitle className="text-2xl font-serif font-normal tracking-tight">
              {t('settingsDialog.modelLabel')}
            </CardTitle>
            <CardDescription className="text-[15px] mt-1 text-foreground/70">
              {t('settingsDialog.modelOverrideDescription', { defaultModel: defaultModelRef || '-' })}
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleRequestClose}
            className="rounded-full h-8 w-8 -mr-2 -mt-2 text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5"
          >
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-4 p-6 pt-4">
          <div className="space-y-2">
            <Label htmlFor="agent-model-provider" className="text-[12px] text-foreground/70">{t('settingsDialog.modelProviderLabel')}</Label>
            <select
              id="agent-model-provider"
              value={selectedRuntimeProviderKey}
              onChange={(event) => {
                const nextProvider = event.target.value;
                setSelectedRuntimeProviderKey(nextProvider);
                const option = runtimeProviderOptions.find((candidate) => candidate.runtimeProviderKey === nextProvider);
                setModelIdInput(option?.configuredModelId || option?.suggestedModelIds[0] || '');
              }}
              className={selectClasses}
              style={selectIconStyle}
            >
              <option value="">{t('settingsDialog.modelProviderPlaceholder')}</option>
              {runtimeProviderOptions.map((option) => (
                <option key={option.runtimeProviderKey} value={option.runtimeProviderKey}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="agent-model-id" className="text-[12px] text-foreground/70">{t('settingsDialog.modelIdLabel')}</Label>
            <Input
              id="agent-model-id"
              value={modelIdInput}
              onChange={(event) => setModelIdInput(event.target.value)}
              placeholder={selectedProvider?.modelIdPlaceholder || selectedProvider?.configuredModelId || t('settingsDialog.modelIdPlaceholder')}
              className={inputClasses}
            />
          </div>
          {selectedProviderModelSuggestions.length > 0 && (
            <div className="space-y-2">
              <Label className="text-[12px] text-foreground/70">{t('settingsDialog.workflowSuggestedModelsLabel')}</Label>
              <div className="flex flex-wrap gap-2">
                {selectedProviderModelSuggestions.map((modelId) => (
                  <button
                    key={modelId}
                    type="button"
                    onClick={() => setModelIdInput(modelId)}
                    className={cn(
                      'rounded-full border px-3 py-1.5 text-[12px] transition-colors',
                      trimmedModelId === modelId
                        ? 'border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300'
                        : 'border-black/10 bg-white/70 text-foreground/70 hover:bg-white dark:border-white/10 dark:bg-white/[0.04] dark:hover:bg-white/[0.06]',
                    )}
                  >
                    {modelId}
                  </button>
                ))}
              </div>
            </div>
          )}
          {!!nextModelRef && (
            <p className="text-[12px] font-mono text-foreground/70 break-all">
              {t('settingsDialog.modelPreview')}: {nextModelRef}
            </p>
          )}
          {runtimeProviderOptions.length === 0 && (
            <p className="text-[12px] text-amber-600 dark:text-amber-400">
              {t('settingsDialog.modelProviderEmpty')}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <label
              className={cn(
                'flex items-center gap-2 text-[13px] text-foreground/78 select-none',
                agent.isDefault ? 'cursor-default opacity-70' : 'cursor-pointer',
              )}
            >
              <input
                data-testid="agent-set-default-checkbox"
                type="checkbox"
                checked={setAsDefaultRole}
                disabled={agent.isDefault}
                onChange={(event) => setSetAsDefaultRole(event.target.checked)}
                className="h-4 w-4 rounded border-black/15 text-primary focus:ring-primary/30 disabled:cursor-not-allowed"
              />
              <span>{t('settingsDialog.setAsDefaultRole')}</span>
            </label>
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="outline"
                onClick={handleUseDefaultModel}
                disabled={savingModel || !normalizedDefaultModelRef || isUsingDefaultModelInForm}
                className="h-9 text-[13px] font-medium rounded-full px-4 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 shadow-none text-foreground/80 hover:text-foreground"
              >
                {t('settingsDialog.useDefaultModel')}
              </Button>
              <Button
                variant="outline"
                onClick={handleRequestClose}
                className="h-9 text-[13px] font-medium rounded-full px-4 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 shadow-none text-foreground/80 hover:text-foreground"
              >
                {t('common:actions.cancel')}
              </Button>
              <Button
                data-testid="agent-model-save-button"
                onClick={() => void handleSaveModel()}
                disabled={savingModel || !hasPendingModelChanges || (modelChanged && (!selectedRuntimeProviderKey || !trimmedModelId))}
                className="h-9 text-[13px] font-medium rounded-full px-4 shadow-none"
              >
                {savingModel ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  t('common:actions.save')
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
      <ConfirmDialog
        open={showCloseConfirm}
        title={t('settingsDialog.unsavedChangesTitle')}
        message={t('settingsDialog.unsavedChangesMessage')}
        confirmLabel={t('settingsDialog.closeWithoutSaving')}
        cancelLabel={t('common:actions.cancel')}
        onConfirm={() => {
          setShowCloseConfirm(false);
          onClose();
        }}
        onCancel={() => setShowCloseConfirm(false)}
      />
    </div>
  );
}

export default Agents;
