import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { getProcessActivityLabel, getProcessEventItems, ProcessEventMessage } from '@/pages/Chat/process-events-next';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: {
      resolvedLanguage: 'en',
      language: 'en',
    },
    t: (key: string) => key,
  }),
}));

describe('ProcessEventMessage', () => {
  it('renders thinking content directly without a nested Thinking row', () => {
    const { container } = render(
      <ProcessEventMessage
        message={{
          id: 'assistant-1',
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'I need to reopen the browser before searching again.' },
            { type: 'tool_use', id: 'browser-1', name: 'browser', input: { action: 'start', enabled: true } },
          ],
        }}
        showThinking
        chatProcessDisplayMode="all"
        streamingTools={[
          {
            id: 'browser-1',
            toolCallId: 'browser-1',
            name: 'browser',
            status: 'running',
          },
        ]}
      />,
    );

    expect(screen.getByTestId('chat-process-thinking-content')).toBeInTheDocument();
    expect(screen.queryByText('Thinking')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('chat-process-event-row')).toHaveLength(1);
    expect(within(screen.getByTestId('chat-process-event-toggle')).getByTestId('chat-process-event-summary')).toHaveTextContent('Opening browser');
    expect(screen.queryByTestId('chat-process-event-detail-panel')).not.toBeInTheDocument();
    expect(screen.getAllByText(/I need to reopen the browser before searching again\./).length).toBeGreaterThan(0);
    expect(screen.queryByTestId('chat-process-event-item-row')).not.toBeInTheDocument();
    expect(container.textContent?.indexOf('I need to reopen the browser before searching again.')).toBeLessThan(
      container.textContent?.indexOf('Opening browser') ?? Number.POSITIVE_INFINITY,
    );
  });

  it('renders direct note content before the next tool action in the same process stream', () => {
    const { container } = render(
      <ProcessEventMessage
        message={{
          id: 'assistant-3',
          role: 'assistant',
          content: [
            { type: 'text', text: 'I should reopen the page before reading more details.' },
            { type: 'tool_use', id: 'browser-3', name: 'browser', input: { action: 'open', targetUrl: 'https://example.com' } },
          ],
        }}
        showThinking
        chatProcessDisplayMode="all"
      />,
    );

    expect(screen.getByTestId('chat-process-note-content')).toBeInTheDocument();
    expect(screen.getAllByTestId('chat-process-event-row')).toHaveLength(1);
    expect(container.textContent?.indexOf('I should reopen the page before reading more details.')).toBeLessThan(
      container.textContent?.indexOf('Page opened') ?? Number.POSITIVE_INFINITY,
    );
  });

  it('keeps direct note markdown inside the shrinkable chat markdown surface', () => {
    render(
      <ProcessEventMessage
        message={{
          id: 'assistant-note-overflow',
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: [
                'A minimal environmental penalty icon, 28x28 pixels. A simple leaf outline drawn with gray lines (#808080), combined with a blue warning mark (#0b7fff).',
                '',
                '| Element | Description |',
                '| --- | --- |',
                '| Palette | Gray + blue (#0b7fff) |',
              ].join('\n'),
            },
          ],
        }}
        showThinking
        chatProcessDisplayMode="all"
      />,
    );

    const note = screen.getByTestId('chat-process-note-content');
    expect(note).toHaveClass('min-w-0');
    expect(
      within(note).getByText(/A minimal environmental penalty icon, 28x28 pixels\./).closest('.chat-markdown'),
    ).not.toBeNull();
    expect(within(note).getByText('Gray + blue (#0b7fff)')).toBeInTheDocument();
  });

  it('keeps tool preview only in the collapsed row and removes row separators', () => {
    render(
      <ProcessEventMessage
        message={{
          id: 'assistant-2',
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'browser-2',
              name: 'browser',
              input: {
                action: 'start',
                enabled: true,
                profile: 'openclaw',
                driver: 'openclaw',
              },
            },
          ],
        }}
        showThinking
        chatProcessDisplayMode="all"
      />,
    );

    const row = screen.getByTestId('chat-process-event-row');
    expect(row).not.toHaveClass('border-b');
    expect(within(row).getByTestId('chat-process-event-summary')).toHaveTextContent('Browser opened');
    expect(within(row).getByTestId('chat-process-event-preview')).toBeInTheDocument();
    expect(within(row).getByTestId('chat-process-event-preview')).toHaveClass('flex-1');
    expect(within(row).getByTestId('chat-process-event-preview')).toHaveClass('text-foreground/50');
    expect(within(row).getByTestId('chat-process-event-toggle-icon')).toHaveClass('opacity-0');

    fireEvent.click(within(row).getByTestId('chat-process-event-toggle'));

    expect(within(row).queryByTestId('chat-process-event-preview')).not.toBeInTheDocument();
    expect(within(row).getByText(/"enabled": true/)).toBeInTheDocument();
    expect(within(row).getByTestId('chat-process-event-toggle-icon')).toHaveClass('opacity-100');
    expect(within(row).getByText(/"enabled": true/).closest('pre')).toHaveClass('max-h-[24rem]');
  });

  it('keeps live events expanded when requested', () => {
    render(
      <ProcessEventMessage
        message={{
          id: 'assistant-live-1',
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'browser-live-1',
              name: 'browser',
              input: {
                action: 'start',
                enabled: true,
              },
            },
          ],
        }}
        showThinking
        chatProcessDisplayMode="all"
        streamingTools={[
          {
            id: 'browser-live-1',
            toolCallId: 'browser-live-1',
            name: 'browser',
            status: 'running',
          },
        ]}
        expandAll
      />,
    );

    const row = screen.getByTestId('chat-process-event-row');
    expect(within(row).queryByTestId('chat-process-event-preview')).not.toBeInTheDocument();
    expect(within(row).getByText(/"enabled": true/)).toBeInTheDocument();
    expect(within(row).queryByTestId('chat-process-event-toggle-icon')).not.toBeInTheDocument();
  });

  it('auto-collapses a finished live event and expands the next running event', () => {
    const { rerender } = render(
      <ProcessEventMessage
        message={{
          id: 'assistant-live-transition',
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'shell-1',
              name: 'shell_command',
              input: {
                command: 'dir',
              },
            },
          ],
        }}
        showThinking
        chatProcessDisplayMode="all"
        streamingTools={[
          {
            id: 'shell-1',
            toolCallId: 'shell-1',
            name: 'shell_command',
            status: 'running',
          },
        ]}
        expandAll
      />,
    );

    const initialRow = screen.getByTestId('chat-process-event-row');
    expect(within(initialRow).getByTestId('chat-process-event-summary')).toHaveTextContent('Running command');
    expect(within(initialRow).getByTestId('chat-process-event-detail-panel')).toBeInTheDocument();

    rerender(
      <ProcessEventMessage
        message={{
          id: 'assistant-live-transition',
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'shell-1',
              name: 'shell_command',
              input: {
                command: 'dir',
              },
            },
            {
              type: 'tool_use',
              id: 'browser-2',
              name: 'browser',
              input: {
                action: 'open',
                url: 'https://example.com',
              },
            },
          ],
        }}
        showThinking
        chatProcessDisplayMode="all"
        streamingTools={[
          {
            id: 'shell-1',
            toolCallId: 'shell-1',
            name: 'shell_command',
            status: 'completed',
          },
          {
            id: 'browser-2',
            toolCallId: 'browser-2',
            name: 'browser',
            status: 'running',
          },
        ]}
        expandAll
      />,
    );

    const rows = screen.getAllByTestId('chat-process-event-row');
    expect(within(rows[0]).getByTestId('chat-process-event-summary')).toHaveTextContent('Command completed');
    expect(within(rows[0]).queryByTestId('chat-process-event-detail-panel')).not.toBeInTheDocument();
    expect(within(rows[1]).getByTestId('chat-process-event-summary')).toHaveTextContent('Opening page');
    expect(within(rows[1]).getByTestId('chat-process-event-detail-panel')).toBeInTheDocument();
  });

  it('uses the simplified Chinese status grammar for running process labels', () => {
    expect(getProcessActivityLabel(
      {
        id: 'assistant-4',
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'code-1',
            name: 'write',
            input: { path: 'src/app.ts', patch: '*** Begin Patch' },
          },
        ],
      },
      true,
      'all',
      [
        {
          id: 'code-1',
          toolCallId: 'code-1',
          name: 'write',
          status: 'running',
          updatedAt: Date.now(),
        },
      ],
      'zh-CN',
    )).toBe('正在修改代码');
  });

  it('uses a clearer fallback label for generic completed actions', () => {
    render(
      <ProcessEventMessage
        message={{
          id: 'assistant-5',
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'tool-1',
              name: 'unknown-tool',
              input: { foo: 'bar' },
            },
          ],
        }}
        showThinking
        chatProcessDisplayMode="all"
        streamingTools={[
          {
            id: 'tool-1',
            toolCallId: 'tool-1',
            name: 'unknown-tool',
            status: 'completed',
            updatedAt: Date.now(),
          },
        ]}
      />,
    );

    expect(screen.getByTestId('chat-process-event-summary')).toHaveTextContent('Action completed');
  });

  it('summarizes multiple running read/search actions with concrete counts', () => {
    render(
      <ProcessEventMessage
        message={{
          id: 'assistant-3',
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'read-1', name: 'read_file', input: { path: 'src/runtime-send-actions.ts' } },
            { type: 'tool_use', id: 'read-2', name: 'open_file', input: { file_path: 'src/ChatInput.tsx' } },
            { type: 'tool_use', id: 'search-1', name: 'search_code', input: { query: 'sendWithMedia' } },
          ],
        }}
        showThinking
        chatProcessDisplayMode="all"
        streamingTools={[
          {
            id: 'read-1',
            toolCallId: 'read-1',
            name: 'read_file',
            status: 'running',
          },
          {
            id: 'read-2',
            toolCallId: 'read-2',
            name: 'open_file',
            status: 'running',
          },
          {
            id: 'search-1',
            toolCallId: 'search-1',
            name: 'search_code',
            status: 'running',
          },
        ]}
      />,
    );

    expect(screen.getAllByTestId('chat-process-event-row')).toHaveLength(3);
    expect(screen.getAllByTestId('chat-process-event-summary').map((node) => node.textContent)).toEqual([
      'Reading content',
      'Reading content',
      'Reading content',
    ]);
  });

  it('hides internal heartbeat process reads and notes from the process stream', () => {
    const { container } = render(
      <ProcessEventMessage
        message={{
          id: 'assistant-heartbeat-1',
          role: 'assistant',
          content: [
            { type: 'text', text: '用户发来了heartbeat检查请求，我需要读取HEARTBEAT.md文件。' },
            {
              type: 'tool_use',
              id: 'read-heartbeat-1',
              name: 'read_file',
              input: { path: 'C:/Users/Administrator/.openclaw/workspace/HEARTBEAT.md' },
            },
            {
              type: 'tool_result',
              id: 'read-heartbeat-1',
              name: 'read_file',
              content: '已读取内容 C:/Users/Administrator/.openclaw/workspace/HEARTBEAT.md',
            },
          ],
        }}
        showThinking
        chatProcessDisplayMode="all"
      />,
    );

    expect(screen.queryByTestId('chat-process-note-content')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chat-process-event-row')).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it('hides english routine heartbeat reasoning from the process stream', () => {
    const { container } = render(
      <ProcessEventMessage
        message={{
          id: 'assistant-heartbeat-english',
          role: 'assistant',
          content: [
            {
              type: 'thinking',
              thinking: 'The user is asking me to check HEARTBEAT.md again. This is a routine heartbeat check. I need to read the file and respond with HEARTBEAT_OK if there\'s nothing that needs attention.',
            },
            {
              type: 'tool_use',
              id: 'read-heartbeat-english',
              name: 'read_file',
              input: { path: 'C:/Users/Administrator/.openclaw/workspace/HEARTBEAT.md' },
            },
            {
              type: 'tool_result',
              id: 'read-heartbeat-english',
              name: 'read_file',
              content: 'HEARTBEAT_OK',
            },
          ],
        }}
        showThinking
        chatProcessDisplayMode="all"
      />,
    );

    expect(screen.queryByTestId('chat-process-thinking-content')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chat-process-event-row')).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it('keeps normal HEARTBEAT.md troubleshooting reads visible outside internal heartbeat flow', () => {
    render(
      <ProcessEventMessage
        message={{
          id: 'assistant-heartbeat-2',
          role: 'assistant',
          content: [
            { type: 'text', text: 'I am comparing the committed HEARTBEAT.md template with the runtime workspace copy.' },
            {
              type: 'tool_use',
              id: 'read-repo-heartbeat-1',
              name: 'read_file',
              input: { path: 'D:/AI/Deep AI Worker/ClawX/HEARTBEAT.md' },
            },
          ],
        }}
        showThinking
        chatProcessDisplayMode="all"
      />,
    );

    expect(screen.getByTestId('chat-process-note-content')).toBeInTheDocument();
    expect(screen.getByTestId('chat-process-event-row')).toBeInTheDocument();
    expect(screen.getByText(/template with the runtime workspace copy/i)).toBeInTheDocument();
  });

  it('shows internal heartbeat events when filtering is disabled', () => {
    const items = getProcessEventItems(
      {
        id: 'assistant-heartbeat-visible',
        role: 'assistant',
        content: [
          {
            type: 'thinking',
            thinking: 'The user is asking me to check HEARTBEAT.md again. This is a routine heartbeat check.',
          },
          {
            type: 'tool_use',
            id: 'read-heartbeat-visible',
            name: 'read_file',
            input: { path: 'C:/Users/Administrator/.openclaw/workspace/HEARTBEAT.md' },
          },
          {
            type: 'tool_result',
            id: 'read-heartbeat-visible',
            name: 'read_file',
            content: 'HEARTBEAT_OK',
          },
        ],
      },
      true,
      'all',
      false,
    );

    expect(items).toHaveLength(3);
    expect(items.some((item) => item.kind === 'thinking')).toBe(true);
    expect(items.some((item) => item.kind === 'tool_call')).toBe(true);
    expect(items.some((item) => item.kind === 'tool_result')).toBe(true);
  });

  it('rewrites the heartbeat task-check note to a calmer system phrasing', () => {
    render(
      <ProcessEventMessage
        message={{
          id: 'assistant-heartbeat-copy',
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: '用户又在发送心跳检查请求，我需要读取 HEARTBEAT.md 文件确认是否有需要处理的任务。',
            },
          ],
        }}
        showThinking
        chatProcessDisplayMode="files"
        hideInternalRoutineProcesses={false}
      />,
    );

    expect(screen.getByText('发送心跳检查请求，系统读取 HEARTBEAT.md 文件跟进待办任务。')).toBeInTheDocument();
    expect(screen.queryByText('用户又在发送心跳检查请求，我需要读取 HEARTBEAT.md 文件确认是否有需要处理的任务。')).not.toBeInTheDocument();
  });
});
