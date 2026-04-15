import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { gatewayRpcMock, hostApiFetchMock, agentsState } = vi.hoisted(() => ({
  gatewayRpcMock: vi.fn(),
  hostApiFetchMock: vi.fn(),
  agentsState: {
    agents: [] as Array<Record<string, unknown>>,
    defaultModelRef: 'custom-custombc/gpt-5.4' as string | null,
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
    getState: () => agentsState,
  },
}));

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

describe('chat target routing', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-11T12:00:00Z'));
    window.localStorage.clear();

    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'MiniMax',
        inheritedModel: true,
        workspace: '~/.openclaw/workspace',
        agentDir: '~/.openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:main',
        channelTypes: [],
        skillIds: [],
        workflowSteps: [],
        triggerModes: [],
        description: null,
      },
      {
        id: 'research',
        name: 'Research',
        isDefault: false,
        modelDisplay: 'Claude',
        inheritedModel: false,
        workspace: '~/.openclaw/workspace-research',
        agentDir: '~/.openclaw/agents/research/agent',
        mainSessionKey: 'agent:research:desk',
        channelTypes: [],
        modelRef: 'claude/sonnet',
        profileType: 'coordinator',
        skillIds: ['web-search', 'doc-reader'],
        workflowSteps: ['检索资料', '总结输出'],
        workflowNodes: [
          { id: 'step-1', type: 'skill', title: '检索资料', target: 'web-search', onFailure: 'continue', inputSpec: 'topic', outputSpec: 'sources' },
          { id: 'step-2', type: 'agent', title: '交给摘要智能体', target: 'summarizer', onFailure: 'continue', inputSpec: 'sources', outputSpec: 'draft' },
          { id: 'step-3', type: 'model', title: '总结输出', target: 'claude/sonnet', onFailure: 'retry', modelRef: 'claude/sonnet' },
        ],
        triggerModes: ['manual', 'channel'],
        description: '负责研究分析与资料整理',
        objective: '协调多步骤研究流程并输出最终结论',
        boundaries: '证据不足时必须说明不确定性',
        outputContract: '输出结论、证据、风险和后续建议',
      },
    ];
    agentsState.defaultModelRef = 'custom-custombc/gpt-5.4';
    agentsState.fetchAgents.mockReset();

    gatewayRpcMock.mockReset();
    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'chat.history') {
        return { messages: [] };
      }
      if (method === 'chat.send') {
        return { runId: 'run-text' };
      }
      if (method === 'chat.abort') {
        return { ok: true };
      }
      if (method === 'sessions.list') {
        return { sessions: [] };
      }
      throw new Error(`Unexpected gateway RPC: ${method}`);
    });

    hostApiFetchMock.mockReset();
    hostApiFetchMock.mockResolvedValue({ success: true, result: { runId: 'run-media' } });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('switches to the selected agent main session before sending text', async () => {
    const { useChatStore } = await import('@/stores/chat');

    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessions: [{ key: 'agent:main:main' }],
      messages: [{ role: 'assistant', content: 'Existing main history' }],
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

    await useChatStore.getState().sendMessage('Hello direct agent', undefined, 'research');
    await Promise.resolve();
    await Promise.resolve();

    const state = useChatStore.getState();
    expect(state.currentSessionKey).toBe('agent:research:desk');
    expect(state.currentAgentId).toBe('research');
    expect(state.sessions.some((session) => session.key === 'agent:research:desk')).toBe(true);
    expect(String(state.messages.at(-1)?.content)).toBe('Hello direct agent');
    expect(state.sessionLabels['agent:research:desk']).toBe('Hello direct agent');
    expect(state.sessions.find((session) => session.key === 'agent:research:desk')?.label).toBe('Hello direct agent');

    const historyCall = gatewayRpcMock.mock.calls.find(([method]) => method === 'chat.history');
    expect(historyCall?.[1]).toEqual({ sessionKey: 'agent:research:desk', limit: 200 });

    const autoLabelCall = hostApiFetchMock.mock.calls.find(([path]) => path === '/api/sessions/auto-label');
    expect(autoLabelCall?.[1]).toEqual({
      method: 'POST',
      body: JSON.stringify({ sessionKey: 'agent:research:desk', label: 'Hello direct agent' }),
    });

    const sendCall = gatewayRpcMock.mock.calls.find(([method]) => method === 'chat.send');
    expect(sendCall?.[1]).toMatchObject({
      sessionKey: 'agent:research:desk',
      deliver: false,
    });
    expect(String((sendCall?.[1] as { message?: unknown })?.message)).toContain('Conversation info (untrusted metadata):');
    expect(String((sendCall?.[1] as { message?: unknown })?.message)).toContain('"description": "负责研究分析与资料整理"');
    expect(String((sendCall?.[1] as { message?: unknown })?.message)).toContain('"profileType": "coordinator"');
    expect(String((sendCall?.[1] as { message?: unknown })?.message)).toContain('"objective": "协调多步骤研究流程并输出最终结论"');
    expect(String((sendCall?.[1] as { message?: unknown })?.message)).toContain('"inputSpec": "topic"');
    expect(String((sendCall?.[1] as { message?: unknown })?.message)).toContain('"target": "summarizer"');
    expect(String((sendCall?.[1] as { message?: unknown })?.message)).toContain('"executionPlan"');
    expect(String((sendCall?.[1] as { message?: unknown })?.message)).toContain('"downstreamAgents": [');
    expect(String((sendCall?.[1] as { message?: unknown })?.message)).toContain('"playbook": [');
    expect(String((sendCall?.[1] as { message?: unknown })?.message)).toContain('Execution playbook:');
    expect(String((sendCall?.[1] as { message?: unknown })?.message)).toContain('智能体类型：coordinator。');
    expect(String((sendCall?.[1] as { message?: unknown })?.message)).toContain('委派给智能体 "summarizer"');
    expect(String((sendCall?.[1] as { message?: unknown })?.message)).toContain('Hello direct agent');
    expect(typeof (sendCall?.[1] as { idempotencyKey?: unknown })?.idempotencyKey).toBe('string');
  });

  it('uses the selected agent main session for attachment sends', async () => {
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

    await useChatStore.getState().sendMessage(
      '',
      [
        {
          fileName: 'design.png',
          mimeType: 'image/png',
          fileSize: 128,
          stagedPath: '/tmp/design.png',
          preview: 'data:image/png;base64,abc',
        },
      ],
      'research',
    );

    expect(useChatStore.getState().currentSessionKey).toBe('agent:research:desk');

    expect(hostApiFetchMock).toHaveBeenCalledWith(
      '/api/chat/send-with-media',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(String),
      }),
    );

    const mediaCall = hostApiFetchMock.mock.calls.find(([path]) => path === '/api/chat/send-with-media');
    const payload = JSON.parse(
      ((mediaCall?.[1] as { body: string } | undefined)?.body ?? '{}'),
    ) as {
      sessionKey: string;
      message: string;
      media: Array<{ filePath: string }>;
    };

    expect(payload.sessionKey).toBe('agent:research:desk');
    expect(payload.message).toContain('Conversation info (untrusted metadata):');
    expect(payload.message).toContain('Process the attached file(s).');
    expect(payload.media[0]?.filePath).toBe('/tmp/design.png');
  });

  it('injects the current session model metadata for a default main-session send', async () => {
    const { useChatStore } = await import('@/stores/chat');

    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessions: [{ key: 'agent:main:main' }],
      sessionModels: { 'agent:main:main': 'custom-custombc/gpt-5.4' },
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

    await useChatStore.getState().sendMessage('你现在是什么模型');

    const sendCall = gatewayRpcMock.mock.calls.find(([method]) => method === 'chat.send');
    const sendMessagePayload = String((sendCall?.[1] as { message?: unknown })?.message);
    expect(sendMessagePayload).toContain('Conversation info (untrusted metadata):');
    expect(sendMessagePayload).toContain('"preferredModel": "custom-custombc/gpt-5.4"');
    expect(sendMessagePayload).toContain('你现在是什么模型');
  });
  it('syncs the selected session model to runtime before sending', async () => {
    const { useChatStore } = await import('@/stores/chat');

    agentsState.defaultModelRef = 'custom-custombc/glm-5';
    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'GLM-5',
        modelRef: 'custom-custombc/glm-5',
        overrideModelRef: 'custom-custombc/glm-5',
        inheritedModel: false,
        workspace: '~/.openclaw/workspace',
        agentDir: '~/.openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:main',
        channelTypes: [],
        skillIds: [],
        workflowSteps: [],
        triggerModes: [],
        description: null,
      },
    ];

    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessions: [{ key: 'agent:main:main', model: 'custom-custombc/qwen3.5-plus' }],
      sessionModels: { 'agent:main:main': 'custom-custombc/qwen3.5-plus' },
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

    await useChatStore.getState().sendMessage('Current runtime model?');

    const runtimeModelCall = hostApiFetchMock.mock.calls.find(([path]) => path === '/api/agents/main/model/runtime');
    expect(runtimeModelCall?.[1]).toEqual({
      method: 'PUT',
      body: JSON.stringify({ modelRef: 'custom-custombc/qwen3.5-plus' }),
    });

    const sendCall = gatewayRpcMock.mock.calls.find(([method]) => method === 'chat.send');
    const sendMessagePayload = String((sendCall?.[1] as { message?: unknown })?.message);
    expect(sendMessagePayload).toContain('"preferredModel": "custom-custombc/qwen3.5-plus"');
    expect(sendMessagePayload).toContain('Current runtime model?');
  });

  it('refreshes agents and falls back to the default model before sending when no session model is stored', async () => {
    const { useChatStore } = await import('@/stores/chat');

    agentsState.defaultModelRef = null;
    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'GLM-5',
        modelRef: 'custom-custombc/glm-5',
        overrideModelRef: 'custom-custombc/glm-5',
        inheritedModel: false,
        workspace: '~/.openclaw/workspace',
        agentDir: '~/.openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:main',
        channelTypes: [],
        skillIds: [],
        workflowSteps: [],
        triggerModes: [],
        description: null,
      },
    ];
    agentsState.fetchAgents.mockImplementation(async () => {
      agentsState.defaultModelRef = 'custom-custombc/gpt-5.4';
      agentsState.agents = agentsState.agents.map((agent) => (
        agent.id === 'main'
          ? {
              ...agent,
              modelDisplay: 'GPT-5.4',
              modelRef: 'custom-custombc/gpt-5.4',
              overrideModelRef: null,
              inheritedModel: true,
            }
          : agent
      ));
    });

    useChatStore.setState({
      currentSessionKey: 'agent:main:session-123',
      currentAgentId: 'main',
      sessions: [],
      sessionModels: {},
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

    await useChatStore.getState().sendMessage('你现在是什么模型');

    expect(agentsState.fetchAgents).toHaveBeenCalledTimes(1);
    expect(useChatStore.getState().sessionModels['agent:main:session-123']).toBe('custom-custombc/gpt-5.4');

    const sendCall = gatewayRpcMock.mock.calls.find(([method]) => method === 'chat.send');
    const sendMessagePayload = String((sendCall?.[1] as { message?: unknown })?.message);
    expect(sendMessagePayload).toContain('"preferredModel": "custom-custombc/gpt-5.4"');
    expect(sendMessagePayload).toContain('你现在是什么模型');
  });
  it('leaves preferredModel empty when neither the session nor the global default has a model', async () => {
    const { useChatStore } = await import('@/stores/chat');

    agentsState.defaultModelRef = null;
    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'GLM-5',
        modelRef: 'custom-custombc/glm-5',
        overrideModelRef: 'custom-custombc/glm-5',
        inheritedModel: false,
        workspace: '~/.openclaw/workspace',
        agentDir: '~/.openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:main',
        channelTypes: [],
        skillIds: [],
        workflowSteps: [],
        triggerModes: [],
        description: null,
      },
    ];
    agentsState.fetchAgents.mockResolvedValue(undefined);

    useChatStore.setState({
      currentSessionKey: 'agent:main:session-empty-model',
      currentAgentId: 'main',
      sessions: [],
      sessionModels: {},
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

    await useChatStore.getState().sendMessage('现在是什么模型');

    expect(agentsState.fetchAgents).toHaveBeenCalledTimes(1);
    expect(useChatStore.getState().sessionModels['agent:main:session-empty-model']).toBeUndefined();

    const sendCall = gatewayRpcMock.mock.calls.find(([method]) => method === 'chat.send');
    const sendMessagePayload = String((sendCall?.[1] as { message?: unknown })?.message);
    expect(sendMessagePayload).not.toContain('"preferredModel":');
    expect(sendMessagePayload).toContain('现在是什么模型');
  }, 15000);
});
