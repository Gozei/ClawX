/**
 * Chat State Store
 * Manages chat messages, sessions, streaming, and thinking state.
 * Communicates with OpenClaw Gateway via renderer WebSocket RPC.
 */
import { create } from 'zustand';
import { buildAgentExecutionMetadata } from '@/lib/agent-execution-context';
import { isWithinCompletedTurnProcessGrace } from '@/lib/chat-turn-grace';
import { normalizeAppError } from '@/lib/error-model';
import { hostApiFetch } from '@/lib/host-api';
import i18n from '@/i18n';
import { stripInjectedInboundPrelude } from '../../shared/inbound-user-text';
import { useGatewayStore } from './gateway';
import { useAgentsStore } from './agents';
import { buildCronSessionHistoryPath, isCronSessionKey } from './chat/cron-session-utils';
import {
  CHAT_HISTORY_LABEL_PREFETCH_LIMIT,
  CHAT_HISTORY_RPC_TIMEOUT_MS,
  hasAssistantFinalTextContent,
  hasComposerDraftContent,
  hasStoredSessionLabel,
  isUnusedDraftSession,
} from './chat/helpers';
import {
  DEFAULT_CANONICAL_PREFIX,
  DEFAULT_SESSION_KEY,
  type ActiveTurnBuffer,
  type AttachedFileMeta,
  type ChatComposerDraft,
  type ChatComposerDraftUpdate,
  type ChatMessageDispatchOptions,
  type ChatSession,
  type ChatState,
  type ComposerFileAttachment,
  type ContentBlock,
  type RawMessage,
  type ToolStatus,
} from './chat/types';

export type {
  ActiveTurnBuffer,
  AttachedFileMeta,
  ChatComposerDraft,
  ChatComposerDraftUpdate,
  ChatMessageDispatchOptions,
  ChatSession,
  ComposerFileAttachment,
  ContentBlock,
  RawMessage,
  ToolStatus,
  ChatSendStage,
} from './chat/types';

type ChatStoreSet = (
  partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>),
  replace?: false,
) => void;

type SessionViewSnapshot = Pick<
  ChatState,
  | 'messages'
  | 'loading'
  | 'error'
  | 'sending'
  | 'activeRunId'
  | 'streamingText'
  | 'streamingMessage'
  | 'streamingTools'
  | 'sendStage'
  | 'pendingFinal'
  | 'lastUserMessageAt'
  | 'pendingToolImages'
  | 'thinkingLevel'
>;

// Module-level timestamp tracking the last chat event received.
// Used by the safety timeout to avoid false-positive "no response" errors
// during tool-use conversations where streamingMessage is temporarily cleared
// between tool-result finals and the next delta.
let _lastChatEventAt = 0;

/** Normalize a timestamp to milliseconds. Handles both seconds and ms. */
function toMs(ts: number): number {
  // Timestamps < 1e12 are in seconds (before ~2033); >= 1e12 are milliseconds
  return ts < 1e12 ? ts * 1000 : ts;
}

// Timer for fallback history polling during active sends.
// If no streaming events arrive within a few seconds, we periodically
// poll chat.history to surface intermediate tool-call turns.
let _historyPollTimer: ReturnType<typeof setTimeout> | null = null;

// Timer for delayed error finalization. When the Gateway reports a mid-stream
// error (e.g. "terminated"), it may retry internally and recover. We wait
// before committing the error to give the recovery path a chance.
let _errorRecoveryTimer: ReturnType<typeof setTimeout> | null = null;
let _loadSessionsInFlight: Promise<void> | null = null;
let _lastLoadSessionsAt = 0;
const _historyLoadInFlight = new Map<string, { promise: Promise<void>; quiet: boolean }>();
const _lastHistoryLoadAtBySession = new Map<string, number>();
const SESSION_LOAD_MIN_INTERVAL_MS = 1_200;
const HISTORY_LOAD_MIN_INTERVAL_MS = 800;
const HISTORY_POLL_SILENCE_WINDOW_MS = 3_500;
const HISTORY_POLL_START_DELAY_MS = 5_000;
const HISTORY_POLL_INTERVAL_MS = 6_000;
const HISTORY_INCOMPLETE_RETRY_DELAY_MS = 1_200;
const HISTORY_INCOMPLETE_RETRY_WINDOW_MS = 120_000;
const HISTORY_INCOMPLETE_RETRY_LIMIT = 3;
const CHAT_EVENT_DEDUPE_TTL_MS = 30_000;
const AUTO_SESSION_LABEL_MAX_CHARS = 30;
const _chatEventDedupe = new Map<string, number>();
const _sessionViewSnapshots = new Map<string, SessionViewSnapshot>();
const _historyIncompleteRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
const _historyIncompleteRetryAttempts = new Map<string, number>();
const _sessionAutoLabelRequestsInFlight = new Map<string, Promise<string | null>>();
const _runtimePatchedAgentModels = new Map<string, string | null>();
const _runtimeAgentModelSyncInFlight = new Map<string, Promise<void>>();

const EMPTY_SESSION_VIEW_SNAPSHOT: SessionViewSnapshot = {
  messages: [],
  loading: false,
  error: null,
  sending: false,
  activeRunId: null,
  streamingText: '',
  streamingMessage: null,
  streamingTools: [],
  sendStage: null,
  pendingFinal: false,
  lastUserMessageAt: null,
  pendingToolImages: [],
  thinkingLevel: null,
};

let pendingDeltaMessage: RawMessage | null = null;
let pendingDeltaUpdates: ToolStatus[] = [];
let pendingDeltaClearError = false;
let pendingDeltaFlushHandle: ReturnType<typeof setTimeout> | null = null;
let pendingFinalRecoveryHandle: ReturnType<typeof setTimeout> | null = null;
const STREAM_DELTA_FLUSH_MS = 48;
const PENDING_FINAL_RECOVERY_DELAY_MS = 8_000;

function clearErrorRecoveryTimer(): void {
  if (_errorRecoveryTimer) {
    clearTimeout(_errorRecoveryTimer);
    _errorRecoveryTimer = null;
  }
}

function clearHistoryPoll(): void {
  if (_historyPollTimer) {
    clearTimeout(_historyPollTimer);
    _historyPollTimer = null;
  }
}

function clearHistoryIncompleteRetry(sessionKey: string): void {
  const timer = _historyIncompleteRetryTimers.get(sessionKey);
  if (timer) {
    clearTimeout(timer);
    _historyIncompleteRetryTimers.delete(sessionKey);
  }
  _historyIncompleteRetryAttempts.delete(sessionKey);
}

function truncateAutoSessionLabel(value: string): string {
  return Array.from(value.trim()).slice(0, AUTO_SESSION_LABEL_MAX_CHARS).join('');
}

function syncPersistedSessionLabel(
  set: ChatStoreSet,
  sessionKey: string,
  label: string,
): void {
  const normalizedLabel = label.trim();
  if (!normalizedLabel) return;

  set((state) => {
    const nextSessionLabels = state.sessionLabels[sessionKey] === normalizedLabel
      ? state.sessionLabels
      : { ...state.sessionLabels, [sessionKey]: normalizedLabel };

    const nextSessions = state.sessions.map((session) => (
      session.key === sessionKey
        ? { ...session, label: normalizedLabel }
        : session
    ));
    const sessionsChanged = nextSessions.some((session, index) => session !== state.sessions[index]);

    if (!sessionsChanged && nextSessionLabels === state.sessionLabels) {
      return {};
    }

    return {
      sessions: sessionsChanged ? nextSessions : state.sessions,
      sessionLabels: nextSessionLabels,
    };
  });
}

function queueAutoSessionLabelPersistence(
  set: ChatStoreSet,
  sessionKey: string,
  rawLabel: string,
): void {
  if (!sessionKey.startsWith('agent:') || sessionKey.endsWith(':main')) return;

  const normalizedLabel = truncateAutoSessionLabel(rawLabel);
  if (!normalizedLabel) return;
  if (_sessionAutoLabelRequestsInFlight.has(sessionKey)) return;

  const request = hostApiFetch<{ success?: boolean; label?: string }>('/api/sessions/auto-label', {
    method: 'POST',
    body: JSON.stringify({ sessionKey, label: normalizedLabel }),
  }).then((result) => {
    if (!result?.success) return null;
    const resolvedLabel = typeof result.label === 'string' ? result.label.trim() : normalizedLabel;
    return resolvedLabel || normalizedLabel;
  }).catch((error) => {
    console.warn(`[autoSessionLabel] Failed to persist label for ${sessionKey}:`, error);
    return null;
  });

  _sessionAutoLabelRequestsInFlight.set(sessionKey, request);
  void request.finally(() => {
    if (_sessionAutoLabelRequestsInFlight.get(sessionKey) === request) {
      _sessionAutoLabelRequestsInFlight.delete(sessionKey);
    }
  });
  void request.then((persistedLabel) => {
    if (persistedLabel) {
      syncPersistedSessionLabel(set, sessionKey, persistedLabel);
    }
  });
}

function cloneAttachedFiles(files: AttachedFileMeta[] | undefined): AttachedFileMeta[] | undefined {
  return files?.map((file) => ({ ...file }));
}

function cloneMessage(message: RawMessage): RawMessage {
  return {
    ...message,
    _attachedFiles: cloneAttachedFiles(message._attachedFiles),
  };
}

function cloneToolStatuses(tools: ToolStatus[]): ToolStatus[] {
  return tools.map((tool) => ({ ...tool }));
}

const EMPTY_CHAT_COMPOSER_DRAFT: ChatComposerDraft = {
  text: '',
  attachments: [],
  targetAgentId: null,
};

function cloneComposerAttachment(attachment: ComposerFileAttachment): ComposerFileAttachment {
  return { ...attachment };
}

function cloneComposerDraft(draft: ChatComposerDraft): ChatComposerDraft {
  return {
    text: draft.text,
    attachments: draft.attachments.map(cloneComposerAttachment),
    targetAgentId: draft.targetAgentId ?? null,
  };
}

function normalizeComposerDraft(draft: ChatComposerDraft | null | undefined): ChatComposerDraft | null {
  if (!draft) return null;

  const normalized: ChatComposerDraft = {
    text: typeof draft.text === 'string' ? draft.text : '',
    attachments: Array.isArray(draft.attachments) ? draft.attachments.map(cloneComposerAttachment) : [],
    targetAgentId: typeof draft.targetAgentId === 'string' && draft.targetAgentId.trim()
      ? draft.targetAgentId.trim().toLowerCase()
      : null,
  };

  return hasComposerDraftContent(normalized) ? normalized : null;
}

function cloneSessionViewSnapshot(snapshot: SessionViewSnapshot): SessionViewSnapshot {
  return {
    ...snapshot,
    messages: snapshot.messages.map(cloneMessage),
    streamingMessage: snapshot.streamingMessage && typeof snapshot.streamingMessage === 'object'
      ? { ...(snapshot.streamingMessage as Record<string, unknown>) }
      : snapshot.streamingMessage,
    streamingTools: cloneToolStatuses(snapshot.streamingTools),
    sendStage: snapshot.sendStage,
    pendingToolImages: cloneAttachedFiles(snapshot.pendingToolImages) ?? [],
  };
}

function buildSessionViewSnapshot(
  state: Pick<
    ChatState,
    | 'messages'
    | 'loading'
    | 'error'
    | 'sending'
    | 'activeRunId'
    | 'streamingText'
    | 'streamingMessage'
    | 'streamingTools'
    | 'sendStage'
    | 'pendingFinal'
    | 'lastUserMessageAt'
    | 'pendingToolImages'
    | 'thinkingLevel'
  >,
): SessionViewSnapshot {
  return cloneSessionViewSnapshot({
    messages: state.messages,
    loading: state.loading,
    error: state.error,
    sending: state.sending,
    activeRunId: state.activeRunId,
    streamingText: state.streamingText,
    streamingMessage: state.streamingMessage,
    streamingTools: state.streamingTools,
    sendStage: state.sendStage,
    pendingFinal: state.pendingFinal,
    lastUserMessageAt: state.lastUserMessageAt,
    pendingToolImages: state.pendingToolImages,
    thinkingLevel: state.thinkingLevel,
  });
}

function cacheSessionView(
  state: Pick<
    ChatState,
    | 'currentSessionKey'
    | 'messages'
    | 'loading'
    | 'error'
    | 'sending'
    | 'activeRunId'
    | 'streamingText'
    | 'streamingMessage'
    | 'streamingTools'
    | 'sendStage'
    | 'pendingFinal'
    | 'lastUserMessageAt'
    | 'pendingToolImages'
    | 'thinkingLevel'
  >,
): void {
  _sessionViewSnapshots.set(state.currentSessionKey, buildSessionViewSnapshot(state));
}

function clearSessionView(sessionKey: string): void {
  _sessionViewSnapshots.delete(sessionKey);
}

function restoreSessionView(sessionKey: string): SessionViewSnapshot {
  const snapshot = _sessionViewSnapshots.get(sessionKey);
  return cloneSessionViewSnapshot(snapshot ?? EMPTY_SESSION_VIEW_SNAPSHOT);
}

function cancelPendingDeltaFlush(): void {
  if (pendingDeltaFlushHandle) {
    clearTimeout(pendingDeltaFlushHandle);
    pendingDeltaFlushHandle = null;
  }
}

function resetPendingDeltaState(): void {
  pendingDeltaMessage = null;
  pendingDeltaUpdates = [];
  pendingDeltaClearError = false;
}

function clearPendingFinalRecoveryTimer(): void {
  if (pendingFinalRecoveryHandle) {
    clearTimeout(pendingFinalRecoveryHandle);
    pendingFinalRecoveryHandle = null;
  }
}

function mergePendingDeltaUpdates(updates: ToolStatus[]): void {
  if (updates.length === 0) return;
  const merged = new Map<string, ToolStatus>();

  for (const update of pendingDeltaUpdates) {
    merged.set(update.toolCallId || update.id || update.name, update);
  }

  for (const update of updates) {
    merged.set(update.toolCallId || update.id || update.name, update);
  }

  pendingDeltaUpdates = Array.from(merged.values());
}

function flushPendingDelta(set: ChatStoreSet): void {
  if (!pendingDeltaMessage && pendingDeltaUpdates.length === 0 && !pendingDeltaClearError) {
    return;
  }

  const nextMessage = pendingDeltaMessage;
  const nextUpdates = pendingDeltaUpdates;
  const shouldClearError = pendingDeltaClearError;

  cancelPendingDeltaFlush();
  resetPendingDeltaState();

  set((state) => ({
    error: shouldClearError ? null : state.error,
    streamingMessage: (() => {
      if (nextMessage && typeof nextMessage === 'object') {
        const msgRole = nextMessage.role;
        if (isToolResultRole(msgRole)) return state.streamingMessage;
        if (state.streamingMessage && nextMessage.content === undefined) {
          return state.streamingMessage;
        }
      }
      return nextMessage ?? state.streamingMessage;
    })(),
    streamingTools: nextUpdates.length > 0
      ? upsertToolStatuses(state.streamingTools, nextUpdates)
      : state.streamingTools,
  }));
}

function scheduleDeltaFlush(set: ChatStoreSet): void {
  if (pendingDeltaFlushHandle) return;
  pendingDeltaFlushHandle = setTimeout(() => {
    flushPendingDelta(set);
  }, STREAM_DELTA_FLUSH_MS);
}

function startHistoryPoll(get: () => ChatState, sessionKey: string): void {
  clearHistoryPoll();
  clearHistoryIncompleteRetry(sessionKey);

  const pollHistory = () => {
    const state = get();
    if (state.currentSessionKey !== sessionKey || !state.sending) {
      clearHistoryPoll();
      return;
    }
    const hasRecentChatActivity = Date.now() - _lastChatEventAt < HISTORY_POLL_SILENCE_WINDOW_MS;
    if (state.streamingMessage && hasRecentChatActivity) {
      _historyPollTimer = setTimeout(pollHistory, HISTORY_POLL_INTERVAL_MS);
      return;
    }
    if (hasRecentChatActivity) {
      _historyPollTimer = setTimeout(pollHistory, HISTORY_POLL_INTERVAL_MS);
      return;
    }
    void state.loadHistory(true);
    _historyPollTimer = setTimeout(pollHistory, HISTORY_POLL_INTERVAL_MS);
  };

  _historyPollTimer = setTimeout(pollHistory, HISTORY_POLL_START_DELAY_MS);
}

function scheduleHistoryIncompleteRetry(get: () => ChatState, sessionKey: string): void {
  if (_historyIncompleteRetryTimers.has(sessionKey)) return;

  const attempts = _historyIncompleteRetryAttempts.get(sessionKey) ?? 0;
  if (attempts >= HISTORY_INCOMPLETE_RETRY_LIMIT) return;

  _historyIncompleteRetryAttempts.set(sessionKey, attempts + 1);
  const timer = setTimeout(() => {
    _historyIncompleteRetryTimers.delete(sessionKey);
    const state = get();
    if (state.currentSessionKey !== sessionKey || state.sending) return;
    void state.loadHistory(true);
  }, HISTORY_INCOMPLETE_RETRY_DELAY_MS);

  _historyIncompleteRetryTimers.set(sessionKey, timer);
}

function pruneChatEventDedupe(now: number): void {
  for (const [key, ts] of _chatEventDedupe.entries()) {
    if (now - ts > CHAT_EVENT_DEDUPE_TTL_MS) {
      _chatEventDedupe.delete(key);
    }
  }
}

function buildChatEventDedupeKey(eventState: string, event: Record<string, unknown>): string | null {
  const msg = (event.message && typeof event.message === 'object')
    ? event.message as Record<string, unknown>
    : null;
  if (msg) {
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
      return `msg|${messageId}|${String(stopReason ?? '')}|${role}|${contentKey}|${eventState}`;
    }
  }

  const runId = event.runId != null ? String(event.runId) : '';
  const sessionKey = event.sessionKey != null ? String(event.sessionKey) : '';
  const seq = event.seq != null ? String(event.seq) : '';
  if (runId || sessionKey || seq || eventState) {
    return [runId, sessionKey, seq, eventState].join('|');
  }
  return null;
}

function isDuplicateChatEvent(eventState: string, event: Record<string, unknown>): boolean {
  const key = buildChatEventDedupeKey(eventState, event);
  if (!key) return false;
  const now = Date.now();
  pruneChatEventDedupe(now);
  if (_chatEventDedupe.has(key)) {
    return true;
  }
  _chatEventDedupe.set(key, now);
  return false;
}

function buildMessageContentKey(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return JSON.stringify(content);
  return '';
}

function isEquivalentRecentAssistantMessage(
  messages: RawMessage[],
  candidate: RawMessage,
): boolean {
  const candidateRole = candidate.role || 'assistant';
  const candidateContentKey = buildMessageContentKey(candidate.content);
  if (!candidateContentKey) return false;

  return messages.slice(-3).some((message) => {
    const role = message.role || 'assistant';
    if (role !== candidateRole) return false;
    return buildMessageContentKey(message.content) === candidateContentKey;
  });
}

function schedulePendingFinalRecovery(
  set: ChatStoreSet,
  get: () => ChatState,
  options?: { delayMs?: number },
): void {
  clearPendingFinalRecoveryTimer();
  const sessionKey = get().currentSessionKey;
  const delayMs = Math.max(100, Math.floor(options?.delayMs ?? PENDING_FINAL_RECOVERY_DELAY_MS));

  pendingFinalRecoveryHandle = setTimeout(() => {
    pendingFinalRecoveryHandle = null;
    const state = get();
    if (state.currentSessionKey !== sessionKey || !state.pendingFinal) return;

    void state.loadHistory(true).finally(() => {
      const latest = get();
      if (latest.currentSessionKey !== sessionKey || !latest.pendingFinal) return;

      set((s) => {
        const streamingAssistant = s.streamingMessage && typeof s.streamingMessage === 'object'
          ? s.streamingMessage as RawMessage
          : null;
        const canPromoteStreamingAssistant = !!streamingAssistant
          && (streamingAssistant.role === 'assistant' || streamingAssistant.role === undefined)
          && !isToolResultRole(streamingAssistant.role)
          && hasNonToolAssistantContent(streamingAssistant)
          && !isInternalAssistantControlMessage(streamingAssistant);
        const pendingImgs = s.pendingToolImages;
        const streamingSnapshot = canPromoteStreamingAssistant
          ? {
              ...streamingAssistant,
              role: 'assistant' as const,
              id: streamingAssistant.id || `pending-final-${Date.now()}`,
              _attachedFiles: pendingImgs.length > 0
                ? [...(streamingAssistant._attachedFiles || []), ...pendingImgs]
                : streamingAssistant._attachedFiles,
            }
          : null;
        const shouldAppendStreamingSnapshot = !!streamingSnapshot
          && !s.messages.some((message) => (
            (streamingSnapshot.id && message.id === streamingSnapshot.id)
            || buildMessageContentKey(message.content) === buildMessageContentKey(streamingSnapshot.content)
          ));

        return {
          messages: shouldAppendStreamingSnapshot
            ? [...s.messages, streamingSnapshot!]
            : s.messages,
          sending: false,
          activeRunId: null,
          sendStage: null,
          pendingFinal: false,
          lastUserMessageAt: null,
          streamingText: '',
          streamingMessage: null,
          streamingTools: [],
          pendingToolImages: [],
          sessionRunningState: updateSessionRunningState(s.sessionRunningState, sessionKey, false),
          error: shouldAppendStreamingSnapshot || canPromoteStreamingAssistant
            ? s.error
            : (s.error || '最终回复还没有成功到达，但你可以继续当前对话。'),
        };
      });
    });
  }, delayMs);
}

