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
    vi.unstubAllGlobals();
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

  it('hydrates current-turn process events from the local transcript during quiet live refreshes', async () => {
    gatewayRpcMock.mockReset();
    gatewayRpcMock.mockImplementation((method: string) => {
      if (method === 'sessions.list') return Promise.resolve({ sessions: [] });
      throw new Error(`Unexpected gateway RPC: ${method}`);
    });
    hostApiFetchMock.mockReset();
    hostApiFetchMock.mockImplementation((path: string) => {
      if (path === '/api/sessions/history') {
        return Promise.resolve({
          success: true,
          resolved: true,
          messages: [
            { id: 'user-1', role: 'user', content: 'Question', timestamp: userTimestampSeconds },
            {
              id: 'assistant-process-1',
              role: 'assistant',
              content: [
                { type: 'thinking', thinking: 'checking sources' },
                { type: 'tool_use', id: 'tool-1', name: 'web_search', input: { query: 'docs' } },
              ],
              timestamp: toolTimestampSeconds,
            },
          ],
          thinkingLevel: 'high',
        });
      }
      return Promise.resolve({ success: true });
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
      sendStage: 'running',
    });

    await useChatStore.getState().loadHistory(true);

    const next = useChatStore.getState();
    expect(hostApiFetchMock).toHaveBeenCalledWith('/api/sessions/history', {
      method: 'POST',
      body: JSON.stringify({ sessionKey: 'agent:main:main', limit: 200 }),
    });
    expect(gatewayRpcMock).not.toHaveBeenCalledWith(
      'chat.history',
      expect.anything(),
      expect.anything(),
    );
    expect(next.messages.map((message) => message.id)).toEqual([
      'user-1',
      'assistant-process-1',
    ]);
    expect(next.thinkingLevel).toBe('high');
    expect(next.sending).toBe(true);
    expect(next.pendingFinal).toBe(true);
  });

  it('keeps a just-finished assistant reply when quiet history refresh lags behind persistence', async () => {
    gatewayRpcMock.mockReset();
    gatewayRpcMock.mockImplementation((method: string) => {
      if (method === 'chat.history') {
        return Promise.resolve({
          messages: [
            { id: 'user-1', role: 'user', content: 'Question', timestamp: userTimestampSeconds },
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
          content: 'Visible final answer',
          timestamp: assistantTimestampSeconds,
        },
      ],
      sessionLabels: {},
      sessionLastActivity: {},
      sessionRunningState: {},
      sending: false,
      activeRunId: null,
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
      sendStage: null,
    });

    await useChatStore.getState().loadHistory(true);

    const next = useChatStore.getState();
    expect(next.messages.map((message) => message.id)).toEqual([
      'user-1',
      'assistant-local-final',
    ]);
    expect(next.sending).toBe(false);
    expect(next.pendingFinal).toBe(false);
  });

  it('keeps local failed turns when an explicit history reload only has older transcript messages', async () => {
    gatewayRpcMock.mockReset();
    gatewayRpcMock.mockImplementation((method: string) => {
      if (method === 'chat.history') {
        return Promise.resolve({
          messages: [
            { id: 'user-old', role: 'user', content: '在线吗', timestamp: userTimestampSeconds },
            {
              id: 'assistant-old-error',
              role: 'assistant',
              content: 'Unknown error (no error details in response)',
              timestamp: assistantTimestampSeconds,
              isError: true,
            },
          ],
        });
      }
      if (method === 'sessions.list') return Promise.resolve({ sessions: [] });
      throw new Error(`Unexpected gateway RPC: ${method}`);
    });

    const { useChatStore } = await import('@/stores/chat');
    const newerUserTimestampSeconds = userTimestampSeconds + 100;
    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessions: [{ key: 'agent:main:main' }],
      messages: [
        { id: 'user-old', role: 'user', content: '在线吗', timestamp: userTimestampSeconds },
        {
          id: 'assistant-old-error',
          role: 'assistant',
          content: 'Unknown error (no error details in response)',
          timestamp: assistantTimestampSeconds,
          isError: true,
        },
        { id: 'user-new', role: 'user', content: '你是什么模型', timestamp: newerUserTimestampSeconds },
        {
          id: 'assistant-new-timeout',
          role: 'assistant',
          content: '消息发送失败：请求超时，请稍后重试。',
          timestamp: newerUserTimestampSeconds + 1,
          isError: true,
        },
      ],
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

    await useChatStore.getState().loadHistory();

    const next = useChatStore.getState();
    expect(next.messages.map((message) => message.id)).toEqual([
      'user-old',
      'assistant-old-error',
      'user-new',
      'assistant-new-timeout',
    ]);
    expect(next.sending).toBe(false);
    expect(next.pendingFinal).toBe(false);
  });

  it('restores the last visible in-flight reply from local storage after refresh while history is behind', async () => {
    vi.setSystemTime(new Date('2026-04-25T02:49:00.000Z'));
    const sessionKey = 'agent:main:main';
    const userMessage = {
      id: 'user-visible',
      role: 'user',
      content: 'Generate every file type',
      timestamp: Date.now() / 1000,
    };
    const assistantDraft = {
      id: 'assistant-visible-draft',
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'Creating the first batch of files.' },
        { type: 'text', text: '斌哥，我来生成所有这些类型的测试文件。' },
      ],
      timestamp: (Date.now() + 1000) / 1000,
    };

    window.localStorage.setItem(`clawx:chat-session-view:v1:${sessionKey}`, JSON.stringify({
      savedAt: Date.now(),
      snapshot: {
        messages: [userMessage, assistantDraft],
        loading: false,
        error: null,
        sessionNotice: null,
        sending: true,
        activeRunId: 'run-visible',
        streamingText: '',
        streamingMessage: null,
        streamingTools: [],
        sendStage: 'running',
        pendingFinal: false,
        lastUserMessageAt: Date.now(),
        pendingToolImages: [],
        thinkingLevel: null,
      },
    }));

    gatewayRpcMock.mockReset();
    gatewayRpcMock.mockImplementation((method: string) => {
      if (method === 'chat.history') {
        return Promise.resolve({
          messages: [userMessage],
        });
      }
      if (method === 'sessions.list') return Promise.resolve({ sessions: [] });
      throw new Error(`Unexpected gateway RPC: ${method}`);
    });

    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: sessionKey,
      currentAgentId: 'main',
      sessions: [{ key: sessionKey }],
      messages: [],
      sending: false,
      activeRunId: null,
      streamingText: '',
      streamingMessage: null,
      streamingTools: [],
      pendingFinal: false,
      lastUserMessageAt: null,
      pendingToolImages: [],
      sendStage: null,
      error: null,
      loading: false,
      thinkingLevel: null,
      showThinking: true,
    });

    await useChatStore.getState().loadHistory(true);

    const next = useChatStore.getState();
    expect(next.messages.map((message) => message.id)).toEqual(['user-visible', 'assistant-visible-draft']);
    expect(next.sending).toBe(true);
    expect(next.pendingFinal).toBe(true);
    expect(next.sendStage).toBe('running');
  });

  it('restores visible streaming text from local storage after refresh while history is behind', async () => {
    vi.setSystemTime(new Date('2026-04-25T02:49:00.000Z'));
    const sessionKey = 'agent:main:main';
    const persistedSessionKey = 'agent:main:session-live';
    const userMessage = {
      id: 'user-visible-stream',
      role: 'user',
      content: 'Find flights',
      timestamp: Date.now() / 1000,
    };
    const streamingText = 'Opening the travel site and checking tomorrow flights now.';

    window.localStorage.setItem(`clawx:chat-session-view:v1:${persistedSessionKey}`, JSON.stringify({
      savedAt: Date.now(),
      snapshot: {
        messages: [userMessage],
        loading: false,
        error: null,
        sessionNotice: null,
        sending: true,
        activeRunId: 'run-visible-stream',
        streamingText,
        streamingMessage: null,
        streamingTools: [],
        sendStage: 'running',
        pendingFinal: false,
        lastUserMessageAt: Date.now(),
        pendingToolImages: [],
        thinkingLevel: null,
      },
    }));

    gatewayRpcMock.mockReset();
    gatewayRpcMock.mockImplementation((method: string) => {
      if (method === 'chat.history') {
        return Promise.resolve({
          messages: [userMessage],
        });
      }
      if (method === 'sessions.list') return Promise.resolve({ sessions: [] });
      throw new Error(`Unexpected gateway RPC: ${method}`);
    });

    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: sessionKey,
      currentAgentId: 'main',
      sessions: [{ key: sessionKey }],
      messages: [],
      sending: false,
      activeRunId: null,
      streamingText: '',
      streamingMessage: null,
      streamingTools: [],
      pendingFinal: false,
      lastUserMessageAt: null,
      pendingToolImages: [],
      sendStage: null,
      error: null,
      loading: false,
      thinkingLevel: null,
      showThinking: true,
    });

    await useChatStore.getState().loadHistory(true);

    const next = useChatStore.getState();
    expect(next.messages.map((message) => message.content)).toEqual(['Find flights', streamingText]);
    expect(next.sending).toBe(true);
    expect(next.pendingFinal).toBe(true);
    expect(next.sendStage).toBe('running');
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

  it('surfaces a localized notice when history shows a partial assistant reply that ended with auth failure', async () => {
    gatewayRpcMock.mockReset();
    gatewayRpcMock.mockImplementation((method: string) => {
      if (method === 'chat.history') {
        return Promise.resolve({
          messages: [
            { id: 'user-1', role: 'user', content: 'Question', timestamp: userTimestampSeconds },
            {
              id: 'assistant-partial-auth',
              role: 'assistant',
              content: 'Here is the partial answer before the provider failed.',
              timestamp: assistantTimestampSeconds,
              stopReason: 'error',
              errorMessage: 'HTTP 401: Invalid Authentication',
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
      activeRunId: 'run-auth-error',
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
      'assistant-partial-auth',
    ]);
    expect(next.sending).toBe(false);
    expect(next.activeRunId).toBeNull();
    expect(next.pendingFinal).toBe(false);
    expect(next.sendStage).toBeNull();
    expect(next.sessionRunningState).toEqual({});
    expect(next.error).toMatch(/Authentication failed|鉴权失败/);
  });

  it('keeps an auth failure visible when completion lands before the history refresh', async () => {
    gatewayRpcMock.mockReset();
    gatewayRpcMock.mockImplementation((method: string) => {
      if (method === 'chat.history') {
        return Promise.resolve({
          messages: [
            { id: 'user-1', role: 'user', content: 'Question', timestamp: userTimestampSeconds },
            {
              id: 'assistant-settled-auth',
              role: 'assistant',
              content: 'Partial answer from the provider before it stopped.',
              timestamp: assistantTimestampSeconds,
              stopReason: 'error',
              errorMessage: 'HTTP 401: Invalid Authentication',
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
      activeRunId: null,
      streamingText: '',
      streamingMessage: {
        id: 'assistant-streaming',
        role: 'assistant',
        content: 'Partial answer from the provider before it stopped.',
        timestamp: assistantTimestampSeconds,
      },
      streamingTools: [],
      pendingFinal: false,
      lastUserMessageAt: userTimestampMs,
      pendingToolImages: [],
      error: null,
      loading: false,
      thinkingLevel: null,
      showThinking: true,
      sendStage: null,
    });

    await useChatStore.getState().loadHistory(true);

    const next = useChatStore.getState();
    expect(next.streamingMessage).toBeNull();
    expect(next.pendingToolImages).toEqual([]);
    expect(next.error).toMatch(/Authentication failed|鉴权失败/);
  });

  it('clears a stale no-response notice when history later settles the latest user turn', async () => {
    gatewayRpcMock.mockReset();
    gatewayRpcMock.mockImplementation((method: string) => {
      if (method === 'chat.history') {
        return Promise.resolve({
          messages: [
            {
              id: 'user-prev',
              role: 'user',
              content: 'Earlier question',
              timestamp: userTimestampSeconds - 10,
            },
            {
              id: 'assistant-prev',
              role: 'assistant',
              content: 'Earlier answer',
              timestamp: userTimestampSeconds - 9,
            },
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
        {
          id: 'user-prev',
          role: 'user',
          content: 'Earlier question',
          timestamp: userTimestampSeconds - 10,
        },
        {
          id: 'assistant-prev',
          role: 'assistant',
          content: 'Earlier answer',
          timestamp: userTimestampSeconds - 9,
        },
        { id: 'user-1', role: 'user', content: 'Question', timestamp: userTimestampSeconds },
      ],
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
      error: 'Localized no response',
      loading: false,
      thinkingLevel: null,
      showThinking: true,
      sendStage: null,
    });

    await useChatStore.getState().loadHistory(true);

    const next = useChatStore.getState();
    expect(next.messages.map((message) => message.id)).toEqual([
      'user-prev',
      'assistant-prev',
      'user-1',
      'assistant-final',
    ]);
    expect(next.error).toBeNull();
    expect(next.activeRunId).toBeNull();
    expect(next.sendStage).toBeNull();
  });

  it('keeps a no-response notice when history only has an earlier assistant reply', async () => {
    gatewayRpcMock.mockReset();
    gatewayRpcMock.mockImplementation((method: string) => {
      if (method === 'chat.history') {
        return Promise.resolve({
          messages: [
            {
              id: 'user-prev',
              role: 'user',
              content: 'Earlier question',
              timestamp: userTimestampSeconds - 10,
            },
            {
              id: 'assistant-prev',
              role: 'assistant',
              content: 'Earlier answer',
              timestamp: userTimestampSeconds - 9,
            },
            { id: 'user-1', role: 'user', content: 'Question', timestamp: userTimestampSeconds },
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
          id: 'user-prev',
          role: 'user',
          content: 'Earlier question',
          timestamp: userTimestampSeconds - 10,
        },
        {
          id: 'assistant-prev',
          role: 'assistant',
          content: 'Earlier answer',
          timestamp: userTimestampSeconds - 9,
        },
        { id: 'user-1', role: 'user', content: 'Question', timestamp: userTimestampSeconds },
      ],
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
      error: 'Localized no response',
      loading: false,
      thinkingLevel: null,
      showThinking: true,
      sendStage: null,
    });

    await useChatStore.getState().loadHistory(true);

    const next = useChatStore.getState();
    expect(next.messages.map((message) => message.id)).toEqual([
      'user-prev',
      'assistant-prev',
      'user-1',
    ]);
    expect(next.error).toBe('Localized no response');
  });

  it('keeps polling history after the safety timeout so a late final reply still appears', async () => {
    let historySettled = false;

    gatewayRpcMock.mockReset();
    gatewayRpcMock.mockImplementation((method: string) => {
      if (method === 'chat.history') {
        return Promise.resolve({
          messages: historySettled
            ? [
                { id: 'user-1', role: 'user', content: 'Question', timestamp: userTimestampSeconds },
                {
                  id: 'assistant-final',
                  role: 'assistant',
                  content: 'Final answer from history',
                  timestamp: assistantTimestampSeconds,
                },
              ]
            : [
                { id: 'user-1', role: 'user', content: 'Question', timestamp: userTimestampSeconds },
              ],
        });
      }
      if (method === 'sessions.list') return Promise.resolve({ sessions: [] });
      if (method === 'chat.send') return new Promise(() => undefined);
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

    setTimeout(() => {
      historySettled = true;
    }, 92_000);

    void useChatStore.getState().sendMessage('Question');

    await vi.advanceTimersByTimeAsync(91_000);
    await Promise.resolve();

    const duringRecovery = useChatStore.getState();
    expect(duringRecovery.error).toBeNull();
    expect(duringRecovery.sessionNotice).toMatchObject({
      tone: 'info',
    });
    expect(duringRecovery.sessionNotice?.message).toMatch(/sync|同步/i);

    await vi.advanceTimersByTimeAsync(5_000);
    await Promise.resolve();

    const next = useChatStore.getState();
    expect(next.messages.map((message) => message.id)).toEqual([
      expect.any(String),
      'assistant-final',
    ]);
    expect(next.error).toBeNull();
    expect(next.sessionNotice).toBeNull();
    expect(next.sending).toBe(false);
    expect(next.activeRunId).toBeNull();
    expect(next.sendStage).toBeNull();
  });

  it('shows a warning notice instead of an error when the final reply still never arrives', async () => {
    gatewayRpcMock.mockReset();
    gatewayRpcMock.mockImplementation((method: string) => {
      if (method === 'chat.history') {
        return Promise.resolve({
          messages: [
            { id: 'user-1', role: 'user', content: 'Question', timestamp: userTimestampSeconds },
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
      activeRunId: 'run-missing-final',
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

    useChatStore.getState().handleChatEvent({
      state: 'final',
      runId: 'run-missing-final',
      sessionKey: 'agent:main:main',
    });

    await vi.advanceTimersByTimeAsync(8_500);
    await Promise.resolve();

    const next = useChatStore.getState();
    expect(next.error).toBeNull();
    expect(next.sessionNotice).toMatchObject({
      tone: 'warning',
    });
    expect(next.sessionNotice?.message).toMatch(/final reply|最终回复/i);
    expect(next.sending).toBe(false);
    expect(next.pendingFinal).toBe(false);
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

  it('does not keep temporary assistant snapshots once cumulative stream text contains them', async () => {
    const { useChatStore } = await import('@/stores/chat');
    const intro = 'I will research the chip market now.';
    const update = 'I found the first market figures.';
    const finalizing = 'I am adding sources to the final answer.';
    const cumulativeText = [intro, '', update, '', finalizing].join('\n');

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
      activeRunId: 'run-cumulative-stream',
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

    useChatStore.getState().handleChatEvent({
      state: 'delta',
      runId: 'run-cumulative-stream',
      sessionKey: 'agent:main:main',
      seq: 1,
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: intro }],
        timestamp: assistantTimestampSeconds,
      },
    });
    await vi.advanceTimersByTimeAsync(60);

    useChatStore.getState().handleChatEvent({
      state: 'delta',
      runId: 'run-cumulative-stream',
      sessionKey: 'agent:main:main',
      seq: 2,
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: update }],
        timestamp: assistantTimestampSeconds + 1,
      },
    });
    await vi.advanceTimersByTimeAsync(60);

    expect(useChatStore.getState().messages.map((message) => message.id)).toEqual([
      'user-1',
      'stream-delta-snapshot-1',
    ]);

    useChatStore.getState().handleChatEvent({
      state: 'delta',
      runId: 'run-cumulative-stream',
      sessionKey: 'agent:main:main',
      seq: 3,
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: cumulativeText }],
        timestamp: assistantTimestampSeconds + 2,
      },
    });
    await vi.advanceTimersByTimeAsync(60);

    const next = useChatStore.getState();
    expect(next.messages.map((message) => message.id)).toEqual(['user-1']);
    expect(next.streamingMessage).toMatchObject({
      role: 'assistant',
      content: [{ type: 'text', text: cumulativeText }],
    });
  });

  it('does not append a final event that only differs from history by assistant whitespace', async () => {
    const { useChatStore } = await import('@/stores/chat');
    const persistedReply = [
      { type: 'text', text: 'The deployment finished successfully: build →' },
      { type: 'text', text: ' **release**, checksum A B C 123.' },
    ];

    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessions: [{ key: 'agent:main:main' }],
      messages: [
        { id: 'user-1', role: 'user', content: 'Summarize deployment status.', timestamp: userTimestampSeconds },
        {
          id: 'assistant-history',
          role: 'assistant',
          content: persistedReply,
          timestamp: assistantTimestampSeconds,
        },
      ],
      sessionLabels: {},
      sessionLastActivity: {},
      sessionRunningState: { 'agent:main:main': true },
      sending: true,
      activeRunId: 'run-final-duplicate',
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

    useChatStore.getState().handleChatEvent({
      state: 'final',
      runId: 'run-final-duplicate',
      sessionKey: 'agent:main:main',
      message: {
        id: 'assistant-live-final',
        role: 'assistant',
        content: 'The deployment finished successfully: build → release, checksum ABC123.',
        timestamp: assistantTimestampSeconds + 1,
      },
    });

    const next = useChatStore.getState();
    expect(next.messages.map((message) => message.id)).toEqual(['user-1', 'assistant-history']);
    expect(next.sending).toBe(false);
    expect(next.activeRunId).toBeNull();
    expect(next.streamingMessage).toBeNull();
  });

  it('dedupes assistant messages that already exist in loaded history with only whitespace differences', async () => {
    hostApiFetchMock.mockReset();
    hostApiFetchMock.mockImplementation((path: string) => {
      if (path === '/api/sessions/history') {
        return Promise.resolve({
          success: true,
          resolved: true,
          messages: [
            { id: 'user-1', role: 'user', content: 'Summarize deployment status.', timestamp: userTimestampSeconds },
            {
              id: 'assistant-history',
              role: 'assistant',
              content: [
                { type: 'text', text: 'The deployment finished successfully: build →' },
                { type: 'text', text: ' **release**, checksum A B C 123.' },
              ],
              timestamp: assistantTimestampSeconds,
            },
            {
              id: 'assistant-live-final',
              role: 'assistant',
              content: 'The deployment finished successfully: build → release, checksum ABC123.',
              timestamp: assistantTimestampSeconds + 1,
            },
          ],
        });
      }
      return Promise.resolve({ success: true });
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

    await useChatStore.getState().loadHistory();

    const next = useChatStore.getState();
    expect(next.messages.map((message) => message.id)).toEqual(['user-1', 'assistant-history']);
  });

  it('collapses a shorter assistant reply when a later same-turn reply contains it with a status prefix', async () => {
    const shortReply = [
      '✅ PT 已生成!',
      '',
      '沁哥，给你做了份中国算力市场深度分析PPT，乔布斯风极简科技感：',
      '',
      '内容涵盖：',
      '市场规模：280 EFLOPS 总算力，2 万亿核心产业',
      'AI 算力：年增 50%+，智能算力占比 40%',
    ].join('\n');
    const expandedReply = [
      'Tavily 搜索限额用完了。沁哥，我基于现有知识为您整理算力市场分析并生成 PPT。',
      '',
      shortReply,
    ].join('\n');

    hostApiFetchMock.mockReset();
    hostApiFetchMock.mockImplementation((path: string) => {
      if (path === '/api/sessions/history') {
        return Promise.resolve({
          success: true,
          resolved: true,
          messages: [
            { id: 'user-1', role: 'user', content: '查一下算力市场，然后整合一下，生成一个PPT给我', timestamp: userTimestampSeconds },
            {
              id: 'assistant-short',
              role: 'assistant',
              content: shortReply,
              timestamp: assistantTimestampSeconds,
              _attachedFiles: [
                {
                  fileName: '算力市场分析 PPT.html',
                  mimeType: 'text/html',
                  fileSize: 1024,
                  preview: null,
                  filePath: 'C:\\Users\\Administrator\\.openclaw\\workspace\\算力市场分析 PPT.html',
                },
              ],
            },
            {
              id: 'assistant-expanded',
              role: 'assistant',
              content: expandedReply,
              timestamp: assistantTimestampSeconds + 1,
            },
          ],
        });
      }
      return Promise.resolve({ success: true });
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

    await useChatStore.getState().loadHistory();

    const next = useChatStore.getState();
    expect(next.messages.map((message) => message.id)).toEqual(['user-1', 'assistant-expanded']);
    expect(next.messages[1]?.content).toBe(expandedReply);
    expect(next.messages[1]?._attachedFiles?.[0]?.fileName).toBe('算力市场分析 PPT.html');
  });

  it('flushes live assistant deltas on the next animation frame', async () => {
    const rafCallbacks: FrameRequestCallback[] = [];
    const requestAnimationFrameMock = vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    });
    const cancelAnimationFrameMock = vi.fn();
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrameMock);
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrameMock);

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
      activeRunId: 'run-raf-stream',
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

    useChatStore.getState().handleChatEvent({
      state: 'delta',
      runId: 'run-raf-stream',
      sessionKey: 'agent:main:main',
      seq: 1,
      message: {
        id: 'assistant-stream-raf',
        role: 'assistant',
        content: 'Frame-paced answer',
        timestamp: assistantTimestampSeconds,
      },
    });

    expect(requestAnimationFrameMock).toHaveBeenCalledTimes(1);
    expect(useChatStore.getState().streamingMessage).toBeNull();

    rafCallbacks.shift()?.(performance.now() + 16);

    expect(useChatStore.getState().streamingMessage).toMatchObject({
      id: 'assistant-stream-raf',
      role: 'assistant',
      content: 'Frame-paced answer',
    });
    expect(cancelAnimationFrameMock).not.toHaveBeenCalled();
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

  it('merges late assistant process deltas into the settled turn before the final reply', async () => {
    const { useChatStore } = await import('@/stores/chat');

    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessions: [{ key: 'agent:main:main' }],
      messages: [
        { id: 'user-1', role: 'user', content: 'Fix the spreadsheet.', timestamp: userTimestampSeconds },
        {
          id: 'assistant-final',
          role: 'assistant',
          content: 'The spreadsheet is fixed now.',
          timestamp: userTimestampSeconds + 20,
          stopReason: 'stop',
        },
      ],
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

    useChatStore.getState().handleChatEvent({
      state: 'delta',
      runId: 'run-settled',
      sessionKey: 'agent:main:main',
      seq: 2,
      message: {
        id: 'assistant-process-late',
        role: 'assistant',
        content: [
          { type: 'text', text: 'I found the formula issue.' },
          { type: 'toolCall', id: 'tool-1', name: 'exec', input: { command: 'inspect workbook' } },
        ],
        timestamp: userTimestampSeconds + 10,
        stopReason: 'toolUse',
      },
    });

    useChatStore.getState().handleChatEvent({
      state: 'delta',
      runId: 'run-settled',
      sessionKey: 'agent:main:main',
      seq: 1,
      message: {
        id: 'assistant-process-earlier',
        role: 'assistant',
        content: [
          { type: 'text', text: 'I am checking the workbook structure.' },
          { type: 'toolCall', id: 'tool-0', name: 'read', input: { path: 'workbook.xlsx' } },
        ],
        timestamp: userTimestampSeconds + 5,
        stopReason: 'toolUse',
      },
    });

    const next = useChatStore.getState();
    expect(next.messages.map((message) => message.id)).toEqual([
      'user-1',
      'assistant-process-earlier',
      'assistant-process-late',
      'assistant-final',
    ]);
    expect(next.sending).toBe(false);
    expect(next.activeRunId).toBeNull();
    expect(next.sendStage).toBeNull();
    expect(next.streamingMessage).toBeNull();
    expect(next.streamingTools).toEqual([]);
  });

  it('keeps the current active run while merging late process deltas from a previous settled turn', async () => {
    const { useChatStore } = await import('@/stores/chat');
    const newUserTimestamp = userTimestampSeconds + 60;
    const currentStreamingMessage = {
      id: 'assistant-current-stream',
      role: 'assistant',
      content: [{ type: 'text', text: 'Working on the new request.' }],
      timestamp: newUserTimestamp + 1,
    };

    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessions: [{ key: 'agent:main:main' }],
      messages: [
        { id: 'user-previous', role: 'user', content: 'Fix the spreadsheet.', timestamp: userTimestampSeconds },
        {
          id: 'assistant-previous-final',
          role: 'assistant',
          content: 'The spreadsheet is fixed now.',
          timestamp: userTimestampSeconds + 20,
          stopReason: 'stop',
        },
        { id: 'user-current', role: 'user', content: 'Now summarize it.', timestamp: newUserTimestamp },
      ],
      sessionLabels: {},
      sessionLastActivity: {},
      sessionRunningState: { 'agent:main:main': true },
      sending: true,
      activeRunId: 'run-current',
      streamingText: '',
      streamingMessage: currentStreamingMessage,
      streamingTools: [],
      pendingFinal: false,
      lastUserMessageAt: newUserTimestamp * 1000,
      pendingToolImages: [],
      error: null,
      loading: false,
      thinkingLevel: null,
      showThinking: true,
      sendStage: 'running',
    });

    useChatStore.getState().handleChatEvent({
      state: 'delta',
      runId: 'run-previous',
      sessionKey: 'agent:main:main',
      seq: 1,
      message: {
        id: 'assistant-previous-process',
        role: 'assistant',
        content: [
          { type: 'text', text: 'I checked the workbook formulas.' },
          { type: 'toolCall', id: 'tool-prev', name: 'exec', input: { command: 'check formulas' } },
        ],
        timestamp: userTimestampSeconds + 10,
        stopReason: 'toolUse',
      },
    });

    const next = useChatStore.getState();
    expect(next.messages.map((message) => message.id)).toEqual([
      'user-previous',
      'assistant-previous-process',
      'assistant-previous-final',
      'user-current',
    ]);
    expect(next.sending).toBe(true);
    expect(next.activeRunId).toBe('run-current');
    expect(next.sendStage).toBe('running');
    expect(next.streamingMessage).toEqual(currentStreamingMessage);
    expect(next.sessionRunningState).toEqual({ 'agent:main:main': true });
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
    const startupDraftSessionKey = useChatStore.getState().currentSessionKey;
    await useChatStore.getState().sendMessage('现在使用哪个模型？');

    expect(useChatStore.getState().sessionModels['agent:main:main']).toBe('custom-custombc/qwen3.5-plus');
    expect(useChatStore.getState().sessionModels[startupDraftSessionKey]).toBe('custom-custombc/qwen3.5-plus');
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
    expect(useChatStore.getState().currentSessionKey).toMatch(/^agent:main:session-\d+$/);
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
    expect(hostApiFetchMock).toHaveBeenNthCalledWith(1, '/api/sessions/catalog');
    expect(hostApiFetchMock).toHaveBeenNthCalledWith(2, '/api/sessions/previews', {
      method: 'POST',
      body: JSON.stringify({ sessionKeys: ['agent:main:session-preview'] }),
    });
    expect(hostApiFetchMock).toHaveBeenNthCalledWith(3, '/api/sessions/auto-label', {
      method: 'POST',
      body: JSON.stringify({ sessionKey: 'agent:main:session-preview', label: 'Preview from host route' }),
    });
    expect(useChatStore.getState().sessionLabels['agent:main:session-preview']).toBe('Preview from host route');
  });

  it('creates a blank draft session on cold start even when newer history exists', async () => {
    vi.setSystemTime(new Date('2026-04-28T09:30:00.000Z'));
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
    expect(next.currentSessionKey).toBe(`agent:main:session-${Date.now()}`);
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
