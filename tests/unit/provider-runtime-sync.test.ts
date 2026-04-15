import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GatewayManager } from '@electron/gateway/manager';
import type { ProviderConfig } from '@electron/utils/secure-storage';

const mocks = vi.hoisted(() => ({
  getProviderAccount: vi.fn(),
  listProviderAccounts: vi.fn(),
  getProviderSecret: vi.fn(),
  getAllProviders: vi.fn(),
  getApiKey: vi.fn(),
  getDefaultProvider: vi.fn(),
  getProvider: vi.fn(),
  getProviderConfig: vi.fn(),
  getProviderDefaultModel: vi.fn(),
  getOpenClawProvidersConfig: vi.fn(),
  removeProviderFromOpenClaw: vi.fn(),
  removeProviderKeyFromOpenClaw: vi.fn(),
  saveOAuthTokenToOpenClaw: vi.fn(),
  saveProviderKeyToOpenClaw: vi.fn(),
  setOpenClawDefaultModel: vi.fn(),
  setOpenClawDefaultModelWithOverride: vi.fn(),
  syncProviderConfigToOpenClaw: vi.fn(),
  updateAgentModelProvider: vi.fn(),
  updateSingleAgentModelProvider: vi.fn(),
  listAgentsSnapshot: vi.fn(),
}));

vi.mock('@electron/services/providers/provider-store', () => ({
  getProviderAccount: mocks.getProviderAccount,
  listProviderAccounts: mocks.listProviderAccounts,
}));

vi.mock('@electron/services/secrets/secret-store', () => ({
  getProviderSecret: mocks.getProviderSecret,
}));

vi.mock('@electron/utils/secure-storage', () => ({
  getAllProviders: mocks.getAllProviders,
  getApiKey: mocks.getApiKey,
  getDefaultProvider: mocks.getDefaultProvider,
  getProvider: mocks.getProvider,
}));

vi.mock('@electron/utils/provider-registry', () => ({
  getProviderConfig: mocks.getProviderConfig,
  getProviderDefaultModel: mocks.getProviderDefaultModel,
}));

vi.mock('@electron/utils/openclaw-auth', () => ({
  getOpenClawProvidersConfig: mocks.getOpenClawProvidersConfig,
  removeProviderFromOpenClaw: mocks.removeProviderFromOpenClaw,
  removeProviderKeyFromOpenClaw: mocks.removeProviderKeyFromOpenClaw,
  saveOAuthTokenToOpenClaw: mocks.saveOAuthTokenToOpenClaw,
  saveProviderKeyToOpenClaw: mocks.saveProviderKeyToOpenClaw,
  setOpenClawDefaultModel: mocks.setOpenClawDefaultModel,
  setOpenClawDefaultModelWithOverride: mocks.setOpenClawDefaultModelWithOverride,
  syncProviderConfigToOpenClaw: mocks.syncProviderConfigToOpenClaw,
  updateAgentModelProvider: mocks.updateAgentModelProvider,
  updateSingleAgentModelProvider: mocks.updateSingleAgentModelProvider,
}));

vi.mock('@electron/utils/agent-config', () => ({
  listAgentsSnapshot: mocks.listAgentsSnapshot,
}));

vi.mock('@electron/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  syncAgentModelOverrideToRuntime,
  syncDefaultProviderToRuntime,
  syncDeletedProviderApiKeyToRuntime,
  syncDeletedProviderToRuntime,
  syncSavedProviderToRuntime,
  syncUpdatedProviderToRuntime,
} from '@electron/services/providers/provider-runtime-sync';

function createProvider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'moonshot',
    name: 'Moonshot',
    type: 'moonshot',
    model: 'kimi-k2.5',
    enabled: true,
    createdAt: '2026-03-14T00:00:00.000Z',
    updatedAt: '2026-03-14T00:00:00.000Z',
    ...overrides,
  };
}