function finalizeStreamingAssistantIfStale(set: ChatStoreSet, get: () => ChatState): boolean {
  const state = get();
  const currentStreaming = state.streamingMessage;
  if (!currentStreaming || typeof currentStreaming !== 'object') return false;

  const streamingAssistant = currentStreaming as RawMessage;
  if (isToolResultRole(streamingAssistant.role)) return false;
  if (!(streamingAssistant.role === 'assistant' || streamingAssistant.role === undefined)) return false;
  if (!hasNonToolAssistantContent(streamingAssistant)) return false;

  const msgId = streamingAssistant.id || `stale-stream-${Date.now()}`;
  set((s) => {
    const alreadyExists = s.messages.some((message) => message.id === msgId);
    const msgWithImages: RawMessage = s.pendingToolImages.length > 0
      ? {
          ...streamingAssistant,
          role: 'assistant',
          id: msgId,
          _attachedFiles: [...(streamingAssistant._attachedFiles || []), ...s.pendingToolImages],
        }
      : {
          ...streamingAssistant,
          role: 'assistant',
          id: msgId,
        };
    return {
      messages: alreadyExists ? s.messages : [...s.messages, msgWithImages],
      sending: false,
      activeRunId: null,
      streamingText: '',
      streamingMessage: null,
      streamingTools: [],
      pendingFinal: false,
      lastUserMessageAt: null,
      pendingToolImages: [],
      sessionRunningState: updateSessionRunningState(s.sessionRunningState, state.currentSessionKey, false),
    };
  });
  return true;
}

// ── Local image cache ─────────────────────────────────────────
// The Gateway doesn't store image attachments in session content blocks,
// so we cache them locally keyed by staged file path (which appears in the
// [media attached: <path> ...] reference in the Gateway's user message text).
// Keying by path avoids the race condition of keying by runId (which is only
// available after the RPC returns, but history may load before that).
const IMAGE_CACHE_KEY = 'clawx:image-cache';
const IMAGE_CACHE_MAX = 100; // max entries to prevent unbounded growth

function loadImageCache(): Map<string, AttachedFileMeta> {
  try {
    const raw = localStorage.getItem(IMAGE_CACHE_KEY);
    if (raw) {
      const entries = JSON.parse(raw) as Array<[string, AttachedFileMeta]>;
      return new Map(entries);
    }
  } catch { /* ignore parse errors */ }
  return new Map();
}

function saveImageCache(cache: Map<string, AttachedFileMeta>): void {
  try {
    // Evict oldest entries if over limit
    const entries = Array.from(cache.entries());
    const trimmed = entries.length > IMAGE_CACHE_MAX
      ? entries.slice(entries.length - IMAGE_CACHE_MAX)
      : entries;
    localStorage.setItem(IMAGE_CACHE_KEY, JSON.stringify(trimmed));
  } catch { /* ignore quota errors */ }
}

const _imageCache = loadImageCache();

function isPreCompactionMemoryFlushPrompt(text: string): boolean {
  const normalized = text.trim();
  return /^Pre-compaction memory flush\./i.test(normalized)
    && /Store durable memories only in memory\//i.test(normalized)
    && /reply with NO_REPLY\./i.test(normalized);
}

/** Extract plain text from message content (string or content blocks) */
function getMessageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return (content as Array<{ type?: string; text?: string }>)
      .filter(b => b.type === 'text' && b.text)
      .map(b => b.text!)
      .join('\n');
  }
  return '';
}

function cleanUserMessageText(text: string): string {
  const cleaned = stripInjectedInboundPrelude(text
    .replace(/\s*\[media attached:[^\]]*\]/g, '')
    .replace(/\s*\[message_id:\s*[^\]]+\]/g, ''))
    .trim();

  return isPreCompactionMemoryFlushPrompt(cleaned) ? '' : cleaned;
}

function getSessionLabelText(content: unknown): string {
  return cleanUserMessageText(getMessageText(content));
}

function getComparableMessageText(
  message: Pick<RawMessage, 'role' | 'content'> | null | undefined,
): string {
  if (!message) return '';
  const rawText = getMessageText(message.content);
  const comparableText = message.role === 'user'
    ? cleanUserMessageText(rawText)
    : rawText;
  return comparableText.trim();
}

function translateChat(key: string, defaultValue: string, options?: Record<string, unknown>): string {
  return i18n.t(`chat:${key}`, {
    defaultValue,
    ...options,
  });
}

function localizeChatErrorDetail(error?: string): string | null {
  const detail = typeof error === 'string' ? error.trim() : '';
  if (!detail) return null;

  let normalizedDetail = detail;
  while (/^Error:\s*/i.test(normalizedDetail)) {
    normalizedDetail = normalizedDetail.replace(/^Error:\s*/i, '').trim();
  }
  if (!normalizedDetail || normalizedDetail === 'Failed to send message') {
    return null;
  }

  const appError = normalizeAppError(new Error(normalizedDetail));
  switch (appError.code) {
    case 'AUTH_INVALID':
      return translateChat(
        'sessionErrorDetails.authInvalid',
        'Authentication failed. Check API key or login status and try again.',
      );
    case 'TIMEOUT':
      return translateChat(
        'sessionErrorDetails.timeout',
        'Request timed out. Please try again.',
      );
    case 'RATE_LIMIT':
      return translateChat(
        'sessionErrorDetails.rateLimit',
        'Too many requests. Please wait and try again.',
      );
    case 'PERMISSION':
      return translateChat(
        'sessionErrorDetails.permission',
        'Permission denied. Check your configuration and try again.',
      );
    case 'CHANNEL_UNAVAILABLE':
      return translateChat(
        'sessionErrorDetails.channelUnavailable',
        'Service channel unavailable. Restart the app or gateway and try again.',
      );
    case 'NETWORK':
      return translateChat(
        'sessionErrorDetails.network',
        'Network error. Please verify connectivity and try again.',
      );
    case 'CONFIG':
      return translateChat(
        'sessionErrorDetails.config',
        'Configuration is invalid. Please review your settings and try again.',
      );
    case 'GATEWAY':
      if (/not connected/i.test(normalizedDetail)) {
        return translateChat(
          'sessionErrorDetails.gatewayNotConnected',
          'Gateway not connected.',
        );
      }
      return translateChat(
        'sessionErrorDetails.gatewayUnavailable',
        'Gateway error. Please restart the gateway and try again.',
      );
    default:
      return normalizedDetail;
  }
}

function getSendFailedError(error?: string): string {
  const detail = localizeChatErrorDetail(error) || '';
  if (!detail || detail === 'Failed to send message') {
    return translateChat(
      'sessionErrors.sendFailed',
      'Failed to send message. Please check the provider or gateway status and try again.',
    );
  }
  return translateChat(
    'sessionErrors.sendFailedWithDetail',
    'Failed to send message: {{error}}',
    { error: detail },
  );
}

function getNoResponseError(): string {
  return translateChat(
    'sessionErrors.noResponse',
    'No response received from the model. The provider may be unavailable or the API key may have insufficient quota. Please check your provider settings.',
  );
}

function getEmptyAssistantResponseError(): string {
  return translateChat(
    'sessionErrors.emptyAssistantResponse',
    'The selected provider returned an empty response. Check the provider base URL, API protocol, model, and API key.',
  );
}

const EMPTY_ASSISTANT_RESPONSE_ERROR = getEmptyAssistantResponseError();

function createLocalAssistantMessage(
  content: string,
  options?: { isError?: boolean; idPrefix?: string; timestampMs?: number },
): RawMessage {
  const timestampMs = options?.timestampMs ?? Date.now();
  return {
    id: `${options?.idPrefix || (options?.isError ? 'local-error' : 'local-message')}-${timestampMs}`,
    role: 'assistant',
    content,
    timestamp: timestampMs / 1000,
    isError: options?.isError === true,
  };
}

function appendAssistantMessage(messages: RawMessage[], nextMessage: RawMessage): RawMessage[] {
  const nextText = getMessageText(nextMessage.content).trim();
  if (!nextText) return messages;
  const hasDuplicate = messages.slice(-3).some((message) => (
    message.role === nextMessage.role
    && !!message.isError === !!nextMessage.isError
    && getMessageText(message.content).trim() === nextText
  ));
  return hasDuplicate ? messages : [...messages, nextMessage];
}

/** Extract media file refs from [media attached: <path> (<mime>) | ...] patterns */
function extractMediaRefs(text: string): Array<{ filePath: string; mimeType: string }> {
  const refs: Array<{ filePath: string; mimeType: string }> = [];
  const regex = /\[media attached:\s*([^\s(]+)\s*\(([^)]+)\)\s*\|[^\]]*\]/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    refs.push({ filePath: match[1], mimeType: match[2] });
  }
  return refs;
}

/** Map common file extensions to MIME types */
function mimeFromExtension(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    // Images
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'bmp': 'image/bmp',
    'avif': 'image/avif',
    'svg': 'image/svg+xml',
    // Documents
    'pdf': 'application/pdf',
    'doc': 'application/msword',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'xls': 'application/vnd.ms-excel',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'ppt': 'application/vnd.ms-powerpoint',
    'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'txt': 'text/plain',
    'csv': 'text/csv',
    'md': 'text/markdown',
    'rtf': 'application/rtf',
    'epub': 'application/epub+zip',
    // Archives
    'zip': 'application/zip',
    'tar': 'application/x-tar',
    'gz': 'application/gzip',
    'rar': 'application/vnd.rar',
    '7z': 'application/x-7z-compressed',
    // Audio
    'mp3': 'audio/mpeg',
    'wav': 'audio/wav',
    'ogg': 'audio/ogg',
    'aac': 'audio/aac',
    'flac': 'audio/flac',
    'm4a': 'audio/mp4',
    // Video
    'mp4': 'video/mp4',
    'mov': 'video/quicktime',
    'avi': 'video/x-msvideo',
    'mkv': 'video/x-matroska',
    'webm': 'video/webm',
    'm4v': 'video/mp4',
  };
  return map[ext] || 'application/octet-stream';
}

/**
 * Extract raw file paths from message text.
 * Detects absolute paths (Unix: / or ~/, Windows: C:\ etc.) ending with common file extensions.
 * Handles both image and non-image files, consistent with channel push message behavior.
 */
function extractRawFilePaths(text: string): Array<{ filePath: string; mimeType: string }> {
  const refs: Array<{ filePath: string; mimeType: string }> = [];
  const seen = new Set<string>();
  const exts = 'png|jpe?g|gif|webp|bmp|avif|svg|pdf|docx?|xlsx?|pptx?|txt|csv|md|rtf|epub|zip|tar|gz|rar|7z|mp3|wav|ogg|aac|flac|m4a|mp4|mov|avi|mkv|webm|m4v';
  // Unix absolute paths (/... or ~/...) — lookbehind rejects mid-token slashes
  // (e.g. "path/to/file.mp4", "https://example.com/file.mp4")
  const unixRegex = new RegExp(`(?<![\\w./:])((?:\\/|~\\/)[^\\s\\n"'()\\[\\],<>]*?\\.(?:${exts}))`, 'gi');
  // Windows absolute paths (C:\... D:\...) — lookbehind rejects drive letter glued to a word
  const winRegex = new RegExp(`(?<![\\w])([A-Za-z]:\\\\[^\\s\\n"'()\\[\\],<>]*?\\.(?:${exts}))`, 'gi');
  for (const regex of [unixRegex, winRegex]) {
    let match;
    while ((match = regex.exec(text)) !== null) {
      const p = match[1];
      if (p && !seen.has(p)) {
        seen.add(p);
        refs.push({ filePath: p, mimeType: mimeFromExtension(p) });
      }
    }
  }
  return refs;
}

/**
 * Extract images from a content array (including nested tool_result content).
 * Converts them to AttachedFileMeta entries with preview set to data URL or remote URL.
 */
function extractImagesAsAttachedFiles(content: unknown): AttachedFileMeta[] {
  if (!Array.isArray(content)) return [];
  const files: AttachedFileMeta[] = [];

  for (const block of content as ContentBlock[]) {
    if (block.type === 'image') {
      // Path 1: Anthropic source-wrapped format {source: {type, media_type, data}}
      if (block.source) {
        const src = block.source;
        const mimeType = src.media_type || 'image/jpeg';

        if (src.type === 'base64' && src.data) {
          files.push({
            fileName: 'image',
            mimeType,
            fileSize: 0,
            preview: `data:${mimeType};base64,${src.data}`,
          });
        } else if (src.type === 'url' && src.url) {
          files.push({
            fileName: 'image',
            mimeType,
            fileSize: 0,
            preview: src.url,
          });
        }
      }
      // Path 2: Flat format from Gateway tool results {data, mimeType}
      else if (block.data) {
        const mimeType = block.mimeType || 'image/jpeg';
        files.push({
          fileName: 'image',
          mimeType,
          fileSize: 0,
          preview: `data:${mimeType};base64,${block.data}`,
        });
      }
    }
    // Recurse into tool_result content blocks
    if ((block.type === 'tool_result' || block.type === 'toolResult') && block.content) {
      files.push(...extractImagesAsAttachedFiles(block.content));
    }
  }
  return files;
}

/**
 * Build an AttachedFileMeta entry for a file ref, using cache if available.
 */
function makeAttachedFile(ref: { filePath: string; mimeType: string }): AttachedFileMeta {
  const cached = _imageCache.get(ref.filePath);
  if (cached) return { ...cached, filePath: ref.filePath };
  const fileName = ref.filePath.split(/[\\/]/).pop() || 'file';
  return { fileName, mimeType: ref.mimeType, fileSize: 0, preview: null, filePath: ref.filePath };
}

/**
 * Extract file path from a tool call's arguments by toolCallId.
 * Searches common argument names: file_path, filePath, path, file.
 */
function getToolCallFilePath(msg: RawMessage, toolCallId: string): string | undefined {
  if (!toolCallId) return undefined;

  // Anthropic/normalized format — toolCall blocks in content array
  const content = msg.content;
  if (Array.isArray(content)) {
    for (const block of content as ContentBlock[]) {
      if ((block.type === 'tool_use' || block.type === 'toolCall') && block.id === toolCallId) {
        const args = (block.input ?? block.arguments) as Record<string, unknown> | undefined;
        if (args) {
          const fp = args.file_path ?? args.filePath ?? args.path ?? args.file;
          if (typeof fp === 'string') return fp;
        }
      }
    }
  }

  // OpenAI format — tool_calls array on the message itself
  const msgAny = msg as unknown as Record<string, unknown>;
  const toolCalls = msgAny.tool_calls ?? msgAny.toolCalls;
  if (Array.isArray(toolCalls)) {
    for (const tc of toolCalls as Array<Record<string, unknown>>) {
      if (tc.id !== toolCallId) continue;
      const fn = (tc.function ?? tc) as Record<string, unknown>;
      let args: Record<string, unknown> | undefined;
      try {
        args = typeof fn.arguments === 'string' ? JSON.parse(fn.arguments) : (fn.arguments ?? fn.input) as Record<string, unknown>;
      } catch { /* ignore */ }
      if (args) {
        const fp = args.file_path ?? args.filePath ?? args.path ?? args.file;
        if (typeof fp === 'string') return fp;
      }
    }
  }

  return undefined;
}

/**
 * Collect all tool call file paths from a message into a Map<toolCallId, filePath>.
 */
function collectToolCallPaths(msg: RawMessage, paths: Map<string, string>): void {
  const content = msg.content;
  if (Array.isArray(content)) {
    for (const block of content as ContentBlock[]) {
      if ((block.type === 'tool_use' || block.type === 'toolCall') && block.id) {
        const args = (block.input ?? block.arguments) as Record<string, unknown> | undefined;
        if (args) {
          const fp = args.file_path ?? args.filePath ?? args.path ?? args.file;
          if (typeof fp === 'string') paths.set(block.id, fp);
        }
      }
    }
  }
  const msgAny = msg as unknown as Record<string, unknown>;
  const toolCalls = msgAny.tool_calls ?? msgAny.toolCalls;
  if (Array.isArray(toolCalls)) {
    for (const tc of toolCalls as Array<Record<string, unknown>>) {
      const id = typeof tc.id === 'string' ? tc.id : '';
      if (!id) continue;
      const fn = (tc.function ?? tc) as Record<string, unknown>;
      let args: Record<string, unknown> | undefined;
      try {
        args = typeof fn.arguments === 'string' ? JSON.parse(fn.arguments) : (fn.arguments ?? fn.input) as Record<string, unknown>;
      } catch { /* ignore */ }
      if (args) {
        const fp = args.file_path ?? args.filePath ?? args.path ?? args.file;
        if (typeof fp === 'string') paths.set(id, fp);
      }
    }
  }
}

/**
 * Before filtering tool_result messages from history, scan them for any file/image
 * content and attach those to the immediately following assistant message.
 * This mirrors channel push message behavior where tool outputs surface files to the UI.
 * Handles:
 *   - Image content blocks (base64 / url)
 *   - [media attached: path (mime) | path] text patterns in tool result output
 *   - Raw file paths in tool result text
 */
function enrichWithToolResultFiles(messages: RawMessage[]): RawMessage[] {
  const pending: AttachedFileMeta[] = [];
  const toolCallPaths = new Map<string, string>();

  return messages.map((msg) => {
    // Track file paths from assistant tool call arguments for later matching
    if (msg.role === 'assistant') {
      collectToolCallPaths(msg, toolCallPaths);
    }

    if (isToolResultRole(msg.role)) {
      // Resolve file path from the matching tool call
      const matchedPath = msg.toolCallId ? toolCallPaths.get(msg.toolCallId) : undefined;

      // 1. Image/file content blocks in the structured content array
      const imageFiles = extractImagesAsAttachedFiles(msg.content);
      if (matchedPath) {
        for (const f of imageFiles) {
          if (!f.filePath) {
            f.filePath = matchedPath;
            f.fileName = matchedPath.split(/[\\/]/).pop() || 'image';
          }
        }
      }
      pending.push(...imageFiles);

      // 2. [media attached: ...] patterns in tool result text output
      const text = getMessageText(msg.content);
      if (text) {
        const mediaRefs = extractMediaRefs(text);
        const mediaRefPaths = new Set(mediaRefs.map(r => r.filePath));
        for (const ref of mediaRefs) {
          pending.push(makeAttachedFile(ref));
        }
        // 3. Raw file paths in tool result text (documents, audio, video, etc.)
        for (const ref of extractRawFilePaths(text)) {
          if (!mediaRefPaths.has(ref.filePath)) {
            pending.push(makeAttachedFile(ref));
          }
        }
      }

      return msg; // will be filtered later
    }

    if (msg.role === 'assistant' && pending.length > 0) {
      const toAttach = pending.splice(0);
      // Deduplicate against files already on the assistant message
      const existingPaths = new Set(
        (msg._attachedFiles || []).map(f => f.filePath).filter(Boolean),
      );
      const newFiles = toAttach.filter(f => !f.filePath || !existingPaths.has(f.filePath));
      if (newFiles.length === 0) return msg;
      return {
        ...msg,
        _attachedFiles: [...(msg._attachedFiles || []), ...newFiles],
      };
    }

    return msg;
  });
}

/**
 * Restore _attachedFiles for messages loaded from history.
 * Handles:
 *   1. [media attached: path (mime) | path] patterns (attachment-button flow)
 *   2. Raw image file paths typed in message text (e.g. /Users/.../image.png)
 * Uses local cache for previews when available; missing previews are loaded async.
 */
