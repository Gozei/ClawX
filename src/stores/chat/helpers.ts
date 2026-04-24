import i18n from '@/i18n';
import { invokeIpc } from '@/lib/api-client';
import { normalizeAppError } from '@/lib/error-model';
import { hostApiFetch } from '@/lib/host-api';
import type { AttachedFileMeta, ChatComposerDraft, ChatSession, ContentBlock, RawMessage, ToolStatus } from './types';

export const CHAT_HISTORY_RPC_TIMEOUT_MS = 60_000;
export const CHAT_HISTORY_LABEL_PREFETCH_LIMIT = 50;

type DraftSessionStateLike = {
  currentSessionKey: string;
  messages: unknown[];
  sessions: ChatSession[];
  composerDrafts?: Record<string, ChatComposerDraft>;
  sessionLabels: Record<string, string>;
  sessionLastActivity: Record<string, number>;
};

// Module-level timestamp tracking the last chat event received.
// Used by the safety timeout to avoid false-positive "no response" errors
// during tool-use conversations where streamingMessage is temporarily cleared
// between tool-result finals and the next delta.
let _lastChatEventAt = 0;

/** Normalize a timestamp to milliseconds. Handles both seconds and ms. */
function toMs(ts: number): number {
  // Timestamps < 1e12 are in seconds (before ~2033); >= 1e12 are milliseconds
  return ts < 1e12 ? ts * 1000 : ts;
}

// Timer for fallback history polling during active sends.
// If no streaming events arrive within a few seconds, we periodically
// poll chat.history to surface intermediate tool-call turns.
let _historyPollTimer: ReturnType<typeof setTimeout> | null = null;

// Timer for delayed error finalization. When the Gateway reports a mid-stream
// error (e.g. "terminated"), it may retry internally and recover. We wait
// before committing the error to give the recovery path a chance.
let _errorRecoveryTimer: ReturnType<typeof setTimeout> | null = null;

function clearErrorRecoveryTimer(): void {
  if (_errorRecoveryTimer) {
    clearTimeout(_errorRecoveryTimer);
    _errorRecoveryTimer = null;
  }
}

function clearHistoryPoll(): void {
  if (_historyPollTimer) {
    clearTimeout(_historyPollTimer);
    _historyPollTimer = null;
  }
}

function hasStoredSessionLabel(sessions: ChatSession[], sessionKey: string): boolean {
  const session = sessions.find((entry) => entry.key === sessionKey);
  return typeof session?.label === 'string' && session.label.trim().length > 0;
}

function hasComposerDraftContent(draft: ChatComposerDraft | null | undefined): boolean {
  if (!draft) return false;
  if (draft.text.trim().length > 0) return true;
  if (draft.attachments.length > 0) return true;
  return typeof draft.targetAgentId === 'string' && draft.targetAgentId.trim().length > 0;
}

function isUnusedDraftSession(
  state: DraftSessionStateLike,
  sessionKey: string,
): boolean {
  return !sessionKey.endsWith(':main')
    && state.currentSessionKey === sessionKey
    && state.messages.length === 0
    && !hasComposerDraftContent(state.composerDrafts?.[sessionKey])
    && !state.sessionLastActivity[sessionKey]
    && !state.sessionLabels[sessionKey]
    && !hasStoredSessionLabel(state.sessions, sessionKey);
}

// ── Local image cache ─────────────────────────────────────────
// The Gateway doesn't store image attachments in session content blocks,
// so we cache them locally keyed by staged file path (which appears in the
// [media attached: <path> ...] reference in the Gateway's user message text).
// Keying by path avoids the race condition of keying by runId (which is only
// available after the RPC returns, but history may load before that).
const IMAGE_CACHE_KEY = 'clawx:image-cache';
const IMAGE_CACHE_MAX = 100; // max entries to prevent unbounded growth

function loadImageCache(): Map<string, AttachedFileMeta> {
  try {
    const raw = localStorage.getItem(IMAGE_CACHE_KEY);
    if (raw) {
      const entries = JSON.parse(raw) as Array<[string, AttachedFileMeta]>;
      return new Map(entries);
    }
  } catch { /* ignore parse errors */ }
  return new Map();
}

function saveImageCache(cache: Map<string, AttachedFileMeta>): void {
  try {
    // Evict oldest entries if over limit
    const entries = Array.from(cache.entries());
    const trimmed = entries.length > IMAGE_CACHE_MAX
      ? entries.slice(entries.length - IMAGE_CACHE_MAX)
      : entries;
    localStorage.setItem(IMAGE_CACHE_KEY, JSON.stringify(trimmed));
  } catch { /* ignore quota errors */ }
}

const _imageCache = loadImageCache();

function upsertImageCacheEntry(filePath: string, file: Omit<AttachedFileMeta, 'filePath'>): void {
  _imageCache.set(filePath, { ...file, filePath });
  saveImageCache(_imageCache);
}

/** Extract plain text from message content (string or content blocks) */
function getMessageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return (content as Array<{ type?: string; text?: string }>)
      .filter(b => b.type === 'text' && b.text)
      .map(b => b.text!)
      .join('\n');
  }
  return '';
}

function translateChat(key: string, defaultValue: string, options?: Record<string, unknown>): string {
  return i18n.t(`chat:${key}`, {
    defaultValue,
    ...options,
  });
}

