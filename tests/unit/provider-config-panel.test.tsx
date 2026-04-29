import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderConfigPanel } from '@/pages/Models/ProviderConfigPanel';

const hostApiFetchMock = vi.fn();
const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();
const confirmGatewayImpactMock = vi.fn();

const providerStore = {
  accounts: [] as Array<Record<string, unknown>>,
  statuses: [] as Array<Record<string, unknown>>,
  vendors: [
    {
      id: 'openai',
      name: 'OpenAI',
      hidden: false,
      supportsMultipleAccounts: false,
    },
  ] as Array<Record<string, unknown>>,
  defaultAccountId: null as string | null,
  loading: false,
  refreshProviderSnapshot: vi.fn(async () => {}),
  createAccount: vi.fn(async () => {}),
  updateAccount: vi.fn(async () => {}),
  removeAccount: vi.fn(async () => {}),
  setDefaultAccount: vi.fn(async () => {}),
};

const agentsStore = {
  fetchAgents: vi.fn(async () => {}),
};

vi.mock('@/stores/agents', () => ({
  useAgentsStore: (selector: (state: typeof agentsStore) => unknown) => selector(agentsStore),
}));

vi.mock('@/stores/providers', () => ({
  useProviderStore: () => providerStore,
}));

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

vi.mock('@/lib/gateway-impact-confirm', () => ({
  confirmGatewayImpact: (...args: unknown[]) => confirmGatewayImpactMock(...args),
}));

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

