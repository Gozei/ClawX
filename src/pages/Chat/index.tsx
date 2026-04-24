/**
 * Chat Page
 * Native React implementation communicating with OpenClaw Gateway
 * via gateway:rpc IPC. Session selector, thinking toggle, and refresh
 * are in the toolbar; messages render with markdown + streaming.
 */
import { forwardRef, type ForwardedRef, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ChevronDown, ChevronRight, Loader2, Sparkles } from 'lucide-react';
import { Virtuoso, type ContextProp, type ItemProps, type ListProps, type ScrollerProps, type VirtuosoHandle } from 'react-virtuoso';
import { useLocation, useNavigate } from 'react-router-dom';
import { useChatStore, type AttachedFileMeta, type RawMessage, type ToolStatus } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { useAgentsStore } from '@/stores/agents';
import { AppLogo } from '@/components/branding/AppLogo';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ChatMessage } from './ChatMessage';
import { ChatFilePreviewPanel } from './ChatFilePreview';
import { ChatInput } from './ChatInput';
import { ChatToolbarV2 } from './ChatToolbarV2';
import { CHAT_CONTENT_COLUMN_MAX_WIDTH_CLASS, CHAT_SURFACE_MAX_WIDTH_CLASS } from './layout';
import {
  assistantMessageShowsInChat,
  extractImages,
  isInternalMaintenanceTurnUserMessage,
  extractText,
  extractThinking,
  extractToolUse,
} from './message-utils';
import { useTranslation } from 'react-i18next';
import { useBranding } from '@/lib/branding';
import { isWithinCompletedTurnProcessGrace } from '@/lib/chat-turn-grace';
import { cn } from '@/lib/utils';
import { useMinLoading } from '@/hooks/use-min-loading';
import { useSettingsStore, type AssistantMessageStyle, type ChatProcessDisplayMode } from '@/stores/settings';
import { isSessionRunning } from '@/stores/chat/session-running';
import { getLastChatEventAt } from '@/stores/chat/helpers';
import { groupMessagesForDisplay, splitFinalMessageForTurnDisplay, type HistoryDisplayItem } from './history-grouping';
import { getProcessActivityLabel, getProcessEventItems, ProcessEventMessage, ProcessFinalDivider } from './process-events-next';

const EMPTY_MESSAGES: RawMessage[] = [];
const ACTIVE_TURN_BOTTOM_OFFSET_PX = 16;
const ACTIVE_TURN_AUTO_SCROLL_DURATION_MS = 500;
const ACTIVE_TURN_PROGRAMMATIC_SCROLL_GUARD_MS = 80;
const ACTIVE_TURN_NEAR_BOTTOM_THRESHOLD_PX = 48;
const CHAT_SCROLL_TOP_BREATHING_ROOM_PX = 20;
const CHAT_COMPOSER_PREFILL_STATE_KEY = 'composerPrefillText';
const ACTIVE_TURN_USER_MATCH_WINDOW_MS = 60_000;
const SESSION_ENTRY_BOTTOM_STABILIZE_MS = 400;
const PROCESS_ACTIVITY_SOFT_STALL_MS = 12_000;
const PROCESS_ACTIVITY_LONG_STALL_MS = 30_000;
const CHAT_CONTENT_COLUMN_WIDTH_CSS = 'min(calc(100% - 1rem), 54rem)';
const CHAT_PREVIEW_DEFAULT_WIDTH_PERCENT = 50;
const CHAT_PREVIEW_MIN_WIDTH_PERCENT = 25;
const CHAT_PREVIEW_MAX_WIDTH_PERCENT = 75;
type ActiveTurnAutoScrollMode = 'idle' | 'follow-bottom';

function clampPreviewPaneWidth(widthPercent: number): number {
  return Math.max(CHAT_PREVIEW_MIN_WIDTH_PERCENT, Math.min(CHAT_PREVIEW_MAX_WIDTH_PERCENT, widthPercent));
}

type ChatListItem =
  | {
      type: 'history';
      key: string;
      item: HistoryDisplayItem;
    }
  | {
      type: 'active-turn';
      key: string;
    }
  | {
      type: 'streaming-final';
      key: string;
      message: RawMessage;
    }
  | {
      type: 'activity';
      key: string;
    }
  | {
      type: 'typing';
      key: string;
    };

type ChatVirtuosoContext = {
  disableOverflowAnchor: boolean;
  horizontalOffsetPx: number;
  scrollbarGutter?: 'auto' | 'stable both-edges';
  setScrollElement: (node: HTMLDivElement | null) => void;
};

function assignForwardedRef<T>(ref: ForwardedRef<T>, value: T | null) {
  if (typeof ref === 'function') {
    ref(value);
    return;
  }

  if (ref) {
    ref.current = value;
  }
}

function ChatContentMeasureRail({ horizontalOffsetPx = 0 }: { horizontalOffsetPx?: number }) {
  return (
    <div
      aria-hidden="true"
      data-testid="chat-content-measure-rail"
      className={cn(CHAT_CONTENT_COLUMN_MAX_WIDTH_CLASS, 'pointer-events-none absolute left-0 right-0 top-0 mx-auto h-px min-w-0 opacity-0')}
      style={{
        width: CHAT_CONTENT_COLUMN_WIDTH_CSS,
        transform: horizontalOffsetPx === 0 ? undefined : `translateX(${horizontalOffsetPx}px)`,
      }}
    />
  );
}

const ChatVirtuosoScroller = forwardRef<HTMLDivElement, ScrollerProps & ContextProp<ChatVirtuosoContext>>(
  function ChatVirtuosoScroller({ children, context, style, tabIndex, ...restProps }, ref) {
    const resolvedClassName = (restProps as { className?: string }).className;
    const handleRef = useCallback((node: HTMLDivElement | null) => {
      assignForwardedRef(ref, node);
      context.setScrollElement(node);
    }, [context, ref]);

    return (
      <div
        ref={handleRef}
        tabIndex={tabIndex}
        {...restProps}
        data-testid="chat-scroll-container"
        data-chat-scroll-container="true"
        className={cn('relative flex-1 min-h-0 min-w-0 overflow-x-hidden overflow-y-auto px-4 pb-8', resolvedClassName)}
        style={{
          ...style,
          overflowAnchor: context.disableOverflowAnchor ? 'none' : style?.overflowAnchor,
          overflowX: 'hidden',
          scrollbarGutter: context.scrollbarGutter ?? 'stable both-edges',
        }}
      >
        <ChatContentMeasureRail horizontalOffsetPx={context.horizontalOffsetPx} />
        {children}
      </div>
    );
  },
);

function ChatVirtuosoHeader() {
  return (
    <div
      aria-hidden="true"
      data-testid="chat-scroll-top-inset"
      style={{ height: `${CHAT_SCROLL_TOP_BREATHING_ROOM_PX}px`, flexShrink: 0 }}
    />
  );
}

const ChatVirtuosoList = forwardRef<HTMLDivElement, ListProps & ContextProp<ChatVirtuosoContext>>(
  function ChatVirtuosoList({ children, context, style, ...restProps }, ref) {
    const resolvedClassName = (restProps as { className?: string }).className;
    return (
      <div
        ref={ref}
        {...restProps}
        data-testid="chat-content-column"
        data-chat-content-column="true"
        className={cn(CHAT_CONTENT_COLUMN_MAX_WIDTH_CLASS, 'mx-auto flex min-w-0 flex-col gap-4', resolvedClassName)}
        style={{
          ...style,
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
          transform: context.horizontalOffsetPx === 0 ? undefined : `translateX(${context.horizontalOffsetPx}px)`,
          width: CHAT_CONTENT_COLUMN_WIDTH_CSS,
        }}
      >
        {children}
      </div>
    );
  },
);

const ChatVirtuosoItem = forwardRef<HTMLDivElement, ItemProps<ChatListItem> & ContextProp<ChatVirtuosoContext>>(
  function ChatVirtuosoItem({ children, style, ...restProps }, ref) {
    return (
      <div
        ref={ref}
        {...restProps}
        style={{
          ...style,
          boxSizing: 'border-box',
          marginTop: 0,
          marginLeft: 0,
          marginRight: 0,
          padding: 0,
          width: '100%',
        }}
        className="min-w-0 last:mb-10"
      >
        {children}
      </div>
    );
  },
);

