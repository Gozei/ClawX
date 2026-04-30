import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, Gauge, RefreshCw, Sparkles, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Select } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useGatewayStore } from '@/stores/gateway';
import { useSettingsStore } from '@/stores/settings';
import { useBranding } from '@/lib/branding';
import { cn } from '@/lib/utils';
import {
  DREAM_MEMORY_PROMOTION_SPEEDS,
  normalizeDreamMemoryPromotionSpeed,
  type DreamMemoryPromotionSpeed,
} from '../../../shared/dream-memory';

type DreamingPhase = {
  enabled?: boolean;
  cron?: string;
  nextRunAtMs?: number;
  managedCronPresent?: boolean;
};

type DreamingEntry = {
  path?: string;
  preview?: string;
  text?: string;
  lastRecalledAt?: string;
  promotedAt?: string;
  totalSignalCount?: number;
  phaseHitCount?: number;
};

type DreamStatus = {
  agentId?: string;
  embedding?: {
    ok?: boolean;
    error?: string;
  };
  dreaming?: {
    enabled?: boolean;
    frequency?: string;
    timezone?: string;
    shortTermCount?: number;
    totalSignalCount?: number;
    groundedSignalCount?: number;
    promotedToday?: number;
    promotedTotal?: number;
    storeError?: string;
    shortTermEntries?: DreamingEntry[];
    signalEntries?: DreamingEntry[];
    promotedEntries?: DreamingEntry[];
    phases?: {
      light?: DreamingPhase;
      deep?: DreamingPhase;
      rem?: DreamingPhase;
    };
  };
};

type DreamDiary = {
  found?: boolean;
  path?: string;
  content?: string;
  updatedAtMs?: number;
};

type DreamActionResult = {
  action?: string;
  written?: number;
  replaced?: number;
  removedEntries?: number;
  dedupedEntries?: number;
  changed?: boolean;
  warnings?: string[];
};

const PROMOTION_SPEED_OPTIONS = [...DREAM_MEMORY_PROMOTION_SPEEDS];

function formatNumber(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? String(value)
    : '0';
}

function formatDateTime(value: unknown): string {
  const ms = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(ms)) return '-';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ms));
}

function entryText(entry: DreamingEntry): string {
  return entry.preview || entry.text || entry.path || '-';
}

function summarizeDiary(content?: string): string[] {
  if (!content) return [];
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('<!--'))
    .slice(0, 12);
}

