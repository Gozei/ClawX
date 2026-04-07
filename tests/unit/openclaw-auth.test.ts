import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { testHome, testUserData } = vi.hoisted(() => {
  const suffix = Math.random().toString(36).slice(2);
  return {
    testHome: `/tmp/clawx-openclaw-auth-${suffix}`,
    testUserData: `/tmp/clawx-openclaw-auth-user-data-${suffix}`,
  };
});

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const mocked = {
    ...actual,
    homedir: () => testHome,
  };
  return {
    ...mocked,
    default: mocked,
  };
});

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => testUserData,
    getVersion: () => '0.0.0-test',
  },
}));

async function writeOpenClawJson(config: unknown): Promise<void> {
  const openclawDir = join(testHome, '.openclaw');
  await mkdir(openclawDir, { recursive: true });
  await writeFile(join(openclawDir, 'openclaw.json'), JSON.stringify(config, null, 2), 'utf8');
}

async function readOpenClawJson(): Promise<Record<string, unknown>> {
  const content = await readFile(join(testHome, '.openclaw', 'openclaw.json'), 'utf8');
  return JSON.parse(content) as Record<string, unknown>;
}

async function readManagedProvidersJson(): Promise<Record<string, unknown>> {
  const content = await readFile(
    join(testHome, '.openclaw', 'deep-ai-worker', 'config', 'providers.json'),
    'utf8',
  );
  return JSON.parse(content) as Record<string, unknown>;
}

async function readAuthProfiles(agentId: string): Promise<Record<string, unknown>> {
  const content = await readFile(join(testHome, '.openclaw', 'agents', agentId, 'agent', 'auth-profiles.json'), 'utf8');
  return JSON.parse(content) as Record<string, unknown>;
}

async function writeAgentAuthProfiles(agentId: string, store: Record<string, unknown>): Promise<void> {
  const agentDir = join(testHome, '.openclaw', 'agents', agentId, 'agent');
  await mkdir(agentDir, { recursive: true });
  await writeFile(join(agentDir, 'auth-profiles.json'), JSON.stringify(store, null, 2), 'utf8');
}

describe('saveProviderKeyToOpenClaw', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(testHome, { recursive: true, force: true });
    await rm(testUserData, { recursive: true, force: true });
  });

  it('only syncs auth profiles for configured agents', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          {
            id: 'main',
            name: 'Main',
            default: true,
            workspace: '~/.openclaw/workspace',
            agentDir: '~/.openclaw/agents/main/agent',
          },
          {
            id: 'test3',
            name: 'test3',
            workspace: '~/.openclaw/workspace-test3',
            agentDir: '~/.openclaw/agents/test3/agent',
          },
        ],
      },
    });

    await mkdir(join(testHome, '.openclaw', 'agents', 'test2', 'agent'), { recursive: true });
    await writeFile(
      join(testHome, '.openclaw', 'agents', 'test2', 'agent', 'auth-profiles.json'),
      JSON.stringify({
        version: 1,
        profiles: {
          'legacy:default': {
            type: 'api_key',
            provider: 'legacy',
            key: 'legacy-key',
          },
        },
      }, null, 2),
      'utf8',
    );

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { saveProviderKeyToOpenClaw } = await import('@electron/utils/openclaw-auth');

    await saveProviderKeyToOpenClaw('openrouter', 'sk-test');

    const mainProfiles = await readAuthProfiles('main');
    const test3Profiles = await readAuthProfiles('test3');
    const staleProfiles = await readAuthProfiles('test2');

    expect((mainProfiles.profiles as Record<string, { key: string }>)['openrouter:default'].key).toBe('sk-test');
    expect((test3Profiles.profiles as Record<string, { key: string }>)['openrouter:default'].key).toBe('sk-test');
    expect(staleProfiles.profiles).toEqual({
      'legacy:default': {
        type: 'api_key',
        provider: 'legacy',
        key: 'legacy-key',
      },
    });
    expect(logSpy).toHaveBeenCalledWith(
      'Saved API key for provider "openrouter" to OpenClaw auth-profiles (agents: main, test3)',
    );

    logSpy.mockRestore();
  });

  it('always writes auth profiles to main even when main is not listed in agents.list', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          {
            id: 'agent-4',
            name: '售前解决方案',
            workspace: '~/.openclaw/workspace-agent-4',
            agentDir: '~/.openclaw/agents/agent-4/agent',
          },
        ],
      },
    });

    const { saveProviderKeyToOpenClaw } = await import('@electron/utils/openclaw-auth');
    await saveProviderKeyToOpenClaw('custom-custom36', 'sk-qwen');

    const mainProfiles = await readAuthProfiles('main');

    expect((mainProfiles.profiles as Record<string, { key: string }>)['custom-custom36:default'].key).toBe('sk-qwen');
  });
});