export function Chat() {
  const { t, i18n } = useTranslation('chat');
  const location = useLocation();
  const navigate = useNavigate();
  const gatewayStatus = useGatewayStore((s) => s.status);
  const isGatewayRunning = gatewayStatus.state === 'running';

  const messages = useChatStore((s) => s.messages);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const loading = useChatStore((s) => s.loading);
  const rawSending = useChatStore((s) => s.sending);
  const error = useChatStore((s) => s.error);
  const showThinking = useChatStore((s) => s.showThinking);
  const chatProcessDisplayMode = useSettingsStore((s) => s.chatProcessDisplayMode);
  const hideInternalRoutineProcesses = useSettingsStore((s) => s.hideInternalRoutineProcesses);
  const assistantMessageStyle = useSettingsStore((s) => s.assistantMessageStyle);
  const sidebarCollapsed = useSettingsStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useSettingsStore((s) => s.setSidebarCollapsed);
  const sessionRunningState = useChatStore((s) => s.sessionRunningState);
  const activeTurnBuffer = useChatStore((s) => s.activeTurnBuffer);
  const rawStreamingMessage = useChatStore((s) => s.streamingMessage);
  const streamingTools = useChatStore((s) => s.streamingTools);
  const sendStage = useChatStore((s) => s.sendStage);
  const pendingFinal = useChatStore((s) => s.pendingFinal);
  const lastUserMessageAt = useChatStore((s) => s.lastUserMessageAt);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const queueOfflineMessage = useChatStore((s) => s.queueOfflineMessage);
  const flushQueuedMessage = useChatStore((s) => s.flushQueuedMessage);
  const clearQueuedMessage = useChatStore((s) => s.clearQueuedMessage);
  const loadHistory = useChatStore((s) => s.loadHistory);
  const abortRun = useChatStore((s) => s.abortRun);
  const clearError = useChatStore((s) => s.clearError);
  const fetchAgents = useAgentsStore((s) => s.fetchAgents);
  const queuedMessages = useChatStore((s) => s.queuedMessages[s.currentSessionKey]);
  const queuedMessage = queuedMessages?.[0] ?? null;
  const queuedMessageCount = queuedMessages?.length ?? 0;

  const cleanupEmptySession = useChatStore((s) => s.cleanupEmptySession);
  const [composerPrefill, setComposerPrefill] = useState<{ text: string; nonce: number }>({
    text: '',
    nonce: 0,
  });
  const autoFlushAttemptedQueuedIdRef = useRef<string | null>(null);
  const chatListRef = useRef<VirtuosoHandle | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const activeTurnViewportAnchorRef = useRef<HTMLDivElement | null>(null);
  const splitPaneRef = useRef<HTMLDivElement | null>(null);
  const activeTurnAutoScrollModeRef = useRef<ActiveTurnAutoScrollMode>('idle');
  const activeTurnTrackedTurnKeyRef = useRef<string | null>(null);
  const suppressedAutoFollowTurnKeyRef = useRef<string | null>(null);
  const pendingLocalSendFollowBottomRef = useRef(false);
  const pendingSessionEntryBottomRef = useRef(false);
  const pendingSessionEntryUserInterruptedRef = useRef(false);
  const previousSessionKeyRef = useRef(currentSessionKey);
  const hasMountedSessionRef = useRef(false);
  const activeTurnAutoScrollTargetRef = useRef(0);
  const activeTurnAutoScrollFrameRef = useRef<number | null>(null);
  const activeTurnAutoScrollAnimationRef = useRef<{ startTop: number; targetTop: number; startedAt: number } | null>(null);
  const previewResizeStartXRef = useRef<number | null>(null);
  const previewResizeStartWidthRef = useRef(CHAT_PREVIEW_DEFAULT_WIDTH_PERCENT);
  const previewAutoCollapsedSidebarRef = useRef(false);
  const previewPaneOpenRef = useRef(false);
  const sidebarCollapsedRef = useRef(sidebarCollapsed);
  const hadPreviewOpenRef = useRef(false);
  const [activeTurnUserInterruptVersion, setActiveTurnUserInterruptVersion] = useState(0);
  const [composerShellPadding, setComposerShellPadding] = useState({ left: 16, right: 16 });
  const [scrollContainerNode, setScrollContainerNodeState] = useState<HTMLDivElement | null>(null);
  const [contentColumnHorizontalOffsetPx, setContentColumnHorizontalOffsetPx] = useState(0);
  const [selectedPreviewFile, setSelectedPreviewFile] = useState<AttachedFileMeta | null>(null);
  const [previewPaneWidthPercent, setPreviewPaneWidthPercent] = useState(CHAT_PREVIEW_DEFAULT_WIDTH_PERCENT);
  const lastConsumedLocationKeyRef = useRef<string | null>(null);

  previewPaneOpenRef.current = !!selectedPreviewFile;
  sidebarCollapsedRef.current = sidebarCollapsed;

  const safeMessages = Array.isArray(messages) ? messages : EMPTY_MESSAGES;
  const sending = useMemo(() => (
    isSessionRunning(currentSessionKey, sessionRunningState, {
      currentSessionKey,
      sending: rawSending,
      pendingFinal,
      sendStage,
      streamingMessage: rawStreamingMessage,
      streamingTools,
    })
  ), [currentSessionKey, pendingFinal, rawSending, rawStreamingMessage, sendStage, sessionRunningState, streamingTools]);
  const showQueuedMessageNotice = queuedMessageCount > 0 && isGatewayRunning && !sending;
  const showQueuedMessageCard = queuedMessageCount > 0 && (!isGatewayRunning || sending);
  const canSendQueuedDraftNow = isGatewayRunning && !sending;
  const minLoading = useMinLoading(loading && safeMessages.length > 0);
  const restoreAutoCollapsedSidebar = useCallback(() => {
    if (!previewAutoCollapsedSidebarRef.current) {
      return;
    }

    previewAutoCollapsedSidebarRef.current = false;
    setSidebarCollapsed(false);
  }, [setSidebarCollapsed]);

  // Load data when gateway is running.
  // When the store already holds messages for this session (i.e. the user
  // is navigating *back* to Chat), use quiet mode so the existing messages
  // stay visible while fresh data loads in the background.  This avoids
  // an unnecessary messages 闁?spinner 闁?messages flicker.
  useEffect(() => {
    return () => {
      // If the user navigates away without sending any messages, remove the
      // empty session so it doesn't linger as a ghost entry in the sidebar.
      cleanupEmptySession();
    };
  }, [cleanupEmptySession]);

  useEffect(() => {
    void fetchAgents();
  }, [fetchAgents]);

  useEffect(() => {
    const shouldLoadQuietly = safeMessages.length > 0 || !isGatewayRunning;
    void loadHistory(shouldLoadQuietly);
  }, [currentSessionKey, isGatewayRunning, loadHistory]);

  useEffect(() => {
    restoreAutoCollapsedSidebar();
    setSelectedPreviewFile(null);
  }, [currentSessionKey, restoreAutoCollapsedSidebar]);

  useLayoutEffect(() => {
    const hasPreview = !!selectedPreviewFile;

    if (!hasPreview && hadPreviewOpenRef.current) {
      restoreAutoCollapsedSidebar();
    }

    hadPreviewOpenRef.current = hasPreview;
  }, [restoreAutoCollapsedSidebar, selectedPreviewFile]);

  useEffect(() => {
    const routeState = location.state && typeof location.state === 'object'
      ? location.state as Record<string, unknown>
      : null;
    const prefillText = typeof routeState?.[CHAT_COMPOSER_PREFILL_STATE_KEY] === 'string'
      ? routeState[CHAT_COMPOSER_PREFILL_STATE_KEY]
      : '';

    if (!prefillText || lastConsumedLocationKeyRef.current === location.key) {
      return;
    }

    lastConsumedLocationKeyRef.current = location.key;
    setComposerPrefill({ text: prefillText, nonce: Date.now() });

    const restState = routeState
      ? (({ [CHAT_COMPOSER_PREFILL_STATE_KEY]: _ignored, ...rest }) => rest)(routeState)
      : null;
    navigate(
      {
        pathname: location.pathname,
        search: location.search,
        hash: location.hash,
      },
      {
        replace: true,
        state: restState && Object.keys(restState).length > 0 ? restState : null,
      },
    );
  }, [location.hash, location.key, location.pathname, location.search, location.state, navigate]);

  useEffect(() => {
    if (!isGatewayRunning || !queuedMessage) {
      autoFlushAttemptedQueuedIdRef.current = null;
      return;
    }

    if (sending) {
      return;
    }

    if (autoFlushAttemptedQueuedIdRef.current === queuedMessage.id) {
      return;
    }

    autoFlushAttemptedQueuedIdRef.current = queuedMessage.id;
    void flushQueuedMessage(currentSessionKey, queuedMessage.id);
  }, [currentSessionKey, flushQueuedMessage, isGatewayRunning, queuedMessage, sending]);

  // Gateway not running block has been completely removed so the UI always renders.
  const fallbackStreamMsg = useMemo(() => (
    !activeTurnBuffer && rawStreamingMessage && typeof rawStreamingMessage === 'object'
      ? rawStreamingMessage as unknown as { role?: string; content?: unknown; timestamp?: number }
      : activeTurnBuffer?.streamingDisplayMessage && typeof activeTurnBuffer.streamingDisplayMessage === 'object'
        ? activeTurnBuffer.streamingDisplayMessage as unknown as { role?: string; content?: unknown; timestamp?: number }
      : null
  ), [activeTurnBuffer, rawStreamingMessage]);
  const fallbackStreamText = fallbackStreamMsg
    ? extractText(fallbackStreamMsg)
    : (!activeTurnBuffer && typeof rawStreamingMessage === 'string' ? rawStreamingMessage : '');
  const fallbackLastUserIndex = findLastUserMessageIndex(safeMessages);
  const fallbackLastUserTimestampMs = toTimestampMs(lastUserMessageAt ?? undefined) ?? 0;
  const shouldRetainCompletedFallbackTurn = !activeTurnBuffer
    && !sending
    && fallbackLastUserIndex >= 0
    && fallbackLastUserTimestampMs > 0
    && isWithinCompletedTurnProcessGrace(fallbackLastUserTimestampMs)
    && safeMessages.slice(fallbackLastUserIndex + 1).some((message) => (
      message.role === 'assistant'
      && ((toTimestampMs(message.timestamp) ?? fallbackLastUserTimestampMs) >= fallbackLastUserTimestampMs)
    ));
  const fallbackActiveTurnStartIndex = !activeTurnBuffer && (sending || shouldRetainCompletedFallbackTurn)
    ? fallbackLastUserIndex
    : -1;
  const fallbackHistoryMessages = fallbackActiveTurnStartIndex >= 0 ? safeMessages.slice(0, fallbackActiveTurnStartIndex) : safeMessages;
  const fallbackActiveTurnMessages = fallbackActiveTurnStartIndex >= 0 ? safeMessages.slice(fallbackActiveTurnStartIndex) : EMPTY_MESSAGES;
  const fallbackActiveTurnUserMessage = fallbackActiveTurnMessages[0]?.role === 'user' ? fallbackActiveTurnMessages[0] : null;
  const fallbackStreamingTimestamp = fallbackStreamMsg?.timestamp
    ?? fallbackActiveTurnUserMessage?.timestamp
    ?? safeMessages[safeMessages.length - 1]?.timestamp
    ?? 0;
  const fallbackStreamingDisplayMessage = buildStreamingDisplayMessage(
    fallbackStreamMsg,
    fallbackStreamText,
    fallbackStreamingTimestamp,
  );
  const fallbackAssistantMessages = fallbackActiveTurnUserMessage
    ? fallbackActiveTurnMessages.slice(1).filter((message) => message.role === 'assistant')
    : EMPTY_MESSAGES;
  const fallbackLatestPersistedAssistant = !activeTurnBuffer ? [...safeMessages].reverse().find((message) => {
    if (message.role !== 'assistant') return false;
    if (!fallbackActiveTurnUserMessage?.timestamp || !message.timestamp) return true;
    return toTimestampMs(message.timestamp)! >= toTimestampMs(fallbackActiveTurnUserMessage.timestamp)!;
  }) ?? null : null;
  const fallbackIsStreamingDuplicate = !activeTurnBuffer
    && !!fallbackLatestPersistedAssistant
    && !!fallbackStreamingDisplayMessage
    && extractText(fallbackLatestPersistedAssistant).trim().length > 0
    && extractText(fallbackLatestPersistedAssistant).trim() === extractText(fallbackStreamingDisplayMessage).trim();
  const fallbackPersistedFinalMessage = fallbackIsStreamingDuplicate && fallbackAssistantMessages.length > 0
    ? fallbackAssistantMessages[fallbackAssistantMessages.length - 1]
    : null;
  const fallbackProcessMessages = fallbackPersistedFinalMessage
    ? fallbackAssistantMessages.slice(0, -1)
    : fallbackAssistantMessages;
  const fallbackSplitStreaming = fallbackStreamingDisplayMessage
    ? splitFinalMessageForTurnDisplay(fallbackStreamingDisplayMessage)
    : null;

  const historyMessages = activeTurnBuffer?.historyMessages ?? fallbackHistoryMessages;
  const deferredHistoryMessages = useDeferredValue(historyMessages);
  const activeTurnUserMessage = activeTurnBuffer?.userMessage ?? fallbackActiveTurnUserMessage;
  const shouldHideActiveTurn = !!activeTurnUserMessage && isInternalMaintenanceTurnUserMessage(activeTurnUserMessage);
  const activeTurnScrollKey = !shouldHideActiveTurn && activeTurnUserMessage
    ? `${currentSessionKey}:${buildMessageDisplayKey(activeTurnUserMessage)}`
    : null;
  const displayHistoryMessages = useMemo(() => (
    trimDeferredHistoryForActiveTurn(
      deferredHistoryMessages,
      shouldHideActiveTurn ? null : activeTurnUserMessage,
    )
  ), [activeTurnUserMessage, deferredHistoryMessages, shouldHideActiveTurn]);
  const activeTurnProcessMessages = activeTurnBuffer?.processMessages ?? fallbackProcessMessages;
  const activeTurnAssistantMessages = activeTurnBuffer?.assistantMessages ?? fallbackAssistantMessages;
  const persistedActiveFinalMessage = activeTurnBuffer?.persistedFinalMessage ?? fallbackPersistedFinalMessage;
  const streamingProcessMessage = activeTurnBuffer?.processStreamingMessage ?? fallbackSplitStreaming?.collapsedProcessMessage ?? null;
  const splitStreamingFinalMessage = activeTurnBuffer?.finalStreamingMessage ?? fallbackSplitStreaming?.finalDisplayMessage ?? fallbackStreamingDisplayMessage;
  const hasAnyStreamContent = activeTurnBuffer?.hasAnyStreamContent ?? !!fallbackStreamingDisplayMessage;
  const isStreamingDuplicateOfPersistedAssistant = activeTurnBuffer?.isStreamingDuplicateOfPersistedAssistant ?? fallbackIsStreamingDuplicate;
  const hasStreamToolStatus = chatProcessDisplayMode === 'all' && streamingTools.length > 0;
  const streamingDisplayMessage = activeTurnBuffer?.streamingDisplayMessage ?? fallbackStreamingDisplayMessage;
  const activeTurnStartedAtMs = activeTurnUserMessage
    ? (activeTurnBuffer?.startedAtMs ?? toTimestampMs(activeTurnUserMessage.timestamp) ?? toTimestampMs(safeMessages[safeMessages.length - 1]?.timestamp) ?? 0)
    : (activeTurnBuffer?.startedAtMs ?? toTimestampMs(safeMessages[safeMessages.length - 1]?.timestamp) ?? 0);
  const recentCompletedTurnFinalCandidate = activeTurnAssistantMessages[activeTurnAssistantMessages.length - 1] ?? null;
  const shouldShowRecentCompletedTurnLayout = !sending
    && !pendingFinal
    && !!activeTurnUserMessage
    && !!recentCompletedTurnFinalCandidate
    && hasVisibleFinalContent(recentCompletedTurnFinalCandidate)
    && isWithinCompletedTurnProcessGrace(activeTurnStartedAtMs);
  const effectiveActiveTurnProcessMessages = shouldShowRecentCompletedTurnLayout
    && !persistedActiveFinalMessage
    && activeTurnProcessMessages.length > 0
    ? activeTurnProcessMessages.slice(0, -1)
    : activeTurnProcessMessages;
  const resolvedPersistedFinalMessage = persistedActiveFinalMessage
    ?? (shouldShowRecentCompletedTurnLayout ? recentCompletedTurnFinalCandidate : null);
  const hasPersistedProcessMessages = effectiveActiveTurnProcessMessages.some((message) => (
    hasVisibleProcessContent(message, showThinking, chatProcessDisplayMode, assistantMessageStyle, hideInternalRoutineProcesses)
  ));
  const hasStreamingProcessMessage = streamingProcessMessage != null
    && hasVisibleProcessContent(streamingProcessMessage, showThinking, chatProcessDisplayMode, assistantMessageStyle, hideInternalRoutineProcesses);
  const hasStreamingFinalMessage = splitStreamingFinalMessage != null
    && hasVisibleFinalContent(splitStreamingFinalMessage);
  const shouldUseProcessLayout = hasPersistedProcessMessages
    || hasStreamingProcessMessage
    || hasStreamToolStatus
    || pendingFinal
    || (sending && (activeTurnAssistantMessages.length > 0 || streamingDisplayMessage != null))
    || shouldShowRecentCompletedTurnLayout;
  const activeTurnProcessStreamingMessage = shouldUseProcessLayout
    ? (isStreamingDuplicateOfPersistedAssistant
        ? null
        : hasStreamingProcessMessage
        ? streamingProcessMessage
        : sending && hasStreamingFinalMessage
          ? splitStreamingFinalMessage
        : chatProcessDisplayMode === 'all' && streamingTools.length > 0
          ? {
              role: 'assistant' as const,
              content: '',
              timestamp: splitStreamingFinalMessage?.timestamp ?? activeTurnUserMessage?.timestamp ?? 0,
            }
          : null)
    : null;
  const activeTurnFinalStreamingMessage = shouldUseProcessLayout
    ? (!sending && hasStreamingFinalMessage && !isStreamingDuplicateOfPersistedAssistant ? splitStreamingFinalMessage : null)
    : (isStreamingDuplicateOfPersistedAssistant ? null : splitStreamingFinalMessage);
  const hasVisibleFinalReply = hasVisibleFinalContent(resolvedPersistedFinalMessage)
    || hasVisibleFinalContent(activeTurnFinalStreamingMessage);
  const showProcessActivity = shouldUseProcessLayout
    && !hasVisibleFinalReply
    && ((sending && !hasStreamingFinalMessage) || shouldShowRecentCompletedTurnLayout);
  const displayHistoryItems = useMemo(() => groupMessagesForDisplay(displayHistoryMessages), [displayHistoryMessages]);
  const shouldHideStandaloneStreamingAvatar = useMemo(() => {
    if (shouldUseProcessLayout || showProcessActivity) return true;
    const lastHistoryItem = displayHistoryItems[displayHistoryItems.length - 1];
    return lastHistoryItem?.type === 'turn';
  }, [displayHistoryItems, shouldUseProcessLayout, showProcessActivity]);
  const chatListItems = useMemo<ChatListItem[]>(() => {
    const items: ChatListItem[] = displayHistoryItems.map((item) => ({
      type: 'history',
      key: item.key,
      item,
    }));

    if (!shouldHideActiveTurn && activeTurnUserMessage) {
      items.push({
        type: 'active-turn',
        key: activeTurnScrollKey ?? `active-turn:${currentSessionKey}`,
      });
      return items;
    }

    if (!shouldHideActiveTurn && activeTurnFinalStreamingMessage) {
      items.push({
        type: 'streaming-final',
        key: `streaming:${activeTurnFinalStreamingMessage.id ?? activeTurnFinalStreamingMessage.timestamp ?? currentSessionKey}`,
        message: activeTurnFinalStreamingMessage,
      });
    }

    if (
      !shouldHideActiveTurn
      && sending
      && pendingFinal
      && !activeTurnFinalStreamingMessage
      && !isStreamingDuplicateOfPersistedAssistant
      && chatProcessDisplayMode === 'all'
    ) {
      items.push({
        type: 'activity',
        key: `activity:${currentSessionKey}`,
      });
    }

    if (!shouldHideActiveTurn && sending && !pendingFinal && !hasAnyStreamContent) {
      items.push({
        type: 'typing',
        key: `typing:${currentSessionKey}`,
      });
    }

    return items;
  }, [
    activeTurnFinalStreamingMessage,
    activeTurnScrollKey,
    activeTurnUserMessage,
    chatProcessDisplayMode,
    currentSessionKey,
    displayHistoryItems,
    hasAnyStreamContent,
    isStreamingDuplicateOfPersistedAssistant,
    pendingFinal,
    sending,
    shouldHideActiveTurn,
  ]);

  const isEmpty = safeMessages.length === 0 && !sending;
  const showSessionLoadingState = loading && safeMessages.length === 0 && !sending;
  const isZh = (i18n.resolvedLanguage || i18n.language || '').startsWith('zh');
  const setScrollContainerNode = useCallback((node: HTMLDivElement | null) => {
    scrollContainerRef.current = node;
    setScrollContainerNodeState((current) => (current === node ? current : node));
  }, []);
  useEffect(() => {
    const scrollElement = scrollContainerRef.current;
    if (!scrollElement || !pendingSessionEntryBottomRef.current) return;

    const interruptPendingEntry = () => {
      pendingSessionEntryUserInterruptedRef.current = true;
      pendingSessionEntryBottomRef.current = false;
    };
    const handleKeyboardInterrupt = (event: KeyboardEvent) => {
      if (!['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', 'Space'].includes(event.code)) return;
      interruptPendingEntry();
    };

    scrollElement.addEventListener('wheel', interruptPendingEntry, { passive: true });
    scrollElement.addEventListener('touchmove', interruptPendingEntry, { passive: true });
    scrollElement.addEventListener('keydown', handleKeyboardInterrupt);

    return () => {
      scrollElement.removeEventListener('wheel', interruptPendingEntry);
      scrollElement.removeEventListener('touchmove', interruptPendingEntry);
      scrollElement.removeEventListener('keydown', handleKeyboardInterrupt);
    };
  }, [currentSessionKey, chatListItems.length, loading]);

  useLayoutEffect(() => {
    if (!pendingSessionEntryBottomRef.current) return;
    if (pendingSessionEntryUserInterruptedRef.current) {
      pendingSessionEntryBottomRef.current = false;
      return;
    }
    if (sending && activeTurnScrollKey) {
      pendingLocalSendFollowBottomRef.current = true;
      pendingSessionEntryBottomRef.current = false;
      pendingSessionEntryUserInterruptedRef.current = false;
      return;
    }
    if (loading || chatListItems.length === 0) return;

    let frame1 = 0;
    let frame2 = 0;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    let resizeObserver: ResizeObserver | null = null;

    const cancelFrames = () => {
      cancelAnimationFrame(frame1);
      cancelAnimationFrame(frame2);
    };
    const completeSessionEntryBottom = () => {
      pendingSessionEntryBottomRef.current = false;
      pendingSessionEntryUserInterruptedRef.current = false;
      cancelFrames();
      if (settleTimer != null) {
        clearTimeout(settleTimer);
        settleTimer = null;
      }
      resizeObserver?.disconnect();
    };
    const scheduleCompletion = () => {
      if (settleTimer != null) {
        clearTimeout(settleTimer);
      }
      settleTimer = setTimeout(() => {
        completeSessionEntryBottom();
      }, SESSION_ENTRY_BOTTOM_STABILIZE_MS);
    };
    const applySessionEntryBottom = () => {
      if (!pendingSessionEntryBottomRef.current) return;
      if (pendingSessionEntryUserInterruptedRef.current) {
        completeSessionEntryBottom();
        return;
      }

      cancelFrames();
      chatListRef.current?.scrollToIndex?.({
        index: Math.max(chatListItems.length - 1, 0),
        align: 'end',
        behavior: 'auto',
      });
      frame1 = requestAnimationFrame(() => {
        frame2 = requestAnimationFrame(() => {
          if (!pendingSessionEntryBottomRef.current) return;
          if (pendingSessionEntryUserInterruptedRef.current) {
            completeSessionEntryBottom();
            return;
          }
          positionScrollNearBottom(ACTIVE_TURN_BOTTOM_OFFSET_PX);
        });
      });
      scheduleCompletion();
    };

    applySessionEntryBottom();

    if (typeof ResizeObserver === 'function') {
      resizeObserver = new ResizeObserver(() => {
        applySessionEntryBottom();
      });
      const scrollElement = scrollContainerRef.current;
      if (scrollElement) {
        resizeObserver.observe(scrollElement);
        const contentColumn = scrollElement.querySelector<HTMLElement>('[data-testid="chat-content-column"]');
        if (contentColumn) {
          resizeObserver.observe(contentColumn);
        }
      }
    }

    return () => {
      cancelFrames();
      if (settleTimer != null) {
        clearTimeout(settleTimer);
      }
      resizeObserver?.disconnect();
    };
  }, [activeTurnScrollKey, chatListItems.length, loading, sending]);
  useLayoutEffect(() => {
    const scrollElement = scrollContainerNode;
    if (!scrollElement) {
      setContentColumnHorizontalOffsetPx(0);
      return;
    }

    const updateHorizontalOffset = () => {
      const contentColumn = scrollElement.querySelector<HTMLElement>('[data-testid="chat-content-column"]');
      if (!contentColumn) {
        setContentColumnHorizontalOffsetPx(0);
        return;
      }

      const scrollRect = scrollElement.getBoundingClientRect();
      const contentRect = contentColumn.getBoundingClientRect();
      const actualLeft = contentRect.left - scrollRect.left;
      const expectedLeft = (scrollRect.width - contentRect.width) / 2;
      const drift = expectedLeft - actualLeft;
      setContentColumnHorizontalOffsetPx((current) => (
        (() => {
          const nextOffset = Math.round(current + drift);
          return current === nextOffset ? current : nextOffset;
        })()
      ));
    };

    updateHorizontalOffset();

    if (typeof ResizeObserver !== 'function') {
      window.addEventListener('resize', updateHorizontalOffset);
      return () => {
        window.removeEventListener('resize', updateHorizontalOffset);
      };
    }

    const observer = new ResizeObserver(() => {
      updateHorizontalOffset();
    });
    observer.observe(scrollElement);
    const contentColumn = scrollElement.querySelector<HTMLElement>('[data-testid="chat-content-column"]');
    if (contentColumn) {
      observer.observe(contentColumn);
    }

    return () => {
      observer.disconnect();
    };
  }, [chatListItems.length, currentSessionKey, loading, scrollContainerNode, sending]);

  useLayoutEffect(() => {
    const scrollElement = scrollContainerNode;
    if (!scrollElement) {
      setComposerShellPadding({ left: 16, right: 16 });
      return;
    }

    const updatePadding = () => {
      const contentColumn = scrollElement.querySelector<HTMLElement>('[data-testid="chat-content-column"]');
      if (!contentColumn) {
        setComposerShellPadding({ left: 16, right: 16 });
        return;
      }

      const scrollRect = scrollElement.getBoundingClientRect();
      const contentRect = contentColumn.getBoundingClientRect();
      const nextLeft = Math.max(16, Math.round(contentRect.left - scrollRect.left));
      const nextRight = Math.max(16, Math.round(scrollRect.right - contentRect.right));
      setComposerShellPadding((current) => (
        current.left === nextLeft && current.right === nextRight
          ? current
          : { left: nextLeft, right: nextRight }
      ));
    };

    updatePadding();

    if (typeof ResizeObserver !== 'function') {
      window.addEventListener('resize', updatePadding);
      return () => {
        window.removeEventListener('resize', updatePadding);
      };
    }

    const observer = new ResizeObserver(() => {
      updatePadding();
    });
    observer.observe(scrollElement);
    const contentColumn = scrollElement.querySelector<HTMLElement>('[data-testid="chat-content-column"]');
    if (contentColumn) {
      observer.observe(contentColumn);
    }
    return () => {
      observer.disconnect();
    };
  }, [contentColumnHorizontalOffsetPx, currentSessionKey, chatListItems.length, loading, scrollContainerNode, sending]);
  const isScrollNearBottom = useCallback(() => {
    const scrollElement = scrollContainerRef.current;
    if (!scrollElement) return false;
    const distanceFromBottom = scrollElement.scrollHeight - scrollElement.clientHeight - scrollElement.scrollTop;
    return distanceFromBottom <= ACTIVE_TURN_NEAR_BOTTOM_THRESHOLD_PX;
  }, []);
  function positionScrollNearBottom(bottomOffsetPx: number) {
    const scrollElement = scrollContainerRef.current;
    if (!scrollElement) return;
    scrollElement.scrollTop = Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight - bottomOffsetPx);
  }
  const handleActiveTurnUserInterrupt = useCallback(() => {
    if (activeTurnScrollKey) {
      suppressedAutoFollowTurnKeyRef.current = activeTurnScrollKey;
    }
    activeTurnAutoScrollModeRef.current = 'idle';
    activeTurnAutoScrollTargetRef.current = 0;
    activeTurnAutoScrollAnimationRef.current = null;
    setActiveTurnUserInterruptVersion((value) => value + 1);
  }, [activeTurnScrollKey]);
  const chatListContext = useMemo<ChatVirtuosoContext>(() => ({
    disableOverflowAnchor: sending && !!activeTurnScrollKey,
    horizontalOffsetPx: contentColumnHorizontalOffsetPx,
    scrollbarGutter: 'stable both-edges',
    setScrollElement: setScrollContainerNode,
  }), [activeTurnScrollKey, contentColumnHorizontalOffsetPx, sending, setScrollContainerNode]);

  useEffect(() => {
    if (!hasMountedSessionRef.current) {
      hasMountedSessionRef.current = true;
      previousSessionKeyRef.current = currentSessionKey;
      pendingSessionEntryUserInterruptedRef.current = false;
      if (sending && activeTurnScrollKey) {
        pendingLocalSendFollowBottomRef.current = true;
      }
      return;
    }

    if (previousSessionKeyRef.current === currentSessionKey) {
      return;
    }

    previousSessionKeyRef.current = currentSessionKey;
    pendingSessionEntryUserInterruptedRef.current = false;
    if (sending && activeTurnScrollKey) {
      pendingSessionEntryBottomRef.current = false;
      pendingLocalSendFollowBottomRef.current = true;
    } else {
      pendingSessionEntryBottomRef.current = true;
    }
    activeTurnAutoScrollModeRef.current = 'idle';
    activeTurnTrackedTurnKeyRef.current = null;
    suppressedAutoFollowTurnKeyRef.current = null;
    setActiveTurnUserInterruptVersion((value) => value + 1);
  }, [activeTurnScrollKey, currentSessionKey, sending]);

  useEffect(() => {
    if (!sending || !activeTurnScrollKey) {
      if (!sending) {
        pendingLocalSendFollowBottomRef.current = false;
        suppressedAutoFollowTurnKeyRef.current = null;
        activeTurnAutoScrollModeRef.current = 'idle';
        activeTurnTrackedTurnKeyRef.current = activeTurnScrollKey;
      }
      return;
    }

    pendingSessionEntryBottomRef.current = false;
    pendingSessionEntryUserInterruptedRef.current = false;

    if (suppressedAutoFollowTurnKeyRef.current === activeTurnScrollKey) {
      pendingLocalSendFollowBottomRef.current = false;
      return;
    }

    const turnChanged = activeTurnTrackedTurnKeyRef.current !== activeTurnScrollKey;
    const shouldFollowBottom = pendingLocalSendFollowBottomRef.current || isScrollNearBottom();
    const nextMode: ActiveTurnAutoScrollMode = shouldFollowBottom ? 'follow-bottom' : 'idle';
    const modeChanged = activeTurnAutoScrollModeRef.current !== nextMode;
    if (!turnChanged && !modeChanged) {
      pendingLocalSendFollowBottomRef.current = false;
      return;
    }

    activeTurnTrackedTurnKeyRef.current = activeTurnScrollKey;
    activeTurnAutoScrollModeRef.current = nextMode;
    pendingLocalSendFollowBottomRef.current = false;
    if (nextMode === 'idle') {
      activeTurnAutoScrollTargetRef.current = 0;
      activeTurnAutoScrollAnimationRef.current = null;
    }
    setActiveTurnUserInterruptVersion((value) => value + 1);
  }, [activeTurnScrollKey, currentSessionKey, isScrollNearBottom, sending]);

  useEffect(() => {
    const autoScrollMode = activeTurnAutoScrollModeRef.current;
    if (!sending || !activeTurnScrollKey || autoScrollMode === 'idle') return;
    if (suppressedAutoFollowTurnKeyRef.current === activeTurnScrollKey) return;

    let readinessFrame = 0;
    let frame1 = 0;
    let resizeObserver: ResizeObserver | null = null;
    let releasedByUser = false;
    let ignoreScrollEventsUntil = 0;
    let pointerScrollIntentActive = false;

    const cancelAutoScrollFrame = () => {
      if (activeTurnAutoScrollFrameRef.current != null) {
        cancelAnimationFrame(activeTurnAutoScrollFrameRef.current);
        activeTurnAutoScrollFrameRef.current = null;
      }
    };
    const applyProgrammaticScroll = (nextScrollTop: number) => {
      ignoreScrollEventsUntil = performance.now() + ACTIVE_TURN_PROGRAMMATIC_SCROLL_GUARD_MS;
      const scrollElement = scrollContainerRef.current;
      if (!scrollElement) return;
      scrollElement.scrollTop = nextScrollTop;
    };
    const easeOutCubic = (progress: number) => (1 - ((1 - progress) ** 3));
    const stepAutoScroll = (timestamp: number) => {
      activeTurnAutoScrollFrameRef.current = null;
      if (releasedByUser) return;

      const animation = activeTurnAutoScrollAnimationRef.current;
      const scrollElement = scrollContainerRef.current;
      if (!scrollElement) return;
      if (!animation) return;

      const progress = Math.min(1, (timestamp - animation.startedAt) / ACTIVE_TURN_AUTO_SCROLL_DURATION_MS);
      const easedProgress = easeOutCubic(progress);
      const nextScrollTop = animation.startTop + ((animation.targetTop - animation.startTop) * easedProgress);

      applyProgrammaticScroll(nextScrollTop);

      if (progress >= 1 || Math.abs(animation.targetTop - nextScrollTop) < 1) {
        applyProgrammaticScroll(animation.targetTop);
        activeTurnAutoScrollAnimationRef.current = null;
        return;
      }
      activeTurnAutoScrollFrameRef.current = requestAnimationFrame(stepAutoScroll);
    };
    const startAutoScrollAnimation = (nextTargetScrollTop: number) => {
      const scrollElement = scrollContainerRef.current;
      if (!scrollElement) return;
      if (nextTargetScrollTop <= scrollElement.scrollTop + 0.5) return;

      activeTurnAutoScrollTargetRef.current = nextTargetScrollTop;
      activeTurnAutoScrollAnimationRef.current = {
        startTop: scrollElement.scrollTop,
        targetTop: nextTargetScrollTop,
        startedAt: performance.now(),
      };

      if (activeTurnAutoScrollFrameRef.current == null) {
        activeTurnAutoScrollFrameRef.current = requestAnimationFrame(stepAutoScroll);
      }
    };
    const updateAutoScrollTarget = (scrollElement: HTMLDivElement) => {
      cancelAnimationFrame(frame1);
      frame1 = requestAnimationFrame(() => {
        if (releasedByUser) return;

        const bottomVisibleScrollTop = Math.max(
          0,
          scrollElement.scrollHeight - scrollElement.clientHeight - ACTIVE_TURN_BOTTOM_OFFSET_PX,
        );
        if (bottomVisibleScrollTop > Math.max(activeTurnAutoScrollTargetRef.current, scrollElement.scrollTop) + 0.5) {
          startAutoScrollAnimation(bottomVisibleScrollTop);
        }
      });
    };
    const releaseTopLock = () => {
      if (releasedByUser) return;
      releasedByUser = true;
      activeTurnAutoScrollTargetRef.current = 0;
      activeTurnAutoScrollAnimationRef.current = null;
      resizeObserver?.disconnect();
      cancelAutoScrollFrame();
      cancelAnimationFrame(readinessFrame);
      cancelAnimationFrame(frame1);
      handleActiveTurnUserInterrupt();
    };
    const handleKeyboardInterrupt = (event: KeyboardEvent) => {
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'PageUp' || event.key === 'PageDown' || event.key === 'Home' || event.key === 'End' || event.key === ' ') {
        releaseTopLock();
      }
    };
    const handlePointerScrollIntentStart = (event: PointerEvent) => {
      pointerScrollIntentActive = true;
      if (event.pointerType === 'mouse' && event.button !== 0) return;

      const scrollElement = scrollContainerRef.current;
      const target = event.target;
      if (!scrollElement || !(target instanceof Node)) return;

      const contentColumn = scrollElement.querySelector<HTMLElement>('[data-testid="chat-content-column"]');
      if (contentColumn?.contains(target)) {
        releaseTopLock();
      }
    };
    const clearPointerScrollIntent = () => {
      pointerScrollIntentActive = false;
    };
    const handleManualScroll = () => {
      if (performance.now() <= ignoreScrollEventsUntil) return;
      if (!pointerScrollIntentActive) return;
      releaseTopLock();
    };
    const ensureScrollElementsReady = () => {
      const scrollElement = scrollContainerRef.current;
      if (!scrollElement) {
        readinessFrame = requestAnimationFrame(ensureScrollElementsReady);
        return;
      }

      resizeObserver = typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => {
            if (!releasedByUser) {
              updateAutoScrollTarget(scrollElement);
            }
          })
        : null;

      scrollElement.addEventListener('scroll', handleManualScroll, { passive: true });
      scrollElement.addEventListener('wheel', releaseTopLock, { passive: true });
      scrollElement.addEventListener('touchmove', releaseTopLock, { passive: true });
      scrollElement.addEventListener('pointerdown', handlePointerScrollIntentStart, { passive: true });
      scrollElement.addEventListener('pointerup', clearPointerScrollIntent, { passive: true });
      scrollElement.addEventListener('pointercancel', clearPointerScrollIntent, { passive: true });
      scrollElement.addEventListener('pointerleave', clearPointerScrollIntent, { passive: true });
      scrollElement.addEventListener('keydown', handleKeyboardInterrupt);
      resizeObserver?.observe(scrollElement);
      const contentColumn = scrollElement.querySelector<HTMLElement>('[data-testid="chat-content-column"]');
      if (contentColumn) {
        resizeObserver?.observe(contentColumn);
      }
      updateAutoScrollTarget(scrollElement);
    };

    readinessFrame = requestAnimationFrame(ensureScrollElementsReady);

    return () => {
      resizeObserver?.disconnect();
      scrollContainerRef.current?.removeEventListener('scroll', handleManualScroll);
      scrollContainerRef.current?.removeEventListener('wheel', releaseTopLock);
      scrollContainerRef.current?.removeEventListener('touchmove', releaseTopLock);
      scrollContainerRef.current?.removeEventListener('pointerdown', handlePointerScrollIntentStart);
      scrollContainerRef.current?.removeEventListener('pointerup', clearPointerScrollIntent);
      scrollContainerRef.current?.removeEventListener('pointercancel', clearPointerScrollIntent);
      scrollContainerRef.current?.removeEventListener('pointerleave', clearPointerScrollIntent);
      scrollContainerRef.current?.removeEventListener('keydown', handleKeyboardInterrupt);
      activeTurnAutoScrollAnimationRef.current = null;
      cancelAnimationFrame(readinessFrame);
      cancelAutoScrollFrame();
      cancelAnimationFrame(frame1);
    };
  }, [activeTurnScrollKey, activeTurnUserInterruptVersion, currentSessionKey, handleActiveTurnUserInterrupt, sending]);

  const handleEditQueuedDraft = (queuedId: string, text: string) => {
    setComposerPrefill({ text, nonce: Date.now() });
    clearQueuedMessage(currentSessionKey, queuedId);
  };
  const handleSendQueuedDraftNow = (queuedId: string) => {
    if (!isGatewayRunning) return;
    pendingSessionEntryBottomRef.current = false;
    pendingSessionEntryUserInterruptedRef.current = false;
    pendingLocalSendFollowBottomRef.current = true;
    void flushQueuedMessage(currentSessionKey, queuedId);
  };
  const handleSendMessage = useCallback((
    text: string,
    attachments?: Array<{ fileName: string; mimeType: string; fileSize: number; stagedPath: string; preview: string | null }>,
    targetAgentId?: string | null,
  ) => {
    pendingSessionEntryBottomRef.current = false;
    pendingSessionEntryUserInterruptedRef.current = false;
    pendingLocalSendFollowBottomRef.current = true;
    void sendMessage(text, attachments, targetAgentId);
  }, [sendMessage]);
  const handleOpenAttachmentPreview = useCallback((file: AttachedFileMeta) => {
    if (!previewPaneOpenRef.current) {
      previewAutoCollapsedSidebarRef.current = !sidebarCollapsedRef.current;
      if (!sidebarCollapsedRef.current) {
        setSidebarCollapsed(true);
      }
    }
    setSelectedPreviewFile(file);
  }, [setSidebarCollapsed]);
  const handleCloseAttachmentPreview = useCallback(() => {
    restoreAutoCollapsedSidebar();
    setSelectedPreviewFile(null);
  }, [restoreAutoCollapsedSidebar]);
  const handlePreviewResizeStart = useCallback((event: { clientX: number; preventDefault: () => void }) => {
    if (!selectedPreviewFile || window.innerWidth < 1024) return;
    event.preventDefault();
    previewResizeStartXRef.current = event.clientX;
    previewResizeStartWidthRef.current = previewPaneWidthPercent;

    const handlePointerMove = (moveEvent: MouseEvent) => {
      if (previewResizeStartXRef.current == null || !splitPaneRef.current) return;
      const containerWidth = splitPaneRef.current.getBoundingClientRect().width;
      if (!containerWidth) return;

      const deltaX = moveEvent.clientX - previewResizeStartXRef.current;
      const deltaPercent = (deltaX / containerWidth) * 100;
      setPreviewPaneWidthPercent(clampPreviewPaneWidth(previewResizeStartWidthRef.current - deltaPercent));
    };

    const stopResizing = () => {
      previewResizeStartXRef.current = null;
      window.removeEventListener('mousemove', handlePointerMove);
      window.removeEventListener('mouseup', stopResizing);
    };

    window.addEventListener('mousemove', handlePointerMove);
    window.addEventListener('mouseup', stopResizing, { once: true });
  }, [previewPaneWidthPercent, selectedPreviewFile]);
  const renderChatListItem = useCallback((_: number, item: ChatListItem) => {
    switch (item.type) {
      case 'history':
        if (item.item.type === 'turn') {
          return (
            <CollapsedProcessTurn
              userMessage={item.item.userMessage}
              intermediateMessages={item.item.intermediateMessages}
              finalMessage={item.item.finalMessage}
              showThinking={showThinking}
              chatProcessDisplayMode={chatProcessDisplayMode}
              assistantMessageStyle={assistantMessageStyle}
              hideInternalRoutineProcesses={hideInternalRoutineProcesses}
              onProcessSectionExpand={handleActiveTurnUserInterrupt}
              onOpenAttachmentPreview={handleOpenAttachmentPreview}
            />
          );
        }

        return (
          <ChatMessage
            message={item.item.message}
            showThinking={showThinking}
            onOpenAttachmentPreview={handleOpenAttachmentPreview}
          />
        );
      case 'active-turn':
        return !shouldHideActiveTurn && activeTurnUserMessage ? (
          <div ref={activeTurnViewportAnchorRef} data-testid="chat-active-turn-anchor" className="min-w-0">
            <ActiveTurn
              key={activeTurnUserMessage.id || `active-turn-${currentSessionKey}`}
              userMessage={activeTurnUserMessage}
              processMessages={effectiveActiveTurnProcessMessages}
              processStreamingMessage={activeTurnProcessStreamingMessage}
              finalMessage={resolvedPersistedFinalMessage}
              finalStreamingMessage={activeTurnFinalStreamingMessage}
              showThinking={showThinking}
              chatProcessDisplayMode={chatProcessDisplayMode}
              assistantMessageStyle={assistantMessageStyle}
              hideInternalRoutineProcesses={hideInternalRoutineProcesses}
              startedAtMs={activeTurnStartedAtMs}
              showActivity={showProcessActivity}
              showTyping={!shouldUseProcessLayout && !resolvedPersistedFinalMessage && !activeTurnFinalStreamingMessage && !pendingFinal && !hasAnyStreamContent}
              streamingTools={streamingTools}
              sending={sending}
              onProcessSectionExpand={handleActiveTurnUserInterrupt}
              onOpenAttachmentPreview={handleOpenAttachmentPreview}
            />
          </div>
        ) : null;
      case 'streaming-final':
        return (
          <ChatMessage
            message={item.message}
            showThinking={showThinking}
            isStreaming={sending}
            hideAvatar={shouldHideStandaloneStreamingAvatar}
            onOpenAttachmentPreview={handleOpenAttachmentPreview}
          />
        );
      case 'activity':
        return <ActivityIndicator phase="tool_processing" />;
      case 'typing':
        return <TypingIndicator />;
      default:
        return null;
    }
  }, [
    activeTurnFinalStreamingMessage,
    activeTurnProcessStreamingMessage,
    activeTurnStartedAtMs,
    activeTurnUserMessage,
    assistantMessageStyle,
    chatProcessDisplayMode,
    currentSessionKey,
    effectiveActiveTurnProcessMessages,
    handleActiveTurnUserInterrupt,
    handleOpenAttachmentPreview,
    hasAnyStreamContent,
    hideInternalRoutineProcesses,
    pendingFinal,
    resolvedPersistedFinalMessage,
    sending,
    shouldHideStandaloneStreamingAvatar,
    shouldHideActiveTurn,
    shouldUseProcessLayout,
    showProcessActivity,
    showThinking,
    streamingTools,
  ]);

  return (
    <div
      className={cn("relative -m-6 flex flex-col transition-colors duration-500 dark:bg-background")}
      style={{
        height: 'calc(100vh - 2.5rem)',
        backgroundImage:
          'radial-gradient(circle at top right, rgba(59,130,246,0.10), transparent 24%), radial-gradient(circle at 18% 12%, rgba(148,163,184,0.08), transparent 18%)',
      }}
    >
      <div ref={splitPaneRef} className="relative flex min-h-0 flex-1 overflow-hidden">
        <div
          data-testid="chat-main-pane"
          className={cn(
            'relative flex min-h-0 min-w-0 flex-1 flex-col',
            selectedPreviewFile && 'lg:flex-none max-lg:!w-full max-lg:!basis-full',
          )}
          style={selectedPreviewFile
            ? {
                width: `${100 - previewPaneWidthPercent}%`,
                flexBasis: `${100 - previewPaneWidthPercent}%`,
              }
            : undefined}
        >
          <div
            data-testid="chat-toolbar-header"
            className="flex h-14 shrink-0 items-center justify-end border-b border-black/5 bg-white/32 px-4 backdrop-blur-md dark:border-white/5 dark:bg-white/[0.02]"
          >
            <ChatToolbarV2 />
          </div>

      {/* Messages Area */}
      {showSessionLoadingState ? (
        <div
          ref={setScrollContainerNode}
          data-testid="chat-scroll-container"
          data-chat-scroll-container="true"
          className="flex-1 min-h-0 min-w-0 overflow-x-hidden overflow-y-auto px-4 pt-5 pb-8"
          style={{ scrollbarGutter: 'stable both-edges' }}
        >
          <div
            data-testid="chat-content-column"
            className={cn(CHAT_CONTENT_COLUMN_MAX_WIDTH_CLASS, 'mx-auto flex min-h-full min-w-0 items-center justify-center')}
            style={{ width: CHAT_CONTENT_COLUMN_WIDTH_CSS }}
          >
            <div className="bg-background shadow-lg rounded-full border border-border p-2.5">
              <LoadingSpinner size="md" />
            </div>
          </div>
        </div>
      ) : isEmpty ? (
        <div
          ref={setScrollContainerNode}
          data-testid="chat-scroll-container"
          data-chat-scroll-container="true"
          className="flex-1 min-h-0 min-w-0 overflow-x-hidden overflow-y-auto px-4 pt-5 pb-8"
          style={{ scrollbarGutter: 'stable both-edges' }}
        >
          <div
            data-testid="chat-content-column"
            className={cn(CHAT_CONTENT_COLUMN_MAX_WIDTH_CLASS, 'mx-auto min-w-0')}
            style={{ width: CHAT_CONTENT_COLUMN_WIDTH_CSS }}
          >
            <WelcomeScreenMinimal />
          </div>
        </div>
      ) : (
        <Virtuoso
          ref={chatListRef}
          key={currentSessionKey}
          className="flex-1 min-h-0 min-w-0 overflow-x-hidden"
          style={{ width: '100%' }}
          data={chatListItems}
          alignToBottom
          increaseViewportBy={{ top: 720, bottom: 360 }}
          context={chatListContext}
          computeItemKey={(_, item) => item.key}
          initialTopMostItemIndex={{ index: 'LAST', align: 'end' }}
          components={{
            Header: ChatVirtuosoHeader,
            Scroller: ChatVirtuosoScroller,
            List: ChatVirtuosoList,
            Item: ChatVirtuosoItem,
          }}
          itemContent={renderChatListItem}
        />
      )}

      {/* Session notice bar */}
      {error && (
        <div
          className="border-t border-amber-500/20 bg-amber-500/10 px-4 py-2"
          data-testid="chat-session-notice"
        >
          <div className={cn(CHAT_SURFACE_MAX_WIDTH_CLASS, 'mx-auto flex items-center justify-between')}>
            <p className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300">
              <AlertCircle className="h-4 w-4" />
              {error}
            </p>
            <button
              onClick={clearError}
              className="text-xs text-amber-700/70 underline hover:text-amber-700 dark:text-amber-300/70 dark:hover:text-amber-300"
            >
              {t('common:actions.dismiss')}
            </button>
          </div>
        </div>
      )}

      {showQueuedMessageNotice && (
          <div
            className="border-t border-sky-500/20 bg-sky-500/10 px-4 py-2"
            data-testid="chat-queued-message-notice"
          >
            <div className={cn(CHAT_SURFACE_MAX_WIDTH_CLASS, 'mx-auto flex items-center justify-between gap-3')}>
              <p className="flex items-center gap-2 text-sm text-sky-700 dark:text-sky-300">
                <Loader2 className="h-4 w-4 animate-spin" />
                {isZh ? '工作引擎已恢复，正在发送你刚才排队的草稿…' : 'Workspace engine is back. Sending your queued draft now...'}
              </p>
              <button
                onClick={() => clearQueuedMessage(currentSessionKey)}
                className="text-xs text-sky-700/70 underline hover:text-sky-700 dark:text-sky-300/70 dark:hover:text-sky-300"
              >
                {t('common:actions.dismiss')}
              </button>
            </div>
          </div>
      )}

      {showQueuedMessageCard && (
          <div className="border-t border-sky-500/20 bg-sky-500/10 px-4 py-3" data-testid="chat-queued-message-card">
            <div className={cn(CHAT_SURFACE_MAX_WIDTH_CLASS, 'mx-auto flex flex-wrap items-start justify-between gap-4')}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-medium text-sky-700 dark:text-sky-300">
                  <span className="inline-flex h-2 w-2 rounded-full bg-sky-500/80" />
                  <span>{isZh ? '草稿已加入待发送队列' : 'Draft queued to send'}</span>
                </div>
                <p className="mt-1 text-sm text-sky-700/84 dark:text-sky-200/86">
                  {sending
                    ? (isZh
                        ? '当前会话结束后会自动发送。你也可以先继续编辑，或者暂时移除这条草稿。'
                        : 'It will send automatically after the current turn finishes. You can also keep editing it or remove it for now.')
                    : (isZh
                        ? '工作引擎恢复后会自动发送。你也可以先继续编辑，或者暂时移除这条草稿。'
                        : 'It will send automatically when the workspace engine reconnects. You can also keep editing it or remove it for now.')}
                </p>
                {queuedMessageCount > 1 ? (
                  <p className="mt-1 text-xs leading-5 text-sky-700/72 dark:text-sky-200/72">
                    {isZh
                      ? `当前队列中还有 ${queuedMessageCount - 1} 条草稿在这条之后等待发送`
                      : `${queuedMessageCount - 1} more queued draft(s) will send after this one`}
                  </p>
                ) : null}
                <div className="mt-3 rounded-2xl border border-sky-500/18 bg-white/60 px-4 py-3 text-sm text-foreground shadow-sm dark:border-sky-400/16 dark:bg-white/[0.03]">
                  <div className="line-clamp-3 whitespace-pre-wrap break-words" data-testid="chat-queued-message-preview">
                    {queuedMessage.text || (isZh ? '这条草稿只包含附件。' : 'This queued draft only contains attachments.')}
                  </div>
                  {queuedMessage.attachments?.length ? (
                    <div className="mt-2 text-xs text-foreground/58">
                      {isZh
                        ? `包含 ${queuedMessage.attachments.length} 个附件`
                        : `${queuedMessage.attachments.length} attachment(s) included`}
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => queuedMessage && handleEditQueuedDraft(queuedMessage.id, queuedMessage.text)}
                  data-testid="chat-queued-message-edit"
                  className="rounded-full bg-white px-3 py-1.5 text-sm font-medium text-sky-700 shadow-sm transition hover:bg-sky-50 dark:bg-white/10 dark:text-sky-200 dark:hover:bg-white/14"
                >
                  {isZh ? '继续编辑' : 'Edit draft'}
                </button>
                <button
                  type="button"
                  onClick={() => queuedMessage && clearQueuedMessage(currentSessionKey, queuedMessage.id)}
                  data-testid="chat-queued-message-remove"
                  className="rounded-full border border-sky-500/18 px-3 py-1.5 text-sm font-medium text-sky-700 transition hover:bg-sky-500/8 dark:border-sky-400/18 dark:text-sky-200 dark:hover:bg-sky-400/10"
                >
                  {isZh ? '移除草稿' : 'Remove draft'}
                </button>
                <button
                  type="button"
                  onClick={() => queuedMessage && handleSendQueuedDraftNow(queuedMessage.id)}
                  data-testid="chat-queued-message-send-now"
                  disabled={!canSendQueuedDraftNow}
                  className="rounded-full bg-sky-600 px-3 py-1.5 text-sm font-medium text-white transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isZh ? '立即发送' : 'Send now'}
                </button>
              </div>
            </div>
          </div>
      )}

      {/* Input Area */}
      <ChatInput
        onSend={handleSendMessage}
        onQueueOfflineMessage={queueOfflineMessage}
        onStop={abortRun}
        disabled={!isGatewayRunning}
        sending={sending}
        isEmpty={isEmpty}
        prefillText={composerPrefill.text}
        prefillNonce={composerPrefill.nonce}
        shellPaddingLeftPx={composerShellPadding.left}
        shellPaddingRightPx={composerShellPadding.right}
      />

      {/* Transparent loading overlay */}
      {minLoading && !sending && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/20 backdrop-blur-[1px] rounded-xl pointer-events-auto">
          <div className="bg-background shadow-lg rounded-full p-2.5 border border-border">
            <LoadingSpinner size="md" />
          </div>
        </div>
      )}

        </div>

        {selectedPreviewFile ? (
          <>
            <div
              data-testid="chat-preview-resize-handle"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize chat preview"
              onMouseDown={handlePreviewResizeStart}
              className="absolute inset-y-0 z-20 hidden w-3 -translate-x-1/2 cursor-col-resize lg:block"
              style={{ left: `${100 - previewPaneWidthPercent}%` }}
            >
              <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-black/8 transition-colors hover:bg-primary/45 dark:bg-white/10 dark:hover:bg-primary/55" />
            </div>
            <ChatFilePreviewPanel
              key={selectedPreviewFile.filePath ?? `${selectedPreviewFile.fileName}:${selectedPreviewFile.mimeType}:${selectedPreviewFile.fileSize}`}
              file={selectedPreviewFile}
              desktopWidthPercent={previewPaneWidthPercent}
              onClose={handleCloseAttachmentPreview}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}

type ProcessPhase = 'working' | 'processed';

function toTimestampMs(timestamp: number | undefined): number | null {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return null;
  return timestamp < 1e12 ? timestamp * 1000 : timestamp;
}

function resolveMessageTimestampMs(message: RawMessage | null | undefined, fallbackMs = 0): number {
  return toTimestampMs(message?.timestamp) ?? fallbackMs;
}

function findLastUserMessageIndex(messages: RawMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      return index;
    }
  }
  return -1;
}

