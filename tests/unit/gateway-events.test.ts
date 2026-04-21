import { beforeEach, describe, expect, it, vi } from 'vitest';

const hostApiFetchMock = vi.fn();
const subscribeHostEventMock = vi.fn();

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

vi.mock('@/lib/host-events', () => ({
  subscribeHostEvent: (...args: unknown[]) => subscribeHostEventMock(...args),
}));

describe('gateway store event wiring', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useRealTimers();
    if (typeof window !== 'undefined') {
      window.electron.ipcRenderer.invoke = vi.fn().mockResolvedValue({ state: 'running', port: 18789 });
    }
  });

  it('subscribes to host events through subscribeHostEvent on init', async () => {
    hostApiFetchMock.mockResolvedValue({ state: 'running', port: 18789 });

    const handlers = new Map<string, (payload: unknown) => void>();
    subscribeHostEventMock.mockImplementation((eventName: string, handler: (payload: unknown) => void) => {
      handlers.set(eventName, handler);
      return () => {};
    });

    const { useGatewayStore } = await import('@/stores/gateway');
    await useGatewayStore.getState().init();

    expect(subscribeHostEventMock).toHaveBeenCalledWith('gateway:status', expect.any(Function));
    expect(subscribeHostEventMock).toHaveBeenCalledWith('gateway:error', expect.any(Function));
    expect(subscribeHostEventMock).toHaveBeenCalledWith('gateway:notification', expect.any(Function));
    expect(subscribeHostEventMock).toHaveBeenCalledWith('gateway:chat-message', expect.any(Function));
    expect(subscribeHostEventMock).toHaveBeenCalledWith('gateway:channel-status', expect.any(Function));

    handlers.get('gateway:status')?.({ state: 'stopped', port: 18789 });
    expect(useGatewayStore.getState().status.state).toBe('stopped');
  });

  it('finalizes the running state on completed notifications and refreshes history', async () => {
    hostApiFetchMock.mockResolvedValue({ state: 'running', port: 18789 });

    const handlers = new Map<string, (payload: unknown) => void>();
    subscribeHostEventMock.mockImplementation((eventName: string, handler: (payload: unknown) => void) => {
      handlers.set(eventName, handler);
      return () => {};
    });

    const { useChatStore } = await import('../../src/stores/chat');
    const loadHistory = vi.fn();
    const loadSessions = vi.fn();
    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      sessions: [{ key: 'agent:main:main' }],
      activeRunId: 'run-1',
      sending: true,
      pendingFinal: false,
      error: 'stale error',
      loadHistory,
      loadSessions,
    } as never);

    const { useGatewayStore } = await import('@/stores/gateway');
    await useGatewayStore.getState().init();

    handlers.get('gateway:notification')?.({
      method: 'agent',
      params: {
        phase: 'completed',
        runId: 'run-1',
        sessionKey: 'agent:main:main',
      },
    });
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(useChatStore.getState().sending).toBe(false);
    expect(useChatStore.getState().pendingFinal).toBe(false);
    expect(useChatStore.getState().activeRunId).toBeNull();
    expect(useChatStore.getState().error).toBeNull();
  });

  it('tracks running state for non-current sessions from gateway notifications', async () => {
    hostApiFetchMock.mockResolvedValue({ state: 'running', port: 18789 });

    const handlers = new Map<string, (payload: unknown) => void>();
    subscribeHostEventMock.mockImplementation((eventName: string, handler: (payload: unknown) => void) => {
      handlers.set(eventName, handler);
      return () => {};
    });

    const { useChatStore } = await import('../../src/stores/chat');
    const loadHistory = vi.fn();
    const loadSessions = vi.fn();
    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      sessions: [
        { key: 'agent:main:main' },
        { key: 'agent:worker:background' },
      ],
      sessionRunningState: {},
      activeRunId: null,
      sending: false,
      pendingFinal: false,
      error: null,
      loadHistory,
      loadSessions,
    } as never);

    const { useGatewayStore } = await import('@/stores/gateway');
    await useGatewayStore.getState().init();

    handlers.get('gateway:notification')?.({
      method: 'agent',
      params: {
        phase: 'started',
        runId: 'run-background',
        sessionKey: 'agent:worker:background',
      },
    });
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(useChatStore.getState().sessionRunningState).toEqual({
      'agent:worker:background': true,
    });

    handlers.get('gateway:notification')?.({
      method: 'agent',
      params: {
        phase: 'completed',
        runId: 'run-background',
        sessionKey: 'agent:worker:background',
      },
    });
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(useChatStore.getState().sessionRunningState).toEqual({});
  });

  it('maps assistant stream notifications into live streaming text', async () => {
    hostApiFetchMock.mockResolvedValue({ state: 'running', port: 18789 });

    const handlers = new Map<string, (payload: unknown) => void>();
    subscribeHostEventMock.mockImplementation((eventName: string, handler: (payload: unknown) => void) => {
      handlers.set(eventName, handler);
      return () => {};
    });

    const { useChatStore } = await import('../../src/stores/chat');
    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      sessions: [{ key: 'agent:main:main' }],
      sending: false,
      activeRunId: null,
      pendingFinal: false,
      error: null,
      messages: [
        {
          id: 'user-live-1',
          role: 'user',
          content: 'Find flights.',
          timestamp: Math.floor(Date.now() / 1000) - 10,
        },
      ],
    } as never);

    const { useGatewayStore } = await import('@/stores/gateway');
    await useGatewayStore.getState().init();

    handlers.get('gateway:notification')?.({
      method: 'agent',
      params: {
        runId: 'run-live-stream',
        sessionKey: 'agent:main:main',
        stream: 'assistant',
        data: {
          text: 'Searching flights now...',
          delta: 'Searching flights now...',
        },
      },
    });

    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 80));

    const streamingMessage = useChatStore.getState().streamingMessage as Record<string, unknown> | null;
    expect(useChatStore.getState().sending).toBe(true);
    expect(streamingMessage).toMatchObject({
      role: 'assistant',
    });
    expect(streamingMessage?.content).toEqual([
      {
        type: 'text',
        text: 'Searching flights now...',
      },
    ]);
  });

  it('maps item notifications into running streaming tool events', async () => {
    hostApiFetchMock.mockResolvedValue({ state: 'running', port: 18789 });

    const handlers = new Map<string, (payload: unknown) => void>();
    subscribeHostEventMock.mockImplementation((eventName: string, handler: (payload: unknown) => void) => {
      handlers.set(eventName, handler);
      return () => {};
    });

    const { useChatStore } = await import('../../src/stores/chat');
    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      sessions: [{ key: 'agent:main:main' }],
      sending: false,
      activeRunId: null,
      pendingFinal: false,
      error: null,
      messages: [
        {
          id: 'user-live-tool-1',
          role: 'user',
          content: 'Open the browser and search.',
          timestamp: Math.floor(Date.now() / 1000) - 10,
        },
      ],
      streamingTools: [],
    } as never);

    const { useGatewayStore } = await import('@/stores/gateway');
    await useGatewayStore.getState().init();

    handlers.get('gateway:notification')?.({
      method: 'agent',
      params: {
        runId: 'run-live-tool',
        sessionKey: 'agent:main:main',
        stream: 'item',
        data: {
          itemId: 'tool:browser-live-1',
          phase: 'start',
          kind: 'tool',
          name: 'browser',
          status: 'running',
          title: 'Open browser',
          progressText: 'Opening Ctrip homepage',
          toolCallId: 'browser-live-1',
        },
      },
    });

    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(useChatStore.getState().sending).toBe(true);
    expect(useChatStore.getState().streamingTools).toEqual([
      expect.objectContaining({
        toolCallId: 'browser-live-1',
        name: 'browser',
        status: 'running',
        summary: 'Opening Ctrip homepage',
      }),
    ]);
  });
});
