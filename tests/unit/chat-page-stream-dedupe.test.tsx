import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Chat } from '@/pages/Chat';

const navigateMock = vi.fn();

const { agentsState, chatState, gatewayState, settingsState } = vi.hoisted(() => ({
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
    sendStage: null as string | null,
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
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
  useLocation: () => ({
    state: null,
    key: 'chat-stream-dedupe',
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
      t: (key: string) => key,
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

vi.mock('react-virtuoso', async () => {
  const React = await import('react');

  const DefaultScroller = React.forwardRef<HTMLDivElement, React.ComponentProps<'div'>>(
    function DefaultScroller({ children, ...props }, ref) {
      return <div ref={ref} {...props}>{children}</div>;
    },
  );
  const DefaultList = React.forwardRef<HTMLDivElement, React.ComponentProps<'div'>>(
    function DefaultList({ children, ...props }, ref) {
      return <div ref={ref} {...props}>{children}</div>;
    },
  );

  const Virtuoso = React.forwardRef<any, Record<string, unknown>>(function MockVirtuoso(props, ref) {
    const {
      data = [],
      itemContent,
      components = {},
      context,
      computeItemKey,
      scrollerRef,
    } = props as {
      components?: {
        Footer?: React.ComponentType<{ context: unknown }>;
        List?: React.ComponentType<any>;
        Scroller?: React.ComponentType<any>;
      };
      computeItemKey?: (index: number, item: unknown) => React.Key;
      context?: unknown;
      data?: unknown[];
      itemContent?: (index: number, item: unknown) => React.ReactNode;
      scrollerRef?: (node: HTMLElement | null) => void;
    };

    const scrollerNodeRef = React.useRef<HTMLDivElement | null>(null);
    const Scroller = components.Scroller ?? DefaultScroller;
    const List = components.List ?? DefaultList;
    const Footer = components.Footer ?? null;

    React.useImperativeHandle(ref, () => ({
      autoscrollToBottom: () => {},
      getState: (callback: (state: unknown) => void) => callback({}),
      scrollBy: () => {},
      scrollIntoView: () => {},
      scrollTo: () => {},
      scrollToIndex: () => {},
    }), []);

    React.useEffect(() => {
      scrollerRef?.(scrollerNodeRef.current);
    }, [scrollerRef]);

    return (
      <Scroller
        ref={(node: HTMLDivElement | null) => {
          scrollerNodeRef.current = node;
        }}
        context={context}
        data-testid="virtuoso-scroller"
        style={{ height: '100%' }}
        tabIndex={0}
      >
        <List context={context} data-testid="virtuoso-list" style={{}}>
          {data.map((item, index) => (
            <React.Fragment key={computeItemKey?.(index, item) ?? index}>
              {itemContent?.(index, item)}
            </React.Fragment>
          ))}
        </List>
        {Footer ? <Footer context={context} /> : null}
      </Scroller>
    );
  });

  return { Virtuoso };
});

vi.mock('@/hooks/use-stick-to-bottom-instant', () => ({
  useStickToBottomInstant: () => ({
    contentRef: { current: null },
    scrollRef: { current: null },
    stopScroll: vi.fn(),
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

vi.mock('@/pages/Chat/ChatToolbarV2', () => ({
  ChatToolbarV2: () => <div data-testid="chat-toolbar" />,
}));

describe('Chat streaming dedupe', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    agentsState.fetchAgents.mockClear();
    chatState.loadHistory.mockClear();
    chatState.messages = [
      {
        id: 'user-1',
        role: 'user',
        content: 'Take a photo for me.',
        timestamp: 1000,
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Checking the camera.' },
          { type: 'text', text: 'Preparing the camera.' },
        ],
        timestamp: 1001,
      },
      {
        id: 'assistant-2',
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Confirm the final output one last time.' },
          { type: 'text', text: 'Photo saved (60KB). You should be able to see it now.' },
        ],
        timestamp: 1002,
      },
    ];
    chatState.currentSessionKey = 'agent:main:main';
    chatState.loading = false;
    chatState.sending = true;
    chatState.sessionRunningState = { 'agent:main:main': true };
    chatState.error = null;
    chatState.showThinking = true;
    chatState.streamingMessage = {
      role: 'assistant',
      content: 'Photo saved (60KB). You should be able to see it now.',
      timestamp: 1003,
    };
    chatState.streamingTools = [];
    chatState.sendStage = 'running';
    chatState.pendingFinal = false;
    chatState.lastUserMessageAt = 1000;
    settingsState.chatProcessDisplayMode = 'all';
    settingsState.chatFontScale = 100;
    settingsState.assistantMessageStyle = 'bubble';
  });

  it('does not render a duplicate streaming bubble when the same assistant reply is already persisted', () => {
    render(<Chat />);

    expect(screen.getByTestId('chat-process-header')).toBeInTheDocument();
    expect(screen.getAllByText('Photo saved (60KB). You should be able to see it now.')).toHaveLength(1);
  });
});
