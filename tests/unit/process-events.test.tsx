import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProcessEventMessage } from '@/pages/Chat/process-events';

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
    render(
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
        defaultExpanded
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
    expect(screen.getAllByTestId('chat-process-event-item-row')).toHaveLength(1);
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
    expect(within(row).getByTestId('chat-process-event-summary')).toHaveTextContent('Opened browser');
    expect(within(row).getByTestId('chat-process-event-preview')).toBeInTheDocument();
    expect(within(row).getByTestId('chat-process-event-toggle-icon')).toHaveClass('opacity-0');

    fireEvent.click(within(row).getByTestId('chat-process-event-toggle'));

    expect(within(row).queryByTestId('chat-process-event-preview')).not.toBeInTheDocument();
    expect(within(row).getByText(/"enabled": true/)).toBeInTheDocument();
    expect(within(row).getByTestId('chat-process-event-toggle-icon')).toHaveClass('opacity-100');
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

    const row = screen.getByTestId('chat-process-event-row');
    expect(within(row).getByTestId('chat-process-event-summary')).toHaveTextContent('Working on 2 files, 1 search');
  });
});
