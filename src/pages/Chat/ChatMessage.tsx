/**
 * Chat Message Component
 * Renders user / assistant / system / toolresult messages
 * with markdown, thinking sections, images, and tool cards.
 */
import { useState, useCallback, useEffect, useMemo, useRef, memo, isValidElement, lazy, Suspense, type ReactNode } from 'react';
import { Sparkles, Copy, Check, ChevronDown, ChevronRight, Wrench, X, FolderOpen, ZoomIn, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { FileTypeIcon } from './file-icon';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { invokeIpc } from '@/lib/api-client';
import { useBranding } from '@/lib/branding';
import { hostApiFetch } from '@/lib/host-api';
import { useChatStore, type RawMessage, type AttachedFileMeta } from '@/stores/chat';
import { useProviderStore } from '@/stores/providers';
import { useSettingsStore, type AssistantMessageStyle } from '@/stores/settings';
import type { ProviderAccount } from '@/lib/providers';
import { buildProviderListItems } from '@/lib/provider-accounts';
import { extractText, extractThinking, extractImages, extractToolUse, formatTimestamp, extractAssistantRuntimeErrorText } from './message-utils';
import { StreamingMarkdownPreview } from './StreamingMarkdownPreview';
import type { MarkdownComponents } from './MarkdownRenderer';
import { ClampedFileName } from './ClampedFileName';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

interface ChatMessageProps {
  message: RawMessage;
  showThinking: boolean;
  isStreaming?: boolean;
  hideAvatar?: boolean;
  reserveAvatarSpace?: boolean;
  constrainWidth?: boolean;
  scrollAnchorPrefix?: string;
  onOpenAttachmentPreview?: (file: AttachedFileMeta) => void;
  streamingTools?: Array<{
    id?: string;
    toolCallId?: string;
    name: string;
    status: 'running' | 'retrying' | 'completed' | 'error';
    durationMs?: number;
    summary?: string;
    failureMessage?: string;
  }>;
}

interface ExtractedImage { url?: string; data?: string; mimeType: string; }

const OPENAI_OAUTH_RUNTIME_PROVIDER = 'openai-codex';
const GOOGLE_OAUTH_RUNTIME_PROVIDER = 'google-gemini-cli';
const MarkdownRenderer = lazy(() => import('./MarkdownRenderer').then((module) => ({ default: module.MarkdownRenderer })));

function getRuntimeProviderKey(account: ProviderAccount): string {
  if (account.authMode === 'oauth_browser') {
    if (account.vendorId === 'openai') return OPENAI_OAUTH_RUNTIME_PROVIDER;
    if (account.vendorId === 'google') return GOOGLE_OAUTH_RUNTIME_PROVIDER;
  }
  if (account.vendorId === 'custom' || account.vendorId === 'ollama') {
    const prefix = `${account.vendorId}-`;
    if (account.id.startsWith(prefix)) {
      const suffix = account.id.slice(prefix.length);
      if (suffix.length === 8 && !suffix.includes('-')) {
        return account.id;
      }
    }
    return `${account.vendorId}-${account.id.replace(/-/g, '').slice(0, 8)}`;
  }
  if (account.vendorId === 'minimax-portal-cn') {
    return 'minimax-portal';
  }
  return account.vendorId;
}

const messageSignatureCache = new WeakMap<RawMessage, string>();
const generatedMessageAnchorCache = new WeakMap<RawMessage, string>();
let generatedMessageAnchorId = 0;

function buildMessageSignature(message: RawMessage): string {
  const cached = messageSignatureCache.get(message);
  if (cached) return cached;

  const text = extractText(message);
  const thinking = extractThinking(message) ?? '';
  const images = extractImages(message);
  const tools = extractToolUse(message);
  const attachedFiles = message._attachedFiles ?? [];
  const signature = [
    message.id ?? '',
    message.role,
    message.timestamp ?? '',
    message.provider ?? '',
    message.model ?? '',
    message.modelRef ?? '',
    text,
    thinking,
    images.map((image) => `${image.mimeType}:${image.data.length}`).join(','),
    tools.map((tool) => `${tool.id}:${tool.name}:${JSON.stringify(tool.input)}`).join(','),
    attachedFiles.map((file) => `${file.fileName}:${file.filePath ?? ''}:${file.mimeType}:${file.fileSize}`).join(','),
  ].join('|');

  messageSignatureCache.set(message, signature);
  return signature;
}

function stableHashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function getReactNodeText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'bigint') return String(node);
  if (Array.isArray(node)) return node.map((child) => getReactNodeText(child)).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return getReactNodeText(node.props.children);
  return '';
}

type ChatScrollBlockAnchorProps = {
  'data-chat-scroll-block-anchor': 'true';
  'data-chat-scroll-block-anchor-key': string;
  'data-chat-scroll-block-anchor-type': string;
};

function buildChatMessageAnchorPrefix(message: RawMessage): string {
  const stableIdentity = [
    message.id ?? '',
    message.timestamp ?? '',
    message.provider ?? '',
    message.modelRef ?? message.model ?? '',
  ].filter(Boolean).join(':');
  if (stableIdentity) {
    return `message:${message.role}:${stableIdentity}`;
  }

  const cached = generatedMessageAnchorCache.get(message);
  if (cached) return cached;
  generatedMessageAnchorId += 1;
  const generated = `message:${message.role}:generated-${generatedMessageAnchorId}`;
  generatedMessageAnchorCache.set(message, generated);
  return generated;
}

function createBlockAnchorFactory(anchorPrefix: string) {
  const counters = new Map<string, number>();
  return (blockType: string, children: ReactNode): ChatScrollBlockAnchorProps => {
    const index = counters.get(blockType) ?? 0;
    counters.set(blockType, index + 1);
    const textHash = stableHashString(getReactNodeText(children).slice(0, 512));
    return {
      'data-chat-scroll-block-anchor': 'true',
      'data-chat-scroll-block-anchor-key': `${anchorPrefix}:${blockType}:${index}:${textHash}`,
      'data-chat-scroll-block-anchor-type': blockType,
    };
  };
}

