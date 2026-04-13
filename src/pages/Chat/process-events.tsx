import { memo, useEffect, useMemo, useState, lazy, Suspense } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ContentBlock, RawMessage, ToolStatus } from '@/stores/chat';
import type { ChatProcessDisplayMode } from '@/stores/settings';
import { cn } from '@/lib/utils';

const MarkdownRenderer = lazy(() => import('./MarkdownRenderer').then((module) => ({ default: module.MarkdownRenderer })));

type ProcessSurface = 'thinking' | 'terminal' | 'code' | 'read' | 'tool' | 'note';
type ProcessAction = 'generic' | 'browser_start' | 'browser_page' | 'browser' | 'shell' | 'code' | 'read';
type ProcessSubject = 'file' | 'search' | 'browser' | 'shell' | 'code' | 'generic';

type ProcessEventItem = {
  key: string;
  kind: 'thinking' | 'tool_call' | 'tool_result' | 'tool_status' | 'note';
  surface: ProcessSurface;
  action?: ProcessAction;
  subject?: ProcessSubject;
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

function classifySurface(toolName: string | undefined, payload: unknown): {
  surface: ProcessSurface;
  title: string;
  action?: ProcessAction;
  subject?: ProcessSubject;
} {
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
      subject: 'browser',
    };
  }

  if (
    lowerName.includes('shell')
    || lowerName.includes('terminal')
    || lowerName.includes('command')
    || payloadText.includes('"command"')
  ) {
    return { surface: 'terminal', title: 'Shell', action: 'shell', subject: 'shell' };
  }

  if (
    lowerName.includes('patch')
    || lowerName.includes('edit')
    || lowerName.includes('write')
    || lowerName.includes('diff')
    || payloadText.includes('*** begin patch')
    || payloadText.includes('"patch"')
  ) {
    return { surface: 'code', title: 'Code', action: 'code', subject: 'code' };
  }

  if (
    lowerName.includes('read')
    || lowerName.includes('open')
    || lowerName.includes('find')
    || lowerName.includes('search')
    || payloadText.includes('"path"')
    || payloadText.includes('"file_path"')
  ) {
    const looksLikeFileRead = lowerName.includes('read')
      || lowerName.includes('open')
      || payloadText.includes('"path"')
      || payloadText.includes('"file_path"')
      || payloadText.includes('"filepath"')
      || payloadText.includes('"file"');
    const looksLikeSearch = lowerName.includes('search')
      || lowerName.includes('find')
      || payloadText.includes('"query"')
      || payloadText.includes('"pattern"')
      || payloadText.includes('"keywords"');

    return {
      surface: 'read',
      title: 'Read',
      action: 'read',
      subject: looksLikeSearch && !looksLikeFileRead ? 'search' : 'file',
    };
  }

  return { surface: 'tool', title: normalizedName, action: 'generic', subject: 'generic' };
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
  const { surface, title, action, subject } = classifySurface(toolName, block.input ?? block.arguments);
  const key = block.id || toolName;
  const status = statusMap.get(key) || statusMap.get(toolName);
  const detail = formatUnknownContent(block.input ?? block.arguments);

  return {
    key: `tool-call-${key}`,
    kind: 'tool_call',
    surface,
    action,
    subject,
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
  const { surface, title, action, subject } = classifySurface(toolName, block.content ?? block.text);
  const key = block.id || toolName;
  const status = statusMap.get(key) || statusMap.get(toolName);
  const detail = formatUnknownContent(block.content ?? block.text ?? '');
  const preview = status?.summary || truncate(detail, 88);

  return {
    key: `tool-result-${key}`,
    kind: 'tool_result',
    surface,
    action,
    subject,
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
      const { surface, title, action, subject } = classifySurface(tool.name, tool.summary);
      return {
        key: `tool-status-${tool.toolCallId || tool.id || tool.name}`,
        kind: 'tool_status' as const,
        surface,
        action,
        subject,
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

export function getProcessEventItems(
  message: RawMessage,
  showThinking: boolean,
  chatProcessDisplayMode: ChatProcessDisplayMode,
  streamingTools: ToolStatus[] = [],
): ProcessEventItem[] {
  const items: ProcessEventItem[] = [];
  const content = Array.isArray(message.content) ? message.content as ContentBlock[] : null;
  const statusMap = getStatusByKey(streamingTools);

  if (content) {
    for (const block of content) {
      if (block.type === 'thinking' && showThinking && typeof block.thinking === 'string' && block.thinking.trim()) {
        items.push({
          key: `thinking-${block.thinking.slice(0, 24)}`,
          kind: 'thinking',
          surface: 'thinking',
          title: 'Thinking',
          preview: truncate(block.thinking, 88),
          detail: block.thinking.trim(),
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
        items.push({
          key: `note-${items.length}`,
          kind: 'note',
          surface: 'note',
          title: 'Update',
          preview: truncate(block.text, 96),
          detail: block.text.trim(),
        });
      }
    }
  } else if (typeof message.content === 'string' && message.content.trim()) {
    items.push({
      key: 'note-message',
      kind: 'note',
      surface: 'note',
      title: 'Update',
      preview: truncate(message.content, 96),
      detail: message.content.trim(),
    });
  }

  if (chatProcessDisplayMode === 'all' && streamingTools.length > 0) {
    items.push(...createUnmatchedStatusItems(items, streamingTools));
  }

  return items;
}

function normalizeLocale(language: string | undefined): 'zh' | 'en' {
  return language?.startsWith('zh') ? 'zh' : 'en';
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
          running: '处理中',
          completed: '已处理',
          error: '处理失败',
        },
        browser_start: {
          running: '打开浏览器中',
          completed: '已打开浏览器',
          error: '打开浏览器失败',
        },
        browser_page: {
          running: '打开页面中',
          completed: '已打开页面',
          error: '打开页面失败',
        },
        browser: {
          running: '浏览器处理中',
          completed: '已处理浏览器',
          error: '浏览器处理失败',
        },
        shell: {
          running: '执行命令中',
          completed: '已执行命令',
          error: '执行命令失败',
        },
        code: {
          running: '修改代码中',
          completed: '已修改代码',
          error: '修改代码失败',
        },
        read: {
          running: '读取内容中',
          completed: '已读取内容',
          error: '读取内容失败',
        },
      }
    : {
        generic: {
          running: 'Processing',
          completed: 'Processed',
          error: 'Failed',
        },
        browser_start: {
          running: 'Opening browser',
          completed: 'Opened browser',
          error: 'Failed to open browser',
        },
        browser_page: {
          running: 'Opening page',
          completed: 'Opened page',
          error: 'Failed to open page',
        },
        browser: {
          running: 'Processing browser',
          completed: 'Processed browser',
          error: 'Browser failed',
        },
        shell: {
          running: 'Running command',
          completed: 'Ran command',
          error: 'Command failed',
        },
        code: {
          running: 'Editing code',
          completed: 'Edited code',
          error: 'Code edit failed',
        },
        read: {
          running: 'Reading content',
          completed: 'Read content',
          error: 'Read failed',
        },
      };

  return labels[item.action || 'generic'][status];
}

function formatAggregateCount(subject: ProcessSubject, count: number, language: 'zh' | 'en'): string {
  if (language === 'zh') {
    switch (subject) {
      case 'file':
        return `${count} 个文件`;
      case 'search':
        return `${count} 次检索`;
      case 'browser':
        return `${count} 个页面步骤`;
      case 'shell':
        return `${count} 条命令`;
      case 'code':
        return `${count} 处代码改动`;
      default:
        return `${count} 个任务`;
    }
  }

  switch (subject) {
    case 'file':
      return `${count} file${count === 1 ? '' : 's'}`;
    case 'search':
      return `${count} search${count === 1 ? '' : 'es'}`;
    case 'browser':
      return `${count} browser step${count === 1 ? '' : 's'}`;
    case 'shell':
      return `${count} command${count === 1 ? '' : 's'}`;
    case 'code':
      return `${count} code edit${count === 1 ? '' : 's'}`;
    default:
      return `${count} task${count === 1 ? '' : 's'}`;
  }
}

function formatAggregateLabel(
  counts: Map<ProcessSubject, number>,
  language: 'zh' | 'en',
  isRunning: boolean,
): string | null {
  const orderedEntries = (['file', 'search', 'browser', 'shell', 'code', 'generic'] as const)
    .map((subject) => [subject, counts.get(subject) ?? 0] as const)
    .filter(([, count]) => count > 0);

  if (orderedEntries.length === 0) return null;

  if (orderedEntries.length === 1) {
    const [subject, count] = orderedEntries[0];
    if (language === 'zh') {
      switch (subject) {
        case 'file':
          return `${isRunning ? '正在浏览' : '已浏览'} ${count} 个文件`;
        case 'search':
          return `${isRunning ? '正在检索' : '已检索'} ${count} 次`;
        case 'shell':
          return `${isRunning ? '正在执行' : '已执行'} ${count} 条命令`;
        case 'code':
          return `${isRunning ? '正在修改' : '已修改'} ${count} 处代码`;
        case 'browser':
          return `${isRunning ? '正在浏览' : '已浏览'} ${count} 个页面步骤`;
        default:
          return `${isRunning ? '正在处理' : '已处理'} ${count} 个任务`;
      }
    }

    switch (subject) {
      case 'file':
        return `${isRunning ? 'Exploring' : 'Explored'} ${formatAggregateCount(subject, count, language)}`;
      case 'search':
        return `${isRunning ? 'Running' : 'Ran'} ${formatAggregateCount(subject, count, language)}`;
      case 'shell':
        return `${isRunning ? 'Running' : 'Ran'} ${formatAggregateCount(subject, count, language)}`;
      case 'code':
        return `${isRunning ? 'Editing' : 'Edited'} ${formatAggregateCount(subject, count, language)}`;
      case 'browser':
        return `${isRunning ? 'Browsing' : 'Browsed'} ${formatAggregateCount(subject, count, language)}`;
      default:
        return `${isRunning ? 'Working on' : 'Completed'} ${formatAggregateCount(subject, count, language)}`;
    }
  }

  const parts = orderedEntries.map(([subject, count]) => formatAggregateCount(subject, count, language));
  if (language === 'zh') {
    return `${isRunning ? '正在处理' : '已处理'} ${parts.join('、')}`;
  }

  return `${isRunning ? 'Working on' : 'Completed'} ${parts.join(', ')}`;
}

function buildMessageSummary(items: ProcessEventItem[], language: string | undefined): { label: string; preview?: string; durationMs?: number } {
  const locale = normalizeLocale(language);
  const structuredItems = items.filter((item) => item.kind !== 'note' && item.kind !== 'thinking');
  const runningItems = structuredItems.filter((item) => item.status === 'running');
  const summaryItems = runningItems.length > 0 ? runningItems : structuredItems;

  if (summaryItems.length > 1) {
    const counts = new Map<ProcessSubject, number>();
    for (const item of summaryItems) {
      const subject = item.subject || 'generic';
      counts.set(subject, (counts.get(subject) ?? 0) + 1);
    }
    const label = formatAggregateLabel(counts, locale, runningItems.length > 0);
    if (label) {
      return {
        label,
        durationMs: summaryItems.reduce((max, item) => Math.max(max, item.durationMs ?? 0), 0) || undefined,
      };
    }
  }

  const primary = items.find((item) => item.kind !== 'note' && item.kind !== 'thinking') || items[0];
  if (!primary) {
    return {
      label: locale === 'zh' ? '已处理' : 'Processed',
    };
  }

  return {
    label: formatEventStatusLabel(primary, language),
    preview: primary.preview,
    durationMs: primary.durationMs,
  };
}

function ProcessEventDetail({ item }: { item: ProcessEventItem }) {
  if (!item.detail) return null;

  if (item.kind === 'note' || item.kind === 'thinking') {
    return (
      <div className="prose prose-sm dark:prose-invert max-w-none break-words text-foreground/85 [&>*]:my-2.5 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
        <Suspense fallback={<p className="whitespace-pre-wrap break-words">{item.detail}</p>}>
          <MarkdownRenderer content={item.detail} />
        </Suspense>
      </div>
    );
  }

  return (
    <pre className="overflow-x-auto rounded-xl border border-black/6 bg-black/[0.03] px-3 py-2.5 text-[12px] leading-6 text-foreground/80 dark:border-white/8 dark:bg-white/[0.03]">
      {item.detail}
    </pre>
  );
}

const ProcessEventRow = memo(function ProcessEventRow({
  item,
  language,
  defaultExpanded = false,
}: {
  item: ProcessEventItem;
  language: string | undefined;
  defaultExpanded?: boolean;
}) {
  const isDirectContent = item.kind === 'note' || item.kind === 'thinking';
  const canExpand = !!item.detail;
  const [expanded, setExpanded] = useState(defaultExpanded && canExpand && !isDirectContent);
  const durationLabel = formatDuration(item.durationMs);
  const summaryLabel = formatEventStatusLabel(item, language);

  useEffect(() => {
    setExpanded(defaultExpanded && canExpand && !isDirectContent);
  }, [canExpand, defaultExpanded, isDirectContent, item.key]);

  if (isDirectContent) {
    return (
      <div
        data-testid={item.kind === 'thinking' ? 'chat-process-thinking-content' : 'chat-process-note-content'}
        className="px-1.5 py-1 text-[14px] leading-7 text-foreground/85"
      >
        <ProcessEventDetail item={item} />
      </div>
    );
  }

  return (
    <div
      data-testid="chat-process-event-item-row"
      className="group py-0.5"
    >
      <button
        type="button"
        className="flex w-full items-start gap-3 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
        onClick={() => {
          if (!canExpand) return;
          setExpanded((current) => !current);
        }}
      >
        <div className="min-w-0 flex-1 pt-[1px]">
          <div className="flex min-w-0 items-center gap-2">
              <span data-testid="chat-process-event-summary" className="shrink-0 text-[13px] font-medium text-foreground">
                {summaryLabel}
              </span>
            {durationLabel && (
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {durationLabel}
              </span>
            )}
            {!expanded && item.preview && (
              <span data-testid="chat-process-event-preview" className="truncate text-[12px] text-muted-foreground">
                {item.preview}
              </span>
            )}
          </div>
        </div>
        {canExpand && (
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
  streamingTools = [],
  defaultExpanded = false,
}: {
  message: RawMessage;
  showThinking: boolean;
  chatProcessDisplayMode: ChatProcessDisplayMode;
  streamingTools?: ToolStatus[];
  defaultExpanded?: boolean;
}) {
  const { i18n } = useTranslation('chat');
  const language = i18n?.resolvedLanguage || i18n?.language;
  const items = useMemo(
    () => getProcessEventItems(message, showThinking, chatProcessDisplayMode, streamingTools),
    [chatProcessDisplayMode, message, showThinking, streamingTools],
  );
  const summary = useMemo(() => buildMessageSummary(items, language), [items, language]);
  const lastExpandableIndex = useMemo(() => {
    for (let index = items.length - 1; index >= 0; index -= 1) {
      if (items[index]?.detail && items[index]?.kind !== 'note' && items[index]?.kind !== 'thinking') {
        return index;
      }
    }
    return -1;
  }, [items]);
  const [expanded, setExpanded] = useState(defaultExpanded);

  useEffect(() => {
    setExpanded(defaultExpanded);
  }, [defaultExpanded, message.id, items.length]);

  if (items.length === 0) return null;

  return (
    <div data-testid="chat-process-event-row" className="group py-0.5">
      <button
        type="button"
        data-testid="chat-process-event-toggle"
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-start gap-3 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
      >
        <div className="min-w-0 flex-1 pt-[1px]">
          <div className="flex min-w-0 items-center gap-2">
            <span data-testid="chat-process-event-summary" className="shrink-0 text-[13px] font-medium text-foreground">
              {summary.label}
            </span>
            {summary.durationMs != null && (
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {formatDuration(summary.durationMs)}
              </span>
            )}
            {!expanded && summary.preview && (
              <span data-testid="chat-process-event-preview" className="truncate text-[12px] text-muted-foreground">
                {summary.preview}
              </span>
            )}
          </div>
        </div>
        <ChevronRight
          data-testid="chat-process-event-toggle-icon"
          className={cn(
            'mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-opacity',
            expanded ? 'rotate-90 opacity-100' : 'opacity-0 group-hover:opacity-100',
          )}
        />
      </button>

      {expanded && (
        <div className="mt-1 pl-1.5">
          {items.length === 1 ? (
            items[0]?.kind === 'note' || items[0]?.kind === 'thinking' ? (
              <ProcessEventRow
                item={items[0]}
                language={language}
              />
            ) : (
              <ProcessEventDetail item={items[0]} />
            )
          ) : (
            <div className="space-y-0.5">
              {items.map((item, index) => (
                <ProcessEventRow
                  key={item.key}
                  item={item}
                  language={language}
                  defaultExpanded={index === lastExpandableIndex}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
});
