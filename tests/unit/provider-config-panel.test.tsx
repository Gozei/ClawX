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

vi.mock('react-i18next', () => {
  const translations: Record<string, string> = {
    'aiProviders.modelsConfig.actions.add': '新增配置',
    'aiProviders.modelsConfig.actions.apply': '应用到 OpenClaw',
    'aiProviders.modelsConfig.actions.cancel': '取消',
    'aiProviders.modelsConfig.actions.delete': '删除',
    'aiProviders.modelsConfig.actions.deleteConfig': '删除模型配置',
    'aiProviders.modelsConfig.actions.edit': '编辑',
    'aiProviders.modelsConfig.actions.editConfig': '编辑模型配置',
    'aiProviders.modelsConfig.actions.setGlobalDefault': '设为全局默认',
    'aiProviders.modelsConfig.actions.test': '测试',
    'aiProviders.modelsConfig.actions.testConnection': '测试连接',
    'aiProviders.modelsConfig.badges.globalDefault': '全局默认',
    'aiProviders.modelsConfig.columns.actions': '操作',
    'aiProviders.modelsConfig.columns.capability': '能力',
    'aiProviders.modelsConfig.columns.config': '模型配置',
    'aiProviders.modelsConfig.columns.summary': '摘要',
    'aiProviders.modelsConfig.columns.testResult': '测试结果',
    'aiProviders.modelsConfig.description': '用表格管理厂商、模型、测试结果。测试通过后，才允许应用到 OpenClaw。',
    'aiProviders.modelsConfig.empty.cta': '新增首个配置',
    'aiProviders.modelsConfig.empty.description': '先新增一个配置，测试成功后再应用到 OpenClaw。',
    'aiProviders.modelsConfig.empty.title': '还没有模型配置',
    'aiProviders.modelsConfig.fields.accountName': '账户名称',
    'aiProviders.modelsConfig.fields.apiKey': 'API Key（密钥）',
    'aiProviders.modelsConfig.fields.baseUrl': 'Base URL（接口地址）',
    'aiProviders.modelsConfig.fields.modelId': '模型 ID',
    'aiProviders.modelsConfig.fields.protocol': '协议（接口格式）',
    'aiProviders.modelsConfig.fields.vendor': '模型厂商',
    'aiProviders.modelsConfig.help.accountName': '仅用于本地识别，默认跟随模型厂商，可自定义。',
    'aiProviders.modelsConfig.help.apiKeyCustom': '从对应服务商控制台获取 API Key{{savedKeyText}}',
    'aiProviders.modelsConfig.help.apiKeySavedSuffix': '；留空会沿用已保存密钥',
    'aiProviders.modelsConfig.help.apiKeyVendor': '从 {{vendor}} 控制台获取 API Key{{savedKeyText}}',
    'aiProviders.modelsConfig.help.baseUrlCustom': '填写模型服务接口地址，例如 https://api.example.com/v1',
    'aiProviders.modelsConfig.help.baseUrlLocal': '本地模型服务地址已自动填写，如需变更请在对应服务中配置',
    'aiProviders.modelsConfig.help.baseUrlVendor': '{{vendor}} 默认 API 地址已自动填写，通常无需修改',
    'aiProviders.modelsConfig.help.model': '填写厂商提供的模型 ID，例如 gpt-5.4、claude-sonnet-4.5 或 qwen3.5-plus。',
    'aiProviders.modelsConfig.help.modelRecommended': '可直接输入模型 ID，也可选择推荐：{{models}}',
    'aiProviders.modelsConfig.help.protocolCustom': '选择服务接口兼容格式，自定义服务通常使用 OpenAI Completions',
    'aiProviders.modelsConfig.help.protocolVendor': '已根据 {{vendor}} 自动选择，避免协议和厂商不匹配',
    'aiProviders.modelsConfig.help.vendor': '先选择模型服务提供商，协议、接口地址和推荐模型会随厂商自动联动。',
    'aiProviders.modelsConfig.listSeparator': '、',
    'aiProviders.modelsConfig.placeholders.apiKey': '输入 {{vendor}} API Key',
    'aiProviders.modelsConfig.placeholders.keepSavedKey': '留空表示沿用已保存密钥',
    'aiProviders.modelsConfig.protocolOptions.openaiCompletions': 'OpenAI Completions（兼容）',
    'aiProviders.modelsConfig.resultTypes.chat': '聊天',
    'aiProviders.modelsConfig.resultTypes.code': '代码',
    'aiProviders.modelsConfig.resultTypes.general': '通用',
    'aiProviders.modelsConfig.resultTypes.reasoning': '推理',
    'aiProviders.modelsConfig.resultTypes.vision': '图像',
    'aiProviders.modelsConfig.sheet.createTitle': '新增模型配置',
    'aiProviders.modelsConfig.sheet.description': '先测试，再应用。只有最近一次测试成功且配置未变，才允许回写到 OpenClaw。',
    'aiProviders.modelsConfig.sheet.editTitle': '编辑模型配置',
    'aiProviders.modelsConfig.status.connectionSuccess': '连接成功',
    'aiProviders.modelsConfig.status.connectionSuccessModel': '连接成功，模型：{{model}}',
    'aiProviders.modelsConfig.status.failed': '失败',
    'aiProviders.modelsConfig.status.noLatency': '无延迟数据',
    'aiProviders.modelsConfig.status.noOutput': '尚未返回',
    'aiProviders.modelsConfig.status.notTested': '未测试',
    'aiProviders.modelsConfig.status.success': '成功',
    'aiProviders.modelsConfig.status.successApplied': '成功并已应用',
    'aiProviders.modelsConfig.status.testing': '测试中',
    'aiProviders.modelsConfig.testCard.description': '向 {{vendor}} 发送一次简短探测请求，确认 API Key、接口地址和模型 ID 是否可用。',
    'aiProviders.modelsConfig.testCard.lastTest': '最近测试：{{value}}',
    'aiProviders.modelsConfig.testCard.latency': '回复延迟：{{value}}',
    'aiProviders.modelsConfig.testCard.title': '自动化测试结果',
    'aiProviders.modelsConfig.title': '模型配置',
    'aiProviders.modelsConfig.toast.applied': '已应用到 OpenClaw',
    'aiProviders.modelsConfig.toast.applyFailed': '应用失败: {{error}}',
    'aiProviders.modelsConfig.toast.configMissing': '配置不存在',
    'aiProviders.modelsConfig.toast.defaultFailed': '设置失败: {{error}}',
    'aiProviders.modelsConfig.toast.defaultUpdated': '已设为全局默认模型',
    'aiProviders.modelsConfig.toast.deleted': '已删除配置',
    'aiProviders.modelsConfig.toast.deleteFailed': '删除失败: {{error}}',
    'aiProviders.modelsConfig.toast.duplicateModel': '模型配置已存在：{{target}}',
    'aiProviders.modelsConfig.toast.modelRequired': '需要模型 ID',
    'aiProviders.modelsConfig.toast.testFailed': '测试失败',
    'aiProviders.modelsConfig.toast.testSuccess': '测试成功 · {{latency}}ms',
    'aiProviders.modelsConfig.tooltips.currentGlobalDefault': '当前全局默认模型',
  };

  const t = (key: string, values?: Record<string, unknown>) => {
    let text = translations[key] ?? key;
    for (const [name, value] of Object.entries(values ?? {})) {
      text = text.replaceAll(`{{${name}}}`, String(value));
    }
    return text;
  };

  return {
    useTranslation: () => ({ t }),
  };
});

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

  it('does not allow deleting the global default model row', async () => {
    providerStore.accounts = [
      {
        id: 'openai',
        vendorId: 'openai',
        label: 'OpenAI 主账号',
        authMode: 'api_key',
        baseUrl: 'https://api.openai.com/v1',
        apiProtocol: 'openai-completions',
        model: 'gpt-5.4',
        metadata: { customModels: ['gpt-5.4-mini'] },
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
    providerStore.defaultAccountId = 'openai';

    render(<ProviderConfigPanel />);

    const defaultDeleteButton = screen.getByTestId('models-config-delete-openai:gpt-5.4');
    const nonDefaultDeleteButton = screen.getByTestId('models-config-delete-openai:gpt-5.4-mini');

    expect(defaultDeleteButton).toBeDisabled();
    expect(nonDefaultDeleteButton).not.toBeDisabled();

    fireEvent.click(defaultDeleteButton);

    expect(providerStore.updateAccount).not.toHaveBeenCalled();
    expect(providerStore.removeAccount).not.toHaveBeenCalled();
  });
});
