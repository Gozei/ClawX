/**
 * Message Processing Pipeline
 *
 * Pure transformation functions for chat message processing.
 * These functions extract, normalize, filter, and deduplicate messages
 * from external sources (Gateway API, local storage).
 */

import type { AttachedFileMeta, ContentBlock, RawMessage, ToolStatus } from '../stores/chat/types';
import { sanitizeInboundUserText } from '../../shared/inbound-user-text';

/**
 * Check if a role represents a tool result message.
 */
function isToolResultRole(role: unknown): boolean {
  if (!role) return false;
  const normalized = String(role).toLowerCase();
  return normalized === 'toolresult' || normalized === 'tool_result';
}

/**
 * Check if a message is an internal/system message that should not be shown in the UI.
 */
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

function getMessageText(content: unknown): string {
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

function isPreCompactionMemoryFlushPrompt(text: string): boolean {
  const normalized = text.trim();
  return /^Pre-compaction memory flush\./i.test(normalized)
    && /Store durable memories only in memory\//i.test(normalized)
    && /reply with NO_REPLY\./i.test(normalized);
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

function extractMediaRefs(text: string): Array<{ filePath: string; mimeType: string }> {
  const refs: Array<{ filePath: string; mimeType: string }> = [];
  const pattern = /\[media attached:\s*([^)\s]+)(?:\s*\(([^)]*)\))?\s*(?:\|[^)]*)?\]/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    refs.push({
      filePath: match[1],
      mimeType: match[2] || 'application/octet-stream',
    });
  }
  return refs;
}

function extractRawFilePaths(text: string): Array<{ filePath: string; mimeType: string }> {
  const refs: Array<{ filePath: string; mimeType: string }> = [];
  const patterns = [
    // macOS/Unix paths - /Users/... pattern
    /\/Users\/[\w.-]+(\/[\w.-]+)*/g,
    // Windows paths - C:\... pattern
    /[A-Za-z]:\\[\w.-]+(?:\\[\w.-]+)*/g,
  ];

  const seen = new Set<string>();
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const filePath = match[0];
      if (seen.has(filePath)) continue;
      seen.add(filePath);
      refs.push({
        filePath,
        mimeType: inferMimeType(filePath),
      });
    }
  }
  return refs;
}

function inferMimeType(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const mimeMap: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    pdf: 'application/pdf',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    txt: 'text/plain',
    json: 'application/json',
  };
  return mimeMap[ext] || 'application/octet-stream';
}

function makeAttachedFile(ref: { filePath: string; mimeType: string }): AttachedFileMeta {
  const fileName = ref.filePath.split(/[\\/]/).pop() || 'file';
  return {
    fileName,
    mimeType: ref.mimeType,
    fileSize: 0,
    preview: null,
    filePath: ref.filePath,
  };
}

function cloneAttachedFiles(files: AttachedFileMeta[] | undefined): AttachedFileMeta[] | undefined {
  return files?.map((file) => ({ ...file }));
}

function normalizeToolName(name: string | undefined): string {
  return (name || 'tool').trim() || 'tool';
}

