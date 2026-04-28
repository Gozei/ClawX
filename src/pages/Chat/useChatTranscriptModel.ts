import { useDeferredValue, useMemo } from 'react';
import type { ActiveTurnBuffer, RawMessage } from '@/stores/chat';
import type { AssistantMessageStyle, ChatProcessDisplayMode } from '@/stores/settings';
import { isWithinCompletedTurnProcessGrace } from '@/lib/chat-turn-grace';
import {
  extractImages,
  extractText,
  extractThinking,
  extractToolUse,
  isInternalMaintenanceTurnUserMessage,
} from './message-utils';
import { getProcessEventItems } from './process-events-next';
import { groupMessagesForDisplay, splitFinalMessageForTurnDisplay, type HistoryDisplayItem } from './history-grouping';
import type {
  BuildChatTranscriptModelInput,
  ChatListItem,
  ChatTranscriptModel,
  FallbackActiveTurnInput,
  NormalizedActiveTurnSource,
} from './transcript-types';

const EMPTY_MESSAGES: RawMessage[] = [];
const ACTIVE_TURN_USER_MATCH_WINDOW_MS = 60_000;

type StreamingMessageLike = {
  role?: string;
  content?: unknown;
  timestamp?: number;
};

export function toTimestampMs(timestamp: number | undefined): number | null {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return null;
  return timestamp < 1e12 ? timestamp * 1000 : timestamp;
}

export function resolveMessageTimestampMs(message: RawMessage | null | undefined, fallbackMs = 0): number {
  return toTimestampMs(message?.timestamp) ?? fallbackMs;
}

export function buildMessageDisplayKey(message: RawMessage): string {
  return `${message.id ?? ''}|${message.role}|${message.timestamp ?? ''}|${extractText(message).trim()}`;
}

function stringifyForActivitySignature(value: unknown): string {
  if (value == null) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function buildMessageActivitySignature(message: RawMessage | null | undefined): string {
  if (!message) return '';
  const files = (message._attachedFiles || [])
    .map((file) => `${file.fileName}:${file.mimeType}:${file.fileSize}:${file.filePath ?? ''}`)
    .join(',');
  return [
    message.id ?? '',
    message.role,
    message.timestamp ?? '',
    stringifyForActivitySignature(message.content),
    stringifyForActivitySignature((message as { text?: unknown }).text),
    files,
  ].join('|');
}

function buildHistoryItemActivitySignature(item: HistoryDisplayItem | undefined): string {
  if (!item) return '';
  if (item.type === 'message') {
    return `message:${item.key}:${buildMessageActivitySignature(item.message)}`;
  }
  return [
    `turn:${item.key}`,
    buildMessageActivitySignature(item.userMessage),
    ...item.intermediateMessages.map((message) => buildMessageActivitySignature(message)),
    buildMessageActivitySignature(item.finalMessage),
  ].join('::');
}

function buildToolStatusActivitySignature(input: BuildChatTranscriptModelInput): string {
  return input.streamingTools
    .map((tool) => [
      tool.id ?? '',
      tool.toolCallId ?? '',
      tool.name,
      tool.status,
      tool.updatedAt ?? '',
      tool.durationMs ?? '',
      tool.retries ?? '',
      tool.summary ?? '',
      tool.failureMessage ?? '',
    ].join(':'))
    .join('|');
}

function buildLatestTranscriptActivitySignature({
  input,
  chatListItems,
  displayHistoryItems,
  activeTurnScrollKey,
  activeTurnUserMessage,
  activeTurnProcessStreamingMessage,
  activeTurnFinalStreamingMessage,
  resolvedPersistedFinalMessage,
}: {
  input: BuildChatTranscriptModelInput;
  chatListItems: ChatListItem[];
  displayHistoryItems: HistoryDisplayItem[];
  activeTurnScrollKey: string | null;
  activeTurnUserMessage: RawMessage | null;
  activeTurnProcessStreamingMessage: RawMessage | null;
  activeTurnFinalStreamingMessage: RawMessage | null;
  resolvedPersistedFinalMessage: RawMessage | null;
}): string {
  return [
    input.currentSessionKey,
    chatListItems.length,
    chatListItems[chatListItems.length - 1]?.key ?? '',
    buildHistoryItemActivitySignature(displayHistoryItems[displayHistoryItems.length - 1]),
    activeTurnScrollKey ?? '',
    buildMessageActivitySignature(activeTurnUserMessage),
    buildMessageActivitySignature(activeTurnProcessStreamingMessage),
    buildMessageActivitySignature(activeTurnFinalStreamingMessage),
    buildMessageActivitySignature(resolvedPersistedFinalMessage),
    input.sending ? 'sending' : 'idle',
    input.pendingFinal ? 'pending-final' : 'steady',
    buildToolStatusActivitySignature(input),
  ].join('::');
}

function findLastUserMessageIndex(messages: RawMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      return index;
    }
  }
  return -1;
}

