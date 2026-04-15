import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { appendFile, readFile, readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import {
  DEFAULT_AUDIT_LOG_RETENTION_DAYS,
  DEFAULT_LOG_FILE_MAX_SIZE_BYTES,
  normalizeAuditMode,
  type AuditLogEntry,
  type AuditMode,
  type AuditResult,
  type LogFileSummary,
} from '../../shared/logging';
import { buildRotatedLogFileName, isLogFileExpired, normalizeMaxFileSizeBytes, normalizeRetentionDays } from './log-policy';
import { formatLocalDatePart, normalizeTimestamp } from './log-time';

export type AuditEventResult = AuditResult;
export type AuditActorType = 'local-user' | 'system';

export interface AuditEvent {
  ts?: string;
  eventId?: string;
  requestId?: string;
  source?: 'host-api' | 'system' | 'renderer';
  actor?: {
    type: AuditActorType;
    id?: string;
    origin?: string | null;
  };
  action: string;
  resourceType: string;
  resourceId?: string;
  result: AuditEventResult;
  changedKeys?: string[];
  metadata?: Record<string, unknown>;
  durationMs?: number;
  error?: string;
}

type PersistedAuditEvent = Required<Pick<AuditEvent, 'action' | 'resourceType' | 'result'>> & AuditEvent & {
  ts: string;
  tsEpochMs: number;
};

type QueryAuditEntriesOptions = {
  search?: string;
  result?: AuditResult | 'all';
  action?: string;
  resourceType?: string;
  fileName?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
};

const AUDIT_EXIT_HANDLER_KEY = '__clawxAuditLoggerExitHandlerRegistered';
const auditProcessState = process as NodeJS.Process & {
  [AUDIT_EXIT_HANDLER_KEY]?: boolean;
};

const SENSITIVE_KEY_PATTERN = /(api[-_]?key|token|secret|password|authorization|cookie|access|refresh|credential|qr)/i;
const AUDIT_FLUSH_INTERVAL_MS = 500;
const AUDIT_FLUSH_SIZE_THRESHOLD = 10;
const AUDIT_FILE_PREFIX = 'audit';
const AUDIT_FILE_EXTENSION = '.ndjson';

let auditEnabled = true;
let auditMode: AuditMode = 'minimal';
let auditRetentionDays = DEFAULT_AUDIT_LOG_RETENTION_DAYS;
let auditMaxFileSizeBytes = DEFAULT_LOG_FILE_MAX_SIZE_BYTES;
let auditLogFilePath: string | null = null;
let auditWriteBuffer: string[] = [];
let auditFlushTimer: NodeJS.Timeout | null = null;
let auditFlushing = false;
let auditCleanupInFlight: Promise<void> | null = null;

function resolveAuditLogDir(): string | null {
  try {
    const logDir = join(app.getPath('userData'), 'logs');
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }
    return logDir;
  } catch {
    return null;
  }
}

function resolveWritableAuditLogFilePathSync(estimatedAppendBytes = 0): string | null {
  const logDir = resolveAuditLogDir();
  if (!logDir) return null;

  const datePart = formatLocalDatePart();
  let partIndex = 1;
  while (partIndex <= 999) {
    const filePath = join(logDir, buildRotatedLogFileName(AUDIT_FILE_PREFIX, datePart, AUDIT_FILE_EXTENSION, partIndex));
    try {
      const fileStat = statSync(filePath);
      if (fileStat.size + estimatedAppendBytes <= auditMaxFileSizeBytes) {
        return filePath;
      }
    } catch {
      return filePath;
    }
    partIndex += 1;
  }

  return join(logDir, buildRotatedLogFileName(AUDIT_FILE_PREFIX, datePart, AUDIT_FILE_EXTENSION, Date.now()));
}

async function resolveWritableAuditLogFilePath(estimatedAppendBytes = 0): Promise<string | null> {
  const logDir = resolveAuditLogDir();
  if (!logDir) return null;

  const datePart = formatLocalDatePart();
  let partIndex = 1;
  while (partIndex <= 999) {
    const filePath = join(logDir, buildRotatedLogFileName(AUDIT_FILE_PREFIX, datePart, AUDIT_FILE_EXTENSION, partIndex));
    try {
      const fileStat = await stat(filePath);
      if (fileStat.size + estimatedAppendBytes <= auditMaxFileSizeBytes) {
        return filePath;
      }
    } catch {
      return filePath;
    }
    partIndex += 1;
  }

  return join(logDir, buildRotatedLogFileName(AUDIT_FILE_PREFIX, datePart, AUDIT_FILE_EXTENSION, Date.now()));
}

async function cleanupExpiredAuditLogFiles(): Promise<void> {
  const logDir = resolveAuditLogDir();
  if (!logDir) return;

  try {
    const fileNames = await readdir(logDir);
    await Promise.all(fileNames.map(async (fileName) => {
      if (!fileName.startsWith(`${AUDIT_FILE_PREFIX}-`) || !fileName.endsWith(AUDIT_FILE_EXTENSION)) {
        return;
      }
      const fullPath = join(logDir, fileName);
      try {
        const fileStat = await stat(fullPath);
        if (isLogFileExpired(fileStat.mtimeMs, auditRetentionDays)) {
          await unlink(fullPath);
        }
      } catch {
        // Ignore cleanup failures.
      }
    }));
  } catch {
    // Ignore cleanup failures.
  }
}

