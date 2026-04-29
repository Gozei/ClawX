import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useBranding } from '@/lib/branding';
import { getLastChatEventAt } from '@/stores/chat/helpers';
import type { AttachedFileMeta, RawMessage, ToolStatus } from '@/stores/chat';
import type { AssistantMessageStyle, ChatProcessDisplayMode } from '@/stores/settings';
import { ChatMessage } from './ChatMessage';
import { splitFinalMessageForTurnDisplay } from './history-grouping';
import { assistantMessageShowsInChat } from './message-utils';
import { getProcessActivityLabel, ProcessEventMessage, ProcessFinalDivider } from './process-events-next';
import {
  hasVisibleFinalContent,
  hasVisibleProcessContent,
  resolveMessageTimestampMs,
} from './useChatTranscriptModel';
import type { ActiveTurnViewModel } from './transcript-types';

const PROCESS_ACTIVITY_SOFT_STALL_MS = 12_000;
const PROCESS_ACTIVITY_LONG_STALL_MS = 30_000;

type ProcessPhase = 'working' | 'processed';

type AttachmentPreviewHandler = (file: AttachedFileMeta) => void;

type ProcessDisplaySettings = {
  showThinking: boolean;
  chatProcessDisplayMode: ChatProcessDisplayMode;
  assistantMessageStyle: AssistantMessageStyle;
  hideInternalRoutineProcesses: boolean;
};

type ProcessInteractionProps = {
  onProcessSectionExpand?: () => void;
  onOpenAttachmentPreview?: AttachmentPreviewHandler;
  scrollAnchorPrefix: string;
};

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
  scrollAnchorPrefix,
}: ProcessDisplaySettings & {
  processMessages: RawMessage[];
  processStreamingMessage?: RawMessage | null;
  phase: ProcessPhase;
  startedAtMs: number;
  completedAtMs?: number;
  collapsible?: boolean;
  showActivity?: boolean;
  showStatusOnly?: boolean;
  showFinalDivider?: boolean;
  streamingTools?: ToolStatus[];
  onExpandStart?: () => void;
  onOpenAttachmentPreview?: AttachmentPreviewHandler;
  scrollAnchorPrefix?: string;
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
        <div className="min-w-0 flex-1">
          <ProductNameIndicator
            testIdPrefix="chat-process-header-brand"
            className="max-w-full"
          />
        </div>
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
                  scrollAnchorPrefix={scrollAnchorPrefix ? `${scrollAnchorPrefix}:${message.id ?? message.timestamp ?? index}` : undefined}
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

export function CollapsedProcessTurn({
  userMessage,
  intermediateMessages,
  finalMessage,
  showThinking,
  chatProcessDisplayMode,
  assistantMessageStyle,
  hideInternalRoutineProcesses,
  onProcessSectionExpand,
  onOpenAttachmentPreview,
  scrollAnchorPrefix,
}: ProcessDisplaySettings & ProcessInteractionProps & {
  userMessage: RawMessage;
  intermediateMessages: RawMessage[];
  finalMessage: RawMessage;
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
        scrollAnchorPrefix={`${scrollAnchorPrefix}:user`}
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
          scrollAnchorPrefix={`${scrollAnchorPrefix}:process`}
        />
      )}

      {finalHasVisibleContent && (
        <ChatMessage
          message={finalDisplayMessage}
          showThinking={false}
          hideAvatar={hasProcessSection}
          onOpenAttachmentPreview={onOpenAttachmentPreview}
          scrollAnchorPrefix={`${scrollAnchorPrefix}:final`}
        />
      )}

      {!finalHasVisibleContent && !hasProcessSection && (
        <>
          <ChatMessage
            message={finalMessage}
            showThinking={showThinking}
            onOpenAttachmentPreview={onOpenAttachmentPreview}
            scrollAnchorPrefix={`${scrollAnchorPrefix}:final`}
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

export function ActiveTurn({
  turn,
  showThinking,
  chatProcessDisplayMode,
  assistantMessageStyle,
  hideInternalRoutineProcesses,
  onProcessSectionExpand,
  onOpenAttachmentPreview,
  scrollAnchorPrefix,
}: ProcessDisplaySettings & ProcessInteractionProps & {
  turn: ActiveTurnViewModel;
}) {
  const {
    userMessage,
    processMessages,
    processStreamingMessage,
    finalMessage,
    finalStreamingMessage,
    startedAtMs,
    showActivity,
    showTyping,
    streamingTools,
    sending,
  } = turn;
  const liveProcessMessages = sending
    ? [
        ...processMessages,
        ...(finalMessage ? [finalMessage] : []),
      ]
    : processMessages;
  const finalHasVisibleContent = !sending && hasVisibleFinalContent(finalMessage);
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
          scrollAnchorPrefix={`${scrollAnchorPrefix}:user`}
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
          scrollAnchorPrefix={`${scrollAnchorPrefix}:process`}
        />
      )}

      {finalHasVisibleContent && finalMessage && (
        <ChatMessage
          message={finalMessage}
          showThinking={false}
          hideAvatar={hasProcessSection}
          onOpenAttachmentPreview={onOpenAttachmentPreview}
          scrollAnchorPrefix={`${scrollAnchorPrefix}:final`}
        />
      )}

      {showFinalStreamingBubble && (
        <ChatMessage
          message={finalStreamingMessage}
          showThinking={false}
          hideAvatar={hasProcessSection}
          isStreaming={sending}
          onOpenAttachmentPreview={onOpenAttachmentPreview}
          scrollAnchorPrefix={`${scrollAnchorPrefix}:final-streaming`}
        />
      )}

      {!hasProcessSection && !finalHasVisibleContent && !showFinalStreamingBubble && showTyping && (
        <TypingIndicator />
      )}
    </div>
  );
}

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

