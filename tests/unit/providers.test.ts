import { describe, expect, it } from 'vitest';
import {
  PROVIDER_TYPES,
  PROVIDER_TYPE_INFO,
  type ProviderAccount,
  type ProviderVendorInfo,
  getProviderDocsUrl,
  getRecommendedModelOptions,
  resolveProviderApiKeyForSave,
  resolveProviderModelForSave,
  shouldShowProviderModelId,
} from '@/lib/providers';
import {
  buildConfiguredModelEntries,
  buildProviderListItems,
} from '@/lib/provider-accounts';
import {
  BUILTIN_PROVIDER_TYPES,
  getProviderConfig,
  getProviderEnvVar,
  getProviderEnvVars,
} from '@electron/utils/provider-registry';

describe('provider metadata', () => {
  it('includes ark in the frontend provider registry', () => {
    expect(PROVIDER_TYPES).toContain('ark');

    expect(PROVIDER_TYPE_INFO).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'ark',
          name: 'ByteDance Ark',
          requiresApiKey: true,
          defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
          showBaseUrl: true,
          showModelId: true,
          codePlanPresetBaseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
          codePlanPresetModelId: 'ark-code-latest',
          codePlanDocsUrl: 'https://www.volcengine.com/docs/82379/1928261?lang=zh',
        }),
      ])
    );
  });

  it('includes ark in the backend provider registry', () => {
    expect(BUILTIN_PROVIDER_TYPES).toContain('ark');
    expect(getProviderEnvVar('ark')).toBe('ARK_API_KEY');
    expect(getProviderConfig('ark')).toEqual({
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      api: 'openai-completions',
      apiKeyEnv: 'ARK_API_KEY',
    });
  });

  it('uses a single canonical env key for moonshot provider', () => {
    expect(getProviderEnvVar('moonshot')).toBe('MOONSHOT_API_KEY');
    expect(getProviderEnvVars('moonshot')).toEqual(['MOONSHOT_API_KEY']);
    expect(getProviderConfig('moonshot')).toEqual(
      expect.objectContaining({
        baseUrl: 'https://api.moonshot.cn/v1',
        apiKeyEnv: 'MOONSHOT_API_KEY',
      })
    );
  });

  it('includes deepseek in the frontend and backend provider registries', () => {
    expect(PROVIDER_TYPES).toContain('deepseek');
    expect(BUILTIN_PROVIDER_TYPES).toContain('deepseek');

    expect(PROVIDER_TYPE_INFO).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'deepseek',
          name: 'DeepSeek',
          requiresApiKey: true,
          defaultBaseUrl: 'https://api.deepseek.com',
          showBaseUrl: true,
          showModelId: true,
          defaultModelId: 'deepseek-v4-pro',
          docsUrlZh: 'https://api-docs.deepseek.com/zh-cn/',
        }),
      ])
    );
    expect(getProviderEnvVar('deepseek')).toBe('DEEPSEEK_API_KEY');
    expect(getProviderConfig('deepseek')).toEqual(
      expect.objectContaining({
        baseUrl: 'https://api.deepseek.com',
        api: 'openai-completions',
        apiKeyEnv: 'DEEPSEEK_API_KEY',
      })
    );
  });

  it('keeps builtin provider sources in sync', () => {
    expect(BUILTIN_PROVIDER_TYPES).toEqual(
      expect.arrayContaining(['anthropic', 'openai', 'google', 'openrouter', 'ark', 'moonshot', 'siliconflow', 'deepseek', 'minimax-portal', 'minimax-portal-cn', 'modelstudio', 'ollama'])
    );
  });

  it('uses OpenAI-compatible Ollama default base URL', () => {
    expect(PROVIDER_TYPE_INFO).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'ollama',
          defaultBaseUrl: 'http://localhost:11434/v1',
          requiresApiKey: false,
          showBaseUrl: true,
          showModelId: true,
        }),
      ])
    );
  });

  it('exposes provider documentation links', () => {
    const anthropic = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'anthropic');
    const openrouter = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'openrouter');
    const moonshot = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'moonshot');
    const siliconflow = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'siliconflow');
    const deepseek = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'deepseek');
    const ark = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'ark');
    const custom = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'custom');

    expect(anthropic).toMatchObject({
      docsUrl: 'https://platform.claude.com/docs/en/api/overview',
    });
    expect(getProviderDocsUrl(anthropic, 'en')).toBe('https://platform.claude.com/docs/en/api/overview');
    expect(getProviderDocsUrl(openrouter, 'en')).toBe('https://openrouter.ai/models');
    expect(getProviderDocsUrl(moonshot, 'en')).toBe('https://platform.moonshot.cn/');
    expect(getProviderDocsUrl(siliconflow, 'en')).toBe('https://docs.siliconflow.cn/cn/userguide/introduction');
    expect(getProviderDocsUrl(deepseek, 'en')).toBe('https://api-docs.deepseek.com/');
    expect(getProviderDocsUrl(deepseek, 'zh-CN')).toBe('https://api-docs.deepseek.com/zh-cn/');
    expect(getProviderDocsUrl(ark, 'en')).toBe('https://www.volcengine.com/');
    expect(getProviderDocsUrl(custom, 'en')).toBe(
      'https://docs.qq.com/aio/p/scchzbdpjgz9ho4?p=5mPH8jZ09MQrPfAQhQhzUD'
    );
    expect(getProviderDocsUrl(custom, 'zh-CN')).toBe(
      'https://docs.qq.com/aio/p/scchzbdpjgz9ho4?p=5mPH8jZ09MQrPfAQhQhzUD'
    );
  });

  it('exposes OpenRouter model overrides by default and gates SiliconFlow behind dev mode', () => {
    const openrouter = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'openrouter');
    const siliconflow = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'siliconflow');

    expect(openrouter).toMatchObject({
      showModelId: true,
      defaultModelId: 'openai/gpt-5.4',
    });
    expect(siliconflow).toMatchObject({
      showModelId: true,
      showModelIdInDevModeOnly: true,
      defaultModelId: 'deepseek-ai/DeepSeek-V3',
    });

    expect(shouldShowProviderModelId(openrouter, false)).toBe(true);
    expect(shouldShowProviderModelId(siliconflow, false)).toBe(false);
    expect(shouldShowProviderModelId(openrouter, true)).toBe(true);
    expect(shouldShowProviderModelId(siliconflow, true)).toBe(true);
  });

  it('shows OAuth model overrides only in dev mode and preserves defaults', () => {
    const openai = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'openai');
    const google = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'google');
    const minimax = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'minimax-portal');
    const minimaxCn = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'minimax-portal-cn');
    const qwen = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'modelstudio');

    expect(openai).toMatchObject({ showModelId: true, showModelIdInDevModeOnly: true, defaultModelId: 'gpt-5.4' });
    expect(google).toMatchObject({ showModelId: true, showModelIdInDevModeOnly: true, defaultModelId: 'gemini-3-pro-preview' });
    expect(minimax).toMatchObject({ showModelId: true, showModelIdInDevModeOnly: true, defaultModelId: 'MiniMax-M2.7' });
    expect(minimaxCn).toMatchObject({ showModelId: true, showModelIdInDevModeOnly: true, defaultModelId: 'MiniMax-M2.7' });
    expect(qwen).toMatchObject({ showModelId: true, showModelIdInDevModeOnly: true, defaultModelId: 'qwen3.5-plus' });

    expect(shouldShowProviderModelId(openai, false)).toBe(false);
    expect(shouldShowProviderModelId(google, false)).toBe(false);
    expect(shouldShowProviderModelId(minimax, false)).toBe(false);
    expect(shouldShowProviderModelId(minimaxCn, false)).toBe(false);
    expect(shouldShowProviderModelId(qwen, false)).toBe(false);

    expect(shouldShowProviderModelId(openai, true)).toBe(true);
    expect(shouldShowProviderModelId(google, true)).toBe(true);
    expect(shouldShowProviderModelId(minimax, true)).toBe(true);
    expect(shouldShowProviderModelId(minimaxCn, true)).toBe(true);
    expect(shouldShowProviderModelId(qwen, true)).toBe(true);

    expect(resolveProviderModelForSave(openai, '   ', false)).toBe('gpt-5.4');
    expect(resolveProviderModelForSave(google, '   ', false)).toBe('gemini-3-pro-preview');
    expect(resolveProviderModelForSave(minimax, '   ', false)).toBe('MiniMax-M2.7');
    expect(resolveProviderModelForSave(minimaxCn, '   ', false)).toBe('MiniMax-M2.7');
    expect(resolveProviderModelForSave(qwen, '   ', false)).toBe('qwen3.5-plus');

    expect(resolveProviderModelForSave(openai, '   ', true)).toBe('gpt-5.4');
    expect(resolveProviderModelForSave(google, '   ', true)).toBe('gemini-3-pro-preview');
    expect(resolveProviderModelForSave(minimax, '   ', true)).toBe('MiniMax-M2.7');
    expect(resolveProviderModelForSave(minimaxCn, '   ', true)).toBe('MiniMax-M2.7');
    expect(resolveProviderModelForSave(qwen, '   ', true)).toBe('qwen3.5-plus');
  });

  it('saves OpenRouter model overrides by default and SiliconFlow only in dev mode', () => {
    const openrouter = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'openrouter');
    const siliconflow = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'siliconflow');
    const ark = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'ark');

    expect(resolveProviderModelForSave(openrouter, 'openai/gpt-5', false)).toBe('openai/gpt-5');
    expect(resolveProviderModelForSave(siliconflow, 'Qwen/Qwen3-Coder-480B-A35B-Instruct', false)).toBe('Qwen/Qwen3-Coder-480B-A35B-Instruct');

    expect(resolveProviderModelForSave(openrouter, 'openai/gpt-5', true)).toBe('openai/gpt-5');
    expect(resolveProviderModelForSave(siliconflow, 'Qwen/Qwen3-Coder-480B-A35B-Instruct', true)).toBe('Qwen/Qwen3-Coder-480B-A35B-Instruct');

    expect(resolveProviderModelForSave(openrouter, '   ', false)).toBe('openai/gpt-5.4');
    expect(resolveProviderModelForSave(openrouter, '   ', true)).toBe('openai/gpt-5.4');
    expect(resolveProviderModelForSave(siliconflow, '   ', false)).toBe('deepseek-ai/DeepSeek-V3');
    expect(resolveProviderModelForSave(siliconflow, '   ', true)).toBe('deepseek-ai/DeepSeek-V3');
    expect(resolveProviderModelForSave(ark, '  ep-custom-model  ', false)).toBe('ep-custom-model');
  });

  it('normalizes provider API keys for save flow', () => {
    expect(resolveProviderApiKeyForSave('ollama', '')).toBe('ollama-local');
    expect(resolveProviderApiKeyForSave('ollama', '   ')).toBe('ollama-local');
    expect(resolveProviderApiKeyForSave('ollama', 'real-key')).toBe('real-key');
    expect(resolveProviderApiKeyForSave('openai', '')).toBeUndefined();
    expect(resolveProviderApiKeyForSave('openai', ' sk-test ')).toBe('sk-test');
  });

  it('recommends DeepSeek model ids for the DeepSeek provider', () => {
    expect(getRecommendedModelOptions('deepseek').map((option) => option.value)).toEqual([
      'deepseek-v4-pro',
      'deepseek-v4-flash',
    ]);
  });

  it('falls back to the vendor default model when a configured account is missing an explicit model', () => {
    const accounts: ProviderAccount[] = [
      {
        id: 'siliconflow',
        vendorId: 'siliconflow',
        label: 'SiliconFlow (CN)',
        authMode: 'api_key',
        baseUrl: 'https://api.siliconflow.cn/v1',
        enabled: true,
        isDefault: true,
        createdAt: '2026-04-23T00:00:00.000Z',
        updatedAt: '2026-04-23T00:00:00.000Z',
      },
    ];
    const statuses = [
      {
        id: 'siliconflow',
        name: 'SiliconFlow (CN)',
        type: 'siliconflow',
        enabled: true,
        createdAt: '2026-04-23T00:00:00.000Z',
        updatedAt: '2026-04-23T00:00:00.000Z',
        hasKey: true,
        keyMasked: '****',
      },
    ];
    const vendors: ProviderVendorInfo[] = [
      {
        ...(PROVIDER_TYPE_INFO.find((provider) => provider.id === 'siliconflow') as ProviderVendorInfo),
        category: 'compatible',
        supportedAuthModes: ['api_key'],
        defaultAuthMode: 'api_key',
        supportsMultipleAccounts: false,
      },
    ];

    const items = buildProviderListItems(accounts, statuses, vendors, 'siliconflow');
    const configuredModels = items[0]?.models.filter((model) => model.source !== 'recommended');

    expect(configuredModels).toEqual([
      expect.objectContaining({
        id: 'deepseek-ai/DeepSeek-V3',
        isDefault: true,
        source: 'default',
      }),
    ]);
  });

  it('returns every saved configured model entry without cross-account dedupe', () => {
    const accounts: ProviderAccount[] = [
      {
        id: 'openai',
        vendorId: 'openai',
        label: 'OpenAI Main',
        authMode: 'api_key',
        baseUrl: 'https://api.openai.com/v1',
        apiProtocol: 'openai-completions',
        model: 'gpt-5.4',
        enabled: true,
        isDefault: true,
        createdAt: '2026-04-23T00:00:00.000Z',
        updatedAt: '2026-04-23T00:00:00.000Z',
        metadata: {
          customModels: ['gpt-5.4-mini'],
          modelProtocols: {
            'gpt-5.4': 'openai-completions',
            'gpt-5.4-mini': 'openai-completions',
          },
        },
      },
      {
        id: 'openai-duplicate',
        vendorId: 'openai',
        label: 'OpenAI Main',
        authMode: 'api_key',
        baseUrl: 'https://api.openai.com/v1',
        apiProtocol: 'openai-completions',
        model: 'gpt-5.4',
        enabled: true,
        isDefault: false,
        createdAt: '2026-04-23T00:00:00.000Z',
        updatedAt: '2026-04-23T00:00:01.000Z',
        metadata: {
          modelProtocols: {
            'gpt-5.4': 'openai-completions',
          },
        },
      },
    ];
    const statuses = [
      {
        id: 'openai',
        name: 'OpenAI Main',
        type: 'openai',
        enabled: true,
        createdAt: '2026-04-23T00:00:00.000Z',
        updatedAt: '2026-04-23T00:00:00.000Z',
        hasKey: true,
        keyMasked: '****',
        model: 'gpt-5.4',
      },
      {
        id: 'openai-duplicate',
        name: 'OpenAI Main',
        type: 'openai',
        enabled: true,
        createdAt: '2026-04-23T00:00:00.000Z',
        updatedAt: '2026-04-23T00:00:01.000Z',
        hasKey: true,
        keyMasked: '****',
        model: 'gpt-5.4',
      },
    ];
    const vendors: ProviderVendorInfo[] = [
      {
        ...(PROVIDER_TYPE_INFO.find((provider) => provider.id === 'openai') as ProviderVendorInfo),
        category: 'official',
        supportedAuthModes: ['api_key', 'oauth_browser'],
        defaultAuthMode: 'api_key',
        supportsMultipleAccounts: false,
      },
    ];

    const rows = buildConfiguredModelEntries(accounts, statuses, vendors, 'openai');

    expect(rows).toEqual([
      expect.objectContaining({
        key: 'openai:gpt-5.4',
        modelId: 'gpt-5.4',
        isGlobalDefault: true,
      }),
      expect.objectContaining({
        key: 'openai:gpt-5.4-mini',
        modelId: 'gpt-5.4-mini',
        isGlobalDefault: false,
      }),
      expect.objectContaining({
        key: 'openai-duplicate:gpt-5.4',
        modelId: 'gpt-5.4',
        isGlobalDefault: false,
      }),
    ]);
  });

  it('merges duplicate compatible providers into one display item with a friendly name', () => {
    const accounts: ProviderAccount[] = [
      {
        id: 'zai',
        vendorId: 'custom',
        label: 'Zai',
        authMode: 'api_key',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        model: 'zai/glm-5',
        enabled: true,
        isDefault: true,
        createdAt: '2026-04-04T00:00:00.000Z',
        updatedAt: '2026-04-04T00:00:00.000Z',
      },
      {
        id: 'custom-zai',
        vendorId: 'custom',
        label: 'Custom-zai',
        authMode: 'api_key',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        enabled: true,
        isDefault: false,
        createdAt: '2026-04-04T00:00:00.000Z',
        updatedAt: '2026-04-04T00:00:00.000Z',
      },
      {
        id: 'custom-customfb',
        vendorId: 'custom',
        label: 'Custom-customfb',
        authMode: 'api_key',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        enabled: true,
        isDefault: false,
        createdAt: '2026-04-04T00:00:00.000Z',
        updatedAt: '2026-04-04T00:00:00.000Z',
      },
    ];
    const statuses = [
      {
        id: 'zai',
        name: 'Zai',
        type: 'custom',
        enabled: true,
        createdAt: '2026-04-04T00:00:00.000Z',
        updatedAt: '2026-04-04T00:00:00.000Z',
        hasKey: true,
        keyMasked: '****',
        model: 'zai/glm-5',
      },
      {
        id: 'custom-customfb',
        name: 'Custom-customfb',
        type: 'custom',
        enabled: true,
        createdAt: '2026-04-04T00:00:00.000Z',
        updatedAt: '2026-04-04T00:00:00.000Z',
        hasKey: true,
        keyMasked: '****',
        model: 'qwen3.5-plus',
      },
    ];
    const vendors: ProviderVendorInfo[] = [
      {
        ...(PROVIDER_TYPE_INFO.find((provider) => provider.id === 'custom') as ProviderVendorInfo),
        category: 'custom',
        supportedAuthModes: ['api_key'],
        defaultAuthMode: 'api_key',
        supportsMultipleAccounts: true,
      },
    ];

    const items = buildProviderListItems(accounts, statuses, vendors, 'zai');
    const zaiItem = items.find((item) => item.displayName === '智谱 Z.ai');
    const qwenItem = items.find((item) => item.displayName === '阿里百炼 / Qwen');

    expect(items).toHaveLength(2);
    expect(zaiItem).toMatchObject({
      displayName: '智谱 Z.ai',
      resolvedModel: 'zai/glm-5',
    });
    expect(zaiItem?.aliases).toHaveLength(2);
    expect(qwenItem).toMatchObject({
      displayName: '阿里百炼 / Qwen',
      resolvedModel: 'qwen3.5-plus',
    });
  });

  it('surfaces configured custom models ahead of recommended models', () => {
    const accounts: ProviderAccount[] = [
      {
        id: 'openrouter-test',
        vendorId: 'openrouter',
        label: 'OpenRouter',
        authMode: 'api_key',
        model: 'openai/gpt-5.4',
        metadata: {
          customModels: ['anthropic/claude-sonnet-4', 'google/gemini-3-pro-preview'],
        },
        enabled: true,
        isDefault: true,
        createdAt: '2026-04-04T00:00:00.000Z',
        updatedAt: '2026-04-04T00:00:00.000Z',
      },
    ];
    const statuses = [
      {
        id: 'openrouter-test',
        name: 'OpenRouter',
        type: 'openrouter',
        enabled: true,
        createdAt: '2026-04-04T00:00:00.000Z',
        updatedAt: '2026-04-04T00:00:00.000Z',
        hasKey: true,
        keyMasked: '****',
        model: 'openai/gpt-5.4',
      },
    ];
    const vendors: ProviderVendorInfo[] = [
      {
        ...(PROVIDER_TYPE_INFO.find((provider) => provider.id === 'openrouter') as ProviderVendorInfo),
        category: 'official',
        supportedAuthModes: ['api_key'],
        defaultAuthMode: 'api_key',
        supportsMultipleAccounts: true,
      },
    ];

    const items = buildProviderListItems(accounts, statuses, vendors, 'openrouter-test');

    expect(items).toHaveLength(1);
    expect(items[0].resolvedModel).toBe('openai/gpt-5.4');
    expect(items[0].models.slice(0, 3).map((model) => model.id)).toEqual([
      'openai/gpt-5.4',
      'anthropic/claude-sonnet-4',
      'google/gemini-3-pro-preview',
    ]);
    expect(items[0].models[1]?.source).toBe('configured');
    expect(items[0].models[2]?.source).toBe('configured');
  });
});
