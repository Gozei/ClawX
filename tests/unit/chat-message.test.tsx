import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ChatMessage } from '@/pages/Chat/ChatMessage';
import type { RawMessage } from '@/stores/chat';

const { settingsState, invokeIpcMock } = vi.hoisted(() => ({
  settingsState: {
    chatProcessDisplayMode: 'all',
    chatFontScale: 100,
    assistantMessageStyle: 'bubble',
  },
  invokeIpcMock: vi.fn(),
}));

const agentsState = {
  agents: [
    {
      id: 'main',
      name: 'Main',
      modelRef: 'custom-custombc/gpt-5.4',
    },
  ],
  defaultModelRef: 'openai/gpt-4.1',
};

const chatState = {
  currentAgentId: 'main',
  currentSessionKey: 'agent:main:main',
  sessions: [{ key: 'agent:main:main', model: 'custom-custombc/gpt-5.4' }],
  sessionModels: {} as Record<string, string>,
};

const providersState = {
  accounts: [
    {
      id: 'custom-bc',
      vendorId: 'custom',
      label: 'JD Provider',
      model: 'gpt-5.4',
      metadata: { customModels: ['gpt-5.4'] },
      updatedAt: '2026-04-14T10:00:00.000Z',
      createdAt: '2026-04-14T10:00:00.000Z',
      authMode: 'api_key',
      apiProtocol: 'openai',
      baseUrl: 'https://example.com/v1',
    },
  ],
  statuses: [],
  vendors: [
    {
      id: 'custom',
      name: 'Custom',
    },
  ],
  defaultAccountId: 'custom-bc',
};

vi.mock('@/stores/settings', () => ({
  useSettingsStore: (selector: (state: typeof settingsState) => unknown) => selector(settingsState),
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: (selector: (state: typeof agentsState) => unknown) => selector(agentsState),
}));

vi.mock('@/stores/chat', async () => {
  const actual = await vi.importActual<typeof import('@/stores/chat')>('@/stores/chat');
  return {
    ...actual,
    useChatStore: (selector: (state: typeof chatState) => unknown) => selector(chatState),
  };
});

vi.mock('@/stores/providers', () => ({
  useProviderStore: (selector: (state: typeof providersState) => unknown) => selector(providersState),
}));

vi.mock('@/lib/api-client', () => ({
  invokeIpc: (...args: unknown[]) => invokeIpcMock(...args),
}));

