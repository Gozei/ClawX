/* eslint-disable react-refresh/only-export-components */
import { memo, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ContentBlock, RawMessage, ToolStatus } from '@/stores/chat';
import type { ChatProcessDisplayMode } from '@/stores/settings';
import { cn } from '@/lib/utils';
import { sanitizeToolOutputText } from '@/lib/tool-output-text';
import { MarkdownRenderer } from './MarkdownRenderer';
import { StreamingMarkdownPreview } from './StreamingMarkdownPreview';

type ProcessSurface = 'thinking' | 'terminal' | 'code' | 'read' | 'tool' | 'note';
type ProcessAction = 'generic' | 'browser_start' | 'browser_page' | 'browser' | 'shell' | 'code' | 'read';

export type ProcessEventItem = {
  key: string;
  kind: 'thinking' | 'tool_call' | 'tool_result' | 'tool_status' | 'note';
  surface: ProcessSurface;
  action?: ProcessAction;
  title: string;
  label?: string;
  preview?: string;
  detail?: string;
  status?: ToolStatus['status'];
  durationMs?: number;
  toolCallId?: string;
  toolName?: string;
  failureMessage?: string;
  retries?: number;
};

function formatRetryAttemptCount(
  retries: number | undefined,
  language: string | undefined,
): string | null {
  if (!retries || !Number.isFinite(retries) || retries <= 0) return null;
  return normalizeLocale(language) === 'zh'
    ? `第${retries}次`
    : `attempt ${retries}`;
}

function formatRetryExhaustedCount(
  retries: number | undefined,
  language: string | undefined,
): string | null {
  if (!retries || !Number.isFinite(retries) || retries <= 0) return null;
  if (normalizeLocale(language) === 'zh') {
    return `已重试${retries}次`;
  }
  return retries === 1
    ? 'after 1 retry'
    : `after ${retries} retries`;
}

