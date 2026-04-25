import { invokeIpc } from '@/lib/api-client';
import { hostApiFetch } from '@/lib/host-api';
import { sanitizeInboundUserText } from '../../../shared/inbound-user-text';
import {
  CHAT_HISTORY_RPC_TIMEOUT_MS,
  appendAssistantMessage,
  clearHistoryPoll,
  createLocalAssistantMessage,
  createToolResultProcessMessage,
  enrichWithCachedImages,
  enrichWithToolResultFiles,
  getMessageText,
  getAssistantRuntimeErrorNotice,
  hasNonToolAssistantContent,
  hasAssistantFinalTextContent,
  isEmptyAssistantResponse,
  isInternalMessage,
  isToolResultRole,
  loadMissingPreviews,
  getEmptyAssistantResponseError,
  toMs,
  isUnusedDraftSession,
} from './helpers';
import { buildCronSessionHistoryPath, isCronSessionKey } from './cron-session-utils';
import type { RawMessage } from './types';
import type { ChatGet, ChatSet, SessionHistoryActions } from './store-api';

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

export function createHistoryActions(
  set: ChatSet,
  get: ChatGet,
): Pick<SessionHistoryActions, 'loadHistory'> {
  return {
    loadHistory: async (quiet = false) => {
      const currentState = get();
      const { currentSessionKey } = currentState;
      const shouldSkipUnusedDraftHydration = (
        currentSessionKey.includes(':session-')
        && !currentState.sessions.some((session) => session.key === currentSessionKey)
        && isUnusedDraftSession(currentState, currentSessionKey)
      );
      if (shouldSkipUnusedDraftHydration) {
        return;
      }
      if (!quiet) set({ loading: true, error: null });

      const isCurrentSession = () => get().currentSessionKey === currentSessionKey;
      const getPreviewMergeKey = (message: RawMessage): string => (
        `${message.id ?? ''}|${message.role}|${message.timestamp ?? ''}|${getMessageText(message.content)}`
      );
      const messageExistsIn = (messagesToScan: RawMessage[], candidate: RawMessage): boolean => {
        if (candidate.id && messagesToScan.some((message) => message.id === candidate.id)) {
          return true;
        }
        const candidateKey = getPreviewMergeKey(candidate);
        const candidateText = getMessageText(candidate.content).trim();
        return messagesToScan.some((message) => (
          getPreviewMergeKey(message) === candidateKey
          || (
            candidate.role === 'assistant'
            && message.role === candidate.role
            && candidateText.length > 0
            && getMessageText(message.content).trim() === candidateText
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
      const preserveSettledLocalAssistantMessages = (
        currentMessages: RawMessage[],
        loadedMessages: RawMessage[],
        lastUserTimestamp: number | null,
      ): RawMessage[] => {
        if (!lastUserTimestamp) return loadedMessages;

        const userMs = toMs(lastUserTimestamp);
        let turnStartIndex = -1;
        for (let index = currentMessages.length - 1; index >= 0; index -= 1) {
          const message = currentMessages[index];
          if (
            message.role === 'user'
            && message.timestamp
            && Math.abs(toMs(message.timestamp) - userMs) < 5000
          ) {
            turnStartIndex = index;
            break;
          }
        }

        const localTurnMessages = turnStartIndex >= 0
          ? currentMessages.slice(turnStartIndex + 1)
          : currentMessages.filter((message) => message.timestamp && toMs(message.timestamp) >= userMs);

        const localTurnAssistants = localTurnMessages.filter((message) => (
          message.role === 'assistant'
          && !isInternalMessage(message)
          && !isToolResultRole(message.role)
          && hasNonToolAssistantContent(message)
        ));
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

      const applyLoadFailure = (errorMessage: string | null) => {
        if (!isCurrentSession()) return;
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
        if (get().sending && userMsgAt) {
          const userMsMs = toMs(userMsgAt);
          const hasRecentUser = enrichedMessages.some(
            (m) => m.role === 'user' && m.timestamp && Math.abs(toMs(m.timestamp) - userMsMs) < 5000,
          );
          if (!hasRecentUser) {
            const currentMsgs = get().messages;
            const optimistic = [...currentMsgs].reverse().find(
              (m) => m.role === 'user' && m.timestamp && Math.abs(toMs(m.timestamp) - userMsMs) < 5000,
            );
            if (optimistic) {
              finalMessages = [...enrichedMessages, optimistic];
            }
          }
        }

        if (get().sending) {
          finalMessages = preservePendingAssistantMessages(get().messages, finalMessages, userMsgAt);
        } else if (quiet && userMsgAt) {
          finalMessages = preserveSettledLocalAssistantMessages(get().messages, finalMessages, userMsgAt);
        }

        const {
          pendingFinal: historyPendingFinal,
          lastUserMessageAt: historyLastUserMessageAt,
          sending: historyIsSendingNow,
        } = get();

        const historyUserMsTs = historyLastUserMessageAt ? toMs(historyLastUserMessageAt) : 0;
        const isAfterHistoryUserMsg = (msg: RawMessage): boolean => {
          if (!historyUserMsTs || !msg.timestamp) return true;
          return toMs(msg.timestamp) >= historyUserMsTs;
        };

        const shouldEnterHistoryPendingFinal = historyIsSendingNow && !historyPendingFinal && [...filteredMessages].reverse().some((msg) => {
          if (msg.role !== 'assistant') return false;
          return isAfterHistoryUserMsg(msg);
        });

        const historyRecentAssistant = (historyPendingFinal || shouldEnterHistoryPendingFinal)
          ? [...filteredMessages].reverse().find((msg) => {
              if (msg.role !== 'assistant') return false;
              if (!hasAssistantFinalTextContent(msg)) return false;
              return isAfterHistoryUserMsg(msg);
            })
          : undefined;
        const historyEmptyAssistant = (historyPendingFinal || shouldEnterHistoryPendingFinal)
          ? [...filteredMessages].reverse().find((msg) => (
              msg.role === 'assistant'
              && isAfterHistoryUserMsg(msg)
              && isEmptyAssistantResponse(msg)
            ))
          : undefined;
        const historyRecentAssistantError = historyRecentAssistant
          ? getAssistantRuntimeErrorNotice(historyRecentAssistant)
          : null;

        if (historyRecentAssistant || historyEmptyAssistant) {
          clearHistoryPoll();
        }

        set({
          messages: finalMessages,
          thinkingLevel,
          loading: false,
          ...(historyRecentAssistant
            ? {
                sending: false,
                activeRunId: null,
                pendingFinal: false,
                streamingText: '',
                streamingMessage: null,
                streamingTools: [],
                pendingToolImages: [],
                error: historyRecentAssistantError,
              }
            : historyEmptyAssistant
              ? {
                  sending: false,
                  activeRunId: null,
                  pendingFinal: false,
                  lastUserMessageAt: null,
                  streamingText: '',
                  streamingMessage: null,
                  streamingTools: [],
                  pendingToolImages: [],
                  messages: appendAssistantMessage(
                    finalMessages,
                    createLocalAssistantMessage(getEmptyAssistantResponseError(), {
                      isError: true,
                      idPrefix: 'history-empty-assistant-response',
                    }),
                  ),
                  error: null,
                }
            : shouldEnterHistoryPendingFinal
              ? { pendingFinal: true }
              : {}),
        });

        // Extract first user message text as a session label for display in the toolbar.
        // Skip main sessions (key ends with ":main") — they rely on the Gateway-provided
        // displayName (e.g. the configured agent name "ClawX") instead.
        const isMainSession = currentSessionKey.endsWith(':main');
        if (!isMainSession) {
          const firstUserMsg = finalMessages.find((m) => m.role === 'user');
          if (firstUserMsg) {
            const labelText = sanitizeInboundUserText(getMessageText(firstUserMsg.content));
            set((s) => {
              const hasStoredLabel = s.sessions.some(
                (session) => session.key === currentSessionKey && typeof session.label === 'string' && session.label.trim().length > 0,
              );
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
        const lastMsg = finalMessages[finalMessages.length - 1];
        if (lastMsg?.timestamp) {
          const lastAt = toMs(lastMsg.timestamp);
          set((s) => ({
            sessionLastActivity: { ...s.sessionLastActivity, [currentSessionKey]: lastAt },
          }));
        }

        // Async: load missing image previews from disk (updates in background)
        loadMissingPreviews(finalMessages, currentSessionKey).then((updated) => {
          if (!isCurrentSession()) return;
          if (updated) {
            set((state) => ({
              messages: mergeHydratedMessages(state.messages, finalMessages),
            }));
          }
        });
      };

      try {
        const result = await invokeIpc(
          'gateway:rpc',
          'chat.history',
          { sessionKey: currentSessionKey, limit: 200 },
          CHAT_HISTORY_RPC_TIMEOUT_MS,
        ) as { success: boolean; result?: Record<string, unknown>; error?: string };

        if (result.success && result.result) {
          const data = result.result;
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
            applyLoadFailure(result.error || 'Failed to load chat history');
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
    },
  };
}
