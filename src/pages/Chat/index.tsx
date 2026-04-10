/**
 * Chat Page
 * Native React implementation communicating with OpenClaw Gateway
 * via gateway:rpc IPC. Session selector, thinking toggle, and refresh
 * are in the toolbar; messages render with markdown + streaming.
 */
import { memo, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ChevronDown, ChevronRight, ListTodo, Loader2, Network, Sparkles, Workflow } from 'lucide-react';
import { useChatStore, type RawMessage, type ToolStatus } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { useAgentsStore } from '@/stores/agents';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { ChatToolbar } from './ChatToolbar';
import { extractImages, extractText, extractThinking, extractToolUse } from './message-utils';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useBranding } from '@/lib/branding';
import { useStickToBottomInstant } from '@/hooks/use-stick-to-bottom-instant';
import { useMinLoading } from '@/hooks/use-min-loading';
import { useSettingsStore, type AssistantMessageStyle, type ChatProcessDisplayMode } from '@/stores/settings';
import { groupMessagesForDisplay, splitFinalMessageForTurnDisplay } from './history-grouping';
import { getProcessEventItems, ProcessEventMessage } from './process-events';

const EMPTY_MESSAGES: RawMessage[] = [];

export function Chat() {
  const { t } = useTranslation('chat');
  const navigate = useNavigate();
  const gatewayStatus = useGatewayStore((s) => s.status);
  const startGateway = useGatewayStore((s) => s.start);
  const restartGateway = useGatewayStore((s) => s.restart);
  const isGatewayRunning = gatewayStatus.state === 'running';

  const messages = useChatStore((s) => s.messages);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const loading = useChatStore((s) => s.loading);
  const sending = useChatStore((s) => s.sending);
  const error = useChatStore((s) => s.error);
  const showThinking = useChatStore((s) => s.showThinking);
  const chatProcessDisplayMode = useSettingsStore((s) => s.chatProcessDisplayMode);
  const assistantMessageStyle = useSettingsStore((s) => s.assistantMessageStyle);
  const streamingMessage = useChatStore((s) => s.streamingMessage);
  const streamingTools = useChatStore((s) => s.streamingTools);
  const pendingFinal = useChatStore((s) => s.pendingFinal);
  const lastUserMessageAt = useChatStore((s) => s.lastUserMessageAt);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const abortRun = useChatStore((s) => s.abortRun);
  const clearError = useChatStore((s) => s.clearError);
  const fetchAgents = useAgentsStore((s) => s.fetchAgents);

  const cleanupEmptySession = useChatStore((s) => s.cleanupEmptySession);

  const safeMessages = Array.isArray(messages) ? messages : EMPTY_MESSAGES;
  const [streamingTimestamp, setStreamingTimestamp] = useState<number>(0);
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

  // Update timestamp when sending starts
  useEffect(() => {
    if (sending && streamingTimestamp === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStreamingTimestamp(Date.now() / 1000);
    } else if (!sending && streamingTimestamp !== 0) {
      setStreamingTimestamp(0);
    }
  }, [sending, streamingTimestamp]);

  // Gateway not running block has been completely removed so the UI always renders.

  const streamMsg = streamingMessage && typeof streamingMessage === 'object'
    ? streamingMessage as unknown as { role?: string; content?: unknown; timestamp?: number }
    : null;
  const streamText = streamMsg ? extractText(streamMsg) : (typeof streamingMessage === 'string' ? streamingMessage : '');
  const hasStreamText = streamText.trim().length > 0;
  const streamThinking = streamMsg ? extractThinking(streamMsg) : null;
  const hasStreamThinking = showThinking && !!streamThinking && streamThinking.trim().length > 0;
  const streamTools = streamMsg ? extractToolUse(streamMsg) : [];
  const hasStreamTools = chatProcessDisplayMode === 'all' && streamTools.length > 0;
  const streamImages = streamMsg ? extractImages(streamMsg) : [];
  const hasStreamImages = streamImages.length > 0;
  const hasStreamToolStatus = chatProcessDisplayMode === 'all' && streamingTools.length > 0;
  const lastUserTsMs = typeof lastUserMessageAt === 'number'
    ? (lastUserMessageAt < 1e12 ? lastUserMessageAt * 1000 : lastUserMessageAt)
    : 0;
  const latestPersistedAssistant = useMemo(() => [...safeMessages].reverse().find((message) => {
    if (message.role !== 'assistant') return false;
    if (!lastUserTsMs || !message.timestamp) return true;
    const messageTsMs = message.timestamp < 1e12 ? message.timestamp * 1000 : message.timestamp;
    return messageTsMs >= lastUserTsMs;
  }), [lastUserTsMs, safeMessages]);
  const latestPersistedAssistantText = latestPersistedAssistant ? extractText(latestPersistedAssistant).trim() : '';
  const latestPersistedAssistantThinking = latestPersistedAssistant ? (extractThinking(latestPersistedAssistant)?.trim() ?? '') : '';
  const latestPersistedAssistantImages = latestPersistedAssistant ? extractImages(latestPersistedAssistant) : [];
  const latestPersistedAssistantTools = latestPersistedAssistant ? extractToolUse(latestPersistedAssistant) : [];
  const isStreamingDuplicateOfPersistedAssistant = !!latestPersistedAssistant
    && (
      (hasStreamText && latestPersistedAssistantText === streamText.trim())
      || (
        !hasStreamText
        && hasStreamThinking
        && latestPersistedAssistantThinking === (streamThinking?.trim() ?? '')
      )
    )
    && (!hasStreamImages || latestPersistedAssistantImages.length === streamImages.length)
    && (!hasStreamTools || latestPersistedAssistantTools.length === streamTools.length);
  const shouldRenderStreaming = sending
    && !isStreamingDuplicateOfPersistedAssistant
    && (hasStreamText || hasStreamThinking || hasStreamTools || hasStreamImages || hasStreamToolStatus);
  const hasAnyStreamContent = hasStreamText || hasStreamThinking || hasStreamTools || hasStreamImages || hasStreamToolStatus;
  const streamingDisplayMessage = useMemo(() => (
    shouldRenderStreaming
      ? buildStreamingDisplayMessage(streamMsg, streamText, streamingTimestamp)
      : null
  ), [shouldRenderStreaming, streamMsg, streamText, streamingTimestamp]);
  const activeTurnStartIndex = useMemo(() => (
    sending ? findLastUserMessageIndex(safeMessages) : -1
  ), [safeMessages, sending]);
  const historyMessages = useMemo(() => (
    activeTurnStartIndex >= 0 ? safeMessages.slice(0, activeTurnStartIndex) : safeMessages
  ), [activeTurnStartIndex, safeMessages]);
  const deferredHistoryMessages = useDeferredValue(historyMessages);
  const activeTurnMessages = useMemo(() => (
    activeTurnStartIndex >= 0 ? safeMessages.slice(activeTurnStartIndex) : EMPTY_MESSAGES
  ), [activeTurnStartIndex, safeMessages]);
  const activeTurnUserMessage = activeTurnMessages[0]?.role === 'user' ? activeTurnMessages[0] : null;
  const displayHistoryMessages = useMemo(() => (
    trimDeferredHistoryForActiveTurn(deferredHistoryMessages, activeTurnUserMessage)
  ), [activeTurnUserMessage, deferredHistoryMessages]);
  const activeTurnAssistantMessages = useMemo(() => (
    activeTurnUserMessage
      ? activeTurnMessages.slice(1).filter((message) => message.role === 'assistant')
      : EMPTY_MESSAGES
  ), [activeTurnMessages, activeTurnUserMessage]);
  const persistedActiveFinalMessage = isStreamingDuplicateOfPersistedAssistant && activeTurnAssistantMessages.length > 0
    ? activeTurnAssistantMessages[activeTurnAssistantMessages.length - 1]
    : null;
  const activeTurnProcessMessages = useMemo(() => (
    persistedActiveFinalMessage
      ? activeTurnAssistantMessages.slice(0, -1)
      : activeTurnAssistantMessages
  ), [activeTurnAssistantMessages, persistedActiveFinalMessage]);
  const streamingSplit = useMemo(() => (
    streamingDisplayMessage
      ? splitFinalMessageForTurnDisplay(streamingDisplayMessage)
      : null
  ), [streamingDisplayMessage]);
  const streamingProcessMessage = streamingSplit?.collapsedProcessMessage ?? null;
  const splitStreamingFinalMessage = streamingSplit?.finalDisplayMessage ?? null;
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
    || pendingFinal;
  const showProcessActivity = shouldUseProcessLayout && pendingFinal && !hasStreamingFinalMessage;
  const activeTurnProcessStreamingMessage = shouldUseProcessLayout
    ? (hasStreamingProcessMessage
        ? streamingProcessMessage
        : hasStreamToolStatus
          ? {
              role: 'assistant' as const,
              content: '',
              timestamp: streamingDisplayMessage?.timestamp ?? streamingTimestamp,
            }
          : null)
    : null;
  const activeTurnFinalStreamingMessage = shouldUseProcessLayout
    ? (hasStreamingFinalMessage ? splitStreamingFinalMessage : null)
    : streamingDisplayMessage;
  const activeTurnFinalPhaseStarted = shouldUseProcessLayout
    && (hasStreamingFinalMessage || persistedActiveFinalMessage != null);
  const activeTurnStartedAtMs = activeTurnUserMessage
    ? toTimestampMs(activeTurnUserMessage.timestamp) ?? lastUserTsMs
    : lastUserTsMs;

  const isEmpty = safeMessages.length === 0 && !sending;
  const showGatewayOfflineState = !isGatewayRunning && safeMessages.length === 0 && !sending;
  const showSessionLoadingState = loading && safeMessages.length === 0 && !sending;

  const handleStartGateway = async () => {
    try {
      if (gatewayStatus.state === 'error') {
        await restartGateway();
      } else {
        await startGateway();
      }
    } catch {
      // keep the page calm; gateway errors are surfaced by store status
    }
  };

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
      <div className="flex shrink-0 items-center justify-end border-b border-black/5 bg-white/32 px-4 py-2 backdrop-blur-md dark:border-white/5 dark:bg-white/[0.02]">
        <ChatToolbar />
      </div>

      {/* Messages Area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-5">
        <div ref={contentRef} className="max-w-4xl mx-auto space-y-4">
          {showGatewayOfflineState ? (
            <GatewayOfflineState
              state={gatewayStatus.state}
              error={gatewayStatus.error}
              port={gatewayStatus.port}
              onStart={handleStartGateway}
              onOpenSettings={() => navigate('/settings')}
            />
          ) : showSessionLoadingState ? (
            <div className="flex min-h-[40vh] items-center justify-center">
              <div className="bg-background shadow-lg rounded-full p-2.5 border border-border">
                <LoadingSpinner size="md" />
              </div>
            </div>
          ) : isEmpty ? (
            <WelcomeScreen />
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
                  finalPhaseStarted={activeTurnFinalPhaseStarted}
                  showActivity={showProcessActivity}
                  showTyping={!shouldUseProcessLayout && !persistedActiveFinalMessage && !activeTurnFinalStreamingMessage && !pendingFinal && !hasAnyStreamContent}
                  streamingTools={streamingTools}
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

      {/* Error bar */}
      {error && (
        <div className="px-4 py-2 bg-destructive/10 border-t border-destructive/20">
          <div className="max-w-4xl mx-auto flex items-center justify-between">
            <p className="text-sm text-destructive flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              {error}
            </p>
            <button
              onClick={clearError}
              className="text-xs text-destructive/60 hover:text-destructive underline"
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
        isEmpty={isEmpty}
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
  );
}

type ProcessPhase = 'working' | 'processed';

function toTimestampMs(timestamp: number | undefined): number | null {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return null;
  return timestamp < 1e12 ? timestamp * 1000 : timestamp;
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
  streamingTools?: ToolStatus[];
}) {
  const { i18n } = useTranslation('chat');
  const visibleMessages = processMessages.filter((message) => (
    hasVisibleProcessContent(message, showThinking, chatProcessDisplayMode, assistantMessageStyle)
  ));
  const hasStreamingProcessContent = !!processStreamingMessage
    && (
      hasVisibleProcessContent(processStreamingMessage, showThinking, chatProcessDisplayMode, assistantMessageStyle)
      || (chatProcessDisplayMode === 'all' && (streamingTools?.length ?? 0) > 0)
    );
  const hasSection = visibleMessages.length > 0 || hasStreamingProcessContent || !!showActivity;
  const [collapsed, setCollapsed] = useState(phase === 'processed');
  const [nowMs, setNowMs] = useState(Date.now());
  const [frozenCompletedAtMs, setFrozenCompletedAtMs] = useState<number | null>(
    phase === 'processed' ? (completedAtMs ?? Date.now()) : null,
  );

  useEffect(() => {
    if (phase === 'processed' && frozenCompletedAtMs == null) {
      setFrozenCompletedAtMs(completedAtMs ?? Date.now());
      setCollapsed(true);
    }
  }, [completedAtMs, frozenCompletedAtMs, phase]);

  useEffect(() => {
    if (phase !== 'working') return undefined;
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, [phase]);

  if (!hasSection) return null;

  const effectiveEndMs = phase === 'processed'
    ? (frozenCompletedAtMs ?? completedAtMs ?? nowMs)
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
  const expandedMessageIndex = hasStreamingProcessContent ? -1 : Math.max(visibleMessages.length - 1, 0);
  const usesStreamProcessStyle = assistantMessageStyle === 'stream';

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
            type="button"
            onClick={() => setCollapsed((current) => !current)}
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
                    defaultExpanded={!hasStreamingProcessContent && index === expandedMessageIndex}
                  />
                ))}
                {hasStreamingProcessContent && processStreamingMessage && (
                  <ProcessEventMessage
                    key={processStreamingMessage.id || 'process-streaming'}
                    message={processStreamingMessage}
                    showThinking={showThinking}
                    chatProcessDisplayMode={chatProcessDisplayMode}
                    defaultExpanded
                    streamingTools={streamingTools}
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
              <ProcessActivityIndicator streamStyle={usesStreamProcessStyle} />
            )}
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
  const { collapsedProcessMessage, finalDisplayMessage } = splitFinalMessageForTurnDisplay(finalMessage);
  const processMessages = collapsedProcessMessage
    ? [...intermediateMessages, collapsedProcessMessage]
    : intermediateMessages;
  const hasProcessSection = processMessages.some((message) => (
    hasVisibleProcessContent(message, showThinking, chatProcessDisplayMode, assistantMessageStyle)
  ));
  const finalHasVisibleContent = hasVisibleFinalContent(finalDisplayMessage);

  return (
    <div className={cn('space-y-3', hasProcessSection && finalHasVisibleContent && 'space-y-2')}>
      <ChatMessage message={userMessage} showThinking={showThinking} />

      {hasProcessSection && (
        <ProcessSection
          processMessages={processMessages}
          phase="processed"
          showThinking={showThinking}
          chatProcessDisplayMode={chatProcessDisplayMode}
          assistantMessageStyle={assistantMessageStyle}
          startedAtMs={toTimestampMs(userMessage.timestamp) ?? Date.now()}
          completedAtMs={toTimestampMs(finalMessage.timestamp) ?? Date.now()}
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
  finalPhaseStarted,
  showActivity,
  showTyping,
  streamingTools,
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
  finalPhaseStarted: boolean;
  showActivity: boolean;
  showTyping: boolean;
  streamingTools: ToolStatus[];
}) {
  const hasProcessSection = processMessages.some((message) => (
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
  const finalHasVisibleContent = hasVisibleFinalContent(finalMessage);
  const finalStreamingHasVisibleContent = hasVisibleFinalContent(finalStreamingMessage);

  return (
    <div className={cn('space-y-3', hasProcessSection && (finalHasVisibleContent || finalStreamingHasVisibleContent) && 'space-y-2')}>
      <ChatMessage message={userMessage} showThinking={showThinking} />

      {hasProcessSection && (
        <ProcessSection
          processMessages={processMessages}
          processStreamingMessage={processStreamingMessage}
          phase={finalPhaseStarted ? 'processed' : 'working'}
          showThinking={showThinking}
          chatProcessDisplayMode={chatProcessDisplayMode}
          assistantMessageStyle={assistantMessageStyle}
          startedAtMs={startedAtMs}
          showActivity={showActivity}
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

      {finalStreamingHasVisibleContent && finalStreamingMessage && (
        <ChatMessage
          message={finalStreamingMessage}
          showThinking={false}
          hideAvatar={hasProcessSection}
          reserveAvatarSpace={hasProcessSection}
          isStreaming
        />
      )}

      {!hasProcessSection && !finalHasVisibleContent && !finalStreamingHasVisibleContent && showTyping && (
        <TypingIndicator />
      )}
    </div>
  );
}

// ── Welcome Screen ──────────────────────────────────────────────

function WelcomeScreen() {
  const { t } = useTranslation('chat');
  const branding = useBranding();
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

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="w-full max-w-5xl px-2">
        <div className="mx-auto max-w-3xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-foreground/42">
            <Sparkles className="h-3.5 w-3.5 text-primary/80" />
            <span>{t('welcome.eyebrow', { appName: branding.productName })}</span>
          </div>

          <h1 className="mt-6 text-[40px] font-semibold tracking-[-0.05em] text-foreground md:text-[58px]">
            {t('welcome.subtitle', { appName: branding.productName })}
          </h1>

          <p className="mx-auto mt-4 max-w-2xl text-[17px] leading-8 text-foreground/62 md:text-[18px]">
            {t('welcome.description', { appName: branding.productName })}
          </p>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {quickActions.map(({ key, icon: Icon, label, description }) => (
            <button
              key={key}
              className="group rounded-[26px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] p-5 text-left shadow-[0_18px_45px_rgba(2,6,23,0.18)] transition duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:bg-[linear-gradient(180deg,rgba(59,130,246,0.10),rgba(255,255,255,0.04))]"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06] text-primary/90 transition group-hover:border-primary/30 group-hover:bg-primary/12">
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

function GatewayOfflineState({
  state,
  error,
  port,
  onStart,
  onOpenSettings,
}: {
  state: string;
  error?: string;
  port: number;
  onStart: () => Promise<void>;
  onOpenSettings: () => void;
}) {
  const { t } = useTranslation('chat');
  const branding = useBranding();
  const [pending, setPending] = useState(false);

  const title = state === 'starting' || state === 'reconnecting'
    ? t('offline.startingTitle')
    : state === 'error'
      ? t('offline.errorTitle')
      : t('offline.stoppedTitle');
  const description = state === 'starting' || state === 'reconnecting'
    ? t('offline.startingDesc', { appName: branding.productName, port })
    : state === 'error'
      ? t('offline.errorDesc', { appName: branding.productName })
      : t('offline.stoppedDesc', { appName: branding.productName, port });

  const handleClick = async () => {
    setPending(true);
    try {
      await onStart();
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="w-full max-w-2xl rounded-[28px] border border-black/8 bg-white/80 px-8 py-10 shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur-sm dark:border-white/10 dark:bg-white/[0.04]">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#eff6ff] text-[#2563eb] dark:bg-[#172554] dark:text-[#93c5fd]">
          {pending || state === 'starting' || state === 'reconnecting' ? (
            <Loader2 className="h-6 w-6 animate-spin" />
          ) : (
            <Sparkles className="h-6 w-6" />
          )}
        </div>

        <div className="mt-6 text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-foreground">{title}</h2>
            <p className="mx-auto mt-3 max-w-xl text-[15px] leading-7 text-foreground/65">
            {description}
          </p>
        </div>

        {error ? (
          <div className="mt-6 rounded-2xl border border-amber-200/70 bg-amber-50 px-4 py-3 text-[13px] text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-100">
            <div className="font-medium">{t('offline.errorDetail')}</div>
            <div className="mt-1 break-words opacity-85">{error}</div>
          </div>
        ) : null}

        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={handleClick}
            disabled={pending || state === 'starting' || state === 'reconnecting'}
            className="rounded-full bg-[#2563eb] px-5 py-2.5 text-[14px] font-medium text-white transition hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {state === 'error' ? t('offline.retry') : t('offline.startNow')}
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
            className="rounded-full border border-black/10 bg-white px-5 py-2.5 text-[14px] font-medium text-foreground/80 transition hover:bg-black/5 dark:border-white/10 dark:bg-white/[0.03] dark:hover:bg-white/[0.06]"
          >
            {t('offline.openSettings')}
          </button>
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
      <div className="bg-black/5 dark:bg-white/5 text-foreground rounded-2xl px-4 py-3">
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

function ProcessActivityIndicator({ streamStyle = false }: { streamStyle?: boolean }) {
  const { t } = useTranslation('chat');
  if (streamStyle) {
    return (
      <div className="flex items-center gap-2 px-1.5 py-1 text-sm text-muted-foreground" data-testid="chat-process-activity-stream">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
        <span>{t('process.workingFor', { duration: '...' })}</span>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-black/6 bg-white/40 px-4 py-3 text-foreground shadow-[0_10px_30px_rgba(15,23,42,0.05)] backdrop-blur-sm dark:border-white/8 dark:bg-white/[0.04]">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
        <span>{t('process.workingFor', { duration: '...' })}</span>
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
      <div className="bg-black/5 dark:bg-white/5 text-foreground rounded-2xl px-4 py-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          <span>Processing tool results…</span>
        </div>
      </div>
    </div>
  );
}

export default Chat;
