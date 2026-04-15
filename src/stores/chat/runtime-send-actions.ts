import { invokeIpc } from '@/lib/api-client';
import { buildAgentExecutionMetadata } from '@/lib/agent-execution-context';
import { useAgentsStore } from '@/stores/agents';
import {
  appendAssistantMessage,
  clearErrorRecoveryTimer,
  clearHistoryPoll,
  createLocalAssistantMessage,
  getLastChatEventAt,
  getChatNoticeMessage,
  getNoResponseError,
  getSendFailedError,
  hasNonToolAssistantContent,
  isToolResultRole,
  setHistoryPollTimer,
  setLastChatEventAt,
  upsertImageCacheEntry,
} from './helpers';
import type { ChatSession, RawMessage } from './types';
import type { ChatGet, ChatSet, RuntimeActions } from './store-api';

function normalizeAgentId(value: string | undefined | null): string {
  return (value ?? '').trim().toLowerCase() || 'main';
}

function getAgentIdFromSessionKey(sessionKey: string): string {
  if (!sessionKey.startsWith('agent:')) return 'main';
  const [, agentId] = sessionKey.split(':');
  return agentId || 'main';
}

function buildFallbackMainSessionKey(agentId: string): string {
  return `agent:${normalizeAgentId(agentId)}:main`;
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

function buildAgentExecutionMetadataForSession(sessionKey: string): string | null {
  const agentId = getAgentIdFromSessionKey(sessionKey);
  const agent = useAgentsStore.getState().agents.find((item) => item.id === agentId);
  if (!agent) return null;
  return buildAgentExecutionMetadata(agent);
}

function injectAgentExecutionMetadata(message: string, sessionKey: string, isFirstUserMessage: boolean): string {
  if (!isFirstUserMessage) return message;
  const metadata = buildAgentExecutionMetadataForSession(sessionKey);
  if (!metadata) return message;
  return message ? `${metadata}${message}` : metadata;
}

function finalizeStreamingAssistantIfStale(set: ChatSet, get: ChatGet): boolean {
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
    };
  });
  return true;
}

