/**
 * Message content extraction helpers
 * Ported from OpenClaw's message-extract.ts to handle the various
 * message content formats returned by the Gateway.
 */
import type { RawMessage, ContentBlock } from '@/stores/chat';

/** 不参与正文回退拼接的工具/思考类块（避免重复与噪音） */
function isNonBodyAssistantBlockType(type: string | undefined): boolean {
  if (!type) return false;
  const t = type.toLowerCase();
  return t === 'thinking'
    || t === 'tool_use'
    || t === 'toolcall'
    || t === 'tool_result'
    || t === 'toolresult'
    || t === 'image';
}

const SYSTEM_LINE_RE = /^System(?: \(untrusted\))?:\s*(?:\[[^\]]+\]\s*)?(.*)$/i;
const EXEC_SYSTEM_RE = /^Exec (?:completed|finished)\s*\(([^)]*)\)(?:\s*::\s*([\s\S]*))?$/i;
const CONVERSATION_INFO_PREFIX_RE = /^Conversation info\s*\([^)]*\):/i;
const HEARTBEAT_PROMPT_LINE_RE =
  /^(如果存在 HEARTBEAT\.md|Read HEARTBEAT\.md if it exists|读取 HEARTBEAT\.md 时|Current time:|当前时间：)/i;

function summarizeSystemHeartbeatNoise(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return '';

  let execCount = 0;
  let abnormalExecCount = 0;
  let heartbeatLineCount = 0;
  let otherSystemLineCount = 0;

  for (const line of lines) {
    if (HEARTBEAT_PROMPT_LINE_RE.test(line)) {
      heartbeatLineCount += 1;
      continue;
    }

    const systemMatch = line.match(SYSTEM_LINE_RE);
    if (!systemMatch) {
      return text;
    }

    const payload = systemMatch[1]?.trim() ?? '';
    const execMatch = payload.match(EXEC_SYSTEM_RE);
    if (execMatch) {
      execCount += 1;
      const metadata = execMatch[1] ?? '';
      const exitCode = metadata.match(/(?:^|,\s*)code\s+(-?\d+)/i)?.[1];
      if ((exitCode && exitCode !== '0') || /signal\s+\S+/i.test(metadata)) {
        abnormalExecCount += 1;
      }
      continue;
    }

    if (payload) {
      otherSystemLineCount += 1;
      continue;
    }

    return text;
  }

  if (execCount === 0 && heartbeatLineCount === 0) {
    return text;
  }

  // Hide heartbeat-only prompt injection from the visible chat transcript.
  // It's internal workspace context, not user-authored content.
  if (execCount === 0 && otherSystemLineCount === 0 && heartbeatLineCount > 0) {
    return '';
  }

  const summaryLines: string[] = [];
  if (execCount > 0) {
    let execSummary = `系统事件：已记录 ${execCount} 个后台执行结果`;
    if (abnormalExecCount > 0) {
      execSummary += `，其中 ${abnormalExecCount} 个异常退出`;
    }
    summaryLines.push(`${execSummary}。`);
  }

  if (otherSystemLineCount > 0) {
    summaryLines.push(`系统提示：另有 ${otherSystemLineCount} 条附加系统事件。`);
  }

  if (heartbeatLineCount > 0) {
    summaryLines.push('心跳检查：已附带工作区 HEARTBEAT 提示。');
  }

  return summaryLines.join('\n');
}

function stripInjectedConversationInfo(text: string): string {
  if (!CONVERSATION_INFO_PREFIX_RE.test(text)) {
    return text;
  }

  const withoutConversationInfo = text
    .replace(/^Conversation info\s*\([^)]*\):\s*```[a-z]*\n[\s\S]*?```\s*/i, '')
    .replace(/^Conversation info\s*\([^)]*\):\s*\{[\s\S]*?\}\s*/i, '');

  return withoutConversationInfo.replace(/^Execution playbook:\s*(?:\r?\n- .*)+\s*/i, '');
}

/**
 * Clean Gateway metadata from user message text for display.
 * Strips: [media attached: ... | ...], [message_id: ...],
 * and the timestamp prefix [Day Date Time Timezone].
 */
