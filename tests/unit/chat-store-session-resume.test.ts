import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { gatewayRpcMock, hostApiFetchMock, agentsState } = vi.hoisted(() => ({
  gatewayRpcMock: vi.fn(),
  hostApiFetchMock: vi.fn(),
  agentsState: {
    agents: [] as Array<Record<string, unknown>>,
  },
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: {
    getState: () => ({
      rpc: gatewayRpcMock,
    }),
  },
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: {
    getState: () => agentsState,
  },
}));

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

describe('chat store session resume', () => {
  const userTimestampSeconds = 1_700_000_000;
  const toolTimestampSeconds = userTimestampSeconds + 1;
  const assistantTimestampSeconds = userTimestampSeconds + 2;
  const userTimestampMs = userTimestampSeconds * 1000;

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    window.localStorage.clear();

    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        mainSessionKey: 'agent:main:main',
      },
      {
        id: 'other',
        name: 'Other',
        mainSessionKey: 'agent:other:main',
      },
    ];

    hostApiFetchMock.mockReset();
    hostApiFetchMock.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('restores the cached in-flight turn when switching back to a running session', async () => {
    let historyCallCount = 0;
    let resolveSecondHistory: ((value: { messages: never[] }) => void) | null = null;

    gatewayRpcMock.mockReset();
    gatewayRpcMock.mockImplementation((method: string) => {
      if (method === 'chat.history') {
        historyCallCount += 1;
        if (historyCallCount === 1) {
          return Promise.resolve({ messages: [] });
        }
        if (historyCallCount === 2) {
          return new Promise((resolve) => {
            resolveSecondHistory = resolve as (value: { messages: never[] }) => void;
          });
        }
        return Promise.resolve({ messages: [] });
      }
      if (method === 'sessions.list') return Promise.resolve({ sessions: [] });
      if (method === 'chat.send') return Promise.resolve({ runId: 'run-live' });
      if (method === 'chat.abort') return Promise.resolve({ ok: true });
      throw new Error(`Unexpected gateway RPC: ${method}`);
    });

    const { useChatStore } = await import('@/stores/chat');

    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessions: [{ key: 'agent:main:main' }, { key: 'agent:other:main' }],
      messages: [
        { id: 'user-1', role: 'user', content: 'Question', timestamp: userTimestampSeconds },
      ],
      sessionLabels: {},
      sessionLastActivity: {},
      sending: true,
      activeRunId: 'run-live',
      streamingText: '',
      streamingMessage: {
        role: 'assistant',
        content: [{ type: 'thinking', thinking: 'checking sources' }],
      },
      streamingTools: [
        { toolCallId: 'tool-1', name: 'web_search', status: 'running', updatedAt: 1 },
      ],
      pendingFinal: false,
      lastUserMessageAt: userTimestampMs,
      pendingToolImages: [],
      error: null,
      loading: false,
      thinkingLevel: null,
      showThinking: true,
    });

    useChatStore.getState().switchSession('agent:other:main');
    await Promise.resolve();

    expect(useChatStore.getState().currentSessionKey).toBe('agent:other:main');
    expect(useChatStore.getState().sending).toBe(false);
    expect(useChatStore.getState().messages).toEqual([]);

    useChatStore.getState().switchSession('agent:main:main');

    const restored = useChatStore.getState();
    expect(restored.currentSessionKey).toBe('agent:main:main');
    expect(restored.sending).toBe(true);
    expect(restored.activeRunId).toBe('run-live');
    expect(restored.messages).toHaveLength(1);
    expect(restored.messages[0]?.id).toBe('user-1');
    expect(restored.streamingMessage).toEqual({
      role: 'assistant',
      content: [{ type: 'thinking', thinking: 'checking sources' }],
    });
    expect(restored.streamingTools).toHaveLength(1);

    resolveSecondHistory?.({ messages: [] });
  });

  it('keeps local assistant process messages when history lags behind the live run', async () => {
    gatewayRpcMock.mockReset();
    gatewayRpcMock.mockImplementation((method: string) => {
      if (method === 'chat.history') {
        return Promise.resolve({
          messages: [
            { id: 'user-1', role: 'user', content: 'Question', timestamp: userTimestampSeconds },
            {
              id: 'tool-result-1',
              role: 'toolresult',
              toolCallId: 'tool-1',
              toolName: 'web_search',
              content: 'found docs',
              timestamp: toolTimestampSeconds,
            },
          ],
        });
      }
      if (method === 'sessions.list') return Promise.resolve({ sessions: [] });
      throw new Error(`Unexpected gateway RPC: ${method}`);
    });

    const { useChatStore } = await import('@/stores/chat');

    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessions: [{ key: 'agent:main:main' }],
      messages: [
        { id: 'user-1', role: 'user', content: 'Question', timestamp: userTimestampSeconds },
        {
          id: 'assistant-local',
          role: 'assistant',
          content: [{ type: 'thinking', thinking: 'checking sources' }],
          timestamp: assistantTimestampSeconds,
        },
      ],
      sessionLabels: {},
      sessionLastActivity: {},
      sending: true,
      activeRunId: 'run-live',
      streamingText: '',
      streamingMessage: null,
      streamingTools: [],
      pendingFinal: false,
      lastUserMessageAt: userTimestampMs,
      pendingToolImages: [],
      error: null,
      loading: false,
      thinkingLevel: null,
      showThinking: true,
    });

    await useChatStore.getState().loadHistory(true);

    const next = useChatStore.getState();
    expect(next.messages.map((message) => message.id)).toEqual([
      'user-1',
      'tool-result-1-tool-result',
      'assistant-local',
    ]);
    expect(next.pendingFinal).toBe(true);
  });

  it('quietly retries history when the first refresh only returns the trailing user message', async () => {
    let historyCallCount = 0;

    gatewayRpcMock.mockReset();
    gatewayRpcMock.mockImplementation((method: string) => {
      if (method === 'chat.history') {
        historyCallCount += 1;
        if (historyCallCount === 1) {
          return Promise.resolve({
            messages: [
              {
                id: 'user-1',
                role: 'user',
                content: 'Who are you?',
                timestamp: Math.floor(Date.now() / 1000),
              },
            ],
          });
        }
        return Promise.resolve({
          messages: [
            {
              id: 'user-1',
              role: 'user',
              content: 'Who are you?',
              timestamp: Math.floor(Date.now() / 1000),
            },
            {
              id: 'assistant-1',
              role: 'assistant',
              content: 'I am ClawX.',
              timestamp: Math.floor(Date.now() / 1000) + 1,
            },
          ],
        });
      }
      if (method === 'sessions.list') return Promise.resolve({ sessions: [] });
      throw new Error(`Unexpected gateway RPC: ${method}`);
    });

    const { useChatStore } = await import('@/stores/chat');

    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessions: [{ key: 'agent:main:main' }],
      messages: [],
      sessionLabels: {},
      sessionLastActivity: {},
      sending: false,
      activeRunId: null,
      streamingText: '',
      streamingMessage: null,
      streamingTools: [],
      pendingFinal: false,
      lastUserMessageAt: null,
      pendingToolImages: [],
      error: null,
      loading: false,
      thinkingLevel: null,
      showThinking: true,
    });

    await useChatStore.getState().loadHistory();

    expect(useChatStore.getState().messages.map((message) => message.id)).toEqual(['user-1']);

    await vi.advanceTimersByTimeAsync(2_000);

    expect(historyCallCount).toBe(2);
    expect(useChatStore.getState().messages.map((message) => message.id)).toEqual([
      'user-1',
      'assistant-1',
    ]);
  });

  it('combines modelProvider and model into a full session model ref when sessions load', async () => {
    gatewayRpcMock.mockReset();
    gatewayRpcMock.mockImplementation((method: string) => {
      if (method === 'sessions.list') {
        return Promise.resolve({
          sessions: [
            {
              key: 'agent:main:main',
              modelProvider: 'custom-custombc',
              model: 'gpt-5.4',
              updatedAt: userTimestampMs,
            },
          ],
        });
      }
      if (method === 'chat.history') return Promise.resolve({ messages: [] });
      throw new Error(`Unexpected gateway RPC: ${method}`);
    });

    const { useChatStore } = await import('@/stores/chat');

    await useChatStore.getState().loadSessions();

    const next = useChatStore.getState();
    expect(next.sessions[0]?.modelProvider).toBe('custom-custombc');
    expect(next.sessions[0]?.model).toBe('custom-custombc/gpt-5.4');
    expect(next.sessionModels['agent:main:main']).toBe('custom-custombc/gpt-5.4');
  });

  it('remaps legacy session running state when sessions load canonical keys', async () => {
    gatewayRpcMock.mockReset();
    gatewayRpcMock.mockImplementation((method: string) => {
      if (method === 'sessions.list') {
        return Promise.resolve({
          sessions: [
            {
              key: 'agent:main:legacy-session',
              updatedAt: userTimestampMs,
            },
          ],
        });
      }
      if (method === 'chat.history') return Promise.resolve({ messages: [] });
      throw new Error(`Unexpected gateway RPC: ${method}`);
    });

    const { useChatStore } = await import('@/stores/chat');

    useChatStore.setState({
      currentSessionKey: 'legacy-session',
      currentAgentId: 'main',
      sessions: [{ key: 'legacy-session' }],
      sessionRunningState: { 'legacy-session': true },
      sessionLabels: { 'legacy-session': 'Legacy Label' },
      sessionLastActivity: { 'legacy-session': userTimestampMs - 1234 },
      sessionModels: { 'legacy-session': 'custom/legacy-model' },
      messages: [],
      sending: true,
      activeRunId: 'run-legacy',
      streamingText: '',
      streamingMessage: null,
      streamingTools: [],
      pendingFinal: false,
      lastUserMessageAt: userTimestampMs,
      pendingToolImages: [],
      error: null,
      loading: false,
      thinkingLevel: null,
      showThinking: true,
    });

    await useChatStore.getState().loadSessions();

    const next = useChatStore.getState();
    expect(next.currentSessionKey).toBe('agent:main:legacy-session');
    expect(next.sessionRunningState).toEqual({ 'agent:main:legacy-session': true });
    expect(next.sessionLabels).toEqual({ 'agent:main:legacy-session': 'Legacy Label' });
    expect(next.sessionLastActivity['agent:main:legacy-session']).toBe(userTimestampMs);
    expect(next.sessionModels['agent:main:legacy-session']).toBe('custom/legacy-model');
  });

  it('accepts canonical runtime events for a legacy current session key and clears sending on final', async () => {
    const { useChatStore } = await import('@/stores/chat');

    useChatStore.setState({
      currentSessionKey: 'legacy-session',
      currentAgentId: 'main',
      sessions: [{ key: 'legacy-session' }],
      sessionRunningState: { 'legacy-session': true },
      messages: [
        { id: 'user-1', role: 'user', content: 'Question', timestamp: userTimestampSeconds },
      ],
      sessionLabels: {},
      sessionLastActivity: {},
      sessionModels: {},
      sending: true,
      activeRunId: 'run-legacy',
      streamingText: '',
      streamingMessage: null,
      streamingTools: [],
      pendingFinal: false,
      lastUserMessageAt: userTimestampMs,
      pendingToolImages: [],
      error: null,
      loading: false,
      thinkingLevel: null,
      showThinking: true,
    });

    useChatStore.getState().handleChatEvent({
      state: 'final',
      runId: 'run-legacy',
      sessionKey: 'agent:main:legacy-session',
      message: {
        id: 'assistant-legacy',
        role: 'assistant',
        content: 'Done',
        timestamp: assistantTimestampSeconds,
      },
    });

    const next = useChatStore.getState();
    expect(next.sending).toBe(false);
    expect(next.activeRunId).toBeNull();
    expect(next.sessionRunningState).toEqual({});
    expect(next.messages.map((message) => message.id)).toEqual(['user-1', 'assistant-legacy']);
  });
});
