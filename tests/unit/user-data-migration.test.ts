import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/Deep AI Worker',
  },
}));
import { mergeProviderStoreData } from '@electron/utils/user-data-migration';

describe('user-data migration', () => {
  it('restores legacy provider secrets into the renamed app user-data store', () => {
    const legacyStore = {
      schemaVersion: 2,
      providerAccounts: {
        zai: {
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
        'custom-fbf': {
          id: 'custom-fbf',
          vendorId: 'custom',
          label: '阿里云百炼',
          authMode: 'api_key',
          baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
          model: 'qwen3.5-plus',
          enabled: true,
          isDefault: false,
          createdAt: '2026-04-04T00:00:00.000Z',
          updatedAt: '2026-04-04T00:00:00.000Z',
        },
      },
      providerSecrets: {
        zai: { type: 'api_key', accountId: 'zai', apiKey: 'zai-secret' },
        'custom-fbf': { type: 'api_key', accountId: 'custom-fbf', apiKey: 'dashscope-secret' },
      },
      apiKeys: {
        zai: 'zai-secret',
        'custom-fbf': 'dashscope-secret',
      },
      defaultProviderAccountId: 'zai',
    };

    const currentStore = {
      schemaVersion: 2,
      providerAccounts: {
        zai: {
          id: 'zai',
          vendorId: 'custom',
          label: 'Zai',
          authMode: 'api_key',
          baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
          model: 'zai/glm-5',
          enabled: true,
          isDefault: false,
          createdAt: '2026-04-04T01:00:00.000Z',
          updatedAt: '2026-04-04T01:00:00.000Z',
        },
        'custom-customfb': {
          id: 'custom-customfb',
          vendorId: 'custom',
          label: 'Custom-customfb',
          authMode: 'api_key',
          baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
          enabled: true,
          isDefault: false,
          createdAt: '2026-04-04T01:00:00.000Z',
          updatedAt: '2026-04-04T01:00:00.000Z',
        },
      },
      providerSecrets: {},
      apiKeys: {},
      defaultProviderAccountId: null,
    };

    const merged = mergeProviderStoreData(legacyStore, currentStore);

    expect(merged.defaultProviderAccountId).toBe('zai');
    expect(merged.apiKeys).toMatchObject({
      zai: 'zai-secret',
      'custom-customfb': 'dashscope-secret',
    });
    expect(merged.providerSecrets).toMatchObject({
      zai: { type: 'api_key', accountId: 'zai', apiKey: 'zai-secret' },
      'custom-customfb': {
        type: 'api_key',
        accountId: 'custom-customfb',
        apiKey: 'dashscope-secret',
      },
    });
  });

  it('keeps newer provider secrets when the current store already has them', () => {
    const legacyStore = {
      providerAccounts: {
        deepseek: {
          id: 'deepseek',
          vendorId: 'custom',
          label: 'Deepseek',
          authMode: 'api_key',
          baseUrl: 'https://api.deepseek.com',
          enabled: true,
          isDefault: false,
          createdAt: '2026-04-04T00:00:00.000Z',
          updatedAt: '2026-04-04T00:00:00.000Z',
        },
      },
      providerSecrets: {
        deepseek: { type: 'api_key', accountId: 'deepseek', apiKey: 'legacy-secret' },
      },
      apiKeys: {
        deepseek: 'legacy-secret',
      },
    };

    const currentStore = {
      providerAccounts: {
        deepseek: {
          id: 'deepseek',
          vendorId: 'custom',
          label: 'Deepseek',
          authMode: 'api_key',
          baseUrl: 'https://api.deepseek.com',
          enabled: true,
          isDefault: false,
          createdAt: '2026-04-04T01:00:00.000Z',
          updatedAt: '2026-04-04T01:00:00.000Z',
        },
      },
      providerSecrets: {
        deepseek: { type: 'api_key', accountId: 'deepseek', apiKey: 'current-secret' },
      },
      apiKeys: {
        deepseek: 'current-secret',
      },
    };

    const merged = mergeProviderStoreData(legacyStore, currentStore);

    expect(merged.apiKeys).toMatchObject({
      deepseek: 'current-secret',
    });
    expect(merged.providerSecrets).toMatchObject({
      deepseek: { type: 'api_key', accountId: 'deepseek', apiKey: 'current-secret' },
    });
  });
});