function cleanUserText(text: string): string {
  const cleaned = stripInjectedConversationInfo(text
    // Remove [media attached: path (mime) | path] references
    .replace(/\s*\[media attached:[^\]]*\]/g, '')
    // Remove [message_id: uuid]
    .replace(/\s*\[message_id:\s*[^\]]+\]/g, '')
    // Remove Gateway timestamp prefix like [Fri 2026-02-13 22:39 GMT+8]
    .replace(/^\[(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+[^\]]+\]\s*/i, ''))
    .trim();

  return summarizeSystemHeartbeatNoise(cleaned);
}

/**
 * Extract displayable text from a message's content field.
 * Handles both string content and array-of-blocks content.
 * For user messages, strips Gateway-injected metadata.
 */
export function extractText(message: RawMessage | unknown): string {
  if (!message || typeof message !== 'object') return '';
  const msg = message as Record<string, unknown>;
  const content = msg.content;
  const isUser = msg.role === 'user';

  let result = '';

  if (typeof content === 'string') {
    result = content.trim().length > 0 ? content : '';
  } else if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content as ContentBlock[]) {
      if (block.type === 'text' && block.text) {
        if (block.text.trim().length > 0) {
          parts.push(block.text);
        }
      }
    }
    let combined = parts.join('\n\n');
    result = combined.trim().length > 0 ? combined : '';

    // 助手消息：网关可能使用非标准 content 块（仅有 type + content 字符串等），标准 text 块为空时回退拼接，避免界面空白
    if (!result && !isUser) {
      const fallbackParts: string[] = [];
      for (const block of content as ContentBlock[]) {
        const blockType = typeof block.type === 'string' ? block.type : '';
        if (blockType === 'text' || isNonBodyAssistantBlockType(blockType)) {
          continue;
        }
        const rec = block as unknown as Record<string, unknown>;
        const piece = typeof rec.text === 'string'
          ? rec.text
          : typeof rec.content === 'string'
            ? rec.content
            : '';
        const trimmed = piece.trim();
        if (trimmed) {
          fallbackParts.push(trimmed);
        }
      }
      combined = fallbackParts.join('\n\n');
      result = combined.trim().length > 0 ? combined : '';
    }
  } else if (typeof msg.text === 'string') {
    // Fallback: try .text field
    result = msg.text.trim().length > 0 ? msg.text : '';
  }

  // Strip Gateway metadata from user messages for clean display
  if (isUser && result) {
    result = cleanUserText(result);
  }

  return result;
}

/**
 * Extract thinking/reasoning content from a message.
 * Returns null if no thinking content found.
 */
export function extractThinking(message: RawMessage | unknown): string | null {
  if (!message || typeof message !== 'object') return null;
  const msg = message as Record<string, unknown>;
  const content = msg.content;

  if (!Array.isArray(content)) return null;

  const parts: string[] = [];
  for (const block of content as ContentBlock[]) {
    if (block.type === 'thinking' && block.thinking) {
      const cleaned = block.thinking.trim();
      if (cleaned) {
        parts.push(cleaned);
      }
    }
  }

  const combined = parts.join('\n\n').trim();
  return combined.length > 0 ? combined : null;
}

/**
 * Extract media file references from Gateway-formatted user message text.
 * Returns array of { filePath, mimeType } from [media attached: path (mime) | path] patterns.
 */
export function extractMediaRefs(message: RawMessage | unknown): Array<{ filePath: string; mimeType: string }> {
  if (!message || typeof message !== 'object') return [];
  const msg = message as Record<string, unknown>;
  if (msg.role !== 'user') return [];
  const content = msg.content;

  let text = '';
  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    text = (content as ContentBlock[])
      .filter(b => b.type === 'text' && b.text)
      .map(b => b.text!)
      .join('\n');
  }

  const refs: Array<{ filePath: string; mimeType: string }> = [];
  const regex = /\[media attached:\s*([^\s(]+)\s*\(([^)]+)\)\s*\|[^\]]*\]/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    refs.push({ filePath: match[1], mimeType: match[2] });
  }
  return refs;
}