function normalizeToolStatus(rawStatus: unknown, fallback: 'running' | 'completed' | 'error'): ToolStatus['status'] {
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

function collectToolCallPaths(msg: RawMessage, toolCallPaths: Map<string, string>): void {
  const content = msg.content;
  if (!Array.isArray(content)) return;

  for (const block of content as ContentBlock[]) {
    if (block.type === 'tool_use' || block.type === 'toolCall') {
      const id = block.id || (block as { toolCallId?: string }).toolCallId;
      if (typeof id === 'string' && block.arguments) {
        try {
          const argsStr = typeof block.arguments === 'string'
            ? block.arguments
            : JSON.stringify(block.arguments);
          // Look for file paths in arguments
          const pathMatch = /["']((?:[\w.-]+[\\/])*[\w.-]+(?:\.[a-zA-Z0-9]+)?)["']/.exec(argsStr);
          if (pathMatch) {
            toolCallPaths.set(id, pathMatch[1]);
          }
        } catch {
          // Ignore parse errors
        }
      }
    }
  }
}

function extractImagesAsAttachedFiles(content: unknown): AttachedFileMeta[] {
  const files: AttachedFileMeta[] = [];
  if (!Array.isArray(content)) return files;

  for (const block of content as ContentBlock[]) {
    if (block.type === 'image' || block.type === 'tool_result') {
      let data: string | undefined;
      let mimeType: string | undefined;

      if (block.type === 'image') {
        if (block.source?.data) {
          data = block.source.data;
          mimeType = block.source.media_type;
        } else if (block.data) {
          data = block.data;
          mimeType = block.mimeType;
        }
      } else if (block.type === 'tool_result') {
        if (block.content) {
          // tool_result might have content as base64 data
          data = typeof block.content === 'string' ? block.content : undefined;
          mimeType = block.mimeType || 'image/png';
        }
      }

      if (data) {
        const isBase64 = /^[A-Za-z0-9+/=]+$/.test(data) && (data.length % 4 === 0);
        const fileName = block.name || `image-${Date.now()}`;
        files.push({
          fileName,
          mimeType: mimeType || (isBase64 ? 'image/png' : 'text/plain'),
          fileSize: isBase64 ? Math.floor((data.length * 3) / 4) : data.length,
          preview: data,
          filePath: undefined,
        });
      }
    }
  }

  return files;
}

// ============================================================================
// Normalization Pipeline
// ============================================================================

/**
 * Enrich tool_result messages with attached files.
 * Extracts image data and file paths from tool_result content blocks
 * and attaches them to the message for later attachment to assistant messages.
 */
export function enrichToolResultAttachments(messages: RawMessage[]): {
  messages: RawMessage[];
  pendingAttachments: AttachedFileMeta[];
} {
  const pending: AttachedFileMeta[] = [];
  const toolCallPaths = new Map<string, string>();

  const enriched = messages.map((msg) => {
    // Track file paths from assistant tool call arguments
    if (msg.role === 'assistant') {
      collectToolCallPaths(msg, toolCallPaths);
    }

    if (isToolResultRole(msg.role)) {
      // Resolve file path from the matching tool call
      const matchedPath = msg.toolCallId ? toolCallPaths.get(msg.toolCallId) : undefined;

      // 1. Image/file content blocks
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

      // 2. [media attached: ...] patterns
      const text = getMessageText(msg.content);
      if (text) {
        const mediaRefs = extractMediaRefs(text);
        const mediaRefPaths = new Set(mediaRefs.map((r) => r.filePath));
        for (const ref of mediaRefs) {
          pending.push(makeAttachedFile(ref));
        }
        // 3. Raw file paths
        for (const ref of extractRawFilePaths(text)) {
          if (!mediaRefPaths.has(ref.filePath)) {
            pending.push(makeAttachedFile(ref));
          }
        }
      }

      return msg;
    }

    if (msg.role === 'assistant' && pending.length > 0) {
      const toAttach = pending.splice(0);
      const existingPaths = new Set(
        (msg._attachedFiles || []).map((f) => f.filePath).filter(Boolean),
      );
      const newFiles = toAttach.filter((f) => !f.filePath || !existingPaths.has(f.filePath));
      if (newFiles.length === 0) return msg;
      return {
        ...msg,
        _attachedFiles: [...(msg._attachedFiles || []), ...newFiles],
      };
    }

    return msg;
  });

  return { messages: enriched, pendingAttachments: pending };
}

/**
 * Convert tool_result messages to assistant process messages.
 * Transforms the internal tool result representation into a standardized
 * process message format.
 */
export function normalizeToolResultMessages(messages: RawMessage[]): RawMessage[] {
  return messages.map((msg) => createToolResultProcessMessage(msg) ?? msg);
}

export function createToolResultProcessMessage(message: RawMessage): RawMessage | null {
  if (!isToolResultRole(message.role)) return null;

  const msg = message as RawMessage & {
    name?: string;
    status?: string;
    error?: string;
  };
  const details = msg.details && typeof msg.details === 'object'
    ? msg.details as Record<string, unknown>
    : undefined;
  const toolName = normalizeToolName(
    typeof msg.toolName === 'string'
      ? msg.toolName
      : typeof msg.name === 'string' ? msg.name : undefined,
  );
  const toolCallId = typeof msg.toolCallId === 'string' ? msg.toolCallId : undefined;
  const outputText = details && typeof details.aggregated === 'string'
    ? details.aggregated
    : extractTextFromContent(msg.content);
  const errorText = typeof details?.error === 'string'
    ? details.error
    : typeof msg.error === 'string' ? msg.error : '';
  const detailText = outputText.trim() || errorText.trim() || toolName;
  const status = errorText.trim()
    ? 'error'
    : normalizeToolStatus(msg.status ?? details?.status, 'completed');
  const durationMs = parseDurationMs(details?.durationMs ?? details?.duration ?? (msg as unknown as Record<string, unknown>).durationMs);

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
    _attachedFiles: cloneAttachedFiles(message._attachedFiles),
  };
}

/**
 * Enrich messages with cached image attachments from local file references.
 * Restores _attachedFiles for messages loaded from history by scanning
 * message text for file paths and [media attached: ...] patterns.
 *
 * @param messages - Messages to enrich
 * @param imageCache - Map of file paths to cached preview data
 */
export function enrichCachedAttachments(
  messages: RawMessage[],
  imageCache?: Map<string, AttachedFileMeta>,
): RawMessage[] {
  const cache = imageCache || new Map();
  return messages.map((msg, idx) => {
    if ((msg.role !== 'user' && msg.role !== 'assistant') || msg._attachedFiles) return msg;
    const text = getMessageText(msg.content);

    // Path 1: [media attached: path (mime) | path]
    const mediaRefs = extractMediaRefs(text);
    const mediaRefPaths = new Set(mediaRefs.map((r) => r.filePath));

    // Path 2: Raw file paths
    let rawRefs: Array<{ filePath: string; mimeType: string }> = [];
    if (msg.role === 'assistant' && !isToolOnlyMessage(msg)) {
      rawRefs = extractRawFilePaths(text).filter((r) => !mediaRefPaths.has(r.filePath));

      // Look back for preceding user message text
      const seenPaths = new Set(rawRefs.map((r) => r.filePath));
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
          break;
        }
      }
    }

    const allRefs = [...mediaRefs, ...rawRefs];
    if (allRefs.length === 0) return msg;

    const files: AttachedFileMeta[] = allRefs.map((ref) => {
      const cached = cache.get(ref.filePath);
      if (cached) return { ...cached, filePath: ref.filePath };
      const fileName = ref.filePath.split(/[\\/]/).pop() || 'file';
      return { fileName, mimeType: ref.mimeType, fileSize: 0, preview: null, filePath: ref.filePath };
    });
    return { ...msg, _attachedFiles: files };
  });
}