function createGateway(state: 'running' | 'stopped' = 'running'): Pick<GatewayManager, 'debouncedReload' | 'debouncedRestart' | 'getStatus' | 'rpc'> {
  return {
    debouncedReload: vi.fn(),
    debouncedRestart: vi.fn(),
    rpc: vi.fn(),
    getStatus: vi.fn(() => ({ state } as ReturnType<GatewayManager['getStatus']>)),
  };
}

async function flushGatewayRefreshDebounce() {
  await vi.advanceTimersByTimeAsync(2_500);
}

describe('provider-runtime-sync refresh strategy', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.getProviderAccount.mockResolvedValue(null);
    mocks.getProviderSecret.mockResolvedValue(undefined);
    mocks.getAllProviders.mockResolvedValue([]);
    mocks.getApiKey.mockResolvedValue('sk-test');
    mocks.getDefaultProvider.mockResolvedValue('moonshot');
    mocks.getProvider.mockResolvedValue(createProvider());
    mocks.getProviderDefaultModel.mockReturnValue('kimi-k2.5');
    mocks.getOpenClawProvidersConfig.mockResolvedValue({
      providers: {
        moonshot: {
          baseUrl: 'https://api.moonshot.cn/v1',
          api: 'openai-completions',
          models: [{ id: 'kimi-k2.5', name: 'kimi-k2.5' }],
        },
      },
      defaultModel: 'moonshot/kimi-k2.5',
    });
    mocks.getProviderConfig.mockReturnValue({
      api: 'openai-completions',
      baseUrl: 'https://api.moonshot.cn/v1',
      apiKeyEnv: 'MOONSHOT_API_KEY',
    });
    mocks.syncProviderConfigToOpenClaw.mockResolvedValue(undefined);
    mocks.setOpenClawDefaultModel.mockResolvedValue(undefined);
    mocks.setOpenClawDefaultModelWithOverride.mockResolvedValue(undefined);
    mocks.saveProviderKeyToOpenClaw.mockResolvedValue(undefined);
    mocks.removeProviderFromOpenClaw.mockResolvedValue(undefined);
    mocks.removeProviderKeyFromOpenClaw.mockResolvedValue(undefined);
    mocks.updateAgentModelProvider.mockResolvedValue(undefined);
    mocks.updateSingleAgentModelProvider.mockResolvedValue(undefined);
    mocks.listAgentsSnapshot.mockResolvedValue({ agents: [] });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('uses debouncedReload after saving provider config', async () => {
    const gateway = createGateway('running');
    await syncSavedProviderToRuntime(createProvider(), undefined, gateway as GatewayManager);
    await flushGatewayRefreshDebounce();

    expect(gateway.debouncedReload).toHaveBeenCalledTimes(1);
    expect(gateway.debouncedRestart).not.toHaveBeenCalled();
  });

  it('uses debouncedRestart after deleting provider config', async () => {
    const gateway = createGateway('running');
    await syncDeletedProviderToRuntime(createProvider(), 'moonshot', gateway as GatewayManager);
    await flushGatewayRefreshDebounce();

    expect(gateway.debouncedRestart).toHaveBeenCalledTimes(1);
    expect(gateway.debouncedReload).not.toHaveBeenCalled();
  });

  it('removes both runtime and stored account keys when deleting a custom provider', async () => {
    const gateway = createGateway('running');
    const customProvider = createProvider({
      id: 'moonshot-cn',
      type: 'custom',
      baseUrl: 'https://api.moonshot.cn/v1',
    });

    await syncDeletedProviderToRuntime(customProvider, 'moonshot-cn', gateway as GatewayManager);
    await flushGatewayRefreshDebounce();

    expect(mocks.removeProviderFromOpenClaw).toHaveBeenCalledWith('custom-moonshot');
    expect(mocks.removeProviderFromOpenClaw).toHaveBeenCalledWith('moonshot-cn');
    expect(mocks.removeProviderFromOpenClaw).toHaveBeenCalledTimes(2);
    expect(gateway.debouncedRestart).toHaveBeenCalledTimes(1);
  });

  it('only clears the api-key profile when deleting a provider api key', async () => {
    const openaiProvider = createProvider({
      id: 'openai-personal',
      type: 'openai',
    });

    await syncDeletedProviderApiKeyToRuntime(openaiProvider, 'openai-personal');

    expect(mocks.removeProviderKeyFromOpenClaw).toHaveBeenCalledWith('openai');
    expect(mocks.removeProviderFromOpenClaw).not.toHaveBeenCalled();
  });

  it('removes browser-oauth runtime aliases when deleting a built-in OpenAI provider', async () => {
    const gateway = createGateway('running');
    const openaiProvider = createProvider({
      id: 'openai',
      type: 'openai',
      model: 'gpt-5.4',
    });

    await syncDeletedProviderToRuntime(openaiProvider, 'openai', gateway as GatewayManager);
    await flushGatewayRefreshDebounce();

    expect(mocks.removeProviderFromOpenClaw).toHaveBeenCalledWith('openai');
    expect(mocks.removeProviderFromOpenClaw).toHaveBeenCalledWith('openai-codex');
    expect(gateway.debouncedRestart).toHaveBeenCalledTimes(1);
  });

  it('uses debouncedReload after switching default provider when gateway is running', async () => {
    const gateway = createGateway('running');
    await syncDefaultProviderToRuntime('moonshot', gateway as GatewayManager);
    await flushGatewayRefreshDebounce();

    expect(gateway.debouncedReload).toHaveBeenCalledTimes(1);
    expect(gateway.debouncedRestart).not.toHaveBeenCalled();
  });

  it('hot patches the gateway when only the default model changes on the current default provider', async () => {
    const previousProvider = createProvider({
      model: 'kimi-k2.5',
      metadata: {
        customModels: ['kimi-k2-turbo-preview'],
      },
    });
    const nextProvider = createProvider({
      model: 'kimi-k2-turbo-preview',
      metadata: {
        customModels: ['kimi-k2.5'],
      },
    });
    mocks.getOpenClawProvidersConfig.mockResolvedValue({
      providers: {
        moonshot: {
          baseUrl: 'https://api.moonshot.cn/v1',
          api: 'openai-completions',
          models: [
            { id: 'kimi-k2-turbo-preview', name: 'kimi-k2-turbo-preview' },
            { id: 'kimi-k2.5', name: 'kimi-k2.5' },
          ],
        },
      },
      defaultModel: 'moonshot/kimi-k2-turbo-preview',
    });

    const gateway = createGateway('running');
    vi.mocked(gateway.rpc)
      .mockResolvedValueOnce({ hash: 'cfg-1', config: {} })
      .mockResolvedValueOnce(undefined);

    await syncUpdatedProviderToRuntime(nextProvider, undefined, gateway as GatewayManager, {
      previousConfig: previousProvider,
    });
    await flushGatewayRefreshDebounce();

    expect(gateway.debouncedReload).not.toHaveBeenCalled();
    expect(gateway.debouncedRestart).not.toHaveBeenCalled();
    expect(gateway.rpc).toHaveBeenNthCalledWith(1, 'config.get', {}, 15000);
    expect(gateway.rpc).toHaveBeenNthCalledWith(
      2,
      'config.patch',
      expect.objectContaining({
        baseHash: 'cfg-1',
      }),
      15000,
    );
    const patchPayload = JSON.parse(String(vi.mocked(gateway.rpc).mock.calls[1]?.[1]?.raw || '{}')) as {
      agents?: { defaults?: { model?: { primary?: string; fallbacks?: string[] } } };
      models?: { providers?: Record<string, { api?: string }> };
    };
    expect(patchPayload.agents?.defaults?.model).toEqual({
      primary: 'moonshot/kimi-k2-turbo-preview',
      fallbacks: [],
    });
    expect(patchPayload.models?.providers?.moonshot?.api).toBe('openai-completions');
  });

  it('syncs the full configured model catalog when switching a custom default provider', async () => {
    const customProvider = createProvider({
      id: 'custom-bc28bf7e-5fbc-4016-a36b-66fbc93e9662',
      name: 'JD Compatible',
      type: 'custom',
      model: 'gpt-5.4',
      baseUrl: 'https://agentrs.jd.com/api/saas/openai-u/v1',
      apiProtocol: 'openai-responses',
      metadata: {
        customModels: ['qwen3.5-plus', 'glm-5'],
      },
    });
    mocks.getProvider.mockResolvedValue(customProvider);
    mocks.getProviderConfig.mockReturnValue(undefined);
    mocks.getApiKey.mockResolvedValue('sk-custom');

    const gateway = createGateway('running');
    await syncDefaultProviderToRuntime(customProvider.id, gateway as GatewayManager);
    await flushGatewayRefreshDebounce();

    expect(mocks.syncProviderConfigToOpenClaw).toHaveBeenCalledWith(
      'custom-custombc',
      ['gpt-5.4', 'qwen3.5-plus', 'glm-5'],
      expect.objectContaining({
        baseUrl: 'https://agentrs.jd.com/api/saas/openai-u/v1',
      }),
    );
    expect(mocks.updateAgentModelProvider).toHaveBeenCalledWith(
      'custom-custombc',
      expect.objectContaining({
        models: [
          { id: 'gpt-5.4', name: 'gpt-5.4' },
          { id: 'qwen3.5-plus', name: 'qwen3.5-plus' },
          { id: 'glm-5', name: 'glm-5' },
        ],
      }),
    );
  });

  it('skips refresh after switching default provider when gateway is stopped', async () => {
    const gateway = createGateway('stopped');
    await syncDefaultProviderToRuntime('moonshot', gateway as GatewayManager);
    await flushGatewayRefreshDebounce();

    expect(gateway.debouncedReload).not.toHaveBeenCalled();
    expect(gateway.debouncedRestart).not.toHaveBeenCalled();
  });

  it('uses gpt-5.4 as the browser OAuth default model for OpenAI', async () => {
    mocks.getProvider.mockResolvedValue(
      createProvider({
        id: 'openai-personal',
        type: 'openai',
        model: undefined,
      }),
    );
    mocks.getProviderAccount.mockResolvedValue({ authMode: 'oauth_browser' });
    mocks.getProviderSecret.mockResolvedValue({
      type: 'oauth',
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: 123,
      email: 'user@example.com',
      subject: 'project-1',
    });

    const gateway = createGateway('running');
    await syncDefaultProviderToRuntime('openai-personal', gateway as GatewayManager);

    expect(mocks.setOpenClawDefaultModel).toHaveBeenCalledWith(
      'openai-codex',
      'openai-codex/gpt-5.4',
      expect.any(Array),
    );
  });

  it('syncs a targeted agent model override to runtime provider registry', async () => {
    mocks.getAllProviders.mockResolvedValue([
      createProvider({
        id: 'ark',
        type: 'ark',
        model: 'doubao-pro',
      }),
    ]);
    mocks.getProviderConfig.mockImplementation((providerType: string) => {
      if (providerType === 'ark') {
        return {
          api: 'openai-completions',
          baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
          apiKeyEnv: 'ARK_API_KEY',
        };
      }
      return {
        api: 'openai-completions',
        baseUrl: 'https://api.moonshot.cn/v1',
        apiKeyEnv: 'MOONSHOT_API_KEY',
      };
    });
    mocks.listAgentsSnapshot.mockResolvedValue({
      agents: [
        {
          id: 'coder',
          modelRef: 'ark/ark-code-latest',
        },
      ],
    });

    await syncAgentModelOverrideToRuntime('coder');

    expect(mocks.updateSingleAgentModelProvider).toHaveBeenCalledWith(
      'coder',
      'ark',
      expect.objectContaining({
        baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
        api: 'openai-completions',
        models: [{ id: 'ark-code-latest', name: 'ark-code-latest' }],
      }),
    );
  });

  it('syncs Ollama provider config to runtime without adding model prefix', async () => {
    const ollamaProvider = createProvider({
      id: 'ollamafd',
      type: 'ollama',
      name: 'Ollama',
      model: 'qwen3:30b',
      baseUrl: 'http://localhost:11434/v1',
    });

    mocks.getProviderConfig.mockReturnValue(undefined);
    mocks.getProviderSecret.mockResolvedValue({ type: 'local', apiKey: 'ollama-local' });

    const gateway = createGateway('running');
    await syncSavedProviderToRuntime(ollamaProvider, undefined, gateway as GatewayManager);
    await flushGatewayRefreshDebounce();

    expect(mocks.syncProviderConfigToOpenClaw).toHaveBeenCalledWith(
      'ollamafd',
      ['qwen3:30b'],
      expect.objectContaining({
        baseUrl: 'http://localhost:11434/v1',
        api: 'openai-completions',
      }),
    );
    expect(gateway.debouncedReload).toHaveBeenCalledTimes(1);
  });

  it('syncs Ollama as default provider with correct baseUrl and api protocol', async () => {
    const ollamaProvider = createProvider({
      id: 'ollamafd',
      type: 'ollama',
      name: 'Ollama',
      model: 'qwen3:30b',
      baseUrl: 'http://localhost:11434/v1',
    });

    mocks.getProvider.mockResolvedValue(ollamaProvider);
    mocks.getDefaultProvider.mockResolvedValue('ollamafd');
    mocks.getProviderConfig.mockReturnValue(undefined);
    mocks.getApiKey.mockResolvedValue('ollama-local');

    const gateway = createGateway('running');
    await syncDefaultProviderToRuntime('ollamafd', gateway as GatewayManager);
    await flushGatewayRefreshDebounce();

    expect(mocks.setOpenClawDefaultModelWithOverride).toHaveBeenCalledWith(
      'ollamafd',
      'ollamafd/qwen3:30b',
      expect.objectContaining({
        baseUrl: 'http://localhost:11434/v1',
        api: 'openai-completions',
      }),
      expect.any(Array),
    );
  });
  it('syncs updated Ollama provider as default with correct override config', async () => {
    const ollamaProvider = createProvider({
      id: 'ollamafd',
      type: 'ollama',
      name: 'Ollama',
      model: 'qwen3:30b',
      baseUrl: 'http://localhost:11434/v1',
    });

    mocks.getProviderConfig.mockReturnValue(undefined);
    mocks.getProviderSecret.mockResolvedValue({ type: 'local', apiKey: 'ollama-local' });
    mocks.getDefaultProvider.mockResolvedValue('ollamafd');

    const gateway = createGateway('running');
    await syncUpdatedProviderToRuntime(ollamaProvider, undefined, gateway as GatewayManager);
    await flushGatewayRefreshDebounce();

    // Should use the custom/ollama branch with explicit override
    expect(mocks.setOpenClawDefaultModelWithOverride).toHaveBeenCalledWith(
      'ollamafd',
      'ollamafd/qwen3:30b',
      expect.objectContaining({
        baseUrl: 'http://localhost:11434/v1',
        api: 'openai-completions',
      }),
      expect.any(Array),
    );
    // Should NOT call the non-override path
    expect(mocks.setOpenClawDefaultModel).not.toHaveBeenCalled();
    expect(gateway.debouncedReload).toHaveBeenCalledTimes(1);
  });

  it('removes Ollama provider from runtime on delete', async () => {
    const ollamaProvider = createProvider({
      id: 'ollamafd',
      type: 'ollama',
      name: 'Ollama',
      model: 'qwen3:30b',
      baseUrl: 'http://localhost:11434/v1',
    });

    const gateway = createGateway('running');
    await syncDeletedProviderToRuntime(ollamaProvider, 'ollamafd', gateway as GatewayManager);
    await flushGatewayRefreshDebounce();

    expect(mocks.removeProviderFromOpenClaw).toHaveBeenCalledWith('ollamafd');
    expect(mocks.removeProviderFromOpenClaw).toHaveBeenCalledWith('ollamafd');
    expect(gateway.debouncedRestart).toHaveBeenCalledTimes(1);
  });
});
