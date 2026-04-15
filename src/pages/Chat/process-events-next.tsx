/* eslint-disable react-refresh/only-export-components */
import { memo, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTranslation } from 'react-i18next';
import type { ContentBlock, RawMessage, ToolStatus } from '@/stores/chat';
import type { ChatProcessDisplayMode } from '@/stores/settings';
import { cn } from '@/lib/utils';
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
};

function formatDuration(durationMs?: number): string | null {
  if (!durationMs || !Number.isFinite(durationMs)) return null;
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function truncate(text: string, maxLength = 96): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
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
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (!item || typeof item !== 'object') return '';
        const block = item as ContentBlock;
        if (typeof block.text === 'string') return block.text;
        if (typeof block.thinking === 'string') return block.thinking;
        return '';
      })
      .filter(Boolean)
      .join('\n\n')
      .trim();
  }
  if (value == null) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
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
  const command = record.command ?? record.cmd ?? record.script;
  if (typeof command === 'string' && command.trim()) {
    return truncate(command, 88);
  }

  const path = record.file_path ?? record.filePath ?? record.path ?? record.file;
  if (typeof path === 'string' && path.trim()) {
    return truncate(path, 88);
  }

  const patch = record.patch ?? record.diff;
  if (typeof patch === 'string' && patch.trim()) {
    return truncate(patch, 88);
  }

  return truncate(formatUnknownContent(payload), 88);
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
    preview: status?.summary || getToolPreview(block.input ?? block.arguments),
    detail: detail || undefined,
    status: status?.status ?? 'completed',
    durationMs: status?.durationMs,
    toolCallId: block.id,
    toolName,
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
  const preview = status?.summary || truncate(detail, 88);

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
        preview: tool.summary,
        detail: tool.summary,
        status: tool.status,
        durationMs: tool.durationMs,
        toolCallId: tool.toolCallId,
        toolName: tool.name,
      };
    });
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
    items.push(...createUnmatchedStatusItems(items, streamingTools));
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

function formatEventStatusLabel(item: ProcessEventItem, language: string | undefined): string {
  const locale = normalizeLocale(language);
  const status = item.status === 'running'
    ? 'running'
    : item.status === 'error'
      ? 'error'
      : 'completed';

  const labels = locale === 'zh'
    ? {
        generic: {
          running: '\u6b63\u5728\u6267\u884c\u64cd\u4f5c',
          completed: '\u5df2\u6267\u884c\u64cd\u4f5c',
          error: '\u6267\u884c\u64cd\u4f5c\u5931\u8d25',
        },
        browser_start: {
          running: '\u6b63\u5728\u6253\u5f00\u6d4f\u89c8\u5668',
          completed: '\u5df2\u6253\u5f00\u6d4f\u89c8\u5668',
          error: '\u6253\u5f00\u6d4f\u89c8\u5668\u5931\u8d25',
        },
        browser_page: {
          running: '\u6b63\u5728\u6253\u5f00\u9875\u9762',
          completed: '\u5df2\u6253\u5f00\u9875\u9762',
          error: '\u6253\u5f00\u9875\u9762\u5931\u8d25',
        },
        browser: {
          running: '\u6b63\u5728\u64cd\u4f5c\u6d4f\u89c8\u5668',
          completed: '\u5df2\u64cd\u4f5c\u6d4f\u89c8\u5668',
          error: '\u6d4f\u89c8\u5668\u64cd\u4f5c\u5931\u8d25',
        },
        shell: {
          running: '\u6b63\u5728\u6267\u884c\u547d\u4ee4',
          completed: '\u5df2\u6267\u884c\u547d\u4ee4',
          error: '\u6267\u884c\u547d\u4ee4\u5931\u8d25',
        },
        code: {
          running: '\u6b63\u5728\u4fee\u6539\u4ee3\u7801',
          completed: '\u5df2\u4fee\u6539\u4ee3\u7801',
          error: '\u4ee3\u7801\u4fee\u6539\u5931\u8d25',
        },
        read: {
          running: '\u6b63\u5728\u8bfb\u53d6\u5185\u5bb9',
          completed: '\u5df2\u8bfb\u53d6\u5185\u5bb9',
          error: '\u8bfb\u53d6\u5185\u5bb9\u5931\u8d25',
        },
      }
    : {
        generic: {
          running: 'Running action',
          completed: 'Action completed',
          error: 'Action failed',
        },
        browser_start: {
          running: 'Opening browser',
          completed: 'Browser opened',
          error: 'Failed to open browser',
        },
        browser_page: {
          running: 'Opening page',
          completed: 'Page opened',
          error: 'Failed to open page',
        },
        browser: {
          running: 'Running browser action',
          completed: 'Browser action completed',
          error: 'Browser action failed',
        },
        shell: {
          running: 'Running command',
          completed: 'Command completed',
          error: 'Command failed',
        },
        code: {
          running: 'Editing code',
          completed: 'Code edit completed',
          error: 'Code edit failed',
        },
        read: {
          running: 'Reading content',
          completed: 'Content read',
          error: 'Read failed',
        },
      };

  return labels[item.action || 'generic'][status];
}