function isToolOnlyMessage(message: RawMessage | undefined): boolean {
  if (!message || message.role !== 'assistant') return false;
  const content = message.content;
  if (!Array.isArray(content)) return false;

  let hasText = false;
  let hasToolContent = false;

  for (const block of content as ContentBlock[]) {
    if (block.type === 'text' && block.text?.trim()) hasText = true;
    if (
      block.type === 'tool_use'
      || block.type === 'toolCall'
      || block.type === 'tool_result'
      || block.type === 'toolResult'
    ) hasToolContent = true;
  }

  return hasToolContent && !hasText;
}

// ============================================================================
// Filter Pipeline
// ============================================================================

/**
 * Filter out tool_result messages.
 * These are normalized to process messages and shouldn't be shown directly.
 */
export function filterToolResults(messages: RawMessage[]): RawMessage[] {
  return messages.filter((msg) => !isToolResultRole(msg.role));
}

/**
 * Filter out internal/system messages that should not be shown in the UI.
 */
export function filterInternalMessages(messages: RawMessage[]): RawMessage[] {
  return messages.filter((msg) => !isInternalMessage(msg));
}

/**
 * Combined filter that removes tool_result and internal messages.
 */
export function filterMessages(messages: RawMessage[]): RawMessage[] {
  return messages.filter((msg) => !isToolResultRole(msg.role) && !isInternalMessage(msg));
}