function isSameActiveTurnUserMessage(
  historyMessage: RawMessage | null | undefined,
  activeTurnUserMessage: RawMessage | null | undefined,
): boolean {
  if (!historyMessage || !activeTurnUserMessage) return false;
  if (historyMessage.role !== 'user' || activeTurnUserMessage.role !== 'user') return false;

  if (buildMessageDisplayKey(historyMessage) === buildMessageDisplayKey(activeTurnUserMessage)) {
    return true;
  }

  const historyText = extractText(historyMessage).trim();
  const activeTurnText = extractText(activeTurnUserMessage).trim();
  if (!historyText || historyText !== activeTurnText) return false;

  if (historyMessage.id && activeTurnUserMessage.id && historyMessage.id === activeTurnUserMessage.id) {
    return true;
  }

  const historyTimestampMs = toTimestampMs(historyMessage.timestamp);
  const activeTurnTimestampMs = toTimestampMs(activeTurnUserMessage.timestamp);
  if (historyTimestampMs == null || activeTurnTimestampMs == null) return false;

  return Math.abs(historyTimestampMs - activeTurnTimestampMs) <= ACTIVE_TURN_USER_MATCH_WINDOW_MS;
}

function trimDeferredHistoryForActiveTurn(
  deferredHistoryMessages: RawMessage[],
  activeTurnUserMessage: RawMessage | null,
): RawMessage[] {
  if (!activeTurnUserMessage) return deferredHistoryMessages;

  let activeTurnHistoryIndex = -1;
  for (let index = deferredHistoryMessages.length - 1; index >= 0; index -= 1) {
    if (isSameActiveTurnUserMessage(deferredHistoryMessages[index], activeTurnUserMessage)) {
      activeTurnHistoryIndex = index;
      break;
    }
  }

  if (activeTurnHistoryIndex < 0) {
    return deferredHistoryMessages;
  }

  // `useDeferredValue` can briefly expose both hydrated and optimistic copies
  // of the same active-turn user message. Remove the trailing duplicate cluster
  // so the composer prompt renders exactly once.
  let trimStartIndex = activeTurnHistoryIndex;
  while (
    trimStartIndex > 0
    && isSameActiveTurnUserMessage(deferredHistoryMessages[trimStartIndex - 1], activeTurnUserMessage)
  ) {
    trimStartIndex -= 1;
  }

  return deferredHistoryMessages.slice(0, trimStartIndex);
}

function buildStreamingDisplayMessage(
  streamMsg: StreamingMessageLike | null,
  streamText: string,
  streamingTimestamp: number,
): RawMessage | null {
  if (!streamMsg && !streamText.trim()) return null;
  return (streamMsg
    ? {
        ...(streamMsg as Record<string, unknown>),
        role: (typeof streamMsg.role === 'string' ? streamMsg.role : 'assistant') as RawMessage['role'],
        content: streamMsg.content ?? streamText,
        timestamp: streamMsg.timestamp ?? streamingTimestamp,
      }
    : {
        role: 'assistant',
        content: streamText,
        timestamp: streamingTimestamp,
      }) as RawMessage;
}

