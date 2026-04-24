import {
  appendAssistantMessage,
  clearErrorRecoveryTimer,
  clearHistoryPoll,
  collectToolUpdates,
  createLocalAssistantMessage,
  createToolResultProcessMessage,
  extractImagesAsAttachedFiles,
  extractMediaRefs,
  extractRawFilePaths,
  getAssistantRuntimeErrorNotice,
  getMessageText,
  getToolCallFilePath,
  getContinueConversationWarning,
  getEmptyAssistantResponseError,
  getSendFailedError,
  hasErrorRecoveryTimer,
  getLastChatEventAt,
  hasNonToolAssistantContent,
  isEmptyAssistantResponse,
  isToolOnlyMessage,
  isToolResultRole,
  makeAttachedFile,
  setErrorRecoveryTimer,
  upsertToolStatuses,
} from './helpers';
import type { AttachedFileMeta, RawMessage, ToolStatus } from './types';
import type { ChatGet, ChatSet } from './store-api';

let pendingDeltaMessage: RawMessage | null = null;
let pendingDeltaUpdates: ToolStatus[] = [];
let pendingDeltaClearError = false;
let pendingDeltaFlushHandle: ReturnType<typeof setTimeout> | null = null;
let pendingFinalRecoveryHandle: ReturnType<typeof setTimeout> | null = null;
const PENDING_FINAL_RECOVERY_DELAY_MS = 20_000;
// 如果距离最后一个 chat 事件不超过此时间，recovery 定时器推迟而非强制终止，
// 以避免在长工具执行期间过早结束流式会话。
const RECOVERY_ACTIVE_THRESHOLD_MS = 45_000;

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

function flushPendingDelta(set: ChatSet): void {
  if (!pendingDeltaMessage && pendingDeltaUpdates.length === 0 && !pendingDeltaClearError) {
    return;
  }

  const nextMessage = pendingDeltaMessage;
  const nextUpdates = pendingDeltaUpdates;
  const shouldClearError = pendingDeltaClearError;

  cancelPendingDeltaFlush();
  resetPendingDeltaState();

  set((s) => ({
    error: shouldClearError ? null : s.error,
    streamingMessage: (() => {
      if (nextMessage && typeof nextMessage === 'object') {
        const msgRole = nextMessage.role;
        if (isToolResultRole(msgRole)) return s.streamingMessage;
        const msgObj = nextMessage;
        if (s.streamingMessage && msgObj.content === undefined) {
          return s.streamingMessage;
        }
      }
      return nextMessage ?? s.streamingMessage;
    })(),
    streamingTools: nextUpdates.length > 0 ? upsertToolStatuses(s.streamingTools, nextUpdates) : s.streamingTools,
  }));
}

function scheduleDeltaFlush(set: ChatSet): void {
  if (pendingDeltaFlushHandle) return;
  pendingDeltaFlushHandle = setTimeout(() => {
    flushPendingDelta(set);
  }, 16);
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
  set: ChatSet,
  get: ChatGet,
): void {
  clearPendingFinalRecoveryTimer();
  const sessionKey = (get() as { currentSessionKey?: string }).currentSessionKey;

  const runRecovery = () => {
    pendingFinalRecoveryHandle = null;
    const state = get();
    if (
      (sessionKey && (state as { currentSessionKey?: string }).currentSessionKey !== sessionKey)
      || !state.pendingFinal
    ) {
      return;
    }

    // 如果近期仍有活跃的 chat 事件，说明 Gateway 仍在通信（如长工具执行中），
    // 推迟 recovery 而非强制终止流式会话。
    const lastEventAt = getLastChatEventAt();
    if (lastEventAt && Date.now() - lastEventAt < RECOVERY_ACTIVE_THRESHOLD_MS) {
      pendingFinalRecoveryHandle = setTimeout(runRecovery, PENDING_FINAL_RECOVERY_DELAY_MS);
      return;
    }

    void state.loadHistory(true).finally(() => {
      const latest = get();
      if (
        (sessionKey && (latest as { currentSessionKey?: string }).currentSessionKey !== sessionKey)
        || !latest.pendingFinal
      ) {
        return;
      }

      set((s) => {
        const streamingAssistant = s.streamingMessage && typeof s.streamingMessage === 'object'
          ? s.streamingMessage as RawMessage
          : null;
        const canPromoteStreamingAssistant = !!streamingAssistant
          && (streamingAssistant.role === 'assistant' || streamingAssistant.role === undefined)
          && hasNonToolAssistantContent(streamingAssistant)
          && !isToolResultRole(streamingAssistant.role);
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
          pendingFinal: false,
          lastUserMessageAt: null,
          streamingText: '',
          streamingMessage: null,
          streamingTools: [],
          pendingToolImages: [],
          error: shouldAppendStreamingSnapshot || canPromoteStreamingAssistant
            ? s.error
            : (s.error || getContinueConversationWarning()),
        };
      });
    });
  };

  pendingFinalRecoveryHandle = setTimeout(runRecovery, PENDING_FINAL_RECOVERY_DELAY_MS);
}