function scheduleAuditCleanup(): void {
  if (!auditCleanupInFlight) {
    auditCleanupInFlight = cleanupExpiredAuditLogFiles().finally(() => {
      auditCleanupInFlight = null;
    });
  }
}

async function flushAuditBuffer(): Promise<void> {
  if (auditFlushing || auditWriteBuffer.length === 0) return;
  auditFlushing = true;
  const batch = auditWriteBuffer.join('');
  auditWriteBuffer = [];
  try {
    const targetPath = await resolveWritableAuditLogFilePath(Buffer.byteLength(batch, 'utf8'));
    if (!targetPath) return;
    await appendFile(targetPath, batch);
    auditLogFilePath = targetPath;
  } catch {
    // Ignore audit write failures so they never break primary flows.
  } finally {
    auditFlushing = false;
  }
}

function flushAuditBufferSync(): void {
  if (auditWriteBuffer.length === 0) return;
  try {
    const batch = auditWriteBuffer.join('');
    const targetPath = resolveWritableAuditLogFilePathSync(Buffer.byteLength(batch, 'utf8'));
    if (!targetPath) return;
    appendFileSync(targetPath, batch);
    auditLogFilePath = targetPath;
  } catch {
    // Ignore audit write failures on shutdown.
  }
  auditWriteBuffer = [];
}

if (!auditProcessState[AUDIT_EXIT_HANDLER_KEY]) {
  process.on('exit', flushAuditBufferSync);
  auditProcessState[AUDIT_EXIT_HANDLER_KEY] = true;
}

function sanitizeAuditValue(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (depth >= 4) return '[truncated]';

  if (Array.isArray(value)) {
    return value.slice(0, 25).map((entry) => sanitizeAuditValue(entry, depth + 1));
  }

  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        output[key] = '[redacted]';
        continue;
      }
      output[key] = sanitizeAuditValue(entry, depth + 1);
    }
    return output;
  }

  if (typeof value === 'string') {
    return value.length > 600 ? `${value.slice(0, 597)}...` : value;
  }

  return value;
}

function normalizeMetadata(
  input: Record<string, unknown> | undefined,
  mode: AuditMode,
): Record<string, unknown> | undefined {
  if (!input || Object.keys(input).length === 0) {
    return undefined;
  }

  const sanitized = sanitizeAuditValue(input);
  if (!sanitized || typeof sanitized !== 'object' || Array.isArray(sanitized)) {
    return undefined;
  }

  const metadata = sanitized as Record<string, unknown>;
  if (mode === 'full') {
    return metadata;
  }

  const minimal: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (
      value == null
      || typeof value === 'string'
      || typeof value === 'number'
      || typeof value === 'boolean'
    ) {
      minimal[key] = value;
      continue;
    }
    if (Array.isArray(value)) {
      minimal[key] = value.slice(0, 10);
      continue;
    }
    minimal[key] = '[object]';
  }
  return minimal;
}

export function configureAuditLogger(config: {
  enabled?: boolean;
  mode?: AuditMode;
  retentionDays?: number;
  maxFileSizeBytes?: number;
}): void {
  if (typeof config.enabled === 'boolean') {
    auditEnabled = config.enabled;
  }
  if (config.mode) {
    auditMode = normalizeAuditMode(config.mode);
  }
  auditRetentionDays = normalizeRetentionDays(config.retentionDays, DEFAULT_AUDIT_LOG_RETENTION_DAYS);
  auditMaxFileSizeBytes = normalizeMaxFileSizeBytes(config.maxFileSizeBytes, DEFAULT_LOG_FILE_MAX_SIZE_BYTES);
  if (!auditLogFilePath) {
    auditLogFilePath = resolveWritableAuditLogFilePathSync();
  }
  scheduleAuditCleanup();
}

export function getAuditLoggerConfig(): { enabled: boolean; mode: AuditMode } {
  return {
    enabled: auditEnabled,
    mode: auditMode,
  };
}

export function getAuditLogDir(): string | null {
  return resolveAuditLogDir();
}

export async function listAuditLogFiles(): Promise<LogFileSummary[]> {
  const logDir = resolveAuditLogDir();
  if (!logDir) return [];

  try {
    const files = await readdir(logDir);
    const results: LogFileSummary[] = [];
    for (const fileName of files) {
      if (!fileName.startsWith(`${AUDIT_FILE_PREFIX}-`) || !fileName.endsWith(AUDIT_FILE_EXTENSION)) continue;
      const fullPath = join(logDir, fileName);
      const fileStat = await stat(fullPath);
      const { ts, tsEpochMs } = normalizeTimestamp(fileStat.mtime);
      results.push({
        name: fileName,
        path: fullPath,
        size: fileStat.size,
        modified: ts,
        modifiedEpochMs: tsEpochMs,
      });
    }
    return results.sort((a, b) => b.modifiedEpochMs - a.modifiedEpochMs);
  } catch {
    return [];
  }
}

