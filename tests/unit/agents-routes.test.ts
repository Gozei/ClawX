import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalPlatform = process.platform;

const { mockExec } = vi.hoisted(() => ({
  mockExec: vi.fn(),
}));

vi.mock('child_process', () => ({
  exec: mockExec,
  default: {
    exec: mockExec,
  },
}));

vi.mock('@electron/utils/agent-config', () => ({
  applyPreparedAgentModelUpdate: vi.fn(),
  assignChannelToAgent: vi.fn(),
  clearChannelBinding: vi.fn(),
  createAgent: vi.fn(),
  deleteAgentConfig: vi.fn(),
  listAgentsSnapshot: vi.fn(),
  prepareAgentModelUpdate: vi.fn(),
  removeAgentWorkspaceDirectory: vi.fn(),
  resolveAccountIdForAgent: vi.fn(),
  updateAgentModel: vi.fn(),
  updateAgentStudio: vi.fn(),
  updateAgentName: vi.fn(),
}));

vi.mock('@electron/utils/channel-config', () => ({
  deleteChannelAccountConfig: vi.fn(),
}));

vi.mock('@electron/utils/openclaw-auth', () => ({
  getOpenClawProvidersConfig: vi.fn(),
}));

vi.mock('@electron/services/providers/provider-runtime-sync', () => ({
  syncAgentModelRefToRuntime: vi.fn(),
  syncAgentModelOverrideToRuntime: vi.fn(),
  syncAllProviderAuthToRuntime: vi.fn(),
}));

vi.mock('@electron/api/route-utils', () => ({
  parseJsonBody: vi.fn(),
  sendJson: vi.fn(),
}));

import {
  applyPreparedAgentModelUpdate,
  createAgent,
  prepareAgentModelUpdate,
  updateAgentModel,
  updateAgentStudio,
} from '@electron/utils/agent-config';
import {
  syncAgentModelRefToRuntime,
  syncAgentModelOverrideToRuntime,
  syncAllProviderAuthToRuntime,
} from '@electron/services/providers/provider-runtime-sync';
import { getOpenClawProvidersConfig } from '@electron/utils/openclaw-auth';
import { parseJsonBody, sendJson } from '@electron/api/route-utils';

function setPlatform(platform: string): void {
  Object.defineProperty(process, 'platform', { value: platform, writable: true });
}

describe('restartGatewayForAgentDeletion', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
    mockExec.mockImplementation((_cmd: string, _opts: object, cb: (err: Error | null, stdout: string) => void) => {
      cb(null, '');
      return {} as never;
    });
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true });
  });

  it('uses taskkill tree strategy on Windows when gateway pid is known', async () => {
    setPlatform('win32');
    const { restartGatewayForAgentDeletion } = await import('@electron/api/routes/agents');

    const restart = vi.fn().mockResolvedValue(undefined);
    const getStatus = vi.fn(() => ({ pid: 4321, port: 18789 }));

    await restartGatewayForAgentDeletion({
      gatewayManager: {
        getStatus,
        restart,
      },
    } as never);

    expect(mockExec).toHaveBeenCalledWith(
      'taskkill /F /PID 4321 /T',
      expect.any(Function),
    );
    expect(restart).toHaveBeenCalledTimes(1);
  });
});

describe('handleAgentRoutes create flow', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
  });

  it('awaits provider auth sync before returning create success', async () => {
    const { handleAgentRoutes } = await import('@electron/api/routes/agents');

    vi.mocked(parseJsonBody).mockResolvedValue({
      name: 'Writer',
      inheritWorkspace: false,
    });
    vi.mocked(createAgent).mockResolvedValue({
      createdAgentId: 'writer',
      snapshot: {
        agents: [],
        defaultAgentId: 'main',
        defaultModelRef: null,
        configuredChannelTypes: [],
        channelOwners: {},
        channelAccountOwners: {},
      },
    } as never);
    vi.mocked(updateAgentStudio).mockResolvedValue({
      agents: [],
      defaultAgentId: 'main',
      defaultModelRef: null,
      configuredChannelTypes: [],
      channelOwners: {},
      channelAccountOwners: {},
    } as never);

    let synced = false;
    vi.mocked(syncAllProviderAuthToRuntime).mockImplementation(async () => {
      await Promise.resolve();
      synced = true;
    });
    vi.mocked(sendJson).mockImplementation((_res, _status, body) => {
      expect(synced).toBe(true);
      expect(body).toMatchObject({ success: true, createdAgentId: 'writer' });
    });

    await handleAgentRoutes(
      { method: 'POST' } as never,
      {} as never,
      new URL('http://localhost/api/agents'),
      {
        gatewayManager: {
          getStatus: () => ({ state: 'running' }),
          debouncedReload: vi.fn(),
        },
      } as never,
    );
  });
});

