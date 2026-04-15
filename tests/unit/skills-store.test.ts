import { beforeEach, describe, expect, it, vi } from 'vitest';

const hostApiFetchMock = vi.fn();
const gatewayRpcMock = vi.fn();

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: {
    getState: () => ({
      rpc: (...args: unknown[]) => gatewayRpcMock(...args),
    }),
  },
}));

describe('skills store refresh behavior', () => {
  beforeEach(async () => {
    vi.resetModules();
    hostApiFetchMock.mockReset();
    gatewayRpcMock.mockReset();

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
      error: null,
      lastFetchedAt: null,
    });
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
          skill: { id: 'gh-issues', name: 'GitHub Issues', description: 'Track issues', enabled: true, ready: true },
          runtime: {},
          config: { apiKey: 'token', env: { GH_TOKEN: 'token' } },
          spec: { primaryEnv: 'GH_TOKEN' },
        };
      }
      throw new Error(`Unexpected path: ${path}`);
    });

    await useSkillsStore.getState().saveSkillConfig('gh-issues', {
      apiKey: 'token',
      env: { GH_TOKEN: 'token' },
    });

    expect(hostApiFetchMock.mock.calls.map(([path]) => path)).toEqual([
      '/api/skills/gh-issues/config',
      '/api/skills',
      '/api/skills/gh-issues',
    ]);
    expect(useSkillsStore.getState().skills[0]?.ready).toBe(true);
    expect(useSkillsStore.getState().skillDetailsById['gh-issues']?.config.apiKey).toBe('token');
  });

  it('forces list and detail refresh after enabling a cached skill', async () => {
    const { useSkillsStore } = await import('@/stores/skills');

    useSkillsStore.setState({
      skillDetailsById: {
        'gh-issues': {
          skill: { id: 'gh-issues', name: 'GitHub Issues', description: 'Track issues', enabled: false, ready: false },
          runtime: {},
          config: {},
          spec: {},
        },
      },
    });

    hostApiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/api/skills') {
        return [{ id: 'gh-issues', name: 'GitHub Issues', description: 'Track issues', enabled: true, ready: true }];
      }
      if (path === '/api/skills/gh-issues') {
        return {
          skill: { id: 'gh-issues', name: 'GitHub Issues', description: 'Track issues', enabled: true, ready: true },
          runtime: {},
          config: {},
          spec: {},
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
    expect(useSkillsStore.getState().skillDetailsById['gh-issues']?.skill.ready).toBe(true);
  });

  it('forces list and detail refresh after disabling a cached skill', async () => {
    const { useSkillsStore } = await import('@/stores/skills');

    useSkillsStore.setState({
      skillDetailsById: {
        'gh-issues': {
          skill: { id: 'gh-issues', name: 'GitHub Issues', description: 'Track issues', enabled: true, ready: true },
          runtime: {},
          config: {},
          spec: {},
        },
      },
    });

    hostApiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/api/skills') {
        return [{ id: 'gh-issues', name: 'GitHub Issues', description: 'Track issues', enabled: false, ready: false }];
      }
      if (path === '/api/skills/gh-issues') {
        return {
          skill: { id: 'gh-issues', name: 'GitHub Issues', description: 'Track issues', enabled: false, ready: false },
          runtime: {},
          config: {},
          spec: {},
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
    expect(useSkillsStore.getState().skillDetailsById['gh-issues']?.skill.ready).toBe(false);
  });
});
