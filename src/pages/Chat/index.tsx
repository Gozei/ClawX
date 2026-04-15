/**
 * Chat Page
 * Native React implementation communicating with OpenClaw Gateway
 * via gateway:rpc IPC. Session selector, thinking toggle, and refresh
 * are in the toolbar; messages render with markdown + streaming.
 */
import { memo, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ChevronDown, ChevronRight, ListTodo, Loader2, Network, Sparkles, Workflow } from 'lucide-react';
import { useChatStore, type RawMessage, type ToolStatus } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { useAgentsStore } from '@/stores/agents';
import { AppLogo } from '@/components/branding/AppLogo';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { ChatToolbarV2 } from './ChatToolbarV2';
import {
  assistantMessageShowsInChat,
  extractImages,
  extractText,
  extractThinking,
  extractToolUse,
} from './message-utils';
import { useTranslation } from 'react-i18next';
import { useBranding } from '@/lib/branding';
import { cn } from '@/lib/utils';
import { useStickToBottomInstant } from '@/hooks/use-stick-to-bottom-instant';
import { useMinLoading } from '@/hooks/use-min-loading';
import { useSettingsStore, type AssistantMessageStyle, type ChatProcessDisplayMode } from '@/stores/settings';
import { groupMessagesForDisplay, splitFinalMessageForTurnDisplay } from './history-grouping';
import { getProcessActivityLabel, getProcessEventItems, ProcessEventMessage, ProcessFinalDivider } from './process-events-next';

const EMPTY_MESSAGES: RawMessage[] = [];

