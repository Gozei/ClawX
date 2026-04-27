import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { gatewayRpcMock, hostApiFetchMock, agentsStoreState } = vi.hoisted(() => ({
  gatewayRpcMock: vi.fn(),
  hostApiFetchMock: vi.fn(),
  agentsStoreState: {
    agents: [] as Array<Record<string, unknown>>,
    defaultModelRef: '',
    fetchAgents: vi.fn(),
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
    getState: () => agentsStoreState,
  },
}));

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

describe('chat send error localization', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-13T10:00:00Z'));
    window.localStorage.clear();
    gatewayRpcMock.mockReset();
    hostApiFetchMock.mockReset();
    agentsStoreState.agents = [];
    agentsStoreState.defaultModelRef = '';
    agentsStoreState.fetchAgents = vi.fn();
    hostApiFetchMock.mockResolvedValue({ success: true, result: { runId: 'run-media' } });

    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'chat.history') {
        return { messages: [] };
      }
      if (method === 'sessions.list') {
        return { sessions: [] };
      }
      if (method === 'chat.abort') {
        return { ok: true };
      }
      if (method === 'chat.send') {
        throw new Error('Error: Gateway not connected');
      }
      throw new Error(`Unexpected gateway RPC: ${method}`);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('appends an English assistant error reply for send failures', async () => {
    const { default: i18n } = await import('@/i18n');
    const { useChatStore } = await import('@/stores/chat');
    await i18n.changeLanguage('en');

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
      sendStage: null,
      pendingFinal: false,
      lastUserMessageAt: null,
      pendingToolImages: [],
      error: null,
      loading: false,
      thinkingLevel: null,
      showThinking: true,
    });

    await useChatStore.getState().sendMessage('hello');

    expect(useChatStore.getState().error).toBeNull();
    expect(useChatStore.getState().messages.at(-1)).toMatchObject({
      role: 'assistant',
      isError: true,
      content: 'Failed to send message: Gateway not connected.',
    });
  });

  it('localizes pairing-required gateway failures as a restartable gateway error', async () => {
    const { default: i18n } = await import('@/i18n');
    const { useChatStore } = await import('@/stores/chat');
    await i18n.changeLanguage('en');

    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'chat.history') {
        return { messages: [] };
      }
      if (method === 'sessions.list') {
        return { sessions: [] };
      }
      if (method === 'chat.abort') {
        return { ok: true };
      }
      if (method === 'chat.send') {
        throw new Error('gateway closed (1008): pairing required');
      }
      throw new Error(`Unexpected gateway RPC: ${method}`);
    });

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
      sendStage: null,
      pendingFinal: false,
      lastUserMessageAt: null,
      pendingToolImages: [],
      error: null,
      loading: false,
      thinkingLevel: null,
      showThinking: true,
    });

    await useChatStore.getState().sendMessage('hello again');

    expect(useChatStore.getState().error).toBeNull();
    expect(useChatStore.getState().messages.at(-1)).toMatchObject({
      role: 'assistant',
      isError: true,
      content: 'Failed to send message: Gateway error. Please restart the gateway and try again.',
    });
  });

  it('appends a Chinese assistant error reply for send failures', async () => {
    const { default: i18n } = await import('@/i18n');
    const { useChatStore } = await import('@/stores/chat');
    await i18n.changeLanguage('zh');

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
      sendStage: null,
      pendingFinal: false,
      lastUserMessageAt: null,
      pendingToolImages: [],
      error: null,
      loading: false,
      thinkingLevel: null,
      showThinking: true,
    });

    await useChatStore.getState().sendMessage('你好');

    expect(useChatStore.getState().error).toBeNull();
    expect(useChatStore.getState().messages.at(-1)).toMatchObject({
      role: 'assistant',
      isError: true,
      content: '消息发送失败：网关未连接。',
    });
  });

  it('uses a Chinese localized safety-timeout error in the session notice bar', async () => {
    const { default: i18n } = await import('@/i18n');
    const { useChatStore } = await import('@/stores/chat');
    await i18n.changeLanguage('zh');

    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'chat.history') {
        return { messages: [] };
      }
      if (method === 'sessions.list') {
        return { sessions: [] };
      }
      if (method === 'chat.abort') {
        return { ok: true };
      }
      if (method === 'chat.send') {
        return await new Promise(() => undefined);
      }
      throw new Error(`Unexpected gateway RPC: ${method}`);
    });

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
      sendStage: null,
      pendingFinal: false,
      lastUserMessageAt: null,
      pendingToolImages: [],
      error: null,
      loading: false,
      thinkingLevel: null,
      showThinking: true,
    });

    void useChatStore.getState().sendMessage('在线吗');

    await vi.advanceTimersByTimeAsync(95_000);
    await Promise.resolve();

    expect(useChatStore.getState().error).toBeNull();
    expect(useChatStore.getState().sessionNotice).toMatchObject({
      tone: 'info',
      message: '回复耗时较长，仍在同步结果...',
    });
  });

  it('keeps polling when the Gateway WebSocket chat.send ack times out', async () => {
    const { default: i18n } = await import('@/i18n');
    const { useChatStore } = await import('@/stores/chat');
    await i18n.changeLanguage('en');

    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'chat.history') {
        return { messages: [] };
      }
      if (method === 'sessions.list') {
        return { sessions: [] };
      }
      if (method === 'chat.abort') {
        return { ok: true };
      }
      if (method === 'chat.send') {
        throw new Error('Gateway WS timeout: chat.send');
      }
      throw new Error(`Unexpected gateway RPC: ${method}`);
    });

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
      sendStage: null,
      pendingFinal: false,
      lastUserMessageAt: null,
      pendingToolImages: [],
      error: null,
      loading: false,
      thinkingLevel: null,
      showThinking: true,
    });

    await useChatStore.getState().sendMessage('hello');

    const state = useChatStore.getState();
    expect(state.error).toBeNull();
    expect(state.sending).toBe(true);
    expect(state.sendStage).toBe('awaiting_runtime');
    expect(state.sessionNotice).toMatchObject({
      tone: 'info',
      message: 'The reply is taking longer than usual. Still syncing the result...',
    });
    expect(state.messages.at(-1)).toMatchObject({
      role: 'user',
      content: 'hello',
    });
  });

  it('does not crash when fetchAgents is missing from the agents store', async () => {
    const { default: i18n } = await import('@/i18n');
    const { useChatStore } = await import('@/stores/chat');
    await i18n.changeLanguage('en');
    agentsStoreState.fetchAgents = undefined as unknown as typeof agentsStoreState.fetchAgents;

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
      sendStage: null,
      pendingFinal: false,
      lastUserMessageAt: null,
      pendingToolImages: [],
      error: null,
      loading: false,
      thinkingLevel: null,
      showThinking: true,
    });

    await expect(useChatStore.getState().sendMessage('hello')).resolves.toBeUndefined();
    expect(useChatStore.getState().messages.at(-1)).toMatchObject({
      role: 'assistant',
      isError: true,
      content: 'Failed to send message: Gateway not connected.',
    });
  });
});