function normalizeErrorDetail(error: string | null | undefined): string | null {
  if (typeof error !== 'string') return null;
  const trimmed = error.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function localizeChatErrorDetail(error?: string | null): string | null {
  const detail = normalizeErrorDetail(error);
  if (!detail) return null;

  let normalizedDetail = detail;
  while (/^Error:\s*/i.test(normalizedDetail)) {
    normalizedDetail = normalizedDetail.replace(/^Error:\s*/i, '').trim();
  }
  if (!normalizedDetail || normalizedDetail === 'Failed to send message') {
    return null;
  }

  const appError = normalizeAppError(new Error(normalizedDetail));
  switch (appError.code) {
    case 'AUTH_INVALID':
      return translateChat(
        'sessionErrorDetails.authInvalid',
        'Authentication failed. Check API key or login status and try again.',
      );
    case 'TIMEOUT':
      return translateChat(
        'sessionErrorDetails.timeout',
        'Request timed out. Please try again.',
      );
    case 'RATE_LIMIT':
      return translateChat(
        'sessionErrorDetails.rateLimit',
        'Too many requests. Please wait and try again.',
      );
    case 'PERMISSION':
      return translateChat(
        'sessionErrorDetails.permission',
        'Permission denied. Check your configuration and try again.',
      );
    case 'CHANNEL_UNAVAILABLE':
      return translateChat(
        'sessionErrorDetails.channelUnavailable',
        'Service channel unavailable. Restart the app or gateway and try again.',
      );
    case 'NETWORK':
      return translateChat(
        'sessionErrorDetails.network',
        'Network error. Please verify connectivity and try again.',
      );
    case 'CONFIG':
      return translateChat(
        'sessionErrorDetails.config',
        'Configuration is invalid. Please review your settings and try again.',
      );
    case 'GATEWAY':
      if (/not connected/i.test(normalizedDetail)) {
        return translateChat(
          'sessionErrorDetails.gatewayNotConnected',
          'Gateway not connected.',
        );
      }
      return translateChat(
        'sessionErrorDetails.gatewayUnavailable',
        'Gateway error. Please restart the gateway and try again.',
      );
    default:
      return normalizedDetail;
  }
}

function getChatNoticeMessage(error?: string | null): string | null {
  return localizeChatErrorDetail(error);
}

function getSendFailedError(error?: string): string {
  const detail = localizeChatErrorDetail(error);
  if (!detail) {
    return translateChat(
      'sessionErrors.sendFailed',
      'Failed to send message. Please check the provider or gateway status and try again.',
    );
  }
  return translateChat(
    'sessionErrors.sendFailedWithDetail',
    'Failed to send message: {{error}}',
    { error: detail },
  );
}

function getNoResponseError(): string {
  return translateChat(
    'sessionErrors.noResponse',
    'No response received from the model. The provider may be unavailable or the API key may have insufficient quota. Please check your provider settings.',
  );
}

function getEmptyAssistantResponseError(): string {
  return translateChat(
    'sessionErrors.emptyAssistantResponse',
    'The selected provider returned an empty response. Check the provider base URL, API protocol, model, and API key.',
  );
}

function getInterruptedReplyError(): string {
  return translateChat(
    'sessionErrors.replyInterrupted',
    'The reply stopped before completion. Check your provider settings and try again.',
  );
}

function isGenericAssistantRuntimeDetail(detail: string): boolean {
  return /^(error|failed|failure|abort(?:ed)?|cancel(?:led|ed)?|stopped|terminated|interrupted)$/i.test(detail.trim());
}

function isErrorLikeStopReason(stopReason: string | null): boolean {
  if (!stopReason) return false;
  return /(error|fail|abort|cancel|terminate|interrupt|unauthor|auth|forbidden|timeout|rate)/i.test(stopReason);
}

function readAssistantRuntimeErrorField(record: Record<string, unknown> | null): string | null {
  if (!record) return null;
  for (const key of ['errorMessage', 'error_message', 'error', 'reason', 'detail']) {
    const candidate = normalizeErrorDetail(record[key] as string | null | undefined);
    if (candidate) return candidate;
  }
  return null;
}

function getAssistantRuntimeErrorNotice(message: RawMessage | undefined): string | null {
  if (!message || message.role !== 'assistant') return null;

  const record = message as unknown as Record<string, unknown>;
  const stopReason = normalizeErrorDetail((record.stopReason ?? record.stop_reason) as string | null | undefined);
  const detailsRecord = record.details && typeof record.details === 'object' && !Array.isArray(record.details)
    ? record.details as Record<string, unknown>
    : null;
  const explicitError = readAssistantRuntimeErrorField(record) ?? readAssistantRuntimeErrorField(detailsRecord);
  const status = normalizeErrorDetail(record.status as string | null | undefined)?.toLowerCase() ?? null;
  const endedWithRuntimeError = !!explicitError || status === 'error' || isErrorLikeStopReason(stopReason);
  if (!endedWithRuntimeError) return null;

  const actionableDetail = explicitError
    ?? ((stopReason && !isGenericAssistantRuntimeDetail(stopReason)) ? stopReason : null);
  if (actionableDetail) {
    const localizedDetail = localizeChatErrorDetail(actionableDetail);
    if (localizedDetail && !isGenericAssistantRuntimeDetail(localizedDetail)) {
      return localizedDetail;
    }
  }

  return getInterruptedReplyError();
}

function getContinueConversationWarning(): string {
  return translateChat(
    'sessionWarnings.finalReplyMissing',
    'The final reply did not arrive, but you can continue the conversation.',
  );
}

function createLocalAssistantMessage(
  content: string,
  options?: {
    isError?: boolean;
    idPrefix?: string;
    timestampMs?: number;
  },
): RawMessage {
  const timestampMs = options?.timestampMs ?? Date.now();
  return {
    id: `${options?.idPrefix || (options?.isError ? 'local-error' : 'local-message')}-${timestampMs}`,
    role: 'assistant',
    content,
    timestamp: timestampMs / 1000,
    isError: options?.isError === true,
  };
}

function appendAssistantMessage(messages: RawMessage[], nextMessage: RawMessage): RawMessage[] {
  const nextText = getMessageText(nextMessage.content).trim();
  if (!nextText) return messages;

  const hasDuplicate = messages.slice(-3).some((message) => (
    message.role === nextMessage.role
    && !!message.isError === !!nextMessage.isError
    && getMessageText(message.content).trim() === nextText
  ));

  return hasDuplicate ? messages : [...messages, nextMessage];
}

/** Extract media file refs from [media attached: <path> (<mime>) | ...] patterns */
function extractMediaRefs(text: string): Array<{ filePath: string; mimeType: string }> {
  const refs: Array<{ filePath: string; mimeType: string }> = [];
  const regex = /\[media attached:\s*([^\s(]+)\s*\(([^)]+)\)\s*\|[^\]]*\]/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    refs.push({ filePath: match[1], mimeType: match[2] });
  }
  return refs;
}

