import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hostApiFetchMock = vi.fn();
const gatewayRpcMock = vi.fn();
const guardGatewayTransitioningMock = vi.fn(() => false);

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

vi.mock('@/stores/gateway', () => ({
  guardGatewayTransitioning: (...args: unknown[]) => guardGatewayTransitioningMock(...args),
  useGatewayStore: {
    getState: () => ({
      status: { state: 'running' },
      rpc: (...args: unknown[]) => gatewayRpcMock(...args),
    }),
  },
}));

describe('skills store refresh behavior', () => {
  beforeEach(async () => {
    vi.useRealTimers();
    vi.resetModules();
    hostApiFetchMock.mockReset();
    gatewayRpcMock.mockReset();
    guardGatewayTransitioningMock.mockReset();
    guardGatewayTransitioningMock.mockReturnValue(false);

    const { useSkillsStore } = await import('@/stores/skills');
    useSkillsStore.setState({
      skills: [],
      skillDetailsById: {},
      searchResults: [],
      sources: [],
      loading: false,
      refreshing: false,
      searching: false,
      detailLoadingId: null,
      searchError: null,
      installing: {},
      deleting: {},
      toggling: {},
      toggleTargets: {},
      error: null,
      lastFetchedAt: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('refreshes list and detail after saving config', async () => {
    const { useSkillsStore } = await import('@/stores/skills');

    hostApiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/api/skills/gh-issues/config') {
        return { success: true };
      }
      if (path === '/api/skills') {
        return [{ id: 'gh-issues', name: 'GitHub Issues', description: 'Track issues', enabled: true, ready: true }];
      }
      if (path === '/api/skills/gh-issues') {
        return {
          identity: { id: 'gh-issues', name: 'GitHub Issues', description: 'Track issues' },
          status: { enabled: true, ready: true },
          config: { apiKey: 'token', env: { GH_TOKEN: 'token' }, config: { baseUrl: 'https://api.github.com' } },
          requirements: { primaryEnv: 'GH_TOKEN', requires: { env: ['GH_TOKEN'], config: ['baseUrl'] } },
          configuration: {
            credentials: [{ key: 'GH_TOKEN', label: 'GH_TOKEN', type: 'secret', required: true, configured: true, value: 'token', source: 'apiKey', storageTargets: [{ kind: 'managed-apiKey' }] }],
            optional: [],
            config: [{ key: 'baseUrl', label: 'baseUrl', type: 'url', required: true, configured: true, value: 'https://api.github.com', source: 'config', storageTargets: [{ kind: 'managed-config', key: 'baseUrl' }] }],
            runtime: [],
          },
        };
      }
      throw new Error(`Unexpected path: ${path}`);
    });

    await useSkillsStore.getState().saveSkillConfig('gh-issues', {
      apiKey: 'token',
      env: { GH_TOKEN: 'token' },
      config: { baseUrl: 'https://api.github.com' },
    });

    expect(hostApiFetchMock.mock.calls.map(([path]) => path)).toEqual([
      '/api/skills/gh-issues/config',
      '/api/skills',
      '/api/skills/gh-issues',
    ]);
    expect(useSkillsStore.getState().skills[0]?.ready).toBe(true);
    expect(useSkillsStore.getState().skillDetailsById['gh-issues']?.config.apiKey).toBe('token');
    expect(useSkillsStore.getState().skillDetailsById['gh-issues']?.config.config?.baseUrl).toBe('https://api.github.com');
  });

  it('forces list and detail refresh after enabling a cached skill', async () => {
    const { useSkillsStore } = await import('@/stores/skills');

    useSkillsStore.setState({
      skillDetailsById: {
        'gh-issues': {
          identity: { id: 'gh-issues', name: 'GitHub Issues', description: 'Track issues' },
          status: { enabled: false, ready: false },
          config: {},
          requirements: {},
          configuration: { credentials: [], optional: [], config: [], runtime: [] },
        },
      },
    });

    hostApiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/api/skills') {
        return [{ id: 'gh-issues', name: 'GitHub Issues', description: 'Track issues', enabled: true, ready: true }];
      }
      if (path === '/api/skills/gh-issues') {
        return {
          identity: { id: 'gh-issues', name: 'GitHub Issues', description: 'Track issues' },
          status: { enabled: true, ready: true },
          config: {},
          requirements: {},
          configuration: { credentials: [], optional: [], config: [], runtime: [] },
        };
      }
      throw new Error(`Unexpected path: ${path}`);
    });

    await useSkillsStore.getState().enableSkill('gh-issues');

    expect(gatewayRpcMock).toHaveBeenCalledWith('skills.update', { skillKey: 'gh-issues', enabled: true });
    expect(hostApiFetchMock.mock.calls.map(([path]) => path)).toEqual([
      '/api/skills',
      '/api/skills/gh-issues',
    ]);
    expect(useSkillsStore.getState().skills[0]?.enabled).toBe(true);
    expect(useSkillsStore.getState().skillDetailsById['gh-issues']?.status.ready).toBe(true);
  });

  it('forces list and detail refresh after disabling a cached skill', async () => {
    const { useSkillsStore } = await import('@/stores/skills');

    useSkillsStore.setState({
      skillDetailsById: {
        'gh-issues': {
          identity: { id: 'gh-issues', name: 'GitHub Issues', description: 'Track issues' },
          status: { enabled: true, ready: true },
          config: {},
          requirements: {},
          configuration: { credentials: [], optional: [], config: [], runtime: [] },
        },
      },
    });

    hostApiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/api/skills') {
        return [{ id: 'gh-issues', name: 'GitHub Issues', description: 'Track issues', enabled: false, ready: false }];
      }
      if (path === '/api/skills/gh-issues') {
        return {
          identity: { id: 'gh-issues', name: 'GitHub Issues', description: 'Track issues' },
          status: { enabled: false, ready: false },
          config: {},
          requirements: {},
          configuration: { credentials: [], optional: [], config: [], runtime: [] },
        };
      }
      throw new Error(`Unexpected path: ${path}`);
    });

    await useSkillsStore.getState().disableSkill('gh-issues');

    expect(gatewayRpcMock).toHaveBeenCalledWith('skills.update', { skillKey: 'gh-issues', enabled: false });
    expect(hostApiFetchMock.mock.calls.map(([path]) => path)).toEqual([
      '/api/skills',
      '/api/skills/gh-issues',
    ]);
    expect(useSkillsStore.getState().skills[0]?.enabled).toBe(false);
    expect(useSkillsStore.getState().skillDetailsById['gh-issues']?.status.ready).toBe(false);
  });

  it('updates skill enabled state immediately before the gateway call settles', async () => {
    vi.useFakeTimers();
    const { useSkillsStore } = await import('@/stores/skills');

    let resolveRpc: (() => void) | undefined;
    useSkillsStore.setState({
      skills: [
        { id: 'gh-issues', name: 'GitHub Issues', description: 'Track issues', enabled: false, ready: false },
      ],
    });

    gatewayRpcMock.mockImplementation(() => new Promise<void>((resolve) => {
      resolveRpc = resolve;
    }));

    const request = useSkillsStore.getState().enableSkill('gh-issues');

    expect(useSkillsStore.getState().skills[0]?.enabled).toBe(true);
    expect(useSkillsStore.getState().skills[0]?.ready).toBe(true);

    await vi.advanceTimersByTimeAsync(500);
    expect(resolveRpc).toBeTypeOf('function');

    resolveRpc?.();
    hostApiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/api/skills') {
        return [{ id: 'gh-issues', name: 'GitHub Issues', description: 'Track issues', enabled: true, ready: true }];
      }
      throw new Error(`Unexpected path: ${path}`);
    });

    await request;
    expect(gatewayRpcMock).toHaveBeenCalledWith('skills.update', { skillKey: 'gh-issues', enabled: true });
  });

  it('rolls back optimistic updates when the gateway call fails', async () => {
    vi.useFakeTimers();
    const { useSkillsStore } = await import('@/stores/skills');

    useSkillsStore.setState({
      skills: [
        { id: 'gh-issues', name: 'GitHub Issues', description: 'Track issues', enabled: false, ready: false },
      ],
    });

    gatewayRpcMock.mockRejectedValueOnce(new Error('gateway unavailable'));

    const request = useSkillsStore.getState().enableSkill('gh-issues');
    const rejection = expect(request).rejects.toThrow('gateway unavailable');
    await vi.advanceTimersByTimeAsync(500);

    await rejection;

    expect(useSkillsStore.getState().skills[0]?.enabled).toBe(false);
    expect(useSkillsStore.getState().skills[0]?.ready).toBe(false);
  });

  it('rolls back optimistic updates when gateway starts transitioning during the toggle debounce', async () => {
    vi.useFakeTimers();
    const { useSkillsStore } = await import('@/stores/skills');

    useSkillsStore.setState({
      skills: [
        { id: 'gh-issues', name: 'GitHub Issues', description: 'Track issues', enabled: false, ready: false },
      ],
    });
    guardGatewayTransitioningMock
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);

    const request = useSkillsStore.getState().enableSkill('gh-issues');
    const rejection = expect(request).rejects.toThrow('Gateway is restarting');

    expect(useSkillsStore.getState().skills[0]?.enabled).toBe(true);
    await vi.advanceTimersByTimeAsync(500);
    await rejection;

    expect(gatewayRpcMock).not.toHaveBeenCalled();
    expect(useSkillsStore.getState().skills[0]?.enabled).toBe(false);
    expect(useSkillsStore.getState().skills[0]?.ready).toBe(false);
  });
});