function areStreamingToolsEqual(
  prevTools: ChatMessageProps['streamingTools'] = [],
  nextTools: ChatMessageProps['streamingTools'] = [],
): boolean {
  if (prevTools === nextTools) return true;
  if (prevTools.length !== nextTools.length) return false;
  for (let index = 0; index < prevTools.length; index += 1) {
    const prev = prevTools[index];
    const next = nextTools[index];
    if (
      prev?.id !== next?.id
      || prev?.toolCallId !== next?.toolCallId
      || prev?.name !== next?.name
      || prev?.status !== next?.status
      || prev?.durationMs !== next?.durationMs
      || prev?.summary !== next?.summary
      || prev?.failureMessage !== next?.failureMessage
    ) {
      return false;
    }
  }
  return true;
}

function areChatMessagePropsEqual(prev: ChatMessageProps, next: ChatMessageProps): boolean {
  return prev.showThinking === next.showThinking
    && prev.isStreaming === next.isStreaming
    && prev.hideAvatar === next.hideAvatar
    && prev.reserveAvatarSpace === next.reserveAvatarSpace
    && prev.constrainWidth === next.constrainWidth
    && prev.scrollAnchorPrefix === next.scrollAnchorPrefix
    && prev.onOpenAttachmentPreview === next.onOpenAttachmentPreview
    && buildMessageSignature(prev.message) === buildMessageSignature(next.message)
    && areStreamingToolsEqual(prev.streamingTools, next.streamingTools);
}

/** Resolve an ExtractedImage to a displayable src string, or null if not possible. */
function imageSrc(img: ExtractedImage): string | null {
  if (img.url) return img.url;
  if (img.data) return `data:${img.mimeType};base64,${img.data}`;
  return null;
}

function getMessageModelRef(message: RawMessage): string {
  const directModelRef = typeof message.modelRef === 'string' ? message.modelRef.trim() : '';
  if (directModelRef) {
    return directModelRef;
  }

  const directModel = typeof message.model === 'string' ? message.model.trim() : '';
  if (directModel.includes('/')) {
    return directModel;
  }

  const directProvider = typeof message.provider === 'string' ? message.provider.trim() : '';
  if (directModel && directProvider) {
    return `${directProvider}/${directModel}`;
  }

  const details = message.details && typeof message.details === 'object'
    ? message.details as Record<string, unknown>
    : null;
  const detailModelRef = typeof details?.modelRef === 'string' ? details.modelRef.trim() : '';
  if (detailModelRef) {
    return detailModelRef;
  }

  const detailModel = typeof details?.model === 'string' ? details.model.trim() : '';
  if (detailModel.includes('/')) {
    return detailModel;
  }

  const detailProvider = typeof details?.provider === 'string' ? details.provider.trim() : '';
  if (detailModel && detailProvider) {
    return `${detailProvider}/${detailModel}`;
  }

  return '';
}