/** Map common file extensions to MIME types */
function mimeFromExtension(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    // Images
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'bmp': 'image/bmp',
    'avif': 'image/avif',
    'svg': 'image/svg+xml',
    // Documents
    'pdf': 'application/pdf',
    'doc': 'application/msword',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'xls': 'application/vnd.ms-excel',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'ppt': 'application/vnd.ms-powerpoint',
    'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'txt': 'text/plain',
    'csv': 'text/csv',
    'md': 'text/markdown',
    'rtf': 'application/rtf',
    'epub': 'application/epub+zip',
    // Archives
    'zip': 'application/zip',
    'tar': 'application/x-tar',
    'gz': 'application/gzip',
    'rar': 'application/vnd.rar',
    '7z': 'application/x-7z-compressed',
    // Audio
    'mp3': 'audio/mpeg',
    'wav': 'audio/wav',
    'ogg': 'audio/ogg',
    'aac': 'audio/aac',
    'flac': 'audio/flac',
    'm4a': 'audio/mp4',
    // Video
    'mp4': 'video/mp4',
    'mov': 'video/quicktime',
    'avi': 'video/x-msvideo',
    'mkv': 'video/x-matroska',
    'webm': 'video/webm',
    'm4v': 'video/mp4',
  };
  return map[ext] || 'application/octet-stream';
}

/**
 * Extract raw file paths from message text.
 * Detects absolute paths (Unix: / or ~/, Windows: C:\ etc.) ending with common file extensions.
 * Handles both image and non-image files, consistent with channel push message behavior.
 */
function extractRawFilePaths(text: string): Array<{ filePath: string; mimeType: string }> {
  const refs: Array<{ filePath: string; mimeType: string }> = [];
  const seen = new Set<string>();
  const exts = 'png|jpe?g|gif|webp|bmp|avif|svg|pdf|docx?|xlsx?|pptx?|txt|csv|md|rtf|epub|zip|tar|gz|rar|7z|mp3|wav|ogg|aac|flac|m4a|mp4|mov|avi|mkv|webm|m4v';
  // Unix absolute paths (/... or ~/...) — lookbehind rejects mid-token slashes
  // (e.g. "path/to/file.mp4", "https://example.com/file.mp4")
  const unixRegex = new RegExp(`(?<![\\w./:])((?:\\/|~\\/)[^\\s\\n"'()\\[\\],<>]*?\\.(?:${exts}))`, 'gi');
  // Windows absolute paths (C:\... D:\...) — lookbehind rejects drive letter glued to a word
  const winRegex = new RegExp(`(?<![\\w])([A-Za-z]:\\\\[^\\s\\n"'()\\[\\],<>]*?\\.(?:${exts}))`, 'gi');
  for (const regex of [unixRegex, winRegex]) {
    let match;
    while ((match = regex.exec(text)) !== null) {
      const p = match[1];
      if (p && !seen.has(p)) {
        seen.add(p);
        refs.push({ filePath: p, mimeType: mimeFromExtension(p) });
      }
    }
  }
  return refs;
}

/**
 * Extract images from a content array (including nested tool_result content).
 * Converts them to AttachedFileMeta entries with preview set to data URL or remote URL.
 */
function extractImagesAsAttachedFiles(content: unknown): AttachedFileMeta[] {
  if (!Array.isArray(content)) return [];
  const files: AttachedFileMeta[] = [];

  for (const block of content as ContentBlock[]) {
    if (block.type === 'image') {
      // Path 1: Anthropic source-wrapped format {source: {type, media_type, data}}
      if (block.source) {
        const src = block.source;
        const mimeType = src.media_type || 'image/jpeg';

        if (src.type === 'base64' && src.data) {
          files.push({
            fileName: 'image',
            mimeType,
            fileSize: 0,
            preview: `data:${mimeType};base64,${src.data}`,
          });
        } else if (src.type === 'url' && src.url) {
          files.push({
            fileName: 'image',
            mimeType,
            fileSize: 0,
            preview: src.url,
          });
        }
      }
      // Path 2: Flat format from Gateway tool results {data, mimeType}
      else if (block.data) {
        const mimeType = block.mimeType || 'image/jpeg';
        files.push({
          fileName: 'image',
          mimeType,
          fileSize: 0,
          preview: `data:${mimeType};base64,${block.data}`,
        });
      }
    }
    // Recurse into tool_result content blocks
    if ((block.type === 'tool_result' || block.type === 'toolResult') && block.content) {
      files.push(...extractImagesAsAttachedFiles(block.content));
    }
  }
  return files;
}

/**
 * Build an AttachedFileMeta entry for a file ref, using cache if available.
 */
function makeAttachedFile(ref: { filePath: string; mimeType: string }): AttachedFileMeta {
  const cached = _imageCache.get(ref.filePath);
  if (cached) return { ...cached, filePath: ref.filePath };
  const fileName = ref.filePath.split(/[\\/]/).pop() || 'file';
  return { fileName, mimeType: ref.mimeType, fileSize: 0, preview: null, filePath: ref.filePath };
}

/**
 * Extract file path from a tool call's arguments by toolCallId.
 * Searches common argument names: file_path, filePath, path, file.
 */
