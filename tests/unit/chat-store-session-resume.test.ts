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
