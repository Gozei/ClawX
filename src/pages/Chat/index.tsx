/**
 * Chat Page
 * Native React implementation communicating with OpenClaw Gateway
 * via gateway:rpc IPC. Session selector, thinking toggle, and refresh
 * are in the toolbar; messages render with markdown + streaming.
 */
import { memo, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ListTodo, Loader2, Network, Sparkles, Workflow } from 'lucide-react';
import { useChatStore, type RawMessage } from '@/stores/chat';
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
import { useSettingsStore } from '@/stores/settings';

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
  const streamingMessage = useChatStore((s) => s.streamingMessage);
  const streamingTools = useChatStore((s) => s.streamingTools);
  const pendingFinal = useChatStore((s) => s.pendingFinal);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const abortRun = useChatStore((s) => s.abortRun);
  const clearError = useChatStore((s) => s.clearError);
  const fetchAgents = useAgentsStore((s) => s.fetchAgents);

  const cleanupEmptySession = useChatStore((s) => s.cleanupEmptySession);

  const safeMessages = Array.isArray(messages) ? messages : [];
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
  const shouldRenderStreaming = sending && (hasStreamText || hasStreamThinking || hasStreamTools || hasStreamImages || hasStreamToolStatus);
  const hasAnyStreamContent = hasStreamText || hasStreamThinking || hasStreamTools || hasStreamImages || hasStreamToolStatus;

  const isEmpty = safeMessages.length === 0 && !sending;
  const showGatewayOfflineState = !isGatewayRunning && safeMessages.length === 0 && !sending;

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
          ) : isEmpty ? (
            <WelcomeScreen />
          ) : (
            <>
              <HistoryMessages messages={safeMessages} showThinking={showThinking} />

              {/* Streaming message */}
              {shouldRenderStreaming && (
                <ChatMessage
                  message={(streamMsg
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
                      }) as RawMessage}
                  showThinking={showThinking}
                  isStreaming
                  streamingTools={streamingTools}
                />
              )}

              {/* Activity indicator: waiting for next AI turn after tool execution */}
              {sending && pendingFinal && !shouldRenderStreaming && chatProcessDisplayMode === 'all' && (
                <ActivityIndicator phase="tool_processing" />
              )}

              {/* Typing indicator when sending but no stream content yet */}
              {sending && !pendingFinal && !hasAnyStreamContent && (
                <TypingIndicator />
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

const HistoryMessages = memo(function HistoryMessages({
  messages,
  showThinking,
}: {
  messages: RawMessage[];
  showThinking: boolean;
}) {
  return (
    <>
      {messages.map((msg, idx) => (
        <ChatMessage
          key={msg.id || `msg-${idx}`}
          message={msg}
          showThinking={showThinking}
        />
      ))}
    </>
  );
});

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