function getToolCallFilePath(msg: RawMessage, toolCallId: string): string | undefined {
  if (!toolCallId) return undefined;

  // Anthropic/normalized format — toolCall blocks in content array
  const content = msg.content;
  if (Array.isArray(content)) {
    for (const block of content as ContentBlock[]) {
      if ((block.type === 'tool_use' || block.type === 'toolCall') && block.id === toolCallId) {
        const args = (block.input ?? block.arguments) as Record<string, unknown> | undefined;
        if (args) {
          const fp = args.file_path ?? args.filePath ?? args.path ?? args.file;
          if (typeof fp === 'string') return fp;
        }
      }
    }
  }

  // OpenAI format — tool_calls array on the message itself
  const msgAny = msg as unknown as Record<string, unknown>;
  const toolCalls = msgAny.tool_calls ?? msgAny.toolCalls;
  if (Array.isArray(toolCalls)) {
    for (const tc of toolCalls as Array<Record<string, unknown>>) {
      if (tc.id !== toolCallId) continue;
      const fn = (tc.function ?? tc) as Record<string, unknown>;
      let args: Record<string, unknown> | undefined;
      try {
        args = typeof fn.arguments === 'string' ? JSON.parse(fn.arguments) : (fn.arguments ?? fn.input) as Record<string, unknown>;
      } catch { /* ignore */ }
      if (args) {
        const fp = args.file_path ?? args.filePath ?? args.path ?? args.file;
        if (typeof fp === 'string') return fp;
      }
    }
  }

  return undefined;
}

/**
 * Collect all tool call file paths from a message into a Map<toolCallId, filePath>.
 */
function collectToolCallPaths(msg: RawMessage, paths: Map<string, string>): void {
  const content = msg.content;
  if (Array.isArray(content)) {
    for (const block of content as ContentBlock[]) {
      if ((block.type === 'tool_use' || block.type === 'toolCall') && block.id) {
        const args = (block.input ?? block.arguments) as Record<string, unknown> | undefined;
        if (args) {
          const fp = args.file_path ?? args.filePath ?? args.path ?? args.file;
          if (typeof fp === 'string') paths.set(block.id, fp);
        }
      }
    }
  }
  const msgAny = msg as unknown as Record<string, unknown>;
  const toolCalls = msgAny.tool_calls ?? msgAny.toolCalls;
  if (Array.isArray(toolCalls)) {
    for (const tc of toolCalls as Array<Record<string, unknown>>) {
      const id = typeof tc.id === 'string' ? tc.id : '';
      if (!id) continue;
      const fn = (tc.function ?? tc) as Record<string, unknown>;
      let args: Record<string, unknown> | undefined;
      try {
        args = typeof fn.arguments === 'string' ? JSON.parse(fn.arguments) : (fn.arguments ?? fn.input) as Record<string, unknown>;
      } catch { /* ignore */ }
      if (args) {
        const fp = args.file_path ?? args.filePath ?? args.path ?? args.file;
        if (typeof fp === 'string') paths.set(id, fp);
      }
    }
  }
}

/**
 * Before filtering tool_result messages from history, scan them for any file/image
 * content and attach those to the immediately following assistant message.
 * This mirrors channel push message behavior where tool outputs surface files to the UI.
 * Handles:
 *   - Image content blocks (base64 / url)
 *   - [media attached: path (mime) | path] text patterns in tool result output
 *   - Raw file paths in tool result text
 */
function enrichWithToolResultFiles(messages: RawMessage[]): RawMessage[] {
  const pending: AttachedFileMeta[] = [];
  const toolCallPaths = new Map<string, string>();

  return messages.map((msg) => {
    // Track file paths from assistant tool call arguments for later matching
    if (msg.role === 'assistant') {
      collectToolCallPaths(msg, toolCallPaths);
    }

    if (isToolResultRole(msg.role)) {
      // Resolve file path from the matching tool call
      const matchedPath = msg.toolCallId ? toolCallPaths.get(msg.toolCallId) : undefined;

      // 1. Image/file content blocks in the structured content array
      const imageFiles = extractImagesAsAttachedFiles(msg.content);
      if (matchedPath) {
        for (const f of imageFiles) {
          if (!f.filePath) {
            f.filePath = matchedPath;
            f.fileName = matchedPath.split(/[\\/]/).pop() || 'image';
          }
        }
      }
      pending.push(...imageFiles);

      // 2. [media attached: ...] patterns in tool result text output
      const text = getMessageText(msg.content);
      if (text) {
        const mediaRefs = extractMediaRefs(text);
        const mediaRefPaths = new Set(mediaRefs.map(r => r.filePath));
        for (const ref of mediaRefs) {
          pending.push(makeAttachedFile(ref));
        }
        // 3. Raw file paths in tool result text (documents, audio, video, etc.)
        for (const ref of extractRawFilePaths(text)) {
          if (!mediaRefPaths.has(ref.filePath)) {
            pending.push(makeAttachedFile(ref));
          }
        }
      }

      return msg; // will be filtered later
    }

    if (msg.role === 'assistant' && pending.length > 0) {
      const toAttach = pending.splice(0);
      // Deduplicate against files already on the assistant message
      const existingPaths = new Set(
        (msg._attachedFiles || []).map(f => f.filePath).filter(Boolean),
      );
      const newFiles = toAttach.filter(f => !f.filePath || !existingPaths.has(f.filePath));
      if (newFiles.length === 0) return msg;
      return {
        ...msg,
        _attachedFiles: [...(msg._attachedFiles || []), ...newFiles],
      };
    }

    return msg;
  });
}

/**
 * Restore _attachedFiles for messages loaded from history.
 * Handles:
 *   1. [media attached: path (mime) | path] patterns (attachment-button flow)
 *   2. Raw image file paths typed in message text (e.g. /Users/.../image.png)
 * Uses local cache for previews when available; missing previews are loaded async.
 */
