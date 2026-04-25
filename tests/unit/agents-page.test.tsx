import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Agents } from '../../src/pages/Agents/index';

const navigateMock = vi.fn();
const hostApiFetchMock = vi.fn();
const subscribeHostEventMock = vi.fn();
const fetchAgentsMock = vi.fn();
const updateAgentMock = vi.fn();
const updateAgentModelMock = vi.fn();
const updateAgentStudioMock = vi.fn();
const deleteAgentMock = vi.fn();
const refreshProviderSnapshotMock = vi.fn();
const fetchSkillsMock = vi.fn();
const gatewayRpcMock = vi.fn();

const { gatewayState, agentsState, providersState, skillsState } = vi.hoisted(() => ({
  gatewayState: {
    status: { state: 'running', port: 18789 },
  },
  agentsState: {
    agents: [] as Array<Record<string, unknown>>,
    defaultModelRef: null as string | null,
    loading: false,
    error: null as string | null,
  },
  providersState: {
    accounts: [] as Array<Record<string, unknown>>,
    statuses: [] as Array<Record<string, unknown>>,
    vendors: [] as Array<Record<string, unknown>>,
    defaultAccountId: '' as string,
  },
  skillsState: {
    skills: [] as Array<Record<string, unknown>>,
  },
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: (selector: (state: typeof gatewayState & { rpc: typeof gatewayRpcMock }) => unknown) => selector({
    ...gatewayState,
    rpc: gatewayRpcMock,
  }),
}));

