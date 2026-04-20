import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { Chat } from '@/pages/Chat';

const navigateMock = vi.fn();
const fixedNow = 2_000_000;

const { agentsState, chatState, gatewayState, settingsState, virtuosoState } = vi.hoisted(() => {
  return {
    agentsState: {
      fetchAgents: vi.fn(async () => {}),
    },
    chatState: {
      messages: [] as Array<Record<string, unknown>>,
      currentSessionKey: 'agent:main:main',
      loading: false,
      sending: true,
      activeTurnBuffer: undefined as Record<string, unknown> | undefined,
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
    virtuosoState: {
      lastProps: null as Record<string, unknown> | null,
    },
  };
});

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
    virtuosoState.lastProps = props;
    const {
      data = [],
      itemContent,
      components = {},
      context,
      computeItemKey,
      scrollerRef,
    } = props as {
      components?: {
        Header?: React.ComponentType<{ context: unknown }>;
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
    const Header = components.Header ?? null;
    const Footer = components.Footer ?? null;

    React.useImperativeHandle(ref, () => ({
      autoscrollToBottom: () => {
        if (scrollerNodeRef.current) {
          scrollerNodeRef.current.scrollTop = scrollerNodeRef.current.scrollHeight;
        }
      },
      getState: (callback: (state: unknown) => void) => callback({}),
      scrollBy: ({ top = 0 }: { top?: number }) => {
        if (scrollerNodeRef.current) {
          scrollerNodeRef.current.scrollTop += top;
        }
      },
      scrollIntoView: () => {},
      scrollTo: ({ top = 0 }: { top?: number }) => {
        if (scrollerNodeRef.current) {
          scrollerNodeRef.current.scrollTop = top;
        }
      },
      scrollToIndex: () => {
        if (scrollerNodeRef.current) {
          scrollerNodeRef.current.scrollTop = scrollerNodeRef.current.scrollHeight;
        }
      },
    }), []);

    React.useEffect(() => {
      scrollerRef?.(scrollerNodeRef.current);
    }, [scrollerRef]);

    const renderedItems = data.map((item, index) => (
      <React.Fragment key={computeItemKey?.(index, item) ?? index}>
        {itemContent?.(index, item)}
      </React.Fragment>
    ));

    return (
      <Scroller
        ref={(node: HTMLDivElement | null) => {
          scrollerNodeRef.current = node;
        }}
        context={context}
        data-testid="virtuoso-scroller"
        data-virtuoso-scroller="true"
        style={{ height: '100%' }}
        tabIndex={0}
      >
        {Header ? <Header context={context} /> : null}
        <List context={context} data-testid="virtuoso-list" data-virtuoso-list="true" style={{}}>
          {renderedItems}
        </List>
        {Footer ? <Footer context={context} /> : null}
      </Scroller>
    );
  });

  return {
    Virtuoso,
  };
});

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
    chatState.loadHistory.mockClear();
    virtuosoState.lastProps = null;
    chatState.currentSessionKey = 'agent:main:main';
    chatState.loading = false;
    chatState.sending = true;
    chatState.activeTurnBuffer = undefined;
    chatState.sessionRunningState = { 'agent:main:main': true };
    chatState.error = null;
    chatState.showThinking = true;
    chatState.streamingTools = [];
    chatState.sendStage = 'running';
    chatState.lastUserMessageAt = 1000;
    chatState.queuedMessages = {};
    settingsState.chatProcessDisplayMode = 'all';
    settingsState.chatFontScale = 100;
    settingsState.assistantMessageStyle = 'bubble';
    gatewayState.status = { state: 'running', port: 18789 };
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

  it('loads chat history when the gateway is running for the current session', () => {
    chatState.messages = [];
    chatState.sending = false;
    chatState.sessionRunningState = {};
    chatState.sendStage = null;
    chatState.pendingFinal = false;
    chatState.streamingMessage = null;
    chatState.lastUserMessageAt = null;

    render(<Chat />);

    expect(chatState.loadHistory).toHaveBeenCalledWith(false);
  });

  it('does not reload chat history again just because the visible message count changes', () => {
    chatState.messages = [];
    chatState.sending = false;
    chatState.sessionRunningState = {};
    chatState.sendStage = null;
    chatState.pendingFinal = false;
    chatState.streamingMessage = null;
    chatState.lastUserMessageAt = null;

    const { rerender } = render(<Chat />);

    expect(chatState.loadHistory).toHaveBeenCalledTimes(1);

    chatState.messages = [
      {
        id: 'hydrated-user-1',
        role: 'user',
        content: 'Hydrated after the first load.',
        timestamp: fixedNow / 1000,
      },
    ];

    rerender(<Chat />);

    expect(chatState.loadHistory).toHaveBeenCalledTimes(1);
  });

  it('loads chat history quietly when the gateway is offline so local session history can still hydrate', () => {
    chatState.messages = [];
    chatState.sending = false;
    chatState.sessionRunningState = {};
    chatState.sendStage = null;
    chatState.pendingFinal = false;
    chatState.streamingMessage = null;
    chatState.lastUserMessageAt = null;
    gatewayState.status = { state: 'stopped', port: 18789 };

    render(<Chat />);

    expect(chatState.loadHistory).toHaveBeenCalledWith(true);
  });

  it('forwards virtuoso scroller and list props to the DOM wrappers', () => {
    chatState.sending = false;
    chatState.sessionRunningState = {};
    chatState.sendStage = null;
    chatState.pendingFinal = false;
    chatState.streamingMessage = null;
    chatState.lastUserMessageAt = null;

    render(<Chat />);

    const scrollContainer = screen.getByTestId('chat-scroll-container');
    const contentColumn = screen.getByTestId('chat-content-column');

    expect(scrollContainer).toHaveAttribute('data-virtuoso-scroller', 'true');
    expect(contentColumn).toHaveAttribute('data-virtuoso-list', 'true');
    expect(contentColumn).not.toHaveClass('px-4');
  });

  it('configures non-empty sessions to reopen from the bottom of the list', () => {
    chatState.sending = false;
    chatState.sessionRunningState = {};
    chatState.sendStage = null;
    chatState.pendingFinal = false;
    chatState.streamingMessage = null;
    chatState.lastUserMessageAt = 0;
    chatState.messages = [
      {
        id: 'history-user-1',
        role: 'user',
        content: 'History question one.',
        timestamp: 1000,
      },
      {
        id: 'history-assistant-1',
        role: 'assistant',
        content: 'History answer one.',
        timestamp: 1001,
      },
    ];

    render(<Chat />);

    expect(virtuosoState.lastProps).toMatchObject({
      alignToBottom: true,
      initialTopMostItemIndex: { index: 'LAST', align: 'end' },
    });
  });

  it('keeps a little extra breathing room above the composer for short settled histories', () => {
    const rafQueue: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      rafQueue.push(callback);
      return rafQueue.length;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    chatState.sending = false;
    chatState.sessionRunningState = {};
    chatState.sendStage = null;
    chatState.pendingFinal = false;
    chatState.streamingMessage = null;
    chatState.lastUserMessageAt = 0;
    chatState.messages = [
      {
        id: 'history-user-1',
        role: 'user',
        content: 'History question one.',
        timestamp: 1000,
      },
      {
        id: 'history-assistant-1',
        role: 'assistant',
        content: 'History answer one.',
        timestamp: 1001,
      },
    ];

    render(<Chat />);

    const scrollContainer = screen.getByTestId('chat-scroll-container');
    const contentColumn = screen.getByTestId('chat-content-column');
    Object.defineProperty(scrollContainer, 'clientHeight', {
      configurable: true,
      value: 640,
    });
    vi.spyOn(contentColumn, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 960,
      height: 220,
      top: 0,
      right: 960,
      bottom: 220,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect);

    act(() => {
      while (rafQueue.length > 0) {
        const callback = rafQueue.shift();
        callback?.(0);
      }
    });

    expect(scrollContainer.style.paddingTop).toBe('396px');
    expect(scrollContainer.style.paddingBottom).toBe('24px');
  });

  it('keeps the active turn list item stable while streaming content grows', () => {
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
        id: 'active-user-1',
        role: 'user',
        content: 'Explain why the page freezes.',
        timestamp: fixedNow / 1000 - 1,
      },
    ];
    chatState.streamingMessage = {
      role: 'assistant',
      content: 'First streaming chunk.',
      timestamp: fixedNow / 1000,
    };
    chatState.pendingFinal = false;
    chatState.lastUserMessageAt = fixedNow / 1000 - 1;
    chatState.sessionRunningState = { 'agent:main:main': true };

    const { rerender } = render(<Chat />);

    const firstAnchor = screen.getByTestId('chat-active-turn-anchor');
    const firstActiveTurnItem = (virtuosoState.lastProps?.data as Array<{ type: string; key: string }> | undefined)
      ?.find((item) => item.type === 'active-turn');

    expect(firstActiveTurnItem?.key).toBe('agent:main:main:active-user-1|user|1999|Explain why the page freezes.');

    chatState.streamingMessage = {
      role: 'assistant',
      content: 'First streaming chunk.\n\nSecond streaming chunk.',
      timestamp: fixedNow / 1000,
    };

    rerender(<Chat />);

    const secondAnchor = screen.getByTestId('chat-active-turn-anchor');
    const secondActiveTurnItem = (virtuosoState.lastProps?.data as Array<{ type: string; key: string }> | undefined)
      ?.find((item) => item.type === 'active-turn');

    expect(secondActiveTurnItem?.key).toBe(firstActiveTurnItem?.key);
    expect(secondAnchor).toBe(firstAnchor);
  });

  it('does not reintroduce the top-alignment spacer when revisiting an in-progress session', () => {
    const rafQueue: FrameRequestCallback[] = [];
    const requestAnimationFrameMock = vi.fn((callback: FrameRequestCallback) => {
      rafQueue.push(callback);
      return rafQueue.length;
    });
    const resizeObserverCallbacks: ResizeObserverCallback[] = [];
    class MockResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeObserverCallbacks.push(callback);
      }

      observe() {}

      disconnect() {}

      unobserve() {}
    }

    vi.stubGlobal('requestAnimationFrame', requestAnimationFrameMock);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('ResizeObserver', MockResizeObserver as unknown as typeof ResizeObserver);

    chatState.currentSessionKey = 'agent:main:session-a';
    chatState.messages = [
      {
        id: 'session-a-user-1',
        role: 'user',
        content: 'Session A history.',
        timestamp: fixedNow / 1000 - 10,
      },
      {
        id: 'session-a-assistant-1',
        role: 'assistant',
        content: 'Session A answer.',
        timestamp: fixedNow / 1000 - 9,
      },
    ];
    chatState.sending = false;
    chatState.sessionRunningState = {};
    chatState.sendStage = null;
    chatState.pendingFinal = false;
    chatState.streamingMessage = null;
    chatState.lastUserMessageAt = null;

    const { rerender } = render(<Chat />);

    chatState.currentSessionKey = 'agent:main:session-b';
    chatState.messages = [
      {
        id: 'session-b-user-1',
        role: 'user',
        content: 'Earlier history.',
        timestamp: fixedNow / 1000 - 5,
      },
      {
        id: 'session-b-assistant-1',
        role: 'assistant',
        content: 'Earlier answer.',
        timestamp: fixedNow / 1000 - 4,
      },
      {
        id: 'session-b-user-2',
        role: 'user',
        content: 'Still streaming here.',
        timestamp: fixedNow / 1000 - 1,
      },
    ];
    chatState.sending = true;
    chatState.sessionRunningState = { 'agent:main:session-b': true };
    chatState.sendStage = 'running';
    chatState.lastUserMessageAt = fixedNow / 1000 - 1;

    rerender(<Chat />);

    const scrollContainer = screen.getByTestId('chat-scroll-container');
    const activeTurnAnchor = screen.getByTestId('chat-active-turn-anchor');
    const activeTurnUserAnchor = screen.getByTestId('chat-active-turn-user-anchor');
    scrollContainer.scrollTop = 280;
    Object.defineProperty(scrollContainer, 'clientHeight', {
      configurable: true,
      value: 640,
    });
    Object.defineProperty(scrollContainer, 'scrollHeight', {
      configurable: true,
      value: 920,
    });

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
      y: 220,
      width: 960,
      height: 280,
      top: 220,
      right: 960,
      bottom: 500,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect);
    vi.spyOn(activeTurnUserAnchor, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 260,
      width: 960,
      height: 80,
      top: 260,
      right: 960,
      bottom: 340,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect);

    act(() => {
      for (const callback of resizeObserverCallbacks) {
        callback([], {} as ResizeObserver);
      }
    });

    act(() => {
      let now = 0;
      while (rafQueue.length > 0) {
        const callback = rafQueue.shift();
        now += 16;
        callback?.(now);
      }
    });

    expect(screen.queryByTestId('chat-active-turn-bottom-spacer')).not.toBeInTheDocument();
  });

  it('realigns a short settled session to the top when a new local send begins', () => {
    const rafQueue: FrameRequestCallback[] = [];
    const requestAnimationFrameMock = vi.fn((callback: FrameRequestCallback) => {
      rafQueue.push(callback);
      return rafQueue.length;
    });
    const resizeObserverCallbacks: ResizeObserverCallback[] = [];
    class MockResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeObserverCallbacks.push(callback);
      }

      observe() {}

      disconnect() {}

      unobserve() {}
    }

    vi.stubGlobal('requestAnimationFrame', requestAnimationFrameMock);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('ResizeObserver', MockResizeObserver as unknown as typeof ResizeObserver);

    chatState.currentSessionKey = 'agent:main:short-session';
    chatState.sending = false;
    chatState.sessionRunningState = {};
    chatState.sendStage = null;
    chatState.pendingFinal = false;
    chatState.streamingMessage = null;
    chatState.lastUserMessageAt = null;
    chatState.messages = [
      {
        id: 'history-user-1',
        role: 'user',
        content: 'Old short history question.',
        timestamp: fixedNow / 1000 - 10,
      },
      {
        id: 'history-assistant-1',
        role: 'assistant',
        content: 'Old short history answer.',
        timestamp: fixedNow / 1000 - 9,
      },
    ];

    const { rerender } = render(<Chat />);

    const scrollContainer = screen.getByTestId('chat-scroll-container');
    const contentColumn = screen.getByTestId('chat-content-column');
    Object.defineProperty(scrollContainer, 'clientHeight', {
      configurable: true,
      value: 640,
    });
    Object.defineProperty(scrollContainer, 'scrollHeight', {
      configurable: true,
      value: 920,
    });

    vi.spyOn(contentColumn, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 960,
      height: 220,
      top: 0,
      right: 960,
      bottom: 220,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect);

    act(() => {
      while (rafQueue.length > 0) {
        const callback = rafQueue.shift();
        callback?.(0);
      }
    });

    expect(scrollContainer.style.paddingTop).toBe('396px');

    chatState.sending = true;
    chatState.sessionRunningState = { 'agent:main:short-session': true };
    chatState.lastUserMessageAt = fixedNow / 1000;
    chatState.messages = [
      ...chatState.messages,
      {
        id: 'active-user-1',
        role: 'user',
        content: 'Bring this new turn to the top.',
        timestamp: fixedNow / 1000,
      },
    ];

    rerender(<Chat />);

    const activeTurnAnchor = screen.getByTestId('chat-active-turn-anchor');
    const activeTurnUserAnchor = screen.getByTestId('chat-active-turn-user-anchor');
    scrollContainer.scrollTop = 0;

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
      y: 520,
      width: 960,
      height: 220,
      top: 520,
      right: 960,
      bottom: 740,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect);
    vi.spyOn(activeTurnUserAnchor, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 520,
      width: 960,
      height: 72,
      top: 520,
      right: 960,
      bottom: 592,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect);

    act(() => {
      for (const callback of resizeObserverCallbacks) {
        callback([], {} as ResizeObserver);
      }
    });

    act(() => {
      let now = 0;
      while (rafQueue.length > 0) {
        const callback = rafQueue.shift();
        now += 16;
        callback?.(now);
      }
    });

    expect(scrollContainer.style.paddingTop).toBe('0px');
    expect(scrollContainer.scrollTop).toBeGreaterThan(300);
    expect(screen.getByTestId('chat-active-turn-bottom-spacer')).toBeInTheDocument();
    expect(requestAnimationFrameMock).toHaveBeenCalled();
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

    expect(scrollContainer.scrollTop).toBe(120);
    expect(screen.getByTestId('chat-process-content')).toBeInTheDocument();
  });

  it('shows the queued draft card above the composer while the current turn is still running', () => {
    chatState.queuedMessages = {
      'agent:main:main': [
        {
          id: 'queued-1',
          text: 'Ask this after the current run finishes.',
          sessionKey: 'agent:main:main',
          queuedAt: fixedNow,
        },
      ],
    };

    render(<Chat />);

    expect(screen.getByTestId('chat-queued-message-card')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-queued-message-notice')).not.toBeInTheDocument();
    expect(screen.getByTestId('chat-queued-message-preview')).toHaveTextContent('Ask this after the current run finishes.');
    expect(screen.getByText('It will send automatically after the current turn finishes. You can also keep editing it or remove it for now.')).toBeInTheDocument();
    expect(screen.getByTestId('chat-queued-message-send-now')).toBeDisabled();
  });

  it('aligns the current turn user message to the top of the scroll container when sending starts', () => {
    const rafQueue: FrameRequestCallback[] = [];
    const requestAnimationFrameMock = vi.fn((callback: FrameRequestCallback) => {
      rafQueue.push(callback);
      return rafQueue.length;
    });
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrameMock);
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
    const activeTurnUserAnchor = screen.getByTestId('chat-active-turn-user-anchor');
    scrollContainer.scrollTop = 280;
    Object.defineProperty(scrollContainer, 'clientHeight', {
      configurable: true,
      value: 640,
    });
    Object.defineProperty(scrollContainer, 'scrollHeight', {
      configurable: true,
      value: 920,
    });

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
      y: 220,
      width: 960,
      height: 280,
      top: 220,
      right: 960,
      bottom: 500,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect);
    vi.spyOn(activeTurnUserAnchor, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 260,
      width: 960,
      height: 80,
      top: 260,
      right: 960,
      bottom: 340,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect);

    act(() => {
      let now = 0;
      while (rafQueue.length > 0) {
        const callback = rafQueue.shift();
        now += 16;
        callback?.(now);
      }
    });

    expect(scrollContainer.scrollTop).toBe(444);
    expect(requestAnimationFrameMock.mock.calls.length).toBeGreaterThan(3);
    expect(screen.getByTestId('chat-active-turn-bottom-spacer')).toHaveStyle({ height: '328px' });
  });

  it('keeps a fresh session turn already aligned at the top without overscrolling', () => {
    const rafQueue: FrameRequestCallback[] = [];
    const requestAnimationFrameMock = vi.fn((callback: FrameRequestCallback) => {
      rafQueue.push(callback);
      return rafQueue.length;
    });
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrameMock);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    chatState.messages = [
      {
        id: 'user-1',
        role: 'user',
        content: 'Start a brand new session.',
        timestamp: fixedNow / 1000,
      },
    ];
    chatState.pendingFinal = false;
    chatState.streamingMessage = null;
    chatState.lastUserMessageAt = fixedNow / 1000;
    chatState.sessionRunningState = { 'agent:main:main': true };

    render(<Chat />);

    const scrollContainer = screen.getByTestId('chat-scroll-container');
    const activeTurnAnchor = screen.getByTestId('chat-active-turn-anchor');
    const activeTurnUserAnchor = screen.getByTestId('chat-active-turn-user-anchor');
    scrollContainer.scrollTop = 0;
    Object.defineProperty(scrollContainer, 'clientHeight', {
      configurable: true,
      value: 640,
    });

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
      y: 96,
      width: 960,
      height: 120,
      top: 96,
      right: 960,
      bottom: 216,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect);
    vi.spyOn(activeTurnUserAnchor, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 96,
      width: 960,
      height: 80,
      top: 96,
      right: 960,
      bottom: 176,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect);

    act(() => {
      let now = 0;
      while (rafQueue.length > 0) {
        const callback = rafQueue.shift();
        now += 16;
        callback?.(now);
      }
    });

    expect(scrollContainer.scrollTop).toBe(0);
    expect(requestAnimationFrameMock).toHaveBeenCalled();
  });

  it('keeps the latest streamed content visible at the bottom while auto-follow is active', () => {
    const rafQueue: FrameRequestCallback[] = [];
    const requestAnimationFrameMock = vi.fn((callback: FrameRequestCallback) => {
      rafQueue.push(callback);
      return rafQueue.length;
    });
    const resizeObserverCallbacks: ResizeObserverCallback[] = [];
    class MockResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeObserverCallbacks.push(callback);
      }

      observe() {}

      disconnect() {}

      unobserve() {}
    }

    vi.stubGlobal('requestAnimationFrame', requestAnimationFrameMock);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('ResizeObserver', MockResizeObserver as unknown as typeof ResizeObserver);

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
        content: 'Stream the latest answer here.',
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
    const activeTurnUserAnchor = screen.getByTestId('chat-active-turn-user-anchor');
    scrollContainer.scrollTop = 280;
    Object.defineProperty(scrollContainer, 'clientHeight', {
      configurable: true,
      value: 640,
    });
    Object.defineProperty(scrollContainer, 'scrollHeight', {
      configurable: true,
      value: 920,
    });

    const scrollRect = {
      x: 0,
      y: 80,
      width: 960,
      height: 640,
      top: 80,
      right: 960,
      bottom: 720,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect;
    const activeTurnRect = {
      x: 0,
      y: 220,
      width: 960,
      height: 280,
      top: 220,
      right: 960,
      bottom: 500,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect;
    const activeTurnUserRect = {
      x: 0,
      y: 260,
      width: 960,
      height: 80,
      top: 260,
      right: 960,
      bottom: 340,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect;

    vi.spyOn(scrollContainer, 'getBoundingClientRect').mockImplementation(() => scrollRect);
    vi.spyOn(activeTurnAnchor, 'getBoundingClientRect').mockImplementation(() => activeTurnRect);
    vi.spyOn(activeTurnUserAnchor, 'getBoundingClientRect').mockImplementation(() => activeTurnUserRect);

    act(() => {
      let now = 0;
      while (rafQueue.length > 0) {
        const callback = rafQueue.shift();
        now += 16;
        callback?.(now);
      }
    });

    expect(scrollContainer.scrollTop).toBe(444);

    activeTurnRect.y = 96;
    activeTurnRect.top = 96;
    activeTurnRect.height = 280;
    activeTurnRect.bottom = 376;
    activeTurnUserRect.y = 96;
    activeTurnUserRect.top = 96;
    activeTurnUserRect.bottom = 176;

    activeTurnRect.height = 664;
    activeTurnRect.bottom = 760;

    act(() => {
      for (const callback of resizeObserverCallbacks) {
        callback([], {} as ResizeObserver);
      }
    });

    act(() => {
      let now = 200;
      while (rafQueue.length > 0) {
        const callback = rafQueue.shift();
        now += 16;
        callback?.(now);
      }
    });

    expect(scrollContainer.scrollTop).toBe(500);
  });

  it('stops auto-following once the user manually scrolls during streaming', () => {
    const rafQueue: FrameRequestCallback[] = [];
    const requestAnimationFrameMock = vi.fn((callback: FrameRequestCallback) => {
      rafQueue.push(callback);
      return rafQueue.length;
    });
    const resizeObserverCallbacks: ResizeObserverCallback[] = [];
    class MockResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeObserverCallbacks.push(callback);
      }

      observe() {}

      disconnect() {}

      unobserve() {}
    }

    vi.stubGlobal('requestAnimationFrame', requestAnimationFrameMock);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('ResizeObserver', MockResizeObserver as unknown as typeof ResizeObserver);

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
        content: 'Let the user take over scrolling.',
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
    const activeTurnUserAnchor = screen.getByTestId('chat-active-turn-user-anchor');
    scrollContainer.scrollTop = 280;
    Object.defineProperty(scrollContainer, 'clientHeight', {
      configurable: true,
      value: 640,
    });
    Object.defineProperty(scrollContainer, 'scrollHeight', {
      configurable: true,
      value: 920,
    });

    const scrollRect = {
      x: 0,
      y: 80,
      width: 960,
      height: 640,
      top: 80,
      right: 960,
      bottom: 720,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect;
    const activeTurnRect = {
      x: 0,
      y: 220,
      width: 960,
      height: 280,
      top: 220,
      right: 960,
      bottom: 500,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect;
    const activeTurnUserRect = {
      x: 0,
      y: 260,
      width: 960,
      height: 80,
      top: 260,
      right: 960,
      bottom: 340,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect;

    vi.spyOn(scrollContainer, 'getBoundingClientRect').mockImplementation(() => scrollRect);
    vi.spyOn(activeTurnAnchor, 'getBoundingClientRect').mockImplementation(() => activeTurnRect);
    vi.spyOn(activeTurnUserAnchor, 'getBoundingClientRect').mockImplementation(() => activeTurnUserRect);

    act(() => {
      let now = 0;
      while (rafQueue.length > 0) {
        const callback = rafQueue.shift();
        now += 16;
        callback?.(now);
      }
    });

    expect(scrollContainer.scrollTop).toBe(444);

    activeTurnRect.y = 96;
    activeTurnRect.top = 96;
    activeTurnRect.height = 280;
    activeTurnRect.bottom = 376;
    activeTurnUserRect.y = 96;
    activeTurnUserRect.top = 96;
    activeTurnUserRect.bottom = 176;

    fireEvent.wheel(scrollContainer, { deltaY: -120 });

    activeTurnRect.height = 760;
    activeTurnRect.bottom = 856;

    act(() => {
      for (const callback of resizeObserverCallbacks) {
        callback([], {} as ResizeObserver);
      }
    });

    act(() => {
      let now = 200;
      while (rafQueue.length > 0) {
        const callback = rafQueue.shift();
        now += 16;
        callback?.(now);
      }
    });

    expect(scrollContainer.scrollTop).toBe(444);
  });

  it('clears the retained scroll space once the active turn stops streaming', () => {
    const rafQueue: FrameRequestCallback[] = [];
    const requestAnimationFrameMock = vi.fn((callback: FrameRequestCallback) => {
      rafQueue.push(callback);
      return rafQueue.length;
    });
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrameMock);
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

    const { rerender } = render(<Chat />);

    const scrollContainer = screen.getByTestId('chat-scroll-container');
    const activeTurnAnchor = screen.getByTestId('chat-active-turn-anchor');
    const activeTurnUserAnchor = screen.getByTestId('chat-active-turn-user-anchor');
    scrollContainer.scrollTop = 280;
    Object.defineProperty(scrollContainer, 'clientHeight', {
      configurable: true,
      value: 640,
    });
    Object.defineProperty(scrollContainer, 'scrollHeight', {
      configurable: true,
      value: 920,
    });

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
      y: 220,
      width: 960,
      height: 280,
      top: 220,
      right: 960,
      bottom: 500,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect);
    vi.spyOn(activeTurnUserAnchor, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 260,
      width: 960,
      height: 80,
      top: 260,
      right: 960,
      bottom: 340,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect);

    act(() => {
      let now = 0;
      while (rafQueue.length > 0) {
        const callback = rafQueue.shift();
        now += 16;
        callback?.(now);
      }
    });

    expect(scrollContainer.scrollTop).toBe(444);
    expect(screen.getByTestId('chat-active-turn-bottom-spacer')).toHaveStyle({ height: '328px' });

    chatState.sending = false;
    chatState.sessionRunningState = {};

    rerender(<Chat />);

    expect(screen.queryByTestId('chat-active-turn-anchor')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chat-active-turn-bottom-spacer')).not.toBeInTheDocument();

    settingsState.chatFontScale = 110;
    rerender(<Chat />);

    expect(screen.queryByTestId('chat-active-turn-bottom-spacer')).not.toBeInTheDocument();
  });

  it('hides the persisted copy of an optimistic user message when the active turn already renders it', () => {
    chatState.sending = false;
    chatState.pendingFinal = false;
    chatState.sessionRunningState = {};
    chatState.messages = [
      {
        id: 'persisted-user-1',
        role: 'user',
        content: 'Open the browser and check today\'s Shenzhen to Nanjing flights.',
        timestamp: fixedNow / 1000 - 3,
      },
      {
        id: 'assistant-final-1',
        role: 'assistant',
        content: 'I am checking the flights now.',
        timestamp: fixedNow / 1000 - 2,
      },
    ];
    chatState.activeTurnBuffer = {
      historyMessages: [
        {
          id: 'persisted-user-1',
          role: 'user',
          content: 'Open the browser and check today\'s Shenzhen to Nanjing flights.',
          timestamp: fixedNow / 1000 - 3,
        },
      ],
      userMessage: {
        id: 'optimistic-user-1',
        role: 'user',
        content: 'Open the browser and check today\'s Shenzhen to Nanjing flights.',
        timestamp: fixedNow / 1000 - 2.5,
      },
      assistantMessages: [
        {
          id: 'assistant-final-1',
          role: 'assistant',
          content: 'I am checking the flights now.',
          timestamp: fixedNow / 1000 - 2,
        },
      ],
      processMessages: [],
      latestPersistedAssistant: {
        id: 'assistant-final-1',
        role: 'assistant',
        content: 'I am checking the flights now.',
        timestamp: fixedNow / 1000 - 2,
      },
      persistedFinalMessage: {
        id: 'assistant-final-1',
        role: 'assistant',
        content: 'I am checking the flights now.',
        timestamp: fixedNow / 1000 - 2,
      },
      streamingDisplayMessage: null,
      processStreamingMessage: null,
      finalStreamingMessage: null,
      startedAtMs: fixedNow - 2500,
      hasAnyStreamContent: false,
      isStreamingDuplicateOfPersistedAssistant: false,
    };

    render(<Chat />);

    expect(screen.getAllByText('Open the browser and check today\'s Shenzhen to Nanjing flights.')).toHaveLength(1);
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
    expect(screen.getByTestId('chat-typing-indicator-scan').getAttribute('style')).toContain('radial-gradient(circle at 28% 50%');
    expect(screen.getByTestId('chat-typing-indicator-scan').getAttribute('style')).toContain('radial-gradient(circle at 56% 38%');
    expect(Array.from(document.querySelectorAll('style')).some((node) => node.textContent?.includes('0% { background-position: -52% 50%'))).toBe(true);
    expect(Array.from(document.querySelectorAll('style')).some((node) => node.textContent?.includes('100% { background-position: 152% 50%'))).toBe(true);
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