function enrichWithCachedImages(messages: RawMessage[]): RawMessage[] {
  return messages.map((msg, idx) => {
    // Only process user and assistant messages; skip if already enriched
    if ((msg.role !== 'user' && msg.role !== 'assistant') || msg._attachedFiles) return msg;
    const text = getMessageText(msg.content);

    // Path 1: [media attached: path (mime) | path] — guaranteed format from attachment button
    const mediaRefs = extractMediaRefs(text);
    const mediaRefPaths = new Set(mediaRefs.map(r => r.filePath));

    // Path 2: Raw file paths.
    // For assistant messages: scan own text AND the nearest preceding user message text,
    // but only for non-tool-only assistant messages (i.e. the final answer turn).
    // Tool-only messages (thinking + tool calls) should not show file previews — those
    // belong to the final answer message that comes after the tool results.
    // User messages never get raw-path previews so the image is not shown twice.
    let rawRefs: Array<{ filePath: string; mimeType: string }> = [];
    if (msg.role === 'assistant' && !isToolOnlyMessage(msg)) {
      // Own text
      rawRefs = extractRawFilePaths(text).filter(r => !mediaRefPaths.has(r.filePath));

      // Nearest preceding user message text (look back up to 5 messages)
      const seenPaths = new Set(rawRefs.map(r => r.filePath));
      for (let i = idx - 1; i >= Math.max(0, idx - 5); i--) {
        const prev = messages[i];
        if (!prev) break;
        if (prev.role === 'user') {
          const prevText = getMessageText(prev.content);
          for (const ref of extractRawFilePaths(prevText)) {
            if (!mediaRefPaths.has(ref.filePath) && !seenPaths.has(ref.filePath)) {
              seenPaths.add(ref.filePath);
              rawRefs.push(ref);
            }
          }
          break; // only use the nearest user message
        }
      }
    }

    const allRefs = [...mediaRefs, ...rawRefs];
    if (allRefs.length === 0) return msg;

    const files: AttachedFileMeta[] = allRefs.map(ref => {
      const cached = _imageCache.get(ref.filePath);
      if (cached) return { ...cached, filePath: ref.filePath };
      const fileName = ref.filePath.split(/[\\/]/).pop() || 'file';
      return { fileName, mimeType: ref.mimeType, fileSize: 0, preview: null, filePath: ref.filePath };
    });
    return { ...msg, _attachedFiles: files };
  });
}

async function materializeAssistantOutputs(
  messages: RawMessage[],
  sessionKey?: string,
): Promise<boolean> {
  const normalizedSessionKey = typeof sessionKey === 'string' ? sessionKey.trim() : '';
  if (!normalizedSessionKey) return false;

  const filePaths = Array.from(new Set(
    messages
      .filter((message) => message.role === 'assistant')
      .flatMap((message) => (message._attachedFiles || []).map((file) => file.filePath).filter(Boolean) as string[]),
  ));

  if (filePaths.length === 0) return false;

  try {
    const response = await hostApiFetch<{
      success: boolean;
      enabled?: boolean;
      results?: Array<{
        sourcePath: string;
        materializedPath: string;
        fileName: string;
        fileSize: number;
      }>;
    }>('/api/files/materialize-outputs', {
      method: 'POST',
      body: JSON.stringify({
        sessionKey: normalizedSessionKey,
        filePaths,
      }),
    });

    if (!response.success || response.enabled === false || !Array.isArray(response.results) || response.results.length === 0) {
      return false;
    }

    const resultMap = new Map(response.results.map((entry) => [entry.sourcePath, entry]));
    let updated = false;
    for (const message of messages) {
      if (message.role !== 'assistant' || !message._attachedFiles) continue;
      for (const file of message._attachedFiles) {
        const sourcePath = file.filePath;
        if (!sourcePath) continue;
        const materialized = resultMap.get(sourcePath);
        if (!materialized) continue;
        if (file.filePath !== materialized.materializedPath) {
          file.filePath = materialized.materializedPath;
          file.fileName = materialized.fileName;
          file.fileSize = materialized.fileSize;
          updated = true;
        } else if (materialized.fileSize > 0 && file.fileSize !== materialized.fileSize) {
          file.fileSize = materialized.fileSize;
          updated = true;
        }
      }
    }

    return updated;
  } catch (error) {
    console.warn('[materializeAssistantOutputs] Failed:', error);
    return false;
  }
}

/**
 * Async: load missing previews from disk via IPC for messages that have
 * _attachedFiles with null previews. Updates messages in-place and triggers re-render.
 * Handles both [media attached: ...] patterns and raw filePath entries.
 */
