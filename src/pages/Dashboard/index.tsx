import { useEffect, useMemo } from 'react';
import { AlertTriangle, ArrowRight, Bot, Clock3, Cpu, Network, Puzzle, RefreshCw, Server } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/common/StatusBadge';
import { useGatewayStore } from '@/stores/gateway';
import { useProviderStore } from '@/stores/providers';
import { useChannelsStore } from '@/stores/channels';
import { useCronStore } from '@/stores/cron';
import { useAgentsStore } from '@/stores/agents';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/layout/PageHeader';

type DashboardIssue = {
  id: string;
  title: string;
  detail: string;
  severity: 'high' | 'medium';
  href: string;
};

type SummaryCardProps = {
  title: string;
  value: string;
  description: string;
  href: string;
  icon: React.ReactNode;
  status?: React.ReactNode;
};

function SummaryCard({ title, value, description, href, icon, status }: SummaryCardProps) {
  return (
    <Card className="border-[#dbe3f0] bg-white shadow-[0_10px_24px_rgba(15,23,42,0.05)] dark:border-white/10 dark:bg-card/80">
      <CardHeader className="space-y-0 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#f5f7fb] text-foreground dark:bg-white/5">
            {icon}
          </div>
          {status}
        </div>
        <div className="space-y-1.5">
          <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
          <div className="text-3xl font-semibold tracking-tight text-foreground">{value}</div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <p className="text-sm text-muted-foreground">{description}</p>
        <Button asChild variant="ghost" className="mt-3 h-auto px-0 text-sm font-medium text-primary hover:bg-transparent">
          <Link to={href}>
            进入
            <ArrowRight className="ml-1 h-4 w-4" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function formatUptime(uptimeSeconds?: number): string {
  if (!uptimeSeconds || uptimeSeconds <= 0) return 'Unknown';
  if (uptimeSeconds < 60) return `${Math.round(uptimeSeconds)}s`;
  if (uptimeSeconds < 3600) return `${Math.round(uptimeSeconds / 60)}m`;
  return `${Math.round(uptimeSeconds / 3600)}h`;
}

function formatRelativeTime(value?: string): string {
  if (!value) return '未安排';
  const ts = new Date(value).getTime();
  if (!Number.isFinite(ts)) return value;
  const diffMinutes = Math.round((ts - Date.now()) / 60000);
  if (Math.abs(diffMinutes) < 1) return '即将执行';
  if (diffMinutes > 0) return `${diffMinutes} 分钟后`;
  return `${Math.abs(diffMinutes)} 分钟前`;
}

export function Dashboard() {
  const gatewayStatus = useGatewayStore((s) => s.status);
  const gatewayLastError = useGatewayStore((s) => s.lastError);
  const initGateway = useGatewayStore((s) => s.init);

  const providerStatuses = useProviderStore((s) => s.statuses);
  const providerLoading = useProviderStore((s) => s.loading);
  const providerError = useProviderStore((s) => s.error);
  const refreshProviderSnapshot = useProviderStore((s) => s.refreshProviderSnapshot);

  const channels = useChannelsStore((s) => s.channels);
  const channelsLoading = useChannelsStore((s) => s.loading);
  const channelsError = useChannelsStore((s) => s.error);
  const fetchChannels = useChannelsStore((s) => s.fetchChannels);

  const jobs = useCronStore((s) => s.jobs);
  const cronLoading = useCronStore((s) => s.loading);
  const cronError = useCronStore((s) => s.error);
  const fetchJobs = useCronStore((s) => s.fetchJobs);

  const agents = useAgentsStore((s) => s.agents);
  const agentsLoading = useAgentsStore((s) => s.loading);
  const agentsError = useAgentsStore((s) => s.error);
  const defaultAgentId = useAgentsStore((s) => s.defaultAgentId);
  const fetchAgents = useAgentsStore((s) => s.fetchAgents);

  useEffect(() => {
    void initGateway();
    void refreshProviderSnapshot();
    void fetchAgents();
    void fetchChannels();
    void fetchJobs();
  }, [fetchAgents, fetchChannels, fetchJobs, initGateway, refreshProviderSnapshot]);

  const providerSummary = useMemo(() => {
    const enabled = providerStatuses.filter((provider) => provider.enabled);
    const connected = enabled.filter((provider) => provider.hasKey || provider.type === 'ollama');
    return {
      total: providerStatuses.length,
      enabled: enabled.length,
      healthy: connected.length,
      missingKey: enabled.length - connected.length,
    };
  }, [providerStatuses]);

  const channelSummary = useMemo(() => ({
    total: channels.length,
    connected: channels.filter((channel) => channel.status === 'connected').length,
    degraded: channels.filter((channel) => channel.status === 'error').length,
  }), [channels]);

  const cronSummary = useMemo(() => ({
    total: jobs.length,
    enabled: jobs.filter((job) => job.enabled).length,
    failed: jobs.filter((job) => job.lastRun && !job.lastRun.success).length,
    nextRun: jobs
      .map((job) => job.nextRun)
      .filter((value): value is string => Boolean(value))
      .sort()[0],
  }), [jobs]);

  const issueList = useMemo<DashboardIssue[]>(() => {
    const issues: DashboardIssue[] = [];

    if (gatewayStatus.state === 'error' && (gatewayStatus.error || gatewayLastError)) {
      issues.push({
        id: 'gateway-error',
        title: '网关需要处理',
        detail: gatewayStatus.error || gatewayLastError || '网关当前返回异常状态，请检查运行配置。',
        severity: 'high',
        href: '/settings',
      });
    }

    if (providerSummary.missingKey > 0) {
      issues.push({
        id: 'provider-missing-key',
        title: '模型配置未完成',
        detail: `${providerSummary.missingKey} 个已启用模型账户缺少 API 密钥或访问凭据。`,
        severity: 'high',
        href: '/models',
      });
    }

    if (channelSummary.degraded > 0) {
      issues.push({
        id: 'channel-errors',
        title: '渠道连接异常',
        detail: `${channelSummary.degraded} 个渠道连接处于异常状态。`,
        severity: 'high',
        href: '/channels',
      });
    }

    if (cronSummary.failed > 0) {
      issues.push({
        id: 'cron-failures',
        title: '定时任务最近执行失败',
        detail: `${cronSummary.failed} 个定时任务在最近一次执行中失败。`,
        severity: 'medium',
        href: '/cron',
      });
    }

    if (agents.length === 0) {
      issues.push({
        id: 'no-agents',
        title: '尚未创建智能体',
        detail: '至少创建一个智能体后，才能分配模型、技能和渠道。',
        severity: 'medium',
        href: '/agents',
      });
    }

    return issues.slice(0, 5);
  }, [agents.length, channelSummary.degraded, cronSummary.failed, gatewayLastError, gatewayStatus.error, gatewayStatus.state, providerSummary.missingKey]);

  const isRefreshing = providerLoading || channelsLoading || cronLoading || agentsLoading;

  return (
    <div data-testid="dashboard-page" className="flex flex-col -m-6 min-h-[calc(100vh-2.5rem)] bg-[#f5f7fb] dark:bg-background">
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-10 pt-16 pb-10">
        <PageHeader
          title="总览"
          subtitle="查看网关、模型、渠道、定时任务与智能体的整体运行状态。"
          metadata={[
            `网关${gatewayStatus.state === 'running' ? '在线运行' : gatewayStatus.state === 'starting' ? '正在启动' : gatewayStatus.state === 'reconnecting' ? '正在重连' : gatewayStatus.state === 'error' ? '连接异常' : '尚未启动'}`,
            `${providerSummary.total} 个模型账户`,
            `${channelSummary.connected}/${channelSummary.total} 个渠道在线`,
            `${agents.length} 个智能体`,
          ]}
          actions={(
            <Button
              onClick={() => {
                void initGateway();
                void refreshProviderSnapshot();
                void fetchAgents();
                void fetchChannels();
                void fetchJobs();
              }}
              disabled={isRefreshing}
              variant="outline"
              className="h-10 rounded-full border-[#d4dceb] bg-white px-4 text-[13px] font-medium text-[#223047] shadow-none hover:bg-[#f3f6fb] dark:border-white/10 dark:bg-transparent dark:text-white/82 dark:hover:bg-white/6"
            >
              <RefreshCw className={cn('mr-2 h-4 w-4', isRefreshing && 'animate-spin')} />
              刷新状态
            </Button>
          )}
        />

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            title="Gateway"
            value={gatewayStatus.state === 'running' ? '在线' : gatewayStatus.state === 'error' ? '异常' : gatewayStatus.state === 'starting' ? '启动中' : gatewayStatus.state === 'reconnecting' ? '重连中' : '离线'}
            description={`端口 ${gatewayStatus.port} · 运行 ${formatUptime(gatewayStatus.uptime)}`}
            href="/settings"
            icon={<Server className="h-5 w-5" />}
            status={<StatusBadge status={gatewayStatus.state === 'running' ? 'running' : gatewayStatus.state === 'starting' ? 'starting' : gatewayStatus.state === 'reconnecting' ? 'reconnecting' : gatewayStatus.state === 'error' ? 'error' : 'stopped'} label={gatewayStatus.state === 'running' ? '运行中' : gatewayStatus.state === 'starting' ? '启动中' : gatewayStatus.state === 'reconnecting' ? '重连中' : gatewayStatus.state === 'error' ? '异常' : '已停止'} />}
          />
          <SummaryCard
            title="模型"
            value={`${providerSummary.healthy}/${providerSummary.enabled || providerSummary.total}`}
            description={`已配置 ${providerSummary.total} 个模型账户`}
            href="/models"
            icon={<Cpu className="h-5 w-5" />}
            status={
              <StatusBadge
                status={providerSummary.missingKey > 0 ? 'connecting' : 'connected'}
                label={providerSummary.missingKey > 0 ? `${providerSummary.missingKey} 个待补密钥` : '状态正常'}
              />
            }
          />
          <SummaryCard
            title="渠道"
            value={`${channelSummary.connected}/${channelSummary.total}`}
            description={`${channelSummary.degraded} 个连接异常`}
            href="/channels"
            icon={<Network className="h-5 w-5" />}
            status={<StatusBadge status={channelSummary.degraded > 0 ? 'error' : channelSummary.connected > 0 ? 'connected' : 'disconnected'} label={channelSummary.degraded > 0 ? '需要处理' : channelSummary.connected > 0 ? '已连接' : '未连接'} />}
          />
          <SummaryCard
            title="定时任务"
            value={`${cronSummary.enabled}/${cronSummary.total}`}
            description={`下次执行 ${formatRelativeTime(cronSummary.nextRun)}`}
            href="/cron"
            icon={<Clock3 className="h-5 w-5" />}
            status={<StatusBadge status={cronSummary.failed > 0 ? 'error' : cronSummary.enabled > 0 ? 'running' : 'stopped'} label={cronSummary.failed > 0 ? `${cronSummary.failed} 个失败` : '状态正常'} />}
          />
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
          <Card className="border-black/10 dark:border-white/10">
            <CardHeader>
              <CardTitle className="text-xl">待处理事项</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {issueList.length > 0 ? issueList.map((issue) => (
                <Link
                  key={issue.id}
                  to={issue.href}
                  className={cn(
                    'flex items-start gap-3 rounded-2xl border px-4 py-3 transition-colors',
                    issue.severity === 'high'
                      ? 'border-red-200 bg-red-50/70 hover:bg-red-50 dark:border-red-500/20 dark:bg-red-500/5'
                      : 'border-amber-200 bg-amber-50/70 hover:bg-amber-50 dark:border-amber-500/20 dark:bg-amber-500/5',
                  )}
                >
                    <AlertTriangle className={cn('mt-0.5 h-4 w-4 shrink-0', issue.severity === 'high' ? 'text-red-600' : 'text-amber-600')} />
                    <div className="min-w-0">
                      <div className="font-medium text-foreground">{issue.title}</div>
                      <p className="text-sm text-muted-foreground">{issue.detail}</p>
                    </div>
                  </Link>
              )) : (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 px-4 py-5 text-sm text-emerald-900 dark:border-emerald-500/20 dark:bg-emerald-500/5 dark:text-emerald-200">
                  当前整体运行平稳，核心控制面板未发现需要立即处理的问题。
                </div>
              )}
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card className="border-black/10 dark:border-white/10">
              <CardHeader>
                <CardTitle className="text-xl">智能体概况</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">智能体数量</span>
                  <span className="font-medium text-foreground">{agents.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">默认智能体</span>
                  <span className="font-medium text-foreground">{agents.find((agent) => agent.id === defaultAgentId)?.name ?? defaultAgentId}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">已分配渠道</span>
                  <span className="font-medium text-foreground">{agents.reduce((sum, agent) => sum + agent.channelTypes.length, 0)}</span>
                </div>
                <Button asChild variant="outline" className="w-full">
                  <Link to="/agents">
                    <Bot className="mr-2 h-4 w-4" />
                    管理智能体
                  </Link>
                </Button>
              </CardContent>
            </Card>

            <Card className="border-black/10 dark:border-white/10">
              <CardHeader>
                <CardTitle className="text-xl">快捷入口</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2">
                <Button asChild variant="outline" className="justify-start">
                  <Link to="/models">
                    <Cpu className="mr-2 h-4 w-4" />
                    查看模型账户
                  </Link>
                </Button>
                <Button asChild variant="outline" className="justify-start">
                  <Link to="/channels">
                    <Network className="mr-2 h-4 w-4" />
                    检查渠道状态
                  </Link>
                </Button>
                <Button asChild variant="outline" className="justify-start">
                  <Link to="/skills">
                    <Puzzle className="mr-2 h-4 w-4" />
                    查看已安装技能
                  </Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </section>

        {(providerError || channelsError || cronError || agentsError) && (
          <Card className="border-red-200 bg-red-50/80 dark:border-red-500/20 dark:bg-red-500/5">
            <CardHeader>
              <CardTitle className="text-xl text-red-700 dark:text-red-300">数据源告警</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-red-700 dark:text-red-200">
              {providerError && <p>模型：{providerError}</p>}
              {channelsError && <p>渠道：{channelsError}</p>}
              {cronError && <p>定时任务：{cronError}</p>}
              {agentsError && <p>智能体：{agentsError}</p>}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

export default Dashboard;