describe('removeProviderKeyFromOpenClaw', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(testHome, { recursive: true, force: true });
    await rm(testUserData, { recursive: true, force: true });
  });

  it('removes only the default api-key profile for a provider', async () => {
    await writeAgentAuthProfiles('main', {
      version: 1,
      profiles: {
        'custom-abc12345:default': {
          type: 'api_key',
          provider: 'custom-abc12345',
          key: 'sk-main',
        },
        'custom-abc12345:backup': {
          type: 'api_key',
          provider: 'custom-abc12345',
          key: 'sk-backup',
        },
      },
      order: {
        'custom-abc12345': [
          'custom-abc12345:default',
          'custom-abc12345:backup',
        ],
      },
      lastGood: {
        'custom-abc12345': 'custom-abc12345:default',
      },
    });

    const { removeProviderKeyFromOpenClaw } = await import('@electron/utils/openclaw-auth');

    await removeProviderKeyFromOpenClaw('custom-abc12345', 'main');

    const mainProfiles = await readAuthProfiles('main');
    expect(mainProfiles.profiles).toEqual({
      'custom-abc12345:backup': {
        type: 'api_key',
        provider: 'custom-abc12345',
        key: 'sk-backup',
      },
    });
    expect(mainProfiles.order).toEqual({
      'custom-abc12345': ['custom-abc12345:backup'],
    });
    expect(mainProfiles.lastGood).toEqual({});
  });

  it('cleans stale default-profile references even when the profile object is already missing', async () => {
    await writeAgentAuthProfiles('main', {
      version: 1,
      profiles: {
        'custom-abc12345:backup': {
          type: 'api_key',
          provider: 'custom-abc12345',
          key: 'sk-backup',
        },
      },
      order: {
        'custom-abc12345': [
          'custom-abc12345:default',
          'custom-abc12345:backup',
        ],
      },
      lastGood: {
        'custom-abc12345': 'custom-abc12345:default',
      },
    });

    const { removeProviderKeyFromOpenClaw } = await import('@electron/utils/openclaw-auth');

    await removeProviderKeyFromOpenClaw('custom-abc12345', 'main');

    const mainProfiles = await readAuthProfiles('main');
    expect(mainProfiles.profiles).toEqual({
      'custom-abc12345:backup': {
        type: 'api_key',
        provider: 'custom-abc12345',
        key: 'sk-backup',
      },
    });
    expect(mainProfiles.order).toEqual({
      'custom-abc12345': ['custom-abc12345:backup'],
    });
    expect(mainProfiles.lastGood).toEqual({});
  });

  it('does not remove oauth default profiles when deleting only an api key', async () => {
    await writeAgentAuthProfiles('main', {
      version: 1,
      profiles: {
        'openai-codex:default': {
          type: 'oauth',
          provider: 'openai-codex',
          access: 'acc',
          refresh: 'ref',
          expires: 1,
        },
      },
      order: {
        'openai-codex': ['openai-codex:default'],
      },
      lastGood: {
        'openai-codex': 'openai-codex:default',
      },
    });

    const { removeProviderKeyFromOpenClaw } = await import('@electron/utils/openclaw-auth');

    await removeProviderKeyFromOpenClaw('openai-codex', 'main');

    const mainProfiles = await readAuthProfiles('main');
    expect(mainProfiles.profiles).toEqual({
      'openai-codex:default': {
        type: 'oauth',
        provider: 'openai-codex',
        access: 'acc',
        refresh: 'ref',
        expires: 1,
      },
    });
    expect(mainProfiles.order).toEqual({
      'openai-codex': ['openai-codex:default'],
    });
    expect(mainProfiles.lastGood).toEqual({
      'openai-codex': 'openai-codex:default',
    });
  });

  it('removes api-key defaults for oauth-capable providers that support api keys', async () => {
    await writeAgentAuthProfiles('main', {
      version: 1,
      profiles: {
        'minimax-portal:default': {
          type: 'api_key',
          provider: 'minimax-portal',
          key: 'sk-minimax',
        },
        'minimax-portal:oauth-backup': {
          type: 'oauth',
          provider: 'minimax-portal',
          access: 'acc',
          refresh: 'ref',
          expires: 1,
        },
      },
      order: {
        'minimax-portal': [
          'minimax-portal:default',
          'minimax-portal:oauth-backup',
        ],
      },
      lastGood: {
        'minimax-portal': 'minimax-portal:default',
      },
    });

    const { removeProviderKeyFromOpenClaw } = await import('@electron/utils/openclaw-auth');

    await removeProviderKeyFromOpenClaw('minimax-portal', 'main');

    const mainProfiles = await readAuthProfiles('main');
    expect(mainProfiles.profiles).toEqual({
      'minimax-portal:oauth-backup': {
        type: 'oauth',
        provider: 'minimax-portal',
        access: 'acc',
        refresh: 'ref',
        expires: 1,
      },
    });
    expect(mainProfiles.order).toEqual({
      'minimax-portal': ['minimax-portal:oauth-backup'],
    });
    expect(mainProfiles.lastGood).toEqual({});
  });
});