function enrichWithCachedImages(messages: RawMessage[]): RawMessage[] {
  return messages.map((msg, idx) => {
    // Only process user and assistant messages; skip if already enriched
    if ((msg.role !== 'user' && msg.role !== 'assistant') || msg._attachedFiles) return msg;
    const text = getMessageText(msg.content);

    // Path 1: [media attached: path (mime) | path] — guaranteed format from attachment button
    const mediaRefs = extractMediaRefs(text);
    const mediaRefPaths = new Set(mediaRefs.map(r => r.filePath));

    // Path 2: Raw file paths.
    // For assistant messages: scan own text AND the nearest preceding user message text,
    // but only for non-tool-only assistant messages (i.e. the final answer turn).
    // Tool-only messages (thinking + tool calls) should not show file previews — those
    // belong to the final answer message that comes after the tool results.
    // User messages never get raw-path previews so the image is not shown twice.
    let rawRefs: Array<{ filePath: string; mimeType: string }> = [];
    if (msg.role === 'assistant' && !isToolOnlyMessage(msg)) {
      // Own text
      rawRefs = extractRawFilePaths(text).filter(r => !mediaRefPaths.has(r.filePath));

      // Nearest preceding user message text (look back up to 5 messages)
      const seenPaths = new Set(rawRefs.map(r => r.filePath));
      for (let i = idx - 1; i >= Math.max(0, idx - 5); i--) {
        const prev = messages[i];
        if (!prev) break;
        if (prev.role === 'user') {
          const prevText = getMessageText(prev.content);
          for (const ref of extractRawFilePaths(prevText)) {
            if (!mediaRefPaths.has(ref.filePath) && !seenPaths.has(ref.filePath)) {
              seenPaths.add(ref.filePath);
              rawRefs.push(ref);
            }
          }
          break; // only use the nearest user message
        }
      }
    }

    const allRefs = [...mediaRefs, ...rawRefs];
    if (allRefs.length === 0) return msg;

    const files: AttachedFileMeta[] = allRefs.map(ref => {
      const cached = _imageCache.get(ref.filePath);
      if (cached) return { ...cached, filePath: ref.filePath };
      const fileName = ref.filePath.split(/[\\/]/).pop() || 'file';
      return { fileName, mimeType: ref.mimeType, fileSize: 0, preview: null, filePath: ref.filePath };
    });
    return { ...msg, _attachedFiles: files };
  });
}

async function materializeAssistantOutputs(
  messages: RawMessage[],
  sessionKey?: string,
): Promise<boolean> {
  const normalizedSessionKey = typeof sessionKey === 'string' ? sessionKey.trim() : '';
  if (!normalizedSessionKey) return false;

  const filePaths = Array.from(new Set(
    messages
      .filter((message) => message.role === 'assistant')
      .flatMap((message) => (message._attachedFiles || []).map((file) => file.filePath).filter(Boolean) as string[]),
  ));

  if (filePaths.length === 0) return false;

  try {
    const response = await hostApiFetch<{
      success: boolean;
      enabled?: boolean;
      results?: Array<{
        sourcePath: string;
        materializedPath: string;
        fileName: string;
        fileSize: number;
      }>;
    }>('/api/files/materialize-outputs', {
      method: 'POST',
      body: JSON.stringify({
        sessionKey: normalizedSessionKey,
        filePaths,
      }),
    });

    if (!response.success || response.enabled === false || !Array.isArray(response.results) || response.results.length === 0) {
      return false;
    }

    const resultMap = new Map(response.results.map((entry) => [entry.sourcePath, entry]));
    let updated = false;
    for (const message of messages) {
      if (message.role !== 'assistant' || !message._attachedFiles) continue;
      for (const file of message._attachedFiles) {
        const sourcePath = file.filePath;
        if (!sourcePath) continue;
        const materialized = resultMap.get(sourcePath);
        if (!materialized) continue;
        if (file.filePath !== materialized.materializedPath) {
          file.filePath = materialized.materializedPath;
          file.fileName = materialized.fileName;
          file.fileSize = materialized.fileSize;
          updated = true;
        } else if (materialized.fileSize > 0 && file.fileSize !== materialized.fileSize) {
          file.fileSize = materialized.fileSize;
          updated = true;
        }
      }
    }

    return updated;
  } catch (error) {
    console.warn('[materializeAssistantOutputs] Failed:', error);
    return false;
  }
}

/**
 * Async: load missing previews from disk via IPC for messages that have
 * _attachedFiles with null previews. Updates messages in-place and triggers re-render.
 * Handles both [media attached: ...] patterns and raw filePath entries.
 */
async function loadMissingPreviews(messages: RawMessage[], sessionKey?: string): Promise<boolean> {
  const materialized = await materializeAssistantOutputs(messages, sessionKey);
  // Collect all image paths that need previews
  const needPreview: Array<{ filePath: string; mimeType: string }> = [];
  const seenPaths = new Set<string>();

  for (const msg of messages) {
    if (!msg._attachedFiles) continue;

    // Path 1: files with explicit filePath field (raw path detection or enriched refs)
    for (const file of msg._attachedFiles) {
      const fp = file.filePath;
      if (!fp || seenPaths.has(fp)) continue;
      // Images: need preview. Non-images: need file size (for FileCard display).
      const needsLoad = file.mimeType.startsWith('image/')
        ? !file.preview
        : file.fileSize === 0;
      if (needsLoad) {
        seenPaths.add(fp);
        needPreview.push({ filePath: fp, mimeType: file.mimeType });
      }
    }

    // Path 2: [media attached: ...] patterns (legacy — in case filePath wasn't stored)
    if (msg.role === 'user') {
      const text = getMessageText(msg.content);
      const refs = extractMediaRefs(text);
      for (let i = 0; i < refs.length; i++) {
        const file = msg._attachedFiles[i];
        const ref = refs[i];
        if (!file || !ref || seenPaths.has(ref.filePath)) continue;
        const needsLoad = ref.mimeType.startsWith('image/') ? !file.preview : file.fileSize === 0;
        if (needsLoad) {
          seenPaths.add(ref.filePath);
          needPreview.push(ref);
        }
      }
    }
  }

  if (needPreview.length === 0) return materialized;

  try {
    const thumbnails = await hostApiFetch<Record<string, { preview: string | null; fileSize: number }>>(
      '/api/files/thumbnails',
      {
        method: 'POST',
        body: JSON.stringify({ paths: needPreview }),
      },
    );

    let updated = false;
    for (const msg of messages) {
      if (!msg._attachedFiles) continue;

      // Update files that have filePath
      for (const file of msg._attachedFiles) {
        const fp = file.filePath;
        if (!fp) continue;
        const thumb = thumbnails[fp];
        if (thumb && (thumb.preview || thumb.fileSize)) {
          if (thumb.preview) file.preview = thumb.preview;
          if (thumb.fileSize) file.fileSize = thumb.fileSize;
          _imageCache.set(fp, { ...file });
          updated = true;
        }
      }

      // Legacy: update by index for [media attached: ...] refs
      if (msg.role === 'user') {
        const text = getMessageText(msg.content);
        const refs = extractMediaRefs(text);
        for (let i = 0; i < refs.length; i++) {
          const file = msg._attachedFiles[i];
          const ref = refs[i];
          if (!file || !ref || file.filePath) continue; // skip if already handled via filePath
          const thumb = thumbnails[ref.filePath];
          if (thumb && (thumb.preview || thumb.fileSize)) {
            if (thumb.preview) file.preview = thumb.preview;
            if (thumb.fileSize) file.fileSize = thumb.fileSize;
            _imageCache.set(ref.filePath, { ...file });
            updated = true;
          }
        }
      }
    }
    if (updated) saveImageCache(_imageCache);
    return updated || materialized;
  } catch (err) {
    console.warn('[loadMissingPreviews] Failed:', err);
    return materialized;
  }
}

function getCanonicalPrefixFromSessions(sessions: ChatSession[]): string | null {
  const canonical = sessions.find((s) => s.key.startsWith('agent:'))?.key;
  if (!canonical) return null;
  const parts = canonical.split(':');
  if (parts.length < 2) return null;
  return `${parts[0]}:${parts[1]}`;
}

function getAgentIdFromSessionKey(sessionKey: string): string {
  if (!sessionKey.startsWith('agent:')) return 'main';
  const parts = sessionKey.split(':');
  return parts[1] || 'main';
}

function parseSessionUpdatedAtMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return toMs(value);
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function parseSessionPinned(value: unknown): boolean {
  return value === true;
}

function parseSessionPinOrder(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return undefined;
}

function parseSessionArchived(value: unknown): boolean {
  return value === true;
}

function parseSessionArchivedAt(value: unknown): number | undefined {
  return parseSessionUpdatedAtMs(value);
}

function normalizeSessionModelRef(model: unknown, modelProvider: unknown): string | undefined {
  const normalizedModel = typeof model === 'string' ? model.trim() : '';
  if (!normalizedModel) {
    return undefined;
  }
  if (normalizedModel.includes('/')) {
    return normalizedModel;
  }
  const normalizedProvider = typeof modelProvider === 'string' ? modelProvider.trim() : '';
  if (!normalizedProvider) {
    return normalizedModel;
  }
  return `${normalizedProvider}/${normalizedModel}`;
}

async function loadCronFallbackMessages(sessionKey: string, limit = 200): Promise<RawMessage[]> {
  if (!isCronSessionKey(sessionKey)) return [];
  try {
    const response = await hostApiFetch<{ messages?: RawMessage[] }>(
      buildCronSessionHistoryPath(sessionKey, limit),
    );
    return Array.isArray(response.messages) ? response.messages : [];
  } catch (error) {
    console.warn('Failed to load cron fallback history:', error);
    return [];
  }
}

async function loadLocalSessionHistory(
  sessionKey: string,
  limit = 200,
): Promise<{ resolved: boolean; messages: RawMessage[]; thinkingLevel: string | null }> {
  try {
    const response = await hostApiFetch<{
      success?: boolean;
      resolved?: boolean;
      messages?: RawMessage[];
      thinkingLevel?: string | null;
    }>('/api/sessions/history', {
      method: 'POST',
      body: JSON.stringify({ sessionKey, limit }),
    });

    return {
      resolved: response?.resolved === true,
      messages: Array.isArray(response?.messages) ? response.messages : [],
      thinkingLevel: typeof response?.thinkingLevel === 'string' ? response.thinkingLevel : null,
    };
  } catch (error) {
    console.warn('Failed to load local session history:', error);
    return {
      resolved: false,
      messages: [],
      thinkingLevel: null,
    };
  }
}

function normalizeAgentId(value: string | undefined | null): string {
  return (value ?? '').trim().toLowerCase() || 'main';
}

function resolveDefaultCanonicalPrefix(): string {
  const defaultAgentId = normalizeAgentId(useAgentsStore.getState().defaultAgentId);
  return `agent:${defaultAgentId}`;
}

function buildFallbackMainSessionKey(agentId: string): string {
  return `agent:${normalizeAgentId(agentId)}:main`;
}

function resolveSessionModelSnapshot(): string {
  const { defaultModelRef } = useAgentsStore.getState();
  return (defaultModelRef || '').trim();
}

function resolveSessionPreferredModel(sessionKey: string, modelRefOverride?: string | null): string | null {
  const explicitModelRef = (modelRefOverride || '').trim();
  if (explicitModelRef) {
    return explicitModelRef;
  }

  const chatState = useChatStore.getState();
  const sessionModel = chatState.sessionModels[sessionKey]
    || chatState.sessions.find((session) => session.key === sessionKey)?.model;
  const { defaultModelRef } = useAgentsStore.getState();
  const preferredModel = (sessionModel || defaultModelRef || '').trim();
  return preferredModel || null;
}

function resolveAgentConfiguredModel(agentId: string): string | null {
  const normalizedAgentId = normalizeAgentId(agentId);
  const { agents, defaultModelRef } = useAgentsStore.getState();
  const agentModelRef = agents.find((agent) => agent.id === normalizedAgentId)?.modelRef;
  const resolvedModel = (agentModelRef || defaultModelRef || '').trim();
  return resolvedModel || null;
}

async function ensureSessionPreferredModelLoaded(
  sessionKey: string,
  set: ChatStoreSet,
): Promise<void> {
  const state = useChatStore.getState();
  const storedSessionModel = state.sessionModels[sessionKey]
    || state.sessions.find((session) => session.key === sessionKey)?.model;
  if (storedSessionModel) {
    return;
  }

  const existingDefaultModelRef = (useAgentsStore.getState().defaultModelRef || '').trim();
  if (existingDefaultModelRef) {
    set((currentState) => {
      const latestSessionModel = currentState.sessionModels[sessionKey]
        || currentState.sessions.find((session) => session.key === sessionKey)?.model;
      if (latestSessionModel) {
        return {};
      }
      return {
        sessionModels: {
          ...currentState.sessionModels,
          [sessionKey]: existingDefaultModelRef,
        },
        sessions: currentState.sessions.map((session) => (
          session.key === sessionKey
            ? { ...session, model: existingDefaultModelRef }
            : session
        )),
      };
    });
    return;
  }

  const fetchAgents = useAgentsStore.getState().fetchAgents;
  if (typeof fetchAgents !== 'function') {
    return;
  }

  await fetchAgents();
  const refreshedDefaultModelRef = (useAgentsStore.getState().defaultModelRef || '').trim();
  if (!refreshedDefaultModelRef) {
    return;
  }

  set((currentState) => {
    const latestSessionModel = currentState.sessionModels[sessionKey]
      || currentState.sessions.find((session) => session.key === sessionKey)?.model;
    if (latestSessionModel) {
      return {};
    }
    return {
      sessionModels: {
        ...currentState.sessionModels,
        [sessionKey]: refreshedDefaultModelRef,
      },
      sessions: currentState.sessions.map((session) => (
        session.key === sessionKey
          ? { ...session, model: refreshedDefaultModelRef }
          : session
      )),
    };
  });
}

async function syncSessionPreferredModelToRuntime(
  sessionKey: string,
  modelRefOverride?: string | null,
): Promise<void> {
  const agentId = getAgentIdFromSessionKey(sessionKey);
  const preferredModel = resolveSessionPreferredModel(sessionKey, modelRefOverride);
  if (!agentId || !preferredModel) {
    return;
  }

  const expectedRuntimeModel = _runtimePatchedAgentModels.has(agentId)
    ? (_runtimePatchedAgentModels.get(agentId) || null)
    : resolveAgentConfiguredModel(agentId);
  if (expectedRuntimeModel === preferredModel) {
    return;
  }

  const existingRequest = _runtimeAgentModelSyncInFlight.get(agentId);
  if (existingRequest) {
    await existingRequest;
    const latestRuntimeModel = _runtimePatchedAgentModels.has(agentId)
      ? (_runtimePatchedAgentModels.get(agentId) || null)
      : resolveAgentConfiguredModel(agentId);
    if (latestRuntimeModel === preferredModel) {
      return;
    }
  }

  const request = hostApiFetch<{ success?: boolean; error?: string }>(
    `/api/agents/${encodeURIComponent(agentId)}/model/runtime`,
    {
      method: 'PUT',
      body: JSON.stringify({ modelRef: preferredModel }),
    },
  ).then((result) => {
    if (!result?.success) {
      throw new Error(result?.error || `Failed to switch runtime model for agent "${agentId}"`);
    }
    _runtimePatchedAgentModels.set(agentId, preferredModel);
  }).finally(() => {
    if (_runtimeAgentModelSyncInFlight.get(agentId) === request) {
      _runtimeAgentModelSyncInFlight.delete(agentId);
    }
  });

  _runtimeAgentModelSyncInFlight.set(agentId, request);
  await request;
}

function resolveMainSessionKeyForAgent(agentId: string | undefined | null): string | null {
  if (!agentId) return null;
  const normalizedAgentId = normalizeAgentId(agentId);
  const summary = useAgentsStore.getState().agents.find((agent) => agent.id === normalizedAgentId);
  return summary?.mainSessionKey || buildFallbackMainSessionKey(normalizedAgentId);
}

function ensureSessionEntry(sessions: ChatSession[], sessionKey: string): ChatSession[] {
  if (sessions.some((session) => session.key === sessionKey)) {
    return sessions;
  }
  return [...sessions, { key: sessionKey, displayName: sessionKey }];
}

function buildAgentExecutionMetadataForSession(
  sessionKey: string,
  mode: 'full' | 'model_only' = 'full',
  modelRefOverride?: string | null,
): string | null {
  const agentId = getAgentIdFromSessionKey(sessionKey);
  const agent = useAgentsStore.getState().agents.find((item) => item.id === agentId);
  if (!agent) return null;
  const preferredModel = resolveSessionPreferredModel(sessionKey, modelRefOverride);
  const agentForMetadata = mode === 'model_only'
    ? {
        ...agent,
        description: null,
        objective: null,
        boundaries: null,
        outputContract: null,
        skillIds: [],
        workflowSteps: [],
        workflowNodes: [],
        triggerModes: [],
        modelRef: preferredModel,
      }
    : {
        ...agent,
        modelRef: preferredModel || null,
      };
  return buildAgentExecutionMetadata(agentForMetadata);
}

function injectAgentExecutionMetadata(
  message: string,
  sessionKey: string,
  isFirstUserMessage: boolean,
  modelRefOverride?: string | null,
): string {
  const metadata = isFirstUserMessage
    ? buildAgentExecutionMetadataForSession(sessionKey, 'full', modelRefOverride)
    : buildAgentExecutionMetadataForSession(sessionKey, 'model_only', modelRefOverride);
  if (!metadata) return message;
  return message ? `${metadata}${message}` : metadata;
}

function clearSessionEntryFromMap<T extends Record<string, unknown>>(entries: T, sessionKey: string): T {
  return Object.fromEntries(Object.entries(entries).filter(([key]) => key !== sessionKey)) as T;
}

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
  return clearSessionEntryFromMap(current, sessionKey);
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

function resolveSessionKeyAlias(sessionKey: string, availableSessionKeys: Iterable<string>): string {
  for (const candidate of availableSessionKeys) {
    if (sessionKeysMatch(candidate, sessionKey)) {
      return candidate;
    }
  }
  return sessionKey;
}

function remapSessionEntries<T>(
  entries: Record<string, T> | undefined,
  canonicalBySuffix: Map<string, string>,
  merge?: (existing: T | undefined, next: T) => T,
): Record<string, T> {
  const current = entries ?? {};
  return Object.entries(current).reduce<Record<string, T>>((nextEntries, [key, value]) => {
    const normalizedKey = resolveSessionKeyAlias(key, canonicalBySuffix.values());
    nextEntries[normalizedKey] = merge ? merge(nextEntries[normalizedKey], value) : value;
    return nextEntries;
  }, {});
}

function findLastUserMessageIndex(messages: RawMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      return index;
    }
  }
  return -1;
}

function buildSessionSwitchPatch(
  state: Pick<
    ChatState,
    | 'currentSessionKey'
    | 'messages'
    | 'loading'
    | 'error'
    | 'sending'
    | 'activeRunId'
    | 'streamingText'
    | 'streamingMessage'
    | 'streamingTools'
    | 'sendStage'
    | 'pendingFinal'
    | 'lastUserMessageAt'
    | 'pendingToolImages'
    | 'thinkingLevel'
    | 'sessions'
    | 'composerDrafts'
    | 'sessionLabels'
    | 'sessionLastActivity'
    | 'sessionRunningState'
  >,
  nextSessionKey: string,
): Partial<ChatState> {
  // Only treat sessions with no history records and no activity timestamp as empty.
  // Relying solely on messages.length is unreliable because switchSession clears
  // the current messages before loadHistory runs, creating a race condition that
  // could cause sessions with real history to be incorrectly removed from the sidebar.
  const leavingEmpty = isUnusedDraftSession(state, state.currentSessionKey);

  const nextSessions = leavingEmpty
    ? state.sessions.filter((session) => session.key !== state.currentSessionKey)
    : state.sessions;
  const restoredView = restoreSessionView(nextSessionKey);
  clearHistoryIncompleteRetry(state.currentSessionKey);

  if (leavingEmpty) {
    clearSessionView(state.currentSessionKey);
  } else {
    cacheSessionView({ ...state, sendStage: state.sendStage ?? null });
  }

  const syncedLeavingSessionRunningState = updateSessionRunningState(
    state.sessionRunningState,
    state.currentSessionKey,
    state.sending,
  );
  const syncedNextSessionRunningState = restoredView.sending
    ? updateSessionRunningState(syncedLeavingSessionRunningState, nextSessionKey, true)
    : syncedLeavingSessionRunningState;

  return {
    currentSessionKey: nextSessionKey,
    currentAgentId: getAgentIdFromSessionKey(nextSessionKey),
    sessions: ensureSessionEntry(nextSessions, nextSessionKey),
    composerDrafts: leavingEmpty
      ? clearSessionEntryFromMap(state.composerDrafts, state.currentSessionKey)
      : state.composerDrafts,
    sessionLabels: leavingEmpty
      ? clearSessionEntryFromMap(state.sessionLabels, state.currentSessionKey)
      : state.sessionLabels,
    sessionLastActivity: leavingEmpty
      ? clearSessionEntryFromMap(state.sessionLastActivity, state.currentSessionKey)
      : state.sessionLastActivity,
    sessionRunningState: leavingEmpty
      ? clearSessionEntryFromMap(syncedNextSessionRunningState, state.currentSessionKey)
      : syncedNextSessionRunningState,
    ...restoredView,
  };
}