export function hasVisibleProcessContent(
  message: RawMessage | null | undefined,
  showThinking: boolean,
  chatProcessDisplayMode: ChatProcessDisplayMode,
  assistantMessageStyle: AssistantMessageStyle,
  hideInternalRoutineProcesses: boolean,
): boolean {
  if (!message || message.role !== 'assistant') return false;

  const text = extractText(message);
  const thinking = extractThinking(message);
  const tools = extractToolUse(message);
  const images = extractImages(message);
  const files = message._attachedFiles || [];

  if (assistantMessageStyle === 'bubble') {
    return text.trim().length > 0
      || (showThinking && !!thinking && thinking.trim().length > 0)
      || (chatProcessDisplayMode === 'all' && tools.length > 0)
      || images.length > 0
      || files.length > 0;
  }

  const items = getProcessEventItems(
    message,
    showThinking,
    chatProcessDisplayMode,
    hideInternalRoutineProcesses,
  );

  return items.length > 0
    || images.length > 0
    || files.length > 0;
}

export function hasVisibleFinalContent(message: RawMessage | null | undefined): boolean {
  if (!message || message.role !== 'assistant') return false;
  return extractText(message).trim().length > 0
    || extractImages(message).length > 0
    || (message._attachedFiles || []).length > 0;
}

export function buildFallbackActiveTurn(input: FallbackActiveTurnInput): NormalizedActiveTurnSource {
  const safeMessages = Array.isArray(input.messages) ? input.messages : EMPTY_MESSAGES;
  const streamMsg = input.streamingMessage && typeof input.streamingMessage === 'object'
    ? input.streamingMessage as StreamingMessageLike
    : null;
  const streamText = streamMsg
    ? extractText(streamMsg)
    : (typeof input.streamingMessage === 'string' ? input.streamingMessage : '');
  const lastUserIndex = findLastUserMessageIndex(safeMessages);
  const lastUserTimestampMs = toTimestampMs(input.lastUserMessageAt ?? undefined) ?? 0;
  const shouldRetainCompletedTurn = !input.sending
    && lastUserIndex >= 0
    && lastUserTimestampMs > 0
    && isWithinCompletedTurnProcessGrace(lastUserTimestampMs)
    && safeMessages.slice(lastUserIndex + 1).some((message) => (
      message.role === 'assistant'
      && ((toTimestampMs(message.timestamp) ?? lastUserTimestampMs) >= lastUserTimestampMs)
    ));
  const activeTurnStartIndex = input.sending || shouldRetainCompletedTurn ? lastUserIndex : -1;
  const historyMessages = activeTurnStartIndex >= 0 ? safeMessages.slice(0, activeTurnStartIndex) : safeMessages;
  const activeTurnMessages = activeTurnStartIndex >= 0 ? safeMessages.slice(activeTurnStartIndex) : EMPTY_MESSAGES;
  const userMessage = activeTurnMessages[0]?.role === 'user' ? activeTurnMessages[0] : null;
  const streamingTimestamp = streamMsg?.timestamp
    ?? userMessage?.timestamp
    ?? safeMessages[safeMessages.length - 1]?.timestamp
    ?? 0;
  const streamingDisplayMessage = buildStreamingDisplayMessage(streamMsg, streamText, streamingTimestamp);
  const assistantMessages = userMessage
    ? activeTurnMessages.slice(1).filter((message) => message.role === 'assistant')
    : EMPTY_MESSAGES;
  const latestPersistedAssistant = [...safeMessages].reverse().find((message) => {
    if (message.role !== 'assistant') return false;
    if (!userMessage?.timestamp || !message.timestamp) return true;
    return toTimestampMs(message.timestamp)! >= toTimestampMs(userMessage.timestamp)!;
  }) ?? null;
  const isStreamingDuplicateOfPersistedAssistant = !!latestPersistedAssistant
    && !!streamingDisplayMessage
    && extractText(latestPersistedAssistant).trim().length > 0
    && extractText(latestPersistedAssistant).trim() === extractText(streamingDisplayMessage).trim();
  const persistedFinalMessage = isStreamingDuplicateOfPersistedAssistant && assistantMessages.length > 0
    ? assistantMessages[assistantMessages.length - 1]
    : null;
  const processMessages = persistedFinalMessage
    ? assistantMessages.slice(0, -1)
    : assistantMessages;
  const splitStreaming = streamingDisplayMessage
    ? splitFinalMessageForTurnDisplay(streamingDisplayMessage)
    : null;

  return {
    historyMessages,
    userMessage,
    assistantMessages,
    processMessages,
    persistedFinalMessage,
    streamingDisplayMessage,
    processStreamingMessage: splitStreaming?.collapsedProcessMessage ?? null,
    finalStreamingMessage: splitStreaming?.finalDisplayMessage ?? streamingDisplayMessage,
    startedAtMs: userMessage
      ? (toTimestampMs(userMessage.timestamp) ?? toTimestampMs(safeMessages[safeMessages.length - 1]?.timestamp) ?? 0)
      : (toTimestampMs(safeMessages[safeMessages.length - 1]?.timestamp) ?? 0),
    hasAnyStreamContent: !!streamingDisplayMessage,
    isStreamingDuplicateOfPersistedAssistant,
  };
}

