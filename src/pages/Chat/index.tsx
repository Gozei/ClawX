/**
 * Chat Page
 * Native React implementation communicating with OpenClaw Gateway
 * via gateway:rpc IPC. Session selector, thinking toggle, and refresh
 * are in the toolbar; messages render with markdown + streaming.
 */
import { lazy, Suspense, type KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ChevronDown, Loader2 } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useChatStore, type AttachedFileMeta, type ChatMessageDispatchOptions, type RawMessage } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { useAgentsStore } from '@/stores/agents';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { ChatToolbarV2 } from './ChatToolbarV2';
import { CHAT_SURFACE_MAX_WIDTH_CLASS } from './layout';
import { ChatTranscriptList } from './ChatTranscriptList';
import { useTranslation } from 'react-i18next';
import { hostApiFetch } from '@/lib/host-api';
import { cn } from '@/lib/utils';
import { useMinLoading } from '@/hooks/use-min-loading';
import { useSettingsStore } from '@/stores/settings';
import { isSessionRunning } from '@/stores/chat/session-running';
import { LibreOfficeDownloadDialog, type LibreOfficeRuntimeStatusPayload } from './LibreOfficeDownloadDialog';
import { toast } from 'sonner';
import { useChatScrollController } from './useChatScrollController';
import { useChatTranscriptModel } from './useChatTranscriptModel';
import { ActiveTurn, ActivityIndicator, CollapsedProcessTurn, TypingIndicator } from './ChatProcessTurn';
import type { ChatListItem, ChatVirtuosoContext } from './transcript-types';

const ChatFilePreviewPanel = lazy(() => import('./ChatFilePreview').then((module) => ({ default: module.ChatFilePreviewPanel })));

const EMPTY_MESSAGES: RawMessage[] = [];
const CHAT_COMPOSER_PREFILL_STATE_KEY = 'composerPrefillText';
const CHAT_PREVIEW_DEFAULT_WIDTH_PERCENT = 50;
const CHAT_PREVIEW_MIN_WIDTH_PERCENT = 16;
const CHAT_PREVIEW_MAX_WIDTH_PERCENT = 84;
const CHAT_PREVIEW_MIN_PANE_WIDTH_PX = 280;
const CHAT_PREVIEW_MIN_MAIN_WIDTH_PX = 280;
const CHAT_PREVIEW_RESIZE_KEY_STEP_PERCENT = 2;
const CHAT_PREVIEW_RESIZE_KEY_LARGE_STEP_PERCENT = 8;
const LIBREOFFICE_BACKED_PREVIEW_EXTENSIONS = new Set(['.pptx', '.docx', '.xlsx', '.xls', '.csv']);

type LibreOfficeDownloadPrompt = {
  file: AttachedFileMeta;
  openPreviewAfterDownload: boolean;
};

type FileExistsPayload = {
  exists?: boolean;
};

function clampPreviewPaneWidth(widthPercent: number, containerWidthPx?: number): number {
  let minPercent = CHAT_PREVIEW_MIN_WIDTH_PERCENT;
  let maxPercent = CHAT_PREVIEW_MAX_WIDTH_PERCENT;

  if (containerWidthPx && Number.isFinite(containerWidthPx) && containerWidthPx > 0) {
    minPercent = Math.max(minPercent, (CHAT_PREVIEW_MIN_PANE_WIDTH_PX / containerWidthPx) * 100);
    maxPercent = Math.min(maxPercent, 100 - ((CHAT_PREVIEW_MIN_MAIN_WIDTH_PX / containerWidthPx) * 100));
  }

  if (minPercent > maxPercent) {
    minPercent = CHAT_PREVIEW_MIN_WIDTH_PERCENT;
    maxPercent = CHAT_PREVIEW_MAX_WIDTH_PERCENT;
  }

  return Math.round(Math.max(minPercent, Math.min(maxPercent, widthPercent)) * 10) / 10;
}