function formatThinkingStatusLabel(language: string | undefined): string {
  return normalizeLocale(language) === 'zh' ? '\u6b63\u5728\u601d\u8003' : 'Thinking';
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
  const runningEvent = [...items].reverse().find((item) => !isDirectContent(item) && item.status === 'running');
  if (runningEvent) {
    return formatEventStatusLabel(runningEvent, language);
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
}: {
  item: ProcessEventItem;
  /** 流式高频更新时跳过 Markdown 解析，减轻主线程卡顿 */
  preferPlainText?: boolean;
}) {
  if (!item.detail) return null;

  if (isDirectContent(item)) {
    if (preferPlainText) {
      return (
        <StreamingMarkdownPreview content={item.detail} className="space-y-2 text-foreground" />
      );
    }
    return (
      <div className="prose prose-sm dark:prose-invert max-w-none break-words text-foreground [&>*]:my-2.5 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {item.detail}
        </ReactMarkdown>
      </div>
    );
  }

  return (
    <pre className="max-h-[24rem] overflow-auto rounded-xl border border-black/6 bg-black/[0.03] px-3 py-2.5 text-[12px] leading-6 text-foreground/80 dark:border-white/8 dark:bg-white/[0.03]">
      {item.detail}
    </pre>
  );
}

const PROCESS_EVENT_TEXT_CLASS = 'text-foreground/50 transition-colors group-hover:text-foreground';
const PROCESS_EVENT_SUBTEXT_CLASS = 'text-foreground/42 transition-colors group-hover:text-foreground/75';

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
      className="px-1.5 py-1 text-[14px] leading-7 text-foreground"
    >
      <ProcessEventDetail item={item} preferPlainText={preferPlainText} />
    </div>
  );
}

const ProcessEventRow = memo(function ProcessEventRow({
  item,
  language,
  expandedByDefault = false,
}: {
  item: ProcessEventItem;
  language: string | undefined;
  expandedByDefault?: boolean;
}) {
  const canExpand = !!item.detail;
  const [expanded, setExpanded] = useState(() => expandedByDefault && canExpand);
  const durationLabel = formatDuration(item.durationMs);
  const summaryLabel = formatEventStatusLabel(item, language);

  return (
    <div data-testid="chat-process-event-row" className="group py-0.5">
      <button
        type="button"
        data-testid="chat-process-event-toggle"
        className="flex w-full items-start gap-3 px-1.5 py-1 text-left"
        onClick={() => {
          if (!canExpand || expandedByDefault) return;
          setExpanded((current) => !current);
        }}
      >
        <div className="min-w-0 flex-1 pt-[1px]">
          <div className="flex min-w-0 items-center gap-2">
            <span data-testid="chat-process-event-summary" className={cn('shrink-0 text-[13px] font-medium', PROCESS_EVENT_TEXT_CLASS)}>
              {summaryLabel}
            </span>
            {durationLabel && (
              <span className={cn('shrink-0 text-[11px]', PROCESS_EVENT_SUBTEXT_CLASS)}>
                {durationLabel}
              </span>
            )}
            {!expanded && item.preview && (
              <span
                data-testid="chat-process-event-preview"
                className={cn('min-w-0 flex-1 truncate pr-2 text-[12px] leading-5', PROCESS_EVENT_TEXT_CLASS)}
              >
                {item.preview}
              </span>
            )}
          </div>
        </div>
        {canExpand && !expandedByDefault && (
          expanded ? (
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

      {canExpand && expanded && (
        <div
          data-testid="chat-process-event-detail-panel"
          className="mt-1 pl-1.5"
        >
          <ProcessEventDetail item={item} />
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
  /** 当前轮网关流式 delta：思考/笔记不走 Markdown，降低长回复时主线程阻塞 */
  preferPlainDirectContent = false,
}: {
  message: RawMessage;
  showThinking: boolean;
  chatProcessDisplayMode: ChatProcessDisplayMode;
  hideInternalRoutineProcesses?: boolean;
  streamingTools?: ToolStatus[];
  expandAll?: boolean;
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
    <div className="space-y-0.5">
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
            expandedByDefault={expandAll}
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
