import type { IncomingMessage, ServerResponse } from 'http';
import {
  LOG_KINDS,
  type AppLogLevel,
  type AuditResult,
  type LogKind,
  type LogQueryEntry,
} from '../../../shared/logging';
import {
  getAuditLogDir,
  listAuditLogFiles,
  queryAuditEntries,
} from '../../utils/audit-logger';
import { formatLocalDatePart, formatLocalTimestamp } from '../../utils/log-time';
import { logger } from '../../utils/logger';
import type { HostApiContext } from '../context';
import { sendJson } from '../route-utils';

function normalizeLogKind(value: string | null): LogKind {
  if (value && LOG_KINDS.includes(value as LogKind)) {
    return value as LogKind;
  }
  return 'app';
}

function getTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
}

async function handleLogQuery(res: ServerResponse, url: URL): Promise<void> {
  const kind = normalizeLogKind(url.searchParams.get('kind'));
  const search = url.searchParams.get('search') || undefined;
  const fileName = url.searchParams.get('fileName') || undefined;
  const dateFrom = url.searchParams.get('dateFrom') || undefined;
  const dateTo = url.searchParams.get('dateTo') || undefined;
  const limit = Number(url.searchParams.get('limit') || '200');

  const entries: LogQueryEntry[] = kind === 'audit'
    ? await queryAuditEntries({
      search,
      fileName,
      dateFrom,
      dateTo,
      limit,
      result: (url.searchParams.get('result') as AuditResult | 'all' | null) || 'all',
      action: url.searchParams.get('action') || undefined,
      resourceType: url.searchParams.get('resourceType') || undefined,
    })
    : await logger.queryLogEntries({
      search,
      fileName,
      dateFrom,
      dateTo,
      limit,
      level: (url.searchParams.get('level') as AppLogLevel | 'all' | null) || 'all',
    });
  const files = kind === 'audit'
    ? await listAuditLogFiles()
    : await logger.listLogFiles();

  sendJson(res, 200, {
    kind,
    timezone: getTimezone(),
    entries,
    files,
  });
}

async function handleLogExport(res: ServerResponse, url: URL): Promise<void> {
  const kind = normalizeLogKind(url.searchParams.get('kind'));
  const queryUrl = new URL(url.toString());
  queryUrl.pathname = '/api/logs/query';

  const entries: LogQueryEntry[] = kind === 'audit'
    ? await queryAuditEntries({
      search: queryUrl.searchParams.get('search') || undefined,
      fileName: queryUrl.searchParams.get('fileName') || undefined,
      dateFrom: queryUrl.searchParams.get('dateFrom') || undefined,
      dateTo: queryUrl.searchParams.get('dateTo') || undefined,
      limit: Number(queryUrl.searchParams.get('limit') || '500'),
      result: (queryUrl.searchParams.get('result') as AuditResult | 'all' | null) || 'all',
      action: queryUrl.searchParams.get('action') || undefined,
      resourceType: queryUrl.searchParams.get('resourceType') || undefined,
    })
    : await logger.queryLogEntries({
      search: queryUrl.searchParams.get('search') || undefined,
      fileName: queryUrl.searchParams.get('fileName') || undefined,
      dateFrom: queryUrl.searchParams.get('dateFrom') || undefined,
      dateTo: queryUrl.searchParams.get('dateTo') || undefined,
      limit: Number(queryUrl.searchParams.get('limit') || '500'),
      level: (queryUrl.searchParams.get('level') as AppLogLevel | 'all' | null) || 'all',
    });

  const timestamp = formatLocalTimestamp().replace(/[:.]/g, '-');
  sendJson(res, 200, {
    fileName: `${kind}-logs-${formatLocalDatePart()}-${timestamp.split('T')[1] || timestamp}.json`,
    mimeType: 'application/json',
    content: JSON.stringify({
      kind,
      timezone: getTimezone(),
      exportedAt: formatLocalTimestamp(),
      count: entries.length,
      entries,
    }, null, 2),
  });
}

export async function handleLogRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/logs' && req.method === 'GET') {
    const tailLines = Number(url.searchParams.get('tailLines') || '100');
    sendJson(res, 200, { content: await logger.readLogFile(Number.isFinite(tailLines) ? tailLines : 100) });
    return true;
  }

  if (url.pathname === '/api/logs/query' && req.method === 'GET') {
    await handleLogQuery(res, url);
    return true;
  }

  if (url.pathname === '/api/logs/export' && req.method === 'GET') {
    await handleLogExport(res, url);
    return true;
  }

  if (url.pathname === '/api/logs/dir' && req.method === 'GET') {
    sendJson(res, 200, {
      dir: logger.getLogDir(),
      auditDir: getAuditLogDir(),
      timezone: getTimezone(),
    });
    return true;
  }

  if (url.pathname === '/api/logs/files' && req.method === 'GET') {
    const kind = normalizeLogKind(url.searchParams.get('kind'));
    const files = kind === 'audit'
      ? await listAuditLogFiles()
      : await logger.listLogFiles();
    sendJson(res, 200, { kind, files, timezone: getTimezone() });
    return true;
  }

  return false;
}
