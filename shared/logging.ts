export const APP_LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type AppLogLevel = typeof APP_LOG_LEVELS[number];

export const AUDIT_MODES = ['off', 'minimal', 'full'] as const;
export type AuditMode = typeof AUDIT_MODES[number];

export const DEFAULT_APP_LOG_RETENTION_DAYS = 14;
export const DEFAULT_AUDIT_LOG_RETENTION_DAYS = 30;
export const DEFAULT_LOG_FILE_MAX_SIZE_MB = 64;
export const DEFAULT_LOG_FILE_MAX_SIZE_BYTES = DEFAULT_LOG_FILE_MAX_SIZE_MB * 1024 * 1024;
export const MIN_LOG_RETENTION_DAYS = 1;
export const MAX_LOG_RETENTION_DAYS = 365;
export const MIN_LOG_FILE_MAX_SIZE_MB = 4;
export const MAX_LOG_FILE_MAX_SIZE_MB = 512;

export const LOG_KINDS = ['app', 'audit'] as const;
export type LogKind = typeof LOG_KINDS[number];

export type AuditResult = 'success' | 'failure' | 'noop';

export interface BaseLogEntry {
  id: string;
  kind: LogKind;
  ts: string;
  tsEpochMs: number;
  fileName: string;
}

export interface AppLogEntry extends BaseLogEntry {
  kind: 'app';
  level: AppLogLevel;
  message: string;
  raw: string;
}

export interface AuditLogEntry extends BaseLogEntry {
  kind: 'audit';
  action: string;
  resourceType: string;
  resourceId?: string;
  result: AuditResult;
  requestId?: string;
  source?: 'host-api' | 'system' | 'renderer';
  changedKeys?: string[];
  metadata?: Record<string, unknown>;
  durationMs?: number;
  error?: string;
}

export type LogQueryEntry = AppLogEntry | AuditLogEntry;

export interface LogFileSummary {
  name: string;
  path: string;
  size: number;
  modified: string;
  modifiedEpochMs: number;
}

export function normalizeAppLogLevel(value: unknown): AppLogLevel {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (APP_LOG_LEVELS.includes(normalized as AppLogLevel)) {
      return normalized as AppLogLevel;
    }
  }
  return 'debug';
}

export function normalizeAuditMode(value: unknown): AuditMode {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (AUDIT_MODES.includes(normalized as AuditMode)) {
      return normalized as AuditMode;
    }
  }
  return 'minimal';
}

export function normalizeLogRetentionDays(value: unknown, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(MIN_LOG_RETENTION_DAYS, Math.min(MAX_LOG_RETENTION_DAYS, Math.floor(Number(value))));
}

export function normalizeLogFileMaxSizeMb(value: unknown, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(MIN_LOG_FILE_MAX_SIZE_MB, Math.min(MAX_LOG_FILE_MAX_SIZE_MB, Math.floor(Number(value))));
}