export const ChatMessage = memo(function ChatMessage({
  message,
  showThinking,
  isStreaming = false,
  hideAvatar = false,
  reserveAvatarSpace = false,
  constrainWidth = true,
  scrollAnchorPrefix,
  onOpenAttachmentPreview,
  streamingTools = [],
}: ChatMessageProps) {
  const isUser = message.role === 'user';
  const isErrorMessage = !isUser && (message.isError === true || extractAssistantRuntimeErrorText(message).length > 0);
  const role = typeof message.role === 'string' ? message.role.toLowerCase() : '';
  const isToolResult = role === 'toolresult' || role === 'tool_result';
  const text = useMemo(() => extractText(message), [message]);
  const hasText = text.trim().length > 0;
  const thinking = useMemo(() => extractThinking(message), [message]);
  const images = useMemo(() => extractImages(message), [message]);
  const tools = useMemo(() => extractToolUse(message), [message]);
  const chatProcessDisplayMode = useSettingsStore((state) => state.chatProcessDisplayMode);
  const assistantMessageStyle = useSettingsStore((state) => state.assistantMessageStyle);
  const chatFontScale = useSettingsStore((state) => state.chatFontScale);
  const providerAccounts = useProviderStore((state) => state.accounts);
  const providerStatuses = useProviderStore((state) => state.statuses);
  const providerVendors = useProviderStore((state) => state.vendors);
  const providerDefaultAccountId = useProviderStore((state) => state.defaultAccountId);
  const currentSessionKey = useChatStore((state) => state.currentSessionKey);
  const sessionModels = useChatStore((state) => state.sessionModels);
  const sessions = useChatStore((state) => state.sessions);
  const visibleThinking = showThinking ? thinking : null;
  const visibleTools = useMemo(() => (
    chatProcessDisplayMode === 'all' ? tools : []
  ), [chatProcessDisplayMode, tools]);
  const bodyFontSize = `${Math.round(15 * (chatFontScale / 100) * 10) / 10}px`;
  const metaFontSize = `${Math.round(12 * (chatFontScale / 100) * 10) / 10}px`;
  const constrainedMessageWidthClassName = constrainWidth ? 'w-full' : 'w-full max-w-full';
  const attachmentListClassName = cn('flex min-w-0 flex-wrap gap-2', constrainedMessageWidthClassName);
  const mediaListClassName = cn('flex min-w-0 flex-wrap gap-2', constrainedMessageWidthClassName);
  const branding = useBranding();
  const messageAnchorPrefix = useMemo(
    () => scrollAnchorPrefix ?? buildChatMessageAnchorPrefix(message),
    [message, scrollAnchorPrefix],
  );
  const providerItems = useMemo(
    () => buildProviderListItems(providerAccounts, providerStatuses, providerVendors, providerDefaultAccountId),
    [providerAccounts, providerDefaultAccountId, providerStatuses, providerVendors],
  );
  const modelOptions = useMemo(() => (
    providerItems.flatMap((item) => {
      const runtimeProviderKey = getRuntimeProviderKey(item.account);
      return item.models
        .filter((model) => model.source !== 'recommended')
        .slice()
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((model) => ({
          value: `${runtimeProviderKey}/${model.id}`,
          label: `${item.displayName} / ${model.id}`,
        }));
    })
  ), [providerItems]);
  const messageModelRef = useMemo(
    () => getMessageModelRef(message),
    [message],
  );
  const fallbackSessionModelRef = useMemo(() => {
    if (isUser || !currentSessionKey) return '';
    const sessionModelRef = sessionModels?.[currentSessionKey]?.trim();
    if (sessionModelRef) {
      return sessionModelRef;
    }
    const matchedSessionModel = sessions?.find((session) => session.key === currentSessionKey)?.model?.trim();
    return matchedSessionModel || '';
  }, [currentSessionKey, isUser, sessionModels, sessions]);
  const effectiveModelRef = messageModelRef || fallbackSessionModelRef;
  const currentModelLabel = useMemo(
    () => modelOptions.find((option) => option.value === effectiveModelRef)?.label || effectiveModelRef,
    [effectiveModelRef, modelOptions],
  );

  const attachedFiles = useMemo(() => {
    const files = message._attachedFiles || [];
    if (isUser) return files;
    return files.filter((file) => file.preview || file.fileSize > 0);
  }, [isUser, message._attachedFiles]);
  const [lightboxImg, setLightboxImg] = useState<{ src: string; fileName: string; filePath?: string; base64?: string; mimeType?: string } | null>(null);
  const getAttachmentPreviewHandler = useCallback((file: AttachedFileMeta) => {
    if (onOpenAttachmentPreview) {
      return () => onOpenAttachmentPreview(file);
    }
    if (file.preview && file.mimeType.startsWith('image/')) {
      return () => setLightboxImg({
        src: file.preview!,
        fileName: file.fileName,
        filePath: file.filePath,
        mimeType: file.mimeType,
      });
    }
    return undefined;
  }, [onOpenAttachmentPreview, setLightboxImg]);

  // Never render tool result messages in chat UI
  if (isToolResult) return null;

  const shouldShowStreamingToolStatus = isStreaming
    && chatProcessDisplayMode === 'all'
    && assistantMessageStyle === 'bubble'
    && streamingTools.length > 0;
  if (!hasText && !visibleThinking && images.length === 0 && visibleTools.length === 0 && attachedFiles.length === 0 && !shouldShowStreamingToolStatus) return null;
  const showsAssistantBrandHeader = !isUser && !hideAvatar;

  if (showsAssistantBrandHeader) {
    return (
      <div
        data-testid="chat-assistant-message-shell"
        className={cn('group min-w-0 space-y-3.5', constrainedMessageWidthClassName)}
      >
        <div
          data-testid="chat-assistant-brand-header"
          className="flex w-full min-w-0 items-center gap-3"
        >
          <div
            data-testid="chat-assistant-avatar"
            className={cn(
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
              isErrorMessage
                ? 'bg-destructive/10 text-destructive'
                : 'bg-black/5 dark:bg-white/5 text-foreground',
            )}
          >
            {isErrorMessage ? <AlertCircle className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
          </div>
          <div className="min-w-0 flex-1">
            <span
              data-testid="chat-assistant-brand-name"
              className="block truncate text-[16px] font-semibold tracking-[0.12em] text-foreground/90 dark:text-foreground/92"
            >
              {branding.productName}
            </span>
          </div>
        </div>

        <div
          data-testid="chat-message-content-assistant"
          className={cn(
            'flex min-w-0 flex-col items-start space-y-2.5',
            constrainedMessageWidthClassName,
          )}
        >
          {shouldShowStreamingToolStatus && (
            <ToolStatusBar tools={streamingTools} />
          )}

          {visibleThinking && (
            <ThinkingBlock content={visibleThinking} />
          )}

          {visibleTools.length > 0 && (
            <div className="w-full space-y-1">
              {visibleTools.map((tool, i) => (
                <ToolCard key={tool.id || i} name={tool.name} input={tool.input} />
              ))}
            </div>
          )}

          {hasText && (
            <MessageBubble
              text={text}
              isUser={false}
              isError={isErrorMessage}
              isStreaming={isStreaming}
              fontSize={bodyFontSize}
              assistantMessageStyle={assistantMessageStyle}
              anchorPrefix={messageAnchorPrefix}
            />
          )}

          {images.length > 0 && (
            <div className={cn(mediaListClassName, 'self-start justify-start')}>
              {images.map((img, i) => {
                const src = imageSrc(img);
                if (!src) return null;
                return (
                  <ImagePreviewCard
                    key={`content-${i}`}
                    src={src}
                    fileName="image"
                    base64={img.data}
                    mimeType={img.mimeType}
                    onPreview={() => setLightboxImg({ src, fileName: 'image', base64: img.data, mimeType: img.mimeType })}
                  />
                );
              })}
            </div>
          )}

          {attachedFiles.length > 0 && (
            <div
              data-testid="chat-assistant-attachments"
              className={cn(attachmentListClassName, 'self-start justify-start')}
            >
              {attachedFiles.map((file, i) => (
                <FileCard
                  key={`local-${i}`}
                  file={file}
                  onPreview={getAttachmentPreviewHandler(file)}
                />
              ))}
            </div>
          )}

          {hasText && (
            <MessageMetaBar
              text={text}
              timestamp={message.timestamp}
              metaFontSize={metaFontSize}
              messageType="assistant"
              modelLabel={currentModelLabel}
            />
          )}
        </div>

        {lightboxImg && (
          <ImageLightbox
            src={lightboxImg.src}
            fileName={lightboxImg.fileName}
            filePath={lightboxImg.filePath}
            base64={lightboxImg.base64}
            mimeType={lightboxImg.mimeType}
            onClose={() => setLightboxImg(null)}
          />
        )}
      </div>
    );
  }

  return (
    <div
      data-testid={isUser ? 'chat-message-row-user' : 'chat-message-row-assistant'}
      className={cn(
        'group flex min-w-0 gap-3',
        constrainedMessageWidthClassName,
        isUser ? 'flex-row-reverse' : 'flex-row',
      )}
    >
      {/* Avatar */}
      {!isUser && (!hideAvatar || reserveAvatarSpace) && (
        <div
          data-testid={hideAvatar ? undefined : 'chat-assistant-avatar'}
          aria-hidden={hideAvatar ? 'true' : undefined}
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-full mt-1',
            hideAvatar
              ? 'opacity-0 pointer-events-none'
              : isErrorMessage
                ? 'bg-destructive/10 text-destructive'
                : 'bg-black/5 dark:bg-white/5 text-foreground',
          )}
        >
          {!hideAvatar && (isErrorMessage ? <AlertCircle className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />)}
        </div>
      )}

      {/* Content */}
      <div
        data-testid={isUser ? 'chat-message-content-user' : 'chat-message-content-assistant'}
        className={cn(
          'flex flex-col min-w-0',
          !isUser && showsAssistantBrandHeader ? 'space-y-2.5' : 'space-y-2',
          constrainedMessageWidthClassName,
          isUser ? 'items-end' : 'items-start',
        )}
        style={!isUser && showsAssistantBrandHeader
          ? { marginLeft: '-44px', width: 'calc(100% + 44px)' }
          : undefined}
      >
        {showsAssistantBrandHeader && (
          <div
            data-testid="chat-assistant-brand-header"
            className="ml-11 flex w-full min-w-0 items-center"
          >
            <span
              data-testid="chat-assistant-brand-name"
              className="truncate text-[16px] font-semibold tracking-[0.12em] text-foreground/90 dark:text-foreground/92"
            >
              {branding.productName}
            </span>
          </div>
        )}

        {shouldShowStreamingToolStatus && !isUser && (
          <ToolStatusBar tools={streamingTools} />
        )}

        {/* Thinking section */}
        {visibleThinking && (
          <ThinkingBlock content={visibleThinking} />
        )}

        {/* Tool use cards */}
        {visibleTools.length > 0 && (
          <div className="w-full space-y-1">
            {visibleTools.map((tool, i) => (
              <ToolCard key={tool.id || i} name={tool.name} input={tool.input} />
            ))}
          </div>
        )}

        {/* Images — rendered ABOVE text bubble for user messages */}
        {/* Images from content blocks (Gateway session data / channel push photos) */}
        {isUser && images.length > 0 && (
          <div className={cn(mediaListClassName, 'self-end justify-end')}>
            {images.map((img, i) => {
              const src = imageSrc(img);
              if (!src) return null;
              return (
                <ImageThumbnail
                  key={`content-${i}`}
                  src={src}
                  fileName="image"
                  base64={img.data}
                  mimeType={img.mimeType}
                  onPreview={() => setLightboxImg({ src, fileName: 'image', base64: img.data, mimeType: img.mimeType })}
                />
              );
            })}
          </div>
        )}

        {/* File attachments */}
        {isUser && attachedFiles.length > 0 && (
          <div
            data-testid="chat-user-attachments"
            className={cn(attachmentListClassName, 'self-end justify-end')}
          >
            {attachedFiles.map((file, i) => (
              <FileCard
                key={`local-${i}`}
                file={file}
                onPreview={getAttachmentPreviewHandler(file)}
              />
            ))}
          </div>
        )}

        {/* Main text bubble */}
        {hasText && (
          <MessageBubble
            text={text}
            isUser={isUser}
            isError={isErrorMessage}
            isStreaming={isStreaming}
            fontSize={bodyFontSize}
            assistantMessageStyle={assistantMessageStyle}
            anchorPrefix={messageAnchorPrefix}
          />
        )}

        {/* Images from content blocks — assistant messages (below text) */}
        {!isUser && images.length > 0 && (
          <div className={cn(mediaListClassName, 'self-start justify-start')}>
            {images.map((img, i) => {
              const src = imageSrc(img);
              if (!src) return null;
              return (
                <ImagePreviewCard
                  key={`content-${i}`}
                  src={src}
                  fileName="image"
                  base64={img.data}
                  mimeType={img.mimeType}
                  onPreview={() => setLightboxImg({ src, fileName: 'image', base64: img.data, mimeType: img.mimeType })}
                />
              );
            })}
          </div>
        )}

        {/* File attachments — assistant messages (below text) */}
        {!isUser && attachedFiles.length > 0 && (
          <div
            data-testid="chat-assistant-attachments"
            className={cn(attachmentListClassName, 'self-start justify-start')}
          >
            {attachedFiles.map((file, i) => (
              <FileCard
                key={`local-${i}`}
                file={file}
                onPreview={getAttachmentPreviewHandler(file)}
              />
            ))}
          </div>
        )}

        {/* Metadata row — show timestamp + copy action for text messages */}
        {hasText && (
          <MessageMetaBar
            text={text}
            timestamp={message.timestamp}
            metaFontSize={metaFontSize}
            messageType={isUser ? 'user' : 'assistant'}
            modelLabel={!isUser ? currentModelLabel : undefined}
          />
        )}
      </div>

      {/* Image lightbox portal */}
      {lightboxImg && (
        <ImageLightbox
          src={lightboxImg.src}
          fileName={lightboxImg.fileName}
          filePath={lightboxImg.filePath}
          base64={lightboxImg.base64}
          mimeType={lightboxImg.mimeType}
          onClose={() => setLightboxImg(null)}
        />
      )}
    </div>
  );
}, areChatMessagePropsEqual);

