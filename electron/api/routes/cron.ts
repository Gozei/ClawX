import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'http';
import { join } from 'node:path';
import type { HostApiContext } from '../context';
import { emitMutationAudit } from '../audit-utils';
import { parseJsonBody, sendJson } from '../route-utils';
import { getOpenClawConfigDir } from '../../utils/paths';
import { ensureWeChatPluginInstalled } from '../../utils/plugin-install';
import {
  OPENCLAW_WECHAT_CHANNEL_TYPE,
  isWechatChannelType,
  toOpenClawChannelType,
  toUiChannelType,
} from '../../utils/channel-alias';
import { ensureWeChatPluginRegistration } from '../../utils/channel-config';

interface GatewayCronJob {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  createdAtMs?: number;
  updatedAtMs?: number;
  schedule: { kind: string; expr?: string; everyMs?: number; anchorMs?: number; at?: string; tz?: string };
  payload?: { kind: string; message?: string; text?: string };
  delivery?: { mode: string; channel?: string; to?: string; accountId?: string };
  sessionTarget?: string;
  state?: {
    nextRunAtMs?: number;
    runningAtMs?: number;
    lastRunAtMs?: number;
    lastStatus?: string;
    lastError?: string;
    lastDurationMs?: number;
  };
}

interface CronRunLogEntry {
  jobId?: string;
  action?: string;
  status?: string;
  error?: string;
  summary?: string;
  sessionId?: string;
  sessionKey?: string;
  ts?: number;
  runAtMs?: number;
  durationMs?: number;
  model?: string;
  provider?: string;
}

interface CronSessionKeyParts {
  agentId: string;
  jobId: string;
  runSessionId?: string;
}

interface CronSessionFallbackMessage {
  id: string;
  role: 'assistant' | 'system';
  content: string;
  timestamp: number;
  isError?: boolean;
}

function parseCronSessionKey(sessionKey: string): CronSessionKeyParts | null {
  if (!sessionKey.startsWith('agent:')) return null;
  const parts = sessionKey.split(':');
  if (parts.length < 4 || parts[2] !== 'cron') return null;

  const agentId = parts[1] || 'main';
  const jobId = parts[3];
  if (!jobId) return null;

  if (parts.length === 4) {
    return { agentId, jobId };
  }

  if (parts.length === 6 && parts[4] === 'run' && parts[5]) {
    return { agentId, jobId, runSessionId: parts[5] };
  }

  return null;
}

function normalizeTimestampMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function formatDuration(durationMs: number | undefined): string | null {
  if (!durationMs || !Number.isFinite(durationMs)) return null;
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  if (durationMs < 10_000) return `${(durationMs / 1000).toFixed(1)}s`;
  return `${Math.round(durationMs / 1000)}s`;
}

function buildCronRunMessage(entry: CronRunLogEntry, index: number): CronSessionFallbackMessage | null {
  const timestamp = normalizeTimestampMs(entry.ts) ?? normalizeTimestampMs(entry.runAtMs);
  if (!timestamp) return null;

  const status = typeof entry.status === 'string' ? entry.status.toLowerCase() : '';
  const summary = typeof entry.summary === 'string' ? entry.summary.trim() : '';
  const error = typeof entry.error === 'string' ? entry.error.trim() : '';
  let content = summary || error;

  if (!content) {
    content = status === 'error'
      ? 'Scheduled task failed.'
      : 'Scheduled task completed.';
  }

  if (status === 'error' && !content.toLowerCase().startsWith('run failed:')) {
    content = `Run failed: ${content}`;
  }

  const meta: string[] = [];
  const duration = formatDuration(entry.durationMs);
  if (duration) meta.push(`Duration: ${duration}`);
  if (entry.provider && entry.model) {
    meta.push(`Model: ${entry.provider}/${entry.model}`);
  } else if (entry.model) {
    meta.push(`Model: ${entry.model}`);
  }
  if (meta.length > 0) {
    content = `${content}\n\n${meta.join(' | ')}`;
  }

  return {
    id: `cron-run-${entry.sessionId ?? entry.ts ?? index}`,
    role: status === 'error' ? 'system' : 'assistant',
    content,
    timestamp,
    ...(status === 'error' ? { isError: true } : {}),
  };
}

