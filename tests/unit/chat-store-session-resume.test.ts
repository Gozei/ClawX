import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { gatewayRpcMock, hostApiFetchMock, agentsState } = vi.hoisted(() => ({
  gatewayRpcMock: vi.fn(),
  hostApiFetchMock: vi.fn(),
  agentsState: {
    agents: [] as Array<Record<string, unknown>>,
    defaultAgentId: 'main',
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
    agentsState.defaultAgentId = 'main';

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

  it('clears the running state when history already includes the final assistant reply even without pendingFinal', async () => {
    gatewayRpcMock.mockReset();
    gatewayRpcMock.mockImplementation((method: string) => {
      if (method === 'chat.history') {
        return Promise.resolve({
          messages: [
            { id: 'user-1', role: 'user', content: 'Question', timestamp: userTimestampSeconds },
            {
              id: 'assistant-final',
              role: 'assistant',
              content: 'Final answer from history',
              timestamp: assistantTimestampSeconds,
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
          id: 'assistant-local-final',
          role: 'assistant',
          content: 'Final answer from history',
          timestamp: assistantTimestampSeconds,
        },
      ],
      sessionLabels: {},
      sessionLastActivity: {},
      sessionRunningState: { 'agent:main:main': true },
      sending: true,
      activeRunId: 'run-final',
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
      sendStage: 'running',
    });

    await useChatStore.getState().loadHistory(true);

    const next = useChatStore.getState();
    expect(next.messages.map((message) => message.id)).toEqual([
      'user-1',
      'assistant-final',
    ]);
    expect(next.sending).toBe(false);
    expect(next.activeRunId).toBeNull();
    expect(next.pendingFinal).toBe(false);
    expect(next.sendStage).toBeNull();
    expect(next.sessionRunningState).toEqual({});
  });

  it('auto-finalizes shortly after history reveals the final assistant reply during the live-turn guard window', async () => {
    gatewayRpcMock.mockReset();
    gatewayRpcMock.mockImplementation((method: string) => {
      if (method === 'chat.history') {
        return Promise.resolve({
          messages: [
            { id: 'user-1', role: 'user', content: 'Question', timestamp: userTimestampSeconds },
            {
              id: 'assistant-final',
              role: 'assistant',
              content: 'Final answer from history',
              timestamp: assistantTimestampSeconds,
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
      ],
      sessionLabels: {},
      sessionLastActivity: {},
      sessionRunningState: { 'agent:main:main': true },
      sending: true,
      activeRunId: 'run-final-guarded',
      streamingText: '',
      streamingMessage: {
        id: 'assistant-streaming',
        role: 'assistant',
        content: 'Still wrapping up...',
        timestamp: assistantTimestampSeconds - 1,
      },
      streamingTools: [],
      pendingFinal: false,
      lastUserMessageAt: userTimestampMs,
      pendingToolImages: [],
      error: null,
      loading: false,
      thinkingLevel: null,
      showThinking: true,
      sendStage: 'running',
    });

    useChatStore.getState().handleChatEvent({
      state: 'delta',
      runId: 'run-final-guarded',
      sessionKey: 'agent:main:main',
      message: {
        id: 'assistant-streaming',
        role: 'assistant',
        content: 'Still wrapping up...',
        timestamp: assistantTimestampSeconds - 1,
      },
    });
    await vi.advanceTimersByTimeAsync(20);

    await useChatStore.getState().loadHistory(true);

    const duringGuard = useChatStore.getState();
    expect(duringGuard.messages.map((message) => message.id)).toEqual([
      'user-1',
    ]);
    expect(duringGuard.sending).toBe(true);
    expect(duringGuard.pendingFinal).toBe(true);
    expect(duringGuard.sessionRunningState).toEqual({ 'agent:main:main': true });

    await vi.advanceTimersByTimeAsync(4_000);

    const next = useChatStore.getState();
    expect(next.messages.map((message) => message.id)).toEqual([
      'user-1',
      'assistant-final',
    ]);
    expect(next.sending).toBe(false);
    expect(next.activeRunId).toBeNull();
    expect(next.pendingFinal).toBe(false);
    expect(next.sendStage).toBeNull();
    expect(next.sessionRunningState).toEqual({});
  });

  it('hydrates stale streaming output from history even when streamingMessage is still present', async () => {
    const currentUserTimestampSeconds = Math.floor(Date.now() / 1000);
    const currentAssistantTimestampSeconds = currentUserTimestampSeconds + 1;

    gatewayRpcMock.mockReset();
    gatewayRpcMock.mockImplementation((method: string) => {
      if (method === 'chat.send') {
        return new Promise(() => undefined);
      }
      if (method === 'chat.history') {
        return Promise.resolve({
          messages: [
            { id: 'user-1', role: 'user', content: 'Question', timestamp: currentUserTimestampSeconds },
            {
              id: 'assistant-final',
              role: 'assistant',
              content: 'Final answer from history',
              timestamp: currentAssistantTimestampSeconds,
            },
          ],
        });
      }
      if (method === 'sessions.list') return Promise.resolve({ sessions: [] });
      if (method === 'chat.abort') return Promise.resolve({ ok: true });
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
      sessionRunningState: {},
      sending: false,
      activeRunId: null,
      streamingText: '',
      streamingMessage: null,
      streamingTools: [],
      pendingFinal: false,
      lastUserMessageAt: null,
      pendingToolImages: [],
      error: null,
      loading: true,
      thinkingLevel: null,
      showThinking: true,
      sendStage: null,
    });

    void useChatStore.getState().sendMessage('Question');
    await Promise.resolve();
    await Promise.resolve();

    useChatStore.setState({
      streamingMessage: {
        id: 'assistant-stream',
        role: 'assistant',
        content: 'Final answer from history',
        timestamp: currentAssistantTimestampSeconds,
      },
    });

    await vi.advanceTimersByTimeAsync(12_000);
    await Promise.resolve();
    await Promise.resolve();

    const next = useChatStore.getState();
    expect(gatewayRpcMock).toHaveBeenCalledWith(
      'chat.history',
      { sessionKey: 'agent:main:main', limit: 200 },
      expect.any(Number),
    );
    expect(next.sending).toBe(false);
    expect(next.activeRunId).toBeNull();
    expect(next.pendingFinal).toBe(false);
    expect(next.sendStage).toBeNull();
    expect(next.streamingMessage).toBeNull();
    expect(next.sessionRunningState).toEqual({});
  });

  it('clears stale settled streaming state when an explicit history refresh already contains the final reply', async () => {
    gatewayRpcMock.mockReset();
    gatewayRpcMock.mockImplementation((method: string) => {
      if (method === 'chat.history') {
        return Promise.resolve({
          messages: [
            { id: 'user-1', role: 'user', content: 'Question', timestamp: userTimestampSeconds },
            {
              id: 'assistant-final',
              role: 'assistant',
              content: 'Final answer from history',
              timestamp: assistantTimestampSeconds,
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
      ],
      sessionLabels: {},
      sessionLastActivity: {},
      sessionRunningState: {},
      sending: false,
      activeRunId: 'run-stale',
      streamingText: 'Final answer from history',
      streamingMessage: {
        id: 'assistant-stream',
        role: 'assistant',
        content: 'Final answer from history',
        timestamp: assistantTimestampSeconds,
      },
      streamingTools: [
        { toolCallId: 'tool-1', name: 'browser', status: 'completed', updatedAt: 1 },
      ],
      pendingFinal: false,
      lastUserMessageAt: userTimestampMs,
      pendingToolImages: [{ fileName: 'flight.png', mimeType: 'image/png', fileSize: 1 }],
      error: null,
      loading: false,
      thinkingLevel: null,
      showThinking: true,
      sendStage: 'finalizing',
    });

    await useChatStore.getState().loadHistory(true);

    const next = useChatStore.getState();
    expect(next.messages.map((message) => message.id)).toEqual([
      'user-1',
      'assistant-final',
    ]);
    expect(next.sending).toBe(false);
    expect(next.activeRunId).toBeNull();
    expect(next.sendStage).toBeNull();
    expect(next.pendingFinal).toBe(false);
    expect(next.streamingText).toBe('');
    expect(next.streamingMessage).toBeNull();
    expect(next.streamingTools).toEqual([]);
    expect(next.pendingToolImages).toEqual([]);
  });

  it('keeps the history poll alive after a delta event so a missing completed notification can still finalize the turn', async () => {
    const currentUserTimestampSeconds = Math.floor(Date.now() / 1000);
    const currentAssistantTimestampSeconds = currentUserTimestampSeconds + 1;
    let historyMessages: Array<Record<string, unknown>> = [];

    gatewayRpcMock.mockReset();
    gatewayRpcMock.mockImplementation((method: string) => {
      if (method === 'chat.send') {
        return new Promise(() => undefined);
      }
      if (method === 'chat.history') {
        return Promise.resolve({
          messages: historyMessages,
        });
      }
      if (method === 'sessions.list') return Promise.resolve({ sessions: [] });
      if (method === 'chat.abort') return Promise.resolve({ ok: true });
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
      sessionRunningState: {},
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
      sendStage: null,
    });

    void useChatStore.getState().sendMessage('Question');
    await Promise.resolve();
    await Promise.resolve();

    useChatStore.getState().handleChatEvent({
      state: 'delta',
      runId: 'run-live-stream',
      message: {
        role: 'assistant',
        content: 'Searching flights now...',
        timestamp: currentAssistantTimestampSeconds,
      },
    });

    historyMessages = [
      { id: 'user-1', role: 'user', content: 'Question', timestamp: currentUserTimestampSeconds },
      {
        id: 'assistant-final',
        role: 'assistant',
        content: 'Final answer from history',
        timestamp: currentAssistantTimestampSeconds,
      },
    ];

    await vi.advanceTimersByTimeAsync(12_000);
    await Promise.resolve();
    await Promise.resolve();

    const next = useChatStore.getState();
    expect(gatewayRpcMock).toHaveBeenCalledWith(
      'chat.history',
      { sessionKey: 'agent:main:main', limit: 200 },
      expect.any(Number),
    );
    expect(next.sending).toBe(false);
    expect(next.pendingFinal).toBe(false);
    expect(next.sendStage).toBeNull();
    expect(next.streamingMessage).toBeNull();
    expect(next.sessionRunningState).toEqual({});
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

  it('does not keep a duplicate optimistic user message when refreshed history wraps the same prompt in gateway metadata', async () => {
    gatewayRpcMock.mockReset();
    gatewayRpcMock.mockImplementation((method: string) => {
      if (method === 'chat.history') {
        return Promise.resolve({
          messages: [
            {
              id: 'history-user-1',
              role: 'user',
              content: [
                'Sender (untrusted metadata):',
                '```json',
                '{"label":"Deep AI Worker","id":"gateway-client"}',
                '```',
                '',
                '[Wed 2026-04-15 15:43 GMT+8] Conversation info (untrusted metadata): ```json',
                '{"agent":{"id":"main","name":"Main","preferredModel":"custom-custombc/glm-5"}}',
                '```',
                'Execution playbook:',
                '- You are currently acting as the Main agent.',
                '',
                '现在再看下',
              ].join('\n'),
              timestamp: userTimestampSeconds + 12,
            },
            {
              id: 'assistant-1',
              role: 'assistant',
              content: '我正在继续处理。',
              timestamp: userTimestampSeconds + 13,
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
        {
          id: 'optimistic-user-1',
          role: 'user',
          content: '现在再看下',
          timestamp: userTimestampSeconds,
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
      'history-user-1',
      'assistant-1',
    ]);
    expect(next.messages.filter((message) => message.role === 'user')).toHaveLength(1);
    expect(next.sending).toBe(false);
    expect(next.activeRunId).toBeNull();
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

  it('uses the persisted session model for runtime sync and send after reloading sessions', async () => {
    gatewayRpcMock.mockReset();
    gatewayRpcMock.mockImplementation((method: string) => {
      if (method === 'chat.send') return Promise.resolve({ runId: 'run-live' });
      if (method === 'chat.history') return Promise.resolve({ messages: [] });
      throw new Error(`Unexpected gateway RPC: ${method}`);
    });

    hostApiFetchMock.mockReset();
    hostApiFetchMock.mockImplementation((path: string) => {
      if (path === '/api/sessions/list') {
        return Promise.resolve({
          success: true,
          sessions: [
            {
              key: 'agent:main:main',
              modelProvider: 'custom-custombc',
              model: 'qwen3.5-plus',
              updatedAt: userTimestampMs,
            },
          ],
        });
      }
      if (path === '/api/sessions/metadata') {
        return Promise.resolve({ success: true, metadata: {} });
      }
      if (path === '/api/agents/main/model/runtime') {
        return Promise.resolve({ success: true });
      }
      throw new Error(`Unexpected host route: ${path}`);
    });

    const { useChatStore } = await import('@/stores/chat');

    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessions: [],
      sessionModels: {},
      messages: [],
      sessionLabels: {},
      sessionLastActivity: {},
      sessionRunningState: {},
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

    await useChatStore.getState().loadSessions();
    await useChatStore.getState().sendMessage('现在使用哪个模型？');

    expect(useChatStore.getState().sessionModels['agent:main:main']).toBe('custom-custombc/qwen3.5-plus');
    expect(hostApiFetchMock).toHaveBeenCalledWith('/api/agents/main/model/runtime', {
      method: 'PUT',
      body: JSON.stringify({ modelRef: 'custom-custombc/qwen3.5-plus' }),
    });

    const sendCall = gatewayRpcMock.mock.calls.find(([method]) => method === 'chat.send');
    const sendPayload = String((sendCall?.[1] as { message?: unknown } | undefined)?.message ?? '');
    expect(sendPayload).toContain('"preferredModel": "custom-custombc/qwen3.5-plus"');
    expect(sendPayload).toContain('现在使用哪个模型？');
  });

  it('loads sessions from the host session list route before falling back to gateway enumeration', async () => {
    gatewayRpcMock.mockReset();
    gatewayRpcMock.mockImplementation((method: string) => {
      throw new Error(`Unexpected gateway RPC: ${method}`);
    });
    hostApiFetchMock.mockReset();
    hostApiFetchMock.mockImplementation((path: string) => {
      if (path === '/api/sessions/list') {
        return Promise.resolve({
          success: true,
          sessions: [
            {
              key: 'agent:main:session-recovered',
              label: 'Recovered session',
              updatedAt: userTimestampMs + 1000,
            },
            {
              key: 'agent:main:main',
              displayName: 'Main',
              updatedAt: userTimestampMs,
            },
          ],
        });
      }
      if (path === '/api/sessions/metadata') {
        return Promise.resolve({ success: true, metadata: {} });
      }
      throw new Error(`Unexpected host route: ${path}`);
    });

    const { useChatStore } = await import('@/stores/chat');

    await useChatStore.getState().loadSessions();

    expect(gatewayRpcMock).not.toHaveBeenCalled();
    expect(useChatStore.getState().currentSessionKey).toBe('agent:main:main');
    expect(useChatStore.getState().sessions.map((session) => session.key)).toEqual([
      'agent:main:session-recovered',
      'agent:main:main',
    ]);
    expect(useChatStore.getState().sessions[0]?.label).toBe('Recovered session');
  });

  it('creates a new draft session under the configured default role instead of the previous role', async () => {
    gatewayRpcMock.mockReset();
    gatewayRpcMock.mockImplementation((method: string) => {
      if (method === 'sessions.list') return Promise.resolve({ sessions: [] });
      throw new Error(`Unexpected gateway RPC: ${method}`);
    });
    agentsState.defaultAgentId = 'main';
    vi.setSystemTime(new Date('2026-04-15T10:00:00.000Z'));

    const { useChatStore } = await import('@/stores/chat');

    useChatStore.setState({
      currentSessionKey: 'agent:other:main',
      currentAgentId: 'other',
      sessions: [{ key: 'agent:main:main' }, { key: 'agent:other:main' }],
      messages: [{ id: 'assistant-1', role: 'assistant', content: 'Existing other history' }],
      sessionLabels: {},
      sessionLastActivity: {},
      sessionModels: {},
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
      sessionRunningState: {},
      sendStage: null,
    });

    useChatStore.getState().newSession();
    const expectedTimestamp = new Date('2026-04-15T10:00:00.000Z').valueOf();

    expect(useChatStore.getState().currentSessionKey).toBe(`agent:main:session-${expectedTimestamp}`);
    expect(useChatStore.getState().currentAgentId).toBe('main');
    expect(useChatStore.getState().messages).toEqual([]);
  });

  it('skips history loading for a brand new empty draft session', async () => {
    gatewayRpcMock.mockReset();
    gatewayRpcMock.mockImplementation((method: string) => {
      if (method === 'sessions.list') return Promise.resolve({ sessions: [] });
      throw new Error(`Unexpected gateway RPC: ${method}`);
    });
    hostApiFetchMock.mockReset();
    hostApiFetchMock.mockResolvedValue({ success: true });
    vi.setSystemTime(new Date('2026-04-21T09:00:00.000Z'));

    const { useChatStore } = await import('@/stores/chat');

    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessions: [{ key: 'agent:main:main' }],
      messages: [{ id: 'assistant-1', role: 'assistant', content: 'Existing history' }],
      sessionLabels: {},
      sessionLastActivity: {},
      sessionModels: {},
      sessionRunningState: {},
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
      sendStage: null,
    });

    useChatStore.getState().newSession();
    const draftSessionKey = useChatStore.getState().currentSessionKey;

    await useChatStore.getState().loadHistory();

    expect(useChatStore.getState().currentSessionKey).toBe(draftSessionKey);
    expect(useChatStore.getState().messages).toEqual([]);
    expect(useChatStore.getState().loading).toBe(false);
    expect(hostApiFetchMock).not.toHaveBeenCalled();
    expect(gatewayRpcMock).not.toHaveBeenCalled();
  });

  it('loadSessions keeps an active empty draft selected when persisted sessions exist', async () => {
    gatewayRpcMock.mockReset();
    gatewayRpcMock.mockImplementation((method: string) => {
      throw new Error(`Unexpected gateway RPC: ${method}`);
    });
    hostApiFetchMock.mockReset();
    hostApiFetchMock.mockImplementation((path: string) => {
      if (path === '/api/sessions/list') {
        return Promise.resolve({
          success: true,
          sessions: [
            {
              key: 'agent:main:session-recovered',
              label: 'Recovered session',
              updatedAt: userTimestampMs,
            },
            {
              key: 'agent:main:main',
              displayName: 'Main',
              updatedAt: userTimestampMs - 1_000,
            },
          ],
        });
      }
      if (path === '/api/sessions/metadata') {
        return Promise.resolve({
          success: true,
          metadata: {},
        });
      }
      throw new Error(`Unexpected host route: ${path}`);
    });

    const { useChatStore } = await import('@/stores/chat');

    useChatStore.setState({
      currentSessionKey: 'agent:main:session-draft',
      currentAgentId: 'main',
      sessions: [],
      sessionLabels: {},
      sessionLastActivity: {},
      sessionModels: {},
      sessionRunningState: {},
      messages: [],
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

    await useChatStore.getState().loadSessions();

    const next = useChatStore.getState();
    expect(gatewayRpcMock).not.toHaveBeenCalled();
    expect(next.currentSessionKey).toBe('agent:main:session-draft');
    expect(next.sessions.map((session) => session.key)).toEqual([
      'agent:main:session-recovered',
      'agent:main:main',
    ]);
  });

  it('loads inactive session history through the host route before falling back to gateway chat.history', async () => {
    gatewayRpcMock.mockReset();
    gatewayRpcMock.mockImplementation((method: string) => {
      if (method === 'sessions.list') return Promise.resolve({ sessions: [] });
      throw new Error(`Unexpected gateway RPC: ${method}`);
    });
    hostApiFetchMock.mockReset();
    hostApiFetchMock
      .mockResolvedValueOnce({
        success: true,
        resolved: true,
        thinkingLevel: 'high',
        messages: [
          {
            role: 'user',
            content: [{
              type: 'text',
              text: 'Sender (untrusted metadata):\n```json\n{"label":"ClawX"}\n```\n\n[Fri 2026-04-03 14:35 GMT+8] Preview from local history',
            }],
            timestamp: userTimestampSeconds,
            id: 'user-local',
          },
          {
            role: 'assistant',
            content: 'Reply from local history',
            timestamp: assistantTimestampSeconds,
            id: 'assistant-local',
          },
        ],
      })
      .mockResolvedValueOnce({
        success: true,
        label: 'Preview from local history',
      });

    const { useChatStore } = await import('@/stores/chat');

    useChatStore.setState({
      currentSessionKey: 'agent:main:session-local',
      currentAgentId: 'main',
      sessions: [{ key: 'agent:main:session-local' }],
      sessionLabels: {},
      sessionLastActivity: {},
      sessionModels: {},
      sessionRunningState: {},
      messages: [],
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
    await Promise.resolve();
    await Promise.resolve();

    expect(hostApiFetchMock).toHaveBeenCalledWith('/api/sessions/history', {
      method: 'POST',
      body: JSON.stringify({ sessionKey: 'agent:main:session-local', limit: 200 }),
    });
    expect(hostApiFetchMock).toHaveBeenCalledWith('/api/sessions/auto-label', {
      method: 'POST',
      body: JSON.stringify({ sessionKey: 'agent:main:session-local', label: 'Preview from local history' }),
    });
    expect(gatewayRpcMock).not.toHaveBeenCalled();
    expect(useChatStore.getState().messages.map((message) => message.id)).toEqual([
      'user-local',
      'assistant-local',
    ]);
    expect(useChatStore.getState().thinkingLevel).toBe('high');
    expect(useChatStore.getState().sessionLabels['agent:main:session-local']).toBe('Preview from local history');
    expect(useChatStore.getState().sessions[0]?.label).toBe('Preview from local history');
  });

  it('filters out pre-compaction memory flush prompts from loaded history', async () => {
    gatewayRpcMock.mockReset();
    gatewayRpcMock.mockImplementation((method: string) => {
      if (method === 'chat.history') {
        return Promise.resolve({
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: [
                    'Pre-compaction memory flush. Store durable memories only in memory/2026-04-15.md (create memory/ if needed).',
                    'Treat workspace bootstrap/reference files such as MEMORY.md, SOUL.md, TOOLS.md, and AGENTS.md as read-only during this flush; never overwrite, replace, or edit them.',
                    'If memory/2026-04-15.md already exists, APPEND new content only and do not overwrite existing entries.',
                    'Do NOT create timestamped variant files (e.g., 2026-04-15-HHMM.md); always use the canonical 2026-04-15.md filename.',
                    'If nothing to store, reply with NO_REPLY.',
                  ].join('\n'),
                },
              ],
              timestamp: userTimestampSeconds - 1,
              id: 'flush-prompt',
            },
            {
              role: 'user',
              content: '你是什么模型',
              timestamp: userTimestampSeconds,
              id: 'user-real',
            },
            {
              role: 'assistant',
              content: '我是 glm-5',
              timestamp: assistantTimestampSeconds,
              id: 'assistant-real',
            },
          ],
        });
      }
      if (method === 'sessions.list') return Promise.resolve({ sessions: [] });
      throw new Error(`Unexpected gateway RPC: ${method}`);
    });

    const { useChatStore } = await import('@/stores/chat');

    useChatStore.setState({
      currentSessionKey: 'agent:main:session-flush',
      currentAgentId: 'main',
      sessions: [{ key: 'agent:main:session-flush' }],
      sessionLabels: {},
      sessionLastActivity: {},
      sessionModels: {},
      sessionRunningState: { 'agent:main:session-flush': true },
      messages: [],
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

    expect(useChatStore.getState().messages.map((message) => message.id)).toEqual([
      'user-real',
      'assistant-real',
    ]);
    expect(useChatStore.getState().sessionLabels['agent:main:session-flush']).toBe('你是什么模型');
  });

  it('does not reinsert hidden HEARTBEAT_OK replies while quiet history polling catches up', async () => {
    gatewayRpcMock.mockReset();
    gatewayRpcMock.mockImplementation((method: string) => {
      if (method === 'chat.history') {
        return Promise.resolve({ messages: [] });
      }
      if (method === 'sessions.list') return Promise.resolve({ sessions: [] });
      throw new Error(`Unexpected gateway RPC: ${method}`);
    });

    const { useChatStore } = await import('@/stores/chat');

    useChatStore.setState({
      currentSessionKey: 'agent:main:session-heartbeat-hidden',
      currentAgentId: 'main',
      sessions: [{ key: 'agent:main:session-heartbeat-hidden' }],
      sessionLabels: {},
      sessionLastActivity: {},
      sessionModels: {},
      sessionRunningState: { 'agent:main:session-heartbeat-hidden': true },
      messages: [
        {
          id: 'assistant-heartbeat-hidden',
          role: 'assistant',
          content: 'HEARTBEAT_OK',
          timestamp: assistantTimestampSeconds,
        },
      ],
      sending: true,
      activeRunId: 'run-heartbeat-hidden',
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

    expect(useChatStore.getState().messages).toEqual([]);
  });

  it('reruns an explicit history reload after an in-flight quiet load finishes', async () => {
    let historyCallCount = 0;
    let resolveQuietHistory: ((value: {
      success: true;
      resolved: true;
      messages: Array<{ id: string; role: string; content: string; timestamp: number }>;
      thinkingLevel: null;
    }) => void) | null = null;

    gatewayRpcMock.mockReset();
    gatewayRpcMock.mockImplementation((method: string) => {
      if (method === 'sessions.list') return Promise.resolve({ sessions: [] });
      throw new Error(`Unexpected gateway RPC: ${method}`);
    });
    hostApiFetchMock.mockReset();
    hostApiFetchMock.mockImplementation((path: string) => {
      if (path === '/api/sessions/history') {
        historyCallCount += 1;
        if (historyCallCount === 1) {
          return new Promise((resolve) => {
            resolveQuietHistory = resolve as typeof resolveQuietHistory;
          });
        }
        if (historyCallCount === 2) {
          return Promise.resolve({
            success: true,
            resolved: true,
            messages: [
              {
                id: 'user-1',
                role: 'user',
                content: 'Who are you?',
                timestamp: userTimestampSeconds,
              },
              {
                id: 'assistant-1',
                role: 'assistant',
                content: 'I am ClawX.',
                timestamp: assistantTimestampSeconds,
              },
            ],
            thinkingLevel: null,
          });
        }
      }

      return Promise.resolve({ success: true });
    });

    const { useChatStore } = await import('@/stores/chat');

    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessions: [{ key: 'agent:main:main' }],
      sessionLabels: {},
      sessionLastActivity: {},
      sessionModels: {},
      sessionRunningState: {},
      messages: [],
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

    const quietLoad = useChatStore.getState().loadHistory(true);
    await Promise.resolve();

    const explicitLoad = useChatStore.getState().loadHistory();
    resolveQuietHistory?.({
      success: true,
      resolved: true,
      messages: [
        {
          id: 'user-1',
          role: 'user',
          content: 'Who are you?',
          timestamp: userTimestampSeconds,
        },
      ],
      thinkingLevel: null,
    });

    await quietLoad;
    await explicitLoad;

    expect(historyCallCount).toBe(2);
    expect(useChatStore.getState().messages.map((message) => message.id)).toEqual([
      'user-1',
      'assistant-1',
    ]);
  });

  it('prefetches sidebar labels through the host preview route instead of gateway chat.history', async () => {
    gatewayRpcMock.mockReset();
    gatewayRpcMock.mockImplementation((method: string) => {
      if (method === 'sessions.list') {
        return Promise.resolve({
          sessions: [
            {
              key: 'agent:main:main',
              displayName: 'Main',
              updatedAt: userTimestampMs,
            },
            {
              key: 'agent:main:session-preview',
              updatedAt: userTimestampMs - 1_000,
            },
          ],
        });
      }
      throw new Error(`Unexpected gateway RPC: ${method}`);
    });
    hostApiFetchMock.mockReset();
    hostApiFetchMock
      .mockResolvedValueOnce({
        success: true,
        sessions: [
          {
            key: 'agent:main:main',
            displayName: 'Main',
            updatedAt: userTimestampMs,
          },
          {
            key: 'agent:main:session-preview',
            updatedAt: userTimestampMs - 1_000,
          },
        ],
      })
      .mockResolvedValueOnce({
        success: true,
        metadata: {},
      })
      .mockResolvedValueOnce({
        success: true,
        previews: {
          'agent:main:session-preview': {
            firstUserMessage: 'Preview from host route',
          },
        },
      })
      .mockResolvedValueOnce({
        success: true,
        label: 'Preview from host route',
      });

    const { useChatStore } = await import('@/stores/chat');

    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessions: [{ key: 'agent:main:main' }],
      sessionLabels: {},
      sessionLastActivity: {},
      sessionModels: {},
      messages: [],
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

    await useChatStore.getState().loadSessions();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(gatewayRpcMock).not.toHaveBeenCalled();
    expect(hostApiFetchMock).toHaveBeenNthCalledWith(1, '/api/sessions/list');
    expect(hostApiFetchMock).toHaveBeenNthCalledWith(2, '/api/sessions/metadata', {
      method: 'POST',
      body: JSON.stringify({ sessionKeys: ['agent:main:main', 'agent:main:session-preview'] }),
    });
    expect(hostApiFetchMock).toHaveBeenNthCalledWith(3, '/api/sessions/previews', {
      method: 'POST',
      body: JSON.stringify({ sessionKeys: ['agent:main:session-preview'] }),
    });
    expect(hostApiFetchMock).toHaveBeenNthCalledWith(4, '/api/sessions/auto-label', {
      method: 'POST',
      body: JSON.stringify({ sessionKey: 'agent:main:session-preview', label: 'Preview from host route' }),
    });
    expect(useChatStore.getState().sessionLabels['agent:main:session-preview']).toBe('Preview from host route');
  });

  it('keeps the blank default session selected on cold start even when newer history exists', async () => {
    gatewayRpcMock.mockReset();
    gatewayRpcMock.mockImplementation((method: string) => {
      throw new Error(`Unexpected gateway RPC: ${method}`);
    });
    hostApiFetchMock.mockReset();
    hostApiFetchMock.mockImplementation((path: string) => {
      if (path === '/api/sessions/list') {
        return Promise.resolve({
          success: true,
          sessions: [
            {
              key: 'agent:main:session-latest',
              label: 'Recovered startup session',
              updatedAt: userTimestampMs,
            },
            {
              key: 'agent:main:main',
              displayName: 'Main',
              updatedAt: userTimestampMs - 1_000,
            },
          ],
        });
      }
      if (path === '/api/sessions/metadata') {
        return Promise.resolve({
          success: true,
          metadata: {},
        });
      }
      if (path === '/api/sessions/history') {
        return Promise.resolve({
          success: true,
          resolved: true,
          messages: [
            {
              id: 'user-startup-1',
              role: 'user',
              content: 'Restore the most recent session.',
              timestamp: userTimestampSeconds,
            },
            {
              id: 'assistant-startup-1',
              role: 'assistant',
              content: 'Recovered startup history.',
              timestamp: assistantTimestampSeconds,
            },
          ],
          thinkingLevel: null,
        });
      }
      return Promise.resolve({ success: true });
    });

    const { useChatStore } = await import('@/stores/chat');

    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessions: [],
      sessionLabels: {},
      sessionLastActivity: {},
      sessionModels: {},
      sessionRunningState: {},
      messages: [],
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

    await useChatStore.getState().loadSessions();

    const next = useChatStore.getState();
    expect(gatewayRpcMock).not.toHaveBeenCalled();
    expect(next.currentSessionKey).toBe('agent:main:main');
    expect(next.sessions.map((session) => session.key)).toEqual([
      'agent:main:session-latest',
      'agent:main:main',
    ]);
    expect(next.messages).toEqual([]);
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

  it('does not append HEARTBEAT_OK when a hidden heartbeat turn finishes', async () => {
    const { useChatStore } = await import('@/stores/chat');

    useChatStore.setState({
      currentSessionKey: 'legacy-session',
      currentAgentId: 'main',
      sessions: [{ key: 'legacy-session' }],
      sessionRunningState: { 'legacy-session': true },
      sessionLabels: {},
      sessionLastActivity: {},
      sessionModels: {},
      messages: [],
      sending: true,
      activeRunId: 'run-heartbeat-final',
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
      runId: 'run-heartbeat-final',
      sessionKey: 'agent:main:legacy-session',
      message: {
        id: 'assistant-heartbeat-final',
        role: 'assistant',
        content: 'HEARTBEAT_OK',
        timestamp: assistantTimestampSeconds,
      },
    });

    await Promise.resolve();
    await Promise.resolve();

    const next = useChatStore.getState();
    expect(next.sending).toBe(false);
    expect(next.activeRunId).toBeNull();
    expect(next.sessionRunningState).toEqual({});
    expect(next.messages).toEqual([]);
  });
});
