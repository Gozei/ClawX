import { invokeIpc } from '@/lib/api-client';
import { hostApiFetch } from '@/lib/host-api';
import { useAgentsStore } from '@/stores/agents';
import {
  CHAT_HISTORY_LABEL_PREFETCH_LIMIT,
  CHAT_HISTORY_RPC_TIMEOUT_MS,
  getCanonicalPrefixFromSessions,
  getMessageText,
  hasStoredSessionLabel,
  isUnusedDraftSession,
  toMs,
} from './helpers';
import { DEFAULT_CANONICAL_PREFIX, DEFAULT_SESSION_KEY, type ChatSession, type RawMessage } from './types';
import type { ChatGet, ChatSet, SessionHistoryActions } from './store-api';

function getAgentIdFromSessionKey(sessionKey: string): string {
  if (!sessionKey.startsWith('agent:')) return 'main';
  const [, agentId] = sessionKey.split(':');
  return agentId || 'main';
}

function normalizeAgentId(value: string | undefined | null): string {
  return (value ?? '').trim().toLowerCase() || 'main';
}

function resolveDefaultCanonicalPrefix(): string {
  const defaultAgentId = normalizeAgentId(useAgentsStore.getState().defaultAgentId);
  return `agent:${defaultAgentId}`;
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

export function createSessionActions(
  set: ChatSet,
  get: ChatGet,
): Pick<SessionHistoryActions, 'loadSessions' | 'switchSession' | 'newSession' | 'renameSession' | 'toggleSessionPin' | 'archiveSession' | 'restoreSession' | 'deleteSession' | 'cleanupEmptySession'> {
  return {
    loadSessions: async () => {
      try {
        const result = await invokeIpc(
          'gateway:rpc',
          'sessions.list',
          {}
        ) as { success: boolean; result?: Record<string, unknown>; error?: string };

        if (result.success && result.result) {
          const data = result.result;
          const rawSessions = Array.isArray(data.sessions) ? data.sessions : [];
          const sessionKeys = rawSessions
            .map((session) => (typeof (session as Record<string, unknown>).key === 'string' ? String((session as Record<string, unknown>).key) : ''))
            .filter(Boolean);

          let persistedMetadata: Record<string, { pinned?: boolean; pinOrder?: number; archived?: boolean; archivedAt?: number; createdAt?: number }> = {};
          if (sessionKeys.length > 0) {
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

          const { currentSessionKey } = get();
          let nextSessionKey = currentSessionKey || DEFAULT_SESSION_KEY;
          if (!nextSessionKey.startsWith('agent:')) {
            const canonicalMatch = canonicalBySuffix.get(nextSessionKey);
            if (canonicalMatch) {
              nextSessionKey = canonicalMatch;
            }
          }
          const currentState = get();
          const currentIsUnusedDraft = isUnusedDraftSession(currentState, nextSessionKey);
          if (!dedupedSessions.find((s) => s.key === nextSessionKey) && dedupedSessions.length > 0) {
            // Current session not found in the backend list
            const isNewEmptySession = currentIsUnusedDraft;
            if (!isNewEmptySession) {
              nextSessionKey = dedupedSessions[0].key;
            }
          }

          const sessionsWithCurrent = !dedupedSessions.find((s) => s.key === nextSessionKey) && nextSessionKey && !isUnusedDraftSession(get(), nextSessionKey)
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

          set((state) => ({
            sessions: sessionsWithCurrent,
            currentSessionKey: nextSessionKey,
            currentAgentId: getAgentIdFromSessionKey(nextSessionKey),
            sessionLastActivity: {
              ...state.sessionLastActivity,
              ...discoveredActivity,
            },
          }));

          if (currentSessionKey !== nextSessionKey) {
            get().loadHistory();
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
            void hostApiFetch<{
              success: boolean;
              previews?: Record<string, { firstUserMessage: string | null }>;
            }>('/api/sessions/previews', {
              method: 'POST',
              body: JSON.stringify({ sessionKeys: sessionsToLabel.map((session) => session.key) }),
            }).then((result) => {
              if (!result?.success || !result.previews) return;
              set((s) => {
                const next: Partial<typeof s> = {};
                let nextSessionLabels = s.sessionLabels;
                let changed = false;

                for (const session of sessionsToLabel) {
                  const labelText = result.previews?.[session.key]?.firstUserMessage?.trim();
                  if (!labelText || s.sessionLabels[session.key] || hasStoredSessionLabel(s.sessions, session.key)) {
                    continue;
                  }
                  if (!changed) {
                    nextSessionLabels = { ...s.sessionLabels };
                    changed = true;
                  }
                  nextSessionLabels[session.key] = labelText.length > 50 ? `${labelText.slice(0, 50)}...` : labelText;
                }

                if (changed) {
                  next.sessionLabels = nextSessionLabels;
                }
                return next;
              });
            }).catch(() => {
              // ignore preview prefetch errors
            });
          }
          if (shouldUseGatewayHistoryLabelPrefetch && sessionsToLabel.length > 0) {
            void Promise.all(
              sessionsToLabel.map(async (session) => {
                try {
                  const r = await invokeIpc(
                    'gateway:rpc',
                    'chat.history',
                    { sessionKey: session.key, limit: CHAT_HISTORY_LABEL_PREFETCH_LIMIT },
                    CHAT_HISTORY_RPC_TIMEOUT_MS,
                  ) as { success: boolean; result?: Record<string, unknown> };
                  if (!r.success || !r.result) return;
                  const msgs = Array.isArray(r.result.messages) ? r.result.messages as RawMessage[] : [];
                  const firstUser = msgs.find((m) => m.role === 'user');
                  const lastMsg = msgs[msgs.length - 1];
                  set((s) => {
                    const next: Partial<typeof s> = {};
                    if (firstUser) {
                      const labelText = getMessageText(firstUser.content).trim();
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
                } catch { /* ignore per-session errors */ }
              }),
            );
          }
        }
      } catch (err) {
        console.warn('Failed to load sessions:', err);
      }
    },

    // ── Switch session ──

    switchSession: (key: string) => {
      const { currentSessionKey, messages, sessionLastActivity, sessionLabels } = get();
      // Only treat sessions with no history records and no activity timestamp as empty.
      // Relying solely on messages.length is unreliable because switchSession clears
      // the current messages before loadHistory runs, creating a race condition that
      // could cause sessions with real history to be incorrectly removed from the sidebar.
      const leavingEmpty = isUnusedDraftSession({ currentSessionKey, messages, sessions: get().sessions, sessionLastActivity, sessionLabels }, currentSessionKey);
      set((s) => ({
        currentSessionKey: key,
        currentAgentId: getAgentIdFromSessionKey(key),
        messages: [],
        streamingText: '',
        streamingMessage: null,
        streamingTools: [],
        activeRunId: null,
        error: null,
        pendingFinal: false,
        lastUserMessageAt: null,
        pendingToolImages: [],
        ...(leavingEmpty ? {
          sessions: s.sessions.filter((s) => s.key !== currentSessionKey),
          sessionLabels: Object.fromEntries(
            Object.entries(s.sessionLabels).filter(([k]) => k !== currentSessionKey),
          ),
          sessionLastActivity: Object.fromEntries(
            Object.entries(s.sessionLastActivity).filter(([k]) => k !== currentSessionKey),
          ),
        } : {}),
      }));
      get().loadHistory();
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
        const result = await invokeIpc('session:delete', key) as {
          success: boolean;
          error?: string;
        };
        if (!result.success) {
          console.warn(`[deleteSession] IPC reported failure for ${key}:`, result.error);
        }
      } catch (err) {
        console.warn(`[deleteSession] IPC call failed for ${key}:`, err);
      }

      const { currentSessionKey, sessions } = get();
      const remaining = sessions.filter((s) => s.key !== key);

      if (currentSessionKey === key) {
        // Switched away from deleted session — pick the first remaining or create new
        const next = remaining[0];
        set((s) => ({
          sessions: remaining,
          sessionLabels: Object.fromEntries(Object.entries(s.sessionLabels).filter(([k]) => k !== key)),
          sessionLastActivity: Object.fromEntries(Object.entries(s.sessionLastActivity).filter(([k]) => k !== key)),
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
          sessionLabels: Object.fromEntries(Object.entries(s.sessionLabels).filter(([k]) => k !== key)),
          sessionLastActivity: Object.fromEntries(Object.entries(s.sessionLastActivity).filter(([k]) => k !== key)),
        }));
      }
    },

    // ── New session ──

    newSession: () => {
      // Generate a new unique session key and switch to it.
      // NOTE: We intentionally do NOT call sessions.reset on the old session.
      // sessions.reset archives (renames) the session JSONL file, making old
      // conversation history inaccessible when the user switches back to it.
      const { currentSessionKey, messages, sessionLastActivity, sessionLabels, sessions } = get();
      const leavingEmpty = isUnusedDraftSession({ currentSessionKey, messages, sessions, sessionLastActivity, sessionLabels }, currentSessionKey);
      const prefix = resolveDefaultCanonicalPrefix() || getCanonicalPrefixFromSessions(get().sessions) || DEFAULT_CANONICAL_PREFIX;
      const newKey = `${prefix}:session-${Date.now()}`;
      set((s) => ({
        currentSessionKey: newKey,
        currentAgentId: getAgentIdFromSessionKey(newKey),
        sessions: leavingEmpty ? s.sessions.filter((sess) => sess.key !== currentSessionKey) : s.sessions,
        sessionLabels: leavingEmpty
          ? Object.fromEntries(Object.entries(s.sessionLabels).filter(([k]) => k !== currentSessionKey))
          : s.sessionLabels,
        sessionLastActivity: leavingEmpty
          ? Object.fromEntries(Object.entries(s.sessionLastActivity).filter(([k]) => k !== currentSessionKey))
          : s.sessionLastActivity,
        messages: [],
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

      const { currentSessionKey, sessions } = get();
      const remaining = sessions.filter((session) => session.key !== key);
      const next = remaining[0];

      set((s) => ({
        sessions: remaining,
        sessionLabels: Object.fromEntries(Object.entries(s.sessionLabels).filter(([sessionKey]) => sessionKey !== key)),
        sessionLastActivity: Object.fromEntries(Object.entries(s.sessionLastActivity).filter(([sessionKey]) => sessionKey !== key)),
        ...(currentSessionKey === key
          ? {
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
          }
          : {}),
      }));

      if (currentSessionKey === key && next) {
        get().loadHistory();
      }
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
      const { currentSessionKey, messages, sessionLastActivity, sessionLabels, sessions } = get();
      // Only remove non-main sessions that were never used (no messages sent).
      // This mirrors the "leavingEmpty" logic in switchSession so that creating
      // a new session and immediately navigating away doesn't leave a ghost entry
      // in the sidebar.
      // Also check sessionLastActivity and sessionLabels comprehensively to prevent
      // falsely treating sessions with history as empty due to switchSession clearing messages early.
      const isEmptyNonMain = isUnusedDraftSession({ currentSessionKey, messages, sessions, sessionLastActivity, sessionLabels }, currentSessionKey);
      if (!isEmptyNonMain) return;
      set((s) => ({
        sessions: s.sessions.filter((sess) => sess.key !== currentSessionKey),
        sessionLabels: Object.fromEntries(
          Object.entries(s.sessionLabels).filter(([k]) => k !== currentSessionKey),
        ),
        sessionLastActivity: Object.fromEntries(
          Object.entries(s.sessionLastActivity).filter(([k]) => k !== currentSessionKey),
        ),
      }));
    },

    // ── Load chat history ──

  };
}