vi.mock('@/stores/skills', () => ({
  useSkillsStore: (selector?: (state: {
    skills: Array<Record<string, unknown>>;
    fetchSkills: typeof fetchSkillsMock;
  }) => unknown) => {
    const state = {
      ...skillsState,
      fetchSkills: fetchSkillsMock,
    };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: (selector?: (state: typeof agentsState & {
    fetchAgents: typeof fetchAgentsMock;
    updateAgent: typeof updateAgentMock;
    updateAgentModel: typeof updateAgentModelMock;
    updateAgentStudio: typeof updateAgentStudioMock;
    createAgent: ReturnType<typeof vi.fn>;
    deleteAgent: typeof deleteAgentMock;
  }) => unknown) => {
    const state = {
      ...agentsState,
      fetchAgents: fetchAgentsMock,
      updateAgent: updateAgentMock,
      updateAgentModel: updateAgentModelMock,
      updateAgentStudio: updateAgentStudioMock,
      createAgent: vi.fn(),
      deleteAgent: deleteAgentMock,
    };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

vi.mock('@/stores/providers', () => ({
  useProviderStore: (selector: (state: typeof providersState & {
    refreshProviderSnapshot: typeof refreshProviderSnapshotMock;
  }) => unknown) => {
    const state = {
      ...providersState,
      refreshProviderSnapshot: refreshProviderSnapshotMock,
    };
    return selector(state);
  },
}));

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

vi.mock('@/lib/host-events', () => ({
  subscribeHostEvent: (...args: unknown[]) => subscribeHostEventMock(...args),
}));

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    initReactI18next: actual.initReactI18next ?? { type: '3rdParty', init: () => {} },
    useTranslation: () => ({
      t: (key: string) => key,
      i18n: { language: 'zh-CN' },
    }),
  };
});

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

describe('Agents page status refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gatewayState.status = { state: 'running', port: 18789 };
    agentsState.agents = [];
    agentsState.defaultModelRef = null;
    skillsState.skills = [];
    providersState.accounts = [];
    providersState.statuses = [];
    providersState.vendors = [];
    providersState.defaultAccountId = '';
    fetchAgentsMock.mockResolvedValue(undefined);
    updateAgentMock.mockResolvedValue(undefined);
    updateAgentModelMock.mockResolvedValue(undefined);
    updateAgentStudioMock.mockResolvedValue(undefined);
    deleteAgentMock.mockResolvedValue(undefined);
    refreshProviderSnapshotMock.mockResolvedValue(undefined);
    fetchSkillsMock.mockResolvedValue(undefined);
    gatewayRpcMock.mockResolvedValue({ sessions: [] });
    navigateMock.mockReset();
    hostApiFetchMock.mockResolvedValue({
      success: true,
      channels: [],
    });
  });

  it('refetches channel accounts when gateway channel-status events arrive', async () => {
    let channelStatusHandler: (() => void) | undefined;
    subscribeHostEventMock.mockImplementation((eventName: string, handler: () => void) => {
      if (eventName === 'gateway:channel-status') {
        channelStatusHandler = handler;
      }
      return vi.fn();
    });

    render(<Agents />);

    await waitFor(() => {
      expect(fetchAgentsMock).toHaveBeenCalledTimes(1);
      expect(hostApiFetchMock).toHaveBeenCalledWith('/api/channels/accounts');
    });
    expect(subscribeHostEventMock).toHaveBeenCalledWith('gateway:channel-status', expect.any(Function));

    await act(async () => {
      channelStatusHandler?.();
    });

    await waitFor(() => {
      const channelFetchCalls = hostApiFetchMock.mock.calls.filter(([path]) => path === '/api/channels/accounts');
      expect(channelFetchCalls).toHaveLength(2);
    });
  });

  it('refetches channel accounts when the gateway transitions to running after mount', async () => {
    gatewayState.status = { state: 'starting', port: 18789 };

    const { rerender } = render(<Agents />);

    await waitFor(() => {
      expect(fetchAgentsMock).toHaveBeenCalledTimes(1);
      expect(hostApiFetchMock).toHaveBeenCalledWith('/api/channels/accounts');
    });

    gatewayState.status = { state: 'running', port: 18789 };
    await act(async () => {
      rerender(<Agents />);
    });

    await waitFor(() => {
      const channelFetchCalls = hostApiFetchMock.mock.calls.filter(([path]) => path === '/api/channels/accounts');
      expect(channelFetchCalls).toHaveLength(2);
    });
  });

  it('uses "Use default model" as form fill only and disables it when already default', async () => {
    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'claude-opus-4.6',
        modelRef: 'openrouter/anthropic/claude-opus-4.6',
        overrideModelRef: null,
        inheritedModel: true,
        workspace: '~/.openclaw/workspace',
        agentDir: '~/.openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:desk',
        channelTypes: [],
      },
    ];
    agentsState.defaultModelRef = 'openrouter/anthropic/claude-opus-4.6';
    providersState.accounts = [
      {
        id: 'openrouter-default',
        label: 'OpenRouter',
        vendorId: 'openrouter',
        authMode: 'api_key',
        model: 'openrouter/anthropic/claude-opus-4.6',
        enabled: true,
        createdAt: '2026-03-24T00:00:00.000Z',
        updatedAt: '2026-03-24T00:00:00.000Z',
      },
    ];
    providersState.statuses = [{ id: 'openrouter-default', hasKey: true }];
    providersState.vendors = [
      { id: 'openrouter', name: 'OpenRouter', modelIdPlaceholder: 'anthropic/claude-opus-4.6' },
    ];
    providersState.defaultAccountId = 'openrouter-default';

    render(<Agents />);

    await waitFor(() => {
      expect(fetchAgentsMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByTitle('settings'));
    fireEvent.click(screen.getByTestId('agent-model-summary-card'));

    const useDefaultButton = await screen.findByRole('button', { name: 'settingsDialog.useDefaultModel' });
    const modelIdInput = screen.getByLabelText('settingsDialog.modelIdLabel');
    const saveButton = screen.getAllByRole('button', { name: 'common:actions.save' }).at(-1);

    expect(useDefaultButton).toBeDisabled();

    fireEvent.change(modelIdInput, { target: { value: 'anthropic/claude-sonnet-4.5' } });
    expect(useDefaultButton).toBeEnabled();
    expect(saveButton).toBeEnabled();

    fireEvent.click(useDefaultButton);

    expect(updateAgentModelMock).not.toHaveBeenCalled();
    expect((modelIdInput as HTMLInputElement).value).toBe('anthropic/claude-opus-4.6');
    expect(useDefaultButton).toBeDisabled();
  });

  it('allows deleting a non-default role from its card actions', async () => {
    agentsState.agents = [
      {
        id: 'writer',
        name: 'Writer',
        isDefault: false,
        modelDisplay: 'gpt-5',
        modelRef: 'openai/gpt-5',
        overrideModelRef: null,
        inheritedModel: true,
        workspace: '~/.openclaw/workspace-writer',
        agentDir: '~/.openclaw/agents/writer/agent',
        mainSessionKey: 'agent:writer:main',
        channelTypes: [],
      },
    ];

    render(<Agents />);

    await waitFor(() => {
      expect(fetchAgentsMock).toHaveBeenCalledTimes(1);
    });

    const card = screen.getByTestId('agent-overview-card');
    fireEvent.mouseEnter(card);

    const deleteButton = screen.getByTitle('deleteAgent');
    fireEvent.click(deleteButton);

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getAllByRole('button')[1]);

    await waitFor(() => {
      expect(deleteAgentMock).toHaveBeenCalledWith('writer');
    });
  });

  it('keeps the agent skills search visible and lets assigned globally disabled skills be removed', async () => {
    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'gpt-5',
        modelRef: 'openai/gpt-5',
        overrideModelRef: null,
        inheritedModel: true,
        workspace: '~/.openclaw/workspace',
        agentDir: '~/.openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:main',
        channelTypes: [],
        skillIds: ['disabled-assigned'],
      },
    ];
    skillsState.skills = [
      {
        id: 'disabled-unassigned',
        name: 'Disabled Unassigned',
        description: 'Unavailable globally',
        enabled: false,
        ready: true,
        version: '1.0.0',
      },
      {
        id: 'disabled-assigned',
        name: 'Disabled Assigned',
        description: 'Historical assignment',
        enabled: false,
        ready: true,
        version: '1.0.0',
      },
      {
        id: 'enabled-skill',
        name: 'Enabled Skill',
        description: 'Available globally',
        enabled: true,
        ready: true,
        version: '1.0.0',
      },
    ];

    render(<Agents />);

    await waitFor(() => {
      expect(fetchAgentsMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByTitle('settings'));
    const settingsDialog = await screen.findByTestId('agent-settings-dialog');
    const skillsTab = within(settingsDialog).getByText('settingsDialog.tabs.skills');
    fireEvent.mouseDown(skillsTab, { button: 0 });
    fireEvent.click(skillsTab);

    expect(await screen.findByTestId('agent-skill-search-input')).toBeVisible();

    const enabledCard = screen.getByTestId('agent-skill-list-item-enabled-skill');
    const disabledAssignedCard = screen.getByTestId('agent-skill-list-item-disabled-assigned');
    const disabledUnassignedCard = screen.getByTestId('agent-skill-list-item-disabled-unassigned');

    expect(
      enabledCard.compareDocumentPosition(disabledAssignedCard) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      disabledAssignedCard.compareDocumentPosition(disabledUnassignedCard) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    expect(within(disabledAssignedCard).getByText('settingsDialog.skillAssigned')).toBeInTheDocument();
    expect(within(disabledAssignedCard).getByText('settingsDialog.skillDisabled')).toBeInTheDocument();
    expect(within(disabledAssignedCard).getByText('settingsDialog.skillDisabledAssignedHint')).toBeInTheDocument();
    expect(within(disabledUnassignedCard).getByRole('switch')).toBeDisabled();

    fireEvent.click(within(disabledAssignedCard).getByRole('switch'));
    fireEvent.click(screen.getByRole('button', { name: 'settingsDialog.saveStudio' }));

    await waitFor(() => {
      expect(updateAgentStudioMock).toHaveBeenCalledWith('main', expect.objectContaining({
        skillIds: [],
      }));
    });

    await waitFor(() => {
      expect(screen.queryByTestId('agent-settings-dialog')).not.toBeInTheDocument();
    });
  });

  it('keeps the last agent snapshot visible while a refresh is in flight', async () => {
    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'gpt-5',
        modelRef: 'openai/gpt-5',
        overrideModelRef: null,
        inheritedModel: true,
        workspace: '~/.openclaw/workspace',
        agentDir: '~/.openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:main',
        channelTypes: [],
      },
    ];

    const { rerender } = render(<Agents />);

    expect(await screen.findByText('Main')).toBeInTheDocument();

    agentsState.loading = true;
    await act(async () => {
      rerender(<Agents />);
    });

    expect(screen.getByText('Main')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('keeps the blocking spinner during the initial load before any stable snapshot exists', async () => {
    agentsState.loading = true;
    fetchAgentsMock.mockImplementation(() => new Promise(() => {}));
    refreshProviderSnapshotMock.mockImplementation(() => new Promise(() => {}));
    hostApiFetchMock.mockImplementation(() => new Promise(() => {}));

    const { container } = render(<Agents />);

    expect(container.querySelector('svg.animate-spin')).toBeTruthy();
    expect(screen.queryByText('title')).not.toBeInTheDocument();
  });
});