function normalizeActiveTurnSource(
  activeTurnBuffer: ActiveTurnBuffer | null | undefined,
  fallback: NormalizedActiveTurnSource,
): NormalizedActiveTurnSource {
  if (!activeTurnBuffer) return fallback;

  return {
    historyMessages: activeTurnBuffer.historyMessages,
    userMessage: activeTurnBuffer.userMessage,
    assistantMessages: activeTurnBuffer.assistantMessages,
    processMessages: activeTurnBuffer.processMessages,
    persistedFinalMessage: activeTurnBuffer.persistedFinalMessage,
    streamingDisplayMessage: activeTurnBuffer.streamingDisplayMessage,
    processStreamingMessage: activeTurnBuffer.processStreamingMessage,
    finalStreamingMessage: activeTurnBuffer.finalStreamingMessage,
    startedAtMs: activeTurnBuffer.startedAtMs,
    hasAnyStreamContent: activeTurnBuffer.hasAnyStreamContent,
    isStreamingDuplicateOfPersistedAssistant: activeTurnBuffer.isStreamingDuplicateOfPersistedAssistant,
  };
}

export function buildChatTranscriptModel(input: BuildChatTranscriptModelInput): ChatTranscriptModel {
  const safeMessages = Array.isArray(input.messages) ? input.messages : EMPTY_MESSAGES;
  const fallback = buildFallbackActiveTurn({
    messages: safeMessages,
    streamingMessage: input.streamingMessage,
    lastUserMessageAt: input.lastUserMessageAt,
    sending: input.sending,
  });
  const source = normalizeActiveTurnSource(input.activeTurnBuffer, fallback);
  const activeTurnUserMessage = source.userMessage;
  const shouldHideActiveTurn = !!activeTurnUserMessage && isInternalMaintenanceTurnUserMessage(activeTurnUserMessage);
  const activeTurnScrollKey = !shouldHideActiveTurn && activeTurnUserMessage
    ? `${input.currentSessionKey}:${buildMessageDisplayKey(activeTurnUserMessage)}`
    : null;
  const displayHistoryMessages = trimDeferredHistoryForActiveTurn(
    input.deferredHistoryMessages ?? source.historyMessages,
    shouldHideActiveTurn ? null : activeTurnUserMessage,
  );
  const activeTurnStartedAtMs = activeTurnUserMessage
    ? (source.startedAtMs ?? toTimestampMs(activeTurnUserMessage.timestamp) ?? toTimestampMs(safeMessages[safeMessages.length - 1]?.timestamp) ?? 0)
    : (source.startedAtMs ?? toTimestampMs(safeMessages[safeMessages.length - 1]?.timestamp) ?? 0);
  const recentCompletedTurnFinalCandidate = source.assistantMessages[source.assistantMessages.length - 1] ?? null;
  const shouldShowRecentCompletedTurnLayout = !input.sending
    && !input.pendingFinal
    && !!activeTurnUserMessage
    && !!recentCompletedTurnFinalCandidate
    && hasVisibleFinalContent(recentCompletedTurnFinalCandidate)
    && isWithinCompletedTurnProcessGrace(activeTurnStartedAtMs);
  const resolvedPersistedFinalMessage = source.persistedFinalMessage
    ?? (shouldShowRecentCompletedTurnLayout ? recentCompletedTurnFinalCandidate : null);
  const effectiveActiveTurnProcessMessages = shouldShowRecentCompletedTurnLayout
    && !source.persistedFinalMessage
    && source.processMessages.length > 0
    ? source.processMessages.slice(0, -1)
    : source.processMessages;
  const hasPersistedProcessMessages = effectiveActiveTurnProcessMessages.some((message) => (
    hasVisibleProcessContent(
      message,
      input.showThinking,
      input.chatProcessDisplayMode,
      input.assistantMessageStyle,
      input.hideInternalRoutineProcesses,
    )
  ));
  const hasStreamingProcessMessage = source.processStreamingMessage != null
    && hasVisibleProcessContent(
      source.processStreamingMessage,
      input.showThinking,
      input.chatProcessDisplayMode,
      input.assistantMessageStyle,
      input.hideInternalRoutineProcesses,
    );
  const hasStreamingFinalMessage = source.finalStreamingMessage != null
    && hasVisibleFinalContent(source.finalStreamingMessage);
  const hasStreamToolStatus = input.chatProcessDisplayMode === 'all' && input.streamingTools.length > 0;
  const shouldUseProcessLayout = hasPersistedProcessMessages
    || hasStreamingProcessMessage
    || hasStreamToolStatus
    || input.pendingFinal
    || (input.sending && (source.assistantMessages.length > 0 || source.streamingDisplayMessage != null))
    || shouldShowRecentCompletedTurnLayout;
  const activeTurnProcessStreamingMessage = shouldUseProcessLayout
    ? (source.isStreamingDuplicateOfPersistedAssistant
        ? null
        : hasStreamingProcessMessage
        ? source.processStreamingMessage
        : input.sending && hasStreamingFinalMessage
          ? source.finalStreamingMessage
        : input.chatProcessDisplayMode === 'all' && input.streamingTools.length > 0
          ? {
              role: 'assistant' as const,
              content: '',
              timestamp: source.finalStreamingMessage?.timestamp ?? activeTurnUserMessage?.timestamp ?? 0,
            }
          : null)
    : null;
  const activeTurnFinalStreamingMessage = shouldUseProcessLayout
    ? (!input.sending && hasStreamingFinalMessage && !source.isStreamingDuplicateOfPersistedAssistant ? source.finalStreamingMessage : null)
    : (source.isStreamingDuplicateOfPersistedAssistant ? null : source.finalStreamingMessage);
  const hasVisibleFinalReply = hasVisibleFinalContent(resolvedPersistedFinalMessage)
    || hasVisibleFinalContent(activeTurnFinalStreamingMessage);
  const showProcessActivity = shouldUseProcessLayout
    && !hasVisibleFinalReply
    && ((input.sending && !hasStreamingFinalMessage) || shouldShowRecentCompletedTurnLayout);
  const displayHistoryItems = groupMessagesForDisplay(displayHistoryMessages);
  const shouldHideStandaloneStreamingAvatar = (() => {
    if (shouldUseProcessLayout || showProcessActivity) return true;
    const lastHistoryItem = displayHistoryItems[displayHistoryItems.length - 1];
    return lastHistoryItem?.type === 'turn';
  })();
  const activeTurn = !shouldHideActiveTurn && activeTurnUserMessage && activeTurnScrollKey
    ? {
        userMessage: activeTurnUserMessage,
        startedAtMs: activeTurnStartedAtMs,
        processMessages: effectiveActiveTurnProcessMessages,
        processStreamingMessage: activeTurnProcessStreamingMessage,
        finalMessage: resolvedPersistedFinalMessage,
        finalStreamingMessage: activeTurnFinalStreamingMessage,
        showActivity: showProcessActivity,
        showTyping: !shouldUseProcessLayout
          && !resolvedPersistedFinalMessage
          && !activeTurnFinalStreamingMessage
          && !input.pendingFinal
          && !source.hasAnyStreamContent,
        useProcessLayout: shouldUseProcessLayout,
        streamingTools: input.streamingTools,
        sending: input.sending,
        scrollKey: activeTurnScrollKey,
      }
    : null;

  const chatListItems: ChatListItem[] = displayHistoryItems.map((item) => ({
    type: 'history',
    key: item.key,
    item,
  }));

  if (activeTurn) {
    chatListItems.push({
      type: 'active-turn',
      key: activeTurn.scrollKey,
    });
  } else {
    if (!shouldHideActiveTurn && activeTurnFinalStreamingMessage) {
      chatListItems.push({
        type: 'streaming-final',
        key: `streaming:${activeTurnFinalStreamingMessage.id ?? activeTurnFinalStreamingMessage.timestamp ?? input.currentSessionKey}`,
        message: activeTurnFinalStreamingMessage,
      });
    }

    if (
      !shouldHideActiveTurn
      && input.sending
      && input.pendingFinal
      && !activeTurnFinalStreamingMessage
      && !source.isStreamingDuplicateOfPersistedAssistant
      && input.chatProcessDisplayMode === 'all'
    ) {
      chatListItems.push({
        type: 'activity',
        key: `activity:${input.currentSessionKey}`,
      });
    }

    if (!shouldHideActiveTurn && input.sending && !input.pendingFinal && !source.hasAnyStreamContent) {
      chatListItems.push({
        type: 'typing',
        key: `typing:${input.currentSessionKey}`,
      });
    }
  }

  const latestTranscriptActivitySignature = buildLatestTranscriptActivitySignature({
    input,
    chatListItems,
    displayHistoryItems,
    activeTurnScrollKey,
    activeTurnUserMessage,
    activeTurnProcessStreamingMessage,
    activeTurnFinalStreamingMessage,
    resolvedPersistedFinalMessage,
  });

  return {
    activeTurn,
    chatListItems,
    displayHistoryItems,
    latestTranscriptActivitySignature,
    scroll: {
      activeTurnScrollKey,
      shouldHideStandaloneStreamingAvatar,
    },
  };
}

