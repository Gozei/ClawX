import type { IncomingMessage } from 'http';
import type { HostApiContext } from './context';
import { writeAuditEvent, type AuditEventResult } from '../utils/audit-logger';

function normalizeAuditError(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error == null) {
    return undefined;
  }
  return String(error);
}

export function emitMutationAudit(
  req: IncomingMessage,
  ctx: HostApiContext,
  params: {
    startedAt: number;
    action: string;
    resourceType: string;
    resourceId?: string;
    result: AuditEventResult;
    changedKeys?: string[];
    metadata?: Record<string, unknown>;
    error?: unknown;
    force?: boolean;
  },
): void {
  writeAuditEvent({
    requestId: ctx.requestId,
    source: 'host-api',
    actor: {
      type: 'local-user',
      origin: ctx.requestOrigin ?? req.headers?.origin ?? null,
    },
    action: params.action,
    resourceType: params.resourceType,
    resourceId: params.resourceId,
    result: params.result,
    changedKeys: params.changedKeys,
    metadata: {
      method: req.method ?? 'UNKNOWN',
      path: req.url ?? '',
      ...params.metadata,
    },
    durationMs: Date.now() - params.startedAt,
    error: normalizeAuditError(params.error),
  }, { force: params.force });
}