/**
 * Extract image attachments from a message.
 * Returns array of { mimeType, data } for base64 images.
 */
export function extractImages(message: RawMessage | unknown): Array<{ mimeType: string; data: string }> {
  if (!message || typeof message !== 'object') return [];
  const msg = message as Record<string, unknown>;
  const content = msg.content;

  if (!Array.isArray(content)) return [];

  const images: Array<{ mimeType: string; data: string }> = [];
  for (const block of content as ContentBlock[]) {
    if (block.type === 'image') {
      // Path 1: Anthropic source-wrapped format
      if (block.source) {
        const src = block.source;
        if (src.type === 'base64' && src.media_type && src.data) {
          images.push({ mimeType: src.media_type, data: src.data });
        }
      }
      // Path 2: Flat format from Gateway tool results {data, mimeType}
      else if (block.data) {
        images.push({ mimeType: block.mimeType || 'image/jpeg', data: block.data });
      }
    }
  }

  return images;
}

/**
 * Extract tool use blocks from a message.
 * Handles both Anthropic format (tool_use in content array) and
 * OpenAI format (tool_calls array on the message object).
 */
export function extractToolUse(message: RawMessage | unknown): Array<{ id: string; name: string; input: unknown }> {
  if (!message || typeof message !== 'object') return [];
  const msg = message as Record<string, unknown>;
  const tools: Array<{ id: string; name: string; input: unknown }> = [];

  // Path 1: Anthropic/normalized format — tool_use / toolCall blocks inside content array
  const content = msg.content;
  if (Array.isArray(content)) {
    for (const block of content as ContentBlock[]) {
      if ((block.type === 'tool_use' || block.type === 'toolCall') && block.name) {
        tools.push({
          id: block.id || '',
          name: block.name,
          input: block.input ?? block.arguments,
        });
      }
    }
  }

  // Path 2: OpenAI format — tool_calls array on the message itself
  // Real-time streaming events from OpenAI-compatible models (DeepSeek, etc.)
  // use this format; the Gateway normalizes to Path 1 when storing history.
  if (tools.length === 0) {
    const toolCalls = msg.tool_calls ?? msg.toolCalls;
    if (Array.isArray(toolCalls)) {
      for (const tc of toolCalls as Array<Record<string, unknown>>) {
        const fn = (tc.function ?? tc) as Record<string, unknown>;
        const name = typeof fn.name === 'string' ? fn.name : '';
        if (!name) continue;
        let input: unknown;
        try {
          input = typeof fn.arguments === 'string' ? JSON.parse(fn.arguments) : fn.arguments ?? fn.input;
        } catch {
          input = fn.arguments;
        }
        tools.push({
          id: typeof tc.id === 'string' ? tc.id : '',
          name,
          input,
        });
      }
    }
  }

  return tools;
}

/** 判断助手消息是否会在 ChatMessage 中渲染出任意可见块（用于兜底提示） */
export function assistantMessageShowsInChat(
  message: RawMessage,
  options: { showThinking: boolean; showTools: boolean },
): boolean {
  if (message.role !== 'assistant') return false;
  if (extractText(message).trim().length > 0) return true;
  if (extractImages(message).length > 0) return true;
  const files = message._attachedFiles;
  if (Array.isArray(files) && files.length > 0) return true;
  if (options.showThinking && (extractThinking(message)?.trim().length ?? 0) > 0) return true;
  if (options.showTools && extractToolUse(message).length > 0) return true;
  return false;
}

/**
 * Format a Unix timestamp (seconds) to relative time string.
 */
export function formatTimestamp(timestamp: unknown): string {
  if (!timestamp) return '';
  const ts = typeof timestamp === 'number' ? timestamp : Number(timestamp);
  if (!ts || isNaN(ts)) return '';

  // OpenClaw timestamps can be in seconds or milliseconds
  const ms = ts > 1e12 ? ts : ts * 1000;
  const date = new Date(ms);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();

  if (diffMs < 60000) return '刚刚';
  if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)} 分钟前`;
  if (diffMs < 86400000) return `${Math.floor(diffMs / 3600000)} 小时前`;

  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
