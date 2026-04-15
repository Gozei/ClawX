import {
  MAX_LOG_FILE_MAX_SIZE_MB,
  normalizeLogRetentionDays,
} from '../../shared/logging';

export function buildRotatedLogFileName(prefix: string, datePart: string, extension: string, partIndex = 1): string {
  return partIndex <= 1
    ? `${prefix}-${datePart}${extension}`
    : `${prefix}-${datePart}-part${partIndex}${extension}`;
}

export function normalizeRetentionDays(value: number | undefined, fallback: number): number {
  return normalizeLogRetentionDays(value, fallback);
}

export function normalizeMaxFileSizeBytes(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  const maxBytes = MAX_LOG_FILE_MAX_SIZE_MB * 1024 * 1024;
  return Math.max(4 * 1024 * 1024, Math.min(maxBytes, Math.floor(value as number)));
}

export function isLogFileExpired(modifiedEpochMs: number, retentionDays: number, nowEpochMs = Date.now()): boolean {
  const safeRetentionDays = normalizeRetentionDays(retentionDays, 1);
  const cutoffEpochMs = nowEpochMs - safeRetentionDays * 24 * 60 * 60 * 1000;
  return modifiedEpochMs < cutoffEpochMs;
}
