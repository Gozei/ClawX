import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ChatInput } from '@/pages/Chat/ChatInput';

function getModelSwitch(): HTMLButtonElement {
  const button = screen.getByTestId('chat-model-switch');
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error('Model switch button not found');
  }
  return button;
}

const { agentsState, chatState, chatListeners, gatewayState, providerState, hostApiFetchMock, invokeIpcMock, toastWarningMock, toastSuccessMock, toastErrorMock } = vi.hoisted(() => ({
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
    composerDrafts: {} as Record<string, { text: string; attachments: Array<Record<string, unknown>>; targetAgentId: string | null }>,
    setComposerDraft: (_sessionKey: string, _update: Record<string, unknown>) => undefined,
    clearComposerDraft: (_sessionKey?: string) => undefined,
  },
  chatListeners: new Set<() => void>(),
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
  useChatStore: (() => {
    const notify = () => {
      for (const listener of chatListeners) {
        listener();
      }
    };

    const setState = (partial: Partial<typeof chatState> | ((state: typeof chatState) => Partial<typeof chatState>)) => {
      const patch = typeof partial === 'function' ? partial(chatState) : partial;
      Object.assign(chatState, patch);
      notify();
    };

    chatState.setComposerDraft = (
      sessionKey: string,
      update:
        | { text: string; attachments: Array<Record<string, unknown>>; targetAgentId: string | null }
        | null
        | ((draft: { text: string; attachments: Array<Record<string, unknown>>; targetAgentId: string | null }) => {
          text: string;
          attachments: Array<Record<string, unknown>>;
          targetAgentId: string | null;
        } | null),
    ) => {
      const currentDraft = chatState.composerDrafts[sessionKey] ?? {
        text: '',
        attachments: [],
        targetAgentId: null,
      };
      const resolvedDraft = typeof update === 'function'
        ? update({
          text: currentDraft.text,
          attachments: [...currentDraft.attachments],
          targetAgentId: currentDraft.targetAgentId,
        })
        : update;
      if (!resolvedDraft) {
        const nextDrafts = { ...chatState.composerDrafts };
        delete nextDrafts[sessionKey];
        chatState.composerDrafts = nextDrafts;
        notify();
        return;
      }
      chatState.composerDrafts = {
        ...chatState.composerDrafts,
        [sessionKey]: {
          text: resolvedDraft.text ?? '',
          attachments: Array.isArray(resolvedDraft.attachments) ? resolvedDraft.attachments : [],
          targetAgentId: resolvedDraft.targetAgentId ?? null,
        },
      };
      notify();
    };

    chatState.clearComposerDraft = (sessionKey?: string) => {
      const key = sessionKey ?? chatState.currentSessionKey;
      if (!chatState.composerDrafts[key]) return;
      const nextDrafts = { ...chatState.composerDrafts };
      delete nextDrafts[key];
      chatState.composerDrafts = nextDrafts;
      notify();
    };

    return Object.assign(
      (selector: (state: typeof chatState) => unknown) => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { useSyncExternalStore } = require('react') as typeof import('react');
        return useSyncExternalStore(
          (listener) => {
            chatListeners.add(listener);
            return () => {
              chatListeners.delete(listener);
            };
          },
          () => selector(chatState),
          () => selector(chatState),
        );
      },
      {
        getState: () => chatState,
        setState,
      },
    );
  })(),
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
    case 'composer.disclaimer':
      return 'AI can make mistakes. Please verify important information.';
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
    i18n: {
      resolvedLanguage: 'en',
      language: 'en',
    },
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
    chatState.composerDrafts = {};
    chatListeners.clear();
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

  it('does not render a gateway status line below the composer', () => {
    gatewayState.status = { state: 'starting', port: 18789, pid: 24412 };

    render(<ChatInput onSend={vi.fn()} />);

    expect(screen.queryByText(/gateway starting \| port: 18789/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/pid: 24412/i)).not.toBeInTheDocument();
  });

  it('renders the composer disclaimer below the action row', () => {
    render(<ChatInput onSend={vi.fn()} />);

    const composer = screen.getByTestId('chat-composer');
    const composerShell = screen.getByTestId('chat-composer-shell');
    const disclaimer = screen.getByTestId('chat-composer-disclaimer');

    expect(disclaimer).toHaveTextContent(
      'AI can make mistakes. Please verify important information.',
    );
    expect(composer.contains(disclaimer)).toBe(false);
    expect(composerShell).toHaveClass('pb-2');
    expect(disclaimer).toHaveClass('mt-2');
    expect(disclaimer).toHaveClass('text-xs', 'text-black');
  });

  it('keeps the composer editable for offline queueing while the gateway is disconnected', () => {
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
    ];
    providerState.statuses = [{ id: 'openai', hasKey: true, model: 'gpt-5.4' }];
    providerState.vendors = [{ id: 'openai', name: 'OpenAI' }];
    providerState.defaultAccountId = 'openai';
    chatState.sessions = [{ key: 'agent:main:main', model: 'openai/gpt-5.4' }];
    chatState.sessionModels = { 'agent:main:main': 'openai/gpt-5.4' };
    gatewayState.status = { state: 'stopped', port: 18789 };

    render(<ChatInput onSend={vi.fn()} onQueueOfflineMessage={vi.fn()} disabled />);

    const textbox = screen.getByRole('textbox');
    expect(textbox).not.toBeDisabled();
    expect(textbox).toHaveAttribute('placeholder', 'Gateway not connected...');
    expect(screen.getByTestId('chat-attach-button')).not.toBeDisabled();
    expect(screen.getByTestId('chat-agent-picker-button')).not.toBeDisabled();
    expect(screen.getByTestId('chat-model-switch')).not.toBeDisabled();
    expect(screen.getByTestId('chat-send-button')).toBeDisabled();
    const composer = screen.getByTestId('chat-composer');
    const disclaimer = screen.getByTestId('chat-composer-disclaimer');

    expect(disclaimer).toHaveTextContent(
      'AI can make mistakes. Please verify important information.',
    );
    expect(composer.contains(disclaimer)).toBe(false);
    expect(screen.queryByTestId('chat-composer-offline-hint')).not.toBeInTheDocument();
  });

  it('applies starter prompt prefills to the composer', async () => {
    const { rerender } = render(<ChatInput onSend={vi.fn()} />);

    rerender(
      <ChatInput
        onSend={vi.fn()}
        prefillText="Help me understand this problem first, then give me a step-by-step plan."
        prefillNonce={1}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('textbox')).toHaveValue(
        'Help me understand this problem first, then give me a step-by-step plan.',
      );
    });
  });

  it('queues the message instead of dropping it when the gateway is offline', async () => {
    const onSend = vi.fn();
    const onQueueOfflineMessage = vi.fn();
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
    chatState.sessions = [{ key: 'agent:main:main', model: 'openai/gpt-5.4' }];
    chatState.sessionModels = { 'agent:main:main': 'openai/gpt-5.4' };
    gatewayState.status = { state: 'stopped', port: 18789 };

    render(
      <ChatInput
        onSend={onSend}
        onQueueOfflineMessage={onQueueOfflineMessage}
        disabled
      />,
    );

    hostApiFetchMock.mockResolvedValueOnce({ success: true });
    fireEvent.click(getModelSwitch());
    fireEvent.click(screen.getByRole('button', { name: 'Moonshot / kimi-k2.5' }));
    await waitFor(() => {
      expect(screen.getByTestId('chat-model-switch')).toHaveTextContent('Moonshot / kimi-k2.5');
    });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Queue this for later' } });
    fireEvent.click(screen.getByTestId('chat-send-button'));
    await waitFor(() => {
      expect(onQueueOfflineMessage).toHaveBeenCalledWith(
        'Queue this for later',
        undefined,
        null,
        {
          sessionKey: 'agent:main:main',
          modelRef: 'moonshot/kimi-k2.5',
        },
      );
    });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('keeps the composer interactive during an active run and queues the next draft', () => {
    const onSend = vi.fn();
    const onQueueOfflineMessage = vi.fn();
    const onStop = vi.fn();
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
      },
      {
        id: 'research',
        name: 'Research',
        isDefault: false,
        modelDisplay: 'Claude',
        modelRef: 'moonshot/kimi-k2.5',
        overrideModelRef: 'moonshot/kimi-k2.5',
        inheritedModel: false,
        workspace: '~/.openclaw/workspace-research',
        agentDir: '~/.openclaw/agents/research/agent',
        mainSessionKey: 'agent:research:desk',
        channelTypes: [],
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
    ];
    providerState.statuses = [{ id: 'openai', hasKey: true, model: 'gpt-5.4' }];
    providerState.vendors = [{ id: 'openai', name: 'OpenAI' }];
    providerState.defaultAccountId = 'openai';
    chatState.sessions = [
      { key: 'agent:main:main', model: 'openai/gpt-5.4' },
    ];
    chatState.sessionModels = {
      'agent:main:main': 'openai/gpt-5.4',
    };

    render(
      <ChatInput
        onSend={onSend}
        onQueueOfflineMessage={onQueueOfflineMessage}
        onStop={onStop}
        sending
      />,
    );

    expect(screen.getByRole('textbox')).not.toBeDisabled();
    expect(screen.getByTestId('chat-attach-button')).not.toBeDisabled();
    expect(screen.getByTestId('chat-agent-picker-button')).not.toBeDisabled();
    expect(screen.getByTestId('chat-model-switch')).not.toBeDisabled();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Queue after this run finishes' } });
    fireEvent.click(screen.getByTestId('chat-send-button'));

    expect(onQueueOfflineMessage).toHaveBeenCalledWith(
      'Queue after this run finishes',
      undefined,
      null,
      {
        sessionKey: 'agent:main:main',
        modelRef: 'openai/gpt-5.4',
      },
    );
    expect(onSend).not.toHaveBeenCalled();
    expect(onStop).not.toHaveBeenCalled();
  });

  it('lets the user select an agent target and sends it with the message', async () => {
    const onSend = vi.fn();
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
    ];
    providerState.statuses = [
      { id: 'openai', hasKey: true, model: 'gpt-5.4' },
    ];
    providerState.vendors = [
      { id: 'openai', name: 'OpenAI' },
    ];
    providerState.defaultAccountId = 'openai';
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
    fireEvent.click(screen.getByTestId('chat-send-button'));

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith(
        'Hello direct agent',
        undefined,
        'research',
        {
          sessionKey: 'agent:research:desk',
          modelRef: 'openai/gpt-5.4',
        },
      );
    });
  });

  it('sends the currently selected session model with online messages', async () => {
    const onSend = vi.fn();
    agentsState.defaultModelRef = 'custom-custombc/gpt-5.4';
    providerState.accounts = [
      {
        id: 'custom-custombc',
        vendorId: 'custom',
        label: 'Jingdong',
        authMode: 'api_key',
        model: 'gpt-5.4',
        metadata: { customModels: ['qwen3.5-plus'] },
        enabled: true,
        isDefault: true,
        createdAt: '2026-04-13T00:00:00.000Z',
        updatedAt: '2026-04-13T00:00:00.000Z',
      },
    ];
    providerState.statuses = [
      { id: 'custom-custombc', hasKey: true, model: 'gpt-5.4' },
    ];
    providerState.vendors = [
      { id: 'custom', name: 'Custom' },
    ];
    providerState.defaultAccountId = 'custom-custombc';
    chatState.sessions = [{ key: 'agent:main:main', model: 'custom-custombc/qwen3.5-plus' }];
    chatState.sessionModels = {
      'agent:main:main': 'custom-custombc/qwen3.5-plus',
    };

    render(<ChatInput onSend={onSend} />);

    expect(screen.getByTestId('chat-model-switch')).toHaveTextContent('Jingdong / qwen3.5-plus');

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '在线吗' } });
    fireEvent.click(screen.getByTestId('chat-send-button'));

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith(
        '在线吗',
        undefined,
        null,
        {
          sessionKey: 'agent:main:main',
          modelRef: 'custom-custombc/qwen3.5-plus',
        },
      );
    });
  });

  it('falls back to the first configured model when the global default is stale', async () => {
    const onSend = vi.fn();
    agentsState.defaultModelRef = 'custom-customd6/glm-5';
    providerState.accounts = [
      {
        id: 'custom-custombc',
        vendorId: 'custom',
        label: 'Jingdong',
        authMode: 'api_key',
        model: 'qwen3.5-plus',
        metadata: { customModels: ['glm-5'] },
        enabled: true,
        isDefault: true,
        createdAt: '2026-04-13T00:00:00.000Z',
        updatedAt: '2026-04-13T00:00:00.000Z',
      },
    ];
    providerState.statuses = [
      { id: 'custom-custombc', hasKey: true, model: 'qwen3.5-plus' },
    ];
    providerState.vendors = [
      { id: 'custom', name: 'Custom' },
    ];
    providerState.defaultAccountId = 'custom-custombc';

    render(<ChatInput onSend={onSend} />);

    expect(screen.getByTestId('chat-model-switch')).toHaveTextContent('Jingdong / glm-5');

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '使用默认模型' } });
    fireEvent.click(screen.getByTestId('chat-send-button'));

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith(
        '使用默认模型',
        undefined,
        null,
        {
          sessionKey: 'agent:main:main',
          modelRef: 'custom-custombc/glm-5',
        },
      );
    });
    expect(toastErrorMock).not.toHaveBeenCalledWith(
      'Current session model is unavailable. Select an available model before sending.',
    );
  });

  it('applies model switches to the targeted agent session when a role is selected', async () => {
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
      {
        id: 'research',
        name: 'Research',
        isDefault: false,
        modelDisplay: 'Kimi',
        modelRef: 'moonshot/kimi-k2.5',
        overrideModelRef: 'moonshot/kimi-k2.5',
        inheritedModel: false,
        workspace: '~/.openclaw/workspace-research',
        agentDir: '~/.openclaw/agents/research/agent',
        mainSessionKey: 'agent:research:desk',
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
    chatState.sessions = [
      { key: 'agent:main:main', model: 'openai/gpt-5.4' },
      { key: 'agent:research:desk', model: 'moonshot/kimi-k2.5' },
    ];
    chatState.sessionModels = {
      'agent:main:main': 'openai/gpt-5.4',
      'agent:research:desk': 'moonshot/kimi-k2.5',
    };

    render(<ChatInput onSend={vi.fn()} />);

    fireEvent.click(screen.getByTestId('chat-agent-picker-button'));
    fireEvent.click(screen.getByText('Research'));

    expect(screen.getByTestId('chat-model-switch')).toHaveTextContent('Moonshot / kimi-k2.5');

    hostApiFetchMock.mockResolvedValueOnce({ success: true });
    fireEvent.click(getModelSwitch());
    fireEvent.click(screen.getByRole('button', { name: 'OpenAI / gpt-5.4-mini' }));

    await waitFor(() => {
      expect(hostApiFetchMock).toHaveBeenCalledWith('/api/sessions/model', {
        method: 'POST',
        body: JSON.stringify({
          sessionKey: 'agent:research:desk',
          modelRef: 'openai/gpt-5.4-mini',
        }),
      });
      expect(screen.getByTestId('chat-model-switch')).toHaveTextContent('OpenAI / gpt-5.4-mini');
      expect(chatState.sessionModels['agent:research:desk']).toBe('openai/gpt-5.4-mini');
      expect(chatState.sessionModels['agent:main:main']).toBe('openai/gpt-5.4');
      expect(toastSuccessMock).toHaveBeenCalledWith('Switched to OpenAI / gpt-5.4-mini');
    });
  });

  it('keeps model switching locally responsive for a new draft session before it exists on disk', async () => {
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
    ];
    providerState.statuses = [
      { id: 'openai', hasKey: true, model: 'gpt-5.4' },
    ];
    providerState.vendors = [
      { id: 'openai', name: 'OpenAI' },
    ];
    providerState.defaultAccountId = 'openai';
    chatState.currentSessionKey = 'agent:main:session-123';
    chatState.sessions = [];
    chatState.sessionModels = {
      'agent:main:session-123': 'openai/gpt-5.4',
    };

    render(<ChatInput onSend={vi.fn()} onQueueOfflineMessage={vi.fn()} disabled />);

    hostApiFetchMock.mockResolvedValueOnce({
      success: false,
      error: 'ENOENT: no such file or directory, open sessions.json',
    });
    fireEvent.click(getModelSwitch());
    fireEvent.click(screen.getByRole('button', { name: 'OpenAI / gpt-5.4-mini' }));

    await waitFor(() => {
      expect(hostApiFetchMock).toHaveBeenCalledWith('/api/sessions/model', {
        method: 'POST',
        body: JSON.stringify({
          sessionKey: 'agent:main:session-123',
          modelRef: 'openai/gpt-5.4-mini',
        }),
      });
      expect(screen.getByTestId('chat-model-switch')).toHaveTextContent('OpenAI / gpt-5.4-mini');
      expect(chatState.sessionModels['agent:main:session-123']).toBe('openai/gpt-5.4-mini');
      expect(toastSuccessMock).toHaveBeenCalledWith('Switched to OpenAI / gpt-5.4-mini');
      expect(toastErrorMock).not.toHaveBeenCalled();
    });
  });

  it('shows model options in provider order and persists the current session model selection', async () => {
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

    render(<ChatInput onSend={vi.fn()} />);

    fireEvent.click(getModelSwitch());

    const optionTexts = Array.from(new Set(screen.getAllByRole('button')
      .map((button) => button.textContent)
      .filter((text): text is string => Boolean(text) && text.includes(' / '))));
    expect(optionTexts).toEqual([
      'OpenAI / gpt-5.4',
      'OpenAI / gpt-5.4-mini',
      'Moonshot / kimi-k2-turbo-preview',
      'Moonshot / kimi-k2.5',
    ]);

    hostApiFetchMock.mockResolvedValueOnce({ success: true });
    fireEvent.click(screen.getByRole('button', { name: 'Moonshot / kimi-k2.5' }));

    await waitFor(() => {
      expect(hostApiFetchMock).toHaveBeenCalledWith('/api/sessions/model', {
        method: 'POST',
        body: JSON.stringify({
          sessionKey: 'agent:main:main',
          modelRef: 'moonshot/kimi-k2.5',
        }),
      });
      expect(invokeIpcMock).not.toHaveBeenCalled();
      expect(screen.getByTestId('chat-model-switch')).toHaveTextContent('Moonshot / kimi-k2.5');
      expect(chatState.sessionModels['agent:main:main']).toBe('moonshot/kimi-k2.5');
      expect(toastSuccessMock).toHaveBeenCalledWith('Switched to Moonshot / kimi-k2.5');
    });
  });

  it('shows a trailing spinner while waiting for session model persistence', async () => {
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

    let resolvePersist: ((value: { success: boolean }) => void) | null = null;
    const persistPromise = new Promise<{ success: boolean }>((resolve) => {
      resolvePersist = resolve;
    });
    hostApiFetchMock.mockImplementationOnce(() => persistPromise);

    render(<ChatInput onSend={vi.fn()} />);

    fireEvent.click(getModelSwitch());
    fireEvent.click(screen.getByRole('button', { name: 'Moonshot / kimi-k2.5' }));

    await waitFor(() => {
      expect(hostApiFetchMock).toHaveBeenCalledWith('/api/sessions/model', {
        method: 'POST',
        body: JSON.stringify({
          sessionKey: 'agent:main:main',
          modelRef: 'moonshot/kimi-k2.5',
        }),
      });
    });

    expect(getModelSwitch()).toBeDisabled();
    expect(getModelSwitch()).toHaveAttribute('aria-busy', 'true');
    expect(getModelSwitch()).toHaveClass('opacity-50');
    expect(screen.getByTestId('chat-model-switch-spinner')).toBeInTheDocument();
    expect(screen.getByTestId('chat-model-switch')).toHaveTextContent('OpenAI / gpt-5.4');
    expect(chatState.sessionModels['agent:main:main']).toBeUndefined();

    await act(async () => {
      resolvePersist?.({ success: true });
      await persistPromise;
    });

    await waitFor(() => {
      expect(getModelSwitch()).not.toBeDisabled();
      expect(screen.queryByTestId('chat-model-switch-spinner')).not.toBeInTheDocument();
      expect(screen.getByTestId('chat-model-switch-chevron')).toBeInTheDocument();
      expect(screen.getByTestId('chat-model-switch')).toHaveTextContent('Moonshot / kimi-k2.5');
      expect(chatState.sessionModels['agent:main:main']).toBe('moonshot/kimi-k2.5');
      expect(toastSuccessMock).toHaveBeenCalledWith('Switched to Moonshot / kimi-k2.5');
    });
  });

  it('keeps the previous model selected when persisting the session model fails', async () => {
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
    chatState.sessions = [
      { key: 'agent:main:main', model: 'openai/gpt-5.4' },
    ];
    chatState.sessionModels = {
      'agent:main:main': 'openai/gpt-5.4',
    };
    hostApiFetchMock.mockResolvedValueOnce({ success: false, error: 'Failed to persist session model' });

    render(<ChatInput onSend={vi.fn()} />);

    fireEvent.click(getModelSwitch());
    fireEvent.click(screen.getByRole('button', { name: 'Moonshot / kimi-k2.5' }));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        'Failed to switch model. Still using OpenAI / gpt-5.4: Failed to persist session model',
      );
    });
    expect(screen.getByTestId('chat-model-switch')).toHaveTextContent('OpenAI / gpt-5.4');
    expect(chatState.sessionModels['agent:main:main']).toBe('openai/gpt-5.4');
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

  it('uses the first configured model when neither the session nor the global default has a model', () => {
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
      },
    ];
    providerState.accounts = [
      {
        id: 'custom-custombc',
        vendorId: 'custom',
        label: 'Jingdong',
        authMode: 'api_key',
        model: 'glm-5',
        enabled: true,
        isDefault: false,
        createdAt: '2026-04-13T00:00:00.000Z',
        updatedAt: '2026-04-13T00:00:00.000Z',
      },
    ];
    providerState.statuses = [
      { id: 'custom-custombc', hasKey: true, model: 'glm-5' },
    ];
    providerState.vendors = [
      { id: 'custom', name: 'Custom' },
    ];
    chatState.sessions = [{ key: 'agent:main:main' }];
    chatState.sessionModels = {};
    agentsState.defaultModelRef = null as unknown as string;

    render(<ChatInput onSend={vi.fn()} />);

    expect(screen.getByTestId('chat-model-switch')).toHaveTextContent('Jingdong / glm-5');
  });

  it('shows a stale default model as unavailable when the models page has no configured models', () => {
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
    providerState.accounts = [];
    providerState.statuses = [];
    providerState.vendors = [];
    providerState.defaultAccountId = null;
    chatState.sessions = [{ key: 'agent:main:main' }];
    chatState.sessionModels = {};
    agentsState.defaultModelRef = 'openai/gpt-5.4';

    render(<ChatInput onSend={vi.fn()} />);

    expect(screen.getByTestId('chat-model-switch')).toHaveTextContent('openai/gpt-5.4');
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

  it('repairs an unavailable session model to the global default before sending', async () => {
    const onSend = vi.fn();
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
    ];
    providerState.statuses = [
      { id: 'openai', hasKey: true, model: 'gpt-5.4' },
    ];
    providerState.vendors = [
      { id: 'openai', name: 'OpenAI' },
    ];
    providerState.defaultAccountId = 'openai';
    chatState.sessions = [{ key: 'agent:main:main', model: 'moonshot/kimi-k2.5' }];
    chatState.sessionModels = { 'agent:main:main': 'moonshot/kimi-k2.5' };
    agentsState.defaultModelRef = 'openai/gpt-5.4';

    hostApiFetchMock.mockResolvedValue({ success: true });

    render(<ChatInput onSend={onSend} />);

    await waitFor(() => {
      expect(screen.getByTestId('chat-model-switch')).toHaveTextContent('OpenAI / gpt-5.4');
      expect(chatState.sessionModels['agent:main:main']).toBe('openai/gpt-5.4');
    });
    expect(hostApiFetchMock).toHaveBeenCalledWith('/api/sessions/model', {
      method: 'POST',
      body: JSON.stringify({
        sessionKey: 'agent:main:main',
        modelRef: 'openai/gpt-5.4',
      }),
    });

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '保持会话模型' } });
    fireEvent.click(screen.getByTestId('chat-send-button'));

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith(
        '保持会话模型',
        undefined,
        null,
        {
          sessionKey: 'agent:main:main',
          modelRef: 'openai/gpt-5.4',
        },
      );
    });
    expect(toastErrorMock).not.toHaveBeenCalledWith(
      'Current session model is unavailable. Select an available model before sending.',
    );
  });

  it('does not mask a stale session model locally when repair persistence fails', async () => {
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
    ];
    providerState.statuses = [
      { id: 'openai', hasKey: true, model: 'gpt-5.4' },
    ];
    providerState.vendors = [
      { id: 'openai', name: 'OpenAI' },
    ];
    providerState.defaultAccountId = 'openai';
    chatState.sessions = [{ key: 'agent:main:main', model: 'moonshot/kimi-k2.5' }];
    chatState.sessionModels = { 'agent:main:main': 'moonshot/kimi-k2.5' };
    agentsState.defaultModelRef = 'openai/gpt-5.4';

    hostApiFetchMock.mockRejectedValue(new Error('session store unavailable'));

    render(<ChatInput onSend={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('chat-model-switch')).toHaveTextContent('OpenAI / gpt-5.4');
      expect(hostApiFetchMock).toHaveBeenCalledWith('/api/sessions/model', {
        method: 'POST',
        body: JSON.stringify({
          sessionKey: 'agent:main:main',
          modelRef: 'openai/gpt-5.4',
        }),
      });
    });

    expect(chatState.sessionModels['agent:main:main']).toBe('moonshot/kimi-k2.5');
  });

  it('falls back to the first configured model when both session and default models are unavailable', async () => {
    const onSend = vi.fn();
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
    ];
    providerState.statuses = [
      { id: 'openai', hasKey: true, model: 'gpt-5.4' },
    ];
    providerState.vendors = [
      { id: 'openai', name: 'OpenAI' },
    ];
    providerState.defaultAccountId = 'openai';
    chatState.sessions = [{ key: 'agent:main:main', model: 'moonshot/kimi-k2.5' }];
    chatState.sessionModels = { 'agent:main:main': 'moonshot/kimi-k2.5' };
    agentsState.defaultModelRef = 'moonshot/kimi-k2.5';
    hostApiFetchMock.mockResolvedValue({ success: true });

    render(<ChatInput onSend={onSend} />);

    await waitFor(() => {
      expect(screen.getByTestId('chat-model-switch')).toHaveTextContent('OpenAI / gpt-5.4');
      expect(chatState.sessionModels['agent:main:main']).toBe('openai/gpt-5.4');
    });

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '继续会话' } });
    fireEvent.click(screen.getByTestId('chat-send-button'));

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith(
        '继续会话',
        undefined,
        null,
        {
          sessionKey: 'agent:main:main',
          modelRef: 'openai/gpt-5.4',
        },
      );
    });
  });

  it('blocks send with error when session model is unavailable', async () => {
    const onSend = vi.fn();
    providerState.accounts = [];
    providerState.statuses = [];
    providerState.vendors = [];
    providerState.defaultAccountId = null;
    chatState.sessions = [{ key: 'agent:main:main', model: 'moonshot/kimi-k2.5' }];
    chatState.sessionModels = { 'agent:main:main': 'moonshot/kimi-k2.5' };
    agentsState.defaultModelRef = null;

    render(<ChatInput onSend={onSend} />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '发送失败校验' } });
    fireEvent.click(screen.getByTestId('chat-send-button'));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        'Current session model is unavailable. Select an available model before sending.',
      );
    });
    expect(onSend).not.toHaveBeenCalled();
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
