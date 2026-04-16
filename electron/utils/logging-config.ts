import {
  DEFAULT_APP_LOG_RETENTION_DAYS,
  DEFAULT_AUDIT_LOG_RETENTION_DAYS,
  DEFAULT_LOG_FILE_MAX_SIZE_MB,
  normalizeAppLogLevel,
  normalizeAuditMode,
  normalizeLogFileMaxSizeMb,
  normalizeLogRetentionDays,
  type AppLogLevel,
  type AuditMode,
} from '../../shared/logging';
import type { AppSettings } from './store';
import { getSetting } from './store';
import { configureAuditLogger } from './audit-logger';
import { logger } from './logger';

type LoggingSettingsPatch = Partial<Pick<
  AppSettings,
  'logLevel' | 'auditEnabled' | 'auditMode' | 'appLogRetentionDays' | 'auditLogRetentionDays' | 'logFileMaxSizeMb'
>>;

const runtimeLoggingSettings: {
  logLevel: AppLogLevel;
  auditEnabled: boolean;
  auditMode: AuditMode;
  appLogRetentionDays: number;
  auditLogRetentionDays: number;
  logFileMaxSizeMb: number;
} = {
  logLevel: 'debug',
  auditEnabled: true,
  auditMode: 'minimal',
  appLogRetentionDays: DEFAULT_APP_LOG_RETENTION_DAYS,
  auditLogRetentionDays: DEFAULT_AUDIT_LOG_RETENTION_DAYS,
  logFileMaxSizeMb: DEFAULT_LOG_FILE_MAX_SIZE_MB,
};

export function applyRuntimeLoggingSettings(patch: LoggingSettingsPatch): void {
  if (typeof patch.logLevel === 'string') {
    runtimeLoggingSettings.logLevel = normalizeAppLogLevel(patch.logLevel);
    logger.setLogLevelByName(runtimeLoggingSettings.logLevel);
  }

  if (typeof patch.auditEnabled === 'boolean') {
    runtimeLoggingSettings.auditEnabled = patch.auditEnabled;
  }

  if (typeof patch.auditMode === 'string') {
    runtimeLoggingSettings.auditMode = normalizeAuditMode(patch.auditMode);
  }

  if (typeof patch.appLogRetentionDays === 'number') {
    runtimeLoggingSettings.appLogRetentionDays = normalizeLogRetentionDays(
      patch.appLogRetentionDays,
      DEFAULT_APP_LOG_RETENTION_DAYS,
    );
  }

  if (typeof patch.auditLogRetentionDays === 'number') {
    runtimeLoggingSettings.auditLogRetentionDays = normalizeLogRetentionDays(
      patch.auditLogRetentionDays,
      DEFAULT_AUDIT_LOG_RETENTION_DAYS,
    );
  }

  if (typeof patch.logFileMaxSizeMb === 'number') {
    runtimeLoggingSettings.logFileMaxSizeMb = normalizeLogFileMaxSizeMb(
      patch.logFileMaxSizeMb,
      DEFAULT_LOG_FILE_MAX_SIZE_MB,
    );
  }

  configureAuditLogger({
    enabled: runtimeLoggingSettings.auditEnabled,
    mode: runtimeLoggingSettings.auditMode,
    retentionDays: runtimeLoggingSettings.auditLogRetentionDays,
    maxFileSizeBytes: runtimeLoggingSettings.logFileMaxSizeMb * 1024 * 1024,
  });
  logger.configure({
    retentionDays: runtimeLoggingSettings.appLogRetentionDays,
    maxFileSizeBytes: runtimeLoggingSettings.logFileMaxSizeMb * 1024 * 1024,
  });
}

export async function syncRuntimeLoggingSettingsFromStore(): Promise<void> {
  const [
    logLevel,
    auditEnabled,
    auditMode,
    appLogRetentionDays,
    auditLogRetentionDays,
    logFileMaxSizeMb,
  ] = await Promise.all([
    getSetting('logLevel'),
    getSetting('auditEnabled'),
    getSetting('auditMode'),
    getSetting('appLogRetentionDays'),
    getSetting('auditLogRetentionDays'),
    getSetting('logFileMaxSizeMb'),
  ]);

  applyRuntimeLoggingSettings({
    logLevel,
    auditEnabled,
    auditMode,
    appLogRetentionDays,
    auditLogRetentionDays,
    logFileMaxSizeMb,
  });
}

export function patchTouchesLoggingSettings(patch: Partial<AppSettings>): boolean {
  return Object.prototype.hasOwnProperty.call(patch, 'logLevel')
    || Object.prototype.hasOwnProperty.call(patch, 'auditEnabled')
    || Object.prototype.hasOwnProperty.call(patch, 'auditMode')
    || Object.prototype.hasOwnProperty.call(patch, 'appLogRetentionDays')
    || Object.prototype.hasOwnProperty.call(patch, 'auditLogRetentionDays')
    || Object.prototype.hasOwnProperty.call(patch, 'logFileMaxSizeMb');
}

export function getRuntimeLoggingSettings(): {
  logLevel: AppLogLevel;
  auditEnabled: boolean;
  auditMode: AuditMode;
  appLogRetentionDays: number;
  auditLogRetentionDays: number;
  logFileMaxSizeMb: number;
} {
  return { ...runtimeLoggingSettings };
}
