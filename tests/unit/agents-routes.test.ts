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
  assignChannelToAgent: vi.fn(),
  clearChannelBinding: vi.fn(),
  createAgent: vi.fn(),
  deleteAgentConfig: vi.fn(),
  listAgentsSnapshot: vi.fn(),
  removeAgentWorkspaceDirectory: vi.fn(),
  resolveAccountIdForAgent: vi.fn(),
  updateAgentModel: vi.fn(),
  updateAgentStudio: vi.fn(),
  updateAgentName: vi.fn(),
}));

vi.mock('@electron/utils/channel-config', () => ({
  deleteChannelAccountConfig: vi.fn(),
}));

vi.mock('@electron/services/providers/provider-runtime-sync', () => ({
  syncAllProviderAuthToRuntime: vi.fn(),
}));

vi.mock('@electron/api/route-utils', () => ({
  parseJsonBody: vi.fn(),
  sendJson: vi.fn(),
}));

import { createAgent, updateAgentStudio } from '@electron/utils/agent-config';
import { syncAllProviderAuthToRuntime } from '@electron/services/providers/provider-runtime-sync';
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
