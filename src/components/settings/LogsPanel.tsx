import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Copy, Download, ExternalLink, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { hostApiFetch } from '@/lib/host-api';
import { useSettingsStore } from '@/stores/settings';
import {
  APP_LOG_LEVELS,
  AUDIT_MODES,
  DEFAULT_APP_LOG_RETENTION_DAYS,
  DEFAULT_AUDIT_LOG_RETENTION_DAYS,
  DEFAULT_LOG_FILE_MAX_SIZE_MB,
  MAX_LOG_FILE_MAX_SIZE_MB,
  MAX_LOG_RETENTION_DAYS,
  MIN_LOG_FILE_MAX_SIZE_MB,
  MIN_LOG_RETENTION_DAYS,
  type AppLogEntry,
  type AppLogLevel,
  type AuditLogEntry,
  type AuditMode,
  type AuditResult,
  type LogFileSummary,
  type LogKind,
  type LogQueryEntry,
  normalizeLogFileMaxSizeMb,
  normalizeLogRetentionDays,
} from '../../../shared/logging';

type QueryResponse = {
  kind: LogKind;
  timezone: string;
  entries: LogQueryEntry[];
  files: LogFileSummary[];
};

type ExportResponse = {
  fileName: string;
  mimeType: string;
  content: string;
};

type LogsPanelProps = {
  onOpenFolder: () => void | Promise<void>;
};

type DatePreset = 'recent-log' | '1h' | 'today' | '24h' | '7d' | 'all' | 'custom';

type PolicyDraft = {
  appLogRetentionDays: string;
  auditLogRetentionDays: string;
  logFileMaxSizeMb: string;
};

function asLogEntries(value: unknown): LogQueryEntry[] {
  return Array.isArray(value) ? value as LogQueryEntry[] : [];
}