export function Chat() {
  const { t } = useTranslation('chat');
  const gatewayStatus = useGatewayStore((s) => s.status);
  const isGatewayRunning = gatewayStatus.state === 'running';

  const messages = useChatStore((s) => s.messages);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const loading = useChatStore((s) => s.loading);
  const sending = useChatStore((s) => s.sending);
  const error = useChatStore((s) => s.error);
  const showThinking = useChatStore((s) => s.showThinking);
  const chatProcessDisplayMode = useSettingsStore((s) => s.chatProcessDisplayMode);
  const assistantMessageStyle = useSettingsStore((s) => s.assistantMessageStyle);
  const activeTurnBuffer = useChatStore((s) => s.activeTurnBuffer);
  const rawStreamingMessage = useChatStore((s) => s.streamingMessage);
  const streamingTools = useChatStore((s) => s.streamingTools);
  const pendingFinal = useChatStore((s) => s.pendingFinal);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const abortRun = useChatStore((s) => s.abortRun);
  const clearError = useChatStore((s) => s.clearError);
  const fetchAgents = useAgentsStore((s) => s.fetchAgents);

  const cleanupEmptySession = useChatStore((s) => s.cleanupEmptySession);

  const safeMessages = Array.isArray(messages) ? messages : EMPTY_MESSAGES;
  const minLoading = useMinLoading(loading && safeMessages.length > 0);
  const { contentRef, scrollRef } = useStickToBottomInstant(currentSessionKey);

  // Load data when gateway is running.
  // When the store already holds messages for this session (i.e. the user
  // is navigating *back* to Chat), use quiet mode so the existing messages
  // stay visible while fresh data loads in the background.  This avoids
  // an unnecessary messages → spinner → messages flicker.
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
  const fallbackActiveTurnStartIndex = !activeTurnBuffer && sending ? findLastUserMessageIndex(safeMessages) : -1;
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
  const displayHistoryMessages = useMemo(() => (
    trimDeferredHistoryForActiveTurn(deferredHistoryMessages, activeTurnUserMessage)
  ), [activeTurnUserMessage, deferredHistoryMessages]);
  const activeTurnProcessMessages = activeTurnBuffer?.processMessages ?? fallbackProcessMessages;
  const activeTurnAssistantMessages = activeTurnBuffer?.assistantMessages ?? fallbackAssistantMessages;
  const persistedActiveFinalMessage = activeTurnBuffer?.persistedFinalMessage ?? fallbackPersistedFinalMessage;
  const streamingProcessMessage = activeTurnBuffer?.processStreamingMessage ?? fallbackSplitStreaming?.collapsedProcessMessage ?? null;
  const splitStreamingFinalMessage = activeTurnBuffer?.finalStreamingMessage ?? fallbackSplitStreaming?.finalDisplayMessage ?? fallbackStreamingDisplayMessage;
  const hasAnyStreamContent = activeTurnBuffer?.hasAnyStreamContent ?? !!fallbackStreamingDisplayMessage;
  const isStreamingDuplicateOfPersistedAssistant = activeTurnBuffer?.isStreamingDuplicateOfPersistedAssistant ?? fallbackIsStreamingDuplicate;
  const hasStreamToolStatus = chatProcessDisplayMode === 'all' && streamingTools.length > 0;
  const streamingDisplayMessage = activeTurnBuffer?.streamingDisplayMessage ?? fallbackStreamingDisplayMessage;
  const hasPersistedProcessMessages = activeTurnProcessMessages.some((message) => (
    hasVisibleProcessContent(message, showThinking, chatProcessDisplayMode, assistantMessageStyle)
  ));
  const hasStreamingProcessMessage = streamingProcessMessage != null
    && hasVisibleProcessContent(streamingProcessMessage, showThinking, chatProcessDisplayMode, assistantMessageStyle);
  const hasStreamingFinalMessage = splitStreamingFinalMessage != null
    && hasVisibleFinalContent(splitStreamingFinalMessage);
  const shouldUseProcessLayout = hasPersistedProcessMessages
    || hasStreamingProcessMessage
    || hasStreamToolStatus
    || pendingFinal
    || (sending && (activeTurnAssistantMessages.length > 0 || streamingDisplayMessage != null));
  const showProcessActivity = shouldUseProcessLayout && sending && !hasStreamingFinalMessage;
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
  const activeTurnStartedAtMs = activeTurnUserMessage
    ? (activeTurnBuffer?.startedAtMs ?? toTimestampMs(activeTurnUserMessage.timestamp) ?? toTimestampMs(safeMessages[safeMessages.length - 1]?.timestamp) ?? 0)
    : (activeTurnBuffer?.startedAtMs ?? toTimestampMs(safeMessages[safeMessages.length - 1]?.timestamp) ?? 0);

  const isEmpty = safeMessages.length === 0 && !sending;
  const showSessionLoadingState = loading && safeMessages.length === 0 && !sending;

  return (
    <div
      className={cn("relative -m-6 flex flex-col transition-colors duration-500 dark:bg-background")}
      style={{
        height: 'calc(100vh - 2.5rem)',
        backgroundImage:
          'radial-gradient(circle at top right, rgba(59,130,246,0.10), transparent 24%), radial-gradient(circle at 18% 12%, rgba(148,163,184,0.08), transparent 18%)',
      }}
    >
      {/* Toolbar */}
      <div
        data-testid="chat-toolbar-header"
        className="flex h-14 shrink-0 items-center justify-end border-b border-black/5 bg-white/32 px-4 backdrop-blur-md dark:border-white/5 dark:bg-white/[0.02]"
      >
        <ChatToolbarV2 />
      </div>

      {/* Messages Area */}
      <div ref={scrollRef} data-testid="chat-scroll-container" data-chat-scroll-container="true" className="flex-1 overflow-y-auto px-4 pt-5 pb-8">
        <div ref={contentRef} data-testid="chat-content-column" className="max-w-4xl mx-auto space-y-4">
          {showSessionLoadingState ? (
            <div className="flex min-h-[40vh] items-center justify-center">
              <div className="bg-background shadow-lg rounded-lg p-2.5 border border-border">
                <LoadingSpinner size="md" />
              </div>
            </div>
          ) : isEmpty ? (
            <WelcomeScreenMinimal />
          ) : (
            <>
              <HistoryMessages
                messages={displayHistoryMessages}
                showThinking={showThinking}
                chatProcessDisplayMode={chatProcessDisplayMode}
                assistantMessageStyle={assistantMessageStyle}
              />

              {activeTurnUserMessage ? (
                <ActiveTurn
                  key={activeTurnUserMessage.id || `active-turn-${currentSessionKey}`}
                  userMessage={activeTurnUserMessage}
                  processMessages={activeTurnProcessMessages}
                  processStreamingMessage={activeTurnProcessStreamingMessage}
                  finalMessage={persistedActiveFinalMessage}
                  finalStreamingMessage={activeTurnFinalStreamingMessage}
                  showThinking={showThinking}
                  chatProcessDisplayMode={chatProcessDisplayMode}
                  assistantMessageStyle={assistantMessageStyle}
                  startedAtMs={activeTurnStartedAtMs}
                  showActivity={showProcessActivity}
                  showTyping={!shouldUseProcessLayout && !persistedActiveFinalMessage && !activeTurnFinalStreamingMessage && !pendingFinal && !hasAnyStreamContent}
                  streamingTools={streamingTools}
                  sending={sending}
                />
              ) : (
                <>
                  {/* Streaming message */}
                  {activeTurnFinalStreamingMessage && (
                    <ChatMessage
                      message={activeTurnFinalStreamingMessage}
                      showThinking={showThinking}
                      isStreaming
                      streamingTools={streamingTools}
                    />
                  )}

                  {/* Activity indicator: waiting for next AI turn after tool execution */}
                  {sending && pendingFinal && !activeTurnFinalStreamingMessage && !isStreamingDuplicateOfPersistedAssistant && chatProcessDisplayMode === 'all' && (
                    <ActivityIndicator phase="tool_processing" />
                  )}

                  {/* Typing indicator when sending but no stream content yet */}
                  {sending && !pendingFinal && !hasAnyStreamContent && (
                    <TypingIndicator />
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* Session notice bar */}
      {error && (
        <div
          className="border-t border-amber-500/20 bg-amber-500/10 px-4 py-2"
          data-testid="chat-session-notice"
        >
          <div className="max-w-4xl mx-auto flex items-center justify-between">
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

      {/* Input Area */}
      <ChatInput
        onSend={sendMessage}
        onStop={abortRun}
        disabled={!isGatewayRunning}
        sending={sending}
      />

      {/* Transparent loading overlay */}
      {minLoading && !sending && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/20 backdrop-blur-[1px] rounded-lg pointer-events-auto">
          <div className="bg-background shadow-lg rounded-lg p-2.5 border border-border">
            <LoadingSpinner size="md" />
          </div>
        </div>
      )}
    </div>
  );
}

type ProcessPhase = 'working' | 'processed';

function findProcessScrollContainer(element: HTMLElement | null): HTMLElement | null {
  let current = element?.parentElement ?? null;
  while (current) {
    if (current.dataset.chatScrollContainer === 'true') {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

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

function trimDeferredHistoryForActiveTurn(
  deferredHistoryMessages: RawMessage[],
  activeTurnUserMessage: RawMessage | null,
): RawMessage[] {
  if (!activeTurnUserMessage) return deferredHistoryMessages;

  const activeTurnUserKey = buildMessageDisplayKey(activeTurnUserMessage);
  const activeTurnHistoryIndex = deferredHistoryMessages.findIndex((message) => (
    buildMessageDisplayKey(message) === activeTurnUserKey
  ));

  return activeTurnHistoryIndex >= 0
    ? deferredHistoryMessages.slice(0, activeTurnHistoryIndex)
    : deferredHistoryMessages;
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

  const items = getProcessEventItems(message, showThinking, chatProcessDisplayMode);

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

const HistoryMessages = memo(function HistoryMessages({
  messages,
  showThinking,
  chatProcessDisplayMode,
  assistantMessageStyle,
}: {
  messages: RawMessage[];
  showThinking: boolean;
  chatProcessDisplayMode: ChatProcessDisplayMode;
  assistantMessageStyle: AssistantMessageStyle;
}) {
  const displayItems = useMemo(() => groupMessagesForDisplay(messages), [messages]);

  return (
    <>
      {displayItems.map((item) => {
        if (item.type === 'turn') {
          return (
            <CollapsedProcessTurn
              key={item.key}
              userMessage={item.userMessage}
              intermediateMessages={item.intermediateMessages}
              finalMessage={item.finalMessage}
              showThinking={showThinking}
              chatProcessDisplayMode={chatProcessDisplayMode}
              assistantMessageStyle={assistantMessageStyle}
            />
          );
        }

        return (
          <ChatMessage
            key={item.key}
            message={item.message}
            showThinking={showThinking}
          />
        );
      })}
    </>
  );
});

function ProcessSection({
  processMessages,
  processStreamingMessage,
  phase,
  showThinking,
  chatProcessDisplayMode,
  assistantMessageStyle,
  startedAtMs,
  completedAtMs,
  showActivity,
  showFinalDivider,
  streamingTools,
}: {
  processMessages: RawMessage[];
  processStreamingMessage?: RawMessage | null;
  phase: ProcessPhase;
  showThinking: boolean;
  chatProcessDisplayMode: ChatProcessDisplayMode;
  assistantMessageStyle: AssistantMessageStyle;
  startedAtMs: number;
  completedAtMs?: number;
  showActivity?: boolean;
  showFinalDivider?: boolean;
  streamingTools?: ToolStatus[];
}) {
  const { i18n } = useTranslation('chat');
  const language = i18n?.resolvedLanguage || i18n?.language;
  const visibleMessages = processMessages.filter((message) => (
    hasVisibleProcessContent(message, showThinking, chatProcessDisplayMode, assistantMessageStyle)
  ));
  const hasStreamingProcessContent = !!processStreamingMessage
    && (
      hasVisibleProcessContent(processStreamingMessage, showThinking, chatProcessDisplayMode, assistantMessageStyle)
      || (chatProcessDisplayMode === 'all' && (streamingTools?.length ?? 0) > 0)
    );
  const hasSection = visibleMessages.length > 0 || hasStreamingProcessContent || !!showActivity;
  // 仅有过程区、下方没有「最终回复」气泡时默认展开，避免只看见「已处理」一行误以为空白
  const [collapsed, setCollapsed] = useState(() => phase === 'processed' && !!showFinalDivider);
  const [nowMs, setNowMs] = useState(() => completedAtMs ?? startedAtMs);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const expandAnchorTopRef = useRef<number | null>(null);
  const expandScrollContainerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (phase !== 'working') return undefined;
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, [phase]);

  useLayoutEffect(() => {
    if (collapsed || expandAnchorTopRef.current == null) return;

    const toggleElement = toggleRef.current;
    const scrollContainer = expandScrollContainerRef.current;
    if (!toggleElement || !scrollContainer) {
      expandAnchorTopRef.current = null;
      expandScrollContainerRef.current = null;
      return;
    }

    const nextTop = toggleElement.getBoundingClientRect().top;
    scrollContainer.scrollTop += nextTop - expandAnchorTopRef.current;
    expandAnchorTopRef.current = null;
    expandScrollContainerRef.current = null;
  }, [collapsed]);

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
  const isCollapsible = phase === 'processed';
  const usesStreamProcessStyle = assistantMessageStyle === 'stream';
  const expandAllEvents = phase === 'working';
  const activitySourceMessage = processStreamingMessage ?? visibleMessages[visibleMessages.length - 1] ?? null;
  const activityLabel = getProcessActivityLabel(
    activitySourceMessage,
    showThinking,
    chatProcessDisplayMode,
    streamingTools,
    language,
  );

  const handleToggle = () => {
    if (!isCollapsible) return;

    if (collapsed) {
      const toggleElement = toggleRef.current;
      const scrollContainer = findProcessScrollContainer(toggleElement);
      if (toggleElement && scrollContainer) {
        expandAnchorTopRef.current = toggleElement.getBoundingClientRect().top;
        expandScrollContainerRef.current = scrollContainer;
      }
    }

    setCollapsed((current) => !current);
  };

  return (
    <div className="flex gap-3">
      <div
        data-testid="chat-process-avatar"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full mt-1 bg-black/5 dark:bg-white/5 text-foreground"
      >
        <Sparkles className="h-4 w-4" />
      </div>
      <div className={cn('w-full min-w-0', usesStreamProcessStyle ? 'max-w-none' : 'max-w-[80%]')}>
        {isCollapsible ? (
          <button
            ref={toggleRef}
            type="button"
            onClick={handleToggle}
            className="group inline-flex items-center gap-1.5 rounded-full px-1 py-0.5 text-left text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            data-testid="chat-process-toggle"
          >
            <span data-testid="chat-process-status">{statusLabel}</span>
            {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        ) : (
          <div
            className="inline-flex items-center rounded-full px-1 py-0.5 text-left text-[13px] font-medium text-muted-foreground"
            data-testid="chat-process-header"
          >
            <span data-testid="chat-process-status">{statusLabel}</span>
          </div>
        )}

        {!collapsed && (
          <div
            className={cn('mt-1.5', usesStreamProcessStyle ? 'space-y-1.5' : 'space-y-3')}
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
                    expandAll={expandAllEvents}
                  />
                ))}
                {hasStreamingProcessContent && processStreamingMessage && (
                  <ProcessEventMessage
                    key={processStreamingMessage.id || 'process-streaming'}
                    message={processStreamingMessage}
                    showThinking={showThinking}
                    chatProcessDisplayMode={chatProcessDisplayMode}
                    streamingTools={streamingTools}
                    expandAll={expandAllEvents}
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
                  />
                ))}
                {hasStreamingProcessContent && processStreamingMessage && (
                  <ChatMessage
                    key={processStreamingMessage.id || 'process-streaming'}
                    message={processStreamingMessage}
                    showThinking={showThinking}
                    isStreaming
                    hideAvatar
                    constrainWidth={false}
                    streamingTools={streamingTools}
                  />
                )}
              </>
            )}
            {showActivity && (
              <ProcessActivityIndicator
                streamStyle={usesStreamProcessStyle}
                label={activityLabel}
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
}: {
  userMessage: RawMessage;
  intermediateMessages: RawMessage[];
  finalMessage: RawMessage;
  showThinking: boolean;
  chatProcessDisplayMode: ChatProcessDisplayMode;
  assistantMessageStyle: AssistantMessageStyle;
}) {
  const { t } = useTranslation('chat');
  const { collapsedProcessMessage, finalDisplayMessage } = splitFinalMessageForTurnDisplay(finalMessage);
  const processMessages = collapsedProcessMessage
    ? [...intermediateMessages, collapsedProcessMessage]
    : intermediateMessages;
  const hasProcessSection = processMessages.some((message) => (
    hasVisibleProcessContent(message, showThinking, chatProcessDisplayMode, assistantMessageStyle)
  ));
  const finalHasVisibleContent = hasVisibleFinalContent(finalDisplayMessage);
  const showTools = chatProcessDisplayMode === 'all';
  const pipelineMissesAssistantBody = !finalHasVisibleContent && !hasProcessSection
    && !assistantMessageShowsInChat(finalMessage, { showThinking, showTools });

  return (
    <div className={cn('space-y-3', hasProcessSection && finalHasVisibleContent && 'space-y-2')}>
      <ChatMessage message={userMessage} showThinking={showThinking} />

      {hasProcessSection && (
        <ProcessSection
          key={`collapsed:${userMessage.id ?? userMessage.timestamp ?? 'unknown'}:${finalMessage.id ?? finalMessage.timestamp ?? 'unknown'}`}
          processMessages={processMessages}
          phase="processed"
          showThinking={showThinking}
          chatProcessDisplayMode={chatProcessDisplayMode}
          assistantMessageStyle={assistantMessageStyle}
          startedAtMs={resolveMessageTimestampMs(userMessage)}
          completedAtMs={resolveMessageTimestampMs(finalMessage, resolveMessageTimestampMs(userMessage))}
          showFinalDivider={finalHasVisibleContent}
        />
      )}

      {finalHasVisibleContent && (
        <ChatMessage
          message={finalDisplayMessage}
          showThinking={false}
          hideAvatar={hasProcessSection}
          reserveAvatarSpace={hasProcessSection}
        />
      )}

      {/* 分组视图未识别出过程区/终稿时仍尝试整消息渲染；再不行则提示用户刷新或调整显示选项 */}
      {!finalHasVisibleContent && !hasProcessSection && (
        <>
          <ChatMessage message={finalMessage} showThinking={showThinking} />
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
  startedAtMs,
  showActivity,
  showTyping,
  streamingTools,
  sending,
}: {
  userMessage: RawMessage;
  processMessages: RawMessage[];
  processStreamingMessage?: RawMessage | null;
  finalMessage?: RawMessage | null;
  finalStreamingMessage?: RawMessage | null;
  showThinking: boolean;
  chatProcessDisplayMode: ChatProcessDisplayMode;
  assistantMessageStyle: AssistantMessageStyle;
  startedAtMs: number;
  showActivity: boolean;
  showTyping: boolean;
  streamingTools: ToolStatus[];
  sending: boolean;
}) {
  const liveProcessMessages = sending
    ? [
        ...processMessages,
        ...(finalMessage ? [finalMessage] : []),
      ]
    : processMessages;
  const finalHasVisibleContent = !sending && hasVisibleFinalContent(finalMessage);
  // 流式阶段也需要渲染正文气泡，否则纯文本回复只出现在过程区里用户看不见
  const finalStreamingHasVisibleContent = hasVisibleFinalContent(finalStreamingMessage);
  const showFinalStreamingBubble = finalStreamingHasVisibleContent && !!finalStreamingMessage;

  // 过程区只用真正的过程流消息(processStreamingMessage)判断，正文流消息作为独立气泡渲染
  const hasProcessSection = liveProcessMessages.some((message) => (
    hasVisibleProcessContent(message, showThinking, chatProcessDisplayMode, assistantMessageStyle)
  ))
    || (
      !!processStreamingMessage
      && (
        hasVisibleProcessContent(processStreamingMessage, showThinking, chatProcessDisplayMode, assistantMessageStyle)
        || (chatProcessDisplayMode === 'all' && streamingTools.length > 0)
      )
    )
    || showActivity;

  return (
    <div className={cn('space-y-3', hasProcessSection && (finalHasVisibleContent || finalStreamingHasVisibleContent) && 'space-y-2')}>
      <ChatMessage message={userMessage} showThinking={showThinking} />

      {hasProcessSection && (
        <ProcessSection
          key={`active:${userMessage.id ?? userMessage.timestamp ?? 'unknown'}:${sending ? 'working' : 'processed'}:${finalMessage?.id ?? finalMessage?.timestamp ?? 'none'}`}
          processMessages={liveProcessMessages}
          processStreamingMessage={processStreamingMessage}
          phase="working"
          showThinking={showThinking}
          chatProcessDisplayMode={chatProcessDisplayMode}
          assistantMessageStyle={assistantMessageStyle}
          startedAtMs={startedAtMs}
          showActivity={showActivity}
          showFinalDivider={!sending && (finalHasVisibleContent || finalStreamingHasVisibleContent)}
          streamingTools={streamingTools}
        />
      )}

      {finalHasVisibleContent && finalMessage && (
        <ChatMessage
          message={finalMessage}
          showThinking={false}
          hideAvatar={hasProcessSection}
          reserveAvatarSpace={hasProcessSection}
        />
      )}

      {showFinalStreamingBubble && (
        <ChatMessage
          message={finalStreamingMessage!}
          showThinking={false}
          hideAvatar={hasProcessSection}
          reserveAvatarSpace={hasProcessSection}
          isStreaming={sending}
        />
      )}

      {!hasProcessSection && !finalHasVisibleContent && !showFinalStreamingBubble && showTyping && (
        <TypingIndicator />
      )}
    </div>
  );
}

// ── Welcome Screen ──────────────────────────────────────────────

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

export function WelcomeScreenLegacy({
  gatewayHint,
  onOpenSettings,
}: {
  gatewayHint: {
    state: string;
    error?: string;
    port: number;
    pid?: number;
    reconnectAttempts?: number;
  } | null;
  onOpenSettings: () => void;
}) {
  const { t, i18n } = useTranslation('chat');
  const branding = useBranding();
  const [elapsedMs, setElapsedMs] = useState(0);
  const quickActions = [
    {
      key: 'askQuestions',
      icon: ListTodo,
      label: t('welcome.askQuestions'),
      description: t('welcome.askQuestionsDesc'),
    },
    {
      key: 'creativeTasks',
      icon: Workflow,
      label: t('welcome.creativeTasks'),
      description: t('welcome.creativeTasksDesc'),
    },
    {
      key: 'brainstorming',
      icon: Network,
      label: t('welcome.brainstorming'),
      description: t('welcome.brainstormingDesc'),
    },
  ];

  const isZh = (i18n?.resolvedLanguage || i18n?.language || '').startsWith('zh');
  const isStarting = gatewayHint?.state === 'starting' || gatewayHint?.state === 'reconnecting';
  const isError = gatewayHint?.state === 'error';

  useEffect(() => {
    if (!gatewayHint || !isStarting) {
      return undefined;
    }
    const timer = setInterval(() => {
      setElapsedMs((current) => current + 1000);
    }, 1000);
    return () => clearInterval(timer);
  }, [gatewayHint, isStarting]);

  const gatewayStatusTitle = isStarting
    ? (isZh ? '正在连接工作引擎' : 'Connecting the workspace engine')
    : isError
      ? (isZh ? '工作引擎暂时不可用' : 'The workspace engine is temporarily unavailable')
      : (isZh ? '工作引擎尚未启动' : 'The workspace engine is not running');
  const gatewayStatusDescription = isStarting
    ? (isZh ? 'Gateway 正在后台启动，界面已经就绪，稍后即可开始对话。' : 'The Gateway is starting in the background. The interface is ready and chat will be available shortly.')
    : isError
      ? (isZh ? '你可以先浏览页面内容，也可以打开设置检查运行环境。' : 'You can keep browsing the page or open settings to inspect the runtime.')
      : (isZh ? '启动后即可开始新对话或恢复现有会话。' : 'Start it when you are ready to begin a new conversation.');
  const elapsedLabel = elapsedMs > 0 ? formatProcessDuration(elapsedMs, i18n?.resolvedLanguage || i18n?.language) : null;
  const gatewayStatusMeta = gatewayHint ? [
    `port ${gatewayHint.port}`,
    gatewayHint.pid ? `pid ${gatewayHint.pid}` : null,
    gatewayHint.reconnectAttempts ? (isZh ? `重试 ${gatewayHint.reconnectAttempts}` : `retry ${gatewayHint.reconnectAttempts}`) : null,
    elapsedLabel ? (isZh ? `已等待 ${elapsedLabel}` : `waiting ${elapsedLabel}`) : null,
  ].filter(Boolean).join('  ·  ') : '';

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="w-full max-w-5xl px-2">
        <div className="mx-auto max-w-3xl text-center">
          {gatewayHint ? (
            <div className="mx-auto mb-5 max-w-2xl rounded-[12px] border border-white/10 bg-white/[0.045] px-[clamp(14px,2.2vw,20px)] py-[clamp(12px,2vw,16px)] text-left shadow-[0_14px_36px_rgba(2,6,23,0.12)] backdrop-blur-sm">
              <div className="flex items-start gap-3">
                <div className={cn(
                  "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border",
                  isError
                    ? 'border-amber-400/24 bg-amber-400/12 text-amber-300'
                    : 'border-primary/20 bg-primary/10 text-primary',
                )}>
                  {isError ? (
                    <AlertCircle className="h-4 w-4" />
                  ) : (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-[clamp(13px,2vw,15px)] font-medium text-foreground">
                      {gatewayStatusTitle}
                    </div>
                    <div className={cn(
                      'inline-flex rounded-md px-2 py-0.5 text-[10px] font-medium',
                      isError
                        ? 'bg-amber-400/12 text-amber-200'
                        : 'bg-emerald-400/12 text-emerald-200',
                    )}>
                      {isError ? (isZh ? '需要关注' : 'Attention') : (isZh ? '后台启动中' : 'Starting')}
                    </div>
                  </div>
                  <div className="mt-1 text-[clamp(11px,1.8vw,13px)] leading-5 text-foreground/62">
                    {gatewayStatusDescription}
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-md bg-white/8">
                    <div
                      className={cn('h-full rounded-md transition-[width] duration-500', isError ? 'bg-amber-400/80' : 'bg-primary/80')}
                      style={{ width: isError ? '82%' : isStarting ? (elapsedMs > 30000 ? '78%' : elapsedMs > 12000 ? '62%' : elapsedMs > 4000 ? '44%' : '26%') : '16%' }}
                    />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[clamp(10px,1.7vw,12px)] text-foreground/42">
                    <span>{gatewayStatusMeta}</span>
                    <button
                      type="button"
                      onClick={onOpenSettings}
                      className="rounded-md border border-white/10 px-2.5 py-1 text-foreground/62 transition hover:bg-white/[0.05] hover:text-foreground"
                    >
                      {isZh ? '打开设置' : 'Open settings'}
                    </button>
                  </div>
                  {gatewayHint.error ? (
                    <div className="mt-2 text-[11px] leading-5 text-amber-200/80">
                      {gatewayHint.error}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          <div className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-foreground/42">
            <Sparkles className="h-3.5 w-3.5 text-primary/80" />
            <span>{t('welcome.eyebrow', { appName: branding.productName })}</span>
          </div>

          <h1 className="mt-6 text-[40px] font-semibold tracking-[-0.05em] text-foreground md:text-[58px]">
            {t('welcome.subtitle', { appName: branding.productName })}
          </h1>

          <p
            data-testid="chat-welcome-description"
            className="mx-auto mt-4 max-w-4xl text-[17px] leading-8 text-foreground/62 md:text-[18px]"
          >
            {t('welcome.description', { appName: branding.productName })}
          </p>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {quickActions.map(({ key, icon: Icon, label, description }) => (
            <button
              key={key}
              className="group rounded-[14px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] p-5 text-left shadow-[0_18px_45px_rgba(2,6,23,0.18)] transition duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:bg-[linear-gradient(180deg,rgba(59,130,246,0.10),rgba(255,255,255,0.04))]"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/[0.06] text-primary/90 transition group-hover:border-primary/30 group-hover:bg-primary/12">
                <Icon className="h-5 w-5" />
              </div>

              <div className="mt-5">
                <h3 className="text-[18px] font-semibold tracking-[-0.02em] text-foreground">
                  {label}
                </h3>
                <p className="mt-2 text-[14px] leading-6 text-foreground/58">
                  {description}
                </p>
              </div>
            </button>
          ))}
        </div>

        <div className="mt-8 text-center text-[13px] text-foreground/42">
          {t('welcome.footerHint')}
        </div>
      </div>
    </div>
  );
}

// ── Typing Indicator ────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full mt-1 bg-black/5 dark:bg-white/5 text-foreground">
        <Sparkles className="h-4 w-4" />
      </div>
      <div className="bg-black/5 dark:bg-white/5 text-foreground rounded-xl px-4 py-3">
        <div className="flex gap-1">
          <span className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
          <span className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    </div>
  );
}

// ── Activity Indicator (shown between tool cycles) ─────────────

function ProcessActivityIndicator({
  streamStyle = false,
  label,
}: {
  streamStyle?: boolean;
  label?: string | null;
}) {
  const { t, i18n } = useTranslation('chat');
  const resolvedLabel = label || t('process.workingFor', { duration: '...' });
  const language = i18n?.resolvedLanguage || i18n?.language;
  const isZh = language?.startsWith('zh');
  const activityPhrases = isZh
    ? ['理解问题', '检索资料', '整理回答']
    : ['Understanding', 'Retrieving', 'Composing'];
  const [phraseIndex, setPhraseIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setPhraseIndex((current) => (current + 1) % activityPhrases.length);
    }, 1800);
    return () => clearInterval(timer);
  }, [activityPhrases.length]);

  const capsuleLabel = `${activityPhrases[phraseIndex]}${isZh ? '中' : ' in progress'}`;
  const detailLabel = isZh ? '推理链路活跃' : 'Reasoning pipeline active';

  const statusBody = (
    <>
      <div className="inline-flex max-w-full items-center gap-3 rounded-[20px] border border-primary/12 bg-[linear-gradient(180deg,rgba(59,130,246,0.10),rgba(59,130,246,0.04))] px-3.5 py-2.5 shadow-[0_10px_30px_rgba(59,130,246,0.10)] dark:border-primary/14 dark:bg-[linear-gradient(180deg,rgba(59,130,246,0.14),rgba(59,130,246,0.05))]">
        <span
          aria-hidden="true"
          data-testid="chat-process-activity-scan"
          className="relative inline-flex h-8 w-8 shrink-0 items-center justify-center"
        >
          <span className="absolute inset-0 rounded-full bg-primary/[0.10]" />
          <span className="absolute inset-[3px] rounded-full border border-primary/18" />
          <span
            className="absolute inset-[2px] rounded-full border border-primary/28"
            style={{ animation: 'chat-thinking-pulse 1.8s ease-out infinite' }}
          />
          <span className="relative flex items-center gap-0.5">
            <span className="h-1.5 w-1.5 rounded-full bg-primary/90" style={{ animation: 'chat-thinking-dot 1.2s ease-in-out infinite' }} />
            <span className="h-1.5 w-1.5 rounded-full bg-primary/75" style={{ animation: 'chat-thinking-dot 1.2s ease-in-out 0.18s infinite' }} />
            <span className="h-1.5 w-1.5 rounded-full bg-primary/60" style={{ animation: 'chat-thinking-dot 1.2s ease-in-out 0.36s infinite' }} />
          </span>
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-semibold tracking-[-0.01em] text-foreground/86 dark:text-foreground/88">
            {capsuleLabel}
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-foreground/48 dark:text-foreground/50">
            {detailLabel}
          </span>
        </span>
      </div>
      <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
        <span className="inline-flex h-2 w-2 rounded-full bg-primary/80 shadow-[0_0_12px_rgba(59,130,246,0.5)]" />
        <span
          aria-hidden="true"
          className="inline-flex h-1 w-10 overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.08]"
        >
          <span
            className="h-full w-1/2 rounded-full bg-gradient-to-r from-primary/35 via-primary/85 to-primary/35"
            style={{ animation: 'chat-thinking-slide 1.4s ease-in-out infinite' }}
          />
        </span>
        <span data-testid="chat-process-activity-label">{resolvedLabel}</span>
      </div>
    </>
  );

  if (streamStyle) {
    return (
      <div className="max-w-sm space-y-2 px-1.5 py-1" data-testid="chat-process-activity-stream">
        <style>{'@keyframes chat-thinking-pulse { 0% { transform: scale(0.82); opacity: 0.0; } 35% { opacity: 0.38; } 100% { transform: scale(1.55); opacity: 0; } } @keyframes chat-thinking-dot { 0%, 100% { transform: translateY(0); opacity: 0.55; } 50% { transform: translateY(-2px); opacity: 1; } } @keyframes chat-thinking-slide { 0% { transform: translateX(-70%); opacity: 0.4; } 50% { opacity: 1; } 100% { transform: translateX(140%); opacity: 0.45; } }'}</style>
        {statusBody}
      </div>
    );
  }

  return (
      <div className="rounded-[12px] border border-black/6 bg-[linear-gradient(180deg,rgba(255,255,255,0.34),rgba(255,255,255,0.18))] px-4 py-3 text-foreground shadow-[0_10px_30px_rgba(15,23,42,0.05)] backdrop-blur-sm dark:border-white/8 dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.025))]">
      <style>{'@keyframes chat-thinking-pulse { 0% { transform: scale(0.82); opacity: 0.0; } 35% { opacity: 0.38; } 100% { transform: scale(1.55); opacity: 0; } } @keyframes chat-thinking-dot { 0%, 100% { transform: translateY(0); opacity: 0.55; } 50% { transform: translateY(-2px); opacity: 1; } } @keyframes chat-thinking-slide { 0% { transform: translateX(-70%); opacity: 0.4; } 50% { opacity: 1; } 100% { transform: translateX(140%); opacity: 0.45; } }'}</style>
      <div className="space-y-2.5">
        {statusBody}
      </div>
    </div>
  );
}

function ActivityIndicator({ phase }: { phase: 'tool_processing' }) {
  void phase;
  return (
    <div className="flex gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full mt-1 bg-black/5 dark:bg-white/5 text-foreground">
        <Sparkles className="h-4 w-4" />
      </div>
      <div className="bg-black/5 dark:bg-white/5 text-foreground rounded-xl px-4 py-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          <span>Processing tool results…</span>
        </div>
      </div>
    </div>
  );
}

export default Chat;
