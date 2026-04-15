import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ChatInput } from '@/pages/Chat/ChatInput';

const { agentsState, chatState, gatewayState, providerState, hostApiFetchMock, invokeIpcMock, toastWarningMock, toastSuccessMock, toastErrorMock } = vi.hoisted(() => ({
  agentsState: {
    agents: [] as Array<Record<string, unknown>>,
    defaultModelRef: 'openai/gpt-5.4',
    updateAgentModel: vi.fn(),
    fetchAgents: vi.fn(),
  },
  chatState: {
    currentAgentId: 'main',
    currentSessionKey: 'agent:main:main',
    sessions: [] as Array<Record<string, unknown>>,
    sessionModels: {} as Record<string, string>,
  },
  gatewayState: {
    status: { state: 'running', port: 18789 },
  },
  providerState: {
    accounts: [] as Array<Record<string, unknown>>,
    statuses: [] as Array<Record<string, unknown>>,
    vendors: [] as Array<Record<string, unknown>>,
    defaultAccountId: null as string | null,
    refreshProviderSnapshot: vi.fn(),
    getAccountApiKey: vi.fn(),
  },
  hostApiFetchMock: vi.fn(),
  invokeIpcMock: vi.fn(),
  toastWarningMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: Object.assign(
    (selector: (state: typeof agentsState) => unknown) => selector(agentsState),
    {
      getState: () => agentsState,
    },
  ),
}));

vi.mock('@/stores/chat', () => ({
  useChatStore: Object.assign(
    (selector: (state: typeof chatState) => unknown) => selector(chatState),
    {
      setState: (partial: Partial<typeof chatState> | ((state: typeof chatState) => Partial<typeof chatState>)) => {
        const patch = typeof partial === 'function' ? partial(chatState) : partial;
        Object.assign(chatState, patch);
      },
    },
  ),
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: (selector: (state: typeof gatewayState) => unknown) => selector(gatewayState),
}));

vi.mock('@/stores/providers', () => ({
  useProviderStore: (selector: (state: typeof providerState) => unknown) => selector(providerState),
}));

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

vi.mock('@/lib/api-client', () => ({
  invokeIpc: (...args: unknown[]) => invokeIpcMock(...args),
}));

vi.mock('sonner', () => ({
  toast: {
    warning: (...args: unknown[]) => toastWarningMock(...args),
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

function translate(key: string, vars?: Record<string, unknown>): string {
  switch (key) {
    case 'composer.attachFiles':
      return 'Attach files';
    case 'composer.pickAgent':
      return 'Choose agent';
    case 'composer.clearTarget':
      return 'Clear target agent';
    case 'composer.targetChip':
      return `@${String(vars?.agent ?? '')}`;
    case 'composer.agentPickerTitle':
      return 'Route the next message to another agent';
    case 'composer.selectModel':
      return 'Switch model';
    case 'composer.switchModel':
      return 'Switch model';
    case 'composer.messagePlaceholder':
      return 'Send a message...';
    case 'composer.gatewayDisconnectedPlaceholder':
      return 'Gateway not connected...';
    case 'composer.modelSwitchSuccess':
      return `Switched to ${String(vars?.model ?? '')}`;
    case 'composer.modelSwitchFailed':
      return `Failed to switch model. Still using ${String(vars?.model ?? '')}: ${String(vars?.error ?? '')}`;
    case 'composer.send':
      return 'Send';
    case 'composer.stop':
      return 'Stop';
    case 'composer.gatewayConnected':
      return 'connected';
    case 'composer.gatewayStatus':
      return `gateway ${String(vars?.state ?? '')} | port: ${String(vars?.port ?? '')} ${String(vars?.pid ?? '')}`.trim();
    case 'composer.retryFailedAttachments':
      return 'Retry failed attachments';
    default:
      return key;
  }
}

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: () => {},
  },
  useTranslation: () => ({
    t: translate,
  }),
}));

