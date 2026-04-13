import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { Chat } from '@/pages/Chat';

const navigateMock = vi.fn();
const fixedNow = 2_000_000;

const { agentsState, chatState, gatewayState, settingsState } = vi.hoisted(() => ({
  agentsState: {
    fetchAgents: vi.fn(async () => {}),
  },
  chatState: {
    messages: [] as Array<Record<string, unknown>>,
    currentSessionKey: 'agent:main:main',
    loading: false,
    sending: true,
    error: null as string | null,
    showThinking: true,
    streamingMessage: null as unknown,
    streamingTools: [] as Array<Record<string, unknown>>,
    pendingFinal: false,
    lastUserMessageAt: 1000,
    sendMessage: vi.fn(),
    abortRun: vi.fn(),
    clearError: vi.fn(),
    cleanupEmptySession: vi.fn(),
    loadHistory: vi.fn(async () => {}),
  },
  gatewayState: {
    status: { state: 'running', port: 18789 },
    start: vi.fn(async () => {}),
    restart: vi.fn(async () => {}),
  },
  settingsState: {
    chatProcessDisplayMode: 'all',
    chatFontScale: 100,
    assistantMessageStyle: 'bubble',
  },
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: {
      resolvedLanguage: 'en',
      language: 'en',
    },
    t: (key: string, params?: Record<string, string | number>) => {
      switch (key) {
        case 'process.durationHourMinute':
          return `${params?.hours}h ${params?.minutes}m`;
        case 'process.durationMinuteSecond':
          return `${params?.minutes}m ${params?.seconds}s`;
        case 'process.durationSecond':
          return `${params?.seconds}s`;
        case 'process.workingFor':
          return `Working for ${params?.duration}`;
        case 'process.processedFor':
          return `Processed ${params?.duration}`;
        default:
          if (!params) return key;
          return `${key}:${Object.values(params).join(' ')}`;
      }
    },
  }),
}));

vi.mock('@/stores/chat', () => ({
  useChatStore: (selector: (state: typeof chatState) => unknown) => selector(chatState),
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: (selector: (state: typeof gatewayState) => unknown) => selector(gatewayState),
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: (selector: (state: typeof agentsState) => unknown) => selector(agentsState),
}));

vi.mock('@/stores/settings', () => ({
  useSettingsStore: (selector: (state: typeof settingsState) => unknown) => selector(settingsState),
}));

vi.mock('@/hooks/use-stick-to-bottom-instant', () => ({
  useStickToBottomInstant: () => ({
    contentRef: { current: null },
    scrollRef: { current: null },
  }),
}));

vi.mock('@/hooks/use-min-loading', () => ({
  useMinLoading: () => false,
}));

vi.mock('@/lib/branding', () => ({
  useBranding: () => ({
    productName: 'ClawX',
  }),
}));

vi.mock('@/components/common/LoadingSpinner', () => ({
  LoadingSpinner: () => <div data-testid="loading-spinner" />,
}));

vi.mock('@/pages/Chat/ChatInput', () => ({
  ChatInput: () => <div data-testid="chat-input" />,
}));

vi.mock('@/pages/Chat/ChatToolbar', () => ({
  ChatToolbar: () => <div data-testid="chat-toolbar" />,
}));