export function Dream() {
  const { t } = useTranslation(['settings', 'common']);
  const branding = useBranding();
  const gatewayStatus = useGatewayStore((state) => state.status);
  const startGateway = useGatewayStore((state) => state.start);
  const rpc = useGatewayStore((state) => state.rpc);
  const dreamMemoryPromotionSpeed = useSettingsStore((state) => state.dreamMemoryPromotionSpeed);
  const setDreamMemoryPromotionSpeed = useSettingsStore((state) => state.setDreamMemoryPromotionSpeed);
  const [status, setStatus] = useState<DreamStatus | null>(null);
  const [diary, setDiary] = useState<DreamDiary | null>(null);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<string | null>(null);
  const [savingPromotionSpeed, setSavingPromotionSpeed] = useState(false);

  const dream = status?.dreaming;
  const promotionSpeed = normalizeDreamMemoryPromotionSpeed(dreamMemoryPromotionSpeed);
  const diaryLines = useMemo(() => summarizeDiary(diary?.content), [diary?.content]);

  const refresh = useCallback(async () => {
    if (gatewayStatus.state !== 'running') return;
    setLoading(true);
    try {
      const [nextStatus, nextDiary] = await Promise.all([
        rpc<DreamStatus>('doctor.memory.status', {}, 30_000),
        rpc<DreamDiary>('doctor.memory.dreamDiary', {}, 30_000),
      ]);
      setStatus(nextStatus);
      setDiary(nextDiary);
    } catch (error) {
      toast.error(String(error));
    } finally {
      setLoading(false);
    }
  }, [gatewayStatus.state, rpc]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runAction = async (method: string, label: string) => {
    setAction(method);
    try {
      const result = await rpc<DreamActionResult>(method, {}, 120_000);
      toast.success(t('dream.actionDone', {
        action: label,
        count: result.written ?? result.removedEntries ?? result.dedupedEntries ?? 0,
      }));
      await refresh();
    } catch (error) {
      toast.error(String(error));
    } finally {
      setAction(null);
    }
  };

  const changePromotionSpeed = async (nextValue: string) => {
    const nextSpeed = normalizeDreamMemoryPromotionSpeed(nextValue);
    if (nextSpeed === promotionSpeed || savingPromotionSpeed) return;
    setSavingPromotionSpeed(true);
    try {
      const changed = await setDreamMemoryPromotionSpeed(nextSpeed);
      if (changed) {
        toast.success(t('dream.promotion.saved'));
      }
    } catch (error) {
      toast.error(String(error));
    } finally {
      setSavingPromotionSpeed(false);
    }
  };

  return (
    <div data-testid="dream-page" className="-m-6 h-[calc(100vh-2.5rem)] overflow-hidden bg-background">
      <div className="mx-auto flex h-full w-full max-w-6xl flex-col px-8 py-10">
        <PageHeader
          title={t('dream.title')}
          subtitle={t('dream.subtitle', { appName: branding.productName })}
          titleTestId="dream-page-title"
        />

        <div className="min-h-0 flex-1 overflow-y-auto pb-10 pr-2">
          <div className="space-y-8">
            <section className="rounded-lg border border-black/8 bg-black/[0.02] p-5 dark:border-white/10 dark:bg-white/[0.02]">
              <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Gauge className="h-4 w-4 text-muted-foreground" />
                    <h2 className="text-[18px] font-semibold text-foreground">{t('dream.promotion.title')}</h2>
                  </div>
                  <p className="mt-2 text-[13px] leading-6 text-foreground/78" data-testid="dream-promotion-speed-summary">
                    {t(`dream.promotion.options.${promotionSpeed}.description`)}
                  </p>
                </div>
                <div className="w-full md:w-64">
                  <Label htmlFor="dream-promotion-speed-select" className="text-[13px] text-muted-foreground">
                    {t('dream.promotion.selectLabel')}
                  </Label>
                  <Select
                    id="dream-promotion-speed-select"
                    value={promotionSpeed}
                    onChange={(event) => void changePromotionSpeed(event.target.value)}
                    disabled={savingPromotionSpeed}
                    data-testid="dream-promotion-speed-select"
                    className="mt-2"
                  >
                    {PROMOTION_SPEED_OPTIONS.map((speed: DreamMemoryPromotionSpeed) => (
                      <option key={speed} value={speed}>
                        {t(`dream.promotion.options.${speed}.label`)}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
            </section>

            {gatewayStatus.state !== 'running' ? (
            <section className="rounded-lg border border-black/8 bg-black/[0.02] p-5 dark:border-white/10 dark:bg-white/[0.02]">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-[18px] font-semibold text-foreground">{t('dream.gatewayStopped')}</h2>
                  <p className="mt-1 text-[13px] text-muted-foreground">{t('dream.gatewayStoppedDesc')}</p>
                </div>
                <Button onClick={() => void startGateway()} data-testid="dream-start-gateway">
                  <Sparkles className="mr-2 h-4 w-4" />
                  {t('dream.startGateway')}
                </Button>
              </div>
            </section>
            ) : (
            <div className="space-y-8">
              <section className="grid gap-4 md:grid-cols-4">
                {[
                  [t('dream.metrics.shortTerm'), formatNumber(dream?.shortTermCount)],
                  [t('dream.metrics.signals'), formatNumber(dream?.totalSignalCount)],
                  [t('dream.metrics.grounded'), formatNumber(dream?.groundedSignalCount)],
                  [t('dream.metrics.promotedToday'), formatNumber(dream?.promotedToday)],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg border border-black/8 bg-black/[0.02] p-4 dark:border-white/10 dark:bg-white/[0.02]">
                    <p className="text-[12px] text-muted-foreground">{label}</p>
                    <p className="mt-2 text-[28px] font-semibold tracking-normal text-foreground">{value}</p>
                  </div>
                ))}
              </section>

              <section className="rounded-lg border border-black/8 bg-black/[0.02] p-5 dark:border-white/10 dark:bg-white/[0.02]">
                <div className="flex flex-wrap items-center gap-3">
                  <Badge variant={dream?.enabled ? 'secondary' : 'outline'} data-testid="dream-enabled-badge">
                    {dream?.enabled ? t('dream.status.enabled') : t('dream.status.disabled')}
                  </Badge>
                  <span className="text-[13px] text-muted-foreground">
                    {t('dream.status.schedule')}: {dream?.frequency || '-'}
                  </span>
                  {dream?.timezone && (
                    <span className="text-[13px] text-muted-foreground">
                      {t('dream.status.timezone')}: {dream.timezone}
                    </span>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void refresh()}
                    disabled={loading}
                    data-testid="dream-refresh"
                    className="ml-auto bg-transparent"
                  >
                    <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
                    {t('common:actions.refresh')}
                  </Button>
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-3">
                  {(['light', 'deep', 'rem'] as const).map((phase) => {
                    const phaseStatus = dream?.phases?.[phase];
                    return (
                      <div key={phase} className="rounded-lg border border-black/8 bg-background p-4 dark:border-white/10">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-[14px] font-medium text-foreground">{t(`dream.phase.${phase}`)}</p>
                          <Badge variant={phaseStatus?.enabled ? 'secondary' : 'outline'}>
                            {phaseStatus?.enabled ? t('common:status.enabled') : t('common:status.disabled')}
                          </Badge>
                        </div>
                        <p className="mt-3 text-[13px] text-muted-foreground">
                          {t('dream.status.nextRun')}: {formatDateTime(phaseStatus?.nextRunAtMs)}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="grid gap-5 lg:grid-cols-[1fr_0.9fr]">
                <div className="rounded-lg border border-black/8 bg-black/[0.02] p-5 dark:border-white/10 dark:bg-white/[0.02]">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <h2 className="text-[18px] font-semibold text-foreground">{t('dream.diary.title')}</h2>
                    <Badge variant="outline">{diary?.path || 'DREAMS.md'}</Badge>
                  </div>
                  {diaryLines.length > 0 ? (
                    <div className="space-y-2">
                      {diaryLines.map((line, index) => (
                        <p key={`${line}-${index}`} className="text-[13px] leading-6 text-foreground/78">
                          {line}
                        </p>
                      ))}
                    </div>
                  ) : (
                    <div className="flex min-h-40 items-center justify-center rounded-lg border border-dashed border-black/10 text-[13px] text-muted-foreground dark:border-white/10">
                      {t('dream.diary.empty')}
                    </div>
                  )}
                </div>

                <div className="rounded-lg border border-black/8 bg-black/[0.02] p-5 dark:border-white/10 dark:bg-white/[0.02]">
                  <h2 className="text-[18px] font-semibold text-foreground">{t('dream.actions.title')}</h2>
                  <div className="mt-4 grid gap-2">
                    {[
                      ['doctor.memory.backfillDreamDiary', t('dream.actions.backfill'), BookOpen],
                      ['doctor.memory.dedupeDreamDiary', t('dream.actions.dedupe'), Wand2],
                      ['doctor.memory.resetGroundedShortTerm', t('dream.actions.clearGrounded'), RefreshCw],
                      ['doctor.memory.repairDreamingArtifacts', t('dream.actions.repair'), Sparkles],
                    ].map(([method, label, Icon]) => (
                      <Button
                        key={method as string}
                        type="button"
                        variant="outline"
                        onClick={() => void runAction(method as string, label as string)}
                        disabled={action !== null}
                        className="justify-start bg-transparent"
                      >
                        <Icon className={cn('mr-2 h-4 w-4', action === method && 'animate-spin')} />
                        {label as string}
                      </Button>
                    ))}
                  </div>
                </div>
              </section>

              <Separator className="bg-black/5 dark:bg-white/5" />

              <section className="grid gap-5 lg:grid-cols-3">
                {[
                  [t('dream.lists.waiting'), dream?.shortTermEntries ?? []],
                  [t('dream.lists.strongest'), dream?.signalEntries ?? []],
                  [t('dream.lists.promoted'), dream?.promotedEntries ?? []],
                ].map(([title, entries]) => (
                  <div key={title as string} className="rounded-lg border border-black/8 bg-black/[0.02] p-5 dark:border-white/10 dark:bg-white/[0.02]">
                    <h2 className="text-[16px] font-semibold text-foreground">{title as string}</h2>
                    <div className="mt-4 space-y-3">
                      {(entries as DreamingEntry[]).length > 0 ? (
                        (entries as DreamingEntry[]).map((entry, index) => (
                          <div key={`${entry.path || index}-${index}`} className="rounded-lg border border-black/8 bg-background p-3 dark:border-white/10">
                            <p className="line-clamp-3 text-[13px] leading-5 text-foreground/82">{entryText(entry)}</p>
                            <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                              <span>{t('dream.lists.signals')}: {formatNumber(entry.totalSignalCount)}</span>
                              <span>{t('dream.lists.phaseHits')}: {formatNumber(entry.phaseHitCount)}</span>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="rounded-lg border border-dashed border-black/10 px-3 py-6 text-center text-[13px] text-muted-foreground dark:border-white/10">
                          {t('dream.lists.empty')}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </section>
            </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default Dream;