describe('ChatInput agent targeting', () => {
  beforeEach(() => {
    agentsState.agents = [];
    agentsState.defaultModelRef = 'openai/gpt-5.4';
    agentsState.updateAgentModel.mockReset();
    agentsState.fetchAgents.mockReset();
    chatState.currentAgentId = 'main';
    chatState.currentSessionKey = 'agent:main:main';
    chatState.sessions = [];
    chatState.sessionModels = {};
    gatewayState.status = { state: 'running', port: 18789 };
    providerState.accounts = [];
    providerState.statuses = [];
    providerState.vendors = [];
    providerState.defaultAccountId = null;
    providerState.refreshProviderSnapshot.mockReset();
    providerState.getAccountApiKey.mockReset();
    providerState.getAccountApiKey.mockResolvedValue('sk-test');
    hostApiFetchMock.mockReset();
    invokeIpcMock.mockReset();
    toastWarningMock.mockReset();
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
  });

  it('hides the @agent picker when only one agent is configured', () => {
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
      },
    ];

    render(<ChatInput onSend={vi.fn()} />);

    expect(screen.queryByTitle('Choose agent')).not.toBeInTheDocument();
  });

  it('lets the user select an agent target and sends it with the message', () => {
    const onSend = vi.fn();
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
      },
    ];

    render(<ChatInput onSend={onSend} />);

    fireEvent.click(screen.getByTestId('chat-agent-picker-button'));
    fireEvent.click(screen.getByText('Research'));

    expect(screen.getByText('Research')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Hello direct agent' } });
    fireEvent.click(screen.getByTitle('Send'));

    expect(onSend).toHaveBeenCalledWith('Hello direct agent', undefined, 'research');
  });

  it('shows model options in provider order and validates before updating the current session model', async () => {
    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'GPT-5.4',
        modelRef: 'openai/gpt-5.4',
        overrideModelRef: null,
        inheritedModel: true,
        workspace: '~/.openclaw/workspace',
        agentDir: '~/.openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:main',
        channelTypes: [],
        skillIds: [],
        workflowSteps: [],
        triggerModes: [],
      },
    ];
    providerState.accounts = [
      {
        id: 'openai',
        vendorId: 'openai',
        label: 'OpenAI',
        authMode: 'api_key',
        model: 'gpt-5.4',
        metadata: { customModels: ['gpt-5.4-mini'] },
        enabled: true,
        isDefault: true,
        createdAt: '2026-04-13T00:00:00.000Z',
        updatedAt: '2026-04-13T00:00:00.000Z',
      },
      {
        id: 'moonshot',
        vendorId: 'moonshot',
        label: 'Moonshot',
        authMode: 'api_key',
        model: 'kimi-k2.5',
        metadata: { customModels: ['kimi-k2-turbo-preview'] },
        enabled: true,
        isDefault: false,
        createdAt: '2026-04-12T00:00:00.000Z',
        updatedAt: '2026-04-12T00:00:00.000Z',
      },
    ];
    providerState.statuses = [
      { id: 'openai', hasKey: true, model: 'gpt-5.4' },
      { id: 'moonshot', hasKey: true, model: 'kimi-k2.5' },
    ];
    providerState.vendors = [
      { id: 'openai', name: 'OpenAI' },
      { id: 'moonshot', name: 'Moonshot' },
    ];
    providerState.defaultAccountId = 'openai';
    hostApiFetchMock.mockResolvedValueOnce({ valid: true, model: 'kimi-k2.5' });

    render(<ChatInput onSend={vi.fn()} />);

    fireEvent.click(screen.getByTestId('chat-model-switch'));

    const optionTexts = Array.from(new Set(screen.getAllByRole('button')
      .map((button) => button.textContent)
      .filter((text): text is string => Boolean(text) && text.includes(' / '))));
    expect(optionTexts).toEqual([
      'OpenAI / gpt-5.4',
      'OpenAI / gpt-5.4-mini',
      'Moonshot / kimi-k2-turbo-preview',
      'Moonshot / kimi-k2.5',
    ]);

    fireEvent.click(screen.getByText('Moonshot / kimi-k2.5'));

    await waitFor(() => {
      expect(hostApiFetchMock).toHaveBeenCalledWith(
        '/api/provider-drafts/test',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });

    const validationPayload = JSON.parse(String(hostApiFetchMock.mock.calls[0]?.[1]?.body || '{}')) as {
      accountId?: string;
      vendorId?: string;
      apiKey?: string;
      model?: string;
    };
    expect(validationPayload.accountId).toBe('moonshot');
    expect(validationPayload.vendorId).toBe('moonshot');
    expect(validationPayload.apiKey).toBe('sk-test');
    expect(validationPayload.model).toBe('kimi-k2.5');

    await waitFor(() => {
      expect(screen.getByTestId('chat-model-switch')).toHaveTextContent('Moonshot / kimi-k2.5');
      expect(chatState.sessionModels['agent:main:main']).toBe('moonshot/kimi-k2.5');
      expect(toastSuccessMock).toHaveBeenCalledWith('Switched to Moonshot / kimi-k2.5');
    });
  });

  it('keeps the previous session model when model validation fails', async () => {
    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'GPT-5.4',
        modelRef: 'openai/gpt-5.4',
        overrideModelRef: null,
        inheritedModel: true,
        workspace: '~/.openclaw/workspace',
        agentDir: '~/.openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:main',
        channelTypes: [],
        skillIds: [],
        workflowSteps: [],
        triggerModes: [],
      },
    ];
    providerState.accounts = [
      {
        id: 'openai',
        vendorId: 'openai',
        label: 'OpenAI',
        authMode: 'api_key',
        model: 'gpt-5.4',
        enabled: true,
        isDefault: true,
        createdAt: '2026-04-13T00:00:00.000Z',
        updatedAt: '2026-04-13T00:00:00.000Z',
      },
      {
        id: 'moonshot',
        vendorId: 'moonshot',
        label: 'Moonshot',
        authMode: 'api_key',
        model: 'kimi-k2.5',
        enabled: true,
        isDefault: false,
        createdAt: '2026-04-12T00:00:00.000Z',
        updatedAt: '2026-04-12T00:00:00.000Z',
      },
    ];
    providerState.statuses = [
      { id: 'openai', hasKey: true, model: 'gpt-5.4' },
      { id: 'moonshot', hasKey: true, model: 'kimi-k2.5' },
    ];
    providerState.vendors = [
      { id: 'openai', name: 'OpenAI' },
      { id: 'moonshot', name: 'Moonshot' },
    ];
    providerState.defaultAccountId = 'openai';
    chatState.sessions = [{ key: 'agent:main:main', model: 'openai/gpt-5.4' }];
    chatState.sessionModels = { 'agent:main:main': 'openai/gpt-5.4' };
    hostApiFetchMock.mockRejectedValueOnce(new Error('Model not found'));

    render(<ChatInput onSend={vi.fn()} />);

    fireEvent.click(screen.getByTestId('chat-model-switch'));
    fireEvent.click(screen.getByText('Moonshot / kimi-k2.5'));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        'Failed to switch model. Still using OpenAI / gpt-5.4: Model not found',
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId('chat-model-switch')).toHaveTextContent('OpenAI / gpt-5.4');
    });

    expect(chatState.sessionModels['agent:main:main']).toBe('openai/gpt-5.4');
    expect(chatState.sessions[0]?.model).toBe('openai/gpt-5.4');
  });

  it('uses the global default model for a session when no session model is stored', () => {
    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'GPT-5.4',
        modelRef: 'openai/gpt-5.4',
        overrideModelRef: null,
        inheritedModel: true,
        workspace: '~/.openclaw/workspace',
        agentDir: '~/.openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:main',
        channelTypes: [],
        skillIds: [],
        workflowSteps: [],
        triggerModes: [],
      },
    ];
    providerState.accounts = [
      {
        id: 'openai',
        vendorId: 'openai',
        label: 'OpenAI',
        authMode: 'api_key',
        model: 'gpt-5.4',
        enabled: true,
        isDefault: true,
        createdAt: '2026-04-13T00:00:00.000Z',
        updatedAt: '2026-04-13T00:00:00.000Z',
      },
      {
        id: 'moonshot',
        vendorId: 'moonshot',
        label: 'Moonshot',
        authMode: 'api_key',
        model: 'kimi-k2.5',
        enabled: true,
        isDefault: false,
        createdAt: '2026-04-12T00:00:00.000Z',
        updatedAt: '2026-04-12T00:00:00.000Z',
      },
    ];
    providerState.statuses = [
      { id: 'openai', hasKey: true, model: 'gpt-5.4' },
      { id: 'moonshot', hasKey: true, model: 'kimi-k2.5' },
    ];
    providerState.vendors = [
      { id: 'openai', name: 'OpenAI' },
      { id: 'moonshot', name: 'Moonshot' },
    ];
    providerState.defaultAccountId = 'openai';
    chatState.sessions = [{ key: 'agent:main:main' }];
    chatState.sessionModels = {};
    agentsState.defaultModelRef = 'openai/gpt-5.4';

    render(<ChatInput onSend={vi.fn()} />);

    expect(screen.getByTestId('chat-model-switch')).toHaveTextContent('OpenAI / gpt-5.4');
  });

  it('prefers the current session model over the global default model', () => {
    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'GPT-5.4',
        modelRef: 'openai/gpt-5.4',
        overrideModelRef: null,
        inheritedModel: true,
        workspace: '~/.openclaw/workspace',
        agentDir: '~/.openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:main',
        channelTypes: [],
        skillIds: [],
        workflowSteps: [],
        triggerModes: [],
      },
    ];
    providerState.accounts = [
      {
        id: 'openai',
        vendorId: 'openai',
        label: 'OpenAI',
        authMode: 'api_key',
        model: 'gpt-5.4',
        metadata: { customModels: ['gpt-5.4-mini'] },
        enabled: true,
        isDefault: true,
        createdAt: '2026-04-13T00:00:00.000Z',
        updatedAt: '2026-04-13T00:00:00.000Z',
      },
      {
        id: 'moonshot',
        vendorId: 'moonshot',
        label: 'Moonshot',
        authMode: 'api_key',
        model: 'kimi-k2.5',
        enabled: true,
        isDefault: false,
        createdAt: '2026-04-12T00:00:00.000Z',
        updatedAt: '2026-04-12T00:00:00.000Z',
      },
    ];
    providerState.statuses = [
      { id: 'openai', hasKey: true, model: 'gpt-5.4' },
      { id: 'moonshot', hasKey: true, model: 'kimi-k2.5' },
    ];
    providerState.vendors = [
      { id: 'openai', name: 'OpenAI' },
      { id: 'moonshot', name: 'Moonshot' },
    ];
    providerState.defaultAccountId = 'openai';
    chatState.sessions = [{ key: 'agent:main:main', model: 'moonshot/kimi-k2.5' }];
    chatState.sessionModels = { 'agent:main:main': 'moonshot/kimi-k2.5' };
    agentsState.defaultModelRef = 'openai/gpt-5.4-mini';

    render(<ChatInput onSend={vi.fn()} />);

    expect(screen.getByTestId('chat-model-switch')).toHaveTextContent('Moonshot / kimi-k2.5');
  });

  it('clears the current draft and ignores in-flight attachment staging when switching sessions', async () => {
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
      },
    ];
    chatState.sessions = [
      { key: 'agent:main:main' },
      { key: 'agent:main:follow-up' },
    ];
    invokeIpcMock.mockResolvedValueOnce({
      canceled: false,
      filePaths: ['C:\\temp\\demo.png'],
    });
    let resolveStagePaths!: (value: Array<{
      id: string;
      fileName: string;
      mimeType: string;
      fileSize: number;
      stagedPath: string;
      preview: string | null;
    }>) => void;
    hostApiFetchMock.mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveStagePaths = resolve;
      }),
    );

    const { rerender } = render(<ChatInput onSend={vi.fn()} />);

    fireEvent.click(screen.getByTestId('chat-agent-picker-button'));
    fireEvent.click(screen.getByText('Research'));
    await waitFor(() => {
      expect(screen.getByTitle('Clear target agent')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('chat-attach-button'));
    await screen.findByText('demo.png');

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Draft to clear' } });
    expect(screen.getByRole('textbox')).toHaveValue('Draft to clear');

    chatState.currentSessionKey = 'agent:main:follow-up';
    rerender(<ChatInput onSend={vi.fn()} />);

    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(screen.queryByText('demo.png')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Clear target agent')).not.toBeInTheDocument();

    await act(async () => {
      resolveStagePaths([
        {
          id: 'file-1',
          fileName: 'demo.png',
          mimeType: 'image/png',
          fileSize: 1024,
          stagedPath: 'C:\\Users\\Administrator\\.openclaw\\media\\outbound\\demo.png',
          preview: 'data:image/png;base64,abc',
        },
      ]);
      await Promise.resolve();
    });

    expect(screen.queryByText('demo.png')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('');
  });

  it('filters duplicate files and warns instead of adding them twice', async () => {
    invokeIpcMock.mockResolvedValueOnce({
      canceled: false,
      filePaths: ['C:\\temp\\demo.png'],
    });
    hostApiFetchMock.mockResolvedValueOnce([
      {
        id: 'file-1',
        fileName: 'demo.png',
        mimeType: 'image/png',
        fileSize: 1024,
        stagedPath: 'C:\\Users\\Administrator\\.openclaw\\media\\outbound\\demo.png',
        preview: 'data:image/png;base64,abc',
      },
    ]);
    invokeIpcMock.mockResolvedValueOnce({
      canceled: false,
      filePaths: ['C:\\temp\\demo.png'],
    });

    render(<ChatInput onSend={vi.fn()} />);

    fireEvent.click(screen.getByTestId('chat-attach-button'));
    await screen.findByText('demo.png');

    fireEvent.click(screen.getByTestId('chat-attach-button'));

    expect(screen.getAllByText('demo.png')).toHaveLength(1);
    await waitFor(() => {
      expect(toastWarningMock).toHaveBeenCalledWith('不要重复添加文件');
    });
  });
});