function getAttachmentFileExtension(file: AttachedFileMeta): string {
  const source = file.fileName || file.filePath || '';
  const name = source.split(/[\\/]/).pop() ?? source;
  const dotIndex = name.lastIndexOf('.');
  return dotIndex >= 0 ? name.slice(dotIndex).toLowerCase() : '';
}

function isLibreOfficeBackedPreviewFile(file: AttachedFileMeta): boolean {
  const extension = getAttachmentFileExtension(file);
  if (LIBREOFFICE_BACKED_PREVIEW_EXTENSIONS.has(extension)) {
    return true;
  }

  const mimeType = file.mimeType.toLowerCase();
  return mimeType === 'text/csv'
    || mimeType === 'application/vnd.ms-excel'
    || mimeType.includes('presentationml.presentation')
    || mimeType.includes('wordprocessingml.document')
    || mimeType.includes('spreadsheetml.sheet');
}

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
  const sessionNotice = useChatStore((s) => s.sessionNotice);
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
  const clearSessionFeedback = useChatStore((s) => s.clearSessionFeedback);
  const switchSession = useChatStore((s) => s.switchSession);
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
  const splitPaneRef = useRef<HTMLDivElement | null>(null);
  const previewResizeStartXRef = useRef<number | null>(null);
  const previewResizeStartWidthRef = useRef(CHAT_PREVIEW_DEFAULT_WIDTH_PERCENT);
  const previewAutoCollapsedSidebarRef = useRef(false);
  const previewPaneOpenRef = useRef(false);
  const libreOfficePromptRequestRef = useRef(0);
  const sidebarCollapsedRef = useRef(sidebarCollapsed);
  const hadPreviewOpenRef = useRef(false);
  const [selectedPreviewFile, setSelectedPreviewFile] = useState<AttachedFileMeta | null>(null);
  const [libreOfficeDownloadPrompt, setLibreOfficeDownloadPrompt] = useState<LibreOfficeDownloadPrompt | null>(null);
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
  const sessionBanner = error
    ? { message: error, tone: 'warning' as const }
    : sessionNotice;
  const sessionBannerIsWarning = sessionBanner?.tone !== 'info';
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Visible message count changes must not reload history for the same session.
  }, [currentSessionKey, isGatewayRunning, loadHistory]);

  useEffect(() => {
    restoreAutoCollapsedSidebar();
    setSelectedPreviewFile(null);
    setLibreOfficeDownloadPrompt(null);
  }, [currentSessionKey, restoreAutoCollapsedSidebar]);

  useLayoutEffect(() => {
    const hasPreview = !!selectedPreviewFile;

    if (!hasPreview && hadPreviewOpenRef.current) {
      restoreAutoCollapsedSidebar();
    }

    hadPreviewOpenRef.current = hasPreview;
  }, [restoreAutoCollapsedSidebar, selectedPreviewFile]);

  useEffect(() => {
    const sessionFromSearch = new URLSearchParams(location.search).get('session')?.trim() ?? '';
    if (!sessionFromSearch) return;

    if (sessionFromSearch !== currentSessionKey) {
      switchSession(sessionFromSearch);
    }

    const nextParams = new URLSearchParams(location.search);
    nextParams.delete('session');
    const nextSearch = nextParams.toString();
    navigate(
      {
        pathname: location.pathname,
        search: nextSearch ? `?${nextSearch}` : '',
        hash: location.hash,
      },
      {
        replace: true,
        state: location.state,
      },
    );
  }, [currentSessionKey, location.hash, location.pathname, location.search, location.state, navigate, switchSession]);

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
  const transcriptModel = useChatTranscriptModel({
    currentSessionKey,
    messages: safeMessages,
    activeTurnBuffer,
    streamingMessage: rawStreamingMessage,
    streamingTools,
    sending,
    pendingFinal,
    lastUserMessageAt,
    showThinking,
    chatProcessDisplayMode,
    assistantMessageStyle,
    hideInternalRoutineProcesses,
  });
  const {
    activeTurn,
    chatListItems,
    latestTranscriptActivitySignature,
    scroll: {
      activeTurnScrollKey,
      shouldHideStandaloneStreamingAvatar,
    },
  } = transcriptModel;

  const isEmpty = safeMessages.length === 0 && !sending;
  const showSessionLoadingState = loading && safeMessages.length === 0 && !sending;
  const isZh = (i18n.resolvedLanguage || i18n.language || '').startsWith('zh');
  const {
    activeTurnViewportAnchorRef,
    chatListRef,
    composerShellPadding,
    contentColumnHorizontalOffsetPx,
    handleActiveTurnUserInterrupt,
    handleJumpToLatest,
    hasDetachedNewContent,
    isAtBottom,
    prepareForLocalSend,
    setScrollContainerNode,
    disableOverflowAnchor,
  } = useChatScrollController({
    activeTurnScrollKey,
    chatListItemCount: chatListItems.length,
    currentSessionKey,
    isEmpty,
    latestTranscriptActivitySignature,
    loading,
    sending,
    showSessionLoadingState,
  });
  const jumpToLatestButtonTemporarilyDisabled = true;
  const showScrollToLatestButton = !showSessionLoadingState && !isEmpty && !isAtBottom;
  const scrollToLatestButtonBottomPx = showQueuedMessageCard
    ? 180
    : showQueuedMessageNotice
      ? 124
      : 92;
  const chatListContext = useMemo<ChatVirtuosoContext>(() => ({
    // Let the controller own bottom-following. Native anchoring is only useful
    // after the user detaches from the latest output to read older content.
    disableOverflowAnchor,
    horizontalOffsetPx: contentColumnHorizontalOffsetPx,
    scrollbarGutter: 'stable both-edges',
    setScrollElement: setScrollContainerNode,
  }), [contentColumnHorizontalOffsetPx, disableOverflowAnchor, setScrollContainerNode]);
  const handleEditQueuedDraft = (queuedId: string, text: string) => {
    setComposerPrefill({ text, nonce: Date.now() });
    clearQueuedMessage(currentSessionKey, queuedId);
  };
  const handleSendQueuedDraftNow = (queuedId: string) => {
    if (!isGatewayRunning) return;
    prepareForLocalSend();
    void flushQueuedMessage(currentSessionKey, queuedId);
  };
  const handleSendMessage = useCallback((
    text: string,
    attachments?: Array<{ fileName: string; mimeType: string; fileSize: number; stagedPath: string; preview: string | null }>,
    targetAgentId?: string | null,
    options?: ChatMessageDispatchOptions,
  ) => {
    prepareForLocalSend();
    void sendMessage(text, attachments, targetAgentId, options);
  }, [prepareForLocalSend, sendMessage]);
  const openAttachmentPreviewPane = useCallback((file: AttachedFileMeta) => {
    if (!previewPaneOpenRef.current) {
      previewAutoCollapsedSidebarRef.current = !sidebarCollapsedRef.current;
      if (!sidebarCollapsedRef.current) {
        setSidebarCollapsed(true);
      }
    }
    setSelectedPreviewFile(file);
  }, [setSidebarCollapsed]);

  const handleOpenAttachmentPreview = useCallback((file: AttachedFileMeta) => {
    const requestId = libreOfficePromptRequestRef.current + 1;
    libreOfficePromptRequestRef.current = requestId;

    const openPreview = () => {
      if (!isLibreOfficeBackedPreviewFile(file)) {
        setLibreOfficeDownloadPrompt(null);
        openAttachmentPreviewPane(file);
        return;
      }

      const openPreviewAfterDownload = previewPaneOpenRef.current;
      void hostApiFetch<LibreOfficeRuntimeStatusPayload>('/api/files/libreoffice-runtime/status')
        .then((status) => {
          if (libreOfficePromptRequestRef.current !== requestId) {
            return;
          }

          if (status.available || status.status === 'complete') {
            setLibreOfficeDownloadPrompt(null);
            openAttachmentPreviewPane(file);
            return;
          }

          setLibreOfficeDownloadPrompt({
            file,
            openPreviewAfterDownload,
          });
        })
        .catch(() => {
          if (libreOfficePromptRequestRef.current !== requestId) {
            return;
          }

          setLibreOfficeDownloadPrompt({
            file,
            openPreviewAfterDownload,
          });
        });
    };

    if (!file.filePath) {
      openPreview();
      return;
    }

    void hostApiFetch<FileExistsPayload>('/api/files/exists', {
      method: 'POST',
      body: JSON.stringify({ filePath: file.filePath }),
    })
      .then((result) => {
        if (libreOfficePromptRequestRef.current !== requestId) {
          return;
        }

        if (result.exists === false) {
          setLibreOfficeDownloadPrompt(null);
          toast.error(t('filePreview.fileMissing'));
          return;
        }

        openPreview();
      })
      .catch(() => {
        if (libreOfficePromptRequestRef.current !== requestId) {
          return;
        }
        openPreview();
      });
  }, [openAttachmentPreviewPane, t]);

  const handleLibreOfficePromptComplete = useCallback(() => {
    const prompt = libreOfficeDownloadPrompt;
    setLibreOfficeDownloadPrompt(null);
    if (prompt?.openPreviewAfterDownload && previewPaneOpenRef.current) {
      openAttachmentPreviewPane(prompt.file);
    }
  }, [libreOfficeDownloadPrompt, openAttachmentPreviewPane]);

  const handleLibreOfficePromptCancel = useCallback(() => {
    setLibreOfficeDownloadPrompt(null);
  }, []);

  const handleCloseAttachmentPreview = useCallback(() => {
    restoreAutoCollapsedSidebar();
    setSelectedPreviewFile(null);
  }, [restoreAutoCollapsedSidebar]);

  useLayoutEffect(() => {
    if (!selectedPreviewFile) return;
    const containerWidth = splitPaneRef.current?.getBoundingClientRect().width;
    setPreviewPaneWidthPercent((current) => clampPreviewPaneWidth(current, containerWidth));
  }, [selectedPreviewFile]);

  const resizePreviewPaneBy = useCallback((deltaPercent: number) => {
    if (!selectedPreviewFile) return;
    const containerWidth = splitPaneRef.current?.getBoundingClientRect().width;
    setPreviewPaneWidthPercent((current) => clampPreviewPaneWidth(current + deltaPercent, containerWidth));
  }, [selectedPreviewFile]);

  const resetPreviewPaneWidth = useCallback(() => {
    const containerWidth = splitPaneRef.current?.getBoundingClientRect().width;
    setPreviewPaneWidthPercent(clampPreviewPaneWidth(CHAT_PREVIEW_DEFAULT_WIDTH_PERCENT, containerWidth));
  }, []);

  const handlePreviewResizeKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!selectedPreviewFile || window.innerWidth < 1024) return;

    const step = event.shiftKey
      ? CHAT_PREVIEW_RESIZE_KEY_LARGE_STEP_PERCENT
      : CHAT_PREVIEW_RESIZE_KEY_STEP_PERCENT;

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      resizePreviewPaneBy(step);
      return;
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      resizePreviewPaneBy(-step);
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      const containerWidth = splitPaneRef.current?.getBoundingClientRect().width;
      setPreviewPaneWidthPercent(clampPreviewPaneWidth(CHAT_PREVIEW_MAX_WIDTH_PERCENT, containerWidth));
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      const containerWidth = splitPaneRef.current?.getBoundingClientRect().width;
      setPreviewPaneWidthPercent(clampPreviewPaneWidth(CHAT_PREVIEW_MIN_WIDTH_PERCENT, containerWidth));
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      resetPreviewPaneWidth();
    }
  }, [resetPreviewPaneWidth, resizePreviewPaneBy, selectedPreviewFile]);

  const handlePreviewResizeStart = useCallback((event: { clientX: number; preventDefault: () => void }) => {
    if (!selectedPreviewFile || window.innerWidth < 1024) return;
    event.preventDefault();
    previewResizeStartXRef.current = event.clientX;
    previewResizeStartWidthRef.current = previewPaneWidthPercent;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (previewResizeStartXRef.current == null || !splitPaneRef.current) return;
      const containerWidth = splitPaneRef.current.getBoundingClientRect().width;
      if (!containerWidth) return;

      const deltaX = moveEvent.clientX - previewResizeStartXRef.current;
      const deltaPercent = (deltaX / containerWidth) * 100;
      setPreviewPaneWidthPercent(clampPreviewPaneWidth(previewResizeStartWidthRef.current - deltaPercent, containerWidth));
    };

    const stopResizing = () => {
      previewResizeStartXRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResizing);
      window.removeEventListener('pointercancel', stopResizing);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResizing, { once: true });
    window.addEventListener('pointercancel', stopResizing, { once: true });
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
              scrollAnchorPrefix={item.key}
            />
          );
        }

        return (
          <ChatMessage
            message={item.item.message}
            showThinking={showThinking}
            onOpenAttachmentPreview={handleOpenAttachmentPreview}
            scrollAnchorPrefix={item.key}
          />
        );
      case 'active-turn':
        return activeTurn ? (
          <div ref={activeTurnViewportAnchorRef} data-testid="chat-active-turn-anchor" className="min-w-0">
            <ActiveTurn
              key={activeTurn.userMessage.id || `active-turn-${currentSessionKey}`}
              turn={activeTurn}
              showThinking={showThinking}
              chatProcessDisplayMode={chatProcessDisplayMode}
              assistantMessageStyle={assistantMessageStyle}
              hideInternalRoutineProcesses={hideInternalRoutineProcesses}
              onProcessSectionExpand={handleActiveTurnUserInterrupt}
              onOpenAttachmentPreview={handleOpenAttachmentPreview}
              scrollAnchorPrefix={item.key}
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
            scrollAnchorPrefix={item.key}
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
    activeTurn,
    activeTurnViewportAnchorRef,
    assistantMessageStyle,
    chatProcessDisplayMode,
    currentSessionKey,
    handleActiveTurnUserInterrupt,
    handleOpenAttachmentPreview,
    hideInternalRoutineProcesses,
    sending,
    shouldHideStandaloneStreamingAvatar,
    showThinking,
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

      <ChatTranscriptList
        chatListContext={chatListContext}
        chatListItems={chatListItems}
        chatListRef={chatListRef}
        currentSessionKey={currentSessionKey}
        isEmpty={isEmpty}
        renderItem={renderChatListItem}
        setScrollContainerNode={setScrollContainerNode}
        showSessionLoadingState={showSessionLoadingState}
      />

      {/* Session notice bar */}
      {sessionBanner && (
        <div
          className={cn(
            'border-t px-4 py-2',
            sessionBannerIsWarning
              ? 'border-amber-500/20 bg-amber-500/10'
              : 'border-sky-500/20 bg-sky-500/10',
          )}
          data-testid="chat-session-notice"
          data-notice-tone={sessionBanner.tone}
        >
          <div className={cn(CHAT_SURFACE_MAX_WIDTH_CLASS, 'mx-auto flex items-center justify-between')}>
            <p
              className={cn(
                'flex items-center gap-2 text-sm',
                sessionBannerIsWarning
                  ? 'text-amber-700 dark:text-amber-300'
                  : 'text-sky-700 dark:text-sky-300',
              )}
            >
              {sessionBannerIsWarning ? (
                <AlertCircle className="h-4 w-4" />
              ) : (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              {sessionBanner.message}
            </p>
            <button
              onClick={clearSessionFeedback}
              className={cn(
                'text-xs underline',
                sessionBannerIsWarning
                  ? 'text-amber-700/70 hover:text-amber-700 dark:text-amber-300/70 dark:hover:text-amber-300'
                  : 'text-sky-700/70 hover:text-sky-700 dark:text-sky-300/70 dark:hover:text-sky-300',
              )}
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

      {/* Temporarily hidden until we decide to expose the jump-to-latest affordance. */}
      {!jumpToLatestButtonTemporarilyDisabled && showScrollToLatestButton && (
        <div
          className="pointer-events-none absolute z-20 flex justify-end"
          style={{
            bottom: `${scrollToLatestButtonBottomPx}px`,
            right: `${Math.max(12, composerShellPadding.right)}px`,
          }}
        >
          <button
            type="button"
            onClick={handleJumpToLatest}
            aria-label={hasDetachedNewContent
              ? (isZh ? '有新内容，回到最新' : 'New activity, jump to latest')
              : (isZh ? '回到最新' : 'Back to latest')}
            data-testid="chat-scroll-to-latest"
            className={cn(
              'pointer-events-auto inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium shadow-lg backdrop-blur-md transition hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
              hasDetachedNewContent
                ? 'border-sky-500/30 bg-sky-500/95 text-white hover:bg-sky-500'
                : 'border-border/70 bg-background/92 text-foreground hover:bg-background',
            )}
          >
            <ChevronDown className="h-3.5 w-3.5" />
            <span className="leading-none">
              {hasDetachedNewContent
                ? (isZh ? '新内容' : 'New')
                : (isZh ? '最新' : 'Latest')}
            </span>
            {hasDetachedNewContent ? (
              <span className="inline-flex h-2 w-2 rounded-full bg-white/90" />
            ) : null}
          </button>
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
              aria-valuemin={CHAT_PREVIEW_MIN_WIDTH_PERCENT}
              aria-valuemax={CHAT_PREVIEW_MAX_WIDTH_PERCENT}
              aria-valuenow={Math.round(previewPaneWidthPercent)}
              tabIndex={0}
              onDoubleClick={resetPreviewPaneWidth}
              onKeyDown={handlePreviewResizeKeyDown}
              onPointerDown={handlePreviewResizeStart}
              className="group absolute inset-y-0 z-20 hidden w-5 -translate-x-1/2 cursor-col-resize touch-none outline-none lg:block"
              style={{ left: `${100 - previewPaneWidthPercent}%` }}
            >
              <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-black/8 transition-colors group-hover:bg-primary/45 group-focus-visible:bg-primary/55 dark:bg-white/10 dark:group-hover:bg-primary/55" />
              <div className="absolute left-1/2 top-1/2 h-12 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-transparent transition-colors group-hover:bg-primary/35 group-focus-visible:bg-primary/45" />
            </div>
            <Suspense
              fallback={(
                <aside
                  data-testid="chat-file-preview-panel-loading"
                  className="flex h-full min-h-0 w-full shrink-0 items-center justify-center border-l border-black/6 bg-background/80 dark:border-white/8 lg:flex-none lg:min-w-[16%] lg:max-w-[84%]"
                  style={{
                    width: `${previewPaneWidthPercent}%`,
                    flexBasis: `${previewPaneWidthPercent}%`,
                  }}
                >
                  <Loader2 className="h-6 w-6 animate-spin text-foreground/46" />
                </aside>
              )}
            >
              <ChatFilePreviewPanel
                key={selectedPreviewFile.filePath ?? `${selectedPreviewFile.fileName}:${selectedPreviewFile.mimeType}:${selectedPreviewFile.fileSize}`}
                file={selectedPreviewFile}
                desktopWidthPercent={previewPaneWidthPercent}
                onClose={handleCloseAttachmentPreview}
              />
            </Suspense>
          </>
        ) : null}
      </div>

      {libreOfficeDownloadPrompt ? (
        <LibreOfficeDownloadDialog
          variant="global"
          onCancel={handleLibreOfficePromptCancel}
          onComplete={handleLibreOfficePromptComplete}
        />
      ) : null}
    </div>
  );
}

export default Chat;