async function loadMissingPreviews(messages: RawMessage[], sessionKey?: string): Promise<boolean> {
  const materialized = await materializeAssistantOutputs(messages, sessionKey);
  // Collect all image paths that need previews
  const needPreview: Array<{ filePath: string; mimeType: string }> = [];
  const seenPaths = new Set<string>();

  for (const msg of messages) {
    if (!msg._attachedFiles) continue;

    // Path 1: files with explicit filePath field (raw path detection or enriched refs)
    for (const file of msg._attachedFiles) {
      const fp = file.filePath;
      if (!fp || seenPaths.has(fp)) continue;
      // Images: need preview. Non-images: need file size (for FileCard display).
      const needsLoad = file.mimeType.startsWith('image/')
        ? !file.preview
        : file.fileSize === 0;
      if (needsLoad) {
        seenPaths.add(fp);
        needPreview.push({ filePath: fp, mimeType: file.mimeType });
      }
    }

    // Path 2: [media attached: ...] patterns (legacy — in case filePath wasn't stored)
    if (msg.role === 'user') {
      const text = getMessageText(msg.content);
      const refs = extractMediaRefs(text);
      for (let i = 0; i < refs.length; i++) {
        const file = msg._attachedFiles[i];
        const ref = refs[i];
        if (!file || !ref || seenPaths.has(ref.filePath)) continue;
        const needsLoad = ref.mimeType.startsWith('image/') ? !file.preview : file.fileSize === 0;
        if (needsLoad) {
          seenPaths.add(ref.filePath);
          needPreview.push(ref);
        }
      }
    }
  }

  if (needPreview.length === 0) return materialized;

  try {
    const thumbnails = await invokeIpc(
      'media:getThumbnails',
      needPreview,
    ) as Record<string, { preview: string | null; fileSize: number }>;

    let updated = false;
    for (const msg of messages) {
      if (!msg._attachedFiles) continue;

      // Update files that have filePath
      for (const file of msg._attachedFiles) {
        const fp = file.filePath;
        if (!fp) continue;
        const thumb = thumbnails[fp];
        if (thumb && (thumb.preview || thumb.fileSize)) {
          if (thumb.preview) file.preview = thumb.preview;
          if (thumb.fileSize) file.fileSize = thumb.fileSize;
          _imageCache.set(fp, { ...file });
          updated = true;
        }
      }

      // Legacy: update by index for [media attached: ...] refs
      if (msg.role === 'user') {
        const text = getMessageText(msg.content);
        const refs = extractMediaRefs(text);
        for (let i = 0; i < refs.length; i++) {
          const file = msg._attachedFiles[i];
          const ref = refs[i];
          if (!file || !ref || file.filePath) continue; // skip if already handled via filePath
          const thumb = thumbnails[ref.filePath];
          if (thumb && (thumb.preview || thumb.fileSize)) {
            if (thumb.preview) file.preview = thumb.preview;
            if (thumb.fileSize) file.fileSize = thumb.fileSize;
            _imageCache.set(ref.filePath, { ...file });
            updated = true;
          }
        }
      }
    }
    if (updated) saveImageCache(_imageCache);
    return updated || materialized;
  } catch (err) {
    console.warn('[loadMissingPreviews] Failed:', err);
    return materialized;
  }
}

function getCanonicalPrefixFromSessions(sessions: ChatSession[]): string | null {
  const canonical = sessions.find((s) => s.key.startsWith('agent:'))?.key;
  if (!canonical) return null;
  const parts = canonical.split(':');
  if (parts.length < 2) return null;
  return `${parts[0]}:${parts[1]}`;
}

function isToolOnlyMessage(message: RawMessage | undefined): boolean {
  if (!message) return false;
  if (isToolResultRole(message.role)) return true;

  const msg = message as unknown as Record<string, unknown>;
  const content = message.content;

  // Check OpenAI-format tool_calls field (real-time streaming from OpenAI-compatible models)
  const toolCalls = msg.tool_calls ?? msg.toolCalls;
  const hasOpenAITools = Array.isArray(toolCalls) && toolCalls.length > 0;

  if (!Array.isArray(content)) {
    // Content is not an array — check if there's OpenAI-format tool_calls
    if (hasOpenAITools) {
      // Has tool calls but content might be empty/string — treat as tool-only
      // if there's no meaningful text content
      const textContent = typeof content === 'string' ? content.trim() : '';
      return textContent.length === 0;
    }
    return false;
  }

  let hasTool = hasOpenAITools;
  let hasText = false;
  let hasNonToolContent = false;

  for (const block of content as ContentBlock[]) {
    if (block.type === 'tool_use' || block.type === 'tool_result' || block.type === 'toolCall' || block.type === 'toolResult') {
      hasTool = true;
      continue;
    }
    if (block.type === 'text' && block.text && block.text.trim()) {
      hasText = true;
      continue;
    }
    // Only actual image output disqualifies a tool-only message.
    // Thinking blocks are internal reasoning that can accompany tool_use — they
    // should NOT prevent the message from being treated as an intermediate tool step.
    if (block.type === 'image') {
      hasNonToolContent = true;
    }
  }

  return hasTool && !hasText && !hasNonToolContent;
}

function isToolResultRole(role: unknown): boolean {
  if (!role) return false;
  const normalized = String(role).toLowerCase();
  return normalized === 'toolresult' || normalized === 'tool_result';
}

function isPreCompactionMemoryFlushPrompt(text: string): boolean {
  const normalized = text.trim();
  return /^Pre-compaction memory flush\./i.test(normalized)
    && /Store durable memories only in memory\//i.test(normalized)
    && /reply with NO_REPLY\./i.test(normalized);
}

/** True for internal plumbing messages that should never be shown in the UI. */
function isInternalMessage(msg: { role?: unknown; content?: unknown }): boolean {
  if (msg.role === 'system') return true;
  if (msg.role === 'user') {
    const text = getMessageText(msg.content);
    if (isPreCompactionMemoryFlushPrompt(text)) return true;
  }
  if (msg.role === 'assistant') {
    const text = getMessageText(msg.content);
    if (/^(HEARTBEAT_OK|NO_REPLY)\s*$/.test(text)) return true;
  }
  return false;
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content as ContentBlock[]) {
    if (block.type === 'text' && block.text) {
      parts.push(block.text);
    }
  }
  return parts.join('\n');
}

function summarizeToolOutput(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return undefined;
  const summaryLines = lines.slice(0, 2);
  let summary = summaryLines.join(' / ');
  if (summary.length > 160) {
    summary = `${summary.slice(0, 157)}...`;
  }
  return summary;
}

function normalizeToolName(name: string | undefined): string {
  return (name || 'tool').trim() || 'tool';
}

function normalizeToolFailureMessage(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().replace(/^Error:\s*/i, '');
  return normalized || undefined;
}

function normalizeToolStatus(rawStatus: unknown, fallback: 'running' | 'completed'): ToolStatus['status'] {
  const status = typeof rawStatus === 'string' ? rawStatus.toLowerCase() : '';
  if (status.includes('retry')) return 'retrying';
  if (status === 'error' || status === 'failed') return 'error';
  if (status === 'completed' || status === 'success' || status === 'done') return 'completed';
  return fallback;
}

function parseDurationMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function extractToolUseUpdates(message: unknown): ToolStatus[] {
  if (!message || typeof message !== 'object') return [];
  const msg = message as Record<string, unknown>;
  const updates: ToolStatus[] = [];

  // Path 1: Anthropic/normalized format — tool blocks inside content array
  const content = msg.content;
  if (Array.isArray(content)) {
    for (const block of content as ContentBlock[]) {
      if ((block.type !== 'tool_use' && block.type !== 'toolCall') || !block.name) continue;
      updates.push({
        id: block.id || block.name,
        toolCallId: block.id,
        name: block.name,
        status: 'running',
        updatedAt: Date.now(),
      });
    }
  }

  // Path 2: OpenAI format — tool_calls array on the message itself
  if (updates.length === 0) {
    const toolCalls = msg.tool_calls ?? msg.toolCalls;
    if (Array.isArray(toolCalls)) {
      for (const tc of toolCalls as Array<Record<string, unknown>>) {
        const fn = (tc.function ?? tc) as Record<string, unknown>;
        const name = typeof fn.name === 'string' ? fn.name : '';
        if (!name) continue;
        const id = typeof tc.id === 'string' ? tc.id : name;
        updates.push({
          id,
          toolCallId: typeof tc.id === 'string' ? tc.id : undefined,
          name,
          status: 'running',
          updatedAt: Date.now(),
        });
      }
    }
  }

  return updates;
}

function extractToolResultBlocks(message: unknown, _eventState: string): ToolStatus[] {
  if (!message || typeof message !== 'object') return [];
  const msg = message as Record<string, unknown>;
  const content = msg.content;
  if (!Array.isArray(content)) return [];

  const updates: ToolStatus[] = [];
  for (const block of content as ContentBlock[]) {
    if (block.type !== 'tool_result' && block.type !== 'toolResult') continue;
    const outputText = extractTextFromContent(block.content ?? block.text ?? '');
    const summary = summarizeToolOutput(outputText);
    updates.push({
      id: block.id || block.name || 'tool',
      toolCallId: block.id,
      name: block.name || block.id || 'tool',
      // A tool_result block means the tool has already produced a result.
      // Even during streaming deltas, treat missing statuses as completed so
      // earlier process cards don't stay stuck in a running state.
      status: normalizeToolStatus(block.status, 'completed'),
      summary,
      failureMessage: block.status === 'error' ? normalizeToolFailureMessage(outputText) : undefined,
      updatedAt: Date.now(),
    });
  }

  return updates;
}

function extractToolResultUpdate(message: unknown, eventState: string): ToolStatus | null {
  if (!message || typeof message !== 'object') return null;
  const msg = message as Record<string, unknown>;
  const role = typeof msg.role === 'string' ? msg.role.toLowerCase() : '';
  if (!isToolResultRole(role)) return null;

  const toolName = typeof msg.toolName === 'string' ? msg.toolName : (typeof msg.name === 'string' ? msg.name : '');
  const toolCallId = typeof msg.toolCallId === 'string' ? msg.toolCallId : undefined;
  const details = (msg.details && typeof msg.details === 'object') ? msg.details as Record<string, unknown> : undefined;
  const rawStatus = (msg.status ?? details?.status);
  const fallback = eventState === 'delta' ? 'running' : 'completed';
  const status = normalizeToolStatus(rawStatus, fallback);
  const durationMs = parseDurationMs(details?.durationMs ?? details?.duration ?? (msg as Record<string, unknown>).durationMs);

  const outputText = (details && typeof details.aggregated === 'string')
    ? details.aggregated
    : extractTextFromContent(msg.content);
  const failureMessage = normalizeToolFailureMessage(details?.error ?? msg.error);
  const summary = summarizeToolOutput(outputText) ?? summarizeToolOutput(failureMessage ?? '');

  const name = toolName || toolCallId || 'tool';
  const id = toolCallId || name;

  return {
    id,
    toolCallId,
    name,
    status,
    durationMs,
    summary,
    failureMessage,
    updatedAt: Date.now(),
  };
}

function createToolResultProcessMessage(message: RawMessage): RawMessage | null {
  if (!isToolResultRole(message.role)) return null;

  const msg = message as RawMessage & {
    name?: string;
    status?: string;
    error?: string;
  };
  const details = (msg.details && typeof msg.details === 'object') ? msg.details as Record<string, unknown> : undefined;
  const toolName = normalizeToolName(
    typeof msg.toolName === 'string'
      ? msg.toolName
      : (typeof msg.name === 'string' ? msg.name : undefined),
  );
  const toolCallId = typeof msg.toolCallId === 'string' ? msg.toolCallId : undefined;
  const outputText = (details && typeof details.aggregated === 'string')
    ? details.aggregated
    : extractTextFromContent(msg.content);
  const errorText = typeof details?.error === 'string'
    ? details.error
    : (typeof msg.error === 'string' ? msg.error : '');
  const detailText = outputText.trim() || errorText.trim() || toolName;
  const status = errorText.trim()
    ? 'error'
    : normalizeToolStatus(msg.status ?? details?.status, 'completed');
  const durationMs = parseDurationMs(details?.durationMs ?? details?.duration ?? ((msg as unknown as Record<string, unknown>).durationMs));

  return {
    ...message,
    role: 'assistant',
    id: message.id ? `${message.id}-tool-result` : `${toolCallId || toolName}-tool-result`,
    content: [
      {
        type: 'tool_result',
        id: toolCallId || message.id || toolName,
        name: toolName,
        status,
        durationMs,
        text: detailText,
        content: detailText,
      },
    ],
    _attachedFiles: [],
  };
}

function mergeToolStatus(existing: ToolStatus['status'], incoming: ToolStatus['status']): ToolStatus['status'] {
  const order: Record<ToolStatus['status'], number> = { running: 0, retrying: 1, completed: 2, error: 3 };
  return order[incoming] >= order[existing] ? incoming : existing;
}

