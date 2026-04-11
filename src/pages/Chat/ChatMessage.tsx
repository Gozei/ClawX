/**
 * Chat Message Component
 * Renders user / assistant / system / toolresult messages
 * with markdown, thinking sections, images, and tool cards.
 */
import { useState, useCallback, useEffect, memo } from 'react';
import { Sparkles, Copy, Check, ChevronDown, ChevronRight, Wrench, FileText, Film, Music, FileArchive, File, X, FolderOpen, ZoomIn, Loader2, CheckCircle2, AlertCircle, FileCode, FileSpreadsheet, FileImage } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { invokeIpc } from '@/lib/api-client';
import type { RawMessage, AttachedFileMeta } from '@/stores/chat';
import { useSettingsStore, type AssistantMessageStyle } from '@/stores/settings';
import { extractText, extractThinking, extractImages, extractToolUse, formatTimestamp } from './message-utils';

interface ChatMessageProps {
  message: RawMessage;
  showThinking: boolean;
  isStreaming?: boolean;
  hideAvatar?: boolean;
  reserveAvatarSpace?: boolean;
  constrainWidth?: boolean;
  streamingTools?: Array<{
    id?: string;
    toolCallId?: string;
    name: string;
    status: 'running' | 'completed' | 'error';
    durationMs?: number;
    summary?: string;
  }>;
}

interface ExtractedImage { url?: string; data?: string; mimeType: string; }

/** Resolve an ExtractedImage to a displayable src string, or null if not possible. */
function imageSrc(img: ExtractedImage): string | null {
  if (img.url) return img.url;
  if (img.data) return `data:${img.mimeType};base64,${img.data}`;
  return null;
}