// ============================================================================
// High-level Pipeline Wrappers
// ============================================================================

/**
 * Normalize raw messages from external sources.
 * Enriches tool result attachments and normalizes tool_result messages to
 * assistant process messages.
 */
export function normalizeMessagePipeline(messages: RawMessage[]): RawMessage[] {
  const { messages: enriched } = enrichToolResultAttachments(messages);
  return normalizeToolResultMessages(enriched);
}

/**
 * Filter messages for display.
 * Removes tool_result role messages and internal/system messages.
 */
export function filterMessagePipeline(messages: RawMessage[]): RawMessage[] {
  return filterMessages(messages);
}

/**
 * Deduplicate assistant messages within the same turn.
 * Thin wrapper around dedupeAssistantMessages for pipeline consistency.
 */
export function dedupeMessagePipeline(messages: RawMessage[]): RawMessage[] {
  return dedupeAssistantMessages(messages);
}

// ============================================================================
// Deduplication Pipeline
// ============================================================================

function cleanUserMessageText(text: string): string {
  const cleaned = sanitizeInboundUserText(text);
  return isPreCompactionMemoryFlushPrompt(cleaned) ? '' : cleaned;
}

function getComparableMessageText(
  message: Pick<RawMessage, 'role' | 'content'> | null | undefined,
): string {
  if (!message) return '';
  const rawText = getMessageText(message.content);
  const comparableText = message.role === 'user'
    ? cleanUserMessageText(rawText)
    : rawText;
  return comparableText.trim();
}