function buildMessageDisplayKey(message: RawMessage): string {
  return `${message.id ?? ''}|${message.role}|${message.timestamp ?? ''}|${extractText(message).trim()}`;
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
  streamMsg: { role?: string; content?: unknown; timestamp?: number } | null,
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

function normalizeProcessLocale(language: string | undefined): 'en' | 'zh' {
  if (language?.startsWith('zh')) return 'zh';
  return 'en';
}

function formatProcessDuration(
  durationMs: number,
  language: string | undefined,
): string {
  const locale = normalizeProcessLocale(language);
  const safeMs = Math.max(0, Math.floor(durationMs));
  const totalSeconds = Math.floor(safeMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const safeSeconds = Math.max(1, seconds);

  if (locale === 'zh') {
    if (hours > 0) {
      return `${hours}\u5c0f\u65f6${minutes}\u5206`;
    }
    if (minutes > 0) {
      return `${minutes}\u5206${safeSeconds}\u79d2`;
    }
    return `${safeSeconds}\u79d2`;
  }

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${safeSeconds}s`;
  }
  return `${safeSeconds}s`;
}

function formatProcessStatus(
  phase: ProcessPhase,
  durationLabel: string,
  language: string | undefined,
): string {
  switch (normalizeProcessLocale(language)) {
    case 'zh':
      return phase === 'processed'
        ? `\u5df2\u5904\u7406 ${durationLabel}`
        : `\u6b63\u5728\u5904\u7406 ${durationLabel}`;
    default:
      return phase === 'processed' ? `Processed ${durationLabel}` : `Working for ${durationLabel}`;
  }
}

function hasVisibleProcessContent(
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

function hasVisibleFinalContent(message: RawMessage | null | undefined): boolean {
  if (!message || message.role !== 'assistant') return false;
  return extractText(message).trim().length > 0
    || extractImages(message).length > 0
    || (message._attachedFiles || []).length > 0;
}

function ProcessSection({
  processMessages,
  processStreamingMessage,
  phase,
  showThinking,
  chatProcessDisplayMode,
  assistantMessageStyle,
  hideInternalRoutineProcesses,
  startedAtMs,
  completedAtMs,
  collapsible,
  showActivity,
  showStatusOnly,
  showFinalDivider,
  streamingTools,
  onExpandStart,
  onOpenAttachmentPreview,
}: {
  processMessages: RawMessage[];
  processStreamingMessage?: RawMessage | null;
  phase: ProcessPhase;
  showThinking: boolean;
  chatProcessDisplayMode: ChatProcessDisplayMode;
  assistantMessageStyle: AssistantMessageStyle;
  hideInternalRoutineProcesses: boolean;
  startedAtMs: number;
  completedAtMs?: number;
  collapsible?: boolean;
  showActivity?: boolean;
  showStatusOnly?: boolean;
  showFinalDivider?: boolean;
  streamingTools?: ToolStatus[];
  onExpandStart?: () => void;
  onOpenAttachmentPreview?: (file: AttachedFileMeta) => void;
}) {
  const { i18n } = useTranslation('chat');
  const language = i18n?.resolvedLanguage || i18n?.language;
  const visibleMessages = processMessages.filter((message) => (
    hasVisibleProcessContent(message, showThinking, chatProcessDisplayMode, assistantMessageStyle, hideInternalRoutineProcesses)
  ));
  const effectiveProcessStreamingMessage = processStreamingMessage ?? (
    chatProcessDisplayMode === 'all' && (streamingTools?.length ?? 0) > 0
      ? {
          role: 'assistant' as const,
          content: [],
          timestamp: (completedAtMs ?? startedAtMs) / 1000,
        }
      : null
  );
  const hasStreamingProcessContent = !!effectiveProcessStreamingMessage
    && (
      hasVisibleProcessContent(effectiveProcessStreamingMessage, showThinking, chatProcessDisplayMode, assistantMessageStyle, hideInternalRoutineProcesses)
      || (chatProcessDisplayMode === 'all' && (streamingTools?.length ?? 0) > 0)
    );
  const hasSection = visibleMessages.length > 0 || hasStreamingProcessContent || !!showActivity || !!showStatusOnly;
  // Only collapse completed process sections by default; live sections stay expanded.
  const isCollapsible = collapsible ?? phase === 'processed';
  const [collapsed, setCollapsed] = useState(() => isCollapsible && phase === 'processed' && !!showFinalDivider);
  const [nowMs, setNowMs] = useState(() => completedAtMs ?? startedAtMs);
  useEffect(() => {
    if (phase !== 'working') return undefined;
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, [phase]);

  if (!hasSection) return null;

  const effectiveEndMs = phase === 'processed'
    ? (completedAtMs ?? nowMs)
    : nowMs;
  const elapsedLabel = formatProcessDuration(
    Math.max(0, effectiveEndMs - startedAtMs),
    i18n?.resolvedLanguage || i18n?.language,
  );
  const statusLabel = formatProcessStatus(
    phase,
    elapsedLabel,
    i18n?.resolvedLanguage || i18n?.language,
  );
  const usesStreamProcessStyle = assistantMessageStyle === 'stream';
  const showsHeaderBrand = true;
  const expandAllEvents = phase === 'working';
  const effectiveCollapsed = isCollapsible ? collapsed : false;
  const activitySourceMessage = effectiveProcessStreamingMessage ?? visibleMessages[visibleMessages.length - 1] ?? null;
  const activityLabel = getProcessActivityLabel(
    activitySourceMessage,
    showThinking,
    chatProcessDisplayMode,
    streamingTools,
    language,
    hideInternalRoutineProcesses,
  );
  const retryingTool = [...(streamingTools ?? [])].reverse().find((tool) => tool.status === 'retrying');
  const lastChatEventAt = getLastChatEventAt();
  const lastChatEventAgeMs = phase === 'working' && lastChatEventAt > 0
    ? Math.max(0, nowMs - lastChatEventAt)
    : 0;
  const activityDetail = phase !== 'working'
    ? null
    : (() => {
        const isZh = language?.startsWith('zh');
        if (retryingTool) {
          const retries = retryingTool.retries ?? 0;
          if (isZh) {
            return retries > 0
              ? `当前步骤已自动重试 ${retries} 次，正在等待新的结果`
              : '当前步骤正在自动重试，正在等待新的结果';
          }
          return retries > 0
            ? `This step has retried ${retries} time${retries === 1 ? '' : 's'} and is waiting for the next result`
            : 'This step is retrying and waiting for the next result';
        }
        if (lastChatEventAgeMs >= PROCESS_ACTIVITY_LONG_STALL_MS) {
          return isZh
            ? '处理时间较长，仍在等待工具或模型返回结果'
            : 'This is taking longer than usual and is still waiting for a tool or model result';
        }
        if (lastChatEventAgeMs >= PROCESS_ACTIVITY_SOFT_STALL_MS) {
          return isZh
            ? '暂时没有新的输出，仍在继续处理'
            : 'No new output yet, but the current step is still running';
        }
        return null;
      })();

  const handleToggle = () => {
    if (!isCollapsible) return;
    if (effectiveCollapsed) {
      onExpandStart?.();
    }
    setCollapsed((current) => !current);
  };
  const headerStatusControl = isCollapsible ? (
    <button
      type="button"
      onClick={handleToggle}
      className="group inline-flex items-center gap-1.5 rounded-full px-1 py-0.5 text-left text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
      data-testid="chat-process-toggle"
    >
      <span data-testid="chat-process-status">{statusLabel}</span>
      {effectiveCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
    </button>
  ) : (
    <div
      className="inline-flex items-center rounded-full px-1 py-0.5 text-left text-[13px] font-medium text-muted-foreground"
      data-testid="chat-process-header"
    >
      <span data-testid="chat-process-status">{statusLabel}</span>
    </div>
  );

  return (
    <div className="w-full space-y-2.5">
      <div className="flex items-center gap-3" data-testid="chat-process-header-row">
        <div
          data-testid="chat-process-avatar"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black/5 dark:bg-white/5 text-foreground"
        >
          <Sparkles className="h-4 w-4" />
        </div>
        {showsHeaderBrand ? (
          <div className="min-w-0 flex-1">
            <ProductNameIndicator
              testIdPrefix="chat-process-header-brand"
              className="max-w-full"
            />
          </div>
        ) : (
          <div className={cn('min-w-0', usesStreamProcessStyle ? 'max-w-none' : 'max-w-[80%]')}>
            {headerStatusControl}
          </div>
        )}
      </div>
      <div
        className="min-w-0"
        data-testid="chat-process-header-meta"
      >
        {headerStatusControl}
      </div>

      {!effectiveCollapsed && (
        <div
          className={cn(
            'min-w-0',
            usesStreamProcessStyle ? 'space-y-1.5' : 'space-y-3',
          )}
          data-testid="chat-process-content"
        >
          {usesStreamProcessStyle ? (
            <>
              {visibleMessages.map((message, index) => (
                <ProcessEventMessage
                  key={message.id || `process-${index}`}
                  message={message}
                  showThinking={showThinking}
                  chatProcessDisplayMode={chatProcessDisplayMode}
                  hideInternalRoutineProcesses={hideInternalRoutineProcesses}
                  expandAll={expandAllEvents}
                  onInteractionStart={onExpandStart}
                />
              ))}
              {hasStreamingProcessContent && effectiveProcessStreamingMessage && (
                <ProcessEventMessage
                  key={effectiveProcessStreamingMessage.id || 'process-streaming'}
                  message={effectiveProcessStreamingMessage}
                  showThinking={showThinking}
                  chatProcessDisplayMode={chatProcessDisplayMode}
                  hideInternalRoutineProcesses={hideInternalRoutineProcesses}
                  streamingTools={streamingTools}
                  expandAll={expandAllEvents}
                  onInteractionStart={onExpandStart}
                  preferPlainDirectContent={phase === 'working'}
                />
              )}
            </>
          ) : (
            <>
              {visibleMessages.map((message, index) => (
                <ChatMessage
                  key={message.id || `process-${index}`}
                  message={message}
                  showThinking={showThinking}
                  hideAvatar
                  constrainWidth={false}
                  onOpenAttachmentPreview={onOpenAttachmentPreview}
                />
              ))}
              {hasStreamingProcessContent && effectiveProcessStreamingMessage && (
                <ProcessEventMessage
                  key={effectiveProcessStreamingMessage.id || 'process-streaming'}
                  message={effectiveProcessStreamingMessage}
                  showThinking={showThinking}
                  chatProcessDisplayMode={chatProcessDisplayMode}
                  hideInternalRoutineProcesses={hideInternalRoutineProcesses}
                  streamingTools={streamingTools}
                  expandAll={expandAllEvents}
                  onInteractionStart={onExpandStart}
                  preferPlainDirectContent={phase === 'working'}
                />
              )}
            </>
          )}
          {showActivity && (
            <ProcessActivityIndicator
              streamStyle={usesStreamProcessStyle}
              label={activityLabel}
              detail={activityDetail}
            />
          )}
        </div>
      )}
      {!collapsed && showFinalDivider && (
        <div className="mt-3">
          <ProcessFinalDivider />
        </div>
      )}
    </div>
  );
}

function CollapsedProcessTurn({
  userMessage,
  intermediateMessages,
  finalMessage,
  showThinking,
  chatProcessDisplayMode,
  assistantMessageStyle,
  hideInternalRoutineProcesses,
  onProcessSectionExpand,
  onOpenAttachmentPreview,
}: {
  userMessage: RawMessage;
  intermediateMessages: RawMessage[];
  finalMessage: RawMessage;
  showThinking: boolean;
  chatProcessDisplayMode: ChatProcessDisplayMode;
  assistantMessageStyle: AssistantMessageStyle;
  hideInternalRoutineProcesses: boolean;
  onProcessSectionExpand?: () => void;
  onOpenAttachmentPreview?: (file: AttachedFileMeta) => void;
}) {
  const { t } = useTranslation('chat');
  const { collapsedProcessMessage, finalDisplayMessage } = splitFinalMessageForTurnDisplay(finalMessage);
  const processMessages = collapsedProcessMessage
    ? [...intermediateMessages, collapsedProcessMessage]
    : intermediateMessages;
  const hasProcessSection = processMessages.some((message) => (
    hasVisibleProcessContent(message, showThinking, chatProcessDisplayMode, assistantMessageStyle, hideInternalRoutineProcesses)
  ));
  const finalHasVisibleContent = hasVisibleFinalContent(finalDisplayMessage);
  const showTools = chatProcessDisplayMode === 'all';
  const pipelineMissesAssistantBody = !finalHasVisibleContent && !hasProcessSection
    && !assistantMessageShowsInChat(finalMessage, { showThinking, showTools });

  return (
    <div className={cn('space-y-3', hasProcessSection && finalHasVisibleContent && 'space-y-2')}>
      <ChatMessage
        message={userMessage}
        showThinking={showThinking}
        onOpenAttachmentPreview={onOpenAttachmentPreview}
      />

      {hasProcessSection && (
        <ProcessSection
          key={`collapsed:${userMessage.id ?? userMessage.timestamp ?? 'unknown'}:${finalMessage.id ?? finalMessage.timestamp ?? 'unknown'}`}
          processMessages={processMessages}
          phase="processed"
          showThinking={showThinking}
          chatProcessDisplayMode={chatProcessDisplayMode}
          assistantMessageStyle={assistantMessageStyle}
          hideInternalRoutineProcesses={hideInternalRoutineProcesses}
          startedAtMs={resolveMessageTimestampMs(userMessage)}
          completedAtMs={resolveMessageTimestampMs(finalMessage, resolveMessageTimestampMs(userMessage))}
          showFinalDivider={finalHasVisibleContent}
          onExpandStart={onProcessSectionExpand}
          onOpenAttachmentPreview={onOpenAttachmentPreview}
        />
      )}

      {finalHasVisibleContent && (
        <ChatMessage
          message={finalDisplayMessage}
          showThinking={false}
          hideAvatar={hasProcessSection}
          onOpenAttachmentPreview={onOpenAttachmentPreview}
        />
      )}

      {/* 闁告帒妫涚划宥囨喆閸℃绂堥柡鍫海閻︽垿宕氶銏犳瘔閺夆晛娲ㄩ埢濂稿礌?缂備礁鐗忛…鍫ュ籍閺堢數鐭濋悘蹇旂箚閻︻垶寮€涙啸闁诡収鍨辩憰鍡涘蓟閹垮嫮骞㈤柛鎰С缁楀鎮扮仦钘夌仧闁圭粯鍔楅妵姘舵偨閵婏箑鐓曢柛鎺楁敱閺屽﹪骞嬮弽顒傛闁轰礁鐡ㄥΟ澶岀矆濞差亖鍋撴径鎰┾偓?*/}
      {!finalHasVisibleContent && !hasProcessSection && (
        <>
          <ChatMessage
            message={finalMessage}
            showThinking={showThinking}
            onOpenAttachmentPreview={onOpenAttachmentPreview}
          />
          {pipelineMissesAssistantBody && (
            <div
              className="rounded-xl border border-border/60 bg-muted/20 px-4 py-3 text-sm text-muted-foreground"
              data-testid="chat-assistant-pipeline-fallback"
            >
              {t('sessionWarnings.assistantMissingInUI')}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ActiveTurn({
  userMessage,
  processMessages,
  processStreamingMessage,
  finalMessage,
  finalStreamingMessage,
  showThinking,
  chatProcessDisplayMode,
  assistantMessageStyle,
  hideInternalRoutineProcesses,
  startedAtMs,
  showActivity,
  showTyping,
  streamingTools,
  sending,
  onProcessSectionExpand,
  onOpenAttachmentPreview,
}: {
  userMessage: RawMessage;
  processMessages: RawMessage[];
  processStreamingMessage?: RawMessage | null;
  finalMessage?: RawMessage | null;
  finalStreamingMessage?: RawMessage | null;
  showThinking: boolean;
  chatProcessDisplayMode: ChatProcessDisplayMode;
  assistantMessageStyle: AssistantMessageStyle;
  hideInternalRoutineProcesses: boolean;
  startedAtMs: number;
  showActivity: boolean;
  showTyping: boolean;
  streamingTools: ToolStatus[];
  sending: boolean;
  onProcessSectionExpand?: () => void;
  onOpenAttachmentPreview?: (file: AttachedFileMeta) => void;
}) {
  const liveProcessMessages = sending
    ? [
        ...processMessages,
        ...(finalMessage ? [finalMessage] : []),
      ]
    : processMessages;
  const finalHasVisibleContent = !sending && hasVisibleFinalContent(finalMessage);
  // Keep the final reply separate from the process list so it can align consistently below the process header.
  const finalStreamingHasVisibleContent = hasVisibleFinalContent(finalStreamingMessage);
  const showFinalStreamingBubble = finalStreamingHasVisibleContent && !!finalStreamingMessage;
  const processPhase: ProcessPhase = sending ? 'working' : 'processed';
  const completedAtMs = sending
    ? undefined
    : resolveMessageTimestampMs(
        finalMessage
        ?? finalStreamingMessage
        ?? liveProcessMessages[liveProcessMessages.length - 1]
        ?? userMessage,
        startedAtMs,
      );

  // Process content can come from persisted messages or the current streaming process update.
  const showStatusOnly = !sending
    && !showActivity
    && (finalHasVisibleContent || finalStreamingHasVisibleContent);
  const hasProcessSection = liveProcessMessages.some((message) => (
    hasVisibleProcessContent(message, showThinking, chatProcessDisplayMode, assistantMessageStyle, hideInternalRoutineProcesses)
  ))
    || (
      !!processStreamingMessage
      && (
        hasVisibleProcessContent(processStreamingMessage, showThinking, chatProcessDisplayMode, assistantMessageStyle, hideInternalRoutineProcesses)
        || (chatProcessDisplayMode === 'all' && streamingTools.length > 0)
      )
    )
    || showActivity
    || showStatusOnly;

  return (
    <div className={cn('space-y-3', hasProcessSection && (finalHasVisibleContent || finalStreamingHasVisibleContent) && 'space-y-2')}>
      <div className="min-w-0">
        <ChatMessage
          message={userMessage}
          showThinking={showThinking}
          onOpenAttachmentPreview={onOpenAttachmentPreview}
        />
      </div>

      {hasProcessSection && (
        <ProcessSection
          key={`active:${userMessage.id ?? userMessage.timestamp ?? 'unknown'}:${sending ? 'working' : 'processed'}:${finalMessage?.id ?? finalMessage?.timestamp ?? 'none'}`}
          processMessages={liveProcessMessages}
          processStreamingMessage={processStreamingMessage}
          phase={processPhase}
          showThinking={showThinking}
          chatProcessDisplayMode={chatProcessDisplayMode}
          assistantMessageStyle={assistantMessageStyle}
          hideInternalRoutineProcesses={hideInternalRoutineProcesses}
          startedAtMs={startedAtMs}
          completedAtMs={completedAtMs}
          collapsible={false}
          showActivity={showActivity}
          showStatusOnly={showStatusOnly}
          showFinalDivider={!sending && (finalHasVisibleContent || finalStreamingHasVisibleContent)}
          streamingTools={streamingTools}
          onExpandStart={onProcessSectionExpand}
          onOpenAttachmentPreview={onOpenAttachmentPreview}
        />
      )}

      {finalHasVisibleContent && finalMessage && (
        <ChatMessage
          message={finalMessage}
          showThinking={false}
          hideAvatar={hasProcessSection}
          onOpenAttachmentPreview={onOpenAttachmentPreview}
        />
      )}

      {showFinalStreamingBubble && (
        <ChatMessage
          message={finalStreamingMessage!}
          showThinking={false}
          hideAvatar={hasProcessSection}
          isStreaming={sending}
          onOpenAttachmentPreview={onOpenAttachmentPreview}
        />
      )}

      {!hasProcessSection && !finalHasVisibleContent && !showFinalStreamingBubble && showTyping && (
        <TypingIndicator />
      )}
    </div>
  );
}

// 闁冲厜鍋撻柍鍏夊亾 Welcome Screen 闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾

function WelcomeScreenMinimal() {
  const { t } = useTranslation('chat');

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="w-full px-2">
        <div className="mx-auto max-w-4xl text-center">
          <AppLogo
            testId="chat-welcome-logo"
            className="mx-auto mb-8 h-10 md:mb-10 md:h-12"
          />
          <h1
            data-testid="chat-welcome-title"
            className="text-[34px] font-semibold tracking-[-0.05em] text-foreground md:text-[50px]"
          >
            {t('welcome.subtitle', '把工作交给我，我来持续推进')}
          </h1>
        </div>
      </div>
    </div>
  );
}

// 闁冲厜鍋撻柍鍏夊亾 Typing Indicator 闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾

function AssistantAvatar({ testId }: { testId?: string }) {
  return (
    <div
      data-testid={testId}
      className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black/5 text-foreground dark:bg-white/5"
    >
      <Sparkles className="h-4 w-4" />
    </div>
  );
}

function ProductNameIndicator({
  scanning = false,
  testIdPrefix,
  className,
}: {
  scanning?: boolean;
  testIdPrefix: string;
  className?: string;
}) {
  const branding = useBranding();

  return (
    <div
      data-testid={`${testIdPrefix}-shell`}
      className={cn(
        'relative inline-flex min-w-0 max-w-full overflow-hidden py-0.5 text-foreground',
        className,
      )}
    >
      {scanning && (
        <style>{'@keyframes chat-product-scan { 0% { background-position: -52% 50%; opacity: 0.24; } 24% { opacity: 0.46; } 50% { opacity: 1; } 76% { opacity: 0.46; } 100% { background-position: 152% 50%; opacity: 0.24; } }'}</style>
      )}
      <span
        data-testid={`${testIdPrefix}-name`}
        className={cn(
          'relative z-10 truncate text-[16px] font-semibold tracking-[0.12em]',
          scanning
            ? 'text-foreground/62 dark:text-foreground/58'
            : 'text-foreground/90 dark:text-foreground/92',
        )}
      >
        {branding.productName}
      </span>
      {scanning && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-20 overflow-hidden"
        >
          <span
            data-testid={`${testIdPrefix}-scan`}
            className="block truncate text-[16px] font-semibold tracking-[0.12em] text-transparent [background-clip:text] [-webkit-background-clip:text]"
            style={{
              backgroundImage: [
                'radial-gradient(circle at 28% 50%, rgba(255,255,255,1) 0%, rgba(255,255,255,0.98) 18%, rgba(255,255,255,0.84) 34%, rgba(255,255,255,0.46) 52%, rgba(255,255,255,0.16) 68%, rgba(255,255,255,0) 84%)',
                'radial-gradient(circle at 56% 38%, rgba(255,255,255,0.92) 0%, rgba(255,255,255,0.56) 34%, rgba(255,255,255,0.16) 56%, rgba(255,255,255,0) 76%)',
                'radial-gradient(circle at 78% 62%, rgba(255,255,255,0.8) 0%, rgba(255,255,255,0.38) 38%, rgba(255,255,255,0.1) 58%, rgba(255,255,255,0) 74%)',
              ].join(', '),
              backgroundSize: '54% 188%',
              backgroundRepeat: 'no-repeat',
              animation: 'chat-product-scan 3.2s cubic-bezier(0.4, 0, 0.2, 1) infinite',
              filter: 'blur(0.38px) drop-shadow(0 0 14px rgba(255,255,255,0.26))',
              WebkitTextFillColor: 'transparent',
            }}
          >
            {branding.productName}
          </span>
        </span>
      )}
    </div>
  );
}

function useRotatingProcessActivityCopy() {
  const { t, i18n } = useTranslation('chat');
  const language = i18n?.resolvedLanguage || i18n?.language;
  const activityPhrases = useMemo(() => ([
    t('process.preOutputUnderstanding', 'Understanding the request'),
    t('process.preOutputRetrieving', 'Retrieving context'),
    t('process.preOutputComposing', 'Composing the reply'),
  ]), [language, t]);
  const [phraseIndex, setPhraseIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setPhraseIndex((current) => (current + 1) % activityPhrases.length);
    }, 1800);
    return () => clearInterval(timer);
  }, [activityPhrases.length]);

  return {
    activePhrase: activityPhrases[phraseIndex] ?? activityPhrases[0] ?? t('process.preOutputUnderstanding', 'Understanding the request'),
    detailLabel: t('process.preOutputReasoning', 'Reasoning pipeline active'),
    statusLabel: t('process.preOutputStatus', 'Processing'),
  };
}

function PreOutputStatusPanel({ testIdPrefix }: { testIdPrefix: string }) {
  const { activePhrase, detailLabel, statusLabel } = useRotatingProcessActivityCopy();

  return (
    <div
      className="w-full max-w-[236px] space-y-1.5"
      data-testid={`${testIdPrefix}-pre-output-panel`}
    >
      <style>{'@keyframes chat-pre-output-pulse { 0% { transform: scale(0.9); opacity: 0.12; } 55% { opacity: 0.28; } 100% { transform: scale(1.16); opacity: 0; } } @keyframes chat-pre-output-dot { 0%, 100% { transform: translateY(0); opacity: 0.52; } 50% { transform: translateY(-2px); opacity: 1; } } @keyframes chat-pre-output-rail { 0% { transform: translateX(-130%); opacity: 0.4; } 45% { opacity: 1; } 100% { transform: translateX(260%); opacity: 0.46; } }'}</style>
      <div
        className="rounded-[18px] border border-black/[0.06] bg-[linear-gradient(180deg,rgba(255,255,255,0.82),rgba(255,255,255,0.64))] px-3 py-2 shadow-[0_12px_24px_rgba(15,23,42,0.05)] backdrop-blur-md dark:border-white/[0.08] dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.04))]"
        data-testid={`${testIdPrefix}-pre-output-card`}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#d9e6ff]/85 text-[#4f8df7] dark:bg-[#2e4d82]/45 dark:text-[#82adff]"
            data-testid={`${testIdPrefix}-pre-output-icon`}
          >
            <span
              aria-hidden="true"
              className="absolute inset-1 rounded-full border border-[#4f8df7]/18 dark:border-[#82adff]/22"
              style={{ animation: 'chat-pre-output-pulse 2.6s ease-out infinite' }}
            />
            <div className="relative flex items-center gap-1">
              {[0, 1, 2].map((index) => (
                <span
                  key={index}
                  className="h-2 w-2 rounded-full bg-current shadow-[0_0_0_3px_rgba(79,141,247,0.08)] dark:shadow-[0_0_0_3px_rgba(130,173,255,0.08)]"
                  style={{ animation: `chat-pre-output-dot 1.15s ease-in-out ${index * 0.12}s infinite` }}
                />
              ))}
            </div>
          </div>
          <div className="min-w-0 space-y-0.5">
            <div
              className="truncate text-[12.5px] font-semibold tracking-[-0.03em] text-foreground md:text-[13px]"
              data-testid={`${testIdPrefix}-pre-output-title`}
            >
              {activePhrase}
            </div>
            <div
              className="text-[10px] font-medium leading-4 text-muted-foreground md:text-[11px]"
              data-testid={`${testIdPrefix}-pre-output-detail`}
            >
              {detailLabel}
            </div>
          </div>
        </div>
      </div>
      <div
        className="flex items-center gap-1.5"
        data-testid={`${testIdPrefix}-pre-output-status`}
      >
        <span className="relative inline-flex h-2.5 w-2.5 shrink-0 items-center justify-center">
          <span className="h-1.5 w-1.5 rounded-full bg-[#4f8df7]" />
        </span>
        <span className="relative h-1 w-12 shrink-0 overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.08]">
          <span
            className="absolute top-0 h-full w-6 rounded-full bg-[linear-gradient(90deg,rgba(79,141,247,0.9),rgba(123,166,248,0.65))]"
            style={{ animation: 'chat-pre-output-rail 1.9s cubic-bezier(0.4, 0, 0.2, 1) infinite' }}
          />
        </span>
        <span
          className="text-[11.5px] font-semibold tracking-[-0.02em] text-muted-foreground"
          data-testid={`${testIdPrefix}-pre-output-status-text`}
        >
          {statusLabel}
        </span>
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div
      className="group w-full min-w-0 space-y-3.5 pt-0.5"
      data-testid="chat-typing-indicator"
    >
      <div
        className="flex w-full min-w-0 items-center gap-3"
        data-testid="chat-typing-indicator-header"
      >
        <AssistantAvatar testId="chat-typing-avatar" />
        <div className="min-w-0 flex-1">
          <ProductNameIndicator
            scanning
            testIdPrefix="chat-typing-indicator"
            className="max-w-full"
          />
        </div>
      </div>
      <div
        className="flex w-full min-w-0 flex-col items-start space-y-1.5 max-w-[80%]"
        data-testid="chat-typing-indicator-content"
      >
        <PreOutputStatusPanel testIdPrefix="chat-typing-indicator" />
      </div>
    </div>
  );
}

// 闁冲厜鍋撻柍鍏夊亾 Activity Indicator (shown between tool cycles) 闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋?

function ProcessActivityIndicator({
  streamStyle = false,
  label,
  detail,
}: {
  streamStyle?: boolean;
  label?: string | null;
  detail?: string | null;
}) {
  const { t } = useTranslation('chat');
  const resolvedLabel = label || t('process.workingFor', { duration: '...' });
  const { activePhrase, detailLabel } = useRotatingProcessActivityCopy();

  const statusBody = (
    <div
      className="space-y-2.5"
      aria-label={activePhrase}
      data-process-activity-detail={detailLabel}
    >
      <div
        className="text-sm leading-6 text-muted-foreground"
        data-testid="chat-process-activity-copy"
      >
        <span data-testid="chat-process-activity-label">{resolvedLabel}</span>
      </div>
      {detail && (
        <div
          className="text-[12px] leading-5 text-muted-foreground/80"
          data-testid="chat-process-activity-detail"
        >
          {detail}
        </div>
      )}
    </div>
  );

  if (streamStyle) {
    return (
      <div className="w-full max-w-none space-y-2 py-1" data-testid="chat-process-activity-stream">
        <style>{'@keyframes chat-thinking-pulse { 0% { transform: scale(0.82); opacity: 0.0; } 35% { opacity: 0.38; } 100% { transform: scale(1.55); opacity: 0; } } @keyframes chat-thinking-dot { 0%, 100% { transform: translateY(0); opacity: 0.55; } 50% { transform: translateY(-2px); opacity: 1; } } @keyframes chat-thinking-slide { 0% { transform: translateX(-70%); opacity: 0.4; } 50% { opacity: 1; } 100% { transform: translateX(140%); opacity: 0.45; } }'}</style>
        {statusBody}
      </div>
    );
  }

  return (
    <div className="rounded-[22px] border border-black/6 bg-[linear-gradient(180deg,rgba(255,255,255,0.34),rgba(255,255,255,0.18))] px-4 py-3 text-foreground shadow-[0_10px_30px_rgba(15,23,42,0.05)] backdrop-blur-sm dark:border-white/8 dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.025))]">
      <style>{'@keyframes chat-thinking-pulse { 0% { transform: scale(0.82); opacity: 0.0; } 35% { opacity: 0.38; } 100% { transform: scale(1.55); opacity: 0; } } @keyframes chat-thinking-dot { 0%, 100% { transform: translateY(0); opacity: 0.55; } 50% { transform: translateY(-2px); opacity: 1; } } @keyframes chat-thinking-slide { 0% { transform: translateX(-70%); opacity: 0.4; } 50% { opacity: 1; } 100% { transform: translateX(140%); opacity: 0.45; } }'}</style>
      <div className="space-y-2.5">
        {statusBody}
      </div>
    </div>
  );
}

function ActivityIndicator({ phase }: { phase: 'tool_processing' }) {
  const { t } = useTranslation('chat');
  const toolProcessingLabel = t('process.processingToolResults', 'Processing tool results...');
  void phase;
  return (
    <div
      className="w-full pt-0.5"
      data-testid="chat-tool-processing-indicator"
      aria-label={toolProcessingLabel}
    >
      <div className="flex items-start gap-3">
        <AssistantAvatar testId="chat-tool-processing-avatar" />
        <div className="min-w-0 flex-1 space-y-1.5 pt-0.5">
          <ProductNameIndicator
            testIdPrefix="chat-tool-processing-indicator"
            className="max-w-full"
          />
          <div className="text-sm leading-6 text-muted-foreground">
            <div className="flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              <span>{toolProcessingLabel}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Chat;