const TEXT_SCAN_BACKGROUND_IMAGE = 'linear-gradient(90deg, transparent 0%, transparent 32%, rgba(255,255,255,0.72) 44%, rgba(255,255,255,1) 52%, rgba(255,255,255,0.72) 60%, transparent 72%, transparent 100%)';

const PRODUCT_NAME_SCAN_KEYFRAMES = '@keyframes chat-product-scan { 0% { background-position: 172% 50%; opacity: 0.18; } 30% { opacity: 0.58; } 56% { opacity: 1; } 100% { background-position: -72% 50%; opacity: 0.24; } }';

const PRODUCT_NAME_SCAN_STYLE = {
  backgroundImage: TEXT_SCAN_BACKGROUND_IMAGE,
  backgroundRepeat: 'no-repeat',
  backgroundSize: '220% 100%',
  animation: 'chat-product-scan 2.35s cubic-bezier(0.4, 0, 0.2, 1) infinite',
  WebkitTextFillColor: 'transparent',
} satisfies CSSProperties;

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
        <style>{PRODUCT_NAME_SCAN_KEYFRAMES}</style>
      )}
      <span className="relative z-10 inline-flex min-w-0 max-w-full overflow-hidden align-top">
        <span
          data-testid={`${testIdPrefix}-name`}
          className={cn(
            'truncate text-[16px] font-semibold tracking-[0.12em]',
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
            data-testid={`${testIdPrefix}-scan`}
            className="pointer-events-none absolute inset-0 truncate text-[16px] font-semibold tracking-[0.12em] text-transparent [background-clip:text] [-webkit-background-clip:text]"
            style={PRODUCT_NAME_SCAN_STYLE}
          >
            {branding.productName}
          </span>
        )}
      </span>
    </div>
  );
}

function useRotatingProcessActivityCopy() {
  const { t } = useTranslation('chat');
  const activityPhrases = useMemo(() => ([
    t('process.preOutputUnderstanding', 'Understanding the request'),
    t('process.preOutputRetrieving', 'Retrieving context'),
    t('process.preOutputComposing', 'Composing the reply'),
  ]), [t]);
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

const PRE_OUTPUT_STATUS_KEYFRAMES = [
  '@keyframes chat-pre-output-pulse { 0% { transform: scale(0.9); opacity: 0.12; } 55% { opacity: 0.28; } 100% { transform: scale(1.16); opacity: 0; } }',
  '@keyframes chat-pre-output-dot { 0%, 100% { transform: translateY(0); opacity: 0.52; } 50% { transform: translateY(-2px); opacity: 1; } }',
  '@keyframes chat-pre-output-rail { 0% { transform: translateX(-130%); opacity: 0.4; } 45% { opacity: 1; } 100% { transform: translateX(260%); opacity: 0.46; } }',
].join(' ');

const PROCESS_ACTIVITY_SCAN_KEYFRAMES = '@keyframes chat-process-activity-label-scan { 0% { background-position: 172% 50%; opacity: 0.18; } 30% { opacity: 0.58; } 56% { opacity: 1; } 100% { background-position: -72% 50%; opacity: 0.24; } }';

const PROCESS_ACTIVITY_LABEL_SCAN_STYLE = {
  backgroundImage: TEXT_SCAN_BACKGROUND_IMAGE,
  backgroundRepeat: 'no-repeat',
  backgroundSize: '220% 100%',
  animation: 'chat-process-activity-label-scan 2.35s cubic-bezier(0.4, 0, 0.2, 1) infinite',
  WebkitTextFillColor: 'transparent',
} satisfies CSSProperties;

function PreOutputStatusPanel({ testIdPrefix }: { testIdPrefix: string }) {
  const { activePhrase, detailLabel, statusLabel } = useRotatingProcessActivityCopy();

  return (
    <div
      className="w-full max-w-[236px] space-y-1.5"
      data-testid={`${testIdPrefix}-pre-output-panel`}
    >
      <style>{PRE_OUTPUT_STATUS_KEYFRAMES}</style>
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

export function TypingIndicator() {
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
        className="max-w-full overflow-hidden px-1.5 text-[13px] leading-5 text-muted-foreground"
        data-testid="chat-process-activity-copy"
      >
        <span className="relative inline-flex max-w-full overflow-hidden align-top">
          <span
            className="truncate font-medium tracking-normal"
            data-testid="chat-process-activity-label"
          >
            {resolvedLabel}
          </span>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 truncate font-medium tracking-normal text-transparent [background-clip:text] [-webkit-background-clip:text]"
            data-testid="chat-process-activity-label-scan"
            style={PROCESS_ACTIVITY_LABEL_SCAN_STYLE}
          >
            {resolvedLabel}
          </span>
        </span>
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
        <style>{PROCESS_ACTIVITY_SCAN_KEYFRAMES}</style>
        {statusBody}
      </div>
    );
  }

  return (
    <div className="rounded-[22px] border border-black/6 bg-[linear-gradient(180deg,rgba(255,255,255,0.34),rgba(255,255,255,0.18))] px-4 py-3 text-foreground shadow-[0_10px_30px_rgba(15,23,42,0.05)] backdrop-blur-sm dark:border-white/8 dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.025))]">
      <style>{PROCESS_ACTIVITY_SCAN_KEYFRAMES}</style>
      <div className="space-y-2.5">
        {statusBody}
      </div>
    </div>
  );
}

export function ActivityIndicator({ phase }: { phase: 'tool_processing' }) {
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
