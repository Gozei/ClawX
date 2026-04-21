/**
 * Logger Utility
 * Centralized logging with levels, file output, and log retrieval for UI.
 *
 * File writes use an async buffered writer so that high-frequency logging
 * (e.g. during gateway startup) never blocks the Electron main thread.
 * Only the final `process.on('exit')` handler uses synchronous I/O to
 * guarantee the last few messages are flushed before the process exits.
 */
import { app } from 'electron';
import { existsSync, mkdirSync, appendFileSync, statSync } from 'fs';
import { appendFile, open, readFile, readdir, stat, unlink } from 'fs/promises';
import { join } from 'path';
import {
  DEFAULT_APP_LOG_RETENTION_DAYS,
  DEFAULT_LOG_FILE_MAX_SIZE_BYTES,
  normalizeAppLogLevel,
  type AppLogEntry,
  type AppLogLevel,
  type LogFileSummary,
} from '../../shared/logging';
import { buildRotatedLogFileName, isLogFileExpired, normalizeMaxFileSizeBytes, normalizeRetentionDays } from './log-policy';
import { formatLocalDatePart, formatLocalTimestamp, normalizeTimestamp } from './log-time';

/**
 * Log levels
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

let currentLevel = LogLevel.DEBUG;
let logFilePath: string | null = null;
let logDir: string | null = null;
let logRetentionDays = DEFAULT_APP_LOG_RETENTION_DAYS;
let logMaxFileSizeBytes = DEFAULT_LOG_FILE_MAX_SIZE_BYTES;
let sessionHeaderFilePath: string | null = null;
let cleanupInFlight: Promise<void> | null = null;

const RING_BUFFER_SIZE = 500;
const recentLogs: string[] = [];
let writeBuffer: string[] = [];
let flushTimer: NodeJS.Timeout | null = null;
let flushing = false;

const FLUSH_INTERVAL_MS = 500;
const FLUSH_SIZE_THRESHOLD = 20;
const LOGGER_FILE_PREFIX = 'clawx';
const LOGGER_FILE_EXTENSION = '.log';

function safeConsoleWrite(method: (...args: unknown[]) => void, ...args: unknown[]): void {
  try {
    method(...args);
  } catch {
    // Ignore console stream failures (for example EPIPE when a parent process
    // already closed stdout/stderr) so logging never becomes a crash source.
  }
}

function logLevelFromName(level: AppLogLevel): LogLevel {
  switch (normalizeAppLogLevel(level)) {
    case 'error':
      return LogLevel.ERROR;
    case 'warn':
      return LogLevel.WARN;
    case 'info':
      return LogLevel.INFO;
    case 'debug':
    default:
      return LogLevel.DEBUG;
  }
}

function logLevelToName(level: LogLevel): AppLogLevel {
  switch (level) {
    case LogLevel.ERROR:
      return 'error';
    case LogLevel.WARN:
      return 'warn';
    case LogLevel.INFO:
      return 'info';
    case LogLevel.DEBUG:
    default:
      return 'debug';
  }
}

function getSessionHeader(): string {
  return `\n${'='.repeat(80)}\n[${formatLocalTimestamp()}] === Deep AI Worker Session Start (v${app.getVersion()}) ===\n${'='.repeat(80)}\n`;
}

function ensureLogDir(): string | null {
  try {
    if (!logDir) {
      logDir = join(app.getPath('userData'), 'logs');
    }
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }
    return logDir;
  } catch {
    return null;
  }
}

async function cleanupExpiredLogFiles(): Promise<void> {
  const directory = ensureLogDir();
  if (!directory) return;

  try {
    const fileNames = await readdir(directory);
    await Promise.all(fileNames.map(async (fileName) => {
      if (!fileName.startsWith(`${LOGGER_FILE_PREFIX}-`) || !fileName.endsWith(LOGGER_FILE_EXTENSION)) {
        return;
      }
      const fullPath = join(directory, fileName);
      try {
        const fileStat = await stat(fullPath);
        if (isLogFileExpired(fileStat.mtimeMs, logRetentionDays)) {
          await unlink(fullPath);
        }
      } catch {
        // Ignore cleanup failures so retention never blocks logging.
      }
    }));
  } catch {
    // Ignore cleanup failures.
  }
}

function scheduleLogCleanup(): void {
  if (!cleanupInFlight) {
    cleanupInFlight = cleanupExpiredLogFiles().finally(() => {
      cleanupInFlight = null;
    });
  }
}

function resolveWritableLogFilePathSync(estimatedAppendBytes = 0): string | null {
  const directory = ensureLogDir();
  if (!directory) return null;

  const datePart = formatLocalDatePart();
  let partIndex = 1;

  while (partIndex <= 999) {
    const filePath = join(directory, buildRotatedLogFileName(LOGGER_FILE_PREFIX, datePart, LOGGER_FILE_EXTENSION, partIndex));
    try {
      const fileStat = statSync(filePath);
      if (fileStat.size + estimatedAppendBytes <= logMaxFileSizeBytes) {
        return filePath;
      }
    } catch {
      return filePath;
    }
    partIndex += 1;
  }

  return join(directory, buildRotatedLogFileName(LOGGER_FILE_PREFIX, datePart, LOGGER_FILE_EXTENSION, Date.now()));
}

async function resolveWritableLogFilePath(estimatedAppendBytes = 0): Promise<string | null> {
  const directory = ensureLogDir();
  if (!directory) return null;

  const datePart = formatLocalDatePart();
  let partIndex = 1;

  while (partIndex <= 999) {
    const filePath = join(directory, buildRotatedLogFileName(LOGGER_FILE_PREFIX, datePart, LOGGER_FILE_EXTENSION, partIndex));
    try {
      const fileStat = await stat(filePath);
      if (fileStat.size + estimatedAppendBytes <= logMaxFileSizeBytes) {
        return filePath;
      }
    } catch {
      return filePath;
    }
    partIndex += 1;
  }

  return join(directory, buildRotatedLogFileName(LOGGER_FILE_PREFIX, datePart, LOGGER_FILE_EXTENSION, Date.now()));
}

function appendSessionHeaderSync(targetPath: string): void {
  if (sessionHeaderFilePath === targetPath) return;
  try {
    appendFileSync(targetPath, getSessionHeader());
    sessionHeaderFilePath = targetPath;
  } catch {
    // Ignore header write failures.
  }
}

async function appendSessionHeader(targetPath: string): Promise<void> {
  if (sessionHeaderFilePath === targetPath) return;
  try {
    await appendFile(targetPath, getSessionHeader());
    sessionHeaderFilePath = targetPath;
  } catch {
    // Ignore header write failures.
  }
}

async function flushBuffer(): Promise<void> {
  if (flushing || writeBuffer.length === 0) return;
  flushing = true;
  const batch = writeBuffer.join('');
  writeBuffer = [];
  try {
    const targetPath = await resolveWritableLogFilePath(Buffer.byteLength(batch, 'utf8'));
    if (!targetPath) return;
    await appendSessionHeader(targetPath);
    await appendFile(targetPath, batch);
    logFilePath = targetPath;
  } catch {
    // Silently fail if we can't write to file
  } finally {
    flushing = false;
  }
}

function flushBufferSync(): void {
  if (writeBuffer.length === 0) return;
  try {
    const batch = writeBuffer.join('');
    const targetPath = resolveWritableLogFilePathSync(Buffer.byteLength(batch, 'utf8'));
    if (!targetPath) return;
    appendSessionHeaderSync(targetPath);
    appendFileSync(targetPath, batch);
    logFilePath = targetPath;
  } catch {
    // Silently fail
  }
  writeBuffer = [];
}

const LOGGER_EXIT_HANDLER_KEY = '__clawxLoggerExitHandlerRegistered';
const loggerProcessState = process as NodeJS.Process & {
  [LOGGER_EXIT_HANDLER_KEY]?: boolean;
};

if (!loggerProcessState[LOGGER_EXIT_HANDLER_KEY]) {
  process.on('exit', flushBufferSync);
  loggerProcessState[LOGGER_EXIT_HANDLER_KEY] = true;
}

export function configureLogger(config: {
  retentionDays?: number;
  maxFileSizeBytes?: number;
} = {}): void {
  logRetentionDays = normalizeRetentionDays(config.retentionDays, DEFAULT_APP_LOG_RETENTION_DAYS);
  logMaxFileSizeBytes = normalizeMaxFileSizeBytes(config.maxFileSizeBytes, DEFAULT_LOG_FILE_MAX_SIZE_BYTES);
  scheduleLogCleanup();
}

export function initLogger(): void {
  try {
    if (app.isPackaged && currentLevel < LogLevel.INFO) {
      currentLevel = LogLevel.INFO;
    }

    ensureLogDir();
    configureLogger();

    const initialPath = resolveWritableLogFilePathSync();
    if (initialPath) {
      logFilePath = initialPath;
      appendSessionHeaderSync(initialPath);
    }
  } catch (error) {
    safeConsoleWrite(console.error, 'Failed to initialize logger:', error);
  }
}

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function setLogLevelByName(level: AppLogLevel): void {
  currentLevel = logLevelFromName(level);
}

export function getLogLevelName(): AppLogLevel {
  return logLevelToName(currentLevel);
}

export function getLogDir(): string | null {
  return logDir;
}

export function getLogFilePath(): string | null {
  return logFilePath;
}

function formatMessage(level: string, message: string, ...args: unknown[]): string {
  const timestamp = formatLocalTimestamp();
  const formattedArgs = args.length > 0
    ? ' ' + args.map((arg) => {
      if (arg instanceof Error) {
        return `${arg.message}\n${arg.stack || ''}`;
      }
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg, null, 2);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ')
    : '';

  return `[${timestamp}] [${level.padEnd(5)}] ${message}${formattedArgs}`;
}

function writeLog(formatted: string): void {
  recentLogs.push(formatted);
  if (recentLogs.length > RING_BUFFER_SIZE) {
    recentLogs.shift();
  }

  writeBuffer.push(formatted + '\n');
  if (writeBuffer.length >= FLUSH_SIZE_THRESHOLD) {
    void flushBuffer();
  } else if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flushBuffer();
    }, FLUSH_INTERVAL_MS);
  }
}

export function debug(message: string, ...args: unknown[]): void {
  if (currentLevel <= LogLevel.DEBUG) {
    const formatted = formatMessage('DEBUG', message, ...args);
    safeConsoleWrite(console.debug, formatted);
    writeLog(formatted);
  }
}

export function info(message: string, ...args: unknown[]): void {
  if (currentLevel <= LogLevel.INFO) {
    const formatted = formatMessage('INFO', message, ...args);
    safeConsoleWrite(console.info, formatted);
    writeLog(formatted);
  }
}

export function warn(message: string, ...args: unknown[]): void {
  if (currentLevel <= LogLevel.WARN) {
    const formatted = formatMessage('WARN', message, ...args);
    safeConsoleWrite(console.warn, formatted);
    writeLog(formatted);
  }
}

export function error(message: string, ...args: unknown[]): void {
  if (currentLevel <= LogLevel.ERROR) {
    const formatted = formatMessage('ERROR', message, ...args);
    safeConsoleWrite(console.error, formatted);
    writeLog(formatted);
  }
}

export function getRecentLogs(count?: number, minLevel?: LogLevel): string[] {
  const filtered = minLevel != null
    ? recentLogs.filter((line) => {
      if (minLevel <= LogLevel.DEBUG) return true;
      if (minLevel === LogLevel.INFO) return !line.includes('] [DEBUG');
      if (minLevel === LogLevel.WARN) return line.includes('] [WARN') || line.includes('] [ERROR');
      return line.includes('] [ERROR');
    })
    : recentLogs;

  return count ? filtered.slice(-count) : [...filtered];
}

export async function readLogFile(tailLines = 200): Promise<string> {
  if (!logFilePath) return '(No log file found)';
  const safeTailLines = Math.max(1, Math.floor(tailLines));
  try {
    const file = await open(logFilePath, 'r');
    try {
      const fileStat = await file.stat();
      if (fileStat.size === 0) return '';

      const chunkSize = 64 * 1024;
      let position = fileStat.size;
      let content = '';
      let lineCount = 0;

      while (position > 0 && lineCount <= safeTailLines) {
        const bytesToRead = Math.min(chunkSize, position);
        position -= bytesToRead;
        const buffer = Buffer.allocUnsafe(bytesToRead);
        await file.read(buffer, 0, bytesToRead, position);
        content = `${buffer.toString('utf-8')}${content}`;
        lineCount = content.split('\n').length - 1;
      }

      const lines = content.split('\n');
      if (lines.length <= safeTailLines) return content;
      return lines.slice(-safeTailLines).join('\n');
    } finally {
      await file.close();
    }
  } catch (err) {
    return `(Failed to read log file: ${err})`;
  }
}

async function readTailBytes(filePath: string, targetBytes = 2 * 1024 * 1024): Promise<string> {
  const safeTargetBytes = Math.max(64 * 1024, Math.floor(targetBytes));
  try {
    const file = await open(filePath, 'r');
    try {
      const fileStat = await file.stat();
      if (fileStat.size === 0) return '';

      const bytesToRead = Math.min(safeTargetBytes, fileStat.size);
      const position = Math.max(0, fileStat.size - bytesToRead);
      const buffer = Buffer.allocUnsafe(bytesToRead);
      await file.read(buffer, 0, bytesToRead, position);
      const text = buffer.toString('utf8');

      if (position === 0) {
        return text;
      }

      const firstNewlineIndex = text.indexOf('\n');
      return firstNewlineIndex >= 0 ? text.slice(firstNewlineIndex + 1) : text;
    } finally {
      await file.close();
    }
  } catch {
    return '';
  }
}

export async function listLogFiles(): Promise<LogFileSummary[]> {
  const directory = ensureLogDir();
  if (!directory) return [];
  try {
    const fileNames = await readdir(directory);
    const results: LogFileSummary[] = [];
    for (const fileName of fileNames) {
      if (!fileName.endsWith(LOGGER_FILE_EXTENSION)) continue;
      const fullPath = join(directory, fileName);
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

function parseAppLogEntries(content: string, fileName: string): AppLogEntry[] {
  const lines = content.split(/\r?\n/);
  const entries: AppLogEntry[] = [];
  let current: {
    ts: string;
    tsEpochMs: number;
    level: AppLogLevel;
    messageLines: string[];
    rawLines: string[];
  } | null = null;

  const pushCurrent = () => {
    if (!current) return;
    entries.push({
      id: `${fileName}:${current.tsEpochMs}:${entries.length}`,
      kind: 'app',
      ts: current.ts,
      tsEpochMs: current.tsEpochMs,
      fileName,
      level: current.level,
      message: current.messageLines.join('\n').trim(),
      raw: current.rawLines.join('\n').trim(),
    });
    current = null;
  };

  for (const line of lines) {
    const match = line.match(/^\[(.+?)\]\s+\[(DEBUG|INFO|WARN|ERROR)\]\s?(.*)$/);
    if (match) {
      pushCurrent();
      const [, rawTimestamp, rawLevel, message] = match;
      const { ts, tsEpochMs } = normalizeTimestamp(rawTimestamp);
      current = {
        ts,
        tsEpochMs,
        level: normalizeAppLogLevel(rawLevel.toLowerCase()),
        messageLines: [message],
        rawLines: [line],
      };
      continue;
    }

    if (current) {
      current.messageLines.push(line);
      current.rawLines.push(line);
    }
  }

  pushCurrent();
  return entries;
}

type QueryLogEntriesOptions = {
  search?: string;
  level?: AppLogLevel | 'all';
  fileName?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
};

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

export async function queryLogEntries(options: QueryLogEntriesOptions = {}): Promise<AppLogEntry[]> {
  const directory = ensureLogDir();
  if (!directory) return [];

  const files = await listLogFiles();
  const targetFiles = options.fileName
    ? files.filter((file) => file.name === options.fileName)
    : files.slice(0, 7);
  const search = options.search?.trim().toLowerCase();
  const rawLimit = Number.isFinite(options.limit) ? Number(options.limit) : 200;
  const limit = Math.max(1, Math.min(500, Math.floor(rawLimit)));
  const entries: AppLogEntry[] = [];
  const preferTailRead = !search && !options.fileName;

  for (const file of targetFiles) {
    const content = preferTailRead
      ? await readTailBytes(file.path)
      : await readFile(file.path, 'utf8').catch(() => '');
    if (!content) continue;

    const parsed = parseAppLogEntries(content, file.name)
      .filter((entry) => (options.level && options.level !== 'all' ? entry.level === options.level : true))
      .filter((entry) => withinTimeRange(entry.tsEpochMs, options.dateFrom, options.dateTo))
      .filter((entry) => (search ? `${entry.message}\n${entry.raw}`.toLowerCase().includes(search) : true));

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

export const logger = {
  debug,
  info,
  warn,
  error,
  setLevel: setLogLevel,
  init: initLogger,
  configure: configureLogger,
  getLogDir,
  getLogFilePath,
  getLogLevelName,
  getRecentLogs,
  readLogFile,
  listLogFiles,
  queryLogEntries,
  setLogLevelByName,
};