describe('sanitizeOpenClawConfig', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(testHome, { recursive: true, force: true });
    await rm(testUserData, { recursive: true, force: true });
  });

  it('skips sanitization when openclaw.json does not exist', async () => {
    // Ensure the .openclaw dir doesn't exist at all
    const { sanitizeOpenClawConfig } = await import('@electron/utils/openclaw-auth');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Should not throw and should not create the file
    await expect(sanitizeOpenClawConfig()).resolves.toBeUndefined();

    const configPath = join(testHome, '.openclaw', 'openclaw.json');
    await expect(readFile(configPath, 'utf8')).rejects.toThrow();

    logSpy.mockRestore();
  });

  it('skips sanitization when openclaw.json contains invalid JSON', async () => {
    // Simulate a corrupted file: readJsonFile returns null, sanitize must bail out
    const openclawDir = join(testHome, '.openclaw');
    await mkdir(openclawDir, { recursive: true });
    const configPath = join(openclawDir, 'openclaw.json');
    await writeFile(configPath, 'NOT VALID JSON {{{', 'utf8');
    const before = await readFile(configPath, 'utf8');

    const { sanitizeOpenClawConfig } = await import('@electron/utils/openclaw-auth');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await sanitizeOpenClawConfig();

    const after = await readFile(configPath, 'utf8');
    // Corrupt file must not be overwritten
    expect(after).toBe(before);

    logSpy.mockRestore();
  });

  it('properly sanitizes a genuinely empty {} config (fresh install)', async () => {
    // A fresh install with {} is a valid config — sanitize should proceed
    // and enforce tools.profile, commands.restart, etc.
    await writeOpenClawJson({});

    const { sanitizeOpenClawConfig } = await import('@electron/utils/openclaw-auth');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await sanitizeOpenClawConfig();

    const configPath = join(testHome, '.openclaw', 'openclaw.json');
    const result = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>;
    // Fresh install should get tools settings enforced
    const tools = result.tools as Record<string, unknown>;
    expect(tools.profile).toBe('full');

    logSpy.mockRestore();
  });

  it('preserves user config (memory, agents, channels) when enforcing tools settings', async () => {
    await writeOpenClawJson({
      agents: { defaults: { model: { primary: 'openai/gpt-4' } } },
      channels: { discord: { token: 'tok', enabled: true } },
      memory: { enabled: true, limit: 100 },
    });

    const { sanitizeOpenClawConfig } = await import('@electron/utils/openclaw-auth');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await sanitizeOpenClawConfig();

    const configPath = join(testHome, '.openclaw', 'openclaw.json');
    const result = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>;

    // User-owned sections must survive the sanitize pass
    expect(result.memory).toEqual({ enabled: true, limit: 100 });
    expect(result.channels).toEqual({ discord: { token: 'tok', enabled: true } });
    expect((result.agents as Record<string, unknown>).defaults).toEqual({
      model: { primary: 'openai/gpt-4' },
    });
    // tools settings should now be enforced
    const tools = result.tools as Record<string, unknown>;
    expect(tools.profile).toBe('full');

    logSpy.mockRestore();
  });
});