describe('Chat process turn rendering', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    navigateMock.mockReset();
    vi.spyOn(Date, 'now').mockReturnValue(fixedNow);
    agentsState.fetchAgents.mockClear();
    chatState.currentSessionKey = 'agent:main:main';
    chatState.loading = false;
    chatState.sending = true;
    chatState.error = null;
    chatState.showThinking = true;
    chatState.streamingTools = [];
    chatState.lastUserMessageAt = 1000;
    settingsState.chatProcessDisplayMode = 'all';
    settingsState.chatFontScale = 100;
    settingsState.assistantMessageStyle = 'bubble';
    chatState.messages = [
      {
        id: 'user-1',
        role: 'user',
        content: 'Take a photo for me.',
        timestamp: fixedNow / 1000 - 1,
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Checking the camera.' },
          { type: 'text', text: 'Preparing the camera.' },
        ],
        timestamp: fixedNow / 1000,
      },
    ];
  });

  it('keeps the original bubble-style process content when the final answer has not started yet', () => {
    chatState.pendingFinal = false;
    chatState.streamingMessage = {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'Still checking the setup.' },
      ],
      timestamp: fixedNow / 1000,
    };

    render(<Chat />);

    expect(screen.getByTestId('chat-process-header')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-process-toggle')).not.toBeInTheDocument();
    expect(screen.getByTestId('chat-process-status')).toHaveTextContent('Working for 1s');
    expect(screen.getByTestId('chat-process-content')).toBeInTheDocument();
    expect(screen.getByText('Preparing the camera.')).toBeInTheDocument();
    expect(screen.getAllByTestId('chat-process-avatar')).toHaveLength(1);
    expect(screen.queryByTestId('chat-assistant-avatar')).not.toBeInTheDocument();
  });

  it('keeps only the latest process stream expanded in stream mode while the final answer has not started yet', () => {
    settingsState.assistantMessageStyle = 'stream';
    chatState.pendingFinal = false;
    chatState.streamingMessage = {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'Still checking the setup.' },
      ],
      timestamp: fixedNow / 1000,
    };

    render(<Chat />);

    expect(screen.getByTestId('chat-process-header')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-process-toggle')).not.toBeInTheDocument();
    expect(screen.getByTestId('chat-process-status')).toHaveTextContent('Working for 1s');
    const processContent = screen.getByTestId('chat-process-content');
    expect(processContent).toBeInTheDocument();
    expect(screen.getByText('Preparing the camera.')).toBeInTheDocument();
    expect(within(processContent).getAllByTestId('chat-process-thinking-content').length).toBeGreaterThan(0);
    expect(within(processContent).queryByTestId('chat-process-event-row')).not.toBeInTheDocument();
    expect(within(processContent).queryByTestId('chat-process-event-item-row')).not.toBeInTheDocument();
    expect(within(processContent).queryByTestId('chat-message-content-assistant')).not.toBeInTheDocument();
    expect(screen.getAllByText('Still checking the setup.').length).toBeGreaterThan(0);
    expect(screen.getByTestId('chat-process-activity-label')).toHaveTextContent('Thinking');
    expect(screen.getAllByTestId('chat-process-avatar')).toHaveLength(1);
    expect(screen.queryByTestId('chat-assistant-avatar')).not.toBeInTheDocument();
  });

  it('keeps all unfinished output inside the process section while the reply is still streaming', () => {
    chatState.pendingFinal = true;
    chatState.streamingMessage = {
      role: 'assistant',
      content: 'Photo saved (60KB). You should be able to see it now.',
      timestamp: fixedNow / 1000 + 1,
    };

    render(<Chat />);

    expect(screen.queryByTestId('chat-process-toggle')).not.toBeInTheDocument();
    expect(screen.getByTestId('chat-process-content')).toBeInTheDocument();
    expect(screen.getByTestId('chat-process-status')).toHaveTextContent('Working for 1s');
    expect(screen.getByText('Photo saved (60KB). You should be able to see it now.')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-final-result-divider')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('chat-process-avatar')).toHaveLength(1);
    expect(screen.queryByTestId('chat-assistant-avatar')).not.toBeInTheDocument();
  });

  it('renders streaming final string in stream mode inside the process section while sending', () => {
    settingsState.assistantMessageStyle = 'stream';
    chatState.pendingFinal = true;
    chatState.streamingMessage = {
      role: 'assistant',
      content: 'Photo saved (60KB). You should be able to see it now.',
      timestamp: fixedNow / 1000 + 1,
    };

    render(<Chat />);

    expect(screen.getByText('Photo saved (60KB). You should be able to see it now.')).toBeInTheDocument();
    const notes = within(screen.getByTestId('chat-process-content')).getAllByTestId('chat-process-note-content');
    expect(notes.length).toBeGreaterThanOrEqual(1);
  });

  it('collapses persisted process content from a single assistant reply in history', () => {
    chatState.sending = false;
    chatState.pendingFinal = false;
    chatState.streamingMessage = null;
    chatState.messages = [
      {
        id: 'user-1',
        role: 'user',
        content: 'What is Memo?',
        timestamp: 1000,
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Confirm the concept before answering.' },
          { type: 'text', text: 'Memo is an AI memory layer project.' },
        ],
        timestamp: 1001,
      },
    ];

    render(<Chat />);

    expect(screen.getByTestId('chat-process-toggle')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-process-content')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chat-final-result-divider')).not.toBeInTheDocument();
    expect(screen.getByText('Memo is an AI memory layer project.')).toBeInTheDocument();
    expect(screen.getAllByTestId('chat-process-avatar')).toHaveLength(1);
    expect(screen.queryByText('Thinking')).not.toBeInTheDocument();
  });

  it('keeps the process toggle anchored when expanding a collapsed history section', () => {
    chatState.sending = false;
    chatState.pendingFinal = false;
    chatState.streamingMessage = null;
    settingsState.assistantMessageStyle = 'stream';
    chatState.messages = [
      {
        id: 'user-1',
        role: 'user',
        content: 'Check the browser status.',
        timestamp: 1000,
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'I should inspect the browser state first.' },
          { type: 'tool_use', id: 'browser-1', name: 'browser', input: { action: 'start', enabled: true } },
          { type: 'text', text: 'The browser is ready.' },
        ],
        timestamp: 1001,
      },
    ];

    render(<Chat />);

    const scrollContainer = screen.getByTestId('chat-scroll-container');
    const toggle = screen.getByTestId('chat-process-toggle');
    scrollContainer.scrollTop = 120;

    const rect = vi.fn()
      .mockReturnValueOnce({
        top: 180,
        bottom: 200,
        left: 0,
        right: 0,
        width: 0,
        height: 20,
        x: 0,
        y: 180,
        toJSON: () => ({}),
      })
      .mockReturnValueOnce({
        top: 120,
        bottom: 140,
        left: 0,
        right: 0,
        width: 0,
        height: 20,
        x: 0,
        y: 120,
        toJSON: () => ({}),
      });
    vi.spyOn(toggle, 'getBoundingClientRect').mockImplementation(rect);

    fireEvent.click(toggle);

    expect(scrollContainer.scrollTop).toBe(60);
    expect(screen.getByTestId('chat-process-content')).toBeInTheDocument();
  });

  it('shows a live thinking status indicator during the processing phase in stream mode', () => {
    settingsState.assistantMessageStyle = 'stream';
    chatState.pendingFinal = false;
    chatState.streamingMessage = {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'I should inspect the browser state first.' },
      ],
      timestamp: fixedNow / 1000,
    };

    render(<Chat />);

    expect(screen.getByTestId('chat-process-activity-stream')).toBeInTheDocument();
    expect(screen.getByTestId('chat-process-activity-label')).toHaveTextContent('Thinking');
    expect(screen.getByTestId('chat-process-activity-scan')).toBeInTheDocument();
  });
});