describe('ChatMessage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    settingsState.chatProcessDisplayMode = 'all';
    settingsState.chatFontScale = 100;
    settingsState.assistantMessageStyle = 'bubble';
    agentsState.defaultModelRef = 'openai/gpt-4.1';
    agentsState.agents[0].modelRef = 'custom-custombc/gpt-5.4';
    chatState.currentSessionKey = 'agent:main:main';
    chatState.sessions = [{ key: 'agent:main:main', model: 'custom-custombc/gpt-5.4' }];
    chatState.sessionModels = {};
    invokeIpcMock.mockReset();
    invokeIpcMock.mockResolvedValue({ success: true });
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

  it('shows the persisted assistant message model label next to message metadata', () => {
    const message: RawMessage = {
      id: 'assistant-model-1',
      role: 'assistant',
      content: 'Model metadata row',
      provider: 'custom-custombc',
      model: 'gpt-5.4',
      timestamp: 1712123456,
    };

    render(<ChatMessage message={message} showThinking={false} />);

    expect(screen.getByTestId('chat-message-model-label')).toHaveTextContent('JD Provider / gpt-5.4');
  });

  it('keeps the assistant message model label stable after the input model switches', () => {
    chatState.sessionModels = { 'agent:main:main': 'custom-custombc/qwen3.5-plus' };
    chatState.sessions = [{ key: 'agent:main:main', model: 'custom-custombc/qwen3.5-plus' }];
    agentsState.defaultModelRef = 'custom-custombc/qwen3.5-plus';
    agentsState.agents[0].modelRef = 'custom-custombc/qwen3.5-plus';

    const message: RawMessage = {
      id: 'assistant-model-2',
      role: 'assistant',
      content: 'Model metadata row',
      provider: 'custom-custombc',
      model: 'gpt-5.4',
      timestamp: 1712123456,
    };

    render(<ChatMessage message={message} showThinking={false} />);

    expect(screen.getByTestId('chat-message-model-label')).toHaveTextContent('JD Provider / gpt-5.4');
    expect(screen.getByTestId('chat-message-model-label')).not.toHaveTextContent('qwen3.5-plus');
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

  it('lightly formats markdown markers while the assistant reply is still streaming', () => {
    settingsState.assistantMessageStyle = 'stream';

    const message: RawMessage = {
      id: 'assistant-streaming-markdown',
      role: 'assistant',
      content: '### Section\n\n1. **AI and Models**\n- LM Report',
    };

    render(<ChatMessage message={message} showThinking={false} isStreaming />);

    expect(screen.getByText('Section')).toBeInTheDocument();
    expect(screen.getByText('1.')).toBeInTheDocument();
    expect(screen.getByText('AI and Models')).toBeInTheDocument();
    expect(screen.queryByText('### Section')).not.toBeInTheDocument();
    expect(screen.queryByText('**AI and Models**')).not.toBeInTheDocument();
  });

  it('renders assistant error replies with the dedicated error styling hook', () => {
    const message: RawMessage = {
      id: 'assistant-error-1',
      role: 'assistant',
      content: 'Provider quota is exhausted.',
      isError: true,
    };

    render(<ChatMessage message={message} showThinking={false} />);

    expect(screen.getByTestId('chat-assistant-error-message')).toBeInTheDocument();
  });

  it('renders assistant markdown replies inside the shrinkable chat markdown surface', async () => {
    const message: RawMessage = {
      id: 'assistant-overflow-1',
      role: 'assistant',
      content: [
        'A minimal environmental penalty icon, 28x28 pixels. A simple leaf outline drawn with gray lines (#808080), combined with a blue warning mark (#0b7fff).',
        '',
        '| Element | Description |',
        '| --- | --- |',
        '| Palette | Gray + blue (#0b7fff) |',
      ].join('\n'),
    };

    render(<ChatMessage message={message} showThinking={false} />);

    const bubble = screen.getByTestId('chat-assistant-message-bubble');
    expect(bubble).toHaveClass('min-w-0');
    expect(bubble).toHaveClass('max-w-full');
    expect(
      screen.getByText(/A minimal environmental penalty icon, 28x28 pixels\./).closest('.chat-markdown'),
    ).not.toBeNull();
    expect(bubble).toHaveTextContent('Gray + blue (#0b7fff)');
  });

  it('renders assistant file attachments with the richer file card treatment', () => {
    const message: RawMessage = {
      id: 'assistant-file-1',
      role: 'assistant',
      content: 'Generated file ready.',
      _attachedFiles: [
        {
          fileName: 'HEARTBEAT.md',
          fileSize: 193,
          mimeType: 'text/markdown',
          filePath: '/tmp/HEARTBEAT.md',
        },
      ],
    };

    render(<ChatMessage message={message} showThinking={false} />);

    expect(screen.getByTestId('chat-file-card')).toBeInTheDocument();
    expect(screen.getByText('HEARTBEAT.md')).toBeInTheDocument();
    expect(screen.getByTestId('chat-file-ext-badge')).toHaveTextContent('MD');
    expect(screen.getByText(/Markdown/)).toBeInTheDocument();
  });

  it('adds a copy button to the image lightbox', () => {
    const message: RawMessage = {
      id: 'assistant-image-1',
      role: 'assistant',
      content: 'Preview image.',
      _attachedFiles: [
        {
          fileName: 'preview.png',
          fileSize: 1024,
          mimeType: 'image/png',
          filePath: '/tmp/preview.png',
          preview: 'data:image/png;base64,abc123',
        },
      ],
    };

    render(<ChatMessage message={message} showThinking={false} />);

    fireEvent.click(screen.getByTestId('chat-file-card'));
    fireEvent.click(screen.getByTestId('chat-image-lightbox-copy'));

    expect(invokeIpcMock).toHaveBeenCalledWith('media:copyImage', {
      filePath: '/tmp/preview.png',
      base64: undefined,
    });
  });
});