export const ChatMessage = memo(function ChatMessage({
  message,
  showThinking,
  isStreaming = false,
  hideAvatar = false,
  reserveAvatarSpace = false,
  constrainWidth = true,
  streamingTools = [],
}: ChatMessageProps) {
  const isUser = message.role === 'user';
  const isErrorMessage = !isUser && message.isError === true;
  const role = typeof message.role === 'string' ? message.role.toLowerCase() : '';
  const isToolResult = role === 'toolresult' || role === 'tool_result';
  const text = extractText(message);
  const hasText = text.trim().length > 0;
  const thinking = extractThinking(message);
  const images = extractImages(message);
  const tools = extractToolUse(message);
  const chatProcessDisplayMode = useSettingsStore((state) => state.chatProcessDisplayMode);
  const assistantMessageStyle = useSettingsStore((state) => state.assistantMessageStyle);
  const chatFontScale = useSettingsStore((state) => state.chatFontScale);
  const usesAssistantStreamStyle = !isUser && assistantMessageStyle === 'stream';
  const visibleThinking = showThinking ? thinking : null;
  const visibleTools = chatProcessDisplayMode === 'all' ? tools : [];
  const bodyFontSize = `${Math.round(15 * (chatFontScale / 100) * 10) / 10}px`;
  const metaFontSize = `${Math.round(12 * (chatFontScale / 100) * 10) / 10}px`;

  const attachedFiles = message._attachedFiles || [];
  const [lightboxImg, setLightboxImg] = useState<{ src: string; fileName: string; filePath?: string; base64?: string; mimeType?: string } | null>(null);

  // Never render tool result messages in chat UI
  if (isToolResult) return null;

  const hasStreamingToolStatus = isStreaming && chatProcessDisplayMode === 'all' && streamingTools.length > 0;
  if (!hasText && !visibleThinking && images.length === 0 && visibleTools.length === 0 && attachedFiles.length === 0 && !hasStreamingToolStatus) return null;

  return (
    <div
      className={cn(
        'flex gap-3 group',
        isUser ? 'flex-row-reverse' : 'flex-row',
      )}
      style={isStreaming ? undefined : { contentVisibility: 'auto', containIntrinsicSize: '160px' }}
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
          'flex flex-col w-full min-w-0 space-y-2',
          constrainWidth && !usesAssistantStreamStyle && 'max-w-[80%]',
          isUser ? 'items-end' : 'items-start',
        )}
      >
        {isStreaming && !isUser && streamingTools.length > 0 && (
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
          <div className="flex flex-wrap gap-2">
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
          <div className="flex flex-wrap gap-2">
            {attachedFiles.map((file, i) => (
              <FileCard 
                key={`local-${i}`} 
                file={file} 
                onPreview={file.preview && file.mimeType.startsWith('image/') 
                  ? () => setLightboxImg({ src: file.preview!, fileName: file.fileName, filePath: file.filePath, mimeType: file.mimeType }) 
                  : undefined} 
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
          />
        )}

        {/* Images from content blocks — assistant messages (below text) */}
        {!isUser && images.length > 0 && (
          <div className="flex flex-wrap gap-2">
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
          <div className="flex flex-wrap gap-2">
            {attachedFiles.map((file, i) => (
              <FileCard 
                key={`local-${i}`} 
                file={file} 
                onPreview={file.preview && file.mimeType.startsWith('image/') 
                  ? () => setLightboxImg({ src: file.preview!, fileName: file.fileName, filePath: file.filePath, mimeType: file.mimeType }) 
                  : undefined} 
              />
            ))}
          </div>
        )}

        {/* Hover row — show timestamp + copy action on the bottom-right for text messages */}
        {hasText && (
          <MessageHoverBar
            text={text}
            timestamp={message.timestamp}
            metaFontSize={metaFontSize}
            messageType={isUser ? 'user' : 'assistant'}
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
});

function formatDuration(durationMs?: number): string | null {
  if (!durationMs || !Number.isFinite(durationMs)) return null;
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function ToolStatusBar({
  tools,
}: {
  tools: Array<{
    id?: string;
    toolCallId?: string;
    name: string;
    status: 'running' | 'completed' | 'error';
    durationMs?: number;
    summary?: string;
  }>;
}) {
  return (
    <div className="w-full space-y-1">
      {tools.map((tool) => {
        const duration = formatDuration(tool.durationMs);
        const isRunning = tool.status === 'running';
        const isError = tool.status === 'error';
        return (
          <div
            key={tool.toolCallId || tool.id || tool.name}
            className={cn(
              'flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-colors',
              isRunning && 'border-primary/30 bg-primary/5 text-foreground',
              !isRunning && !isError && 'border-border/50 bg-muted/20 text-muted-foreground',
              isError && 'border-destructive/30 bg-destructive/5 text-destructive',
            )}
          >
            {isRunning && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />}
            {!isRunning && !isError && <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />}
            {isError && <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0" />}
            <Wrench className="h-3 w-3 shrink-0 opacity-60" />
            <span className="font-mono text-[12px] font-medium">{tool.name}</span>
            {duration && <span className="text-[11px] opacity-60">{tool.summary ? `(${duration})` : duration}</span>}
            {tool.summary && (
              <span className="truncate text-[11px] opacity-70">{tool.summary}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Message hover bar (timestamp + copy, shown on group hover) ──

function MessageHoverBar({
  text,
  timestamp,
  metaFontSize,
  messageType,
}: {
  text: string;
  timestamp?: number;
  metaFontSize: string;
  messageType: 'user' | 'assistant';
}) {
  const [copied, setCopied] = useState(false);

  const copyContent = useCallback(() => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <div className="flex items-center gap-1.5 self-end opacity-0 group-hover:opacity-100 transition-opacity duration-200 select-none px-1">
      {timestamp ? (
        <span className="text-muted-foreground" style={{ fontSize: metaFontSize }}>
          {formatTimestamp(timestamp)}
        </span>
      ) : null}
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={copyContent}
        data-testid={`chat-message-copy-${messageType}`}
      >
        {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
      </Button>
    </div>
  );
}

// ── Message Bubble ──────────────────────────────────────────────

function MessageBubble({
  text,
  isUser,
  isError,
  isStreaming,
  fontSize,
  assistantMessageStyle,
}: {
  text: string;
  isUser: boolean;
  isError: boolean;
  isStreaming: boolean;
  fontSize: string;
  assistantMessageStyle: AssistantMessageStyle;
}) {
  const usesAssistantStreamStyle = !isUser && assistantMessageStyle === 'stream';

  return (
    <div
      data-testid={!isUser ? (isError ? 'chat-assistant-error-message' : `chat-assistant-message-${assistantMessageStyle}`) : undefined}
      className={cn(
        'relative',
        usesAssistantStreamStyle ? 'w-full px-1 py-0.5' : 'rounded-[24px] px-4 py-3.5',
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
        <p className="whitespace-pre-wrap break-words break-all leading-[1.82]" style={{ fontSize }}>{text}</p>
      ) : isStreaming ? (
        <div className={cn('whitespace-pre-wrap break-words break-all leading-[1.82]', usesAssistantStreamStyle && 'prose prose-sm dark:prose-invert max-w-none')} style={{ fontSize }}>
          {text}
          <span className="inline-block w-2 h-4 bg-foreground/50 animate-pulse ml-0.5 align-[-2px]" />
        </div>
      ) : (
        <div className={cn('prose prose-sm dark:prose-invert max-w-none break-words break-all leading-[1.82]', usesAssistantStreamStyle && '[&>*]:my-3 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0')} style={{ fontSize }}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              code({ className, children, ...props }) {
                const match = /language-(\w+)/.exec(className || '');
                const isInline = !match && !className;
                if (isInline) {
                  return (
                <code className={cn('px-1.5 py-0.5 rounded text-sm font-mono break-words break-all', isError ? 'bg-destructive/10 text-destructive' : 'bg-background/50')} {...props}>
                  {children}
                </code>
              );
            }
            return (
                  <pre className={cn('rounded-lg p-4 overflow-x-auto', isError ? 'bg-destructive/10' : 'bg-background/50')}>
                    <code className={cn('text-sm font-mono', className)} {...props}>
                      {children}
                    </code>
                  </pre>
                );
              },
              a({ href, children }) {
                return (
                  <a href={href} target="_blank" rel="noopener noreferrer" className={cn('hover:underline break-words break-all', isError ? 'text-destructive' : 'text-primary')}>
                    {children}
                  </a>
                );
              },
            }}
          >
            {text}
          </ReactMarkdown>
        </div>
      )}

    </div>
  );
}

// ── Thinking Block ──────────────────────────────────────────────

function ThinkingBlock({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="w-full rounded-xl border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 text-[14px]">
      <button
        className="flex items-center gap-2 w-full px-3 py-2 text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <span className="font-medium">Thinking</span>
      </button>
      {expanded && (
        <div className="px-3 pb-3 text-muted-foreground">
          <div className="prose prose-sm dark:prose-invert max-w-none opacity-75">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}

// ── File Card (for user-uploaded non-image files) ───────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function FileExtIcon({ ext, color, className }: { ext: string; color: string; className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" fill={`${color}20`} />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <text x="12" y="18" fontSize="6.5" fontFamily="sans-serif" fontWeight="bold" textAnchor="middle" stroke="none" fill={color}>{ext.toUpperCase()}</text>
    </svg>
  );
}

function FileIcon({ mimeType, fileName, className }: { mimeType: string; fileName?: string; className?: string }) {
  const t = mimeType.toLowerCase();
  const n = (fileName || '').toLowerCase();
  
  if (t.startsWith('image/') || t.startsWith('video/') || n.match(/\.(jpg|jpeg|png|gif|webp|mp4|mov|avi|webm)$/i)) return <FileImage color="#8b5cf6" className={className} />;
  if (t.startsWith('audio/') || n.match(/\.(mp3|wav|ogg|m4a)$/i)) return <Music color="#eab308" className={className} />;
  if (t.includes('pdf') || n.endsWith('.pdf')) return <FileExtIcon ext="PDF" color="#ef4444" className={className} />;
  if (t.includes('spreadsheet') || t.includes('excel') || t.includes('csv') || n.match(/\.(xls|xlsx|csv)$/i)) return <FileExtIcon ext="XLS" color="#22c55e" className={className} />;
  if (t.includes('wordprocessing') || t.includes('msword') || t.includes('document') || n.match(/\.(doc|docx)$/i)) return <FileExtIcon ext="DOC" color="#3b82f6" className={className} />;
  if (t.includes('presentation') || t.includes('powerpoint') || n.match(/\.(ppt|pptx)$/i)) return <FileExtIcon ext="PPT" color="#f97316" className={className} />;
  if (t.startsWith('text/') || t === 'application/json' || t === 'application/xml' || n.match(/\.(txt|json|xml|md|csv|log)$/i)) return <FileCode color="#64748b" className={className} />;
  if (t.includes('zip') || t.includes('compressed') || t.includes('archive') || t.includes('tar') || t.includes('rar') || t.includes('7z') || n.match(/\.(zip|rar|7z|tar|gz)$/i)) return <FileArchive color="#ec4899" className={className} />;
  
  return <File color="#94a3b8" className={className} />;
}

function FileCard({ file, onPreview }: { file: AttachedFileMeta; onPreview?: () => void }) {
  const handleOpen = useCallback(() => {
    if (onPreview) {
      onPreview();
      return;
    }
    if (file.filePath) {
      invokeIpc('shell:openPath', file.filePath);
    }
  }, [file.filePath, onPreview]);

  return (
    <div 
      className={cn(
        "flex items-center gap-3 rounded-xl border border-black/10 dark:border-white/10 px-3 h-14 bg-black/5 dark:bg-white/5 max-w-[220px]",
        (file.filePath || onPreview) && "cursor-pointer hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
      )}
      onClick={handleOpen}
      title={file.filePath ? "Open file" : undefined}
    >
      <FileIcon mimeType={file.mimeType} fileName={file.fileName} className="h-8 w-8 shrink-0 drop-shadow-sm" />
      <div className="min-w-0 overflow-hidden leading-tight flex flex-col justify-center">
        <p className="text-[13px] font-medium truncate">{file.fileName}</p>
        <p className="text-[10px] text-muted-foreground">
          {file.fileSize > 0 ? formatFileSize(file.fileSize) : 'File'}
        </p>
      </div>
    </div>
  );
}

// ── Image Thumbnail (user bubble — square crop with zoom hint) ──

function ImageThumbnail({
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
      className="relative w-36 h-36 rounded-xl border overflow-hidden border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 group/img cursor-zoom-in"
      onClick={onPreview}
    >
      <img src={src} alt={fileName} className="w-full h-full object-cover" />
      <div className="absolute inset-0 bg-black/0 group-hover/img:bg-black/25 transition-colors flex items-center justify-center">
        <ZoomIn className="h-6 w-6 text-white opacity-0 group-hover/img:opacity-100 transition-opacity drop-shadow" />
      </div>
    </div>
  );
}

// ── Image Preview Card (assistant bubble — natural size with overlay actions) ──

function ImagePreviewCard({
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
      className="relative max-w-xs rounded-xl border overflow-hidden border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 group/img cursor-zoom-in"
      onClick={onPreview}
    >
      <img src={src} alt={fileName} className="block w-full" />
      <div className="absolute inset-0 bg-black/0 group-hover/img:bg-black/20 transition-colors flex items-center justify-center">
        <ZoomIn className="h-6 w-6 text-white opacity-0 group-hover/img:opacity-100 transition-opacity drop-shadow" />
      </div>
    </div>
  );
}

// ── Image Lightbox ───────────────────────────────────────────────

function ImageLightbox({
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
  void src; void base64; void mimeType; void fileName;

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
          className="max-w-[90vw] max-h-[85vh] rounded-lg shadow-2xl object-contain"
        />

        {/* Action buttons below image */}
        <div className="flex items-center gap-2">
          {filePath && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 bg-white/10 hover:bg-white/20 text-white"
              onClick={handleShowInFolder}
              title="在文件夹中显示"
            >
              <FolderOpen className="h-4 w-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 bg-white/10 hover:bg-white/20 text-white"
            onClick={onClose}
            title="关闭"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Tool Card ───────────────────────────────────────────────────

function ToolCard({ name, input }: { name: string; input: unknown }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      data-testid="chat-tool-card"
      className="w-full rounded-xl border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 text-[14px]"
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
}