function formatDuration(durationMs?: number): string | null {
  if (!durationMs || !Number.isFinite(durationMs)) return null;
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

const ToolStatusBar = memo(function ToolStatusBar({
  tools,
}: {
  tools: Array<{
    id?: string;
    toolCallId?: string;
    name: string;
    status: 'running' | 'retrying' | 'completed' | 'error';
    durationMs?: number;
    summary?: string;
    failureMessage?: string;
  }>;
}) {
  return (
    <div data-testid="chat-tool-status-bar" className="w-full space-y-1">
      {tools.map((tool) => {
        const duration = formatDuration(tool.durationMs);
        const isRunning = tool.status === 'running';
        const isRetrying = tool.status === 'retrying';
        const isError = tool.status === 'error';
        return (
          <div
            key={tool.toolCallId || tool.id || tool.name}
            data-testid="chat-tool-status-pill"
            className={cn(
              'flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-colors',
              isRunning && 'border-primary/30 bg-primary/5 text-foreground',
              isRetrying && 'border-amber-500/30 bg-amber-500/8 text-amber-700 dark:text-amber-300',
              !isRunning && !isRetrying && !isError && 'border-border/50 bg-muted/20 text-muted-foreground',
              isError && 'border-destructive/30 bg-destructive/5 text-destructive',
            )}
          >
            {isRunning && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />}
            {isRetrying && <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-600 dark:text-amber-300 shrink-0" />}
            {!isRunning && !isRetrying && !isError && <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />}
            {isError && <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0" />}
            <Wrench className="h-3 w-3 shrink-0 opacity-60" />
            <span className="font-mono text-[12px] font-medium">{tool.name}</span>
            {duration && <span className="text-[11px] opacity-60">{tool.summary ? `(${duration})` : duration}</span>}
            {(tool.failureMessage || tool.summary) && (
              <span className="truncate text-[11px] opacity-70">{tool.failureMessage || tool.summary}</span>
            )}
          </div>
        );
      })}
    </div>
  );
});

// ── Message metadata bar (timestamp + copy) ──

const MessageMetaBar = memo(function MessageMetaBar({
  text,
  timestamp,
  metaFontSize,
  messageType,
  modelLabel,
}: {
  text: string;
  timestamp?: number;
  metaFontSize: string;
  messageType: 'user' | 'assistant';
  modelLabel?: string;
}) {
  const [copied, setCopied] = useState(false);
  const isAssistant = messageType === 'assistant';

  const copyContent = useCallback(() => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <div
      data-testid={`chat-message-meta-${messageType}`}
      className={cn(
        'flex items-center gap-2 select-none text-muted-foreground',
        !isAssistant && 'invisible pointer-events-none opacity-0 transition-opacity duration-150 group-hover:visible group-hover:pointer-events-auto group-hover:opacity-100',
        isAssistant ? 'self-start' : 'self-end',
      )}
    >
      {isAssistant ? (
        <>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 bg-transparent shadow-none hover:bg-transparent hover:shadow-none"
            onClick={copyContent}
            data-testid={`chat-message-copy-${messageType}`}
          >
            {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
          </Button>
          {timestamp ? (
            <span className="text-muted-foreground whitespace-nowrap" style={{ fontSize: metaFontSize }}>
              {formatTimestamp(timestamp)}
            </span>
          ) : null}
          {modelLabel ? (
            <span
              data-testid="chat-message-model-label"
              className="max-w-[260px] truncate text-muted-foreground/85"
              style={{ fontSize: metaFontSize }}
              title={modelLabel}
            >
              {modelLabel}
            </span>
          ) : null}
        </>
      ) : (
        <>
          {timestamp ? (
            <span className="text-muted-foreground whitespace-nowrap" style={{ fontSize: metaFontSize }}>
              {formatTimestamp(timestamp)}
            </span>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 bg-transparent shadow-none hover:bg-transparent hover:shadow-none"
            onClick={copyContent}
            data-testid={`chat-message-copy-${messageType}`}
          >
            {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
          </Button>
        </>
      )}
    </div>
  );
});

function createMarkdownComponentOverrides(
  getAnchorProps?: (blockType: string, children: ReactNode) => ChatScrollBlockAnchorProps,
): MarkdownComponents {
  const flattenReactNodeText = (node: ReactNode): string => {
    if (node == null || typeof node === 'boolean') return '';
    if (typeof node === 'string' || typeof node === 'number' || typeof node === 'bigint') return String(node);
    if (Array.isArray(node)) return node.map((child) => flattenReactNodeText(child)).join('');
    if (isValidElement<{ children?: ReactNode }>(node)) return flattenReactNodeText(node.props.children);
    return '';
  };

  const normalizeInlineCodeDisplay = (node: ReactNode): ReactNode => {
    const text = flattenReactNodeText(node);
    const trimmed = text.trim();
    const matched = trimmed.match(/^`+([\s\S]*?)`+$/);
    return matched ? matched[1] : text;
  };

  const buildAnchor = (blockType: string, children: ReactNode) => (
    getAnchorProps ? getAnchorProps(blockType, children) : {}
  );

  return {
    code({ className, children, ...props }) {
      const inferredLanguage = /language-(\w+)/.exec(className || '');
      const textContent = Array.isArray(children) ? children.join('') : String(children ?? '');
      const isInline = !inferredLanguage && !textContent.includes('\n');

      if (isInline) {
        return (
          <code
            className="rounded bg-slate-200/80 px-1.5 py-0.5 text-sm font-[var(--font-ui)] text-slate-800 break-words [overflow-wrap:anywhere] dark:bg-slate-700/40 dark:text-slate-100"
            {...props}
          >
            {normalizeInlineCodeDisplay(children)}
          </code>
        );
      }

      return (
        <pre
          className="max-w-full overflow-x-auto rounded-lg border border-slate-300/70 bg-slate-200/85 p-4 text-slate-800 shadow-sm dark:border-slate-600/60 dark:bg-slate-800/45 dark:text-slate-100"
          {...buildAnchor('code', children)}
        >
          <code className={cn('text-sm font-[var(--font-ui)] text-inherit', className)} {...props}>
            {children}
          </code>
        </pre>
      );
    },
    pre({ children }) {
      // react-markdown 默认会再包一层 <pre>，这里透传避免双层背景
      return <>{children}</>;
    },
    blockquote({ children, node: _node, ...props }) {
      return (
        <blockquote {...props} {...buildAnchor('blockquote', children)}>
          {children}
        </blockquote>
      );
    },
    h1({ children, node: _node, ...props }) {
      return (
        <h1 {...props} {...buildAnchor('heading-1', children)}>
          {children}
        </h1>
      );
    },
    h2({ children, node: _node, ...props }) {
      return (
        <h2 {...props} {...buildAnchor('heading-2', children)}>
          {children}
        </h2>
      );
    },
    h3({ children, node: _node, ...props }) {
      return (
        <h3 {...props} {...buildAnchor('heading-3', children)}>
          {children}
        </h3>
      );
    },
    h4({ children, node: _node, ...props }) {
      return (
        <h4 {...props} {...buildAnchor('heading-4', children)}>
          {children}
        </h4>
      );
    },
    h5({ children, node: _node, ...props }) {
      return (
        <h5 {...props} {...buildAnchor('heading-5', children)}>
          {children}
        </h5>
      );
    },
    h6({ children, node: _node, ...props }) {
      return (
        <h6 {...props} {...buildAnchor('heading-6', children)}>
          {children}
        </h6>
      );
    },
    li({ children, node: _node, ...props }) {
      return (
        <li {...props} {...buildAnchor('list-item', children)}>
          {children}
        </li>
      );
    },
    p({ children, node: _node, ...props }) {
      return (
        <p {...props} {...buildAnchor('paragraph', children)}>
          {children}
        </p>
      );
    },
    a({ href, children }) {
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" className="break-words text-primary hover:underline [overflow-wrap:anywhere]">
          {children}
        </a>
      );
    },
  };
}

// ── Message Bubble ──────────────────────────────────────────────

const MessageBubble = memo(function MessageBubble({
  text,
  isUser,
  isError,
  isStreaming,
  fontSize,
  assistantMessageStyle,
  anchorPrefix,
}: {
  text: string;
  isUser: boolean;
  isError: boolean;
  isStreaming: boolean;
  fontSize: string;
  assistantMessageStyle: AssistantMessageStyle;
  anchorPrefix: string;
}) {
  const usesAssistantStreamStyle = !isUser && assistantMessageStyle === 'stream';
  const createBlockAnchorProps = createBlockAnchorFactory(anchorPrefix);
  const markdownComponents = useMemo(
    () => createMarkdownComponentOverrides(createBlockAnchorProps),
    [createBlockAnchorProps],
  );

  return (
    <div
      data-testid={!isUser ? (isError ? 'chat-assistant-error-message' : `chat-assistant-message-${assistantMessageStyle}`) : undefined}
      className={cn(
        'relative min-w-0 max-w-full',
        usesAssistantStreamStyle ? 'w-full px-1 py-0.5' : 'rounded-[16px] px-4 py-3.5',
        !isUser && !usesAssistantStreamStyle && 'w-full',
        isUser
          ? 'bg-[linear-gradient(135deg,#4f8df7_0%,#2f6fe4_100%)] text-white shadow-[0_12px_28px_rgba(47,111,228,0.24)]'
          : isError
            ? 'border border-destructive/25 bg-destructive/8 text-destructive shadow-[0_10px_30px_rgba(220,38,38,0.08)]'
          : usesAssistantStreamStyle
            ? 'bg-transparent text-foreground'
            : 'border border-black/6 bg-white/54 text-foreground shadow-[0_10px_30px_rgba(15,23,42,0.06)] backdrop-blur-sm dark:border-white/8 dark:bg-white/[0.045]',
      )}
    >
      {isUser ? (
        <p
          className="min-w-0 whitespace-pre-wrap break-words leading-[1.82] [overflow-wrap:anywhere]"
          style={{ fontSize }}
          {...createBlockAnchorProps('user-paragraph', text)}
        >
          {text}
        </p>
      ) : isStreaming ? (
        <div className={cn('min-w-0 max-w-full', usesAssistantStreamStyle && 'max-w-none')} style={{ fontSize }}>
          <StreamingMarkdownPreview
            anchorPrefix={`${anchorPrefix}:stream`}
            content={text}
            trailingCursor
            className={cn(
              usesAssistantStreamStyle
                ? 'min-w-0 max-w-full space-y-2.5 text-[0.985em] text-foreground/94'
                : 'min-w-0 max-w-full space-y-2 text-[0.97em] text-foreground/92',
            )}
          />
        </div>
      ) : (
        <div className={cn('chat-markdown prose prose-sm dark:prose-invert min-w-0 max-w-none break-words leading-[1.82]', usesAssistantStreamStyle && '[&>*]:my-3 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0')} style={{ fontSize }}>
          <Suspense
            fallback={(
              <StreamingMarkdownPreview
                anchorPrefix={`${anchorPrefix}:markdown-loading`}
                content={text}
              />
            )}
          >
            <MarkdownRenderer
              content={text}
              components={markdownComponents}
            />
          </Suspense>
        </div>
      )}

    </div>
  );
});

// ── Thinking Block ──────────────────────────────────────────────

const ThinkingBlock = memo(function ThinkingBlock({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);
  const preview = content.replace(/\s+/g, ' ').trim();
  const summary = preview.length > 84 ? `${preview.slice(0, 81)}...` : preview;
  const markdownComponents = useMemo(
    () => createMarkdownComponentOverrides(),
    [],
  );

  return (
    <div className="w-full min-w-0 rounded-lg border border-black/10 bg-black/5 text-[14px] dark:border-white/10 dark:bg-white/5">
      <button
        className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-muted-foreground transition-colors hover:text-foreground"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <span className="font-medium">思考过程</span>
        {!expanded && summary ? (
          <span className="truncate text-[12px] text-muted-foreground/80">{summary}</span>
        ) : null}
      </button>
      {expanded && (
        <div className="min-w-0 px-3 pb-3 text-muted-foreground">
          <div className="chat-markdown prose prose-sm dark:prose-invert min-w-0 max-w-none opacity-75">
            <Suspense fallback={<StreamingMarkdownPreview content={content} />}>
              <MarkdownRenderer content={content} components={markdownComponents} />
            </Suspense>
          </div>
        </div>
      )}
    </div>
  );
});

// ── File Card (for user-uploaded non-image files) ───────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

type SaveFileResult = {
  success?: boolean;
  savedPath?: string;
  error?: string;
};

const FILE_CONTEXT_MENU_WIDTH = 176;
const FILE_CONTEXT_MENU_HEIGHT = 104;

function isMissingFileShellResult(result: unknown): boolean {
  if (typeof result !== 'string' || !result.trim()) {
    return false;
  }
  const normalized = result.trim().toLowerCase();
  return normalized.includes('file not found:')
    || normalized.includes('does not exist')
    || normalized.includes('not found')
    || normalized.includes('no such file');
}

function resolveFileContextMenuPosition(clientX: number, clientY: number): { left: number; top: number } {
  if (typeof window === 'undefined') {
    return { left: clientX, top: clientY };
  }

  const maxLeft = Math.max(12, window.innerWidth - FILE_CONTEXT_MENU_WIDTH - 12);
  const maxTop = Math.max(12, window.innerHeight - FILE_CONTEXT_MENU_HEIGHT - 12);

  return {
    left: Math.max(12, Math.min(clientX, maxLeft)),
    top: Math.max(12, Math.min(clientY, maxTop)),
  };
}

function FileCard({ file, onPreview }: { file: AttachedFileMeta; onPreview?: () => void }) {
  const { t } = useTranslation(['chat', 'common']);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const closeContextMenu = useCallback(() => {
    setContextMenuPosition(null);
  }, []);

  const handleOpen = useCallback(async () => {
    if (contextMenuPosition) {
      closeContextMenu();
      return;
    }

    if (onPreview) {
      onPreview();
      return;
    }
    if (file.filePath) {
      try {
        const result = await invokeIpc<string>('shell:openPath', file.filePath);
        if (typeof result === 'string' && result.trim()) {
          if (isMissingFileShellResult(result)) {
            toast.error(t('attachments.fileMissing', { fileName: file.fileName }));
            return;
          }
          toast.error(t('attachments.fileOpenFailed', {
            fileName: file.fileName,
            error: result.trim(),
          }));
        }
      } catch (error) {
        toast.error(t('attachments.fileOpenFailed', {
          fileName: file.fileName,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    }
  }, [closeContextMenu, contextMenuPosition, file.fileName, file.filePath, onPreview, t]);

  const handleRevealInFolder = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!file.filePath) return;
    closeContextMenu();
    void invokeIpc<string>('shell:showItemInFolder', file.filePath)
      .then((result) => {
        if (isMissingFileShellResult(result)) {
          toast.error(t('filePreview.fileMissing'));
        }
      })
      .catch((revealError) => {
        toast.error(t('filePreview.revealFailed', {
          error: revealError instanceof Error ? revealError.message : String(revealError),
        }));
      });
  }, [closeContextMenu, file.filePath, t]);

  const handleContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!file.filePath) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setContextMenuPosition(resolveFileContextMenuPosition(event.clientX, event.clientY));
  }, [file.filePath]);

  const handleSaveAs = useCallback(async () => {
    if (!file.filePath) return;
    closeContextMenu();
    try {
      const result = await hostApiFetch<SaveFileResult>('/api/files/save-file', {
        method: 'POST',
        body: JSON.stringify({
          defaultFileName: file.fileName,
          filePath: file.filePath,
          mimeType: file.mimeType,
        }),
      });
      if (result?.success) {
        toast.success(t('filePreview.downloadSuccess'));
        return;
      }
      if (!result?.error) {
        return;
      }
      toast.error(t('filePreview.downloadFailed', { error: result.error }));
    } catch (error) {
      toast.error(t('filePreview.downloadFailed', {
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }, [closeContextMenu, file.fileName, file.filePath, file.mimeType, t]);

  const handleOpenWith = useCallback(async () => {
    if (!file.filePath) return;
    closeContextMenu();
    try {
      const result = await invokeIpc<string>('shell:openWith', file.filePath);
      if (!result || !result.trim()) {
        return;
      }
      if (isMissingFileShellResult(result)) {
        toast.error(t('attachments.fileMissing', { fileName: file.fileName }));
        return;
      }
      toast.error(t('filePreview.openWithFailed', { error: result.trim() }));
    } catch (error) {
      toast.error(t('filePreview.openWithFailed', {
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }, [closeContextMenu, file.fileName, file.filePath, t]);

  useEffect(() => {
    if (!contextMenuPosition) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        closeContextMenu();
        return;
      }
      if (menuRef.current?.contains(target) || cardRef.current?.contains(target)) {
        return;
      }
      closeContextMenu();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeContextMenu();
      }
    };

    const handleBlur = () => {
      closeContextMenu();
    };

    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('blur', handleBlur);
    };
  }, [closeContextMenu, contextMenuPosition]);

  return (
    <div
      ref={cardRef}
      data-testid="chat-file-card"
      className={cn(
        "group/file-card relative w-[224px] max-w-full min-w-0 overflow-hidden rounded-xl border border-black/10 bg-white/80 shadow-[0_14px_34px_rgba(15,23,42,0.08)] backdrop-blur-sm dark:border-white/10 dark:bg-white/[0.06]",
        (file.filePath || onPreview) && "cursor-pointer hover:border-black/15 hover:bg-white dark:hover:border-white/15 dark:hover:bg-white/[0.08] transition-colors"
      )}
      onClick={handleOpen}
      onContextMenu={handleContextMenu}
      aria-label={file.filePath ? t('filePreview.openFile') : undefined}
    >
      <div data-testid="chat-file-card-body" className="relative flex h-14 min-w-0 items-center gap-3 px-3">
        <FileTypeIcon mimeType={file.mimeType} fileName={file.fileName} />
        <div className="min-w-0 flex-1 overflow-hidden leading-tight flex flex-col justify-center">
          <ClampedFileName
            text={file.fileName}
            metaText={file.fileSize > 0 ? formatFileSize(file.fileSize) : ''}
            collapseToSingleLine
            containerClassName="h-8"
            textClassName="text-[13px] font-semibold leading-[1.25] tracking-[-0.01em]"
            metaClassName="text-[11px] leading-[1.25]"
            fadeTestId="chat-file-card-fade"
            textTestId="chat-file-card-name"
          />
        </div>
        {file.filePath ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                data-testid="chat-file-card-reveal"
                className="pointer-events-none absolute right-3 top-1/2 h-8 w-8 -translate-y-1/2 translate-x-1 rounded-[8px] border border-slate-300 bg-white text-slate-700 opacity-0 shadow-none transition-all duration-150 hover:bg-white hover:text-slate-700 group-hover/file-card:pointer-events-auto group-hover/file-card:translate-x-0 group-hover/file-card:opacity-100 group-focus-within/file-card:pointer-events-auto group-focus-within/file-card:translate-x-0 group-focus-within/file-card:opacity-100 dark:border-white/14 dark:bg-slate-100 dark:text-slate-800 dark:hover:bg-slate-100 dark:hover:text-slate-800"
                onClick={handleRevealInFolder}
                aria-label={t('filePreview.revealInFolder')}
              >
                <FolderOpen className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" data-testid="chat-file-card-reveal-tooltip">
              {t('filePreview.revealInFolder')}
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      {contextMenuPosition ? createPortal(
        <div
          ref={menuRef}
          data-testid="chat-file-card-context-menu"
          role="menu"
          className="fixed z-[220] min-w-[176px] overflow-hidden rounded-xl border border-black/10 bg-white p-1.5 shadow-xl dark:border-white/10 dark:bg-card"
          style={{
            left: `${contextMenuPosition.left}px`,
            top: `${contextMenuPosition.top}px`,
          }}
        >
          <button
            type="button"
            role="menuitem"
            data-testid="chat-file-card-context-save"
            className="flex w-full items-center rounded-[10px] px-3 py-2 text-left text-[13px] font-medium text-foreground/82 transition-colors hover:bg-black/5 dark:hover:bg-white/5"
            onClick={() => {
              void handleSaveAs();
            }}
          >
            {t('filePreview.saveAs')}
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="chat-file-card-context-open-with"
            className="flex w-full items-center rounded-[10px] px-3 py-2 text-left text-[13px] font-medium text-foreground/82 transition-colors hover:bg-black/5 dark:hover:bg-white/5"
            onClick={() => {
              void handleOpenWith();
            }}
          >
            {t('filePreview.openWith')}
          </button>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}

// ── Image Thumbnail (user bubble — square crop with zoom hint) ──

const ImageThumbnail = memo(function ImageThumbnail({
  src,
  fileName,
  filePath,
  base64,
  mimeType,
  onPreview,
}: {
  src: string;
  fileName: string;
  filePath?: string;
  base64?: string;
  mimeType?: string;
  onPreview: () => void;
}) {
  void filePath; void base64; void mimeType;
  return (
    <div
      className="relative w-36 h-36 rounded-lg border overflow-hidden border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 group/img cursor-zoom-in"
      onClick={onPreview}
    >
      <img src={src} alt={fileName} className="w-full h-full object-cover" />
      <div className="absolute inset-0 bg-black/0 group-hover/img:bg-black/25 transition-colors flex items-center justify-center">
        <ZoomIn className="h-6 w-6 text-white opacity-0 group-hover/img:opacity-100 transition-opacity drop-shadow" />
      </div>
    </div>
  );
});

// ── Image Preview Card (assistant bubble — natural size with overlay actions) ──

const ImagePreviewCard = memo(function ImagePreviewCard({
  src,
  fileName,
  filePath,
  base64,
  mimeType,
  onPreview,
}: {
  src: string;
  fileName: string;
  filePath?: string;
  base64?: string;
  mimeType?: string;
  onPreview: () => void;
}) {
  void filePath; void base64; void mimeType;
  return (
    <div
      className="relative max-w-xs rounded-lg border overflow-hidden border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 group/img cursor-zoom-in"
      onClick={onPreview}
    >
      <img src={src} alt={fileName} className="block w-full" />
      <div className="absolute inset-0 bg-black/0 group-hover/img:bg-black/20 transition-colors flex items-center justify-center">
        <ZoomIn className="h-6 w-6 text-white opacity-0 group-hover/img:opacity-100 transition-opacity drop-shadow" />
      </div>
    </div>
  );
});

// ── Image Lightbox ───────────────────────────────────────────────

const ImageLightbox = memo(function ImageLightbox({
  src,
  fileName,
  filePath,
  base64,
  mimeType,
  onClose,
}: {
  src: string;
  fileName: string;
  filePath?: string;
  base64?: string;
  mimeType?: string;
  onClose: () => void;
}) {
  void mimeType;
  const { t } = useTranslation(['chat', 'common']);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleShowInFolder = useCallback(() => {
    if (filePath) {
      invokeIpc('shell:showItemInFolder', filePath);
    }
  }, [filePath]);

  const handleCopyImage = useCallback(async () => {
    const result = await invokeIpc('media:copyImage', {
      filePath,
      base64,
    }) as { success?: boolean };
    if (result?.success) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  }, [base64, filePath]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Image + buttons stacked */}
      <div
        className="flex flex-col items-center gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={src}
          alt={fileName}
          className="max-w-[90vw] max-h-[85vh] rounded-md shadow-2xl object-contain"
        />

        {/* Action buttons below image */}
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            data-testid="chat-image-lightbox-copy"
            className="h-8 w-8 bg-white/10 hover:bg-white/20 text-white"
            onClick={handleCopyImage}
            title={t('filePreview.copyImage')}
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </Button>
          {filePath && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 bg-white/10 hover:bg-white/20 text-white"
              onClick={handleShowInFolder}
              title={t('filePreview.revealInFolder')}
            >
              <FolderOpen className="h-4 w-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 bg-white/10 hover:bg-white/20 text-white"
            onClick={onClose}
            title={t('common:actions.close')}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
});

// ── Tool Card ───────────────────────────────────────────────────

const ToolCard = memo(function ToolCard({ name, input }: { name: string; input: unknown }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      data-testid="chat-tool-card"
      className="w-full rounded-lg border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 text-[14px]"
    >
      <button
        className="flex items-center gap-2 w-full px-3 py-1.5 text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
        <Wrench className="h-3 w-3 shrink-0 opacity-60" />
        <span className="font-mono text-xs">{name}</span>
        {expanded ? <ChevronDown className="h-3 w-3 ml-auto" /> : <ChevronRight className="h-3 w-3 ml-auto" />}
      </button>
      {expanded && input != null && (
        <pre className="px-3 pb-2 text-xs text-muted-foreground overflow-x-auto">
          {typeof input === 'string' ? input : JSON.stringify(input, null, 2) as string}
        </pre>
      )}
    </div>
  );
});
