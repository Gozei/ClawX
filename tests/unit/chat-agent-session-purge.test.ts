import { beforeEach, describe, expect, it, vi } from 'vitest';

const { agentsState, gatewayRpcMock, hostApiFetchMock } = vi.hoisted(() => ({
  agentsState: {
    agents: [
      { id: 'main', name: 'Main', mainSessionKey: 'agent:main:main' },
      { id: 'role', name: 'Role', mainSessionKey: 'agent:role:main' },
    ] as Array<Record<string, unknown>>,
    defaultAgentId: 'main',
  },
  gatewayRpcMock: vi.fn(),
  hostApiFetchMock: vi.fn(),
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: {
    getState: () => agentsState,
  },
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: {
    getState: () => ({
      rpc: gatewayRpcMock,
    }),
  },
}));

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

describe('chat store purgeAgentSessions', () => {
  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
    gatewayRpcMock.mockReset();
    hostApiFetchMock.mockReset();
    hostApiFetchMock.mockResolvedValue({ success: true });
    agentsState.defaultAgentId = 'main';
    agentsState.agents = [
      { id: 'main', name: 'Main', mainSessionKey: 'agent:main:main' },
      { id: 'role', name: 'Role', mainSessionKey: 'agent:role:main' },
    ];
  });

  it('removes deleted-agent sessions from the sidebar state and falls back to the default main session', async () => {
    const { useChatStore } = await import('@/stores/chat');

    useChatStore.setState({
      sessions: [
        { key: 'agent:role:main' },
        { key: 'agent:role:session-1' },
        { key: 'agent:main:main' },
      ],
      currentSessionKey: 'agent:role:session-1',
      currentAgentId: 'role',
      messages: [{ role: 'assistant', content: 'role history' }],
      sessionModels: {
        'agent:role:main': 'custom/role',
        'agent:main:main': 'custom/main',
      },
      composerDrafts: {
        'agent:role:session-1': { text: 'draft', attachments: [], targetAgentId: 'role' },
      },
      sessionLabels: {
        'agent:role:session-1': 'Role chat',
        'agent:main:main': 'Main chat',
      },
      sessionLastActivity: {
        'agent:role:session-1': 123,
        'agent:main:main': 456,
      },
      sessionRunningState: {
        'agent:role:session-1': true,
        'agent:main:main': false,
      },
      queuedMessages: {
        'agent:role:session-1': [{
          id: 'queued-1',
          text: 'queued',
          sessionKey: 'agent:role:session-1',
          queuedAt: 1,
        }],
      },
      streamingText: 'streaming',
      streamingMessage: { role: 'assistant', content: 'streaming' },
      streamingTools: [{ name: 'tool', status: 'running', updatedAt: 1 }],
      activeRunId: 'run-1',
      pendingFinal: true,
      lastUserMessageAt: 1,
      pendingToolImages: [{ fileName: 'x.png', mimeType: 'image/png', fileSize: 1, preview: null }],
      sessionNotice: { message: 'notice', tone: 'info' },
      error: 'error',
      sendStage: 'running',
    });

    useChatStore.getState().purgeAgentSessions('role');

    const next = useChatStore.getState();
    expect(next.sessions.map((session) => session.key)).toEqual(['agent:main:main']);
    expect(next.currentSessionKey).toBe('agent:main:main');
    expect(next.currentAgentId).toBe('main');
    expect(next.messages).toEqual([]);
    expect(next.streamingText).toBe('');
    expect(next.activeRunId).toBeNull();
    expect(next.pendingFinal).toBe(false);
    expect(next.sessionModels).toEqual({ 'agent:main:main': 'custom/main' });
    expect(next.composerDrafts).toEqual({});
    expect(next.sessionLabels).toEqual({ 'agent:main:main': 'Main chat' });
    expect(next.sessionLastActivity).toEqual({ 'agent:main:main': 456 });
    expect(next.queuedMessages).toEqual({});
  });
});