function upsertToolStatuses(current: ToolStatus[], updates: ToolStatus[]): ToolStatus[] {
  if (updates.length === 0) return current;
  const next = [...current];
  for (const update of updates) {
    const key = update.toolCallId || update.id || update.name;
    if (!key) continue;
    const index = next.findIndex((tool) => (tool.toolCallId || tool.id || tool.name) === key);
    if (index === -1) {
      next.push(update);
      continue;
    }
    const existing = next[index];
    const isRetryTransition = existing.status === 'error' && (update.status === 'running' || update.status === 'retrying');
    const mergedStatus = isRetryTransition
      ? 'retrying'
      : (existing.status === 'retrying' && update.status === 'running')
        ? 'retrying'
        : mergeToolStatus(existing.status, update.status);
    const failureMessage = update.failureMessage
      ?? (update.status === 'error' ? update.summary : undefined)
      ?? ((mergedStatus === 'retrying' || mergedStatus === 'error') ? existing.failureMessage ?? existing.summary : undefined);
    next[index] = {
      ...existing,
      ...update,
      name: update.name || existing.name,
      status: mergedStatus,
      durationMs: update.durationMs ?? existing.durationMs,
      summary: update.summary ?? existing.summary,
      failureMessage,
      retries: isRetryTransition
        ? (existing.retries ?? 0) + 1
        : update.retries ?? existing.retries,
      updatedAt: update.updatedAt || existing.updatedAt,
    };
  }
  return next;
}

function collectToolUpdates(message: unknown, eventState: string): ToolStatus[] {
  const updates: ToolStatus[] = [];
  updates.push(...extractToolUseUpdates(message));
  updates.push(...extractToolResultBlocks(message, eventState));
  const toolResultUpdate = extractToolResultUpdate(message, eventState);
  if (toolResultUpdate) updates.push(toolResultUpdate);
  return updates;
}

const EMPTY_ASSISTANT_RESPONSE_ERROR = translateChat(
  'sessionErrors.emptyAssistantResponse',
  'The selected provider returned an empty response. Check the provider base URL, API protocol, model, and API key.',
);

function hasNonToolAssistantContent(message: RawMessage | undefined): boolean {
  if (!message) return false;
  if (Array.isArray(message._attachedFiles) && message._attachedFiles.length > 0) return true;
  if (typeof message.content === 'string' && message.content.trim()) return true;

  const content = message.content;
  if (Array.isArray(content)) {
    for (const block of content as ContentBlock[]) {
      if (block.type === 'text' && block.text && block.text.trim()) return true;
      if (block.type === 'thinking' && block.thinking && block.thinking.trim()) return true;
      if (block.type === 'image') return true;
    }
  }

  const msg = message as unknown as Record<string, unknown>;
  if (typeof msg.text === 'string' && msg.text.trim()) return true;

  return false;
}

/**
 * 判断 assistant 消息是否包含真正的最终文本回复内容。
 * 与 hasNonToolAssistantContent 的区别：不把 thinking 块视为"最终内容"。
 * 仅检查 text / image / attachedFiles / stopReason，用于 loadHistory
 * 终结判定，避免中间 thinking + tool_use 消息被误判为最终回复。
 */
function hasAssistantFinalTextContent(message: RawMessage | undefined): boolean {
  if (!message) return false;
  if (Array.isArray(message._attachedFiles) && message._attachedFiles.length > 0) return true;
  if (typeof message.content === 'string' && message.content.trim()) return true;

  if (Array.isArray(message.content)) {
    for (const block of message.content as ContentBlock[]) {
      if (block.type === 'text' && block.text && block.text.trim()) return true;
      if (block.type === 'image') return true;
    }
  }

  const msg = message as unknown as Record<string, unknown>;
  if (msg.stopReason || msg.stop_reason) return true;
  if (typeof msg.text === 'string' && msg.text.trim()) return true;

  return false;
}

function isEmptyAssistantResponse(message: RawMessage | undefined): boolean {
  if (!message || message.role !== 'assistant') return false;
  if (isInternalMessage(message)) return false;
  if (isToolOnlyMessage(message)) return false;
  return !hasNonToolAssistantContent(message);
}

function setHistoryPollTimer(timer: ReturnType<typeof setTimeout> | null): void {
  _historyPollTimer = timer;
}

function hasErrorRecoveryTimer(): boolean {
  return _errorRecoveryTimer != null;
}

function setErrorRecoveryTimer(timer: ReturnType<typeof setTimeout> | null): void {
  _errorRecoveryTimer = timer;
}

function setLastChatEventAt(value: number): void {
  _lastChatEventAt = value;
}

function getLastChatEventAt(): number {
  return _lastChatEventAt;
}

export {
  appendAssistantMessage,
  toMs,
  clearErrorRecoveryTimer,
  clearHistoryPoll,
  createLocalAssistantMessage,
  extractImagesAsAttachedFiles,
  getMessageText,
  getAssistantRuntimeErrorNotice,
  getContinueConversationWarning,
  getEmptyAssistantResponseError,
  getChatNoticeMessage,
  getInterruptedReplyError,
  getNoResponseError,
  getSendFailedError,
  extractMediaRefs,
  extractRawFilePaths,
  makeAttachedFile,
  enrichWithToolResultFiles,
  isInternalMessage,
  isToolResultRole,
  enrichWithCachedImages,
  loadMissingPreviews,
  upsertImageCacheEntry,
  getCanonicalPrefixFromSessions,
  getToolCallFilePath,
  createToolResultProcessMessage,
  collectToolUpdates,
  upsertToolStatuses,
  EMPTY_ASSISTANT_RESPONSE_ERROR,
  hasNonToolAssistantContent,
  hasAssistantFinalTextContent,
  hasStoredSessionLabel,
  hasComposerDraftContent,
  isEmptyAssistantResponse,
  isUnusedDraftSession,
  isToolOnlyMessage,
  setHistoryPollTimer,
  hasErrorRecoveryTimer,
  setErrorRecoveryTimer,
  setLastChatEventAt,
  getLastChatEventAt,
};
