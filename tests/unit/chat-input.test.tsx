import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ChatInput } from '@/pages/Chat/ChatInput';

const { agentsState, chatState, gatewayState, providerState } = vi.hoisted(() => ({
  agentsState: {
    agents: [] as Array<Record<string, unknown>>,
    defaultModelRef: 'openai/gpt-5.4',
    updateAgentModel: vi.fn(),
  },
  chatState: {
    currentAgentId: 'main',
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
  },
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: (selector: (state: typeof agentsState) => unknown) => selector(agentsState),
}));

vi.mock('@/stores/chat', () => ({
  useChatStore: (selector: (state: typeof chatState) => unknown) => selector(chatState),
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: (selector: (state: typeof gatewayState) => unknown) => selector(gatewayState),
}));

vi.mock('@/stores/providers', () => ({
  useProviderStore: (selector: (state: typeof providerState) => unknown) => selector(providerState),
}));

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: vi.fn(),
}));

vi.mock('@/lib/api-client', () => ({
  invokeIpc: vi.fn(),
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
    chatState.currentAgentId = 'main';
    gatewayState.status = { state: 'running', port: 18789 };
    providerState.accounts = [];
    providerState.statuses = [];
    providerState.vendors = [];
    providerState.defaultAccountId = null;
    providerState.refreshProviderSnapshot.mockReset();
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

    fireEvent.click(screen.getByTitle('Choose agent'));
    fireEvent.click(screen.getByText('Research'));

    expect(screen.getAllByText('@Research')).toHaveLength(2);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Hello direct agent' } });
    fireEvent.click(screen.getByTitle('Send'));

    expect(onSend).toHaveBeenCalledWith('Hello direct agent', undefined, 'research');
  });

  it('shows model options in provider order and updates the current agent model', () => {
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

    const modelSelect = screen.getByTestId('chat-model-switch').querySelector('select');
    expect(modelSelect).not.toBeNull();
    const optionTexts = Array.from(modelSelect!.querySelectorAll('option')).map((option) => option.textContent);
    expect(optionTexts).toEqual([
      'OpenAI / gpt-5.4',
      'OpenAI / gpt-5.4-mini',
      'Moonshot / kimi-k2-turbo-preview',
      'Moonshot / kimi-k2.5',
    ]);

    fireEvent.change(modelSelect!, { target: { value: 'moonshot/kimi-k2.5' } });

    expect(agentsState.updateAgentModel).toHaveBeenCalledWith('main', 'moonshot/kimi-k2.5');
  });
});