export function useChatTranscriptModel(input: Omit<BuildChatTranscriptModelInput, 'deferredHistoryMessages'>): ChatTranscriptModel {
  const fallbackHistoryMessages = useMemo(() => buildFallbackActiveTurn({
    messages: input.messages,
    streamingMessage: input.streamingMessage,
    lastUserMessageAt: input.lastUserMessageAt,
    sending: input.sending,
  }).historyMessages, [
    input.lastUserMessageAt,
    input.messages,
    input.sending,
    input.streamingMessage,
  ]);
  const historyMessages = input.activeTurnBuffer?.historyMessages ?? fallbackHistoryMessages;
  const deferredHistoryMessages = useDeferredValue(historyMessages);

  return useMemo(() => buildChatTranscriptModel({
    currentSessionKey: input.currentSessionKey,
    messages: input.messages,
    deferredHistoryMessages,
    activeTurnBuffer: input.activeTurnBuffer,
    streamingMessage: input.streamingMessage,
    streamingTools: input.streamingTools,
    sending: input.sending,
    pendingFinal: input.pendingFinal,
    lastUserMessageAt: input.lastUserMessageAt,
    showThinking: input.showThinking,
    chatProcessDisplayMode: input.chatProcessDisplayMode,
    assistantMessageStyle: input.assistantMessageStyle,
    hideInternalRoutineProcesses: input.hideInternalRoutineProcesses,
  }), [
    deferredHistoryMessages,
    input.activeTurnBuffer,
    input.assistantMessageStyle,
    input.chatProcessDisplayMode,
    input.currentSessionKey,
    input.hideInternalRoutineProcesses,
    input.lastUserMessageAt,
    input.messages,
    input.pendingFinal,
    input.sending,
    input.showThinking,
    input.streamingMessage,
    input.streamingTools,
  ]);
}
