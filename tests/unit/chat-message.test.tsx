import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ChatMessage } from '@/pages/Chat/ChatMessage';
import type { RawMessage } from '@/stores/chat';

const { settingsState } = vi.hoisted(() => ({
  settingsState: {
    chatProcessDisplayMode: 'all',
    chatFontScale: 100,
    assistantMessageStyle: 'bubble',
  },
}));

vi.mock('@/stores/settings', () => ({
  useSettingsStore: (selector: (state: typeof settingsState) => unknown) => selector(settingsState),
}));

describe('ChatMessage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    settingsState.chatProcessDisplayMode = 'all';
    settingsState.chatFontScale = 100;
    settingsState.assistantMessageStyle = 'bubble';
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn(),
      },
      configurable: true,
    });
  });

  it('copies user message text from the hover action', () => {
    const message: RawMessage = {
      id: 'user-1',
      role: 'user',
      content: 'Copy this user message',
      timestamp: 1712123456,
    };

    render(<ChatMessage message={message} showThinking={false} />);

    fireEvent.click(screen.getByTestId('chat-message-copy-user'));

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Copy this user message');
  });

  it('renders tool cards at full width so process blocks stay aligned', () => {
    const message: RawMessage = {
      id: 'assistant-1',
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: 'tool-1',
          name: 'cron',
          input: { action: 'list' },
        },
      ],
    };

    render(<ChatMessage message={message} showThinking={true} />);

    expect(screen.getByTestId('chat-tool-card')).toHaveClass('w-full');
  });

  it('can inherit the parent width for process messages', () => {
    const message: RawMessage = {
      id: 'assistant-2',
      role: 'assistant',
      content: 'Process step',
    };

    render(<ChatMessage message={message} showThinking={false} constrainWidth={false} />);

    expect(screen.getByTestId('chat-message-content-assistant')).not.toHaveClass('max-w-[80%]');
  });

  it('renders assistant replies in stream mode without the bubble chrome', () => {
    settingsState.assistantMessageStyle = 'stream';

    const message: RawMessage = {
      id: 'assistant-3',
      role: 'assistant',
      content: 'Flat response content',
    };

    render(<ChatMessage message={message} showThinking={false} />);

    expect(screen.getByTestId('chat-assistant-message-stream')).toBeInTheDocument();
    expect(screen.getByTestId('chat-message-content-assistant')).not.toHaveClass('max-w-[80%]');
  });
});