describe('handleAgentRoutes model refresh flow', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
  });

  it('uses gateway config.patch for model switches when the gateway is running', async () => {
    const { handleAgentRoutes } = await import('@electron/api/routes/agents');

    vi.mocked(parseJsonBody).mockResolvedValue({ modelRef: 'moonshot/kimi-k2.5' });
    vi.mocked(prepareAgentModelUpdate).mockResolvedValue({
      agentId: 'main',
      config: {
        agents: {
          list: [{ id: 'main', model: { primary: 'moonshot/kimi-k2.5' } }],
        },
      },
      normalizedModelRef: 'moonshot/kimi-k2.5',
      snapshot: {
        agents: [],
        defaultAgentId: 'main',
        defaultModelRef: 'moonshot/kimi-k2.5',
        configuredChannelTypes: [],
        channelOwners: {},
        channelAccountOwners: {},
      },
      studioByAgentId: {},
      studioStateChanged: false,
    } as never);
    vi.mocked(syncAllProviderAuthToRuntime).mockResolvedValue(undefined);
    vi.mocked(syncAgentModelOverrideToRuntime).mockResolvedValue(undefined);
    vi.mocked(getOpenClawProvidersConfig).mockResolvedValue({
      providers: {
        moonshot: {
          baseUrl: 'https://api.moonshot.cn/v1',
          api: 'openai-completions',
          models: [{ id: 'kimi-k2.5', name: 'kimi-k2.5', api: 'openai-completions' }],
        },
      },
    } as never);

    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        hash: 'hash-1',
        config: {
          agents: {
            list: [{ id: 'main' }],
          },
        },
      })
      .mockResolvedValueOnce({ ok: true });

    await handleAgentRoutes(
      { method: 'PUT' } as never,
      {} as never,
      new URL('http://localhost/api/agents/main/model'),
      {
        gatewayManager: {
          getStatus: () => ({ state: 'running' }),
          rpc,
          debouncedReload: vi.fn(),
        },
      } as never,
    );

    expect(rpc).toHaveBeenNthCalledWith(1, 'config.get', {}, 15000);
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      'config.patch',
      {
        baseHash: 'hash-1',
        raw: JSON.stringify({
          agents: {
            list: [{ id: 'main', model: { primary: 'moonshot/kimi-k2.5' } }],
          },
          models: {
            providers: {
              moonshot: {
                baseUrl: 'https://api.moonshot.cn/v1',
                api: 'openai-completions',
                models: [{ id: 'kimi-k2.5', name: 'kimi-k2.5', api: 'openai-completions' }],
              },
            },
          },
        }),
      },
      15000,
    );
    expect(applyPreparedAgentModelUpdate).toHaveBeenCalledTimes(1);
    expect(updateAgentModel).not.toHaveBeenCalled();
  });

  it('falls back to the legacy local update when gateway config.patch fails', async () => {
    const { handleAgentRoutes } = await import('@electron/api/routes/agents');

    vi.mocked(parseJsonBody).mockResolvedValue({ modelRef: 'moonshot/kimi-k2.5' });
    vi.mocked(prepareAgentModelUpdate).mockResolvedValue({
      agentId: 'main',
      config: {
        agents: {
          list: [{ id: 'main', model: { primary: 'moonshot/kimi-k2.5' } }],
        },
      },
      normalizedModelRef: 'moonshot/kimi-k2.5',
      snapshot: {
        agents: [],
        defaultAgentId: 'main',
        defaultModelRef: 'moonshot/kimi-k2.5',
        configuredChannelTypes: [],
        channelOwners: {},
        channelAccountOwners: {},
      },
      studioByAgentId: {},
      studioStateChanged: false,
    } as never);
    vi.mocked(updateAgentModel).mockResolvedValue({
      agents: [],
      defaultAgentId: 'main',
      defaultModelRef: 'moonshot/kimi-k2.5',
      configuredChannelTypes: [],
      channelOwners: {},
      channelAccountOwners: {},
    } as never);
    vi.mocked(syncAllProviderAuthToRuntime).mockResolvedValue(undefined);
    vi.mocked(syncAgentModelOverrideToRuntime).mockResolvedValue(undefined);

    const debouncedReload = vi.fn();
    const restart = vi.fn();
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        hash: 'hash-1',
        config: {
          agents: {
            list: [{ id: 'main' }],
          },
        },
      })
      .mockRejectedValueOnce(new Error('patch failed'));

    await handleAgentRoutes(
      { method: 'PUT' } as never,
      {} as never,
      new URL('http://localhost/api/agents/main/model'),
      {
        gatewayManager: {
          getStatus: () => ({ state: 'running' }),
          rpc,
          debouncedReload,
          restart,
        },
      } as never,
    );

    expect(updateAgentModel).toHaveBeenCalledWith('main', 'moonshot/kimi-k2.5', { setAsDefault: false });
    expect(debouncedReload).toHaveBeenCalledTimes(1);
  });

  it('hot patches the runtime model without persisting agent config', async () => {
    const { handleAgentRoutes } = await import('@electron/api/routes/agents');

    vi.mocked(parseJsonBody).mockResolvedValue({ modelRef: 'moonshot/kimi-k2.5' });
    vi.mocked(prepareAgentModelUpdate).mockResolvedValue({
      agentId: 'main',
      config: {
        agents: {
          list: [{ id: 'main', model: { primary: 'moonshot/kimi-k2.5' } }],
        },
      },
      normalizedModelRef: 'moonshot/kimi-k2.5',
      snapshot: {
        agents: [],
        defaultAgentId: 'main',
        defaultModelRef: 'moonshot/kimi-k2.5',
        configuredChannelTypes: [],
        channelOwners: {},
        channelAccountOwners: {},
      },
      studioByAgentId: {},
      studioStateChanged: false,
    } as never);
    vi.mocked(syncAllProviderAuthToRuntime).mockResolvedValue(undefined);
    vi.mocked(syncAgentModelRefToRuntime).mockResolvedValue(undefined);
    vi.mocked(getOpenClawProvidersConfig).mockResolvedValue({
      providers: {
        moonshot: {
          baseUrl: 'https://api.moonshot.cn/v1',
          api: 'openai-completions',
          models: [{ id: 'kimi-k2.5', name: 'kimi-k2.5', api: 'openai-completions' }],
        },
      },
    } as never);

    const debouncedReload = vi.fn();
    const restart = vi.fn();
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        hash: 'hash-1',
        config: {
          agents: {
            list: [{ id: 'main' }],
          },
        },
      })
      .mockResolvedValueOnce({ ok: true });

    await handleAgentRoutes(
      { method: 'PUT' } as never,
      {} as never,
      new URL('http://localhost/api/agents/main/model/runtime'),
      {
        gatewayManager: {
          getStatus: () => ({ state: 'running' }),
          rpc,
          debouncedReload,
          restart,
        },
      } as never,
    );

    expect(syncAllProviderAuthToRuntime).toHaveBeenCalledTimes(1);
    expect(syncAgentModelRefToRuntime).toHaveBeenCalledWith('main', 'moonshot/kimi-k2.5');
    const modelSyncOrder = vi.mocked(syncAgentModelRefToRuntime).mock.invocationCallOrder[0] ?? 0;
    const configGetOrder = rpc.mock.invocationCallOrder[0] ?? 0;
    expect(modelSyncOrder).toBeGreaterThan(0);
    expect(configGetOrder).toBeGreaterThan(0);
    expect(modelSyncOrder).toBeLessThan(configGetOrder);
    expect(rpc).toHaveBeenNthCalledWith(1, 'config.get', {}, 15000);
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      'config.patch',
      {
        baseHash: 'hash-1',
        raw: JSON.stringify({
          agents: {
            list: [{ id: 'main', model: { primary: 'moonshot/kimi-k2.5' } }],
          },
          models: {
            providers: {
              moonshot: {
                baseUrl: 'https://api.moonshot.cn/v1',
                api: 'openai-completions',
                models: [{ id: 'kimi-k2.5', name: 'kimi-k2.5', api: 'openai-completions' }],
              },
            },
          },
        }),
      },
      15000,
    );
    expect(applyPreparedAgentModelUpdate).not.toHaveBeenCalled();
    expect(updateAgentModel).not.toHaveBeenCalled();
    expect(debouncedReload).not.toHaveBeenCalled();
    expect(restart).not.toHaveBeenCalled();
  });
});