describe('auth-backed provider discovery', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(testHome, { recursive: true, force: true });
    await rm(testUserData, { recursive: true, force: true });
  });

  it('detects active providers from openclaw auth profiles and per-agent auth stores', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true, workspace: '~/.openclaw/workspace', agentDir: '~/.openclaw/agents/main/agent' },
          { id: 'work', name: 'Work', workspace: '~/.openclaw/workspace-work', agentDir: '~/.openclaw/agents/work/agent' },
        ],
      },
      auth: {
        profiles: {
          'openai-codex:default': { type: 'oauth', provider: 'openai-codex', access: 'acc', refresh: 'ref', expires: 1 },
          'anthropic:default': { type: 'api_key', provider: 'anthropic', key: 'sk-ant' },
        },
      },
    });

    await writeAgentAuthProfiles('work', {
      version: 1,
      profiles: {
        'google-gemini-cli:default': {
          type: 'oauth',
          provider: 'google-gemini-cli',
          access: 'goog-access',
          refresh: 'goog-refresh',
          expires: 2,
        },
      },
    });

    const { getActiveOpenClawProviders } = await import('@electron/utils/openclaw-auth');

    await expect(getActiveOpenClawProviders()).resolves.toEqual(
      new Set(['openai', 'anthropic', 'google']),
    );
  });

  it('seeds provider config entries from auth profiles when models.providers is empty', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true, workspace: '~/.openclaw/workspace', agentDir: '~/.openclaw/agents/main/agent' },
          { id: 'work', name: 'Work', workspace: '~/.openclaw/workspace-work', agentDir: '~/.openclaw/agents/work/agent' },
        ],
        defaults: {
          model: {
            primary: 'openai/gpt-5.4',
          },
        },
      },
      auth: {
        profiles: {
          'openai-codex:default': { type: 'oauth', provider: 'openai-codex', access: 'acc', refresh: 'ref', expires: 1 },
        },
      },
    });

    await writeAgentAuthProfiles('work', {
      version: 1,
      profiles: {
        'anthropic:default': {
          type: 'api_key',
          provider: 'anthropic',
          key: 'sk-ant',
        },
      },
    });

    const { getOpenClawProvidersConfig } = await import('@electron/utils/openclaw-auth');
    const result = await getOpenClawProvidersConfig();

    expect(result.defaultModel).toBe('openai/gpt-5.4');
    expect(result.providers).toMatchObject({
      openai: {},
      anthropic: {},
    });
  });

  it('removes all matching auth profiles for a deleted provider so it does not reappear', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true, workspace: '~/.openclaw/workspace', agentDir: '~/.openclaw/agents/main/agent' },
          { id: 'work', name: 'Work', workspace: '~/.openclaw/workspace-work', agentDir: '~/.openclaw/agents/work/agent' },
        ],
      },
      models: {
        providers: {
          'custom-abc12345': {
            baseUrl: 'https://api.moonshot.cn/v1',
            api: 'openai-completions',
          },
        },
      },
      auth: {
        profiles: {
          'custom-abc12345:oauth': {
            type: 'oauth',
            provider: 'custom-abc12345',
            access: 'acc',
            refresh: 'ref',
            expires: 1,
          },
          'custom-abc12345:secondary': {
            type: 'api_key',
            provider: 'custom-abc12345',
            key: 'sk-inline',
          },
        },
      },
    });

    await writeAgentAuthProfiles('main', {
      version: 1,
      profiles: {
        'custom-abc12345:default': {
          type: 'api_key',
          provider: 'custom-abc12345',
          key: 'sk-main',
        },
        'custom-abc12345:backup': {
          type: 'api_key',
          provider: 'custom-abc12345',
          key: 'sk-backup',
        },
      },
      order: {
        'custom-abc12345': [
          'custom-abc12345:default',
          'custom-abc12345:backup',
        ],
      },
      lastGood: {
        'custom-abc12345': 'custom-abc12345:backup',
      },
    });

    const {
      getActiveOpenClawProviders,
      getOpenClawProvidersConfig,
      removeProviderFromOpenClaw,
    } = await import('@electron/utils/openclaw-auth');

    await expect(getActiveOpenClawProviders()).resolves.toEqual(new Set(['custom-abc12345']));

    await removeProviderFromOpenClaw('custom-abc12345');

    const mainProfiles = await readAuthProfiles('main');
    const config = await readOpenClawJson();
    const result = await getOpenClawProvidersConfig();

    expect(mainProfiles.profiles).toEqual({});
    expect(mainProfiles.order).toEqual({});
    expect(mainProfiles.lastGood).toEqual({});
    expect((config.auth as { profiles?: Record<string, unknown> }).profiles).toEqual({});
    expect((config.models as { providers?: Record<string, unknown> }).providers).toEqual({});
    expect(result.providers).toEqual({});
    await expect(getActiveOpenClawProviders()).resolves.toEqual(new Set());
  });

  it('writes managed providers state when setting the default model', async () => {
    const { setOpenClawDefaultModel } = await import('@electron/utils/openclaw-auth');

    await setOpenClawDefaultModel('openrouter', 'openrouter/sonic', ['openrouter/mini']);

    const runtimeConfig = await readOpenClawJson();
    const managedProviders = await readManagedProvidersJson();

    expect((runtimeConfig.agents as Record<string, unknown>).defaults).toEqual({
      model: {
        primary: 'openrouter/sonic',
        fallbacks: ['openrouter/mini'],
      },
    });
    expect(managedProviders).toMatchObject({
      version: 1,
      defaultModel: 'openrouter/sonic',
      defaultFallbacks: ['openrouter/mini'],
    });
  });

  it('removes deleted provider from managed providers state as well as runtime config', async () => {
    await writeOpenClawJson({
      agents: {
        defaults: {
          model: {
            primary: 'custom-abc12345/moonshot-v1',
            fallbacks: ['custom-abc12345/moonshot-v1-32k'],
          },
        },
      },
      models: {
        providers: {
          'custom-abc12345': {
            baseUrl: 'https://api.example.com/v1',
            api: 'openai-completions',
          },
        },
      },
    });

    const providersConfigDir = join(testHome, '.openclaw', 'deep-ai-worker', 'config');
    await mkdir(providersConfigDir, { recursive: true });
    await writeFile(
      join(providersConfigDir, 'providers.json'),
      JSON.stringify({
        version: 1,
        updatedAt: new Date().toISOString(),
        providers: {
          'custom-abc12345': {
            baseUrl: 'https://api.example.com/v1',
            api: 'openai-completions',
          },
        },
        defaultModel: 'custom-abc12345/moonshot-v1',
        defaultFallbacks: ['custom-abc12345/moonshot-v1-32k'],
      }, null, 2),
      'utf8',
    );

    const { removeProviderFromOpenClaw, getOpenClawProvidersConfig } = await import('@electron/utils/openclaw-auth');

    await removeProviderFromOpenClaw('custom-abc12345');

    const runtimeConfig = await readOpenClawJson();
    const managedProviders = await readManagedProvidersJson();
    const providerConfig = await getOpenClawProvidersConfig();

    expect((runtimeConfig.models as Record<string, unknown>).providers).toEqual({});
    expect(((runtimeConfig.agents as Record<string, unknown>).defaults as Record<string, unknown>).model).toBeUndefined();
    expect(managedProviders.providers).toEqual({});
    expect('defaultModel' in managedProviders).toBe(false);
    expect(managedProviders.defaultFallbacks).toEqual([]);
    expect(providerConfig).toEqual({
      providers: {},
      defaultModel: undefined,
    });
  });

  it('clears agent-specific model refs when their provider is deleted', async () => {
    await writeOpenClawJson({
      agents: {
        defaults: {
          model: {
            primary: 'custom-custom36/qwen-plus',
            fallbacks: [],
          },
        },
        list: [
          {
            id: 'agent-4',
            name: '售前解决方案',
            model: {
              primary: 'custom-custom36/qwen-plus',
            },
          },
          {
            id: 'agent-5',
            name: '深度研究',
            model: {
              primary: 'deepseek/deepseek-chat',
            },
          },
        ],
      },
      models: {
        providers: {
          'custom-custom36': {
            baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            api: 'openai-responses',
          },
        },
      },
    });

    await mkdir(join(testHome, '.openclaw', 'deep-ai-worker', 'config'), { recursive: true });
    await writeFile(
      join(testHome, '.openclaw', 'deep-ai-worker', 'config', 'providers.json'),
      JSON.stringify({
        version: 1,
        updatedAt: new Date().toISOString(),
        providers: {
          'custom-custom36': {
            baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            api: 'openai-responses',
          },
        },
        defaultModel: 'custom-custom36/qwen-plus',
        defaultFallbacks: [],
      }, null, 2),
      'utf8',
    );

    const { removeProviderFromOpenClaw } = await import('@electron/utils/openclaw-auth');
    await removeProviderFromOpenClaw('custom-custom36');

    const runtimeConfig = await readOpenClawJson();
    const agents = (((runtimeConfig.agents as Record<string, unknown>).list) ?? []) as Array<Record<string, unknown>>;
    const removedAgent = agents.find((agent) => agent.id === 'agent-4');
    const untouchedAgent = agents.find((agent) => agent.id === 'agent-5');

    expect(removedAgent?.model).toBeUndefined();
    expect(untouchedAgent?.model).toEqual({
      primary: 'deepseek/deepseek-chat',
    });
  });
});
