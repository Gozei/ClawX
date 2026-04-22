import { useEffect, useMemo } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, Cpu, Network, Server } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge, type Status } from '@/components/common/StatusBadge';
import { useGatewayStore } from '@/stores/gateway';
import { useProviderStore } from '@/stores/providers';
import { useChannelsStore } from '@/stores/channels';
import { useCronStore } from '@/stores/cron';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/layout/PageHeader';

type MonitorSummaryItem = {
  label: string;
  value: string;
};

type MonitorNotice = {
  id: string;
  title: string;
  detail: string;
  severity: 'high' | 'medium';
};

type MonitorCardProps = {
  title: string;
  value: string;
  icon: React.ReactNode;
  badge: {
    status: Status;
    label: string;
  };
  items: MonitorSummaryItem[];
};

function MonitorCard({ title, value, icon, badge, items }: MonitorCardProps) {
  return (
    <Card className="border-[#dbe3f0] bg-white shadow-[0_10px_24px_rgba(15,23,42,0.05)] dark:border-white/10 dark:bg-card/80">
      <CardHeader className="space-y-0 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#f5f7fb] text-foreground dark:bg-white/5">
            {icon}
          </div>
          <StatusBadge status={badge.status} label={badge.label} />
        </div>
        <div className="space-y-1.5">
          <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
          <div className="text-3xl font-semibold tracking-tight text-foreground">{value}</div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {items.map((item) => (
          <div
            key={`${item.label}-${item.value}`}
            className="flex items-center justify-between gap-3 text-sm"
          >
            <span className="text-muted-foreground">{item.label}</span>
            <span className="text-right font-medium text-foreground">{item.value}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function formatUptime(uptimeSeconds?: number): string | null {
  if (!uptimeSeconds || uptimeSeconds <= 0) return null;
  if (uptimeSeconds < 60) return `${Math.round(uptimeSeconds)}s`;
  if (uptimeSeconds < 3600) return `${Math.round(uptimeSeconds / 60)}m`;
  return `${Math.round(uptimeSeconds / 3600)}h`;
}

function formatRelativeTime(value: string | undefined, fallback: string, language: string): string {
  if (!value) return fallback;
  const ts = new Date(value).getTime();
  if (!Number.isFinite(ts)) return value;
  const diffMinutes = Math.round((ts - Date.now()) / 60000);
  const isChinese = language.startsWith('zh');

  if (Math.abs(diffMinutes) < 1) {
    return isChinese ? '即将执行' : 'Soon';
  }
  if (diffMinutes > 0) {
    return isChinese ? `${diffMinutes} 分钟后` : `In ${diffMinutes} min`;
  }
  return isChinese ? `${Math.abs(diffMinutes)} 分钟前` : `${Math.abs(diffMinutes)} min ago`;
}

function formatAbsoluteTime(value: string | undefined, fallback: string, language: string): string {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const locale = language.startsWith('zh') ? 'zh-CN' : 'en-US';
  return new Intl.DateTimeFormat(locale, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function getGatewayBadgeStatus(state: string): Status {
  if (state === 'running') return 'running';
  if (state === 'starting') return 'starting';
  if (state === 'reconnecting') return 'reconnecting';
  if (state === 'error') return 'error';
  return 'stopped';
}

function getChannelBadgeStatus(connected: number, degraded: number): Status {
  if (degraded > 0) return 'error';
  if (connected > 0) return 'connected';
  return 'disconnected';
}

function getTaskBadgeStatus(enabled: number, failed: number): Status {
  if (failed > 0) return 'error';
  if (enabled > 0) return 'running';
  return 'stopped';
}

export function Dashboard() {
  const { t, i18n } = useTranslation('dashboard');
  const language = i18n.resolvedLanguage || i18n.language || 'en';

  const gatewayStatus = useGatewayStore((state) => state.status);
  const gatewayLastError = useGatewayStore((state) => state.lastError);
  const initGateway = useGatewayStore((state) => state.init);

  const providerStatuses = useProviderStore((state) => state.statuses);
  const providerLoading = useProviderStore((state) => state.loading);
  const providerError = useProviderStore((state) => state.error);
  const refreshProviderSnapshot = useProviderStore((state) => state.refreshProviderSnapshot);

  const channels = useChannelsStore((state) => state.channels);
  const channelsLoading = useChannelsStore((state) => state.loading);
  const channelsError = useChannelsStore((state) => state.error);
  const fetchChannels = useChannelsStore((state) => state.fetchChannels);

  const jobs = useCronStore((state) => state.jobs);
  const cronLoading = useCronStore((state) => state.loading);
  const cronError = useCronStore((state) => state.error);
  const fetchJobs = useCronStore((state) => state.fetchJobs);

  useEffect(() => {
    void initGateway();
    void refreshProviderSnapshot();
    void fetchChannels();
    void fetchJobs();
  }, [fetchChannels, fetchJobs, initGateway, refreshProviderSnapshot]);

  const providerSummary = useMemo(() => {
    const enabled = providerStatuses.filter((provider) => provider.enabled);
    const healthy = enabled.filter((provider) => provider.hasKey || provider.type === 'ollama');
    return {
      total: providerStatuses.length,
      enabled: enabled.length,
      healthy: healthy.length,
      missingKey: enabled.length - healthy.length,
    };
  }, [providerStatuses]);

  const channelSummary = useMemo(() => {
    const connected = channels.filter((channel) => channel.status === 'connected').length;
    const degraded = channels.filter((channel) => channel.status === 'error').length;
    return {
      total: channels.length,
      connected,
      degraded,
      disconnected: Math.max(channels.length - connected - degraded, 0),
    };
  }, [channels]);

  const cronSummary = useMemo(() => {
    const safeJobs = Array.isArray(jobs) ? jobs : [];
    const sortedNextRuns = safeJobs
      .map((job) => job.nextRun)
      .filter((value): value is string => Boolean(value))
      .sort();

    return {
      total: safeJobs.length,
      enabled: safeJobs.filter((job) => job.enabled).length,
      paused: safeJobs.filter((job) => !job.enabled).length,
      failed: safeJobs.filter((job) => job.lastRun && !job.lastRun.success).length,
      nextRun: sortedNextRuns[0],
    };
  }, [jobs]);

  const notices = useMemo<MonitorNotice[]>(() => {
    const items: MonitorNotice[] = [];

    if (gatewayStatus.state === 'error' && (gatewayStatus.error || gatewayLastError)) {
      items.push({
        id: 'gateway-error',
        title: t('systemMonitor.summary.gatewayErrorTitle'),
        detail: gatewayStatus.error || gatewayLastError || t('systemMonitor.values.none'),
        severity: 'high',
      });
    }

    if (providerSummary.missingKey > 0) {
      items.push({
        id: 'provider-missing-key',
        title: t('systemMonitor.summary.providerMissingTitle'),
        detail: t('systemMonitor.summary.providerMissingDetail', { count: providerSummary.missingKey }),
        severity: 'high',
      });
    }

    if (channelSummary.degraded > 0) {
      items.push({
        id: 'channel-error',
        title: t('systemMonitor.summary.channelErrorTitle'),
        detail: t('systemMonitor.summary.channelErrorDetail', { count: channelSummary.degraded }),
        severity: 'high',
      });
    }

    if (cronSummary.failed > 0) {
      items.push({
        id: 'task-error',
        title: t('systemMonitor.summary.taskFailedTitle'),
        detail: t('systemMonitor.summary.taskFailedDetail', { count: cronSummary.failed }),
        severity: 'medium',
      });
    }

    if (providerError || channelsError || cronError) {
      items.push({
        id: 'data-source-error',
        title: t('systemMonitor.summary.dataSourceErrorTitle'),
        detail: [providerError, channelsError, cronError].filter(Boolean).join(' / '),
        severity: 'medium',
      });
    }

    return items;
  }, [
    channelSummary.degraded,
    channelsError,
    cronError,
    cronSummary.failed,
    gatewayLastError,
    gatewayStatus.error,
    gatewayStatus.state,
    providerError,
    providerSummary.missingKey,
    t,
  ]);

  const recentJobs = useMemo(() => {
    const safeJobs = Array.isArray(jobs) ? jobs : [];
    return [...safeJobs]
      .sort((left, right) => {
        const leftTime = left.nextRun ? new Date(left.nextRun).getTime() : Number.MAX_SAFE_INTEGER;
        const rightTime = right.nextRun ? new Date(right.nextRun).getTime() : Number.MAX_SAFE_INTEGER;
        return leftTime - rightTime;
      })
      .slice(0, 6);
  }, [jobs]);

  const isRefreshing = providerLoading || channelsLoading || cronLoading;
  const gatewayStateLabel = t(`systemMonitor.states.gateway.${gatewayStatus.state}`, {
    defaultValue: t('systemMonitor.states.gateway.stopped'),
  });

  return (
    <div data-testid="dashboard-page" className="flex flex-col -m-6 min-h-[calc(100vh-2.5rem)] bg-[#f5f7fb] dark:bg-background">
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-8 pb-10 pt-16 md:px-10">
        <PageHeader
          title={t('systemMonitor.title')}
          titleTestId="dashboard-page-title"
          subtitle={t('systemMonitor.subtitle')}
          metadata={[
            t('systemMonitor.metadata.gateway', { state: gatewayStateLabel }),
            t('systemMonitor.metadata.models', { count: providerSummary.total }),
            t('systemMonitor.metadata.channels', { connected: channelSummary.connected, total: channelSummary.total }),
            t('systemMonitor.metadata.tasks', { enabled: cronSummary.enabled, total: cronSummary.total }),
            isRefreshing ? t('systemMonitor.metadata.syncing') : t('systemMonitor.metadata.synced'),
          ]}
        />

        <section data-testid="dashboard-monitor-grid" className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MonitorCard
            title={t('systemMonitor.cards.gateway')}
            value={gatewayStateLabel}
            icon={<Server className="h-5 w-5" />}
            badge={{
              status: getGatewayBadgeStatus(gatewayStatus.state),
              label: gatewayStateLabel,
            }}
            items={[
              { label: t('systemMonitor.rows.port'), value: String(gatewayStatus.port) },
              { label: t('systemMonitor.rows.uptime'), value: formatUptime(gatewayStatus.uptime) ?? t('systemMonitor.values.none') },
              { label: t('systemMonitor.rows.lastError'), value: gatewayStatus.error || gatewayLastError || t('systemMonitor.values.noError') },
            ]}
          />

          <MonitorCard
            title={t('systemMonitor.cards.models')}
            value={`${providerSummary.healthy}/${providerSummary.enabled || providerSummary.total}`}
            icon={<Cpu className="h-5 w-5" />}
            badge={{
              status: providerSummary.missingKey > 0 ? 'connecting' : 'connected',
              label: providerSummary.missingKey > 0 ? t('systemMonitor.states.attention') : t('systemMonitor.states.healthy'),
            }}
            items={[
              { label: t('systemMonitor.rows.totalAccounts'), value: String(providerSummary.total) },
              { label: t('systemMonitor.rows.enabledAccounts'), value: String(providerSummary.enabled) },
              { label: t('systemMonitor.rows.healthyAccounts'), value: String(providerSummary.healthy) },
              { label: t('systemMonitor.rows.missingCredentials'), value: String(providerSummary.missingKey) },
            ]}
          />

          <MonitorCard
            title={t('systemMonitor.cards.channels')}
            value={`${channelSummary.connected}/${channelSummary.total}`}
            icon={<Network className="h-5 w-5" />}
            badge={{
              status: getChannelBadgeStatus(channelSummary.connected, channelSummary.degraded),
              label: channelSummary.degraded > 0 ? t('systemMonitor.states.attention') : channelSummary.connected > 0 ? t('systemMonitor.states.healthy') : t('systemMonitor.states.disconnected'),
            }}
            items={[
              { label: t('systemMonitor.rows.totalChannels'), value: String(channelSummary.total) },
              { label: t('systemMonitor.rows.connectedChannels'), value: String(channelSummary.connected) },
              { label: t('systemMonitor.rows.degradedChannels'), value: String(channelSummary.degraded) },
              { label: t('systemMonitor.rows.disconnectedChannels'), value: String(channelSummary.disconnected) },
            ]}
          />

          <MonitorCard
            title={t('systemMonitor.cards.tasks')}
            value={`${cronSummary.enabled}/${cronSummary.total}`}
            icon={<Clock3 className="h-5 w-5" />}
            badge={{
              status: getTaskBadgeStatus(cronSummary.enabled, cronSummary.failed),
              label: cronSummary.failed > 0 ? t('systemMonitor.states.attention') : cronSummary.enabled > 0 ? t('systemMonitor.states.scheduled') : t('systemMonitor.states.idle'),
            }}
            items={[
              { label: t('systemMonitor.rows.totalTasks'), value: String(cronSummary.total) },
              { label: t('systemMonitor.rows.enabledTasks'), value: String(cronSummary.enabled) },
              { label: t('systemMonitor.rows.failedTasks'), value: String(cronSummary.failed) },
              { label: t('systemMonitor.rows.nextRun'), value: formatRelativeTime(cronSummary.nextRun, t('systemMonitor.values.notScheduled'), language) },
            ]}
          />
        </section>

        <section data-testid="dashboard-details-grid" className="grid gap-6 xl:grid-cols-2">
          <Card data-testid="dashboard-summary-card" className="border-black/10 dark:border-white/10">
            <CardHeader>
              <CardTitle className="text-xl">{t('systemMonitor.sections.summary')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {notices.length > 0 ? notices.map((notice) => (
                <div
                  key={notice.id}
                  className={cn(
                    'flex items-start gap-3 rounded-2xl border px-4 py-3',
                    notice.severity === 'high'
                      ? 'border-red-200 bg-red-50/70 dark:border-red-500/20 dark:bg-red-500/5'
                      : 'border-amber-200 bg-amber-50/70 dark:border-amber-500/20 dark:bg-amber-500/5',
                  )}
                >
                  <AlertTriangle
                    className={cn(
                      'mt-0.5 h-4 w-4 shrink-0',
                      notice.severity === 'high' ? 'text-red-600' : 'text-amber-600',
                    )}
                  />
                  <div className="min-w-0">
                    <div className="font-medium text-foreground">{notice.title}</div>
                    <p className="text-sm text-muted-foreground">{notice.detail}</p>
                  </div>
                </div>
              )) : (
                <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/70 px-4 py-4 dark:border-emerald-500/20 dark:bg-emerald-500/5">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-300" />
                  <div className="min-w-0">
                    <div className="font-medium text-foreground">{t('systemMonitor.summary.healthyTitle')}</div>
                    <p className="text-sm text-muted-foreground">{t('systemMonitor.summary.healthyDetail')}</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card data-testid="dashboard-task-list-card" className="border-black/10 dark:border-white/10">
            <CardHeader>
              <CardTitle className="text-xl">{t('systemMonitor.sections.taskList')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {recentJobs.length > 0 ? recentJobs.map((job) => {
                const lastRunLabel = job.lastRun
                  ? (job.lastRun.success ? t('systemMonitor.taskList.success') : t('systemMonitor.taskList.failed'))
                  : t('systemMonitor.taskList.neverRun');

                return (
                  <div
                    key={job.id}
                    className="rounded-2xl border border-black/8 bg-white/70 px-4 py-3 dark:border-white/10 dark:bg-white/[0.03]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-medium text-foreground">{job.name}</div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {t('systemMonitor.taskList.nextRun')}: {formatRelativeTime(job.nextRun, t('systemMonitor.values.notScheduled'), language)}
                        </p>
                      </div>
                      <StatusBadge
                        status={job.enabled ? 'running' : 'stopped'}
                        label={job.enabled ? t('systemMonitor.taskList.enabled') : t('systemMonitor.taskList.paused')}
                      />
                    </div>

                    <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-muted-foreground">{t('systemMonitor.taskList.lastRun')}</span>
                        <span className="font-medium text-foreground">{lastRunLabel}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-muted-foreground">{t('systemMonitor.rows.lastUpdated')}</span>
                        <span className="font-medium text-foreground">
                          {formatAbsoluteTime(job.updatedAt, t('systemMonitor.values.none'), language)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              }) : (
                <div className="rounded-2xl border border-dashed border-black/10 px-4 py-5 text-sm text-muted-foreground dark:border-white/12">
                  <div className="font-medium text-foreground">{t('systemMonitor.taskList.emptyTitle')}</div>
                  <p className="mt-1">{t('systemMonitor.taskList.emptyDetail')}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}

export default Dashboard;
