import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { Chat } from '@/pages/Chat';

const navigateMock = vi.fn();
const fixedNow = 2_000_000;

const { agentsState, chatState, gatewayState, settingsState, stickToBottomRefs } = vi.hoisted(() => ({
  agentsState: {
    fetchAgents: vi.fn(async () => {}),
  },
  chatState: {
    messages: [] as Array<Record<string, unknown>>,
    currentSessionKey: 'agent:main:main',
    loading: false,
    sending: true,
    sessionRunningState: {} as Record<string, boolean>,
    error: null as string | null,
    showThinking: true,
    streamingMessage: null as unknown,
    streamingTools: [] as Array<Record<string, unknown>>,
    sendStage: 'running' as string | null,
    pendingFinal: false,
    lastUserMessageAt: 1000,
    sendMessage: vi.fn(),
    queueOfflineMessage: vi.fn(),
    flushQueuedMessage: vi.fn(),
    clearQueuedMessage: vi.fn(),
    abortRun: vi.fn(),
    clearError: vi.fn(),
    cleanupEmptySession: vi.fn(),
    loadHistory: vi.fn(async () => {}),
    queuedMessages: {} as Record<string, unknown>,
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
  stickToBottomRefs: {
    contentRef: { current: null as HTMLElement | null },
    scrollRef: { current: null as HTMLElement | null },
    stopScroll: vi.fn(),
  },
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
  useLocation: () => ({
    state: null,
    key: 'chat-process-turn',
    pathname: '/',
    search: '',
    hash: '',
  }),
}));

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
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
  };
});

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
  useStickToBottomInstant: () => stickToBottomRefs,
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
  ChatInput: ({ sending }: { sending?: boolean }) => (
    <div data-testid="chat-input" data-sending={sending ? 'true' : 'false'} />
  ),
}));

vi.mock('@/pages/Chat/ChatToolbarV2', () => ({
  ChatToolbarV2: () => <div data-testid="chat-toolbar" />,
}));