function normalizeAssistantStreamText(value: string): string {
  return value
    .replace(/(\*\*|__|~~|`+)/g, '')
    .replace(/[\s\u00A0\u1680\u180E\u2000-\u200D\u2028\u2029\u202F\u205F\u3000\uFEFF]+/g, '');
}

function isSettledFinalAssistantMessage(message: RawMessage | undefined): boolean {
  if (!message || message.role !== 'assistant') return false;
  const content = message.content;
  if (typeof content !== 'string' && !Array.isArray(content)) return false;

  if (typeof content === 'string') return content.trim().length > 0;
  if (!Array.isArray(content)) return false;

  for (const block of content as ContentBlock[]) {
    if (block.type === 'text' && block.text?.trim()) return true;
    if (
      block.type === 'tool_use'
      || block.type === 'toolCall'
      || block.type === 'tool_result'
      || block.type === 'toolResult'
    ) return true;
  }

  return false;
}

type DuplicateDirection = 'candidate-contains-existing' | 'existing-contains-candidate' | null;

function getContainedAssistantDuplicateDirection(
  existing: RawMessage,
  candidate: RawMessage,
): DuplicateDirection {
  if (existing.role !== 'assistant' || candidate.role !== 'assistant') return null;
  if (!isSettledFinalAssistantMessage(existing) || !isSettledFinalAssistantMessage(candidate)) return null;

  const existingText = normalizeAssistantStreamText(getComparableMessageText(existing));
  const candidateText = normalizeAssistantStreamText(getComparableMessageText(candidate));
  if (existingText === candidateText) return null;

  // First check prefix match - this is unambiguous
  if (candidateText.startsWith(existingText)) return 'candidate-contains-existing';
  if (existingText.startsWith(candidateText)) return 'existing-contains-candidate';

  // For substring matching (not prefix), use heuristics to avoid false positives.
  const MIN_CONTENT_LENGTH = 6;
  const MIN_LENGTH_RATIO = 1.2;
  if (
    existingText.length >= MIN_CONTENT_LENGTH
    && candidateText.length >= existingText.length * MIN_LENGTH_RATIO
    && candidateText.includes(existingText)
  ) {
    return 'candidate-contains-existing';
  }
  if (
    candidateText.length >= MIN_CONTENT_LENGTH
    && existingText.length >= candidateText.length * MIN_LENGTH_RATIO
    && existingText.includes(candidateText)
  ) {
    return 'existing-contains-candidate';
  }

  return null;
}

function mergeAttachedFilesForDuplicate(preferred: RawMessage, duplicate: RawMessage): RawMessage {
  const preferredFiles = preferred._attachedFiles || [];
  const duplicateFiles = duplicate._attachedFiles || [];
  const existingPaths = new Set(preferredFiles.map((f) => f.filePath).filter(Boolean));
  const newFiles = duplicateFiles.filter((f) => !f.filePath || !existingPaths.has(f.filePath));
  if (newFiles.length === 0) return preferred;
  return {
    ...preferred,
    _attachedFiles: [...preferredFiles, ...newFiles],
  };
}

function buildMessageContentKey(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return JSON.stringify(content);
  return '';
}

function messageExistsByIdentityOrText(messages: RawMessage[], candidate: RawMessage): boolean {
  if (candidate.id && messages.some((message) => message.id === candidate.id)) return true;
  const candidateText = getComparableMessageText(candidate);
  const candidateAssistantText = candidate.role === 'assistant'
    ? normalizeAssistantStreamText(candidateText)
    : '';
  const candidateContentKey = buildMessageContentKey(candidate.content);
  return messages.some((message) => {
    if (message.role !== candidate.role) return false;
    if (
      candidateAssistantText
      && normalizeAssistantStreamText(getComparableMessageText(message)) === candidateAssistantText
    ) {
      return true;
    }
    if (candidateText && getComparableMessageText(message) === candidateText) return true;
    return !!candidateContentKey && buildMessageContentKey(message.content) === candidateContentKey;
  });
}

/**
 * Deduplicate assistant messages within the same turn.
 * Removes duplicate assistant messages where one is a prefix or substring
 * of the other (common during streaming updates).
 */
export function dedupeAssistantMessages(messages: RawMessage[]): RawMessage[] {
  let changed = false;
  let currentTurnAssistants: RawMessage[] = [];
  const deduped: RawMessage[] = [];

  for (const message of messages) {
    if (message.role === 'user') {
      currentTurnAssistants = [];
      deduped.push(message);
      continue;
    }

    if (message.role === 'assistant') {
      const existingIndex = currentTurnAssistants.findIndex((assistant) => (
        messageExistsByIdentityOrText([assistant], message)
        || getContainedAssistantDuplicateDirection(assistant, message) != null
      ));

      if (existingIndex >= 0) {
        const existing = currentTurnAssistants[existingIndex];
        const direction = getContainedAssistantDuplicateDirection(existing, message);
        const shouldPreferCandidate = direction === 'candidate-contains-existing';
        const replacement = shouldPreferCandidate
          ? mergeAttachedFilesForDuplicate(message, existing)
          : mergeAttachedFilesForDuplicate(existing, message);
        const dedupedIndex = deduped.indexOf(existing);
        if (dedupedIndex >= 0) {
          deduped[dedupedIndex] = replacement;
        }
        currentTurnAssistants[existingIndex] = replacement;
        changed = true;
        continue;
      }
    }

    deduped.push(message);
    if (message.role === 'assistant') {
      currentTurnAssistants.push(message);
    }
  }

  return changed ? deduped : messages;
}

// ============================================================================
// Export all pure functions
// ============================================================================

export {
  isInternalMessage,
  isToolResultRole,
  getMessageText,
  isPreCompactionMemoryFlushPrompt,
  extractTextFromContent,
  extractMediaRefs,
  extractRawFilePaths,
  makeAttachedFile,
  cloneAttachedFiles,
  normalizeToolName,
  normalizeToolStatus,
  parseDurationMs,
  buildMessageContentKey,
  getComparableMessageText,
  normalizeAssistantStreamText,
  isSettledFinalAssistantMessage,
  getContainedAssistantDuplicateDirection,
  mergeAttachedFilesForDuplicate,
  messageExistsByIdentityOrText,
};