describe('ProviderConfigPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    confirmGatewayImpactMock.mockResolvedValue(true);
    providerStore.accounts = [];
    providerStore.statuses = [];
    providerStore.vendors = [
      {
        id: 'openai',
        name: 'OpenAI',
        hidden: false,
        supportsMultipleAccounts: false,
      },
    ];
    providerStore.defaultAccountId = null;
    providerStore.refreshProviderSnapshot.mockReset();
    providerStore.refreshProviderSnapshot.mockResolvedValue(undefined);
    providerStore.createAccount.mockReset();
    providerStore.createAccount.mockResolvedValue(true);
    providerStore.updateAccount.mockReset();
    providerStore.updateAccount.mockResolvedValue(true);
    providerStore.removeAccount.mockReset();
    providerStore.removeAccount.mockResolvedValue(true);
    providerStore.setDefaultAccount.mockReset();
    providerStore.setDefaultAccount.mockResolvedValue(true);
    agentsStore.fetchAgents.mockReset();
    agentsStore.fetchAgents.mockResolvedValue(undefined);
  });

  it('shows the empty state when there are no model configurations', () => {
    render(<ProviderConfigPanel />);

    expect(screen.getByTestId('models-config-empty-state')).toBeInTheDocument();
    expect(screen.getByText('还没有模型配置')).toBeInTheDocument();
  });

  it('prefills built-in provider base urls and leaves only custom editable', async () => {
    providerStore.vendors = [
      {
        id: 'openai',
        name: 'OpenAI',
        hidden: false,
        supportsMultipleAccounts: false,
        providerConfig: {
          baseUrl: 'https://api.openai.com/v1',
          api: 'openai-responses',
        },
        defaultModelId: 'gpt-5.4',
        defaultAuthMode: 'api_key',
      },
      {
        id: 'custom',
        name: 'Custom',
        hidden: false,
        supportsMultipleAccounts: true,
        defaultAuthMode: 'api_key',
      },
    ];

    render(<ProviderConfigPanel />);

    fireEvent.click(screen.getByTestId('models-config-add-button'));

    const baseUrlInput = await screen.findByTestId('models-config-sheet-base-url-input') as HTMLInputElement;
    const protocolSelect = screen.getByTestId('models-config-sheet-protocol-select') as HTMLSelectElement;
    const labelInput = screen.getByTestId('models-config-sheet-label-input') as HTMLInputElement;

    expect(screen.getByLabelText('模型厂商')).toBeInTheDocument();
    expect(screen.getByText('先选择模型服务提供商，协议、接口地址和推荐模型会随厂商自动联动。')).toBeInTheDocument();
    expect(labelInput).toHaveValue('OpenAI');
    expect(baseUrlInput).toHaveValue('https://api.openai.com/v1');
    expect(baseUrlInput).toHaveAttribute('readonly');
    expect(protocolSelect).toHaveValue('openai-responses');
    expect(protocolSelect).toBeDisabled();

    fireEvent.change(screen.getByTestId('models-config-sheet-vendor-select'), { target: { value: 'custom' } });

    expect(labelInput).toHaveValue('自定义');
    expect(baseUrlInput).toHaveValue('');
    expect(baseUrlInput).not.toHaveAttribute('readonly');
    expect(protocolSelect).toBeEnabled();

    fireEvent.change(baseUrlInput, { target: { value: 'https://api.example.com/v1' } });

    expect(baseUrlInput).toHaveValue('https://api.example.com/v1');
  });

  it('restores cached row test results after the panel remounts', async () => {
    providerStore.accounts = [
      {
        id: 'openai',
        vendorId: 'openai',
        label: 'OpenAI 主账号',
        authMode: 'api_key',
        baseUrl: 'https://api.openai.com/v1',
        apiProtocol: 'openai-completions',
        model: 'gpt-5.4',
        enabled: true,
        isDefault: true,
        createdAt: '2026-04-13T00:00:00.000Z',
        updatedAt: '2026-04-13T00:00:00.000Z',
      },
    ];
    providerStore.statuses = [
      {
        id: 'openai',
        type: 'openai',
        name: 'OpenAI 主账号',
        hasKey: true,
        keyMasked: 'sk-***',
        enabled: true,
        createdAt: '2026-04-13T00:00:00.000Z',
        updatedAt: '2026-04-13T00:00:00.000Z',
        model: 'gpt-5.4',
      },
    ];
    window.localStorage.setItem('clawx.models.testResults.v1', JSON.stringify({
      'openai:gpt-5.4': {
        state: 'success',
        cacheSignature: JSON.stringify({
          vendorId: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          apiProtocol: 'openai-completions',
          modelId: 'gpt-5.4',
          authMode: 'api_key',
        }),
        model: 'gpt-5.4',
        latencyMs: 120,
        testedAt: '2026-04-13T01:00:00.000Z',
      },
    }));

    const { unmount } = render(<ProviderConfigPanel />);
    expect(screen.getByText('连接成功，模型：gpt-5.4')).toBeInTheDocument();
    expect(screen.getByText('120 ms')).toBeInTheDocument();

    unmount();
    render(<ProviderConfigPanel />);
    expect(screen.getByText('连接成功，模型：gpt-5.4')).toBeInTheDocument();
  });

  it('stores a newly applied custom model test result under the created account row key', async () => {
    providerStore.vendors = [
      {
        id: 'custom',
        name: 'Custom',
        hidden: false,
        supportsMultipleAccounts: true,
        defaultAuthMode: 'api_key',
      },
    ];
    providerStore.createAccount.mockResolvedValueOnce(true);
    providerStore.setDefaultAccount.mockResolvedValueOnce(true);
    hostApiFetchMock.mockResolvedValue({
      valid: true,
      latencyMs: 88,
      output: 'ok',
      model: 'qwen3.5-plus',
    });

    render(<ProviderConfigPanel />);

    fireEvent.click(screen.getByTestId('models-config-add-button'));
    fireEvent.change(await screen.findByTestId('models-config-sheet-model-input'), { target: { value: 'qwen3.5-plus' } });
    fireEvent.change(screen.getByTestId('models-config-sheet-base-url-input'), { target: { value: 'https://api.example.com/v1' } });
    fireEvent.click(screen.getByRole('button', { name: '测试连接' }));

    await waitFor(() => {
      expect(screen.getByTestId('models-config-apply-button')).toBeEnabled();
    });

    fireEvent.click(screen.getByTestId('models-config-apply-button'));

    await waitFor(() => {
      expect(providerStore.createAccount).toHaveBeenCalledTimes(1);
    });
    const createdAccount = providerStore.createAccount.mock.calls[0]?.[0] as { id: string };
    expect(providerStore.setDefaultAccount).toHaveBeenCalledWith(createdAccount.id, { skipImpactConfirm: true });
    const cached = JSON.parse(window.localStorage.getItem('clawx.models.testResults.v1') || '{}') as Record<string, unknown>;

    expect(cached[`${createdAccount.id}:qwen3.5-plus`]).toMatchObject({
      state: 'success',
      model: 'qwen3.5-plus',
      latencyMs: 88,
      applied: true,
    });
    expect(cached['custom:qwen3.5-plus']).toBeUndefined();
  });

  it('only enables apply after the current draft test succeeds', async () => {
    providerStore.accounts = [
      {
        id: 'openai',
        vendorId: 'openai',
        label: 'OpenAI 主账号',
        authMode: 'api_key',
        baseUrl: 'https://api.openai.com/v1',
        apiProtocol: 'openai-completions',
        model: 'gpt-5.4',
        enabled: true,
        isDefault: true,
        createdAt: '2026-04-13T00:00:00.000Z',
        updatedAt: '2026-04-13T00:00:00.000Z',
        metadata: {
          modelProtocols: {
            'gpt-5.4': 'openai-completions',
          },
        },
      },
    ];
    providerStore.statuses = [
      {
        id: 'openai',
        type: 'openai',
        name: 'OpenAI 主账号',
        hasKey: true,
        keyMasked: 'sk-***',
        enabled: true,
        createdAt: '2026-04-13T00:00:00.000Z',
        updatedAt: '2026-04-13T00:00:00.000Z',
        model: 'gpt-5.4',
      },
    ];
    providerStore.defaultAccountId = 'openai';
    hostApiFetchMock.mockResolvedValue({
      valid: true,
      latencyMs: 842,
      output: 'Hello from gpt-5.4',
      model: 'gpt-5.4',
    });

    render(<ProviderConfigPanel />);

    fireEvent.click(screen.getByTestId('models-config-edit-openai:gpt-5.4'));

    const applyButton = await screen.findByTestId('models-config-apply-button');
    expect(applyButton).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '测试连接' }));

    await waitFor(() => {
      expect(hostApiFetchMock).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(applyButton).toBeEnabled();
    });

    fireEvent.change(screen.getByLabelText('模型 ID'), { target: { value: 'gpt-5.4-mini' } });
    expect(applyButton).toBeDisabled();
  });

  it('uses the configured model in the test result summary instead of the provider reply', async () => {
    providerStore.accounts = [
      {
        id: 'custom-mini',
        vendorId: 'custom',
        label: 'MiniMax',
        authMode: 'api_key',
        baseUrl: 'https://api.example.com/v1',
        apiProtocol: 'openai-completions',
        model: 'minimax2.7',
        enabled: true,
        isDefault: true,
        createdAt: '2026-04-13T00:00:00.000Z',
        updatedAt: '2026-04-13T00:00:00.000Z',
      },
    ];
    providerStore.statuses = [
      {
        id: 'custom-mini',
        type: 'custom',
        name: 'MiniMax',
        hasKey: true,
        keyMasked: 'sk-***',
        enabled: true,
        createdAt: '2026-04-13T00:00:00.000Z',
        updatedAt: '2026-04-13T00:00:00.000Z',
        model: 'minimax2.7',
      },
    ];
    hostApiFetchMock.mockResolvedValue({
      valid: true,
      latencyMs: 4005,
      output: '连接成功 模型: Meta-L',
      model: 'minimax2.7',
    });

    render(<ProviderConfigPanel />);

    fireEvent.click(screen.getByTestId('models-config-test-custom-mini:minimax2.7'));

    await waitFor(() => {
      expect(screen.getByText('连接成功，模型：minimax2.7')).toBeInTheDocument();
    });
    expect(screen.queryByText('连接成功 模型: Meta-L')).not.toBeInTheDocument();
  });

  it('collapses duplicate rows that point to the same vendor/model signature', () => {
    providerStore.accounts = [
      {
        id: 'custom-a',
        vendorId: 'custom',
        label: '京东代理',
        authMode: 'api_key',
        baseUrl: 'https://api.example.com/v1',
        apiProtocol: 'openai-completions',
        model: 'qwen3.5-plus',
        enabled: true,
        isDefault: true,
        createdAt: '2026-04-13T00:00:00.000Z',
        updatedAt: '2026-04-13T00:00:00.000Z',
      },
      {
        id: 'custom-b',
        vendorId: 'custom',
        label: '京东代理',
        authMode: 'api_key',
        baseUrl: 'https://api.example.com/v1',
        apiProtocol: 'openai-completions',
        model: 'qwen3.5-plus',
        enabled: true,
        isDefault: false,
        createdAt: '2026-04-13T00:00:00.000Z',
        updatedAt: '2026-04-13T00:00:01.000Z',
      },
    ];
    providerStore.statuses = [
      {
        id: 'custom-a',
        type: 'custom',
        name: '京东代理',
        hasKey: true,
        keyMasked: 'sk-***',
        enabled: true,
        createdAt: '2026-04-13T00:00:00.000Z',
        updatedAt: '2026-04-13T00:00:00.000Z',
        model: 'qwen3.5-plus',
      },
      {
        id: 'custom-b',
        type: 'custom',
        name: '京东代理',
        hasKey: true,
        keyMasked: 'sk-***',
        enabled: true,
        createdAt: '2026-04-13T00:00:00.000Z',
        updatedAt: '2026-04-13T00:00:01.000Z',
        model: 'qwen3.5-plus',
      },
    ];

    render(<ProviderConfigPanel />);

    expect(screen.getAllByTestId('models-config-row')).toHaveLength(1);
  });

  it('shows and handles the set global default action for non-global rows', async () => {
    providerStore.accounts = [
      {
        id: 'openai',
        vendorId: 'openai',
        label: 'OpenAI 主账号',
        authMode: 'api_key',
        baseUrl: 'https://api.openai.com/v1',
        apiProtocol: 'openai-completions',
        model: 'gpt-5.4',
        enabled: true,
        isDefault: true,
        createdAt: '2026-04-13T00:00:00.000Z',
        updatedAt: '2026-04-13T00:00:00.000Z',
        metadata: {
          customModels: ['gpt-5.4-mini'],
          modelProtocols: {
            'gpt-5.4': 'openai-completions',
            'gpt-5.4-mini': 'openai-completions',
          },
        },
      },
    ];
    providerStore.statuses = [
      {
        id: 'openai',
        type: 'openai',
        name: 'OpenAI 主账号',
        hasKey: true,
        keyMasked: 'sk-***',
        enabled: true,
        createdAt: '2026-04-13T00:00:00.000Z',
        updatedAt: '2026-04-13T00:00:00.000Z',
        model: 'gpt-5.4',
      },
    ];
    providerStore.defaultAccountId = 'openai';
    hostApiFetchMock.mockResolvedValue({ success: true });

    render(<ProviderConfigPanel />);

    expect(screen.getByText('全局默认')).toBeInTheDocument();
    expect(screen.queryByText(/^默认$/)).not.toBeInTheDocument();
    const globalDefaultButtons = screen.getAllByRole('button', { name: '设为全局默认' });
    expect(globalDefaultButtons).toHaveLength(1);

    fireEvent.click(globalDefaultButtons[0]!);

    await waitFor(() => {
      expect(confirmGatewayImpactMock).toHaveBeenCalledTimes(1);
    });
    expect(hostApiFetchMock).toHaveBeenCalledTimes(1);
    expect(hostApiFetchMock).toHaveBeenNthCalledWith(1, '/api/provider-accounts/openai', expect.objectContaining({
      method: 'PUT',
    }));
    expect(providerStore.updateAccount).not.toHaveBeenCalled();
    expect(providerStore.setDefaultAccount).not.toHaveBeenCalled();
    expect(providerStore.refreshProviderSnapshot).toHaveBeenCalledTimes(2);
    expect(agentsStore.fetchAgents).toHaveBeenCalledTimes(1);
    expect(toastSuccessMock).toHaveBeenCalledWith('已设为全局默认模型');
  });

  it('keeps the row visible when delete is cancelled by the gateway-impact confirmation', async () => {
    providerStore.accounts = [
      {
        id: 'openai',
        vendorId: 'openai',
        label: 'OpenAI 主账号',
        authMode: 'api_key',
        baseUrl: 'https://api.openai.com/v1',
        apiProtocol: 'openai-completions',
        model: 'gpt-5.4',
        enabled: true,
        isDefault: true,
        createdAt: '2026-04-13T00:00:00.000Z',
        updatedAt: '2026-04-13T00:00:00.000Z',
      },
    ];
    providerStore.statuses = [
      {
        id: 'openai',
        type: 'openai',
        name: 'OpenAI 主账号',
        hasKey: true,
        keyMasked: 'sk-***',
        enabled: true,
        createdAt: '2026-04-13T00:00:00.000Z',
        updatedAt: '2026-04-13T00:00:00.000Z',
        model: 'gpt-5.4',
      },
    ];
    providerStore.removeAccount.mockResolvedValue(false);

    render(<ProviderConfigPanel />);

    expect(screen.getAllByTestId('models-config-row')).toHaveLength(1);
    const deleteButton = screen.getByTestId('models-config-delete-openai:gpt-5.4');

    fireEvent.click(deleteButton);

    await waitFor(() => {
      expect(providerStore.removeAccount).toHaveBeenCalledWith('openai');
    });
    await waitFor(() => {
      expect(deleteButton).not.toBeDisabled();
    });
    expect(screen.getAllByTestId('models-config-row')).toHaveLength(1);
    expect(screen.getByText('gpt-5.4')).toBeInTheDocument();
    expect(toastSuccessMock).not.toHaveBeenCalledWith('已删除配置');
  });
});