describe('Chat process turn rendering', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    navigateMock.mockReset();
    vi.spyOn(Date, 'now').mockReturnValue(fixedNow);
    agentsState.fetchAgents.mockClear();
    stickToBottomRefs.contentRef.current = null;
    stickToBottomRefs.scrollRef.current = null;
    stickToBottomRefs.stopScroll.mockClear();
    chatState.currentSessionKey = 'agent:main:main';
    chatState.loading = false;
    chatState.sending = true;
    chatState.sessionRunningState = { 'agent:main:main': true };
    chatState.error = null;
    chatState.showThinking = true;
    chatState.streamingTools = [];
    chatState.sendStage = 'running';
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

    const processHeaderRow = screen.getByTestId('chat-process-header-row');
    const processHeaderMeta = screen.getByTestId('chat-process-header-meta');
    expect(within(processHeaderRow).getByTestId('chat-process-header-brand-name')).toHaveTextContent('ClawX');
    expect(within(processHeaderRow).queryByTestId('chat-process-header-brand-scan')).not.toBeInTheDocument();
    expect(within(processHeaderMeta).getByTestId('chat-process-header')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-process-toggle')).not.toBeInTheDocument();
    expect(screen.getByTestId('chat-process-status')).toHaveTextContent('Working for 1s');
    const processContent = screen.getByTestId('chat-process-content');
    expect(processHeaderRow).toHaveClass('items-center');
    expect(screen.getByTestId('chat-process-avatar')).not.toHaveClass('mt-1');
    expect(processContent).toBeInTheDocument();
    expect(processContent).not.toHaveClass('-mx-4');
    expect(processContent).not.toHaveClass('w-[calc(100%+2rem)]');
    expect(processContent.previousElementSibling).toBe(processHeaderMeta);
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

    const processHeaderRow = screen.getByTestId('chat-process-header-row');
    const processHeaderMeta = screen.getByTestId('chat-process-header-meta');
    expect(within(processHeaderRow).getByTestId('chat-process-header-brand-name')).toHaveTextContent('ClawX');
    expect(within(processHeaderRow).queryByTestId('chat-process-header-brand-scan')).not.toBeInTheDocument();
    expect(within(processHeaderMeta).getByTestId('chat-process-header')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-process-toggle')).not.toBeInTheDocument();
    expect(screen.getByTestId('chat-process-status')).toHaveTextContent('Working for 1s');
    expect(processHeaderRow).toHaveClass('items-center');
    expect(screen.getByTestId('chat-process-avatar')).not.toHaveClass('mt-1');
    const processContent = screen.getByTestId('chat-process-content');
    expect(processContent).toBeInTheDocument();
    expect(processContent).not.toHaveClass('-mx-4');
    expect(processContent).not.toHaveClass('w-[calc(100%+2rem)]');
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

  it('lightly formats markdown-looking thinking content in the live process stream', () => {
    settingsState.assistantMessageStyle = 'stream';
    chatState.pendingFinal = false;
    chatState.streamingMessage = {
      role: 'assistant',
      content: [
        {
          type: 'thinking',
          thinking: '### 内容分类\n\n1. **人工智能与大模型技术**\n- LM 技术报告',
        },
      ],
      timestamp: fixedNow / 1000,
    };

    render(<Chat />);

    const processContent = screen.getByTestId('chat-process-content');
    expect(processContent).toBeInTheDocument();
    expect(within(processContent).getByText('内容分类')).toBeInTheDocument();
    expect(within(processContent).getByText('人工智能与大模型技术')).toBeInTheDocument();
    expect(within(processContent).queryByText('### 内容分类')).not.toBeInTheDocument();
    expect(within(processContent).queryByText('**人工智能与大模型技术**')).not.toBeInTheDocument();
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
    chatState.sessionRunningState = {};
    chatState.sendStage = null;
    chatState.pendingFinal = false;
    chatState.streamingMessage = null;
    chatState.lastUserMessageAt = 0;
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

    const processHeaderRow = screen.getByTestId('chat-process-header-row');
    const processHeaderMeta = screen.getByTestId('chat-process-header-meta');
    expect(screen.getByTestId('chat-process-toggle')).toBeInTheDocument();
    expect(within(processHeaderRow).getByTestId('chat-process-header-brand-name')).toHaveTextContent('ClawX');
    expect(within(processHeaderRow).queryByTestId('chat-process-toggle')).not.toBeInTheDocument();
    expect(within(processHeaderMeta).getByTestId('chat-process-toggle')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-process-content')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chat-final-result-divider')).not.toBeInTheDocument();
    expect(screen.getByText('Memo is an AI memory layer project.')).toBeInTheDocument();
    const assistantContent = screen.getByTestId('chat-message-content-assistant');
    expect(assistantContent.parentElement?.firstElementChild).toBe(assistantContent);
    expect(screen.getAllByTestId('chat-process-avatar')).toHaveLength(1);
    expect(screen.queryByText('Thinking')).not.toBeInTheDocument();
  });

  it('keeps the latest completed turn in process layout before history hydration catches up', () => {
    chatState.sending = false;
    chatState.sessionRunningState = {};
    chatState.sendStage = null;
    chatState.pendingFinal = false;
    chatState.streamingMessage = null;
    chatState.lastUserMessageAt = (fixedNow - 1_000) / 1000;
    chatState.messages = [
      {
        id: 'user-1',
        role: 'user',
        content: '你现在是什么模型',
        timestamp: (fixedNow - 1_000) / 1000,
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '现在还是 custom-custombc/qwen3.5-plus，没变。',
        timestamp: fixedNow / 1000,
      },
    ];

    render(<Chat />);

    expect(screen.getByTestId('chat-process-header')).toBeInTheDocument();
    expect(screen.getByTestId('chat-process-content')).toBeInTheDocument();
    expect(screen.getByTestId('chat-process-status')).toHaveTextContent('Processed 1s');
    expect(screen.getByText('现在还是 custom-custombc/qwen3.5-plus，没变。')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-assistant-avatar')).not.toBeInTheDocument();
  });

  it('prefers the settled session-running state over a stale local sending flag', () => {
    chatState.sending = true;
    chatState.sessionRunningState = {};
    chatState.sendStage = null;
    chatState.pendingFinal = false;
    chatState.streamingMessage = null;
    chatState.streamingTools = [];
    chatState.lastUserMessageAt = (fixedNow - 1_000) / 1000;
    chatState.messages = [
      {
        id: 'user-1',
        role: 'user',
        content: 'What model are you using?',
        timestamp: (fixedNow - 1_000) / 1000,
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: 'I am using qwen3.5-plus.',
        timestamp: fixedNow / 1000,
      },
    ];

    render(<Chat />);

    expect(screen.getByTestId('chat-process-status')).toHaveTextContent('Processed 1s');
    expect(screen.getByTestId('chat-input')).toHaveAttribute('data-sending', 'false');
  });

  it('keeps the scroll position steady when expanding a collapsed history section', () => {
    chatState.sending = false;
    chatState.sessionRunningState = {};
    chatState.sendStage = null;
    chatState.pendingFinal = false;
    chatState.streamingMessage = null;
    chatState.lastUserMessageAt = 0;
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
      {
        id: 'user-2',
        role: 'user',
        content: 'Thanks.',
        timestamp: 1002,
      },
      {
        id: 'assistant-2',
        role: 'assistant',
        content: 'All set.',
        timestamp: 1003,
      },
    ];

    render(<Chat />);

    const scrollContainer = screen.getByTestId('chat-scroll-container');
    const toggle = screen.getByTestId('chat-process-toggle');
    scrollContainer.scrollTop = 120;

    fireEvent.click(toggle);

    expect(stickToBottomRefs.stopScroll).toHaveBeenCalledTimes(1);
    expect(scrollContainer.scrollTop).toBe(120);
    expect(screen.getByTestId('chat-process-content')).toBeInTheDocument();
  });

  it('aligns a newly active turn to the top of the scroll container when sending starts', () => {
    const rafQueue: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      rafQueue.push(callback);
      return rafQueue.length;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    settingsState.assistantMessageStyle = 'stream';
    chatState.messages = [
      {
        id: 'history-user-1',
        role: 'user',
        content: 'Old question one.',
        timestamp: fixedNow / 1000 - 5,
      },
      {
        id: 'history-assistant-1',
        role: 'assistant',
        content: 'Old answer one.',
        timestamp: fixedNow / 1000 - 4,
      },
      {
        id: 'history-user-2',
        role: 'user',
        content: 'What model are you?',
        timestamp: fixedNow / 1000 - 1,
      },
    ];
    chatState.pendingFinal = false;
    chatState.streamingMessage = null;
    chatState.lastUserMessageAt = fixedNow / 1000 - 1;
    chatState.sessionRunningState = { 'agent:main:main': true };

    render(<Chat />);

    const scrollContainer = screen.getByTestId('chat-scroll-container');
    const activeTurnAnchor = screen.getByTestId('chat-active-turn-anchor');
    scrollContainer.scrollTop = 280;

    vi.spyOn(scrollContainer, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 80,
      width: 960,
      height: 640,
      top: 80,
      right: 960,
      bottom: 720,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect);
    vi.spyOn(activeTurnAnchor, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 260,
      width: 960,
      height: 240,
      top: 260,
      right: 960,
      bottom: 500,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect);

    act(() => {
      while (rafQueue.length > 0) {
        const callback = rafQueue.shift();
        callback?.(0);
      }
    });

    expect(scrollContainer.scrollTop).toBe(460);
    expect(stickToBottomRefs.stopScroll.mock.calls.length).toBeGreaterThanOrEqual(2);
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
    expect(screen.getByTestId('chat-process-header-brand-name')).toHaveTextContent('ClawX');
    expect(screen.getByTestId('chat-process-header-brand-name')).toHaveClass('text-[16px]');
    expect(screen.queryByTestId('chat-process-header-brand-scan')).not.toBeInTheDocument();
  });

  it('shows the product name with a scan effect while waiting for the first streaming content', () => {
    chatState.messages = [
      {
        id: 'user-1',
        role: 'user',
        content: 'Ping the model.',
        timestamp: fixedNow / 1000 - 1,
      },
    ];
    chatState.sending = true;
    chatState.pendingFinal = false;
    chatState.streamingMessage = null;

    render(<Chat />);

    expect(screen.getByTestId('chat-typing-indicator')).not.toHaveClass('-mx-4');
    expect(screen.getByTestId('chat-typing-indicator')).toHaveClass('w-full');
    expect(screen.getByTestId('chat-typing-indicator')).not.toHaveClass('px-4');
    expect(screen.getByTestId('chat-typing-indicator')).toHaveClass('flex');
    expect(screen.getByTestId('chat-typing-indicator')).toHaveClass('items-center');
    expect(screen.getByTestId('chat-typing-avatar').nextElementSibling).toContainElement(
      screen.getByTestId('chat-typing-indicator-shell'),
    );
    expect(screen.getByTestId('chat-typing-indicator-shell')).not.toHaveClass('rounded-full');
    expect(screen.getByTestId('chat-typing-indicator-shell')).not.toHaveClass('border');
    expect(screen.getByTestId('chat-typing-indicator-name')).toHaveTextContent('ClawX');
    expect(screen.getByTestId('chat-typing-indicator-name')).toHaveClass('text-[16px]');
    expect(screen.getByTestId('chat-typing-indicator-scan')).toBeInTheDocument();
    expect(screen.getByTestId('chat-typing-indicator-scan')).toHaveTextContent('ClawX');
    expect(screen.getByTestId('chat-typing-indicator-scan')).toHaveClass('text-transparent');
    expect(screen.getByTestId('chat-typing-indicator-scan')).toHaveStyle({ animation: 'chat-product-scan 3.2s cubic-bezier(0.4, 0, 0.2, 1) infinite' });
    expect(screen.getByTestId('chat-typing-indicator-scan')).toHaveStyle({ WebkitTextFillColor: 'transparent' });
    expect(screen.getByTestId('chat-typing-indicator-scan').getAttribute('style')).toContain('radial-gradient(circle');
    expect(Array.from(document.querySelectorAll('style')).some((node) => node.textContent?.includes('0% { background-position: -48% 50%'))).toBe(true);
    expect(Array.from(document.querySelectorAll('style')).some((node) => node.textContent?.includes('100% { background-position: 148% 50%'))).toBe(true);
  });

  it('hides internal pre-compaction memory flush turns while keeping later real conversation visible', () => {
    chatState.sending = false;
    chatState.sessionRunningState = {};
    chatState.sendStage = null;
    chatState.pendingFinal = false;
    chatState.streamingMessage = null;
    chatState.messages = [
      {
        id: 'flush-user-1',
        role: 'user',
        content: [
          {
            type: 'text',
            text: [
              'Pre-compaction memory flush. Store durable memories only in memory/2026-04-16.md (create memory/ if needed).',
              'Treat workspace bootstrap/reference files such as MEMORY.md, DREAMS.md, SOUL.md, TOOLS.md, and AGENTS.md as read-only during this flush; never overwrite, replace, or edit them.',
              'If memory/2026-04-16.md already exists, APPEND new content only and do not overwrite existing entries.',
              'Do NOT create timestamped variant files (e.g., 2026-04-16-HHMM.md); always use the canonical 2026-04-16.md filename.',
              'If nothing to store, reply with NO_REPLY.',
              'Current time: Thursday, April 16th, 2026 - 14:48 (Etc/GMT-8)',
            ].join('\n'),
          },
        ],
        timestamp: fixedNow / 1000 - 3,
      },
      {
        id: 'user-2',
        role: 'user',
        content: 'This is a normal question.',
        timestamp: fixedNow / 1000 - 2,
      },
      {
        id: 'assistant-2',
        role: 'assistant',
        content: 'This is a normal reply.',
        timestamp: fixedNow / 1000 - 1,
      },
    ];

    render(<Chat />);

    expect(screen.queryByText('Pre-compaction memory flush.', { exact: false })).not.toBeInTheDocument();
    expect(screen.getByText('This is a normal question.', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('This is a normal reply.', { exact: true })).toBeInTheDocument();
  });
});