function getCanonicalPrefixFromSessionKey(sessionKey: string): string | null {
  if (!sessionKey.startsWith('agent:')) return null;
  const parts = sessionKey.split(':');
  if (parts.length < 2) return null;
  return `${parts[0]}:${parts[1]}`;
}

function isToolOnlyMessage(message: RawMessage | undefined): boolean {
  if (!message) return false;
  if (isToolResultRole(message.role)) return true;

  const msg = message as unknown as Record<string, unknown>;
  const content = message.content;

  // Check OpenAI-format tool_calls field (real-time streaming from OpenAI-compatible models)
  const toolCalls = msg.tool_calls ?? msg.toolCalls;
  const hasOpenAITools = Array.isArray(toolCalls) && toolCalls.length > 0;

  if (!Array.isArray(content)) {
    // Content is not an array — check if there's OpenAI-format tool_calls
    if (hasOpenAITools) {
      // Has tool calls but content might be empty/string — treat as tool-only
      // if there's no meaningful text content
      const textContent = typeof content === 'string' ? content.trim() : '';
      return textContent.length === 0;
    }
    return false;
  }

  let hasTool = hasOpenAITools;
  let hasText = false;
  let hasNonToolContent = false;

  for (const block of content as ContentBlock[]) {
    if (block.type === 'tool_use' || block.type === 'tool_result' || block.type === 'toolCall' || block.type === 'toolResult') {
      hasTool = true;
      continue;
    }
    if (block.type === 'text' && block.text && block.text.trim()) {
      hasText = true;
      continue;
    }
    // Only actual image output disqualifies a tool-only message.
    // Thinking blocks are internal reasoning that can accompany tool_use — they
    // should NOT prevent the message from being treated as an intermediate tool step.
    if (block.type === 'image') {
      hasNonToolContent = true;
    }
  }

  return hasTool && !hasText && !hasNonToolContent;
}

function isToolResultRole(role: unknown): boolean {
  if (!role) return false;
  const normalized = String(role).toLowerCase();
  return normalized === 'toolresult' || normalized === 'tool_result';
}

/** True for internal plumbing messages that should never be shown in the UI. */
function isInternalMessage(msg: { role?: unknown; content?: unknown }): boolean {
  if (msg.role === 'system') return true;
  if (msg.role === 'user') {
    const text = getMessageText(msg.content);
    if (isPreCompactionMemoryFlushPrompt(text)) return true;
  }
  if (msg.role === 'assistant') {
    const text = getMessageText(msg.content);
    if (/^(HEARTBEAT_OK|NO_REPLY)\s*$/.test(text)) return true;
  }
  return false;
}

function isInternalAssistantControlMessage(message: RawMessage | null | undefined): boolean {
  if (!message) return false;
  const role = message.role ?? 'assistant';
  if (role !== 'assistant') return false;
  return isInternalMessage({
    ...message,
    role,
  });
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content as ContentBlock[]) {
    if (block.type === 'text' && block.text) {
      parts.push(block.text);
    }
  }
  return parts.join('\n');
}

function summarizeToolOutput(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return undefined;
  const summaryLines = lines.slice(0, 2);
  let summary = summaryLines.join(' / ');
  if (summary.length > 160) {
    summary = `${summary.slice(0, 157)}...`;
  }
  return summary;
}

function normalizeToolStatus(rawStatus: unknown, fallback: 'running' | 'completed'): ToolStatus['status'] {
  const status = typeof rawStatus === 'string' ? rawStatus.toLowerCase() : '';
  if (status.includes('retry')) return 'retrying';
  if (status === 'error' || status === 'failed') return 'error';
  if (status === 'completed' || status === 'success' || status === 'done') return 'completed';
  return fallback;
}

function normalizeToolName(name: string | undefined): string {
  return (name || 'tool').trim() || 'tool';
}

function normalizeToolFailureMessage(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().replace(/^Error:\s*/i, '');
  return normalized || undefined;
}

function parseDurationMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function extractToolUseUpdates(message: unknown): ToolStatus[] {
  if (!message || typeof message !== 'object') return [];
  const msg = message as Record<string, unknown>;
  const updates: ToolStatus[] = [];

  // Path 1: Anthropic/normalized format — tool blocks inside content array
  const content = msg.content;
  if (Array.isArray(content)) {
    for (const block of content as ContentBlock[]) {
      if ((block.type !== 'tool_use' && block.type !== 'toolCall') || !block.name) continue;
      updates.push({
        id: block.id || block.name,
        toolCallId: block.id,
        name: block.name,
        status: 'running',
        updatedAt: Date.now(),
      });
    }
  }

  // Path 2: OpenAI format — tool_calls array on the message itself
  if (updates.length === 0) {
    const toolCalls = msg.tool_calls ?? msg.toolCalls;
    if (Array.isArray(toolCalls)) {
      for (const tc of toolCalls as Array<Record<string, unknown>>) {
        const fn = (tc.function ?? tc) as Record<string, unknown>;
        const name = typeof fn.name === 'string' ? fn.name : '';
        if (!name) continue;
        const id = typeof tc.id === 'string' ? tc.id : name;
        updates.push({
          id,
          toolCallId: typeof tc.id === 'string' ? tc.id : undefined,
          name,
          status: 'running',
          updatedAt: Date.now(),
        });
      }
    }
  }

  return updates;
}

function extractToolResultBlocks(message: unknown, _eventState: string): ToolStatus[] {
  if (!message || typeof message !== 'object') return [];
  const msg = message as Record<string, unknown>;
  const content = msg.content;
  if (!Array.isArray(content)) return [];

  const updates: ToolStatus[] = [];
  for (const block of content as ContentBlock[]) {
    if (block.type !== 'tool_result' && block.type !== 'toolResult') continue;
    const outputText = extractTextFromContent(block.content ?? block.text ?? '');
    const summary = summarizeToolOutput(outputText);
    updates.push({
      id: block.id || block.name || 'tool',
      toolCallId: block.id,
      name: block.name || block.id || 'tool',
      // A tool_result block means the tool has already produced a result.
      // Even during streaming deltas, treat missing statuses as completed so
      // earlier process cards don't stay stuck in a running state.
      status: normalizeToolStatus(block.status, 'completed'),
      summary,
      failureMessage: block.status === 'error' ? normalizeToolFailureMessage(outputText) : undefined,
      updatedAt: Date.now(),
    });
  }

  return updates;
}

function extractToolResultUpdate(message: unknown, eventState: string): ToolStatus | null {
  if (!message || typeof message !== 'object') return null;
  const msg = message as Record<string, unknown>;
  const role = typeof msg.role === 'string' ? msg.role.toLowerCase() : '';
  if (!isToolResultRole(role)) return null;

  const toolName = typeof msg.toolName === 'string' ? msg.toolName : (typeof msg.name === 'string' ? msg.name : '');
  const toolCallId = typeof msg.toolCallId === 'string' ? msg.toolCallId : undefined;
  const details = (msg.details && typeof msg.details === 'object') ? msg.details as Record<string, unknown> : undefined;
  const rawStatus = (msg.status ?? details?.status);
  const fallback = eventState === 'delta' ? 'running' : 'completed';
  const status = normalizeToolStatus(rawStatus, fallback);
  const durationMs = parseDurationMs(details?.durationMs ?? details?.duration ?? (msg as Record<string, unknown>).durationMs);

  const outputText = (details && typeof details.aggregated === 'string')
    ? details.aggregated
    : extractTextFromContent(msg.content);
  const failureMessage = normalizeToolFailureMessage(details?.error ?? msg.error);
  const summary = summarizeToolOutput(outputText) ?? summarizeToolOutput(failureMessage ?? '');

  const name = toolName || toolCallId || 'tool';
  const id = toolCallId || name;

  return {
    id,
    toolCallId,
    name,
    status,
    durationMs,
    summary,
    failureMessage,
    updatedAt: Date.now(),
  };
}

function mergeToolStatus(existing: ToolStatus['status'], incoming: ToolStatus['status']): ToolStatus['status'] {
  const order: Record<ToolStatus['status'], number> = { running: 0, retrying: 1, completed: 2, error: 3 };
  return order[incoming] >= order[existing] ? incoming : existing;
}

function createToolResultProcessMessage(message: RawMessage): RawMessage | null {
  if (!isToolResultRole(message.role)) return null;

  const msg = message as RawMessage & {
    name?: string;
    status?: string;
    error?: string;
  };
  const details = (msg.details && typeof msg.details === 'object')
    ? msg.details as Record<string, unknown>
    : undefined;
  const toolName = normalizeToolName(
    typeof msg.toolName === 'string'
      ? msg.toolName
      : (typeof msg.name === 'string' ? msg.name : undefined),
  );
  const toolCallId = typeof msg.toolCallId === 'string' ? msg.toolCallId : undefined;
  const outputText = (details && typeof details.aggregated === 'string')
    ? details.aggregated
    : extractTextFromContent(msg.content);
  const errorText = typeof details?.error === 'string'
    ? details.error
    : (typeof msg.error === 'string' ? msg.error : '');
  const detailText = outputText.trim() || errorText.trim() || toolName;
  const status = errorText.trim()
    ? 'error'
    : normalizeToolStatus(msg.status ?? details?.status, 'completed');
  const durationMs = parseDurationMs(details?.durationMs ?? details?.duration ?? ((msg as unknown as Record<string, unknown>).durationMs));

  return {
    ...message,
    role: 'assistant',
    id: message.id ? `${message.id}-tool-result` : `${toolCallId || toolName}-tool-result`,
    content: [
      {
        type: 'tool_result',
        id: toolCallId || message.id || toolName,
        name: toolName,
        status,
        durationMs,
        text: detailText,
        content: detailText,
      },
    ],
    _attachedFiles: cloneAttachedFiles(message._attachedFiles),
  };
}

function upsertToolStatuses(current: ToolStatus[], updates: ToolStatus[]): ToolStatus[] {
  if (updates.length === 0) return current;
  const next = [...current];
  for (const update of updates) {
    const key = update.toolCallId || update.id || update.name;
    if (!key) continue;
    const index = next.findIndex((tool) => (tool.toolCallId || tool.id || tool.name) === key);
    if (index === -1) {
      next.push(update);
      continue;
    }
    const existing = next[index];
    const isRetryTransition = existing.status === 'error' && (update.status === 'running' || update.status === 'retrying');
    const mergedStatus = isRetryTransition
      ? 'retrying'
      : (existing.status === 'retrying' && update.status === 'running')
        ? 'retrying'
        : mergeToolStatus(existing.status, update.status);
    const failureMessage = update.failureMessage
      ?? (update.status === 'error' ? update.summary : undefined)
      ?? ((mergedStatus === 'retrying' || mergedStatus === 'error') ? existing.failureMessage ?? existing.summary : undefined);
    next[index] = {
      ...existing,
      ...update,
      name: update.name || existing.name,
      status: mergedStatus,
      durationMs: update.durationMs ?? existing.durationMs,
      summary: update.summary ?? existing.summary,
      failureMessage,
      retries: isRetryTransition
        ? (existing.retries ?? 0) + 1
        : update.retries ?? existing.retries,
      updatedAt: update.updatedAt || existing.updatedAt,
    };
  }
  return next;
}

/**
 * Only treat an explicit chat.send ack timeout as recoverable.
 * Gateway stopped / Gateway not connected are hard failures that
 * should still terminate the send immediately.
 */
function isRecoverableChatSendTimeout(error: string): boolean {
  return error.includes('RPC timeout: chat.send');
}

function collectToolUpdates(message: unknown, eventState: string): ToolStatus[] {
  const updates: ToolStatus[] = [];
  updates.push(...extractToolUseUpdates(message));
  updates.push(...extractToolResultBlocks(message, eventState));
  const toolResultUpdate = extractToolResultUpdate(message, eventState);
  if (toolResultUpdate) updates.push(toolResultUpdate);
  return updates;
}

function hasNonToolAssistantContent(message: RawMessage | undefined): boolean {
  if (!message) return false;
  if (Array.isArray(message._attachedFiles) && message._attachedFiles.length > 0) return true;
  if (typeof message.content === 'string' && message.content.trim()) return true;

  const content = message.content;
  if (Array.isArray(content)) {
    for (const block of content as ContentBlock[]) {
      if (block.type === 'text' && block.text && block.text.trim()) return true;
      if (block.type === 'thinking' && block.thinking && block.thinking.trim()) return true;
      if (block.type === 'image') return true;
    }
  }

  const msg = message as unknown as Record<string, unknown>;
  if (typeof msg.text === 'string' && msg.text.trim()) return true;

  return false;
}

function isEmptyAssistantResponse(message: RawMessage | undefined): boolean {
  if (!message || message.role !== 'assistant') return false;
  if (isInternalMessage(message)) return false;
  if (isToolOnlyMessage(message)) return false;
  return !hasNonToolAssistantContent(message);
}

function extractThinkingFromContent(content: unknown): string {
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content as ContentBlock[]) {
    if (block.type === 'thinking' && block.thinking?.trim()) {
      parts.push(block.thinking.trim());
    }
  }
  return parts.join('\n');
}

function countImageBlocks(content: unknown): number {
  if (!Array.isArray(content)) return 0;
  let count = 0;
  for (const block of content as ContentBlock[]) {
    if (block.type === 'image') count += 1;
  }
  return count;
}

function countToolBlocks(message: RawMessage | null | undefined): number {
  if (!message) return 0;
  let count = 0;
  if (Array.isArray(message.content)) {
    for (const block of message.content as ContentBlock[]) {
      if (block.type === 'tool_use' || block.type === 'toolCall') count += 1;
    }
  }
  const toolCalls = (message as unknown as Record<string, unknown>).tool_calls ?? (message as unknown as Record<string, unknown>).toolCalls;
  if (count === 0 && Array.isArray(toolCalls)) {
    count = toolCalls.length;
  }
  return count;
}

function buildStreamingDisplayMessageForState(state: Pick<ChatState, 'streamingMessage' | 'streamingText'>): RawMessage | null {
  const streamMsg = state.streamingMessage && typeof state.streamingMessage === 'object'
    ? state.streamingMessage as { role?: string; content?: unknown; timestamp?: number }
    : null;
  const streamText = streamMsg ? getMessageText(streamMsg.content) : state.streamingText;
  if (!streamMsg && !streamText.trim()) return null;
  return (streamMsg
    ? {
        ...(streamMsg as Record<string, unknown>),
        role: (typeof streamMsg.role === 'string' ? streamMsg.role : 'assistant') as RawMessage['role'],
        content: streamMsg.content ?? streamText,
        timestamp: streamMsg.timestamp ?? Date.now() / 1000,
      }
    : {
        role: 'assistant' as const,
        content: streamText,
        timestamp: Date.now() / 1000,
      }) as RawMessage;
}

function isProcessContentBlock(block: ContentBlock): boolean {
  return block.type === 'thinking'
    || block.type === 'tool_use'
    || block.type === 'toolCall'
    || block.type === 'tool_result'
    || block.type === 'toolResult';
}

function splitAssistantMessageForActiveTurn(message: RawMessage | null): {
  processMessage: RawMessage | null;
  finalMessage: RawMessage | null;
} {
  if (!message || !Array.isArray(message.content)) {
    return {
      processMessage: null,
      finalMessage: message,
    };
  }

  const processBlocks = (message.content as ContentBlock[]).filter((block) => isProcessContentBlock(block));
  if (processBlocks.length === 0) {
    return {
      processMessage: null,
      finalMessage: message,
    };
  }

  const nonProcessBlocks = (message.content as ContentBlock[]).filter((block) => !isProcessContentBlock(block));
  return {
    processMessage: {
      ...message,
      id: message.id ? `${message.id}-process` : message.id,
      content: processBlocks,
      _attachedFiles: [],
    },
    finalMessage: {
      ...message,
      content: nonProcessBlocks,
    },
  };
}

function deriveActiveTurnBuffer(
  state: Pick<
    ChatState,
    | 'messages'
    | 'sending'
    | 'streamingMessage'
    | 'streamingText'
    | 'lastUserMessageAt'
  >,
): ActiveTurnBuffer {
  const safeMessages = Array.isArray(state.messages) ? state.messages : [];
  const lastUserTsMs = typeof state.lastUserMessageAt === 'number'
    ? (state.lastUserMessageAt < 1e12 ? state.lastUserMessageAt * 1000 : state.lastUserMessageAt)
    : 0;
  const lastUserIndex = findLastUserMessageIndex(safeMessages);
  const shouldRetainCompletedTurn = !state.sending
    && lastUserIndex >= 0
    && lastUserTsMs > 0
    && isWithinCompletedTurnProcessGrace(lastUserTsMs)
    && safeMessages.slice(lastUserIndex + 1).some((message) => (
      message.role === 'assistant'
      && (!message.timestamp || toMs(message.timestamp) >= lastUserTsMs)
    ));
  const activeTurnStartIndex = state.sending || shouldRetainCompletedTurn ? lastUserIndex : -1;
  const historyMessages = activeTurnStartIndex >= 0 ? safeMessages.slice(0, activeTurnStartIndex) : safeMessages;
  const activeTurnMessages = activeTurnStartIndex >= 0 ? safeMessages.slice(activeTurnStartIndex) : [];
  const userMessage = activeTurnMessages[0]?.role === 'user' ? activeTurnMessages[0] : null;
  const assistantMessages = userMessage
    ? activeTurnMessages.slice(1).filter((message) => (
      message.role === 'assistant' && !isInternalAssistantControlMessage(message)
    ))
    : [];
  const latestPersistedAssistant = [...safeMessages].reverse().find((message) => {
    if (message.role !== 'assistant') return false;
    if (isInternalAssistantControlMessage(message)) return false;
    if (!lastUserTsMs || !message.timestamp) return true;
    const messageTsMs = message.timestamp < 1e12 ? message.timestamp * 1000 : message.timestamp;
    return messageTsMs >= lastUserTsMs;
  }) ?? null;
  const rawStreamingDisplayMessage = buildStreamingDisplayMessageForState(state);
  const streamingDisplayMessage = isInternalAssistantControlMessage(rawStreamingDisplayMessage)
    ? null
    : rawStreamingDisplayMessage;
  const streamText = streamingDisplayMessage ? getMessageText(streamingDisplayMessage.content).trim() : '';
  const streamThinking = streamingDisplayMessage ? extractThinkingFromContent(streamingDisplayMessage.content).trim() : '';
  const streamImageCount = streamingDisplayMessage ? countImageBlocks(streamingDisplayMessage.content) : 0;
  const streamToolCount = countToolBlocks(streamingDisplayMessage);
  const latestPersistedAssistantText = latestPersistedAssistant ? getMessageText(latestPersistedAssistant.content).trim() : '';
  const latestPersistedAssistantThinking = latestPersistedAssistant ? extractThinkingFromContent(latestPersistedAssistant.content).trim() : '';
  const latestPersistedAssistantImageCount = latestPersistedAssistant ? countImageBlocks(latestPersistedAssistant.content) : 0;
  const latestPersistedAssistantToolCount = countToolBlocks(latestPersistedAssistant);
  const hasAnyStreamContent = !!streamingDisplayMessage
    && (
      streamText.length > 0
      || streamThinking.length > 0
      || streamImageCount > 0
      || streamToolCount > 0
    );
  const isStreamingDuplicateOfPersistedAssistant = !!latestPersistedAssistant
    && (
      (streamText.length > 0 && latestPersistedAssistantText === streamText)
      || (streamText.length === 0 && streamThinking.length > 0 && latestPersistedAssistantThinking === streamThinking)
    )
    && (streamImageCount === 0 || latestPersistedAssistantImageCount === streamImageCount)
    && (streamToolCount === 0 || latestPersistedAssistantToolCount === streamToolCount);
  const persistedFinalSource = isStreamingDuplicateOfPersistedAssistant && assistantMessages.length > 0
    ? assistantMessages[assistantMessages.length - 1]
    : null;
  const splitPersistedFinal = splitAssistantMessageForActiveTurn(persistedFinalSource);
  const splitStreaming = splitAssistantMessageForActiveTurn(streamingDisplayMessage);
  const processMessages = splitPersistedFinal.processMessage
    ? [...assistantMessages.slice(0, -1), splitPersistedFinal.processMessage]
    : (persistedFinalSource ? assistantMessages.slice(0, -1) : assistantMessages);

  return {
    historyMessages,
    userMessage,
    assistantMessages,
    processMessages,
    latestPersistedAssistant,
    persistedFinalMessage: splitPersistedFinal.finalMessage,
    streamingDisplayMessage,
    processStreamingMessage: splitStreaming.processMessage,
    finalStreamingMessage: splitStreaming.finalMessage,
    startedAtMs: userMessage?.timestamp ? toMs(userMessage.timestamp) : lastUserTsMs || null,
    hasAnyStreamContent,
    isStreamingDuplicateOfPersistedAssistant,
  };
}