function withinTimeRange(tsEpochMs: number, dateFrom?: string, dateTo?: string): boolean {
  if (dateFrom) {
    const fromEpoch = Date.parse(dateFrom);
    if (Number.isFinite(fromEpoch) && tsEpochMs < fromEpoch) {
      return false;
    }
  }
  if (dateTo) {
    const toEpoch = Date.parse(dateTo);
    if (Number.isFinite(toEpoch) && tsEpochMs > toEpoch) {
      return false;
    }
  }
  return true;
}

function parseAuditEntries(content: string, fileName: string): AuditLogEntry[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line, index) => {
      try {
        const parsed = JSON.parse(line) as PersistedAuditEvent;
        const normalized = normalizeTimestamp(parsed.tsEpochMs || parsed.ts);
        return [{
          id: parsed.eventId || `${fileName}:${normalized.tsEpochMs}:${index}`,
          kind: 'audit' as const,
          ts: normalized.ts,
          tsEpochMs: normalized.tsEpochMs,
          fileName,
          action: parsed.action,
          resourceType: parsed.resourceType,
          resourceId: parsed.resourceId,
          result: parsed.result,
          requestId: parsed.requestId,
          source: parsed.source,
          changedKeys: parsed.changedKeys,
          metadata: parsed.metadata,
          durationMs: parsed.durationMs,
          error: parsed.error,
        }];
      } catch {
        return [];
      }
    });
}

export async function queryAuditEntries(options: QueryAuditEntriesOptions = {}): Promise<AuditLogEntry[]> {
  const files = await listAuditLogFiles();
  const targetFiles = options.fileName
    ? files.filter((file) => file.name === options.fileName)
    : files.slice(0, 14);
  const search = options.search?.trim().toLowerCase();
  const action = options.action?.trim();
  const resourceType = options.resourceType?.trim();
  const rawLimit = Number.isFinite(options.limit) ? Number(options.limit) : 200;
  const limit = Math.max(1, Math.min(500, Math.floor(rawLimit)));
  const entries: AuditLogEntry[] = [];

  for (const file of targetFiles) {
    const content = await readFile(file.path, 'utf8').catch(() => '');
    if (!content) continue;

    const parsed = parseAuditEntries(content, file.name)
      .filter((entry) => (options.result && options.result !== 'all' ? entry.result === options.result : true))
      .filter((entry) => (action ? entry.action === action : true))
      .filter((entry) => (resourceType ? entry.resourceType === resourceType : true))
      .filter((entry) => withinTimeRange(entry.tsEpochMs, options.dateFrom, options.dateTo))
      .filter((entry) => {
        if (!search) return true;
        return JSON.stringify(entry).toLowerCase().includes(search);
      });

    for (let index = parsed.length - 1; index >= 0; index -= 1) {
      entries.push(parsed[index]);
    }
    if (entries.length >= limit * 2) {
      break;
    }
  }

  return entries
    .sort((a, b) => b.tsEpochMs - a.tsEpochMs)
    .slice(0, limit);
}

export function writeAuditEvent(
  event: AuditEvent,
  options: { force?: boolean } = {},
): void {
  if (!options.force && (!auditEnabled || auditMode === 'off')) {
    return;
  }

  if (!auditLogFilePath) {
    auditLogFilePath = resolveWritableAuditLogFilePathSync();
  }
  if (!auditLogFilePath) {
    return;
  }

  const effectiveMode = options.force
    ? normalizeAuditMode(event.metadata?.auditModeOverride ?? auditMode)
    : auditMode;
  const { auditModeOverride: _auditModeOverride, ...metadata } = event.metadata ?? {};
  const normalized = normalizeTimestamp(event.ts);

  const payload: PersistedAuditEvent = {
    ts: normalized.ts,
    tsEpochMs: normalized.tsEpochMs,
    eventId: event.eventId ?? randomUUID(),
    requestId: event.requestId,
    source: event.source ?? 'host-api',
    actor: event.actor ?? { type: 'system' },
    action: event.action,
    resourceType: event.resourceType,
    resourceId: event.resourceId,
    result: event.result,
    changedKeys: event.changedKeys && event.changedKeys.length > 0
      ? [...new Set(event.changedKeys)].sort()
      : undefined,
    metadata: normalizeMetadata(metadata, effectiveMode),
    durationMs: typeof event.durationMs === 'number' ? Math.max(0, Math.round(event.durationMs)) : undefined,
    error: event.error,
  };

  auditWriteBuffer.push(`${JSON.stringify(payload)}\n`);
  if (auditWriteBuffer.length >= AUDIT_FLUSH_SIZE_THRESHOLD) {
    void flushAuditBuffer();
  } else if (!auditFlushTimer) {
    auditFlushTimer = setTimeout(() => {
      auditFlushTimer = null;
      void flushAuditBuffer();
    }, AUDIT_FLUSH_INTERVAL_MS);
  }
}
