/**
 * Gateway State Store
 * Uses Host API + SSE for lifecycle/status and a direct renderer WebSocket for runtime RPC.
 */
import { create } from 'zustand';
import { hostApiFetch } from '@/lib/host-api';
import { invokeIpc } from '@/lib/api-client';
import { subscribeHostEvent } from '@/lib/host-events';
import type { GatewayStatus } from '../types/gateway';

let gatewayInitPromise: Promise<void> | null = null;
let gatewayEventUnsubscribers: Array<() => void> | null = null;
let gatewayReconcileTimer: ReturnType<typeof setInterval> | null = null;
let gatewayHistoryRefreshTimer: ReturnType<typeof setTimeout> | null = null;
const gatewayEventDedupe = new Map<string, number>();
const GATEWAY_EVENT_DEDUPE_TTL_MS = 30_000;
const LOAD_SESSIONS_MIN_INTERVAL_MS = 1_200;
const LOAD_HISTORY_MIN_INTERVAL_MS = 800;
const GATEWAY_RPC_RECOVERY_COOLDOWN_MS = 30_000;
let lastLoadSessionsAt = 0;
let lastLoadHistoryAt = 0;
let lastGatewayRpcRecoveryAt = 0;

function updateSessionRunningState(
  sessionRunningState: Record<string, boolean> | undefined,
  sessionKey: string,
  isRunning: boolean,
): Record<string, boolean> {
  const current = sessionRunningState ?? {};
  if (!sessionKey) return current;
  if (isRunning) {
    if (current[sessionKey]) return current;
    return {
      ...current,
      [sessionKey]: true,
    };
  }
  if (!current[sessionKey]) return current;
  return Object.fromEntries(Object.entries(current).filter(([key]) => key !== sessionKey));
}

function getSessionIdentity(sessionKey: string | null | undefined): string {
  if (!sessionKey) return '';
  if (!sessionKey.startsWith('agent:')) return sessionKey;
  const parts = sessionKey.split(':');
  return parts.length >= 3 ? parts.slice(2).join(':') : sessionKey;
}

function sessionKeysMatch(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left || !right) return false;
  return left === right || getSessionIdentity(left) === getSessionIdentity(right);
}