function truncate(text: string, maxLength = 96): string {
  const normalized = sanitizeToolOutputText(text).replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3)}...`;
}

const HEARTBEAT_TASK_CHECK_COPY_RE =
  /用户又在发送心跳检查请求，我需要读取 HEARTBEAT\.md 文件确认是否有需要处理的任务。?/g;
const HEARTBEAT_TASK_CHECK_COPY =
  '发送心跳检查请求，系统读取 HEARTBEAT.md 文件跟进待办任务。';

function normalizeRoutineProcessCopy(text: string): string {
  return text.replace(HEARTBEAT_TASK_CHECK_COPY_RE, HEARTBEAT_TASK_CHECK_COPY);
}

const HEARTBEAT_FILE_RE = /(?:^|[\\/])HEARTBEAT\.md\b/i;
const INTERNAL_HEARTBEAT_PATH_RE = /(?:^|[\\/])\.openclaw[\\/]+workspace[\\/]+HEARTBEAT\.md\b/i;
const HEARTBEAT_INTERNAL_TEXT_RE =
  /(?:Read HEARTBEAT\.md if it exists|如果存在 HEARTBEAT\.md|读取 HEARTBEAT\.md 时|HEARTBEAT_OK|NO_REPLY|heartbeat check|heartbeat检查|当前时间：|Current time:|用户要求我读取 ?HEARTBEAT\.md|用户发来了heartbeat检查请求|用户又发了一次心跳检查)/i;

const HEARTBEAT_INTERNAL_ENGLISH_RE =
  /(?:the user is asking me to check heartbeat\.md again|routine heartbeat check|respond with heartbeat_ok|nothing that needs attention)/i;

function isHeartbeatPath(value: string | undefined): boolean {
  if (!value) return false;
  return HEARTBEAT_FILE_RE.test(value.trim());
}

function isInternalHeartbeatPath(value: string | undefined): boolean {
  if (!value) return false;
  return INTERNAL_HEARTBEAT_PATH_RE.test(value.trim());
}

function isHeartbeatProcessText(value: string | undefined): boolean {
  if (!value) return false;
  const text = value.trim();
  if (!text) return false;
  return HEARTBEAT_INTERNAL_TEXT_RE.test(text)
    || HEARTBEAT_INTERNAL_ENGLISH_RE.test(text)
    || (text.includes('HEARTBEAT.md') && /(?:heartbeat|心跳|工作区|workspace)/i.test(text));
}

function shouldHideHeartbeatProcessItem(item: ProcessEventItem): boolean {
  const detail = item.detail?.trim();
  const preview = item.preview?.trim();
  const label = item.label?.trim();

  if (item.surface === 'read' && [detail, preview, label].some((value) => isInternalHeartbeatPath(value))) {
    return true;
  }

  if (item.kind === 'thinking' || item.kind === 'note') {
    return [detail, preview].some((value) => isHeartbeatProcessText(value))
      && [detail, preview].some((value) => isHeartbeatPath(value) || isInternalHeartbeatPath(value));
  }

  return [detail, preview].some((value) => isHeartbeatProcessText(value))
    && [detail, preview].some((value) => isInternalHeartbeatPath(value));
}

function isInternalHeartbeatReadItem(item: ProcessEventItem): boolean {
  if (item.surface !== 'read') return false;
  return [item.detail?.trim(), item.preview?.trim(), item.label?.trim()].some((value) => isInternalHeartbeatPath(value));
}

function formatUnknownContent(value: unknown): string {
  if (typeof value === 'string') return sanitizeToolOutputText(value);
  if (Array.isArray(value)) {
    return sanitizeToolOutputText(value
      .map((item) => {
        if (!item || typeof item !== 'object') return '';
        const block = item as ContentBlock;
        if (typeof block.text === 'string') return block.text;
        if (typeof block.thinking === 'string') return block.thinking;
        return '';
      })
      .filter(Boolean)
      .join('\n\n')
      .trim());
  }
  if (value == null) return '';
  try {
    return sanitizeToolOutputText(JSON.stringify(value, null, 2));
  } catch {
    return sanitizeToolOutputText(String(value));
  }
}

function normalizeToolName(name: string | undefined): string {
  return (name || 'tool').trim() || 'tool';
}

function classifySurface(toolName: string | undefined, payload: unknown): { surface: ProcessSurface; title: string; action?: ProcessAction } {
  const normalizedName = normalizeToolName(toolName);
  const lowerName = normalizedName.toLowerCase();
  const payloadText = formatUnknownContent(payload).toLowerCase();

  if (lowerName.includes('browser')) {
    const payloadRecord = (payload && typeof payload === 'object' && !Array.isArray(payload))
      ? payload as Record<string, unknown>
      : null;
    const rawAction = payloadRecord && typeof payloadRecord.action === 'string'
      ? payloadRecord.action.toLowerCase()
      : '';
    const looksLikeBrowserStart = rawAction.includes('start')
      || rawAction.includes('launch')
      || rawAction.includes('enable')
      || rawAction.includes('init')
      || payloadText.includes('"enabled"')
      || payloadText.includes('"profile"')
      || payloadText.includes('"driver"');
    const looksLikePageOpen = rawAction.includes('goto')
      || rawAction.includes('navigate')
      || rawAction.includes('open')
      || rawAction.includes('tab')
      || rawAction.includes('page')
      || payloadText.includes('"url"')
      || payloadText.includes('"targetid"')
      || payloadText.includes('"title"');

    return {
      surface: 'tool',
      title: normalizedName,
      action: looksLikeBrowserStart ? 'browser_start' : (looksLikePageOpen ? 'browser_page' : 'browser'),
    };
  }

  if (
    lowerName.includes('shell')
    || lowerName.includes('terminal')
    || lowerName.includes('command')
    || payloadText.includes('"command"')
  ) {
    return { surface: 'terminal', title: 'Shell', action: 'shell' };
  }

  if (
    lowerName.includes('patch')
    || lowerName.includes('edit')
    || lowerName.includes('write')
    || lowerName.includes('diff')
    || payloadText.includes('*** begin patch')
    || payloadText.includes('"patch"')
  ) {
    return { surface: 'code', title: 'Code', action: 'code' };
  }

  if (
    lowerName.includes('read')
    || lowerName.includes('open')
    || lowerName.includes('find')
    || lowerName.includes('search')
    || payloadText.includes('"path"')
    || payloadText.includes('"file_path"')
  ) {
    return { surface: 'read', title: 'Read', action: 'read' };
  }

  return { surface: 'tool', title: normalizedName, action: 'generic' };
}

function getToolPreview(payload: unknown): string | undefined {
  if (payload == null) return undefined;
  if (typeof payload === 'string') {
    return truncate(payload, 88);
  }
  if (typeof payload !== 'object') {
    return truncate(String(payload), 88);
  }

  const record = payload as Record<string, unknown>;
  if (Object.keys(record).length === 0) {
    return undefined;
  }
  const command = record.command ?? record.cmd ?? record.script;
  if (typeof command === 'string' && command.trim()) {
    return truncate(command, 88) || undefined;
  }

  const path = record.file_path ?? record.filePath ?? record.path ?? record.file;
  if (typeof path === 'string' && path.trim()) {
    return truncate(path, 88) || undefined;
  }

  const patch = record.patch ?? record.diff;
  if (typeof patch === 'string' && patch.trim()) {
    return truncate(patch, 88) || undefined;
  }

  return truncate(formatUnknownContent(payload), 88) || undefined;
}

function getStatusByKey(streamingTools: ToolStatus[]): Map<string, ToolStatus> {
  const toolMap = new Map<string, ToolStatus>();
  for (const tool of streamingTools) {
    const key = tool.toolCallId || tool.id || tool.name;
    if (!key) continue;
    toolMap.set(key, tool);
  }
  return toolMap;
}

function createToolCallItem(
  block: ContentBlock,
  statusMap: Map<string, ToolStatus>,
): ProcessEventItem {
  const toolName = normalizeToolName(block.name);
  const { surface, title, action } = classifySurface(toolName, block.input ?? block.arguments);
  const key = block.id || toolName;
  const status = statusMap.get(key) || statusMap.get(toolName);
  const detail = formatUnknownContent(block.input ?? block.arguments);

  return {
    key: `tool-call-${key}`,
    kind: 'tool_call',
    surface,
    action,
    title,
    label: toolName,
    preview: status?.failureMessage || status?.summary || getToolPreview(block.input ?? block.arguments),
    detail: detail || undefined,
    status: status?.status ?? 'completed',
    durationMs: status?.durationMs,
    toolCallId: block.id,
    toolName,
    failureMessage: status?.failureMessage,
    retries: status?.retries,
  };
}

function createToolResultItem(
  block: ContentBlock,
  statusMap: Map<string, ToolStatus>,
): ProcessEventItem {
  const toolName = normalizeToolName(block.name);
  const { surface, title, action } = classifySurface(toolName, block.content ?? block.text);
  const key = block.id || toolName;
  const status = statusMap.get(key) || statusMap.get(toolName);
  const detail = formatUnknownContent(block.content ?? block.text ?? '');
  const preview = status?.failureMessage || status?.summary || truncate(detail, 88) || undefined;

  return {
    key: `tool-result-${key}`,
    kind: 'tool_result',
    surface,
    action,
    title,
    label: toolName,
    preview,
    detail: detail || undefined,
    status: status?.status || block.status || 'completed',
    durationMs: status?.durationMs ?? block.durationMs,
    toolCallId: block.id,
    toolName,
    failureMessage: status?.failureMessage,
    retries: status?.retries,
  };
}

function createUnmatchedStatusItems(
  items: ProcessEventItem[],
  streamingTools: ToolStatus[],
): ProcessEventItem[] {
  const matchedKeys = new Set(
    items
      .flatMap((item) => [item.toolCallId, item.toolName, item.label])
      .filter((value): value is string => typeof value === 'string' && value.length > 0),
  );

  return streamingTools
    .filter((tool) => {
      const key = tool.toolCallId || tool.id || tool.name;
      return !key || !matchedKeys.has(key);
    })
    .map((tool) => {
      const { surface, title, action } = classifySurface(tool.name, tool.summary);
      return {
        key: `tool-status-${tool.toolCallId || tool.id || tool.name}`,
        kind: 'tool_status' as const,
        surface,
        action,
        title,
        label: normalizeToolName(tool.name),
        preview: tool.failureMessage || tool.summary,
        detail: tool.failureMessage || tool.summary,
        status: tool.status,
        durationMs: tool.durationMs,
        toolCallId: tool.toolCallId,
        toolName: tool.name,
        failureMessage: tool.failureMessage,
        retries: tool.retries,
      };
    });
}

function insertUnmatchedStatusItems(
  items: ProcessEventItem[],
  unmatchedStatusItems: ProcessEventItem[],
): ProcessEventItem[] {
  if (unmatchedStatusItems.length === 0) return items;

  let trailingDirectStart = items.length;
  while (trailingDirectStart > 0 && isDirectContent(items[trailingDirectStart - 1])) {
    trailingDirectStart -= 1;
  }

  if (trailingDirectStart === items.length) {
    return [...items, ...unmatchedStatusItems];
  }

  return [
    ...items.slice(0, trailingDirectStart),
    ...unmatchedStatusItems,
    ...items.slice(trailingDirectStart),
  ];
}

/** 用于列表项 React key：按消息 id + 块下标稳定，避免流式增长时整表卸载重建 */
function processItemKeyPrefix(message: RawMessage): string {
  if (message.id != null && String(message.id).length > 0) {
    return String(message.id);
  }
  const ts = typeof message.timestamp === 'number' ? message.timestamp : 'na';
  return `ts-${ts}`;
}

export function getProcessEventItems(
  message: RawMessage,
  showThinking: boolean,
  chatProcessDisplayMode: ChatProcessDisplayMode,
  hideInternalRoutineProcesses = true,
  streamingTools: ToolStatus[] = [],
): ProcessEventItem[] {
  const items: ProcessEventItem[] = [];
  const content = Array.isArray(message.content) ? message.content as ContentBlock[] : null;
  const statusMap = getStatusByKey(streamingTools);
  const keyBase = processItemKeyPrefix(message);

  if (content) {
    for (let blockIndex = 0; blockIndex < content.length; blockIndex += 1) {
      const block = content[blockIndex];
      if (block.type === 'thinking' && showThinking && typeof block.thinking === 'string' && block.thinking.trim()) {
        const normalizedThinking = normalizeRoutineProcessCopy(block.thinking.trim());
        items.push({
          key: `${keyBase}-thinking-${blockIndex}`,
          kind: 'thinking',
          surface: 'thinking',
          title: 'Thinking',
          preview: truncate(normalizedThinking, 88),
          detail: normalizedThinking,
        });
        continue;
      }

      if ((block.type === 'tool_use' || block.type === 'toolCall') && chatProcessDisplayMode === 'all') {
        items.push(createToolCallItem(block, statusMap));
        continue;
      }

      if ((block.type === 'tool_result' || block.type === 'toolResult') && chatProcessDisplayMode === 'all') {
        items.push(createToolResultItem(block, statusMap));
        continue;
      }

      if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        const normalizedText = normalizeRoutineProcessCopy(block.text.trim());
        items.push({
          key: `${keyBase}-note-${blockIndex}`,
          kind: 'note',
          surface: 'note',
          title: 'Update',
          preview: truncate(normalizedText, 96),
          detail: normalizedText,
        });
      }
    }
  } else if (typeof message.content === 'string' && message.content.trim()) {
    const normalizedText = normalizeRoutineProcessCopy(message.content.trim());
    items.push({
      key: `${keyBase}-note-str`,
      kind: 'note',
      surface: 'note',
      title: 'Update',
      preview: truncate(normalizedText, 96),
      detail: normalizedText,
    });
  }

  if (chatProcessDisplayMode === 'all' && streamingTools.length > 0) {
    const unmatchedStatusItems = createUnmatchedStatusItems(items, streamingTools);
    items.splice(0, items.length, ...insertUnmatchedStatusItems(items, unmatchedStatusItems));
  }

  if (!hideInternalRoutineProcesses) {
    return items;
  }

  const hasInternalHeartbeatRead = items.some((item) => isInternalHeartbeatReadItem(item));

  return items.filter((item) => {
    if (shouldHideHeartbeatProcessItem(item)) return false;
    if (!hasInternalHeartbeatRead) return true;
    return ![item.detail?.trim(), item.preview?.trim(), item.label?.trim()].some((value) => isHeartbeatProcessText(value));
  });
}

function normalizeLocale(language: string | undefined): 'zh' | 'en' {
  return language?.startsWith('zh') ? 'zh' : 'en';
}

function isDirectContent(item: ProcessEventItem): boolean {
  return item.kind === 'note' || item.kind === 'thinking';
}

function isActiveProcessItem(item: ProcessEventItem): boolean {
  return item.status === 'running' || item.status === 'retrying';
}

function formatEventStatusLabel(item: ProcessEventItem, language: string | undefined): string {
  const locale = normalizeLocale(language);
  const retryAttemptLabel = formatRetryAttemptCount(item.retries, language);
  const retryExhaustedLabel = formatRetryExhaustedCount(item.retries, language);
  const status = item.status === 'retrying'
    ? 'retrying'
    : item.status === 'running'
      ? 'running'
      : item.status === 'error'
        ? 'error'
        : 'completed';

  const labels = locale === 'zh'
    ? {
        generic: {
          running: '\u6b63\u5728\u6267\u884c\u64cd\u4f5c',
          completed: '\u5df2\u6267\u884c\u64cd\u4f5c',
          retrying: retryAttemptLabel
            ? `\u64cd\u4f5c\u5931\u8d25\uff0c\u6b63\u5728${retryAttemptLabel}\u91cd\u8bd5`
            : '\u64cd\u4f5c\u5931\u8d25\uff0c\u6b63\u5728\u91cd\u8bd5',
          error: retryExhaustedLabel
            ? `\u64cd\u4f5c\u5931\u8d25\uff0c${retryExhaustedLabel}\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5`
            : '\u64cd\u4f5c\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5',
        },
        browser_start: {
          running: '\u6b63\u5728\u6253\u5f00\u6d4f\u89c8\u5668',
          completed: '\u5df2\u6253\u5f00\u6d4f\u89c8\u5668',
          retrying: retryAttemptLabel
            ? `\u6253\u5f00\u6d4f\u89c8\u5668\u5931\u8d25\uff0c\u6b63\u5728${retryAttemptLabel}\u91cd\u8bd5`
            : '\u6253\u5f00\u6d4f\u89c8\u5668\u5931\u8d25\uff0c\u6b63\u5728\u91cd\u8bd5',
          error: retryExhaustedLabel
            ? `\u6253\u5f00\u6d4f\u89c8\u5668\u5931\u8d25\uff0c${retryExhaustedLabel}\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5`
            : '\u6253\u5f00\u6d4f\u89c8\u5668\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5',
        },
        browser_page: {
          running: '\u6b63\u5728\u6253\u5f00\u9875\u9762',
          completed: '\u5df2\u6253\u5f00\u9875\u9762',
          retrying: retryAttemptLabel
            ? `\u6253\u5f00\u9875\u9762\u5931\u8d25\uff0c\u6b63\u5728${retryAttemptLabel}\u91cd\u8bd5`
            : '\u6253\u5f00\u9875\u9762\u5931\u8d25\uff0c\u6b63\u5728\u91cd\u8bd5',
          error: retryExhaustedLabel
            ? `\u6253\u5f00\u9875\u9762\u5931\u8d25\uff0c${retryExhaustedLabel}\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5`
            : '\u6253\u5f00\u9875\u9762\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5',
        },
        browser: {
          running: '\u6b63\u5728\u64cd\u4f5c\u6d4f\u89c8\u5668',
          completed: '\u5df2\u64cd\u4f5c\u6d4f\u89c8\u5668',
          retrying: retryAttemptLabel
            ? `\u6d4f\u89c8\u5668\u64cd\u4f5c\u5931\u8d25\uff0c\u6b63\u5728${retryAttemptLabel}\u91cd\u8bd5`
            : '\u6d4f\u89c8\u5668\u64cd\u4f5c\u5931\u8d25\uff0c\u6b63\u5728\u91cd\u8bd5',
          error: retryExhaustedLabel
            ? `\u6d4f\u89c8\u5668\u64cd\u4f5c\u5931\u8d25\uff0c${retryExhaustedLabel}\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5`
            : '\u6d4f\u89c8\u5668\u64cd\u4f5c\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5',
        },
        shell: {
          running: '\u6b63\u5728\u6267\u884c\u547d\u4ee4',
          completed: '\u5df2\u6267\u884c\u547d\u4ee4',
          retrying: retryAttemptLabel
            ? `\u6267\u884c\u547d\u4ee4\u5931\u8d25\uff0c\u6b63\u5728${retryAttemptLabel}\u91cd\u8bd5`
            : '\u6267\u884c\u547d\u4ee4\u5931\u8d25\uff0c\u6b63\u5728\u91cd\u8bd5',
          error: retryExhaustedLabel
            ? `\u6267\u884c\u547d\u4ee4\u5931\u8d25\uff0c${retryExhaustedLabel}\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5`
            : '\u6267\u884c\u547d\u4ee4\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5',
        },
        code: {
          running: '\u6b63\u5728\u4fee\u6539\u4ee3\u7801',
          completed: '\u5df2\u4fee\u6539\u4ee3\u7801',
          retrying: retryAttemptLabel
            ? `\u4ee3\u7801\u4fee\u6539\u5931\u8d25\uff0c\u6b63\u5728${retryAttemptLabel}\u91cd\u8bd5`
            : '\u4ee3\u7801\u4fee\u6539\u5931\u8d25\uff0c\u6b63\u5728\u91cd\u8bd5',
          error: retryExhaustedLabel
            ? `\u4ee3\u7801\u4fee\u6539\u5931\u8d25\uff0c${retryExhaustedLabel}\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5`
            : '\u4ee3\u7801\u4fee\u6539\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5',
        },
        read: {
          running: '\u6b63\u5728\u8bfb\u53d6\u5185\u5bb9',
          completed: '\u5df2\u8bfb\u53d6\u5185\u5bb9',
          retrying: retryAttemptLabel
            ? `\u8bfb\u53d6\u5185\u5bb9\u5931\u8d25\uff0c\u6b63\u5728${retryAttemptLabel}\u91cd\u8bd5`
            : '\u8bfb\u53d6\u5185\u5bb9\u5931\u8d25\uff0c\u6b63\u5728\u91cd\u8bd5',
          error: retryExhaustedLabel
            ? `\u8bfb\u53d6\u5185\u5bb9\u5931\u8d25\uff0c${retryExhaustedLabel}\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5`
            : '\u8bfb\u53d6\u5185\u5bb9\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5',
        },
      }
    : {
        generic: {
          running: 'Running action',
          completed: 'Action completed',
          retrying: retryAttemptLabel
            ? `Action failed, retrying (${retryAttemptLabel})`
            : 'Action failed, retrying',
          error: retryExhaustedLabel
            ? `Action failed ${retryExhaustedLabel}, please try again later`
            : 'Action failed, please try again later',
        },
        browser_start: {
          running: 'Opening browser',
          completed: 'Browser opened',
          retrying: retryAttemptLabel
            ? `Failed to open browser, retrying (${retryAttemptLabel})`
            : 'Failed to open browser, retrying',
          error: retryExhaustedLabel
            ? `Failed to open browser ${retryExhaustedLabel}, please try again later`
            : 'Failed to open browser, please try again later',
        },
        browser_page: {
          running: 'Opening page',
          completed: 'Page opened',
          retrying: retryAttemptLabel
            ? `Failed to open page, retrying (${retryAttemptLabel})`
            : 'Failed to open page, retrying',
          error: retryExhaustedLabel
            ? `Failed to open page ${retryExhaustedLabel}, please try again later`
            : 'Failed to open page, please try again later',
        },
        browser: {
          running: 'Running browser action',
          completed: 'Browser action completed',
          retrying: retryAttemptLabel
            ? `Browser action failed, retrying (${retryAttemptLabel})`
            : 'Browser action failed, retrying',
          error: retryExhaustedLabel
            ? `Browser action failed ${retryExhaustedLabel}, please try again later`
            : 'Browser action failed, please try again later',
        },
        shell: {
          running: 'Running command',
          completed: 'Command completed',
          retrying: retryAttemptLabel
            ? `Command failed, retrying (${retryAttemptLabel})`
            : 'Command failed, retrying',
          error: retryExhaustedLabel
            ? `Command failed ${retryExhaustedLabel}, please try again later`
            : 'Command failed, please try again later',
        },
        code: {
          running: 'Editing code',
          completed: 'Code edit completed',
          retrying: retryAttemptLabel
            ? `Code edit failed, retrying (${retryAttemptLabel})`
            : 'Code edit failed, retrying',
          error: retryExhaustedLabel
            ? `Code edit failed ${retryExhaustedLabel}, please try again later`
            : 'Code edit failed, please try again later',
        },
        read: {
          running: 'Reading content',
          completed: 'Content read',
          retrying: retryAttemptLabel
            ? `Read failed, retrying (${retryAttemptLabel})`
            : 'Read failed, retrying',
          error: retryExhaustedLabel
            ? `Read failed ${retryExhaustedLabel}, please try again later`
            : 'Read failed, please try again later',
        },
      };

  return labels[item.action || 'generic'][status];
}

function formatThinkingStatusLabel(language: string | undefined): string {
  return normalizeLocale(language) === 'zh' ? '\u6b63\u5728\u601d\u8003' : 'Thinking';
}

function formatEventPreviewLabel(item: ProcessEventItem, language: string | undefined): string | undefined {
  const explicitPreview = item.failureMessage || item.preview;
  if (explicitPreview) return explicitPreview;

  const locale = normalizeLocale(language);
  if (item.status === 'retrying') {
    const retryAttemptLabel = formatRetryAttemptCount(item.retries, language);
    return locale === 'zh'
      ? (retryAttemptLabel
          ? `\u6b63\u5728${retryAttemptLabel}\u91cd\u8bd5\uff0c\u7b49\u5f85\u65b0\u7684\u7ed3\u679c`
          : '\u6b63\u5728\u91cd\u8bd5\uff0c\u7b49\u5f85\u65b0\u7684\u7ed3\u679c')
      : (retryAttemptLabel
          ? `Retrying (${retryAttemptLabel}) and waiting for the next result`
          : 'Retrying and waiting for the next result');
  }
  if (item.status === 'running') {
    return locale === 'zh'
      ? '\u6b63\u5728\u5904\u7406\uff0c\u6682\u672a\u8fd4\u56de\u65b0\u7684\u8f93\u51fa'
      : 'Working on it, no new output yet';
  }
  if (item.status === 'error') {
    return locale === 'zh'
      ? '\u5f53\u524d\u6b65\u9aa4\u672a\u6210\u529f\u5b8c\u6210'
      : 'This step did not complete successfully';
  }
  return undefined;
}

export function getProcessActivityLabel(
  message: RawMessage | null | undefined,
  showThinking: boolean,
  chatProcessDisplayMode: ChatProcessDisplayMode,
  streamingTools: ToolStatus[] = [],
  language?: string,
  hideInternalRoutineProcesses = true,
): string | null {
  if (!message) return null;

  const items = getProcessEventItems(
    message,
    showThinking,
    chatProcessDisplayMode,
    hideInternalRoutineProcesses,
    streamingTools,
  );
  const activeEvent = [...items].reverse().find((item) => !isDirectContent(item) && (item.status === 'retrying' || item.status === 'running'));
  if (activeEvent) {
    return formatEventStatusLabel(activeEvent, language);
  }

  const hasThinking = items.some((item) => item.kind === 'thinking');
  if (hasThinking) {
    return formatThinkingStatusLabel(language);
  }

  return items.length > 0
    ? (normalizeLocale(language) === 'zh' ? '\u6b63\u5728\u5904\u7406' : 'Processing')
    : null;
}

function formatFinalResultLabel(language: string | undefined): string {
  return normalizeLocale(language) === 'zh'
    ? '\u4ee5\u4e0b\u662f\u6700\u7ec8\u7ed3\u679c'
    : 'Final result below';
}

function ProcessEventDetail({
  item,
  preferPlainText,
  useActiveSurfaceStyle = false,
}: {
  item: ProcessEventItem;
  /** 流式高频更新时跳过 Markdown 解析，减轻主线程卡顿 */
  preferPlainText?: boolean;
  useActiveSurfaceStyle?: boolean;
}) {
  if (!item.detail) return null;

  if (isDirectContent(item)) {
    if (preferPlainText) {
      return (
        <StreamingMarkdownPreview content={item.detail} className="min-w-0 max-w-full space-y-2 text-foreground" />
      );
    }
    return (
      <div className="chat-markdown prose prose-sm dark:prose-invert min-w-0 max-w-none break-words text-foreground [&>*]:my-2.5 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
        <MarkdownRenderer content={item.detail} />
      </div>
    );
  }

  if (!useActiveSurfaceStyle) {
    return (
      <div className="min-w-0 space-y-2">
        {item.failureMessage && item.failureMessage !== item.detail && (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/8 px-3 py-2 text-[12px] leading-6 text-amber-800 dark:text-amber-200">
            {item.failureMessage}
          </div>
        )}
        <pre className="max-h-[24rem] max-w-full overflow-auto rounded-xl border border-black/6 bg-black/[0.03] px-3 py-2.5 text-[12px] leading-6 text-foreground/80 dark:border-white/8 dark:bg-white/[0.03]">
          {item.detail}
        </pre>
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-2">
      {item.failureMessage && item.failureMessage !== item.detail && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/8 px-3 py-2 text-[12px] leading-6 text-amber-800 dark:text-amber-200">
          {item.failureMessage}
        </div>
      )}
      <pre
        data-testid="chat-process-surface-card"
        className="max-h-[24rem] max-w-full overflow-auto whitespace-pre-wrap break-words rounded-[18px] border border-black/[0.06] bg-[#f5f5f6] px-4 py-3.5 text-[12.5px] leading-7 text-foreground/80 dark:border-white/[0.08] dark:bg-white/[0.045] dark:text-foreground/78"
      >
        {item.detail}
      </pre>
    </div>
  );
}

const PROCESS_EVENT_TEXT_CLASS = 'text-foreground/50 transition-colors group-hover:text-foreground';
const ACTIVE_PROCESS_EVENT_TEXT_CLASS = 'text-foreground/60 transition-colors group-hover:text-foreground/82';
const ACTIVE_PROCESS_EVENT_PREVIEW_CLASS = 'text-foreground/52 transition-colors group-hover:text-foreground/72';

function ProcessDirectContent({
  item,
  preferPlainText,
}: {
  item: ProcessEventItem;
  preferPlainText?: boolean;
}) {
  return (
    <div
      data-testid={item.kind === 'thinking' ? 'chat-process-thinking-content' : 'chat-process-note-content'}
      className="min-w-0 px-1.5 py-1 text-[14px] leading-7 text-foreground"
    >
      <ProcessEventDetail item={item} preferPlainText={preferPlainText} />
    </div>
  );
}

const ProcessEventRow = memo(function ProcessEventRow({
  item,
  language,
  expandedByDefault = false,
  onInteractionStart,
}: {
  item: ProcessEventItem;
  language: string | undefined;
  expandedByDefault?: boolean;
  onInteractionStart?: () => void;
}) {
  const canExpand = !!item.detail;
  const [expanded, setExpanded] = useState(false);
  const summaryLabel = formatEventStatusLabel(item, language);
  const previewLabel = formatEventPreviewLabel(item, language);
  const isActive = isActiveProcessItem(item);
  const isExpanded = canExpand && (expandedByDefault || expanded);

  return (
    <div data-testid="chat-process-event-row" className="group py-0.5">
      <button
        type="button"
        data-testid="chat-process-event-toggle"
        className={cn(
          'flex w-full items-start gap-3 text-left',
          isActive ? 'rounded-xl px-1.5 py-1.5' : 'px-1.5 py-1',
        )}
        onPointerDown={() => {
          if (!canExpand || expandedByDefault) return;
          onInteractionStart?.();
        }}
        onKeyDown={(event) => {
          if (!canExpand || expandedByDefault) return;
          if (event.key === 'Enter' || event.key === ' ') {
            onInteractionStart?.();
          }
        }}
        onClick={() => {
          if (!canExpand || expandedByDefault) return;
          setExpanded((current) => !current);
        }}
      >
        {isActive ? (
          <div className="min-w-0 flex flex-1 items-center gap-1.5 pt-[1px]">
            <span
              data-testid="chat-process-event-summary"
              className={cn('shrink-0 text-[13px] font-medium', ACTIVE_PROCESS_EVENT_TEXT_CLASS)}
            >
              {summaryLabel}
            </span>
            {!isExpanded && previewLabel && (
              <span
                data-testid="chat-process-event-preview"
                className={cn('min-w-0 flex-1 truncate pr-2 text-[13px] leading-6', ACTIVE_PROCESS_EVENT_PREVIEW_CLASS)}
              >
                {previewLabel}
              </span>
            )}
          </div>
        ) : (
          <div className="min-w-0 flex-1 pt-[1px]">
            <div className="flex min-w-0 items-center gap-2">
              <span data-testid="chat-process-event-summary" className={cn('shrink-0 text-[13px] font-medium', PROCESS_EVENT_TEXT_CLASS)}>
                {summaryLabel}
              </span>
              {!isExpanded && previewLabel && (
                <span
                  data-testid="chat-process-event-preview"
                  className={cn('min-w-0 flex-1 truncate pr-2 text-[13px] leading-6', PROCESS_EVENT_TEXT_CLASS)}
                >
                  {previewLabel}
                </span>
              )}
            </div>
          </div>
        )}
        {canExpand && !expandedByDefault && (
          isExpanded ? (
            <ChevronDown
              data-testid="chat-process-event-toggle-icon"
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-100"
            />
          ) : (
            <ChevronRight
              data-testid="chat-process-event-toggle-icon"
              className={cn(
                'mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-opacity opacity-0',
                'group-hover:opacity-100',
              )}
            />
          )
        )}
      </button>

      {canExpand && isExpanded && (
        <div
          data-testid="chat-process-event-detail-panel"
          className={cn('min-w-0 pl-1.5', isActive ? 'mt-1.5' : 'mt-1')}
        >
          <ProcessEventDetail item={item} useActiveSurfaceStyle={isActive} />
        </div>
      )}
    </div>
  );
});

export const ProcessEventMessage = memo(function ProcessEventMessage({
  message,
  showThinking,
  chatProcessDisplayMode,
  hideInternalRoutineProcesses = true,
  streamingTools = [],
  expandAll = false,
  onInteractionStart,
  /** 当前轮网关流式 delta：思考/笔记不走 Markdown，降低长回复时主线程阻塞 */
  preferPlainDirectContent = false,
}: {
  message: RawMessage;
  showThinking: boolean;
  chatProcessDisplayMode: ChatProcessDisplayMode;
  hideInternalRoutineProcesses?: boolean;
  streamingTools?: ToolStatus[];
  expandAll?: boolean;
  onInteractionStart?: () => void;
  preferPlainDirectContent?: boolean;
}) {
  const { i18n } = useTranslation('chat');
  const language = i18n?.resolvedLanguage || i18n?.language;
  const items = useMemo(
    () => getProcessEventItems(
      message,
      showThinking,
      chatProcessDisplayMode,
      hideInternalRoutineProcesses,
      streamingTools,
    ),
    [chatProcessDisplayMode, hideInternalRoutineProcesses, message, showThinking, streamingTools],
  );

  if (items.length === 0) return null;

  return (
    <div className="min-w-0 space-y-0.5">
      {items.map((item) => (
        isDirectContent(item) ? (
          <ProcessDirectContent
            key={item.key}
            item={item}
            preferPlainText={preferPlainDirectContent}
          />
        ) : (
          <ProcessEventRow
            key={item.key}
            item={item}
            language={language}
            expandedByDefault={expandAll && isActiveProcessItem(item)}
            onInteractionStart={onInteractionStart}
          />
        )
      ))}
    </div>
  );
});

export const ProcessFinalDivider = memo(function ProcessFinalDivider() {
  const { i18n } = useTranslation('chat');
  const language = i18n?.resolvedLanguage || i18n?.language;

  return (
    <div
      data-testid="chat-final-result-divider"
      className="flex w-full items-center gap-4 py-2 text-[12px] text-foreground/45"
    >
      <div className="h-px min-w-0 flex-1 bg-black/10 dark:bg-white/12" />
      <span className="shrink-0 tracking-[0.01em]">
        {formatFinalResultLabel(language)}
      </span>
      <div className="h-px min-w-0 flex-1 bg-black/10 dark:bg-white/12" />
    </div>
  );
});