export function createRuntimeSendActions(set: ChatSet, get: ChatGet): Pick<RuntimeActions, 'sendMessage' | 'abortRun'> {
  return {
    sendMessage: async (
      text: string,
      attachments?: Array<{ fileName: string; mimeType: string; fileSize: number; stagedPath: string; preview: string | null }>,
      targetAgentId?: string | null,
    ) => {
      const trimmed = text.trim();
      if (!trimmed && (!attachments || attachments.length === 0)) return;

      const targetSessionKey = resolveMainSessionKeyForAgent(targetAgentId) ?? get().currentSessionKey;
      if (targetSessionKey !== get().currentSessionKey) {
        const current = get();
        const leavingEmpty = !current.currentSessionKey.endsWith(':main') && current.messages.length === 0;
        set((s) => ({
          currentSessionKey: targetSessionKey,
          currentAgentId: getAgentIdFromSessionKey(targetSessionKey),
          sessions: ensureSessionEntry(
            leavingEmpty ? s.sessions.filter((session) => session.key !== current.currentSessionKey) : s.sessions,
            targetSessionKey,
          ),
          sessionLabels: leavingEmpty
            ? Object.fromEntries(Object.entries(s.sessionLabels).filter(([key]) => key !== current.currentSessionKey))
            : s.sessionLabels,
          sessionLastActivity: leavingEmpty
            ? Object.fromEntries(Object.entries(s.sessionLastActivity).filter(([key]) => key !== current.currentSessionKey))
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
        await get().loadHistory(true);
      }

      const currentSessionKey = targetSessionKey;
      const existingMessages = get().messages;
      const isFirstUserMessage = !existingMessages.some((message) => message.role === 'user');
      const baseMessage = trimmed || (attachments?.length ? '请处理我上传的附件。' : '');
      const messageForGateway = injectAgentExecutionMetadata(baseMessage, currentSessionKey, isFirstUserMessage);
      const visibleUserContent = trimmed || (attachments?.length ? '锛堝凡闄勫姞鏂囦欢锛? : '');

      // Add user message optimistically (with local file metadata for UI display)
      const nowMs = Date.now();
      const userMsg: RawMessage = {
        role: 'user',
        content: messageForGateway || (attachments?.length ? '（已附加文件）' : ''),
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
      userMsg.content = visibleUserContent;
      set((s) => ({
        sessions: ensureSessionEntry(s.sessions, currentSessionKey),
        messages: [...s.messages, userMsg],
        sending: true,
        error: null,
        streamingText: '',
        streamingMessage: null,
        streamingTools: [],
        pendingFinal: false,
        lastUserMessageAt: nowMs,
      }));

      // Update session label with first user message text as soon as it's sent
      const { sessionLabels, messages, sessions } = get();
      const isFirstMessage = !messages.slice(0, -1).some((m) => m.role === 'user');
      const hasStoredLabel = sessions.some(
        (session) => session.key === currentSessionKey && typeof session.label === 'string' && session.label.trim().length > 0,
      );
      if (!currentSessionKey.endsWith(':main') && isFirstMessage && !sessionLabels[currentSessionKey] && !hasStoredLabel && trimmed) {
        const truncated = trimmed.length > 50 ? `${trimmed.slice(0, 50)}…` : trimmed;
        set((s) => ({ sessionLabels: { ...s.sessionLabels, [currentSessionKey]: truncated } }));
      }

      // Mark this session as most recently active
      set((s) => ({ sessionLastActivity: { ...s.sessionLastActivity, [currentSessionKey]: nowMs } }));

      // Start the history poll and safety timeout IMMEDIATELY (before the
      // RPC await) because the gateway's chat.send RPC may block until the
      // entire agentic conversation finishes — the poll must run in parallel.
      setLastChatEventAt(Date.now());
      clearHistoryPoll();
      clearErrorRecoveryTimer();

      const POLL_START_DELAY = 3_000;
      const POLL_INTERVAL = 4_000;
      const pollHistory = () => {
        const state = get();
        if (!state.sending) { clearHistoryPoll(); return; }
        if (state.streamingMessage) {
          setHistoryPollTimer(setTimeout(pollHistory, POLL_INTERVAL));
          return;
        }
        state.loadHistory(true);
        setHistoryPollTimer(setTimeout(pollHistory, POLL_INTERVAL));
      };
      setHistoryPollTimer(setTimeout(pollHistory, POLL_START_DELAY));

      const SAFETY_TIMEOUT_MS = 90_000;
      const STREAMING_STALE_TIMEOUT_MS = 15_000;
      const checkStuck = () => {
        const state = get();
        if (!state.sending) return;
        if (state.streamingMessage || state.streamingText) {
          if (Date.now() - getLastChatEventAt() >= STREAMING_STALE_TIMEOUT_MS) {
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
        if (Date.now() - getLastChatEventAt() < SAFETY_TIMEOUT_MS) {
          setTimeout(checkStuck, 10_000);
          return;
        }
        clearHistoryPoll();
        const errorReply = createLocalAssistantMessage(getNoResponseError(), {
          isError: true,
          idPrefix: 'no-response',
        });
        set((s) => ({
          messages: appendAssistantMessage(s.messages, errorReply),
          error: null,
          sending: false,
          activeRunId: null,
          lastUserMessageAt: null,
          streamingText: '',
          streamingMessage: null,
          streamingTools: [],
          pendingFinal: false,
          pendingToolImages: [],
        }));
      };
      setTimeout(checkStuck, 30_000);

      try {
        const idempotencyKey = crypto.randomUUID();
        const hasMedia = attachments && attachments.length > 0;
        if (hasMedia) {
          console.log('[sendMessage] Media paths:', attachments!.map(a => a.stagedPath));
        }

        // Cache image attachments BEFORE the IPC call to avoid race condition:
        // history may reload (via Gateway event) before the RPC returns.
        // Keyed by staged file path which appears in [media attached: <path> ...].
        if (hasMedia && attachments) {
          for (const a of attachments) {
            upsertImageCacheEntry(a.stagedPath, {
              fileName: a.fileName,
              mimeType: a.mimeType,
              fileSize: a.fileSize,
              preview: a.preview,
            });
          }
        }

        let result: { success: boolean; result?: { runId?: string }; error?: string };

        // Longer timeout for chat sends to tolerate high-latency networks (avoids connect error)
        const CHAT_SEND_TIMEOUT_MS = 120_000;

        if (hasMedia) {
          result = await invokeIpc(
            'chat:sendWithMedia',
            {
              sessionKey: currentSessionKey,
              message: messageForGateway || '请处理我上传的附件。',
              deliver: false,
              idempotencyKey,
              media: attachments.map((a) => ({
                filePath: a.stagedPath,
                mimeType: a.mimeType,
                fileName: a.fileName,
              })),
            },
          ) as { success: boolean; result?: { runId?: string }; error?: string };
        } else {
          result = await invokeIpc(
            'gateway:rpc',
            'chat.send',
            {
              sessionKey: currentSessionKey,
              message: messageForGateway,
              deliver: false,
              idempotencyKey,
            },
            CHAT_SEND_TIMEOUT_MS,
          ) as { success: boolean; result?: { runId?: string }; error?: string };
        }

        console.log(`[sendMessage] RPC result: success=${result.success}, runId=${result.result?.runId || 'none'}`);

        if (!result.success) {
          clearHistoryPoll();
          const errorReply = createLocalAssistantMessage(getSendFailedError(result.error), {
            isError: true,
            idPrefix: 'send-failed',
          });
          set((s) => ({
            messages: appendAssistantMessage(s.messages, errorReply),
            error: null,
            sending: false,
            activeRunId: null,
            lastUserMessageAt: null,
            streamingText: '',
            streamingMessage: null,
            streamingTools: [],
            pendingFinal: false,
            pendingToolImages: [],
          }));
        } else if (result.result?.runId) {
          set({ activeRunId: result.result.runId });
        }
      } catch (err) {
        clearHistoryPoll();
        const errorReply = createLocalAssistantMessage(getSendFailedError(String(err)), {
          isError: true,
          idPrefix: 'send-exception',
        });
        set((s) => ({
          messages: appendAssistantMessage(s.messages, errorReply),
          error: null,
          sending: false,
          activeRunId: null,
          lastUserMessageAt: null,
          streamingText: '',
          streamingMessage: null,
          streamingTools: [],
          pendingFinal: false,
          pendingToolImages: [],
        }));
      }
    },

    // ── Abort active run ──

    abortRun: async () => {
      clearHistoryPoll();
      clearErrorRecoveryTimer();
      const { currentSessionKey } = get();
      set({ sending: false, streamingText: '', streamingMessage: null, pendingFinal: false, lastUserMessageAt: null, pendingToolImages: [] });
      set({ streamingTools: [] });

      try {
        await invokeIpc(
          'gateway:rpc',
          'chat.abort',
          { sessionKey: currentSessionKey },
        );
      } catch (err) {
        set({ error: getChatNoticeMessage(String(err)) || String(err) });
      }
    },

    // ── Handle incoming chat events from Gateway ──

  };
}