function asLogFiles(value: unknown): LogFileSummary[] {
  return Array.isArray(value) ? value as LogFileSummary[] : [];
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function normalizeQueryResponse(payload: QueryResponse | null | undefined): QueryResponse {
  return {
    kind: payload?.kind === 'audit' ? 'audit' : 'app',
    timezone: asString(payload?.timezone),
    entries: asLogEntries(payload?.entries),
    files: asLogFiles(payload?.files),
  };
}

function normalizeExportResponse(payload: ExportResponse | null | undefined): ExportResponse {
  return {
    fileName: asString(payload?.fileName, 'logs-export.json'),
    mimeType: asString(payload?.mimeType, 'application/json'),
    content: asString(payload?.content, '[]'),
  };
}

function formatEntryTime(epochMs: number): string {
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(epochMs);
}

function toDateTimeLocalValue(epochMs: number): string {
  const date = new Date(epochMs);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function startOfLocalDay(epochMs: number): number {
  const date = new Date(epochMs);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function endOfLocalDay(epochMs: number): number {
  const date = new Date(epochMs);
  date.setHours(23, 59, 59, 999);
  return date.getTime();
}

function isSameLocalDay(left: number, right: number): boolean {
  const leftDate = new Date(left);
  const rightDate = new Date(right);
  return leftDate.getFullYear() === rightDate.getFullYear()
    && leftDate.getMonth() === rightDate.getMonth()
    && leftDate.getDate() === rightDate.getDate();
}

function subtractHours(epochMs: number, hours: number): number {
  return epochMs - hours * 60 * 60 * 1000;
}

function subtractDays(epochMs: number, days: number): number {
  return epochMs - days * 24 * 60 * 60 * 1000;
}

function buildPresetRange(preset: Exclude<DatePreset, 'custom'>, referenceEpochMs: number): { from: string; to: string } {
  const now = referenceEpochMs;
  switch (preset) {
    case '1h':
      return { from: toDateTimeLocalValue(subtractHours(now, 1)), to: toDateTimeLocalValue(now) };
    case 'today':
      return { from: toDateTimeLocalValue(startOfLocalDay(now)), to: toDateTimeLocalValue(now) };
    case '24h':
      return { from: toDateTimeLocalValue(subtractHours(now, 24)), to: toDateTimeLocalValue(now) };
    case '7d':
      return { from: toDateTimeLocalValue(subtractDays(now, 7)), to: toDateTimeLocalValue(now) };
    case 'all':
      return { from: '', to: '' };
    case 'recent-log':
    default:
      if (isSameLocalDay(now, Date.now())) {
        return { from: toDateTimeLocalValue(startOfLocalDay(now)), to: toDateTimeLocalValue(Date.now()) };
      }
      return { from: toDateTimeLocalValue(startOfLocalDay(now)), to: toDateTimeLocalValue(endOfLocalDay(now)) };
  }
}

function deriveRecentLogRange(files: LogFileSummary[]): { from: string; to: string; preset: DatePreset } {
  const latestEpochMs = files[0]?.modifiedEpochMs ?? Date.now();
  const range = buildPresetRange('recent-log', latestEpochMs);
  return { ...range, preset: 'recent-log' };
}

function buildQueryString(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '') continue;
    search.set(key, String(value));
  }
  return search.toString();
}

function downloadTextFile(fileName: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function parsePolicyDraft(draft: PolicyDraft): {
  values: {
    appLogRetentionDays: number;
    auditLogRetentionDays: number;
    logFileMaxSizeMb: number;
  } | null;
  error: string;
} {
  const appRetention = Number.parseInt(draft.appLogRetentionDays, 10);
  const auditRetention = Number.parseInt(draft.auditLogRetentionDays, 10);
  const maxFileSize = Number.parseInt(draft.logFileMaxSizeMb, 10);

  if (!Number.isFinite(appRetention) || appRetention < MIN_LOG_RETENTION_DAYS || appRetention > MAX_LOG_RETENTION_DAYS) {
    return { values: null, error: 'logs.validation.appRetentionDays' };
  }

  if (!Number.isFinite(auditRetention) || auditRetention < MIN_LOG_RETENTION_DAYS || auditRetention > MAX_LOG_RETENTION_DAYS) {
    return { values: null, error: 'logs.validation.auditRetentionDays' };
  }

  if (!Number.isFinite(maxFileSize) || maxFileSize < MIN_LOG_FILE_MAX_SIZE_MB || maxFileSize > MAX_LOG_FILE_MAX_SIZE_MB) {
    return { values: null, error: 'logs.validation.maxFileSizeMb' };
  }

  return {
    values: {
      appLogRetentionDays: normalizeLogRetentionDays(appRetention, DEFAULT_APP_LOG_RETENTION_DAYS),
      auditLogRetentionDays: normalizeLogRetentionDays(auditRetention, DEFAULT_AUDIT_LOG_RETENTION_DAYS),
      logFileMaxSizeMb: normalizeLogFileMaxSizeMb(maxFileSize, DEFAULT_LOG_FILE_MAX_SIZE_MB),
    },
    error: '',
  };
}

function AppLogCard({ entry }: { entry: AppLogEntry }) {
  return (
    <div className="rounded-2xl border border-black/10 bg-white/80 p-4 shadow-sm dark:border-white/10 dark:bg-card/80">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="rounded-full px-3 py-1 uppercase">{entry.level}</Badge>
        <span className="text-[12px] text-muted-foreground">{formatEntryTime(entry.tsEpochMs)}</span>
        <span className="text-[12px] text-muted-foreground">{entry.fileName}</span>
      </div>
      <pre className="whitespace-pre-wrap break-words text-[12px] leading-6 text-foreground/88">{entry.message || entry.raw}</pre>
    </div>
  );
}

function AuditLogCard({ entry }: { entry: AuditLogEntry }) {
  return (
    <div className="rounded-2xl border border-black/10 bg-white/80 p-4 shadow-sm dark:border-white/10 dark:bg-card/80">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge variant={entry.result === 'failure' ? 'destructive' : 'outline'} className="rounded-full px-3 py-1">
          {entry.result}
        </Badge>
        <span className="text-[12px] font-medium text-foreground">{entry.action}</span>
        <span className="text-[12px] text-muted-foreground">{formatEntryTime(entry.tsEpochMs)}</span>
        <span className="text-[12px] text-muted-foreground">{entry.fileName}</span>
      </div>
      <div className="space-y-1 text-[12px] leading-6 text-muted-foreground">
        <p>{entry.resourceType}{entry.resourceId ? ` / ${entry.resourceId}` : ''}</p>
        {entry.requestId && <p>requestId: {entry.requestId}</p>}
        {entry.changedKeys && entry.changedKeys.length > 0 && <p>changed: {entry.changedKeys.join(', ')}</p>}
        {entry.error && <p className="text-red-600 dark:text-red-400">error: {entry.error}</p>}
      </div>
      {entry.metadata && Object.keys(entry.metadata).length > 0 && (
        <pre className="mt-3 whitespace-pre-wrap break-words rounded-xl bg-black/5 p-3 text-[11px] leading-5 text-foreground/78 dark:bg-white/5">
          {JSON.stringify(entry.metadata, null, 2)}
        </pre>
      )}
    </div>
  );
}

export function LogsPanel({ onOpenFolder }: LogsPanelProps) {
  const { t } = useTranslation('settings');
  const {
    logLevel,
    setLogLevel,
    auditEnabled,
    setAuditEnabled,
    auditMode,
    setAuditMode,
    appLogRetentionDays,
    auditLogRetentionDays,
    logFileMaxSizeMb,
    saveLoggingPolicy,
  } = useSettingsStore();
  const [kind, setKind] = useState<LogKind>('app');
  const [expanded, setExpanded] = useState(false);
  const [datePreset, setDatePreset] = useState<DatePreset>('recent-log');
  const [search, setSearch] = useState('');
  const [level, setLevel] = useState<AppLogLevel | 'all'>('all');
  const [result, setResult] = useState<AuditResult | 'all'>('all');
  const [fileName, setFileName] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [entries, setEntries] = useState<LogQueryEntry[]>([]);
  const [files, setFiles] = useState<LogFileSummary[]>([]);
  const [timezone, setTimezone] = useState('');
  const [loading, setLoading] = useState(false);
  const [initializingRange, setInitializingRange] = useState(false);
  const [error, setError] = useState('');
  const [recentRangeNonce, setRecentRangeNonce] = useState(0);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [policyDraft, setPolicyDraft] = useState<PolicyDraft>({
    appLogRetentionDays: String(appLogRetentionDays),
    auditLogRetentionDays: String(auditLogRetentionDays),
    logFileMaxSizeMb: String(logFileMaxSizeMb),
  });

  const deferredSearch = useDeferredValue(search);
  const normalizedPolicy = useMemo(() => parsePolicyDraft(policyDraft), [policyDraft]);
  const policyDirty = policyDraft.appLogRetentionDays !== String(appLogRetentionDays)
    || policyDraft.auditLogRetentionDays !== String(auditLogRetentionDays)
    || policyDraft.logFileMaxSizeMb !== String(logFileMaxSizeMb);

  const queryString = useMemo(() => buildQueryString({
    kind,
    search: deferredSearch.trim() || undefined,
    level: kind === 'app' ? level : undefined,
    result: kind === 'audit' ? result : undefined,
    fileName: fileName || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    limit: 200,
  }), [dateFrom, dateTo, deferredSearch, fileName, kind, level, result]);

  useEffect(() => {
    if (!expanded) {
      return;
    }

    let cancelled = false;

    const primeRange = async () => {
      setInitializingRange(true);
      try {
        const response = await hostApiFetch<{ files?: LogFileSummary[]; timezone?: string }>(`/api/logs/files?kind=${kind}`);
        if (cancelled) return;
        const normalizedFiles = asLogFiles(response?.files);
        setFiles(normalizedFiles);
        setTimezone(asString(response?.timezone));
        const range = deriveRecentLogRange(normalizedFiles);
        setDatePreset(range.preset);
        setDateFrom(range.from);
        setDateTo(range.to);
      } catch {
        if (cancelled) return;
        setDatePreset('all');
        setDateFrom('');
        setDateTo('');
      } finally {
        if (!cancelled) {
          setInitializingRange(false);
        }
      }
    };

    void primeRange();
    return () => { cancelled = true; };
  }, [expanded, kind, recentRangeNonce]);

  useEffect(() => {
    if (!expanded) {
      setLoading(false);
      setError('');
      setEntries([]);
      setFiles([]);
      setTimezone('');
      return;
    }

    let cancelled = false;

    const load = async () => {
      if (initializingRange) return;
      setLoading(true);
      setError('');
      try {
        const rawPayload = await hostApiFetch<QueryResponse>(`/api/logs/query?${queryString}`);
        const payload = normalizeQueryResponse(rawPayload);
        if (cancelled) return;
        setEntries(payload.entries);
        setFiles(payload.files);
        setTimezone(payload.timezone);
      } catch (loadError) {
        if (cancelled) return;
        setEntries([]);
        setFiles([]);
        setError(String(loadError));
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [expanded, initializingRange, queryString, refreshNonce]);

  useEffect(() => {
    setFileName('');
  }, [kind]);

  useEffect(() => {
    setPolicyDraft({
      appLogRetentionDays: String(appLogRetentionDays),
      auditLogRetentionDays: String(auditLogRetentionDays),
      logFileMaxSizeMb: String(logFileMaxSizeMb),
    });
  }, [appLogRetentionDays, auditLogRetentionDays, logFileMaxSizeMb]);

  const applyPreset = (preset: Exclude<DatePreset, 'custom'>) => {
    if (preset === 'recent-log') {
      setDatePreset('recent-log');
      setRecentRangeNonce((value) => value + 1);
      return;
    }
    const range = buildPresetRange(preset, Date.now());
    setDatePreset(preset);
    setDateFrom(range.from);
    setDateTo(range.to);
  };

  const handleExport = async () => {
    try {
      const rawPayload = await hostApiFetch<ExportResponse>(`/api/logs/export?${queryString}`);
      const payload = normalizeExportResponse(rawPayload);
      downloadTextFile(payload.fileName, payload.content, payload.mimeType);
      toast.success(t('logs.exported'));
    } catch (exportError) {
      toast.error(`${t('logs.exportFailed')}: ${String(exportError)}`);
    }
  };

  const handleCopyVisible = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(entries, null, 2));
      toast.success(t('logs.copied'));
    } catch (copyError) {
      toast.error(`${t('logs.copyFailed')}: ${String(copyError)}`);
    }
  };

  const handleLogLevelChange = (value: string) => {
    setLogLevel(value as AppLogLevel);
    toast.success(t('developer.logLevelSaved'));
  };

  const handleAuditEnabledToggle = (enabled: boolean) => {
    setAuditEnabled(enabled);
    toast.success(enabled ? t('developer.auditEnabled') : t('developer.auditDisabled'));
  };

  const handleAuditModeChange = (value: string) => {
    setAuditMode(value as AuditMode);
    toast.success(t('developer.auditModeSaved'));
  };

  const handleSavePolicy = async () => {
    if (!normalizedPolicy.values) return;
    try {
      await saveLoggingPolicy(normalizedPolicy.values);
      toast.success(t('logs.policySaved'));
    } catch (saveError) {
      toast.error(`${t('logs.policySaveFailed')}: ${String(saveError)}`);
    }
  };

  const handleResetPolicy = async () => {
    const defaults = {
      appLogRetentionDays: DEFAULT_APP_LOG_RETENTION_DAYS,
      auditLogRetentionDays: DEFAULT_AUDIT_LOG_RETENTION_DAYS,
      logFileMaxSizeMb: DEFAULT_LOG_FILE_MAX_SIZE_MB,
    };
    setPolicyDraft({
      appLogRetentionDays: String(defaults.appLogRetentionDays),
      auditLogRetentionDays: String(defaults.auditLogRetentionDays),
      logFileMaxSizeMb: String(defaults.logFileMaxSizeMb),
    });
    try {
      await saveLoggingPolicy(defaults);
      toast.success(t('logs.policyResetSaved'));
    } catch (saveError) {
      toast.error(`${t('logs.policySaveFailed')}: ${String(saveError)}`);
    }
  };

  return (
    <div
      data-testid="settings-logs-panel"
      className="space-y-5 rounded-[28px] border border-black/10 bg-black/[0.025] p-6 dark:border-white/10 dark:bg-white/[0.03]"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1">
          <h3 className="text-[17px] font-semibold text-foreground">{t('logs.title')}</h3>
          <p className="max-w-2xl text-[13px] leading-6 text-muted-foreground">{t('logs.description')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="rounded-full px-3 py-1">
            {t('logs.timezone')}: {timezone || t('logs.localTimezone')}
          </Badge>
          <Badge variant="outline" className="rounded-full px-3 py-1">
            {t('logs.count', { count: expanded ? entries.length : 0 })}
          </Badge>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="settings-logs-toggle"
            onClick={() => setExpanded((value) => !value)}
            className="rounded-full border-black/10 bg-transparent hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
          >
            {expanded ? t('logs.hideViewer') : t('logs.showViewer')}
          </Button>
          {expanded && (
            <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setRefreshNonce((value) => value + 1)}
            className="rounded-full border-black/10 bg-transparent hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            {t('common:actions.refresh')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCopyVisible}
            className="rounded-full border-black/10 bg-transparent hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
          >
            <Copy className="mr-1.5 h-3.5 w-3.5" />
            {t('common:actions.copy')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleExport}
            className="rounded-full border-black/10 bg-transparent hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            {t('logs.export')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void onOpenFolder()}
            className="rounded-full border-black/10 bg-transparent hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
          >
            <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
            {t('gateway.openFolder')}
          </Button>
            </>
          )}
        </div>
      </div>

      <div className="space-y-4 rounded-2xl border border-black/10 bg-white/70 p-5 dark:border-white/10 dark:bg-card/70">
        <div className="space-y-1">
          <h4 className="text-[14px] font-semibold text-foreground">{t('logs.policyTitle')}</h4>
          <p className="text-[12px] leading-6 text-muted-foreground">{t('logs.policyDescription')}</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="settings-visible-log-level" className="text-[13px] font-medium text-foreground/80">
              {t('developer.logLevel')}
            </Label>
            <Select
              id="settings-visible-log-level"
              data-testid="settings-visible-log-level-select"
              value={logLevel}
              onChange={(event) => handleLogLevelChange(event.target.value)}
              className="rounded-xl border-black/10 bg-white dark:border-white/10 dark:bg-card"
            >
              {APP_LOG_LEVELS.map((option) => (
                <option key={option} value={option}>
                  {t(`developer.logLevelOptions.${option}`)}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="settings-visible-audit-mode" className="text-[13px] font-medium text-foreground/80">
              {t('developer.auditMode')}
            </Label>
            <Select
              id="settings-visible-audit-mode"
              data-testid="settings-visible-audit-mode-select"
              value={auditMode}
              onChange={(event) => handleAuditModeChange(event.target.value)}
              disabled={!auditEnabled}
              className="rounded-xl border-black/10 bg-white dark:border-white/10 dark:bg-card"
            >
              {AUDIT_MODES.map((option) => (
                <option key={option} value={option}>
                  {t(`developer.auditModeOptions.${option}`)}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex items-end justify-between gap-4 rounded-xl border border-black/10 bg-black/[0.025] px-4 py-3 dark:border-white/10 dark:bg-white/[0.025]">
            <div className="space-y-1">
              <Label className="text-[13px] font-medium text-foreground/80">{t('logs.auditToggle')}</Label>
              <p className="text-[12px] leading-5 text-muted-foreground">{t('logs.auditToggleDesc')}</p>
            </div>
            <Switch
              checked={auditEnabled}
              data-testid="settings-visible-audit-enabled-switch"
              onCheckedChange={handleAuditEnabledToggle}
            />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="settings-app-log-retention-days" className="text-[13px] font-medium text-foreground/80">
              {t('logs.appRetentionDays')}
            </Label>
            <Input
              id="settings-app-log-retention-days"
              type="number"
              min={MIN_LOG_RETENTION_DAYS}
              max={MAX_LOG_RETENTION_DAYS}
              step={1}
              value={policyDraft.appLogRetentionDays}
              onChange={(event) => setPolicyDraft((current) => ({ ...current, appLogRetentionDays: event.target.value }))}
              data-testid="settings-app-log-retention-input"
              className="rounded-xl border-black/10 bg-white dark:border-white/10 dark:bg-card"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="settings-audit-log-retention-days" className="text-[13px] font-medium text-foreground/80">
              {t('logs.auditRetentionDays')}
            </Label>
            <Input
              id="settings-audit-log-retention-days"
              type="number"
              min={MIN_LOG_RETENTION_DAYS}
              max={MAX_LOG_RETENTION_DAYS}
              step={1}
              value={policyDraft.auditLogRetentionDays}
              onChange={(event) => setPolicyDraft((current) => ({ ...current, auditLogRetentionDays: event.target.value }))}
              data-testid="settings-audit-log-retention-input"
              className="rounded-xl border-black/10 bg-white dark:border-white/10 dark:bg-card"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="settings-log-file-max-size" className="text-[13px] font-medium text-foreground/80">
              {t('logs.maxFileSizeMb')}
            </Label>
            <Input
              id="settings-log-file-max-size"
              type="number"
              min={MIN_LOG_FILE_MAX_SIZE_MB}
              max={MAX_LOG_FILE_MAX_SIZE_MB}
              step={1}
              value={policyDraft.logFileMaxSizeMb}
              onChange={(event) => setPolicyDraft((current) => ({ ...current, logFileMaxSizeMb: event.target.value }))}
              data-testid="settings-log-file-max-size-input"
              className="rounded-xl border-black/10 bg-white dark:border-white/10 dark:bg-card"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="rounded-full px-3 py-1">
            {t('logs.policyBadgeAppRetention', { count: appLogRetentionDays })}
          </Badge>
          <Badge variant="outline" className="rounded-full px-3 py-1">
            {t('logs.policyBadgeAuditRetention', { count: auditLogRetentionDays })}
          </Badge>
          <Badge variant="outline" className="rounded-full px-3 py-1">
            {t('logs.policyBadgeMaxSize', { count: logFileMaxSizeMb })}
          </Badge>
        </div>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <p className="text-[12px] leading-6 text-muted-foreground">{t('logs.policyHint')}</p>
            {normalizedPolicy.error ? (
              <p className="text-[12px] leading-5 text-red-600 dark:text-red-400">{t(normalizedPolicy.error)}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPolicyDraft({
                appLogRetentionDays: String(appLogRetentionDays),
                auditLogRetentionDays: String(auditLogRetentionDays),
                logFileMaxSizeMb: String(logFileMaxSizeMb),
              })}
              disabled={!policyDirty}
              className="rounded-full border-black/10 bg-transparent hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
            >
              {t('logs.policyRevert')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleResetPolicy()}
              className="rounded-full border-black/10 bg-transparent hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
            >
              {t('logs.policyReset')}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void handleSavePolicy()}
              disabled={!policyDirty || normalizedPolicy.values == null}
              data-testid="settings-save-log-policy"
              className="rounded-full px-4"
            >
              {t('logs.policyApply')}
            </Button>
          </div>
        </div>
      </div>

      {!expanded ? (
        <div className="rounded-2xl border border-dashed border-black/10 bg-white/60 px-4 py-5 text-[13px] leading-6 text-muted-foreground dark:border-white/10 dark:bg-card/50">
          {t('logs.collapsedHint')}
        </div>
      ) : (
        <>
      <Tabs value={kind} onValueChange={(value) => setKind(value as LogKind)} data-testid="settings-logs-tabs">
        <TabsList className="rounded-2xl bg-white/70 p-1 dark:bg-card/70">
          <TabsTrigger value="app" data-testid="settings-logs-tab-app">{t('logs.app')}</TabsTrigger>
          <TabsTrigger value="audit" data-testid="settings-logs-tab-audit">{t('logs.audit')}</TabsTrigger>
        </TabsList>

        <TabsContent value="app" className="mt-5 space-y-5">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <div className="space-y-2 xl:col-span-2">
              <Label htmlFor="settings-logs-search-app">{t('logs.search')}</Label>
              <Input
                id="settings-logs-search-app"
                data-testid="settings-logs-search-input"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t('logs.searchPlaceholder')}
                className="rounded-xl border-black/10 bg-white dark:border-white/10 dark:bg-card"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="settings-logs-level-select">{t('logs.level')}</Label>
              <Select
                id="settings-logs-level-select"
                data-testid="settings-logs-level-select"
                value={level}
                onChange={(event) => setLevel(event.target.value as AppLogLevel | 'all')}
                className="rounded-xl border-black/10 bg-white dark:border-white/10 dark:bg-card"
              >
                <option value="all">{t('logs.allLevels')}</option>
                {APP_LOG_LEVELS.map((item) => (
                  <option key={item} value={item}>{t(`developer.logLevelOptions.${item}`)}</option>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="settings-logs-file-select-app">{t('logs.file')}</Label>
              <Select
                id="settings-logs-file-select-app"
                data-testid="settings-logs-file-select"
                value={fileName}
                onChange={(event) => setFileName(event.target.value)}
                className="rounded-xl border-black/10 bg-white dark:border-white/10 dark:bg-card"
              >
                <option value="">{t('logs.allFiles')}</option>
                {files.map((file) => (
                  <option key={file.name} value={file.name}>{file.name}</option>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="settings-logs-date-from-app">{t('logs.dateFrom')}</Label>
              <Input
                id="settings-logs-date-from-app"
                type="datetime-local"
                value={dateFrom}
                onChange={(event) => {
                  setDatePreset('custom');
                  setDateFrom(event.target.value);
                }}
                className="rounded-xl border-black/10 bg-white dark:border-white/10 dark:bg-card"
              />
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <div className="space-y-2 xl:col-span-2">
              <p className="pt-7 text-[12px] leading-6 text-muted-foreground">{t('logs.localTimeHint')}</p>
              <div className="flex flex-wrap gap-2 pt-1">
                {(['recent-log', '1h', 'today', '24h', '7d', 'all'] as const).map((preset) => (
                  <Button
                    key={preset}
                    type="button"
                    variant={datePreset === preset ? 'secondary' : 'outline'}
                    size="sm"
                    onClick={() => applyPreset(preset)}
                    className="h-8 rounded-full border-black/10 bg-transparent px-4 text-[12px] dark:border-white/10"
                  >
                    {t(`logs.presets.${preset}`)}
                  </Button>
                ))}
              </div>
            </div>
            <div />
            <div />
            <div className="space-y-2">
              <Label htmlFor="settings-logs-date-to-app">{t('logs.dateTo')}</Label>
              <Input
                id="settings-logs-date-to-app"
                type="datetime-local"
                value={dateTo}
                onChange={(event) => {
                  setDatePreset('custom');
                  setDateTo(event.target.value);
                }}
                className="rounded-xl border-black/10 bg-white dark:border-white/10 dark:bg-card"
              />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="audit" className="mt-5 space-y-5">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <div className="space-y-2 xl:col-span-2">
              <Label htmlFor="settings-logs-search-audit">{t('logs.search')}</Label>
              <Input
                id="settings-logs-search-audit"
                data-testid="settings-logs-search-input-audit"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t('logs.auditSearchPlaceholder')}
                className="rounded-xl border-black/10 bg-white dark:border-white/10 dark:bg-card"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="settings-logs-result-select">{t('logs.result')}</Label>
              <Select
                id="settings-logs-result-select"
                data-testid="settings-logs-result-select"
                value={result}
                onChange={(event) => setResult(event.target.value as AuditResult | 'all')}
                className="rounded-xl border-black/10 bg-white dark:border-white/10 dark:bg-card"
              >
                <option value="all">{t('logs.allResults')}</option>
                <option value="success">{t('logs.results.success')}</option>
                <option value="failure">{t('logs.results.failure')}</option>
                <option value="noop">{t('logs.results.noop')}</option>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="settings-logs-file-select-audit">{t('logs.file')}</Label>
              <Select
                id="settings-logs-file-select-audit"
                data-testid="settings-logs-file-select-audit"
                value={fileName}
                onChange={(event) => setFileName(event.target.value)}
                className="rounded-xl border-black/10 bg-white dark:border-white/10 dark:bg-card"
              >
                <option value="">{t('logs.allFiles')}</option>
                {files.map((file) => (
                  <option key={file.name} value={file.name}>{file.name}</option>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="settings-logs-date-from-audit">{t('logs.dateFrom')}</Label>
              <Input
                id="settings-logs-date-from-audit"
                type="datetime-local"
                value={dateFrom}
                onChange={(event) => {
                  setDatePreset('custom');
                  setDateFrom(event.target.value);
                }}
                className="rounded-xl border-black/10 bg-white dark:border-white/10 dark:bg-card"
              />
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <div className="space-y-2 xl:col-span-2">
              <p className="pt-7 text-[12px] leading-6 text-muted-foreground">{t('logs.auditHint')}</p>
              <div className="flex flex-wrap gap-2 pt-1">
                {(['recent-log', '1h', 'today', '24h', '7d', 'all'] as const).map((preset) => (
                  <Button
                    key={preset}
                    type="button"
                    variant={datePreset === preset ? 'secondary' : 'outline'}
                    size="sm"
                    onClick={() => applyPreset(preset)}
                    className="h-8 rounded-full border-black/10 bg-transparent px-4 text-[12px] dark:border-white/10"
                  >
                    {t(`logs.presets.${preset}`)}
                  </Button>
                ))}
              </div>
            </div>
            <div />
            <div />
            <div className="space-y-2">
              <Label htmlFor="settings-logs-date-to-audit">{t('logs.dateTo')}</Label>
              <Input
                id="settings-logs-date-to-audit"
                type="datetime-local"
                value={dateTo}
                onChange={(event) => {
                  setDatePreset('custom');
                  setDateTo(event.target.value);
                }}
                className="rounded-xl border-black/10 bg-white dark:border-white/10 dark:bg-card"
              />
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
          {error}
        </div>
      ) : null}

      <div className="space-y-3" data-testid="settings-logs-results">
        {loading ? (
          <div className="rounded-2xl border border-black/10 bg-white/70 px-4 py-8 text-center text-[13px] text-muted-foreground dark:border-white/10 dark:bg-card/70">
            {t('common:status.loading')}
          </div>
        ) : entries.length === 0 ? (
          <div className="rounded-2xl border border-black/10 bg-white/70 px-4 py-8 text-center text-[13px] text-muted-foreground dark:border-white/10 dark:bg-card/70">
            <p>{t('logs.empty')}</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => applyPreset('7d')}
                className="h-8 rounded-full border-black/10 bg-transparent px-4 text-[12px] dark:border-white/10"
              >
                {t('logs.expandTo7d')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => applyPreset('all')}
                className="h-8 rounded-full border-black/10 bg-transparent px-4 text-[12px] dark:border-white/10"
              >
                {t('logs.clearTimeFilter')}
              </Button>
            </div>
          </div>
        ) : kind === 'app' ? (
          (entries as AppLogEntry[]).map((entry) => (
            <AppLogCard key={entry.id} entry={entry} />
          ))
        ) : (
          (entries as AuditLogEntry[]).map((entry) => (
            <AuditLogCard key={entry.id} entry={entry} />
          ))
        )}
      </div>
        </>
      )}
    </div>
  );
}
