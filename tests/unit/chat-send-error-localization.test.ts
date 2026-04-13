import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { gatewayRpcMock, hostApiFetchMock } = vi.hoisted(() => ({
  gatewayRpcMock: vi.fn(),
  hostApiFetchMock: vi.fn(),
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
    getState: () => ({
      agents: [],
    }),
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
});