function resolveSessionKeyAlias(
  sessionKey: string,
  state: { currentSessionKey?: string; sessions?: Array<{ key: string }> },
): string {
  const candidates = [
    state.currentSessionKey,
    ...(state.sessions ?? []).map((session) => session.key),
  ].filter((candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0);

  for (const candidate of candidates) {
    if (sessionKeysMatch(candidate, sessionKey)) {
      return candidate;
    }
  }
  return sessionKey;
}

interface GatewayHealth {
  ok: boolean;
  error?: string;
  uptime?: number;
}

interface GatewayState {
  status: GatewayStatus;
  health: GatewayHealth | null;
  isInitialized: boolean;
  lastError: string | null;
  init: () => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  restart: () => Promise<void>;
  checkHealth: () => Promise<GatewayHealth>;
  rpc: <T>(method: string, params?: unknown, timeoutMs?: number) => Promise<T>;
  setStatus: (status: GatewayStatus) => void;
  clearError: () => void;
}

type ChatRuntimeRecoveryState = {
  sending?: boolean;
  pendingFinal?: boolean;
  activeRunId?: string | null;
  sessionRunningState?: Record<string, boolean>;
};

async function hasActiveChatTurn(): Promise<boolean> {
  try {
    const { useChatStore } = await import('./chat');
    const state = useChatStore.getState() as ChatRuntimeRecoveryState;
    return !!state.sending
      || !!state.pendingFinal
      || !!state.activeRunId
      || Object.values(state.sessionRunningState ?? {}).some(Boolean);
  } catch {
    return false;
  }
}

async function shouldAutoRecoverGatewayRpc(
  method: string,
  errorMessage: string,
  gatewayState: GatewayStatus['state'],
): Promise<boolean> {
  if (gatewayState === 'starting' || gatewayState === 'reconnecting') {
    return false;
  }

  const lower = errorMessage.toLowerCase();
  const gatewayLooksUnresponsive = lower.includes('rpc timeout')
    || lower.includes('gateway socket closed')
    || lower.includes('gateway not connected');
  if (!gatewayLooksUnresponsive) {
    return false;
  }

  if (method === 'sessions.list') {
    return true;
  }

  if (method !== 'chat.send' && method !== 'chat.history') {
    return false;
  }

  // During an active chat turn, chat.send/chat.history may legitimately sit
  // pending while the runtime is still working. Restarting the gateway from the
  // renderer at that point is more disruptive than helpful.
  if (await hasActiveChatTurn()) {
    return false;
  }

  return true;
}

function queueGatewayRpcRecovery(
  get: () => GatewayState,
  errorMessage: string,
): void {
  const now = Date.now();
  if (now - lastGatewayRpcRecoveryAt < GATEWAY_RPC_RECOVERY_COOLDOWN_MS) {
    return;
  }
  lastGatewayRpcRecoveryAt = now;
  console.warn(`[gateway-store] auto-recovering gateway after critical RPC failure: ${errorMessage}`);
  void get().restart().catch((error) => {
    console.warn('[gateway-store] automatic gateway restart failed:', error);
  });
}

function pruneGatewayEventDedupe(now: number): void {
  for (const [key, ts] of gatewayEventDedupe) {
    if (now - ts > GATEWAY_EVENT_DEDUPE_TTL_MS) {
      gatewayEventDedupe.delete(key);
    }
  }
}

function buildGatewayEventDedupeKey(event: Record<string, unknown>): string | null {
  const message = event.message;
  if (message && typeof message === 'object') {
    const msg = message as Record<string, unknown>;
    const messageId = msg.id != null ? String(msg.id) : '';
    const stopReason = msg.stopReason ?? msg.stop_reason;
    const role = msg.role != null ? String(msg.role) : '';
    const content = msg.content;
    const contentKey = typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? JSON.stringify(content)
        : '';
    if (messageId || stopReason || (role && contentKey)) {
      return `msg|${messageId}|${String(stopReason ?? '')}|${role}|${contentKey}`;
    }
  }

  const runId = event.runId != null ? String(event.runId) : '';
  const sessionKey = event.sessionKey != null ? String(event.sessionKey) : '';
  const seq = event.seq != null ? String(event.seq) : '';
  const state = event.state != null ? String(event.state) : '';
  if (runId || sessionKey || seq || state) {
    return [runId, sessionKey, seq, state].join('|');
  }
  return null;
}

function shouldProcessGatewayEvent(event: Record<string, unknown>): boolean {
  const key = buildGatewayEventDedupeKey(event);
  if (!key) return true;
  const now = Date.now();
  pruneGatewayEventDedupe(now);
  if (gatewayEventDedupe.has(key)) {
    return false;
  }
  gatewayEventDedupe.set(key, now);
  return true;
}

function maybeLoadSessions(
  state: { loadSessions: () => Promise<void> },
  force = false,
): void {
  const now = Date.now();
  if (!force && now - lastLoadSessionsAt < LOAD_SESSIONS_MIN_INTERVAL_MS) return;
  lastLoadSessionsAt = now;
  void state.loadSessions();
}

function maybeLoadHistory(
  state: { loadHistory: (quiet?: boolean) => Promise<void> },
  force = false,
): void {
  const now = Date.now();
  if (!force && now - lastLoadHistoryAt < LOAD_HISTORY_MIN_INTERVAL_MS) return;
  lastLoadHistoryAt = now;
  void state.loadHistory(true);
}

function scheduleLoadHistory(force = false, delayMs = 700): void {
  if (gatewayHistoryRefreshTimer) {
    clearTimeout(gatewayHistoryRefreshTimer);
  }
  gatewayHistoryRefreshTimer = setTimeout(() => {
    gatewayHistoryRefreshTimer = null;
    import('./chat')
      .then(({ useChatStore }) => {
        maybeLoadHistory(useChatStore.getState(), force);
      })
      .catch(() => {});
  }, delayMs);
}

function shouldDeferCompletedHistoryRefresh(state: {
  sending?: boolean;
  pendingFinal?: boolean;
  activeTurnBuffer?: { hasAnyStreamContent?: boolean } | null;
}): boolean {
  return !!state.activeTurnBuffer?.hasAnyStreamContent;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function stringifyGatewayPayload(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (Array.isArray(value)) {
    const parts = value
      .map((entry) => stringifyGatewayPayload(entry))
      .filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
    return parts.length > 0 ? parts.join('\n') : undefined;
  }

  const record = asRecord(value);
  if (record) {
    for (const key of ['text', 'summary', 'progressText', 'output', 'content', 'message', 'title', 'error']) {
      const nested = stringifyGatewayPayload(record[key]);
      if (nested) return nested;
    }
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  if (value == null) return undefined;
  return String(value);
}

function buildPatchSummaryText(data: Record<string, unknown>): string | undefined {
  const added = Array.isArray(data.added)
    ? data.added.filter((entry): entry is string => typeof entry === 'string')
    : [];
  const modified = Array.isArray(data.modified)
    ? data.modified.filter((entry): entry is string => typeof entry === 'string')
    : [];
  const deleted = Array.isArray(data.deleted)
    ? data.deleted.filter((entry): entry is string => typeof entry === 'string')
    : [];

  const parts: string[] = [];
  if (added.length > 0) parts.push(`${added.length} added`);
  if (modified.length > 0) parts.push(`${modified.length} modified`);
  if (deleted.length > 0) parts.push(`${deleted.length} deleted`);
  return parts.length > 0 ? parts.join(', ') : undefined;
}

function resolveAgentStreamToolStatus(stream: string | undefined, data: Record<string, unknown>): string | undefined {
  const directStatus = readNonEmptyString(data.status);
  if (directStatus) return directStatus;

  const phase = readNonEmptyString(data.phase)?.toLowerCase();
  if (phase === 'end' || phase === 'done' || phase === 'completed') {
    return 'completed';
  }
  if (phase === 'error' || phase === 'failed') {
    return 'error';
  }
  if (phase === 'start' || phase === 'update' || phase === 'delta') {
    return 'running';
  }

  if (stream === 'command_output') return 'running';
  return undefined;
}

function resolveAgentStreamToolName(stream: string | undefined, data: Record<string, unknown>): string | undefined {
  const explicitName = readNonEmptyString(data.name);
  const kind = readNonEmptyString(data.kind)?.toLowerCase();

  if (stream === 'command_output') return 'command';
  if (stream === 'patch') return 'apply_patch';
  if (kind === 'command') return 'command';
  if (kind === 'patch') return 'apply_patch';
  if (kind === 'tool') return explicitName ?? 'tool';
  if (explicitName) return explicitName;
  return kind;
}

function resolveAgentStreamToolSummary(stream: string | undefined, data: Record<string, unknown>): string | undefined {
  const patchSummary = stream === 'patch' ? buildPatchSummaryText(data) : undefined;
  const candidates = [
    patchSummary,
    stringifyGatewayPayload(data.progressText),
    stringifyGatewayPayload(data.summary),
    stringifyGatewayPayload(data.output),
    stringifyGatewayPayload(data.title),
    stringifyGatewayPayload(data.error),
    stringifyGatewayPayload(data.partialResult),
    stringifyGatewayPayload(data.result),
    stringifyGatewayPayload(data.message),
  ];
  return candidates.find((entry): entry is string => typeof entry === 'string' && entry.length > 0);
}

function resolveAgentStreamToolDurationMs(data: Record<string, unknown>): number | undefined {
  const direct = parseFiniteNumber(data.durationMs ?? data.duration);
  if (direct !== undefined) return direct;

  const startedAt = parseFiniteNumber(data.startedAt);
  const endedAt = parseFiniteNumber(data.endedAt);
  if (startedAt !== undefined && endedAt !== undefined && endedAt >= startedAt) {
    return endedAt - startedAt;
  }
  return undefined;
}

function buildSyntheticAssistantDeltaMessage(text: string): Record<string, unknown> {
  return {
    role: 'assistant',
    content: [
      {
        type: 'text',
        text,
      },
    ],
    timestamp: Date.now(),
  };
}

function buildSyntheticToolProgressMessage(params: {
  toolCallId?: string;
  toolName?: string;
  status?: string;
  summary?: string;
  error?: string;
  durationMs?: number;
}): Record<string, unknown> {
  return {
    role: 'toolresult',
    ...(params.toolCallId ? { toolCallId: params.toolCallId } : {}),
    ...(params.toolName ? { toolName: params.toolName } : {}),
    ...(params.status ? { status: params.status } : {}),
    ...(params.durationMs != null ? { durationMs: params.durationMs } : {}),
    ...(params.error ? { error: params.error } : {}),
    content: params.summary ?? '',
    timestamp: Date.now(),
  };
}

function normalizeGatewayAgentEvent(params: Record<string, unknown>): Record<string, unknown> | null {
  const data = asRecord(params.data) ?? {};
  const runId = params.runId ?? data.runId;
  const sessionKey = params.sessionKey ?? data.sessionKey;
  const stream = params.stream ?? data.stream;
  const seq = params.seq ?? data.seq;
  const state = params.state ?? data.state;
  const message = params.message ?? data.message;
  const errorMessage = params.errorMessage ?? data.errorMessage ?? data.error;

  if (state != null || message != null || errorMessage != null) {
    return {
      ...data,
      runId,
      sessionKey,
      stream,
      seq,
      state,
      message,
      errorMessage,
    };
  }

  const normalizedStream = readNonEmptyString(stream);

  if (normalizedStream === 'assistant') {
    const text = readNonEmptyString(data.text);
    if (!text) return null;
    return {
      runId,
      sessionKey,
      stream: normalizedStream,
      seq,
      state: 'delta',
      message: buildSyntheticAssistantDeltaMessage(text),
    };
  }

  if (
    normalizedStream === 'tool'
    || normalizedStream === 'item'
    || normalizedStream === 'command_output'
    || normalizedStream === 'patch'
  ) {
    const toolCallId = readNonEmptyString(data.toolCallId) ?? readNonEmptyString(data.itemId);
    const toolName = resolveAgentStreamToolName(normalizedStream, data);
    const status = resolveAgentStreamToolStatus(normalizedStream, data);
    const summary = resolveAgentStreamToolSummary(normalizedStream, data);
    const error = readNonEmptyString(data.error) ?? (status === 'error' ? summary : undefined);
    const durationMs = resolveAgentStreamToolDurationMs(data);

    if (!toolCallId && !toolName && !summary && !error) {
      return null;
    }

    return {
      runId,
      sessionKey,
      stream: normalizedStream,
      seq,
      state: 'delta',
      message: buildSyntheticToolProgressMessage({
        toolCallId,
        toolName,
        status,
        summary,
        error,
        durationMs,
      }),
    };
  }

  if (normalizedStream === 'lifecycle') {
    const phase = readNonEmptyString(data.phase)?.toLowerCase();
    if (phase === 'error') {
      return {
        runId,
        sessionKey,
        stream: normalizedStream,
        seq,
        state: 'error',
        errorMessage: readNonEmptyString(data.error) ?? readNonEmptyString(data.message) ?? 'Agent run failed',
      };
    }
  }

  return null;
}

function handleGatewayNotification(notification: { method?: string; params?: Record<string, unknown> } | undefined): void {
  const payload = notification;
  if (!payload || payload.method !== 'agent' || !payload.params || typeof payload.params !== 'object') {
    return;
  }

  const p = payload.params;
  const data = asRecord(p.data) ?? {};
  const phase = data.phase ?? p.phase;
  const normalizedEvent = normalizeGatewayAgentEvent(p);

  if (normalizedEvent) {
    if (shouldProcessGatewayEvent(normalizedEvent)) {
      import('./chat')
        .then(({ useChatStore }) => {
          const normalizedState = normalizedEvent.state != null ? String(normalizedEvent.state) : '';
          const chatState = useChatStore.getState();
          const normalizedSessionKey = normalizedEvent.sessionKey != null
            ? resolveSessionKeyAlias(String(normalizedEvent.sessionKey), chatState)
            : null;
          if (normalizedSessionKey && (normalizedState === 'error' || normalizedState === 'aborted')) {
            useChatStore.setState((state) => ({
              sessionRunningState: updateSessionRunningState(
                state.sessionRunningState,
                normalizedSessionKey,
                false,
              ),
            }));
          }
          useChatStore.getState().handleChatEvent(normalizedEvent);
        })
        .catch(() => {});
    }
  }

  const runId = p.runId ?? data.runId;
  const sessionKey = p.sessionKey ?? data.sessionKey;
  if (phase === 'started' && runId != null && sessionKey != null) {
    import('./chat')
      .then(({ useChatStore }) => {
        const state = useChatStore.getState();
        const rawSessionKey = String(sessionKey);
        const resolvedSessionKey = resolveSessionKeyAlias(rawSessionKey, state);
        useChatStore.setState((chatState) => ({
          sessionRunningState: updateSessionRunningState(
            chatState.sessionRunningState,
            resolvedSessionKey,
            true,
          ),
        }));
        const shouldRefreshSessions =
          !sessionKeysMatch(rawSessionKey, state.currentSessionKey)
          || !state.sessions.some((session) => sessionKeysMatch(session.key, rawSessionKey));
        if (shouldRefreshSessions) {
          maybeLoadSessions(state, true);
        }

        state.handleChatEvent({
          state: 'started',
          runId,
          sessionKey: resolvedSessionKey,
        });
      })
      .catch(() => {});
  }

  if (phase === 'completed' || phase === 'done' || phase === 'finished' || phase === 'end') {
    import('./chat')
      .then(({ useChatStore }) => {
        const state = useChatStore.getState();
        const rawSessionKey = sessionKey != null ? String(sessionKey) : null;
        const resolvedSessionKey = rawSessionKey != null ? resolveSessionKeyAlias(rawSessionKey, state) : null;
        if (resolvedSessionKey) {
          useChatStore.setState((chatState) => ({
            sessionRunningState: updateSessionRunningState(
              chatState.sessionRunningState,
              resolvedSessionKey,
              false,
            ),
          }));
        }
        const shouldRefreshSessions = rawSessionKey != null && (
          !sessionKeysMatch(rawSessionKey, state.currentSessionKey)
          || !state.sessions.some((session) => sessionKeysMatch(session.key, rawSessionKey))
        );
        if (shouldRefreshSessions) {
          maybeLoadSessions(state);
        }

        const matchesCurrentSession = resolvedSessionKey == null || sessionKeysMatch(resolvedSessionKey, state.currentSessionKey);
        const matchesActiveRun = runId != null && state.activeRunId != null && String(runId) === state.activeRunId;
        const shouldDeferHistoryRefresh = shouldDeferCompletedHistoryRefresh(state);
        const completionSessionKey = resolvedSessionKey
          ?? ((matchesCurrentSession || matchesActiveRun) ? state.currentSessionKey : null);

        if (matchesCurrentSession || matchesActiveRun) {
          scheduleLoadHistory(true, shouldDeferHistoryRefresh ? 700 : 0);
        }
        if ((matchesCurrentSession || matchesActiveRun) && (state.sending || matchesActiveRun)) {
          useChatStore.setState((chatState) => ({
            sending: false,
            activeRunId: null,
            sendStage: null,
            pendingFinal: false,
            error: null,
            sessionRunningState: completionSessionKey
              ? updateSessionRunningState(chatState.sessionRunningState, completionSessionKey, false)
              : chatState.sessionRunningState,
          }));
        }
      })
      .catch(() => {});
  }
}

function handleGatewayChatMessage(data: unknown): void {
  import('./chat').then(({ useChatStore }) => {
    const chatData = data as Record<string, unknown>;
    const payload = ('message' in chatData && typeof chatData.message === 'object')
      ? chatData.message as Record<string, unknown>
      : chatData;

    if (payload.state) {
      if (!shouldProcessGatewayEvent(payload)) return;
      useChatStore.getState().handleChatEvent(payload);
      return;
    }

    const normalized = {
      state: 'final',
      message: payload,
      runId: chatData.runId ?? payload.runId,
    };
    if (!shouldProcessGatewayEvent(normalized)) return;
    useChatStore.getState().handleChatEvent(normalized);
  }).catch(() => {});
}

function mapChannelStatus(status: string): 'connected' | 'connecting' | 'disconnected' | 'error' {
  switch (status) {
    case 'connected':
    case 'running':
      return 'connected';
    case 'connecting':
    case 'starting':
      return 'connecting';
    case 'error':
    case 'failed':
      return 'error';
    default:
      return 'disconnected';
  }
}

export const useGatewayStore = create<GatewayState>((set, get) => ({
  status: {
    state: 'stopped',
    port: 18789,
  },
  health: null,
  isInitialized: false,
  lastError: null,

  init: async () => {
    if (get().isInitialized) return;
    if (gatewayInitPromise) {
      await gatewayInitPromise;
      return;
    }

    gatewayInitPromise = (async () => {
      try {
        const status = await hostApiFetch<GatewayStatus>('/api/gateway/status');
        set({ status, isInitialized: true });

        if (!gatewayEventUnsubscribers) {
          const unsubscribers: Array<() => void> = [];
          unsubscribers.push(subscribeHostEvent<GatewayStatus>('gateway:status', (payload) => {
            set({ status: payload });
          }));
          unsubscribers.push(subscribeHostEvent<{ message?: string }>('gateway:error', (payload) => {
            set({ lastError: payload.message || 'Gateway error' });
          }));
          unsubscribers.push(subscribeHostEvent<{ method?: string; params?: Record<string, unknown> }>(
            'gateway:notification',
            (payload) => {
              handleGatewayNotification(payload);
            },
          ));
          unsubscribers.push(subscribeHostEvent('gateway:chat-message', (payload) => {
            handleGatewayChatMessage(payload);
          }));
          unsubscribers.push(subscribeHostEvent<{ channelId?: string; status?: string }>(
            'gateway:channel-status',
            (update) => {
              import('./channels')
                .then(({ useChannelsStore }) => {
                  if (!update.channelId || !update.status) return;
                  const state = useChannelsStore.getState();
                  const channel = state.channels.find((item) => item.type === update.channelId);
                  if (channel) {
                    const newStatus = mapChannelStatus(update.status);
                    state.updateChannel(channel.id, { status: newStatus });
                    
                    if (newStatus === 'disconnected' || newStatus === 'error') {
                      state.scheduleAutoReconnect(channel.id);
                    } else if (newStatus === 'connected' || newStatus === 'connecting') {
                      state.clearAutoReconnect(channel.id);
                    }
                  }
                })
                .catch(() => {});
            },
          ));
          gatewayEventUnsubscribers = unsubscribers;

          // Periodic reconciliation safety net: every 30 seconds, check if the
          // renderer's view of gateway state has drifted from main process truth.
          // This catches any future one-off IPC delivery failures without adding
          // a constant polling load (single lightweight IPC invoke per interval).
          // Clear any previous timer first to avoid leaks during HMR reloads.
          if (gatewayReconcileTimer !== null) {
            clearInterval(gatewayReconcileTimer);
          }
          gatewayReconcileTimer = setInterval(() => {
            const ipc = window.electron?.ipcRenderer;
            if (!ipc) return;
            ipc.invoke('gateway:status')
              .then((result: unknown) => {
                const latest = result as GatewayStatus;
                const current = get().status;
                if (latest.state !== current.state) {
                  console.info(
                    `[gateway-store] reconciled stale state: ${current.state} → ${latest.state}`,
                  );
                  set({ status: latest });
                }
              })
              .catch(() => { /* ignore */ });
          }, 30_000);
        }

        // Re-fetch status after IPC listeners are registered to close the race
        // window: if the gateway transitioned (e.g. starting → running) between
        // the initial fetch and the IPC listener setup, that event was lost.
        // A second fetch guarantees we pick up the latest state.
        try {
          const refreshed = await hostApiFetch<GatewayStatus>('/api/gateway/status');
          const current = get().status;
          if (refreshed.state !== current.state) {
            set({ status: refreshed });
          }
        } catch {
          // Best-effort; the IPC listener will eventually reconcile.
        }
      } catch (error) {
        console.error('Failed to initialize Gateway:', error);
        set({ lastError: String(error) });
      } finally {
        gatewayInitPromise = null;
      }
    })();

    await gatewayInitPromise;
  },

  start: async () => {
    try {
      set({ status: { ...get().status, state: 'starting' }, lastError: null });
      const result = await hostApiFetch<{ success: boolean; error?: string }>('/api/gateway/start', {
        method: 'POST',
      });
      if (!result.success) {
        set({
          status: { ...get().status, state: 'error', error: result.error },
          lastError: result.error || 'Failed to start Gateway',
        });
      }
    } catch (error) {
      set({
        status: { ...get().status, state: 'error', error: String(error) },
        lastError: String(error),
      });
    }
  },

  stop: async () => {
    try {
      await hostApiFetch('/api/gateway/stop', { method: 'POST' });
      set({ status: { ...get().status, state: 'stopped' }, lastError: null });
    } catch (error) {
      console.error('Failed to stop Gateway:', error);
      set({ lastError: String(error) });
    }
  },

  restart: async () => {
    try {
      set({ status: { ...get().status, state: 'starting' }, lastError: null });
      const result = await hostApiFetch<{ success: boolean; error?: string }>('/api/gateway/restart', {
        method: 'POST',
      });
      if (!result.success) {
        set({
          status: { ...get().status, state: 'error', error: result.error },
          lastError: result.error || 'Failed to restart Gateway',
        });
      }
    } catch (error) {
      set({
        status: { ...get().status, state: 'error', error: String(error) },
        lastError: String(error),
      });
    }
  },

  checkHealth: async () => {
    try {
      const result = await hostApiFetch<GatewayHealth>('/api/gateway/health');
      set({ health: result });
      return result;
    } catch (error) {
      const health: GatewayHealth = { ok: false, error: String(error) };
      set({ health });
      return health;
    }
  },

  rpc: async <T>(method: string, params?: unknown, timeoutMs?: number): Promise<T> => {
    const response = await invokeIpc<{
      success: boolean;
      result?: T;
      error?: string;
    }>('gateway:rpc', method, params, timeoutMs);
    if (!response.success) {
      const errorMessage = response.error || `Gateway RPC failed: ${method}`;
      set({ lastError: errorMessage });
      if (await shouldAutoRecoverGatewayRpc(method, errorMessage, get().status.state)) {
        queueGatewayRpcRecovery(get, errorMessage);
      }
      throw new Error(errorMessage);
    }
    return response.result as T;
  },

  setStatus: (status) => set({ status }),
  clearError: () => set({ lastError: null }),
}));