function hasLiveTurnSignal(state: Pick<
  ChatState,
  | 'sending'
  | 'streamingMessage'
  | 'streamingText'
  | 'streamingTools'
>): boolean {
  if (!state.sending) return false;
  if (state.streamingMessage && typeof state.streamingMessage === 'object') return true;
  if (typeof state.streamingText === 'string' && state.streamingText.trim().length > 0) return true;
  if (state.streamingTools.length > 0) return true;
  return false;
}

function shouldRecomputeActiveTurnBuffer(
  prevState: Pick<
    ChatState,
    | 'messages'
    | 'sending'
    | 'streamingMessage'
    | 'streamingText'
    | 'lastUserMessageAt'
  >,
  nextState: Pick<
    ChatState,
    | 'messages'
    | 'sending'
    | 'streamingMessage'
    | 'streamingText'
    | 'lastUserMessageAt'
  >,
): boolean {
  return prevState.messages !== nextState.messages
    || prevState.sending !== nextState.sending
    || prevState.streamingMessage !== nextState.streamingMessage
    || prevState.streamingText !== nextState.streamingText
    || prevState.lastUserMessageAt !== nextState.lastUserMessageAt;
}

// ── Store ────────────────────────────────────────────────────────

export const useChatStore = create<ChatState>((baseSet, get) => {
  const set: ChatStoreSet = (partial, replace = false) => {
    baseSet((state) => {
      const patch = typeof partial === 'function' ? partial(state) : partial;
      const nextState = { ...state, ...patch } as ChatState;
      return {
        ...patch,
        activeTurnBuffer: shouldRecomputeActiveTurnBuffer(state, nextState)
          ? deriveActiveTurnBuffer(nextState)
          : state.activeTurnBuffer,
      };
    }, replace);
  };

  const initialState: Omit<ChatState,
    | 'loadSessions'
    | 'switchSession'
    | 'newSession'
    | 'renameSession'
    | 'toggleSessionPin'
    | 'archiveSession'
    | 'restoreSession'
    | 'deleteSession'
    | 'cleanupEmptySession'
    | 'loadHistory'
    | 'sendMessage'
    | 'abortRun'
    | 'handleChatEvent'
    | 'toggleThinking'
    | 'refresh'
    | 'clearError'
    | 'setComposerDraft'
    | 'clearComposerDraft'
    | 'queueOfflineMessage'
    | 'flushQueuedMessage'
    | 'clearQueuedMessage'
  > = {
    messages: [],
    loading: false,
    error: null,

    sending: false,
    activeRunId: null,
    streamingText: '',
    streamingMessage: null,
    streamingTools: [],
    sendStage: null,
    pendingFinal: false,
    lastUserMessageAt: null,
    pendingToolImages: [],
    activeTurnBuffer: deriveActiveTurnBuffer({
      messages: [],
      sending: false,
      streamingMessage: null,
      streamingText: '',
      lastUserMessageAt: null,
    }),

    sessions: [],
    currentSessionKey: DEFAULT_SESSION_KEY,
    currentAgentId: 'main',
    sessionModels: {},
    composerDrafts: {},
    sessionLabels: {},
    sessionLastActivity: {},
    sessionRunningState: {},
    queuedMessages: {},

    showThinking: true,
    thinkingLevel: null,
  };

  return {
  ...initialState,

  // ── Load sessions via sessions.list ──

  setComposerDraft: (sessionKey: string, nextDraft: ChatComposerDraftUpdate) => {
    if (!sessionKey) return;
    set((state) => {
      const currentDraft = state.composerDrafts[sessionKey] ?? EMPTY_CHAT_COMPOSER_DRAFT;
      const resolvedDraft = typeof nextDraft === 'function'
        ? nextDraft(cloneComposerDraft(currentDraft))
        : nextDraft;
      const normalizedDraft = normalizeComposerDraft(resolvedDraft);

      if (!normalizedDraft) {
        if (!state.composerDrafts[sessionKey]) {
          return {};
        }
        return {
          composerDrafts: clearSessionEntryFromMap(state.composerDrafts, sessionKey),
        };
      }

      return {
        composerDrafts: {
          ...state.composerDrafts,
          [sessionKey]: normalizedDraft,
        },
      };
    });
  },

  clearComposerDraft: (sessionKey?: string) => {
    const targetSessionKey = sessionKey ?? get().currentSessionKey;
    if (!targetSessionKey) return;
    set((state) => {
      if (!state.composerDrafts[targetSessionKey]) {
        return {};
      }
      return {
        composerDrafts: clearSessionEntryFromMap(state.composerDrafts, targetSessionKey),
      };
    });
  },

  loadSessions: async () => {
    const now = Date.now();
    if (_loadSessionsInFlight) {
      await _loadSessionsInFlight;
      return;
    }
    if (now - _lastLoadSessionsAt < SESSION_LOAD_MIN_INTERVAL_MS) {
      return;
    }

    _loadSessionsInFlight = (async () => {
      try {
        let data: Record<string, unknown> | null = null;
        let aggregatedPreviews: Record<string, { firstUserMessage: string | null }> = {};
        let usedLocalCatalog = false;
        try {
          const localCatalog = await hostApiFetch<{
            success: boolean;
            sessions?: Array<Record<string, unknown>>;
            previews?: Record<string, { firstUserMessage: string | null }>;
          }>('/api/sessions/catalog');
          if (localCatalog?.success && Array.isArray(localCatalog.sessions)) {
            data = { sessions: localCatalog.sessions };
            aggregatedPreviews = localCatalog.previews ?? {};
            usedLocalCatalog = true;
          }
        } catch {
          // Fall back to the split local routes when the aggregate route is unavailable.
        }

        if (!data) {
          try {
            const localList = await hostApiFetch<{
              success: boolean;
              sessions?: Array<Record<string, unknown>>;
            }>('/api/sessions/list');
            if (localList?.success && Array.isArray(localList.sessions)) {
              data = { sessions: localList.sessions };
            }
          } catch {
            // Fall back to gateway enumeration when local routes are unavailable.
          }
        }

        if (!data) {
          data = await useGatewayStore.getState().rpc<Record<string, unknown>>('sessions.list', {});
        }
        if (data) {
          const rawSessions = Array.isArray(data.sessions) ? data.sessions : [];
          const sessionKeys = rawSessions
            .map((session) => (typeof (session as Record<string, unknown>).key === 'string' ? String((session as Record<string, unknown>).key) : ''))
            .filter(Boolean);

          let persistedMetadata: Record<string, { pinned?: boolean; pinOrder?: number; archived?: boolean; archivedAt?: number; createdAt?: number }> = {};
          if (sessionKeys.length > 0 && !usedLocalCatalog) {
            try {
              const metadataResult = await hostApiFetch<{
                success: boolean;
                metadata?: Record<string, { pinned?: boolean; pinOrder?: number; archived?: boolean; archivedAt?: number; createdAt?: number }>;
              }>('/api/sessions/metadata', {
                method: 'POST',
                body: JSON.stringify({ sessionKeys }),
              });

              if (metadataResult?.success && metadataResult.metadata) {
                persistedMetadata = metadataResult.metadata;
              }
            } catch {
              // Fall back to gateway-provided fields when local metadata is unavailable.
            }
          }

          const sessions: ChatSession[] = rawSessions.map((s: Record<string, unknown>) => ({
            key: String(s.key || ''),
            label: s.label ? String(s.label) : undefined,
            displayName: s.displayName ? String(s.displayName) : undefined,
            thinkingLevel: s.thinkingLevel ? String(s.thinkingLevel) : undefined,
            modelProvider: s.modelProvider ? String(s.modelProvider) : undefined,
            model: normalizeSessionModelRef(s.model, s.modelProvider),
            updatedAt: parseSessionUpdatedAtMs(s.updatedAt),
            pinned: parseSessionPinned(persistedMetadata[String(s.key || '')]?.pinned ?? s.pinned),
            pinOrder: parseSessionPinOrder(persistedMetadata[String(s.key || '')]?.pinOrder ?? s.pinOrder),
            archived: parseSessionArchived(persistedMetadata[String(s.key || '')]?.archived ?? s.archived),
            archivedAt: parseSessionArchivedAt(persistedMetadata[String(s.key || '')]?.archivedAt ?? s.archivedAt),
            createdAt: parseSessionUpdatedAtMs(persistedMetadata[String(s.key || '')]?.createdAt ?? s.createdAt),
          })).filter((s: ChatSession) => s.key);

          const visibleSessions = sessions.filter((session) => !session.archived);

          const canonicalBySuffix = new Map<string, string>();
          for (const session of visibleSessions) {
            if (!session.key.startsWith('agent:')) continue;
            const parts = session.key.split(':');
            if (parts.length < 3) continue;
            const suffix = parts.slice(2).join(':');
            if (suffix && !canonicalBySuffix.has(suffix)) {
              canonicalBySuffix.set(suffix, session.key);
            }
          }

          // Deduplicate: if both short and canonical existed, keep canonical only
          const seen = new Set<string>();
          const dedupedSessions = visibleSessions.filter((s) => {
            if (!s.key.startsWith('agent:') && canonicalBySuffix.has(s.key)) return false;
            if (seen.has(s.key)) return false;
            seen.add(s.key);
            return true;
          });

          const { currentSessionKey, sessions: localSessions } = get();
          let nextSessionKey = currentSessionKey || DEFAULT_SESSION_KEY;
          if (!nextSessionKey.startsWith('agent:')) {
            const canonicalMatch = canonicalBySuffix.get(nextSessionKey);
            if (canonicalMatch) {
              nextSessionKey = canonicalMatch;
            }
          }
          const currentState = get();
          const currentIsUnusedDraft = isUnusedDraftSession(currentState, nextSessionKey);
          const hasLocalSessionEntry = localSessions.some((session) => session.key === nextSessionKey);
          if (!dedupedSessions.find((s) => s.key === nextSessionKey) && dedupedSessions.length > 0) {
            // Preserve locally-created blank drafts and pending local sessions.
            // The initial ghost key (`agent:main:main`) is neither, so it still
            // yields to persisted history when no startup draft exists.
            if (!currentIsUnusedDraft && !hasLocalSessionEntry) {
              nextSessionKey = dedupedSessions[0].key;
            }
          }

          const shouldMaterializeCurrentSession = !isUnusedDraftSession(get(), nextSessionKey);
          const sessionsWithCurrent = !dedupedSessions.find((s) => s.key === nextSessionKey) && nextSessionKey && shouldMaterializeCurrentSession
            ? [
              ...dedupedSessions,
              { key: nextSessionKey, displayName: nextSessionKey },
            ]
            : dedupedSessions;

          const discoveredActivity = Object.fromEntries(
            sessionsWithCurrent
              .filter((session) => typeof session.updatedAt === 'number' && Number.isFinite(session.updatedAt))
              .map((session) => [session.key, session.updatedAt!]),
          );
          const discoveredModels = Object.fromEntries(
            sessionsWithCurrent
              .filter((session) => typeof session.model === 'string' && session.model.trim().length > 0)
              .map((session) => [session.key, session.model!.trim()]),
          );

          set((state) => ({
            sessions: sessionsWithCurrent,
            currentSessionKey: nextSessionKey,
            currentAgentId: getAgentIdFromSessionKey(nextSessionKey),
            sessionModels: {
              ...remapSessionEntries(state.sessionModels, canonicalBySuffix),
              ...discoveredModels,
            },
            composerDrafts: remapSessionEntries(state.composerDrafts, canonicalBySuffix),
            sessionLabels: remapSessionEntries(state.sessionLabels, canonicalBySuffix),
            sessionLastActivity: {
              ...remapSessionEntries(state.sessionLastActivity, canonicalBySuffix, (existing, next) => (
                typeof existing === 'number' ? Math.max(existing, next) : next
              )),
              ...discoveredActivity,
            },
            sessionRunningState: remapSessionEntries(
              state.sessionRunningState,
              canonicalBySuffix,
              (existing, next) => Boolean(existing || next) as boolean,
            ),
          }));

          if (currentSessionKey !== nextSessionKey) {
            void get().loadHistory();
          }

          // Background: fetch first user message for unlabeled sessions without
          // flooding Gateway chat.history calls for every row in the sidebar.
          const sessionLabelsAfterLoad = get().sessionLabels;
          const sessionsToLabel = sessionsWithCurrent.filter((session) => (
            !session.key.endsWith(':main')
            && !hasStoredSessionLabel(sessionsWithCurrent, session.key)
            && !sessionLabelsAfterLoad[session.key]
          ));
          const shouldUseGatewayHistoryLabelPrefetch = false;
          if (sessionsToLabel.length > 0) {
            const labelsToPersist: Array<{ sessionKey: string; label: string }> = [];
            const missingPreviewSessionKeys = new Set<string>();

            set((s) => {
              let nextSessionLabels = s.sessionLabels;
              let changed = false;

              for (const session of sessionsToLabel) {
                const labelText = aggregatedPreviews[session.key]?.firstUserMessage?.trim();
                const autoLabel = labelText ? truncateAutoSessionLabel(labelText) : '';
                if (!autoLabel) {
                  missingPreviewSessionKeys.add(session.key);
                  continue;
                }
                if (s.sessionLabels[session.key] || hasStoredSessionLabel(s.sessions, session.key)) {
                  continue;
                }
                if (!changed) {
                  nextSessionLabels = { ...s.sessionLabels };
                  changed = true;
                }
                nextSessionLabels[session.key] = autoLabel;
                labelsToPersist.push({ sessionKey: session.key, label: autoLabel });
              }

              return changed ? { sessionLabels: nextSessionLabels } : {};
            });

            for (const { sessionKey, label } of labelsToPersist) {
              queueAutoSessionLabelPersistence(set, sessionKey, label);
            }

            if (missingPreviewSessionKeys.size > 0) {
              const fallbackSessions = sessionsToLabel.filter((session) => missingPreviewSessionKeys.has(session.key));
              const fallbackLabelsToPersist: Array<{ sessionKey: string; label: string }> = [];
              void hostApiFetch<{
                success: boolean;
                previews?: Record<string, { firstUserMessage: string | null }>;
              }>('/api/sessions/previews', {
                method: 'POST',
                body: JSON.stringify({ sessionKeys: fallbackSessions.map((session) => session.key) }),
              }).then((result) => {
                if (!result?.success || !result.previews) return;
                set((s) => {
                  let nextSessionLabels = s.sessionLabels;
                  let changed = false;

                  for (const session of fallbackSessions) {
                    const labelText = result.previews?.[session.key]?.firstUserMessage?.trim();
                    const autoLabel = labelText ? truncateAutoSessionLabel(labelText) : '';
                    if (!autoLabel || s.sessionLabels[session.key] || hasStoredSessionLabel(s.sessions, session.key)) {
                      continue;
                    }
                    if (!changed) {
                      nextSessionLabels = { ...s.sessionLabels };
                      changed = true;
                    }
                    nextSessionLabels[session.key] = autoLabel;
                    fallbackLabelsToPersist.push({ sessionKey: session.key, label: autoLabel });
                  }

                  return changed ? { sessionLabels: nextSessionLabels } : {};
                });
              }).catch(() => {
                // ignore preview prefetch errors
              }).finally(() => {
                for (const { sessionKey, label } of fallbackLabelsToPersist) {
                  queueAutoSessionLabelPersistence(set, sessionKey, label);
                }
              });
            }
          }
          if (shouldUseGatewayHistoryLabelPrefetch && sessionsToLabel.length > 0) {
            void Promise.all(
              sessionsToLabel.map(async (session) => {
                try {
                  const r = await useGatewayStore.getState().rpc<Record<string, unknown>>(
                    'chat.history',
                    { sessionKey: session.key, limit: CHAT_HISTORY_LABEL_PREFETCH_LIMIT },
                    CHAT_HISTORY_RPC_TIMEOUT_MS,
                  );
                  const msgs = Array.isArray(r.messages) ? r.messages as RawMessage[] : [];
                  const firstUser = msgs.find((m) => m.role === 'user');
                  const lastMsg = msgs[msgs.length - 1];
                  set((s) => {
                    const next: Partial<typeof s> = {};
                    if (firstUser) {
                      const labelText = getSessionLabelText(firstUser.content);
                      if (labelText && !s.sessionLabels[session.key] && !hasStoredSessionLabel(s.sessions, session.key)) {
                        const truncated = labelText.length > 50 ? `${labelText.slice(0, 50)}…` : labelText;
                        next.sessionLabels = { ...s.sessionLabels, [session.key]: truncated };
                      }
                    }
                    if (lastMsg?.timestamp) {
                      next.sessionLastActivity = { ...s.sessionLastActivity, [session.key]: toMs(lastMsg.timestamp) };
                    }
                    return next;
                  });
                } catch {
                  // ignore per-session errors
                }
              }),
            );
          }
        }
      } catch (err) {
        console.warn('Failed to load sessions:', err);
      } finally {
        _lastLoadSessionsAt = Date.now();
      }
    })();

    try {
      await _loadSessionsInFlight;
    } finally {
      _loadSessionsInFlight = null;
    }
  },

  // ── Switch session ──

  switchSession: (key: string) => {
    if (key === get().currentSessionKey) return;
    // Stop any background polling for the old session before switching.
    // This prevents the poll timer from firing after the switch and loading
    // the wrong session's history into the new session's view.
    clearHistoryPoll();
    clearErrorRecoveryTimer();
    cancelPendingDeltaFlush();
    resetPendingDeltaState();
    set((s) => buildSessionSwitchPatch(s, key));
    if (get().sending) {
      startHistoryPoll(get, key);
    }
    void get().loadHistory(get().sending);
  },

  // ── Delete session ──
  //
  // NOTE: The OpenClaw Gateway does NOT expose a sessions.delete (or equivalent)
  // RPC — confirmed by inspecting client.ts, protocol.ts and the full codebase.
  // Deletion is therefore a local-only UI operation: the session is removed from
  // the sidebar list and its labels/activity maps are cleared.  The underlying
  // JSONL history file on disk is intentionally left intact, consistent with the
  // newSession() design that avoids sessions.reset to preserve history.

  deleteSession: async (key: string) => {
    // Soft-delete the session's JSONL transcript on disk.
    // The main process renames <suffix>.jsonl → <suffix>.deleted.jsonl so that
    // sessions.list skips it automatically.
    try {
      const result = await hostApiFetch<{
        success: boolean;
        error?: string;
      }>('/api/sessions/delete', {
        method: 'POST',
        body: JSON.stringify({ sessionKey: key }),
      });
      if (!result.success) {
        console.warn(`[deleteSession] IPC reported failure for ${key}:`, result.error);
      }
    } catch (err) {
      console.warn(`[deleteSession] IPC call failed for ${key}:`, err);
    }
    clearSessionView(key);
    clearHistoryIncompleteRetry(key);

    const { currentSessionKey, sessions } = get();
    const remaining = sessions.filter((s) => s.key !== key);

    if (currentSessionKey === key) {
      // Switched away from deleted session — pick the first remaining or create new
      const next = remaining[0];
      set((s) => ({
        sessions: remaining,
        sessionModels: Object.fromEntries(Object.entries(s.sessionModels).filter(([k]) => k !== key)),
        composerDrafts: clearSessionEntryFromMap(s.composerDrafts, key),
        sessionLabels: Object.fromEntries(Object.entries(s.sessionLabels).filter(([k]) => k !== key)),
        sessionLastActivity: Object.fromEntries(Object.entries(s.sessionLastActivity).filter(([k]) => k !== key)),
        sessionRunningState: clearSessionEntryFromMap(s.sessionRunningState ?? {}, key),
        messages: [],
        streamingText: '',
        streamingMessage: null,
        streamingTools: [],
        activeRunId: null,
        error: null,
        pendingFinal: false,
        lastUserMessageAt: null,
        pendingToolImages: [],
        currentSessionKey: next?.key ?? DEFAULT_SESSION_KEY,
        currentAgentId: getAgentIdFromSessionKey(next?.key ?? DEFAULT_SESSION_KEY),
      }));
      if (next) {
        get().loadHistory();
      }
    } else {
      set((s) => ({
        sessions: remaining,
        sessionModels: Object.fromEntries(Object.entries(s.sessionModels).filter(([k]) => k !== key)),
        composerDrafts: clearSessionEntryFromMap(s.composerDrafts, key),
        sessionLabels: Object.fromEntries(Object.entries(s.sessionLabels).filter(([k]) => k !== key)),
        sessionLastActivity: Object.fromEntries(Object.entries(s.sessionLastActivity).filter(([k]) => k !== key)),
        sessionRunningState: clearSessionEntryFromMap(s.sessionRunningState ?? {}, key),
      }));
    }
  },

  // ── New session ──

  newSession: () => {
    // Generate a new unique session key and switch to it.
    // NOTE: We intentionally do NOT call sessions.reset on the old session.
    // sessions.reset archives (renames) the session JSONL file, making old
    // conversation history inaccessible when the user switches back to it.
    const { currentSessionKey, messages, sessions, composerDrafts, sessionLastActivity, sessionLabels } = get();
    const leavingEmpty = isUnusedDraftSession(
      { currentSessionKey, messages, sessions, composerDrafts, sessionLabels, sessionLastActivity },
      currentSessionKey,
    );
    const prefix = resolveDefaultCanonicalPrefix()
      || getCanonicalPrefixFromSessionKey(currentSessionKey)
      || getCanonicalPrefixFromSessions(sessions)
      || DEFAULT_CANONICAL_PREFIX;
    const newKey = `${prefix}:session-${Date.now()}`;
    const newAgentId = getAgentIdFromSessionKey(newKey);
    const defaultSessionModel = resolveSessionModelSnapshot();
    clearHistoryIncompleteRetry(currentSessionKey);
    if (leavingEmpty) {
      clearSessionView(currentSessionKey);
    } else {
      cacheSessionView(get());
    }
    set((s) => ({
      sessionRunningState: leavingEmpty
        ? clearSessionEntryFromMap(
            updateSessionRunningState(s.sessionRunningState, currentSessionKey, s.sending),
            currentSessionKey,
          )
        : updateSessionRunningState(s.sessionRunningState, currentSessionKey, s.sending),
      currentSessionKey: newKey,
      currentAgentId: newAgentId,
      sessions: leavingEmpty ? s.sessions.filter((sess) => sess.key !== currentSessionKey) : s.sessions,
      sessionModels: {
        ...(leavingEmpty
          ? Object.fromEntries(Object.entries(s.sessionModels).filter(([k]) => k !== currentSessionKey))
          : s.sessionModels),
        ...(defaultSessionModel ? { [newKey]: defaultSessionModel } : {}),
      },
      composerDrafts: leavingEmpty
        ? clearSessionEntryFromMap(s.composerDrafts, currentSessionKey)
        : s.composerDrafts,
      sessionLabels: leavingEmpty
        ? Object.fromEntries(Object.entries(s.sessionLabels).filter(([k]) => k !== currentSessionKey))
        : s.sessionLabels,
      sessionLastActivity: leavingEmpty
        ? Object.fromEntries(Object.entries(s.sessionLastActivity).filter(([k]) => k !== currentSessionKey))
        : s.sessionLastActivity,
      messages: [],
      loading: false,
      streamingText: '',
      streamingMessage: null,
      streamingTools: [],
      activeRunId: null,
      error: null,
      pendingFinal: false,
      lastUserMessageAt: null,
      pendingToolImages: [],
    }));
  },

  // ── Cleanup empty session on navigate away ──

  renameSession: async (key: string, label: string) => {
    const trimmed = label.trim();
    const normalized = Array.from(trimmed).slice(0, 30).join('');
    if (!normalized) return;

    await hostApiFetch<{ success: boolean; label: string }>('/api/sessions/rename', {
      method: 'POST',
      body: JSON.stringify({ sessionKey: key, label: normalized }),
    });

    set((s) => ({
      sessions: s.sessions.map((session) => (
        session.key === key
          ? { ...session, label: normalized }
          : session
      )),
      sessionLabels: {
        ...s.sessionLabels,
        [key]: normalized,
      },
    }));
  },

  toggleSessionPin: async (key: string) => {
    const currentSession = get().sessions.find((session) => session.key === key);
    if (!currentSession) return;

    const nextPinned = !currentSession.pinned;
    const normalizedPinOrder = nextPinned
      ? Math.max(
        0,
        ...get().sessions
          .map((session) => (session.pinned && typeof session.pinOrder === 'number' ? session.pinOrder : 0)),
      ) + 1
      : undefined;

    await hostApiFetch<{ success: boolean; pinned: boolean; pinOrder?: number }>('/api/sessions/pin', {
      method: 'POST',
      body: JSON.stringify({
        sessionKey: key,
        pinned: nextPinned,
        pinOrder: normalizedPinOrder,
      }),
    });

    set((s) => ({
      sessions: s.sessions.map((session) => (
        session.key === key
          ? {
            ...session,
            pinned: nextPinned,
            pinOrder: nextPinned ? normalizedPinOrder : undefined,
          }
          : session
        )),
      }));
  },

  archiveSession: async (key: string) => {
    await hostApiFetch<{ success: boolean; archived: boolean; archivedAt?: number }>('/api/sessions/archive', {
      method: 'POST',
      body: JSON.stringify({ sessionKey: key, archived: true }),
    });

    clearSessionView(key);
    clearHistoryIncompleteRetry(key);

    const { currentSessionKey, sessions } = get();
    const remaining = sessions.filter((session) => session.key !== key);

    if (currentSessionKey === key) {
      const next = remaining[0];
      set((s) => ({
        sessions: remaining,
        sessionModels: Object.fromEntries(Object.entries(s.sessionModels).filter(([sessionKey]) => sessionKey !== key)),
        sessionLabels: Object.fromEntries(Object.entries(s.sessionLabels).filter(([sessionKey]) => sessionKey !== key)),
        sessionLastActivity: Object.fromEntries(Object.entries(s.sessionLastActivity).filter(([sessionKey]) => sessionKey !== key)),
        sessionRunningState: clearSessionEntryFromMap(s.sessionRunningState ?? {}, key),
        messages: [],
        streamingText: '',
        streamingMessage: null,
        streamingTools: [],
        activeRunId: null,
        error: null,
        pendingFinal: false,
        lastUserMessageAt: null,
        pendingToolImages: [],
        currentSessionKey: next?.key ?? DEFAULT_SESSION_KEY,
        currentAgentId: getAgentIdFromSessionKey(next?.key ?? DEFAULT_SESSION_KEY),
      }));
      if (next) {
        void get().loadHistory();
      }
      return;
    }

    set((s) => ({
      sessions: remaining,
      sessionModels: Object.fromEntries(Object.entries(s.sessionModels).filter(([sessionKey]) => sessionKey !== key)),
      sessionLabels: Object.fromEntries(Object.entries(s.sessionLabels).filter(([sessionKey]) => sessionKey !== key)),
      sessionLastActivity: Object.fromEntries(Object.entries(s.sessionLastActivity).filter(([sessionKey]) => sessionKey !== key)),
      sessionRunningState: clearSessionEntryFromMap(s.sessionRunningState ?? {}, key),
    }));
  },

  restoreSession: async (key: string) => {
    await hostApiFetch<{ success: boolean; archived: boolean }>('/api/sessions/archive', {
      method: 'POST',
      body: JSON.stringify({ sessionKey: key, archived: false }),
    });

    await get().loadSessions();
    get().switchSession(key);
  },

  cleanupEmptySession: () => {
    const { currentSessionKey, messages, sessions, composerDrafts, sessionLastActivity, sessionLabels } = get();
    // Only remove non-main sessions that were never used (no messages sent).
    // This mirrors the "leavingEmpty" logic in switchSession so that creating
    // a new session and immediately navigating away doesn't leave a ghost entry
    // in the sidebar.
    // Also check sessionLastActivity and sessionLabels comprehensively to prevent
    // falsely treating sessions with history as empty due to switchSession clearing messages early.
    const isEmptyNonMain = isUnusedDraftSession(
      { currentSessionKey, messages, sessions, composerDrafts, sessionLabels, sessionLastActivity },
      currentSessionKey,
    );
    if (!isEmptyNonMain) return;
    clearSessionView(currentSessionKey);
    clearHistoryIncompleteRetry(currentSessionKey);
    set((s) => ({
      sessions: s.sessions.filter((sess) => sess.key !== currentSessionKey),
      composerDrafts: clearSessionEntryFromMap(s.composerDrafts, currentSessionKey),
      sessionLabels: Object.fromEntries(
        Object.entries(s.sessionLabels).filter(([k]) => k !== currentSessionKey),
      ),
      sessionLastActivity: Object.fromEntries(
        Object.entries(s.sessionLastActivity).filter(([k]) => k !== currentSessionKey),
      ),
      sessionRunningState: clearSessionEntryFromMap(s.sessionRunningState ?? {}, currentSessionKey),
    }));
  },

  // ── Load chat history ──

  loadHistory: async (quiet = false) => {
    const currentState = get();
    const { currentSessionKey } = currentState;
    const shouldSkipUnusedDraftHydration = (
      currentSessionKey.includes(':session-')
      && isUnusedDraftSession(currentState, currentSessionKey)
      && !currentState.sessions.some((session) => session.key === currentSessionKey)
    );
    if (shouldSkipUnusedDraftHydration) {
      if (currentState.loading) {
        set((state) => (
          state.currentSessionKey === currentSessionKey && state.loading
            ? { loading: false }
            : {}
        ));
      }
      return;
    }
    const existingLoad = _historyLoadInFlight.get(currentSessionKey);
    if (existingLoad) {
      await existingLoad.promise;
      if (quiet || !existingLoad.quiet) {
        return;
      }
    }

    const lastLoadAt = _lastHistoryLoadAtBySession.get(currentSessionKey) || 0;
    if (quiet && Date.now() - lastLoadAt < HISTORY_LOAD_MIN_INTERVAL_MS) {
      return;
    }

    if (!quiet) set({ loading: true, error: null });

    // Safety guard: if history loading takes too long, force loading to false
    // to prevent the UI from being stuck in a spinner forever.
    let loadingTimedOut = false;
    const loadingSafetyTimer = quiet ? null : setTimeout(() => {
      loadingTimedOut = true;
      set({ loading: false });
    }, 15_000);

    const loadPromise = (async () => {
      const isCurrentSession = () => get().currentSessionKey === currentSessionKey;
      const getPreviewMergeKey = (message: RawMessage): string => (
        `${message.id ?? ''}|${message.role}|${message.timestamp ?? ''}|${getComparableMessageText(message)}`
      );
      const messageExistsIn = (messagesToScan: RawMessage[], candidate: RawMessage): boolean => {
        if (candidate.id && messagesToScan.some((message) => message.id === candidate.id)) {
          return true;
        }
        const candidateKey = getPreviewMergeKey(candidate);
        const candidateText = getComparableMessageText(candidate);
        return messagesToScan.some((message) => (
          getPreviewMergeKey(message) === candidateKey
          || (
            candidate.role === 'assistant'
            && message.role === candidate.role
            && candidateText.length > 0
            && getComparableMessageText(message) === candidateText
          )
        ));
      };
      const preservePendingAssistantMessages = (
        currentMessages: RawMessage[],
        loadedMessages: RawMessage[],
        lastUserTimestamp: number | null,
      ): RawMessage[] => {
        if (!lastUserTimestamp) return loadedMessages;

        const userMs = toMs(lastUserTimestamp);
        const localTurnAssistants = currentMessages.filter((message) => (
          message.role === 'assistant'
          && !!message.timestamp
          && toMs(message.timestamp) >= userMs
          && !isInternalAssistantControlMessage(message)
        ));
        const currentStreamingMessage = get().streamingMessage;
        if (
          currentStreamingMessage
          && typeof currentStreamingMessage === 'object'
          && !isToolResultRole((currentStreamingMessage as RawMessage).role)
        ) {
          const streamingAssistant = currentStreamingMessage as RawMessage;
          const streamingRole = streamingAssistant.role;
          const streamingTimestamp = typeof streamingAssistant.timestamp === 'number'
            ? toMs(streamingAssistant.timestamp)
            : userMs;
          if (
            (streamingRole === 'assistant' || streamingRole === undefined)
            && streamingTimestamp >= userMs
            && hasNonToolAssistantContent(streamingAssistant)
            && !isInternalAssistantControlMessage(streamingAssistant)
          ) {
            localTurnAssistants.push({
              ...streamingAssistant,
              role: 'assistant',
              timestamp: streamingAssistant.timestamp ?? ((userMs + 1) / 1000),
            });
          }
        }
        if (localTurnAssistants.length === 0) return loadedMessages;

        let lastMatchedLocalIndex = -1;
        localTurnAssistants.forEach((message, index) => {
          if (messageExistsIn(loadedMessages, message)) {
            lastMatchedLocalIndex = index;
          }
        });

        const missingSuffix = localTurnAssistants
          .slice(lastMatchedLocalIndex + 1)
          .filter((message) => !messageExistsIn(loadedMessages, message));

        return missingSuffix.length > 0
          ? [...loadedMessages, ...missingSuffix]
          : loadedMessages;
      };
      const mergeHydratedMessages = (
        currentMessages: RawMessage[],
        hydratedMessages: RawMessage[],
      ): RawMessage[] => {
        const hydratedFilesByKey = new Map(
          hydratedMessages
            .filter((message) => message._attachedFiles?.length)
            .map((message) => [
              getPreviewMergeKey(message),
              message._attachedFiles!.map((file) => ({ ...file })),
            ]),
        );

        return currentMessages.map((message) => {
          const attachedFiles = hydratedFilesByKey.get(getPreviewMergeKey(message));
          return attachedFiles
            ? { ...message, _attachedFiles: attachedFiles }
            : message;
        });
      };
      const mergeDeferredCurrentTurnMessages = (
        currentMessages: RawMessage[],
        hydratedMessages: RawMessage[],
        lastUserTimestamp: number | null,
      ): { messages: RawMessage[]; appendedProcessCount: number } => {
        const mergedCurrent = mergeHydratedMessages(currentMessages, hydratedMessages);
        if (!lastUserTimestamp) return { messages: mergedCurrent, appendedProcessCount: 0 };

        const userMs = toMs(lastUserTimestamp);
        const existingKeys = new Set(mergedCurrent.map((message) => getPreviewMergeKey(message)));
        const deferredProcessMessages = hydratedMessages.filter((message) => (
          message.role === 'assistant'
          && !!message.timestamp
          && toMs(message.timestamp) >= userMs
          && !hasNonToolAssistantContent(message)
          && !existingKeys.has(getPreviewMergeKey(message))
        ));

        if (deferredProcessMessages.length === 0) {
          return { messages: mergedCurrent, appendedProcessCount: 0 };
        }

        const lastUserIndex = findLastUserMessageIndex(mergedCurrent);
        if (lastUserIndex < 0) {
          return {
            messages: [...mergedCurrent, ...deferredProcessMessages].sort((left, right) => (left.timestamp ?? 0) - (right.timestamp ?? 0)),
            appendedProcessCount: deferredProcessMessages.length,
          };
        }

        const beforeTurn = mergedCurrent.slice(0, lastUserIndex + 1);
        const turnTail = [...mergedCurrent.slice(lastUserIndex + 1), ...deferredProcessMessages].sort(
          (left, right) => (left.timestamp ?? 0) - (right.timestamp ?? 0),
        );
        return {
          messages: [...beforeTurn, ...turnTail],
          appendedProcessCount: deferredProcessMessages.length,
        };
      };

      const applyLoadFailure = (errorMessage: string | null) => {
        if (!isCurrentSession()) return;
        clearHistoryIncompleteRetry(currentSessionKey);
        set((state) => {
          const hasMessages = state.messages.length > 0;
          return {
            loading: false,
            error: !quiet && errorMessage ? errorMessage : state.error,
            ...(hasMessages ? {} : { messages: [] as RawMessage[] }),
          };
        });
      };

      const applyLoadedMessages = (rawMessages: RawMessage[], thinkingLevel: string | null) => {
      // Guard: if the user switched sessions while this async load was in
      // flight, discard the result to prevent overwriting the new session's
      // messages with stale data from the old session.
      if (!isCurrentSession()) return;

      // Before filtering: attach images/files from tool_result messages to the next assistant message
      const messagesWithToolImages = enrichWithToolResultFiles(rawMessages);
      const normalizedMessages = messagesWithToolImages.map((msg) => createToolResultProcessMessage(msg) ?? msg);
      const filteredMessages = normalizedMessages.filter((msg) => !isToolResultRole(msg.role) && !isInternalMessage(msg));
      // Restore file attachments for user/assistant messages (from cache + text patterns)
      const enrichedMessages = enrichWithCachedImages(filteredMessages);

      // Preserve the optimistic user message during an active send.
      // The Gateway may not include the user's message in chat.history
      // until the run completes, causing it to flash out of the UI.
      let finalMessages = enrichedMessages;
      const userMsgAt = get().lastUserMessageAt;
      const historyUserMsForPreserve = userMsgAt ? toMs(userMsgAt) : 0;
      const loadedHistoryHasSettledAssistant = [...filteredMessages].some((message) => {
        if (message.role !== 'assistant') return false;
        if (historyUserMsForPreserve && message.timestamp && toMs(message.timestamp) < historyUserMsForPreserve) {
          return false;
        }
        return hasAssistantFinalTextContent(message) || isEmptyAssistantResponse(message);
      });
      if (get().sending && userMsgAt) {
        const userMsMs = toMs(userMsgAt);
        const currentMsgs = get().messages;
        const optimisticUser = [...currentMsgs].reverse().find(
          (m) => m.role === 'user' && m.timestamp && Math.abs(toMs(m.timestamp) - userMsMs) < 5000,
        );
        const optimisticUserText = getComparableMessageText(optimisticUser);
        const hasRecentUser = enrichedMessages.some((m) => {
          if (m.role !== 'user') return false;
          if (m.timestamp && Math.abs(toMs(m.timestamp) - userMsMs) < 5000) {
            return true;
          }
          if (!optimisticUser || !optimisticUserText) return false;
          const loadedText = getComparableMessageText(m);
          if (!loadedText || loadedText !== optimisticUserText) return false;
          if (!m.timestamp) return true;
          return Math.abs(toMs(m.timestamp) - userMsMs) < 60_000;
        });
        if (!hasRecentUser) {
          if (optimisticUser) {
            finalMessages = [...enrichedMessages, optimisticUser];
          }
        }
      }
      if (get().sending && !loadedHistoryHasSettledAssistant) {
        finalMessages = preservePendingAssistantMessages(get().messages, finalMessages, userMsgAt);
      }

      const {
        pendingFinal: historyPendingFinal,
        lastUserMessageAt: historyLastUserMessageAt,
        sending: historyIsSendingNow,
      } = get();
      const liveTurnSignal = hasLiveTurnSignal(get());
      const hasBlockingLiveTurnSignal = liveTurnSignal
        && Date.now() - _lastChatEventAt < HISTORY_POLL_SILENCE_WINDOW_MS;

      const historyUserMsTs = historyLastUserMessageAt ? toMs(historyLastUserMessageAt) : 0;
      const isAfterHistoryUserMsg = (msg: RawMessage): boolean => {
        if (!historyUserMsTs || !msg.timestamp) return true;
        return toMs(msg.timestamp) >= historyUserMsTs;
      };

      const shouldEnterHistoryPendingFinal = historyIsSendingNow && !historyPendingFinal && !hasBlockingLiveTurnSignal && [...filteredMessages].reverse().some((msg) => {
        if (msg.role !== 'assistant') return false;
        return isAfterHistoryUserMsg(msg);
      });

      const observedHistoryRecentAssistant = [...filteredMessages].reverse().find((msg) => {
        if (msg.role !== 'assistant') return false;
        if (!hasAssistantFinalTextContent(msg)) return false;
        return isAfterHistoryUserMsg(msg);
      });
      const observedHistoryEmptyAssistant = [...filteredMessages].reverse().find((msg) => (
        msg.role === 'assistant'
        && isAfterHistoryUserMsg(msg)
        && isEmptyAssistantResponse(msg)
      ));
      const shouldDeferSettledHistoryFinal = historyIsSendingNow
        && !historyPendingFinal
        && hasBlockingLiveTurnSignal
        && !!(observedHistoryRecentAssistant || observedHistoryEmptyAssistant);
      const historyRecentAssistant = (historyPendingFinal || shouldEnterHistoryPendingFinal)
        ? observedHistoryRecentAssistant
        : undefined;
      const historyEmptyAssistant = (historyPendingFinal || shouldEnterHistoryPendingFinal)
        ? observedHistoryEmptyAssistant
        : undefined;
      const staleStreamingReferenceTs = (() => {
        const currentStreamingMessage = get().streamingMessage;
        if (currentStreamingMessage && typeof currentStreamingMessage === 'object') {
          const streamingTimestamp = (currentStreamingMessage as RawMessage).timestamp;
          if (typeof streamingTimestamp === 'number') {
            return toMs(streamingTimestamp);
          }
        }
        return historyLastUserMessageAt ? toMs(historyLastUserMessageAt) : 0;
      })();
      const historySettledAssistant = !historyIsSendingNow
        ? [...filteredMessages].reverse().find((msg) => {
            if (msg.role !== 'assistant') return false;
            if (!hasAssistantFinalTextContent(msg)) return false;
            if (!isAfterHistoryUserMsg(msg)) return false;
            if (!staleStreamingReferenceTs || typeof msg.timestamp !== 'number') return true;
            return toMs(msg.timestamp) >= staleStreamingReferenceTs;
          })
        : undefined;
      const shouldClearSettledStreamingState = !historyIsSendingNow
        && !!historySettledAssistant
        && (
          get().streamingMessage != null
          || (typeof get().streamingText === 'string' && get().streamingText.trim().length > 0)
          || get().streamingTools.length > 0
          || get().pendingToolImages.length > 0
        );
      const trailingUserIndex = findLastUserMessageIndex(finalMessages);
      const trailingUser = trailingUserIndex >= 0 ? finalMessages[trailingUserIndex] : undefined;
      const shouldRetryIncompleteHistory = !historyIsSendingNow
        && !historyPendingFinal
        && !!trailingUser
        && typeof trailingUser.timestamp === 'number'
        && Date.now() - toMs(trailingUser.timestamp) <= HISTORY_INCOMPLETE_RETRY_WINDOW_MS
        && !finalMessages.slice(trailingUserIndex + 1).some((message) => message.role === 'assistant');

      const shouldDeferHistoryCurrentTurn = historyIsSendingNow && !historyPendingFinal && hasBlockingLiveTurnSignal;
      const deferredMergeResult = shouldDeferHistoryCurrentTurn
        ? mergeDeferredCurrentTurnMessages(get().messages, finalMessages, historyLastUserMessageAt)
        : { messages: finalMessages, appendedProcessCount: 0 };
      const mergedMessagesForActiveSend = deferredMergeResult.messages;

      if (historyRecentAssistant || historyEmptyAssistant || shouldDeferSettledHistoryFinal) {
        clearHistoryPoll();
      }
      if (shouldRetryIncompleteHistory) {
        scheduleHistoryIncompleteRetry(get, currentSessionKey);
      } else {
        clearHistoryIncompleteRetry(currentSessionKey);
      }

      set((state) => {
        const shouldFinalizeFromHistory = historyRecentAssistant && !shouldDeferHistoryCurrentTurn;
        const shouldFinalizeEmptyAssistant = historyEmptyAssistant && !shouldDeferHistoryCurrentTurn;
        const nextIsRunning = shouldFinalizeFromHistory || shouldFinalizeEmptyAssistant
          ? false
          : historyIsSendingNow;

        return {
          messages: mergedMessagesForActiveSend,
          thinkingLevel,
          loading: false,
          sessionRunningState: updateSessionRunningState(
            state.sessionRunningState,
            currentSessionKey,
            nextIsRunning,
          ),
          ...(shouldFinalizeFromHistory
            ? {
                sending: false,
                activeRunId: null,
                sendStage: null,
                pendingFinal: false,
                streamingText: '',
                streamingMessage: null,
                streamingTools: [],
                pendingToolImages: [],
              }
            : shouldFinalizeEmptyAssistant
              ? {
                  sending: false,
                  activeRunId: null,
                  sendStage: null,
                  pendingFinal: false,
                  lastUserMessageAt: null,
                  streamingText: '',
                  streamingMessage: null,
                  streamingTools: [],
                  pendingToolImages: [],
                  error: EMPTY_ASSISTANT_RESPONSE_ERROR,
                }
            : shouldEnterHistoryPendingFinal
              || shouldDeferSettledHistoryFinal
              || (shouldDeferHistoryCurrentTurn && deferredMergeResult.appendedProcessCount > 0)
                ? { pendingFinal: true, sendStage: 'finalizing' }
                : shouldClearSettledStreamingState
                  ? {
                      sending: false,
                      activeRunId: null,
                      sendStage: null,
                      pendingFinal: false,
                      streamingText: '',
                      streamingMessage: null,
                      streamingTools: [],
                      pendingToolImages: [],
                    }
                : {}),
        };
      });

      if (shouldDeferSettledHistoryFinal) {
        const lastChatEventAgeMs = _lastChatEventAt > 0
          ? Math.max(0, Date.now() - _lastChatEventAt)
          : HISTORY_POLL_SILENCE_WINDOW_MS;
        const followupDelayMs = Math.max(200, HISTORY_POLL_SILENCE_WINDOW_MS - lastChatEventAgeMs + 80);
        schedulePendingFinalRecovery(set, get, { delayMs: followupDelayMs });
      }

      let recoveredAutoLabel = '';
      let shouldPersistRecoveredAutoLabel = false;
      if (!currentSessionKey.endsWith(':main')) {
        const firstUserMsg = mergedMessagesForActiveSend.find((m) => m.role === 'user');
        if (firstUserMsg) {
          recoveredAutoLabel = truncateAutoSessionLabel(getSessionLabelText(firstUserMsg.content));
          set((s) => {
            const hasStoredLabel = hasStoredSessionLabel(s.sessions, currentSessionKey);
            if (!recoveredAutoLabel || hasStoredLabel) {
              return {};
            }
            shouldPersistRecoveredAutoLabel = true;
            if (s.sessionLabels[currentSessionKey] === recoveredAutoLabel) {
              return {};
            }
            return {
              sessionLabels: { ...s.sessionLabels, [currentSessionKey]: recoveredAutoLabel },
            };
          });
        }
      }
      if (shouldPersistRecoveredAutoLabel && recoveredAutoLabel) {
        queueAutoSessionLabelPersistence(set, currentSessionKey, recoveredAutoLabel);
      }

      // Extract first user message text as a session label for display in the toolbar.
      // Skip main sessions (key ends with ":main") — they rely on the Gateway-provided
      // displayName (e.g. the configured agent name "ClawX") instead.
      const isMainSession = currentSessionKey.endsWith(':main');
      if (!isMainSession) {
        const firstUserMsg = mergedMessagesForActiveSend.find((m) => m.role === 'user');
        if (firstUserMsg) {
          const labelText = getSessionLabelText(firstUserMsg.content);
          set((s) => {
            const hasStoredLabel = hasStoredSessionLabel(s.sessions, currentSessionKey);
            if (!labelText || s.sessionLabels[currentSessionKey] || hasStoredLabel) {
              return {};
            }
            const truncated = labelText.length > 50 ? `${labelText.slice(0, 50)}…` : labelText;
            return {
              sessionLabels: { ...s.sessionLabels, [currentSessionKey]: truncated },
            };
          });
        }
      }

      // Record last activity time from the last message in history
      const lastMsg = mergedMessagesForActiveSend[mergedMessagesForActiveSend.length - 1];
      if (lastMsg?.timestamp) {
        const lastAt = toMs(lastMsg.timestamp);
        set((s) => ({
          sessionLastActivity: { ...s.sessionLastActivity, [currentSessionKey]: lastAt },
        }));
      }

      // Async: load missing image previews from disk (updates in background)
      loadMissingPreviews(mergedMessagesForActiveSend, currentSessionKey).then((updated) => {
        if (!isCurrentSession()) return;
        if (updated) {
          set((state) => ({
            messages: mergeHydratedMessages(state.messages, mergedMessagesForActiveSend),
          }));
        }
      });
      };

      try {
        const shouldTryLocalSessionHistory = !isCronSessionKey(currentSessionKey)
          && !get().sending;
        if (shouldTryLocalSessionHistory) {
          const localHistory = await loadLocalSessionHistory(currentSessionKey, 200);
          if (localHistory.resolved) {
            applyLoadedMessages(localHistory.messages, localHistory.thinkingLevel);
            return;
          }
        }

        const data = await useGatewayStore.getState().rpc<Record<string, unknown>>(
          'chat.history',
          { sessionKey: currentSessionKey, limit: 200 },
          CHAT_HISTORY_RPC_TIMEOUT_MS,
        );
        if (data) {
          let rawMessages = Array.isArray(data.messages) ? data.messages as RawMessage[] : [];
          const thinkingLevel = data.thinkingLevel ? String(data.thinkingLevel) : null;
          if (rawMessages.length === 0 && isCronSessionKey(currentSessionKey)) {
            rawMessages = await loadCronFallbackMessages(currentSessionKey, 200);
          }

          applyLoadedMessages(rawMessages, thinkingLevel);
        } else {
          const fallbackMessages = await loadCronFallbackMessages(currentSessionKey, 200);
          if (fallbackMessages.length > 0) {
            applyLoadedMessages(fallbackMessages, null);
          } else {
            applyLoadFailure('Failed to load chat history');
          }
        }
      } catch (err) {
        console.warn('Failed to load chat history:', err);
        const fallbackMessages = await loadCronFallbackMessages(currentSessionKey, 200);
        if (fallbackMessages.length > 0) {
          applyLoadedMessages(fallbackMessages, null);
        } else {
          applyLoadFailure(String(err));
        }
      }
    })();

    _historyLoadInFlight.set(currentSessionKey, { promise: loadPromise, quiet });
    try {
      await loadPromise;
    } finally {
      // Clear the safety timer on normal completion
      if (loadingSafetyTimer) clearTimeout(loadingSafetyTimer);
      if (!loadingTimedOut) {
        // Only update load time if we actually didn't time out
        _lastHistoryLoadAtBySession.set(currentSessionKey, Date.now());
      }
      
      const active = _historyLoadInFlight.get(currentSessionKey);
      if (active?.promise === loadPromise) {
        _historyLoadInFlight.delete(currentSessionKey);
      }
    }
  },

  // ── Send message ──

  sendMessage: async (
    text: string,
    attachments?: Array<{ fileName: string; mimeType: string; fileSize: number; stagedPath: string; preview: string | null }>,
    targetAgentId?: string | null,
    options?: ChatMessageDispatchOptions,
  ) => {
    const trimmed = text.trim();
    if (!trimmed && (!attachments || attachments.length === 0)) return;

    const explicitSessionKey = (options?.sessionKey || '').trim();
    const explicitModelRef = (options?.modelRef || '').trim() || null;
    const targetSessionKey = explicitSessionKey
      || resolveMainSessionKeyForAgent(targetAgentId)
      || get().currentSessionKey;

    if (targetSessionKey !== get().currentSessionKey) {
      clearErrorRecoveryTimer();
      cancelPendingDeltaFlush();
      resetPendingDeltaState();
      set((s) => buildSessionSwitchPatch(s, targetSessionKey));
      await get().loadHistory(true);
    }

    const currentSessionKey = targetSessionKey;
    clearHistoryIncompleteRetry(currentSessionKey);
    if (!explicitModelRef) {
      await ensureSessionPreferredModelLoaded(currentSessionKey, set);
    }
    const existingMessages = get().messages;
    const existingSessions = get().sessions;
    const existingSessionLabels = get().sessionLabels;
    const isFirstUserMessage = !existingMessages.some((message) => message.role === 'user');
    const baseMessage = trimmed || (attachments?.length ? 'Process the attached file(s).' : '');
    const messageForGateway = injectAgentExecutionMetadata(
      baseMessage,
      currentSessionKey,
      isFirstUserMessage,
      explicitModelRef,
    );
    const visibleUserContent = trimmed || (attachments?.length ? '(file attached)' : '');
    const autoSessionLabel = !currentSessionKey.endsWith(':main')
      && isFirstUserMessage
      && !existingSessionLabels[currentSessionKey]
      && !hasStoredSessionLabel(existingSessions, currentSessionKey)
      && trimmed
      ? truncateAutoSessionLabel(trimmed)
      : '';

    // Add user message optimistically (with local file metadata for UI display)
    const nowMs = Date.now();
    const userMsg: RawMessage = {
      role: 'user',
      content: visibleUserContent,
      timestamp: nowMs / 1000,
      id: crypto.randomUUID(),
      _attachedFiles: attachments?.map(a => ({
        fileName: a.fileName,
        mimeType: a.mimeType,
        fileSize: a.fileSize,
        preview: a.preview,
        filePath: a.stagedPath,
      })),
    };
      set((s) => ({
        sessions: ensureSessionEntry(s.sessions, currentSessionKey),
        messages: [...s.messages, userMsg],
        ...(autoSessionLabel && !s.sessionLabels[currentSessionKey]
          ? { sessionLabels: { ...s.sessionLabels, [currentSessionKey]: autoSessionLabel } }
          : {}),
        sending: true,
        error: null,
        streamingText: '',
        streamingMessage: null,
        streamingTools: [],
        sendStage: 'sending_to_gateway',
        pendingFinal: false,
        lastUserMessageAt: nowMs,
        sessionRunningState: updateSessionRunningState(s.sessionRunningState, currentSessionKey, true),
      }));

    // Update session label with first user message text as soon as it's sent
    const { sessionLabels, messages, sessions } = get();
    const isFirstMessage = !messages.slice(0, -1).some((m) => m.role === 'user');
    const hasStoredLabel = hasStoredSessionLabel(sessions, currentSessionKey);
    if (!currentSessionKey.endsWith(':main') && isFirstMessage && !sessionLabels[currentSessionKey] && !hasStoredLabel && trimmed) {
      const truncated = trimmed.length > 50 ? `${trimmed.slice(0, 50)}…` : trimmed;
      set((s) => ({ sessionLabels: { ...s.sessionLabels, [currentSessionKey]: truncated } }));
    }

    // Mark this session as most recently active
    set((s) => ({ sessionLastActivity: { ...s.sessionLastActivity, [currentSessionKey]: nowMs } }));

    // Start the history poll and safety timeout IMMEDIATELY (before the
    // RPC await) because the gateway's chat.send RPC may block until the
    // entire agentic conversation finishes — the poll must run in parallel.
    _lastChatEventAt = Date.now();
    clearHistoryPoll();
    clearErrorRecoveryTimer();
    startHistoryPoll(get, currentSessionKey);

    const SAFETY_TIMEOUT_MS = 90_000;
    const STREAMING_STALE_TIMEOUT_MS = 15_000;
    const checkStuck = () => {
      const state = get();
      if (!state.sending) return;
      if (state.streamingMessage || state.streamingText) {
        if (Date.now() - _lastChatEventAt >= STREAMING_STALE_TIMEOUT_MS) {
          const finalized = finalizeStreamingAssistantIfStale(set, get);
          if (finalized) {
            clearHistoryPoll();
            return;
          }
        }
        setTimeout(checkStuck, 10_000);
        return;
      }
      if (state.pendingFinal) {
        setTimeout(checkStuck, 10_000);
        return;
      }
      if (Date.now() - _lastChatEventAt < SAFETY_TIMEOUT_MS) {
        setTimeout(checkStuck, 10_000);
        return;
      }
      clearHistoryPoll();
      set((s) => ({
        error: getNoResponseError(),
        sending: false,
        activeRunId: null,
        sendStage: null,
        lastUserMessageAt: null,
        sessionRunningState: updateSessionRunningState(s.sessionRunningState, currentSessionKey, false),
      }));
    };
    setTimeout(checkStuck, 30_000);

    try {
      const idempotencyKey = crypto.randomUUID();
      const hasMedia = attachments && attachments.length > 0;
      if (hasMedia) {
        console.log('[sendMessage] Media paths:', attachments!.map(a => a.stagedPath));
      }

      await syncSessionPreferredModelToRuntime(currentSessionKey, explicitModelRef);

      // Cache image attachments BEFORE the IPC call to avoid race condition:
      // history may reload (via Gateway event) before the RPC returns.
      // Keyed by staged file path which appears in [media attached: <path> ...].
      if (hasMedia && attachments) {
        for (const a of attachments) {
          _imageCache.set(a.stagedPath, {
            fileName: a.fileName,
            mimeType: a.mimeType,
            fileSize: a.fileSize,
            preview: a.preview,
          });
        }
        saveImageCache(_imageCache);
      }

      let result: { success: boolean; result?: { runId?: string }; error?: string };

      // Longer timeout for chat sends to tolerate high-latency networks (avoids connect error)
      const CHAT_SEND_TIMEOUT_MS = 120_000;

      if (hasMedia) {
        result = await hostApiFetch<{ success: boolean; result?: { runId?: string }; error?: string }>(
          '/api/chat/send-with-media',
          {
            method: 'POST',
            body: JSON.stringify({
              sessionKey: currentSessionKey,
              message: messageForGateway || 'Process the attached file(s).',
              deliver: false,
              idempotencyKey,
              media: attachments.map((a) => ({
                filePath: a.stagedPath,
                mimeType: a.mimeType,
                fileName: a.fileName,
              })),
            }),
          },
        );
      } else {
        const rpcResult = await useGatewayStore.getState().rpc<{ runId?: string }>(
          'chat.send',
          {
            sessionKey: currentSessionKey,
            message: messageForGateway,
            deliver: false,
            idempotencyKey,
          },
          CHAT_SEND_TIMEOUT_MS,
        );
        result = { success: true, result: rpcResult };
      }

      console.log(`[sendMessage] RPC result: success=${result.success}, runId=${result.result?.runId || 'none'}`);

        if (!result.success) {
        const errorMsg = result.error || 'Failed to send message';
        if (isRecoverableChatSendTimeout(errorMsg)) {
          console.warn(`[sendMessage] Recoverable chat.send timeout, keeping poll alive: ${errorMsg}`);
          set({ error: localizeChatErrorDetail(errorMsg) || errorMsg });
        } else {
          clearHistoryPoll();
          const errorReply = createLocalAssistantMessage(getSendFailedError(errorMsg), {
            isError: true,
            idPrefix: 'send-failed',
          });
          set((s) => ({
            messages: appendAssistantMessage(s.messages, errorReply),
            error: null,
            sending: false,
            activeRunId: null,
            sendStage: null,
            lastUserMessageAt: null,
            streamingText: '',
            streamingMessage: null,
            streamingTools: [],
            pendingFinal: false,
            pendingToolImages: [],
            sessionRunningState: updateSessionRunningState(s.sessionRunningState, currentSessionKey, false),
          }));
        }
      } else if (autoSessionLabel) {
        queueAutoSessionLabelPersistence(set, currentSessionKey, autoSessionLabel);
        if (result.result?.runId) {
          set({ activeRunId: result.result.runId, sendStage: 'awaiting_runtime' });
        } else {
          set({ sendStage: 'awaiting_runtime' });
        }
      } else if (result.result?.runId) {
        set({ activeRunId: result.result.runId, sendStage: 'awaiting_runtime' });
      } else {
        set({ sendStage: 'awaiting_runtime' });
      }
    } catch (err) {
      const errStr = String(err);
      if (isRecoverableChatSendTimeout(errStr)) {
        console.warn(`[sendMessage] Recoverable chat.send timeout, keeping poll alive: ${errStr}`);
        set({ error: localizeChatErrorDetail(errStr) || errStr, sendStage: 'awaiting_runtime' });
      } else {
        clearHistoryPoll();
        const errorReply = createLocalAssistantMessage(getSendFailedError(errStr), {
          isError: true,
          idPrefix: 'send-exception',
        });
        set((s) => ({
          messages: appendAssistantMessage(s.messages, errorReply),
          error: null,
          sending: false,
          activeRunId: null,
          sendStage: null,
          lastUserMessageAt: null,
          streamingText: '',
          streamingMessage: null,
          streamingTools: [],
          pendingFinal: false,
          pendingToolImages: [],
          sessionRunningState: updateSessionRunningState(s.sessionRunningState, currentSessionKey, false),
        }));
      }
    }
  },

  // ── Abort active run ──

  abortRun: async () => {
    clearHistoryPoll();
    clearErrorRecoveryTimer();
    const { currentSessionKey } = get();
    set((s) => ({
      sending: false,
      streamingText: '',
      streamingMessage: null,
      sendStage: null,
      pendingFinal: false,
      lastUserMessageAt: null,
      pendingToolImages: [],
      sessionRunningState: updateSessionRunningState(s.sessionRunningState, currentSessionKey, false),
    }));
    set({ streamingTools: [] });

    try {
      await useGatewayStore.getState().rpc(
        'chat.abort',
        { sessionKey: currentSessionKey },
      );
    } catch (err) {
      set({ error: localizeChatErrorDetail(String(err)) || String(err) });
    }
  },

  // ── Handle incoming chat events from Gateway ──

  handleChatEvent: (event: Record<string, unknown>) => {
    const runId = String(event.runId || '');
    const eventState = String(event.state || '');
    const eventSessionKey = event.sessionKey != null ? String(event.sessionKey) : null;
    const { activeRunId, currentSessionKey, sessions } = get();
    const resolvedEventSessionKey = eventSessionKey != null
      ? resolveSessionKeyAlias(eventSessionKey, [currentSessionKey, ...sessions.map((session) => session.key)])
      : null;

    // Only process events for the current session (when sessionKey is present)
    if (resolvedEventSessionKey != null && !sessionKeysMatch(resolvedEventSessionKey, currentSessionKey)) return;

    // Only process events for the active run (or if no active run set)
    if (activeRunId && runId && runId !== activeRunId) return;

    if (isDuplicateChatEvent(eventState, event)) return;

    _lastChatEventAt = Date.now();

    // Defensive: if state is missing but we have a message, try to infer state.
    let resolvedState = eventState;
    if (!resolvedState && event.message && typeof event.message === 'object') {
      const msg = event.message as Record<string, unknown>;
      const stopReason = msg.stopReason ?? msg.stop_reason;
      if (stopReason) {
        resolvedState = 'final';
      } else if (msg.role || msg.content) {
        resolvedState = 'delta';
      }
    }

    // Only pause the history poll when we receive actual streaming data.
    // The gateway sends "agent" events with { phase, startedAt } that carry
    // no message — these must NOT kill the poll, since the poll is our only
    // way to track progress when the gateway doesn't stream intermediate turns.
    const hasUsefulData = resolvedState === 'delta' || resolvedState === 'final'
      || resolvedState === 'error' || resolvedState === 'aborted';
    const shouldSuspendHistoryPoll = resolvedState === 'final'
      || resolvedState === 'error'
      || resolvedState === 'aborted';
    if (hasUsefulData) {
      if (shouldSuspendHistoryPoll) {
        clearHistoryPoll();
      }
      // Adopt run started from another client (e.g. console at 127.0.0.1:18789):
      // show loading/streaming in the app when this session has an active run.
      const { sending } = get();
      if (!sending && runId) {
        set((s) => ({
          sending: true,
          activeRunId: runId,
          error: null,
          sendStage: 'awaiting_runtime',
          sessionRunningState: updateSessionRunningState(s.sessionRunningState, currentSessionKey, true),
        }));
      }
    }

    clearPendingFinalRecoveryTimer();

    switch (resolvedState) {
      case 'started': {
        // Run just started (e.g. from console); show loading immediately.
        clearHistoryIncompleteRetry(currentSessionKey);
        const { sending: currentSending } = get();
        if (!currentSending && runId) {
          set((s) => ({
            sending: true,
            activeRunId: runId,
            error: null,
            sendStage: 'awaiting_runtime',
            sessionRunningState: updateSessionRunningState(s.sessionRunningState, currentSessionKey, true),
          }));
        }
        break;
      }
      case 'delta': {
        // Clear any stale error (including RPC timeout) when new data arrives.
        if (_errorRecoveryTimer) {
          clearErrorRecoveryTimer();
          pendingDeltaClearError = true;
        }
        const updates = collectToolUpdates(event.message, resolvedState);
        if (event.message && typeof event.message === 'object') {
          pendingDeltaMessage = event.message as RawMessage;
        }
        mergePendingDeltaUpdates(updates);
        set({ sendStage: 'running' });
        scheduleDeltaFlush(set);
        break;
      }
      case 'final': {
        flushPendingDelta(set);
        clearErrorRecoveryTimer();
        if (get().error) set({ error: null });
        // Message complete - add to history and clear streaming
        const finalMsg = event.message as RawMessage | undefined;
        if (finalMsg) {
          const updates = collectToolUpdates(finalMsg, resolvedState);
          if (isToolResultRole(finalMsg.role)) {
            const toolResultProcessMessage = createToolResultProcessMessage(finalMsg);
            // Resolve file path from the streaming assistant message's matching tool call
            const currentStreamForPath = get().streamingMessage as RawMessage | null;
            const matchedPath = (currentStreamForPath && finalMsg.toolCallId)
              ? getToolCallFilePath(currentStreamForPath, finalMsg.toolCallId)
              : undefined;

            // Mirror enrichWithToolResultFiles: collect images + file refs for next assistant msg
            const toolFiles: AttachedFileMeta[] = [
              ...extractImagesAsAttachedFiles(finalMsg.content),
            ];
            if (matchedPath) {
              for (const f of toolFiles) {
                if (!f.filePath) {
                  f.filePath = matchedPath;
                  f.fileName = matchedPath.split(/[\\/]/).pop() || 'image';
                }
              }
            }
            const text = getMessageText(finalMsg.content);
            if (text) {
              const mediaRefs = extractMediaRefs(text);
              const mediaRefPaths = new Set(mediaRefs.map(r => r.filePath));
              for (const ref of mediaRefs) toolFiles.push(makeAttachedFile(ref));
              for (const ref of extractRawFilePaths(text)) {
                if (!mediaRefPaths.has(ref.filePath)) toolFiles.push(makeAttachedFile(ref));
              }
            }
            set((s) => {
              // Snapshot the current streaming assistant message (thinking + tool_use) into
              // messages[] before clearing it. The Gateway does NOT send separate 'final'
              // events for intermediate tool-use turns — it only sends deltas and then the
              // tool result. Without snapshotting here, the intermediate thinking+tool steps
              // would be overwritten by the next turn's deltas and never appear in the UI.
              const currentStream = s.streamingMessage as RawMessage | null;
              const snapshotMsgs: RawMessage[] = [];
              if (currentStream) {
                const streamRole = currentStream.role;
                if (streamRole === 'assistant' || streamRole === undefined) {
                  // Use message's own id if available, otherwise derive a stable one from runId
                  const snapId = currentStream.id
                    || `${runId || 'run'}-turn-${s.messages.length}`;
                  if (!s.messages.some(m => m.id === snapId)) {
                    snapshotMsgs.push({
                      ...(currentStream as RawMessage),
                      role: 'assistant',
                      id: snapId,
                    });
                  }
                }
              }
              if (
                toolResultProcessMessage
                && !s.messages.some((message) => message.id === toolResultProcessMessage.id)
                && !snapshotMsgs.some((message) => message.id === toolResultProcessMessage.id)
              ) {
                snapshotMsgs.push(toolResultProcessMessage);
              }
              return {
                messages: snapshotMsgs.length > 0 ? [...s.messages, ...snapshotMsgs] : s.messages,
                streamingText: '',
                streamingMessage: null,
                sendStage: 'finalizing',
                pendingFinal: true,
                pendingToolImages: toolFiles.length > 0
                  ? [...s.pendingToolImages, ...toolFiles]
                  : s.pendingToolImages,
                streamingTools: updates.length > 0 ? upsertToolStatuses(s.streamingTools, updates) : s.streamingTools,
              };
            });
            schedulePendingFinalRecovery(set, get);
            break;
          }
          const toolOnly = isToolOnlyMessage(finalMsg);
          const pendingImgsSnapshot = get().pendingToolImages;
          const previewFinalMsg: RawMessage = pendingImgsSnapshot.length > 0
            ? {
              ...finalMsg,
              _attachedFiles: [...(finalMsg._attachedFiles || []), ...pendingImgsSnapshot],
            }
            : finalMsg;
          const hasOutput = hasNonToolAssistantContent(previewFinalMsg);
          const internalAssistantControlMessage = !toolOnly && isInternalAssistantControlMessage(previewFinalMsg);
          const emptyAssistantResponse = !toolOnly && isEmptyAssistantResponse(previewFinalMsg);
          const msgId = finalMsg.id || (toolOnly ? `run-${runId}-tool-${Date.now()}` : `run-${runId}`);
          set((s) => {
            const nextTools = updates.length > 0 ? upsertToolStatuses(s.streamingTools, updates) : s.streamingTools;
            const streamingTools = hasOutput ? [] : nextTools;

            // Attach any images collected from preceding tool results
            const pendingImgs = s.pendingToolImages;
            const msgWithImages: RawMessage = pendingImgs.length > 0
              ? {
                ...finalMsg,
                role: (finalMsg.role || 'assistant') as RawMessage['role'],
                id: msgId,
                _attachedFiles: [...(finalMsg._attachedFiles || []), ...pendingImgs],
              }
              : { ...finalMsg, role: (finalMsg.role || 'assistant') as RawMessage['role'], id: msgId };
            const clearPendingImages = { pendingToolImages: [] as AttachedFileMeta[] };

            if (internalAssistantControlMessage) {
              return {
                streamingText: '',
                streamingMessage: null,
                sending: false,
                activeRunId: null,
                sendStage: null,
                pendingFinal: false,
                streamingTools: [],
                sessionRunningState: updateSessionRunningState(s.sessionRunningState, currentSessionKey, false),
                ...clearPendingImages,
              };
            }

            // Check if message already exists (prevent duplicates)
            const alreadyExists = s.messages.some(m => m.id === msgId)
              || isEquivalentRecentAssistantMessage(s.messages, msgWithImages);
            if (alreadyExists) {
              return toolOnly ? {
                streamingText: '',
                streamingMessage: null,
                sendStage: 'finalizing',
                pendingFinal: true,
                streamingTools,
                sessionRunningState: updateSessionRunningState(s.sessionRunningState, currentSessionKey, s.sending),
                ...clearPendingImages,
              } : {
                streamingText: '',
                streamingMessage: null,
                sending: hasOutput ? false : s.sending,
                activeRunId: hasOutput ? null : s.activeRunId,
                sendStage: hasOutput ? null : 'finalizing',
                pendingFinal: hasOutput ? false : true,
                streamingTools,
                sessionRunningState: updateSessionRunningState(
                  s.sessionRunningState,
                  currentSessionKey,
                  !hasOutput && s.sending,
                ),
                ...clearPendingImages,
              };
            }
            if (emptyAssistantResponse) {
              const emptyReply = createLocalAssistantMessage(getEmptyAssistantResponseError(), {
                isError: true,
                idPrefix: 'empty-assistant-response',
              });
              return {
                messages: appendAssistantMessage([...s.messages, msgWithImages], emptyReply),
                streamingText: '',
                streamingMessage: null,
                sending: false,
                activeRunId: null,
                sendStage: null,
                pendingFinal: false,
                streamingTools,
                error: null,
                sessionRunningState: updateSessionRunningState(s.sessionRunningState, currentSessionKey, false),
                ...clearPendingImages,
              };
            }
            return toolOnly ? {
              messages: [...s.messages, msgWithImages],
              streamingText: '',
              streamingMessage: null,
              sendStage: 'finalizing',
              pendingFinal: true,
              streamingTools,
              sessionRunningState: updateSessionRunningState(s.sessionRunningState, currentSessionKey, s.sending),
              ...clearPendingImages,
            } : {
              messages: [...s.messages, msgWithImages],
              streamingText: '',
              streamingMessage: null,
              sending: hasOutput ? false : s.sending,
              activeRunId: hasOutput ? null : s.activeRunId,
              sendStage: hasOutput ? null : 'finalizing',
              pendingFinal: hasOutput ? false : true,
              streamingTools,
              sessionRunningState: updateSessionRunningState(
                s.sessionRunningState,
                currentSessionKey,
                !hasOutput && s.sending,
              ),
              ...clearPendingImages,
            };
          });
          if (internalAssistantControlMessage) {
            clearHistoryPoll();
            clearHistoryIncompleteRetry(currentSessionKey);
            void get().loadHistory(true);
            break;
          }
          if (toolOnly || !hasOutput) {
            schedulePendingFinalRecovery(set, get);
          }
          // After the final response, quietly reload history to surface all intermediate
          // tool-use turns (thinking + tool blocks) from the Gateway's authoritative record.
          if (hasOutput && !toolOnly) {
            clearHistoryPoll();
            clearHistoryIncompleteRetry(currentSessionKey);
          } else if (emptyAssistantResponse) {
            clearHistoryPoll();
            clearHistoryIncompleteRetry(currentSessionKey);
          }
        } else {
          // No message in final event - reload history to get complete data
          set((s) => ({
            streamingText: '',
            streamingMessage: null,
            sendStage: 'finalizing',
            pendingFinal: true,
            sessionRunningState: updateSessionRunningState(s.sessionRunningState, currentSessionKey, s.sending),
          }));
          schedulePendingFinalRecovery(set, get);
          get().loadHistory();
        }
        break;
      }
      case 'error': {
        flushPendingDelta(set);
        clearHistoryIncompleteRetry(currentSessionKey);
        const errorMsg = String(event.errorMessage || 'An error occurred');
        const wasSending = get().sending;

        // Snapshot the current streaming message into messages[] so partial
        // content ("Let me get that written down...") is preserved in the UI
        // rather than being silently discarded.
        const currentStream = get().streamingMessage as RawMessage | null;
        if (
          currentStream
          && (currentStream.role === 'assistant' || currentStream.role === undefined)
          && !isInternalAssistantControlMessage(currentStream)
        ) {
          const snapId = (currentStream as RawMessage).id
            || `error-snap-${Date.now()}`;
          const alreadyExists = get().messages.some(m => m.id === snapId);
          if (!alreadyExists) {
            set((s) => ({
              messages: [...s.messages, { ...currentStream, role: 'assistant' as const, id: snapId }],
            }));
          }
        }

        const errorReply = createLocalAssistantMessage(getSendFailedError(errorMsg), {
          isError: true,
          idPrefix: 'runtime-error',
        });
        set((s) => ({
          messages: appendAssistantMessage(s.messages, errorReply),
          error: null,
          streamingText: '',
          streamingMessage: null,
          streamingTools: [],
          sendStage: null,
          pendingFinal: false,
          pendingToolImages: [],
          sessionRunningState: updateSessionRunningState(s.sessionRunningState, currentSessionKey, wasSending),
        }));

        // Don't immediately give up: the Gateway often retries internally
        // after transient API failures (e.g. "terminated"). Keep `sending`
        // true for a grace period so that recovery events are processed and
        // the agent-phase-completion handler can still trigger loadHistory.
        if (wasSending) {
          clearErrorRecoveryTimer();
          const ERROR_RECOVERY_GRACE_MS = 15_000;
          _errorRecoveryTimer = setTimeout(() => {
            _errorRecoveryTimer = null;
            const state = get();
            if (state.sending && !state.streamingMessage) {
              clearHistoryPoll();
              // Grace period expired with no recovery — finalize the error
              set((s) => ({
                sending: false,
                activeRunId: null,
                sendStage: null,
                lastUserMessageAt: null,
                sessionRunningState: updateSessionRunningState(s.sessionRunningState, currentSessionKey, false),
              }));
              // One final history reload in case the Gateway completed in the
              // background and we just missed the event.
              state.loadHistory(true);
            }
          }, ERROR_RECOVERY_GRACE_MS);
        } else {
          clearHistoryPoll();
          set((s) => ({
            sending: false,
            activeRunId: null,
            sendStage: null,
            lastUserMessageAt: null,
            sessionRunningState: updateSessionRunningState(s.sessionRunningState, currentSessionKey, false),
          }));
        }
        break;
      }
      case 'aborted': {
        flushPendingDelta(set);
        clearHistoryPoll();
        clearErrorRecoveryTimer();
        clearHistoryIncompleteRetry(currentSessionKey);
        clearPendingFinalRecoveryTimer();
        set((s) => ({
          sending: false,
          activeRunId: null,
          streamingText: '',
          streamingMessage: null,
          streamingTools: [],
          sendStage: null,
          pendingFinal: false,
          lastUserMessageAt: null,
          pendingToolImages: [],
          sessionRunningState: updateSessionRunningState(s.sessionRunningState, currentSessionKey, false),
        }));
        break;
      }
      default: {
        flushPendingDelta(set);
        // Unknown or empty state — if we're currently sending and receive an event
        // with a message, attempt to process it as streaming data. This handles
        // edge cases where the Gateway sends events without a state field.
        const { sending } = get();
        if (sending && event.message && typeof event.message === 'object') {
          console.warn(`[handleChatEvent] Unknown event state "${resolvedState}", treating message as streaming delta. Event keys:`, Object.keys(event));
          const updates = collectToolUpdates(event.message, 'delta');
          set((s) => ({
            streamingMessage: event.message ?? s.streamingMessage,
            sendStage: 'running',
            streamingTools: updates.length > 0 ? upsertToolStatuses(s.streamingTools, updates) : s.streamingTools,
          }));
        }
        break;
      }
    }
  },

  // ── Toggle thinking visibility ──

  toggleThinking: () => set((s) => ({ showThinking: !s.showThinking })),

  // ── Refresh: reload history + sessions ──

  refresh: async () => {
    const { currentSessionKey, loadHistory, loadSessions } = get();
    clearHistoryIncompleteRetry(currentSessionKey);
    await loadSessions();
    await loadHistory();
  },

  clearError: () => set({ error: null }),

  queueOfflineMessage: (text, attachments, targetAgentId, options) => {
    const trimmed = text.trim();
    if (!trimmed && (!attachments || attachments.length === 0)) return;

    const explicitSessionKey = (options?.sessionKey || '').trim();
    const explicitModelRef = (options?.modelRef || '').trim() || null;
    const targetSessionKey = explicitSessionKey
      || resolveMainSessionKeyForAgent(targetAgentId)
      || get().currentSessionKey;
    const nowMs = Date.now();
    set((state) => ({
      queuedMessages: {
        ...state.queuedMessages,
        [targetSessionKey]: [
          ...(state.queuedMessages[targetSessionKey] ?? []),
          {
            id: crypto.randomUUID(),
            text: trimmed,
            attachments,
            targetAgentId,
            sessionKey: targetSessionKey,
            modelRef: explicitModelRef,
            queuedAt: nowMs,
          },
        ],
      },
      sessionLastActivity: { ...state.sessionLastActivity, [targetSessionKey]: nowMs },
      sessions: ensureSessionEntry(state.sessions, targetSessionKey),
    }));
  },

  clearQueuedMessage: (sessionKey, queuedId) => {
    const targetSessionKey = sessionKey ?? get().currentSessionKey;
    set((state) => ({
      queuedMessages: (() => {
        const currentQueue = state.queuedMessages[targetSessionKey] ?? [];
        if (!queuedId) {
          return clearSessionEntryFromMap(state.queuedMessages, targetSessionKey);
        }
        const nextQueue = currentQueue.filter((item) => item.id !== queuedId);
        if (nextQueue.length === 0) {
          return clearSessionEntryFromMap(state.queuedMessages, targetSessionKey);
        }
        return {
          ...state.queuedMessages,
          [targetSessionKey]: nextQueue,
        };
      })(),
    }));
  },

  flushQueuedMessage: async (sessionKey, queuedId) => {
    const targetSessionKey = sessionKey ?? get().currentSessionKey;
    const queue = get().queuedMessages[targetSessionKey] ?? [];
    const queued = queuedId
      ? queue.find((item) => item.id === queuedId)
      : queue[0];
    if (!queued || get().sending) return;
    set((state) => ({
      queuedMessages: (() => {
        const currentQueue = state.queuedMessages[targetSessionKey] ?? [];
        const nextQueue = currentQueue.filter((item) => item.id !== queued.id);
        if (nextQueue.length === 0) {
          return clearSessionEntryFromMap(state.queuedMessages, targetSessionKey);
        }
        return {
          ...state.queuedMessages,
          [targetSessionKey]: nextQueue,
        };
      })(),
    }));
    try {
      await get().sendMessage(
        queued.text,
        queued.attachments,
        queued.targetAgentId,
        {
          sessionKey: queued.sessionKey || targetSessionKey,
          modelRef: queued.modelRef ?? null,
        },
      );
    } catch (error) {
      set((state) => ({
        queuedMessages: {
          ...state.queuedMessages,
          [targetSessionKey]: [queued, ...(state.queuedMessages[targetSessionKey] ?? [])],
        },
        error: localizeChatErrorDetail(String(error)) || String(error),
      }));
    }
  },
  };
});