export function handleRuntimeEventState(
  set: ChatSet,
  get: ChatGet,
  event: Record<string, unknown>,
  resolvedState: string,
  runId: string,
): void {
      clearPendingFinalRecoveryTimer();
      switch (resolvedState) {
        case 'started': {
          // Run just started (e.g. from console); show loading immediately.
          const { sending: currentSending } = get();
          if (!currentSending && runId) {
            set({ sending: true, activeRunId: runId, error: null });
          }
          break;
        }
        case 'delta': {
          // If we're receiving new deltas, the Gateway has recovered from any
          // prior error — cancel the error finalization timer and clear the
          // stale error banner so the user sees the live stream again.
          if (hasErrorRecoveryTimer()) {
            clearErrorRecoveryTimer();
            pendingDeltaClearError = true;
          }
          // 收到新的流式数据，说明 run 仍在进行中，清除 pendingFinal
          // 防止 pendingFinalRecovery 或 loadHistory 在活跃流式期间误终止会话。
          if (get().pendingFinal) {
            set({ pendingFinal: false });
          }
          const updates = collectToolUpdates(event.message, resolvedState);
          if (event.message && typeof event.message === 'object') {
            pendingDeltaMessage = event.message as unknown as RawMessage;
          }
          mergePendingDeltaUpdates(updates);
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
                // tool_result 表示单个工具调用完成，run 仍在继续，
                // 不应设置 pendingFinal 以免 loadHistory 过早终止流式传输。
                pendingFinal: s.pendingFinal,
                  pendingToolImages: toolFiles.length > 0
                  ? [...s.pendingToolImages, ...toolFiles]
                  : s.pendingToolImages,
                streamingTools: updates.length > 0 ? upsertToolStatuses(s.streamingTools, updates) : s.streamingTools,
              };
            });
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
          const emptyAssistantResponse = !toolOnly && isEmptyAssistantResponse(previewFinalMsg);
          const assistantRuntimeErrorNotice = !toolOnly
            ? getAssistantRuntimeErrorNotice(previewFinalMsg)
            : null;
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

              // Check if message already exists (prevent duplicates)
              const alreadyExists = s.messages.some(m => m.id === msgId)
                || isEquivalentRecentAssistantMessage(s.messages, msgWithImages);
              if (alreadyExists) {
              return toolOnly ? {
                streamingText: '',
                streamingMessage: null,
                pendingFinal: true,
                streamingTools,
                  ...clearPendingImages,
                } : {
                  streamingText: '',
                  streamingMessage: null,
                  sending: hasOutput ? false : s.sending,
                  activeRunId: hasOutput ? null : s.activeRunId,
                  pendingFinal: hasOutput ? false : true,
                  streamingTools,
                  error: assistantRuntimeErrorNotice,
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
                  pendingFinal: false,
                  streamingTools,
                  error: assistantRuntimeErrorNotice,
                  ...clearPendingImages,
                };
              }
              return toolOnly ? {
                messages: [...s.messages, msgWithImages],
                streamingText: '',
                streamingMessage: null,
                pendingFinal: true,
                streamingTools,
                ...clearPendingImages,
              } : {
                messages: [...s.messages, msgWithImages],
                streamingText: '',
                streamingMessage: null,
                sending: hasOutput ? false : s.sending,
                activeRunId: hasOutput ? null : s.activeRunId,
                pendingFinal: hasOutput ? false : true,
                streamingTools,
                error: assistantRuntimeErrorNotice,
                ...clearPendingImages,
              };
            });
            if (toolOnly || !hasOutput) {
              schedulePendingFinalRecovery(set, get);
            }
            // After the final response, quietly reload history to surface all intermediate
            // tool-use turns (thinking + tool blocks) from the Gateway's authoritative record.
            if (hasOutput && !toolOnly) {
              clearHistoryPoll();
              void get().loadHistory(true);
            } else if (emptyAssistantResponse) {
              clearHistoryPoll();
            }
          } else {
            // No message in final event - reload history to get complete data
            set({ streamingText: '', streamingMessage: null, pendingFinal: true });
            schedulePendingFinalRecovery(set, get);
            get().loadHistory();
          }
          break;
        }
        case 'error': {
          flushPendingDelta(set);
          const errorMsg = String(event.errorMessage || 'An error occurred');
          const wasSending = get().sending;

          // Snapshot the current streaming message into messages[] so partial
          // content ("Let me get that written down...") is preserved in the UI
          // rather than being silently discarded.
          const currentStream = get().streamingMessage as RawMessage | null;
          if (currentStream && (currentStream.role === 'assistant' || currentStream.role === undefined)) {
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
            pendingFinal: false,
            pendingToolImages: [],
          }));

          // Don't immediately give up: the Gateway often retries internally
          // after transient API failures (e.g. "terminated"). Keep `sending`
          // true for a grace period so that recovery events are processed and
          // the agent-phase-completion handler can still trigger loadHistory.
          if (wasSending) {
            clearErrorRecoveryTimer();
            const ERROR_RECOVERY_GRACE_MS = 15_000;
            setErrorRecoveryTimer(setTimeout(() => {
              setErrorRecoveryTimer(null);
              const state = get();
              if (state.sending && !state.streamingMessage) {
                clearHistoryPoll();
                // Grace period expired with no recovery — finalize the error
                set({
                  sending: false,
                  activeRunId: null,
                  lastUserMessageAt: null,
                });
                // One final history reload in case the Gateway completed in the
                // background and we just missed the event.
                state.loadHistory(true);
              }
            }, ERROR_RECOVERY_GRACE_MS));
          } else {
            clearHistoryPoll();
            set({ sending: false, activeRunId: null, lastUserMessageAt: null });
          }
          break;
        }
        case 'aborted': {
          flushPendingDelta(set);
          clearHistoryPoll();
          clearErrorRecoveryTimer();
          clearPendingFinalRecoveryTimer();
          set({
            sending: false,
            activeRunId: null,
            streamingText: '',
            streamingMessage: null,
            streamingTools: [],
            pendingFinal: false,
            lastUserMessageAt: null,
            pendingToolImages: [],
          });
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
              streamingTools: updates.length > 0 ? upsertToolStatuses(s.streamingTools, updates) : s.streamingTools,
            }));
          }
          break;
        }
      }
}