async function readCronRunLog(jobId: string): Promise<CronRunLogEntry[]> {
  const logPath = join(getOpenClawConfigDir(), 'cron', 'runs', `${jobId}.jsonl`);
  const raw = await readFile(logPath, 'utf8').catch(() => '');
  if (!raw.trim()) return [];

  const entries: CronRunLogEntry[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const entry = JSON.parse(trimmed) as CronRunLogEntry;
      if (!entry || entry.jobId !== jobId) continue;
      if (entry.action && entry.action !== 'finished') continue;
      entries.push(entry);
    } catch {
      // Ignore malformed log lines so one bad entry does not hide the rest.
    }
  }
  return entries;
}

async function readSessionStoreEntry(
  agentId: string,
  sessionKey: string,
): Promise<Record<string, unknown> | undefined> {
  const storePath = join(getOpenClawConfigDir(), 'agents', agentId, 'sessions', 'sessions.json');
  const raw = await readFile(storePath, 'utf8').catch(() => '');
  if (!raw.trim()) return undefined;

  try {
    const store = JSON.parse(raw) as Record<string, unknown>;
    const directEntry = store[sessionKey];
    if (directEntry && typeof directEntry === 'object') {
      return directEntry as Record<string, unknown>;
    }

    const sessions = (store as { sessions?: unknown }).sessions;
    if (Array.isArray(sessions)) {
      const arrayEntry = sessions.find((entry) => {
        if (!entry || typeof entry !== 'object') return false;
        const record = entry as Record<string, unknown>;
        return record.key === sessionKey || record.sessionKey === sessionKey;
      });
      if (arrayEntry && typeof arrayEntry === 'object') {
        return arrayEntry as Record<string, unknown>;
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export function buildCronSessionFallbackMessages(params: {
  sessionKey: string;
  job?: Pick<GatewayCronJob, 'name' | 'payload' | 'state'>;
  runs: CronRunLogEntry[];
  sessionEntry?: { label?: string; updatedAt?: number };
  limit?: number;
}): CronSessionFallbackMessage[] {
  const parsed = parseCronSessionKey(params.sessionKey);
  if (!parsed) return [];

  const matchingRuns = params.runs
    .filter((entry) => {
      if (!parsed.runSessionId) return true;
      return entry.sessionId === parsed.runSessionId
        || entry.sessionKey === `${params.sessionKey}`;
    })
    .sort((a, b) => {
      const left = normalizeTimestampMs(a.ts) ?? normalizeTimestampMs(a.runAtMs) ?? 0;
      const right = normalizeTimestampMs(b.ts) ?? normalizeTimestampMs(b.runAtMs) ?? 0;
      return left - right;
    });

  const messages: CronSessionFallbackMessage[] = [];
  const prompt = params.job?.payload?.message || params.job?.payload?.text || '';
  const taskName = params.job?.name?.trim()
    || params.sessionEntry?.label?.replace(/^Cron:\s*/, '').trim()
    || '';
  const firstRelevantTimestamp = matchingRuns.length > 0
    ? (normalizeTimestampMs(matchingRuns[0]?.runAtMs) ?? normalizeTimestampMs(matchingRuns[0]?.ts))
    : (normalizeTimestampMs(params.job?.state?.runningAtMs) ?? params.sessionEntry?.updatedAt);

  if (taskName || prompt) {
    const lines = [taskName ? `Scheduled task: ${taskName}` : 'Scheduled task'];
    if (prompt) lines.push(`Prompt: ${prompt}`);
    messages.push({
      id: `cron-meta-${parsed.jobId}`,
      role: 'system',
      content: lines.join('\n'),
      timestamp: Math.max(0, (firstRelevantTimestamp ?? Date.now()) - 1),
    });
  }

  matchingRuns.forEach((entry, index) => {
    const message = buildCronRunMessage(entry, index);
    if (message) messages.push(message);
  });

  if (matchingRuns.length === 0) {
    const runningAt = normalizeTimestampMs(params.job?.state?.runningAtMs);
    if (runningAt) {
      messages.push({
        id: `cron-running-${parsed.jobId}`,
        role: 'system',
        content: 'This scheduled task is still running in OpenClaw, but no chat transcript is available yet.',
        timestamp: runningAt,
      });
    } else if (messages.length === 0) {
      messages.push({
        id: `cron-empty-${parsed.jobId}`,
        role: 'system',
        content: 'No chat transcript is available for this scheduled task yet.',
        timestamp: params.sessionEntry?.updatedAt ?? Date.now(),
      });
    }
  }

  const limit = typeof params.limit === 'number' && Number.isFinite(params.limit)
    ? Math.max(1, Math.floor(params.limit))
    : messages.length;
  return messages.slice(-limit);
}

type JsonRecord = Record<string, unknown>;
type GatewayCronDelivery = NonNullable<GatewayCronJob['delivery']>;

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function extractCronJobs(value: unknown): GatewayCronJob[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is GatewayCronJob => {
      const record = asRecord(entry);
      return !!record && typeof record.id === 'string' && record.id.trim().length > 0;
    });
  }

  const record = asRecord(value);
  const jobs = record?.jobs;
  if (!Array.isArray(jobs)) {
    return [];
  }

  return jobs.filter((entry): entry is GatewayCronJob => {
    const job = asRecord(entry);
    return !!job && typeof job.id === 'string' && job.id.trim().length > 0;
  });
}

function mergeCronJobRecords(base: GatewayCronJob, override: GatewayCronJob): GatewayCronJob {
  const mergedPayload = base.payload || override.payload
    ? {
      kind: override.payload?.kind || base.payload?.kind || 'agentTurn',
      ...(base.payload ?? {}),
      ...(override.payload ?? {}),
    }
    : undefined;

  return {
    ...base,
    ...override,
    ...(mergedPayload ? { payload: mergedPayload } : {}),
    delivery: override.delivery ?? base.delivery,
    schedule: override.schedule ?? base.schedule ?? { kind: 'cron', expr: '0 9 * * *' },
    state: {
      ...(base.state ?? {}),
      ...(override.state ?? {}),
    },
  };
}

async function readLocalCronJobs(): Promise<GatewayCronJob[]> {
  const jobsPath = join(getOpenClawConfigDir(), 'cron', 'jobs.json');
  const raw = await readFile(jobsPath, 'utf8').catch(() => '');
  if (!raw.trim()) return [];

  try {
    return extractCronJobs(JSON.parse(raw));
  } catch {
    return [];
  }
}

async function listCronJobsWithFallback(
  gatewayManager: Pick<HostApiContext['gatewayManager'], 'rpc'>,
): Promise<{ jobs: GatewayCronJob[]; gatewayAvailable: boolean }> {
  let gatewayJobs: GatewayCronJob[] = [];
  let gatewayAvailable = false;
  let gatewayError: unknown;

  try {
    const result = await gatewayManager.rpc('cron.list', { includeDisabled: true });
    gatewayJobs = extractCronJobs(result);
    gatewayAvailable = true;
  } catch (error) {
    gatewayError = error;
  }

  const localJobs = await readLocalCronJobs();
  const mergedJobs = new Map<string, GatewayCronJob>();

  for (const job of localJobs) {
    mergedJobs.set(job.id, job);
  }

  for (const job of gatewayJobs) {
    const existing = mergedJobs.get(job.id);
    mergedJobs.set(job.id, existing ? mergeCronJobRecords(existing, job) : job);
  }

  if (mergedJobs.size > 0) {
    return {
      jobs: Array.from(mergedJobs.values()),
      gatewayAvailable,
    };
  }

  if (gatewayError) {
    throw gatewayError;
  }

  return { jobs: [], gatewayAvailable };
}

function resolveCronJobTimestampMs(...candidates: unknown[]): number {
  for (const candidate of candidates) {
    const timestamp = normalizeTimestampMs(candidate);
    if (typeof timestamp === 'number' && Number.isFinite(timestamp)) {
      return timestamp;
    }
  }

  return Date.now();
}

function normalizeCronSchedule(schedule: unknown): GatewayCronJob['schedule'] {
  if (typeof schedule === 'string' && schedule.trim()) {
    return { kind: 'cron', expr: schedule.trim() };
  }

  const record = asRecord(schedule);
  if (record) {
    const kind = typeof record.kind === 'string' && record.kind.trim()
      ? record.kind.trim()
      : 'cron';

    if (kind === 'at') {
      const at = typeof record.at === 'string' && record.at.trim()
        ? record.at.trim()
        : new Date().toISOString();
      return { kind, at };
    }

    if (kind === 'every') {
      const everyMs = typeof record.everyMs === 'number' && Number.isFinite(record.everyMs)
        ? record.everyMs
        : 60_000;
      const anchorMs = typeof record.anchorMs === 'number' && Number.isFinite(record.anchorMs)
        ? record.anchorMs
        : undefined;
      return { kind, everyMs, ...(anchorMs ? { anchorMs } : {}) };
    }

    const expr = typeof record.expr === 'string' && record.expr.trim()
      ? record.expr.trim()
      : '0 9 * * *';
    const tz = typeof record.tz === 'string' && record.tz.trim()
      ? record.tz.trim()
      : undefined;
    return { kind: 'cron', expr, ...(tz ? { tz } : {}) };
  }

  return { kind: 'cron', expr: '0 9 * * *' };
}

function getUnsupportedCronDeliveryError(_channel: string | undefined): string | null {
  // Channel support is gated by the frontend whitelist (TESTED_CRON_DELIVERY_CHANNELS).
  // No per-channel backend blocks are needed.
  return null;
}

function getStableCronSessionTarget(jobId: string): string {
  return `session:cron:${jobId}`;
}

function isWeChatCronDelivery(delivery: GatewayCronDelivery | undefined): boolean {
  return delivery?.mode === 'announce' && isWechatChannelType(delivery.channel);
}

function isWeChatOutboundMissingError(error: unknown): boolean {
  return typeof error === 'string'
    && error.toLowerCase().includes(`outbound not configured for channel: ${OPENCLAW_WECHAT_CHANNEL_TYPE}`);
}

function scheduleGatewayRestartForWeChatCronDelivery(ctx: HostApiContext, reason: string): void {
  const manager = ctx.gatewayManager as HostApiContext['gatewayManager'] & {
    debouncedRestart?: () => void;
    getStatus?: () => { state?: string };
  };
  if (manager.getStatus?.().state === 'stopped') return;
  manager.debouncedRestart?.();
  void reason;
}

async function ensureWeChatCronDeliveryReady(): Promise<{ pluginRegistrationChanged: boolean }> {
  const installResult = ensureWeChatPluginInstalled();
  if (!installResult.installed) {
    throw new Error(installResult.warning || 'WeChat plugin install failed');
  }
  const pluginRegistrationChanged = await ensureWeChatPluginRegistration();
  return { pluginRegistrationChanged };
}

function normalizeCronDelivery(
  rawDelivery: unknown,
  fallbackMode: GatewayCronDelivery['mode'] = 'none',
): GatewayCronDelivery {
  if (!rawDelivery || typeof rawDelivery !== 'object') {
    return { mode: fallbackMode };
  }

  const delivery = rawDelivery as JsonRecord;
  const mode = typeof delivery.mode === 'string' && delivery.mode.trim()
    ? delivery.mode.trim()
    : fallbackMode;
  const channel = typeof delivery.channel === 'string' && delivery.channel.trim()
    ? toOpenClawChannelType(delivery.channel.trim())
    : undefined;
  const to = typeof delivery.to === 'string' && delivery.to.trim()
    ? delivery.to.trim()
    : undefined;
  const accountId = typeof delivery.accountId === 'string' && delivery.accountId.trim()
    ? delivery.accountId.trim()
    : undefined;

  if (mode === 'announce' && !channel) {
    return { mode: 'none' };
  }

  return {
    mode,
    ...(channel ? { channel } : {}),
    ...(to ? { to } : {}),
    ...(accountId ? { accountId } : {}),
  };
}

function normalizeCronDeliveryPatch(rawDelivery: unknown): Record<string, unknown> {
  if (!rawDelivery || typeof rawDelivery !== 'object') {
    return {};
  }

  const delivery = rawDelivery as JsonRecord;
  const patch: Record<string, unknown> = {};
  if ('mode' in delivery) {
    patch.mode = typeof delivery.mode === 'string' && delivery.mode.trim()
      ? delivery.mode.trim()
      : 'none';
  }
  if ('channel' in delivery) {
    patch.channel = typeof delivery.channel === 'string' && delivery.channel.trim()
      ? toOpenClawChannelType(delivery.channel.trim())
      : '';
  }
  if ('to' in delivery) {
    patch.to = typeof delivery.to === 'string' ? delivery.to : '';
  }
  if ('accountId' in delivery) {
    patch.accountId = typeof delivery.accountId === 'string' ? delivery.accountId : '';
  }
  return patch;
}

function buildCronUpdatePatch(input: Record<string, unknown>): Record<string, unknown> {
  const patch = { ...input };

  if (typeof patch.schedule === 'string') {
    patch.schedule = { kind: 'cron', expr: patch.schedule };
  }

  if (typeof patch.message === 'string') {
    patch.payload = { kind: 'agentTurn', message: patch.message };
    delete patch.message;
  }

  if ('delivery' in patch) {
    patch.delivery = normalizeCronDeliveryPatch(patch.delivery);
  }

  return patch;
}

function transformCronJob(job: GatewayCronJob) {
  const message = job.payload?.message || job.payload?.text || '';
  const gatewayDelivery = normalizeCronDelivery(job.delivery);
  const channelType = gatewayDelivery.channel ? toUiChannelType(gatewayDelivery.channel) : undefined;
  const delivery = channelType
    ? { ...gatewayDelivery, channel: channelType }
    : gatewayDelivery;
  const target = channelType
    ? {
      channelType,
      channelId: delivery.accountId || gatewayDelivery.channel,
      channelName: channelType,
      recipient: delivery.to,
    }
    : undefined;
  const lastRun = job.state?.lastRunAtMs
    ? {
      time: new Date(job.state.lastRunAtMs).toISOString(),
      success: job.state.lastStatus === 'ok',
      error: job.state.lastError,
      duration: job.state.lastDurationMs,
    }
    : undefined;
  const nextRun = job.state?.nextRunAtMs
    ? new Date(job.state.nextRunAtMs).toISOString()
    : undefined;
  const createdAtMs = resolveCronJobTimestampMs(
    job.createdAtMs,
    job.updatedAtMs,
    job.state?.lastRunAtMs,
    job.state?.runningAtMs,
    job.state?.nextRunAtMs,
  );
  const updatedAtMs = resolveCronJobTimestampMs(
    job.updatedAtMs,
    job.createdAtMs,
    job.state?.lastRunAtMs,
    job.state?.runningAtMs,
    job.state?.nextRunAtMs,
    createdAtMs,
  );
  const name = typeof job.name === 'string' && job.name.trim()
    ? job.name.trim()
    : (typeof job.description === 'string' && job.description.trim()
      ? job.description.trim()
      : job.id);

  return {
    id: job.id,
    name,
    message,
    schedule: normalizeCronSchedule(job.schedule),
    delivery,
    target,
    enabled: job.enabled ?? true,
    createdAt: new Date(createdAtMs).toISOString(),
    updatedAt: new Date(updatedAtMs).toISOString(),
    lastRun,
    nextRun,
  };
}

export async function handleCronRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/cron/session-history' && req.method === 'GET') {
    const sessionKey = url.searchParams.get('sessionKey')?.trim() || '';
    const parsedSession = parseCronSessionKey(sessionKey);
    if (!parsedSession) {
      sendJson(res, 400, { success: false, error: `Invalid cron sessionKey: ${sessionKey}` });
      return true;
    }

    const rawLimit = Number(url.searchParams.get('limit') || '200');
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(Math.floor(rawLimit), 1), 200)
      : 200;

    try {
      const [{ jobs }, runs, sessionEntry] = await Promise.all([
        listCronJobsWithFallback(ctx.gatewayManager)
          .catch(() => ({ jobs: [] as GatewayCronJob[], gatewayAvailable: false })),
        readCronRunLog(parsedSession.jobId),
        readSessionStoreEntry(parsedSession.agentId, sessionKey),
      ]);
      const job = jobs.find((item) => item.id === parsedSession.jobId);
      const messages = buildCronSessionFallbackMessages({
        sessionKey,
        job,
        runs,
        sessionEntry: sessionEntry ? {
          label: typeof sessionEntry.label === 'string' ? sessionEntry.label : undefined,
          updatedAt: normalizeTimestampMs(sessionEntry.updatedAt),
        } : undefined,
        limit,
      });

      sendJson(res, 200, { messages });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/cron/jobs' && req.method === 'GET') {
    try {
      const { jobs, gatewayAvailable } = await listCronJobsWithFallback(ctx.gatewayManager);
      if (gatewayAvailable) {
        for (const job of jobs) {
          const isIsolatedAgent =
            (job.sessionTarget === 'isolated' || !job.sessionTarget) &&
            job.payload?.kind === 'agentTurn';
          const needsRepair =
            isIsolatedAgent &&
            job.delivery?.mode === 'announce' &&
            !job.delivery?.channel;
          const patch: Record<string, unknown> = {};
          if (isIsolatedAgent) {
            patch.sessionTarget = getStableCronSessionTarget(job.id);
          }
          if (needsRepair) {
            patch.delivery = { mode: 'none' };
          }
          if (Object.keys(patch).length > 0) {
            try {
              await ctx.gatewayManager.rpc('cron.update', {
                id: job.id,
                patch,
              });
              if (typeof patch.sessionTarget === 'string') {
                job.sessionTarget = patch.sessionTarget;
              }
              if (patch.delivery) {
                job.delivery = { mode: 'none' };
              }
              if (job.state?.lastError?.includes('Channel is required')) {
                job.state.lastError = undefined;
                job.state.lastStatus = 'ok';
              }
            } catch {
              // ignore per-job repair failure
            }
          }
        }
      }
      if (jobs.some((job) => isWeChatCronDelivery(normalizeCronDelivery(job.delivery)) && isWeChatOutboundMissingError(job.state?.lastError))) {
        try {
          await ensureWeChatCronDeliveryReady();
          scheduleGatewayRestartForWeChatCronDelivery(ctx, 'cron:list recovered missing WeChat outbound');
        } catch {
          // Listing jobs should not fail because recovery could not complete.
        }
      }
      sendJson(res, 200, jobs.map(transformCronJob));
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/cron/jobs' && req.method === 'POST') {
    const startedAt = Date.now();
    try {
      const input = await parseJsonBody<{
        name: string;
        message: string;
        schedule: string;
        delivery?: GatewayCronDelivery;
        enabled?: boolean;
      }>(req);
      const delivery = normalizeCronDelivery(input.delivery);
      const unsupportedDeliveryError = getUnsupportedCronDeliveryError(delivery.channel);
      if (delivery.mode === 'announce' && unsupportedDeliveryError) {
        sendJson(res, 400, { success: false, error: unsupportedDeliveryError });
        return true;
      }
      let shouldRestartGatewayForWeChatDelivery = false;
      if (isWeChatCronDelivery(delivery)) {
        const readiness = await ensureWeChatCronDeliveryReady();
        shouldRestartGatewayForWeChatDelivery = readiness.pluginRegistrationChanged;
      }
      const result = await ctx.gatewayManager.rpc('cron.add', {
        name: input.name,
        schedule: { kind: 'cron', expr: input.schedule },
        payload: { kind: 'agentTurn', message: input.message },
        enabled: false,
        wakeMode: 'next-heartbeat',
        sessionTarget: 'isolated',
        delivery,
      });
      if (shouldRestartGatewayForWeChatDelivery) {
        scheduleGatewayRestartForWeChatCronDelivery(ctx, 'cron:create WeChat delivery');
      }
      let transformed = result && typeof result === 'object' ? transformCronJob(result as GatewayCronJob) : result;
      if (result && typeof result === 'object' && typeof (result as GatewayCronJob).id === 'string') {
        const createdJob = result as GatewayCronJob;
        const patched = await ctx.gatewayManager.rpc('cron.update', {
          id: createdJob.id,
          patch: {
            sessionTarget: getStableCronSessionTarget(createdJob.id),
            enabled: input.enabled ?? true,
          },
        });
        transformed = patched && typeof patched === 'object'
          ? transformCronJob(patched as GatewayCronJob)
          : {
            ...transformed as Record<string, unknown>,
            enabled: input.enabled ?? true,
          };
      }
      emitMutationAudit(req, ctx, {
        startedAt,
        action: 'cron.job.create',
        resourceType: 'cron-job',
        resourceId: typeof transformed === 'object' && transformed && 'id' in transformed
          ? String((transformed as { id?: string }).id ?? '')
          : undefined,
        result: 'success',
        changedKeys: ['name', 'message', 'schedule', 'delivery', 'enabled'],
        metadata: {
          deliveryMode: delivery.mode,
        },
      });
      sendJson(res, 200, transformed);
    } catch (error) {
      emitMutationAudit(req, ctx, {
        startedAt,
        action: 'cron.job.create',
        resourceType: 'cron-job',
        result: 'failure',
        error,
      });
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/cron/jobs/') && req.method === 'PUT') {
    const startedAt = Date.now();
    try {
      const id = decodeURIComponent(url.pathname.slice('/api/cron/jobs/'.length));
      const input = await parseJsonBody<Record<string, unknown>>(req);
      const patch = buildCronUpdatePatch(input);
      const deliveryPatch = patch.delivery && typeof patch.delivery === 'object'
        ? patch.delivery as Record<string, unknown>
        : undefined;
      const deliveryChannel = typeof deliveryPatch?.channel === 'string' && deliveryPatch.channel.trim()
        ? deliveryPatch.channel.trim()
        : undefined;
      const deliveryMode = typeof deliveryPatch?.mode === 'string' && deliveryPatch.mode.trim()
        ? deliveryPatch.mode.trim()
        : undefined;
      const unsupportedDeliveryError = getUnsupportedCronDeliveryError(deliveryChannel);
      if (unsupportedDeliveryError && deliveryMode !== 'none') {
        sendJson(res, 400, { success: false, error: unsupportedDeliveryError });
        return true;
      }
      let shouldRestartGatewayForWeChatDelivery = false;
      if (deliveryMode === 'announce' && isWechatChannelType(deliveryChannel)) {
        const readiness = await ensureWeChatCronDeliveryReady();
        shouldRestartGatewayForWeChatDelivery = readiness.pluginRegistrationChanged;
      }
      const result = await ctx.gatewayManager.rpc('cron.update', { id, patch });
      if (shouldRestartGatewayForWeChatDelivery) {
        scheduleGatewayRestartForWeChatCronDelivery(ctx, 'cron:update WeChat delivery');
      }
      emitMutationAudit(req, ctx, {
        startedAt,
        action: 'cron.job.update',
        resourceType: 'cron-job',
        resourceId: id,
        result: Object.keys(patch).length === 0 ? 'noop' : 'success',
        changedKeys: Object.keys(patch),
        metadata: {
          deliveryMode: typeof deliveryPatch?.mode === 'string' ? deliveryPatch.mode : undefined,
        },
      });
      sendJson(res, 200, result && typeof result === 'object' ? transformCronJob(result as GatewayCronJob) : result);
    } catch (error) {
      emitMutationAudit(req, ctx, {
        startedAt,
        action: 'cron.job.update',
        resourceType: 'cron-job',
        result: 'failure',
        error,
      });
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/cron/jobs/') && req.method === 'DELETE') {
    const startedAt = Date.now();
    try {
      const id = decodeURIComponent(url.pathname.slice('/api/cron/jobs/'.length));
      const result = await ctx.gatewayManager.rpc('cron.remove', { id });
      emitMutationAudit(req, ctx, {
        startedAt,
        action: 'cron.job.delete',
        resourceType: 'cron-job',
        resourceId: id,
        result: 'success',
        changedKeys: ['*'],
      });
      sendJson(res, 200, result);
    } catch (error) {
      emitMutationAudit(req, ctx, {
        startedAt,
        action: 'cron.job.delete',
        resourceType: 'cron-job',
        result: 'failure',
        changedKeys: ['*'],
        error,
      });
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/cron/toggle' && req.method === 'POST') {
    const startedAt = Date.now();
    try {
      const body = await parseJsonBody<{ id: string; enabled: boolean }>(req);
      const result = await ctx.gatewayManager.rpc('cron.update', { id: body.id, patch: { enabled: body.enabled } });
      emitMutationAudit(req, ctx, {
        startedAt,
        action: 'cron.job.toggle',
        resourceType: 'cron-job',
        resourceId: body.id,
        result: 'success',
        changedKeys: ['enabled'],
        metadata: {
          enabled: body.enabled,
        },
      });
      sendJson(res, 200, result);
    } catch (error) {
      emitMutationAudit(req, ctx, {
        startedAt,
        action: 'cron.job.toggle',
        resourceType: 'cron-job',
        result: 'failure',
        changedKeys: ['enabled'],
        error,
      });
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/cron/trigger' && req.method === 'POST') {
    const startedAt = Date.now();
    try {
      const body = await parseJsonBody<{ id: string }>(req);
      const result = await ctx.gatewayManager.rpc('cron.run', { id: body.id, mode: 'force' });
      emitMutationAudit(req, ctx, {
        startedAt,
        action: 'cron.job.trigger',
        resourceType: 'cron-job',
        resourceId: body.id,
        result: 'success',
        changedKeys: ['runNow'],
      });
      sendJson(res, 200, result);
    } catch (error) {
      emitMutationAudit(req, ctx, {
        startedAt,
        action: 'cron.job.trigger',
        resourceType: 'cron-job',
        result: 'failure',
        changedKeys: ['runNow'],
        error,
      });
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
