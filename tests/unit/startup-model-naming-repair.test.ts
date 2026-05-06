import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { testHome, testUserData } = vi.hoisted(() => {
  const suffix = Math.random().toString(36).slice(2);
  return {
    testHome: `/tmp/clawx-startup-model-naming-${suffix}`,
    testUserData: `/tmp/clawx-startup-model-naming-user-data-${suffix}`,
  };
});

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
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

async function writeProviderStore(value: unknown): Promise<void> {
  await mkdir(testUserData, { recursive: true });
  await writeFile(join(testUserData, 'clawx-providers.json'), JSON.stringify(value, null, 2), 'utf8');
}

async function readProviderStore(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(testUserData, 'clawx-providers.json'), 'utf8')) as Record<string, unknown>;
}

async function writeOpenClawConfig(value: unknown): Promise<void> {
  const openclawDir = join(testHome, '.openclaw');
  await mkdir(openclawDir, { recursive: true });
  await writeFile(join(openclawDir, 'openclaw.json'), JSON.stringify(value, null, 2), 'utf8');
}

async function readOpenClawConfig(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(testHome, '.openclaw', 'openclaw.json'), 'utf8')) as Record<string, unknown>;
}

async function writeSessions(agentId: string, value: unknown): Promise<void> {
  const sessionsDir = join(testHome, '.openclaw', 'agents', agentId, 'sessions');
  await mkdir(sessionsDir, { recursive: true });
  await writeFile(join(sessionsDir, 'sessions.json'), JSON.stringify(value, null, 2), 'utf8');
}

async function readSessions(agentId: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(testHome, '.openclaw', 'agents', agentId, 'sessions', 'sessions.json'), 'utf8')) as Record<string, unknown>;
}

describe('runStartupModelNamingRepair', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(testHome, { recursive: true, force: true });
    await rm(testUserData, { recursive: true, force: true });
  });

  it('repairs provider, runtime, and session model naming while preserving slash model ids', async () => {
    await writeProviderStore({
      schemaVersion: 0,
      providerAccounts: {
        bigmodel: {
          id: 'bigmodel',
          vendorId: 'custom',
          label: 'BigModel',
          authMode: 'api_key',
          model: 'bigmodel/glm-5.1',
          metadata: {
            customModels: ['a', undefined, null, ' ', 'bigmodel/glm-5.1'],
          },
          fallbackModels: ['bigmodel/glm-5.1'],
          enabled: true,
          isDefault: false,
          createdAt: '2026-05-06T00:00:00.000Z',
          updatedAt: '2026-05-06T00:00:00.000Z',
        },
        openrouter: {
          id: 'openrouter',
          vendorId: 'openrouter',
          label: 'OpenRouter',
          authMode: 'api_key',
          model: 'anthropic/claude-sonnet',
          metadata: {
            customModels: ['anthropic/claude-sonnet'],
          },
          enabled: true,
          isDefault: false,
          createdAt: '2026-05-06T00:00:00.000Z',
          updatedAt: '2026-05-06T00:00:00.000Z',
        },
      },
      defaultProviderAccountId: null,
    });

    await writeOpenClawConfig({
      models: {
        providers: {
          bigmodel: {
            models: [{ id: 'bigmodel/glm-5.1', name: 'bigmodel/glm-5.1' }],
          },
          openrouter: {
            models: [{ id: 'anthropic/claude-sonnet', name: 'anthropic/claude-sonnet' }],
          },
        },
      },
      agents: {
        defaults: {
          model: {
            primary: 'bigmodel/bigmodel/glm-5.1',
            fallbacks: ['openrouter/anthropic/claude-sonnet'],
          },
        },
      },
    });

    await writeSessions('main', {
      'agent:main:main': {
        modelProvider: 'bigmodel',
        model: 'bigmodel/glm-5.1',
        providerOverride: 'bigmodel',
        modelOverride: 'bigmodel/glm-5.1',
      },
      'agent:main:router': {
        modelProvider: 'openrouter',
        model: 'anthropic/claude-sonnet',
        providerOverride: 'openrouter',
        modelOverride: 'anthropic/claude-sonnet',
      },
    });

    const { runStartupModelNamingRepair } = await import('@electron/startup-self-check/model-naming-repair');
    const report = await runStartupModelNamingRepair();

    expect(report.changed).toBe(true);
    expect(report.providerStoreFixes).toBeGreaterThan(0);
    expect(report.runtimeConfigFixes).toBeGreaterThan(0);
    expect(report.sessionFixes).toBeGreaterThan(0);

    const providerStore = await readProviderStore() as {
      providerAccounts?: Record<string, {
        model?: string;
        metadata?: { runtimeProviderKey?: string; customModels?: string[] };
        fallbackModels?: string[];
      }>;
    };
    expect(providerStore.providerAccounts?.bigmodel?.metadata?.runtimeProviderKey).toBe('bigmodel');
    expect(providerStore.providerAccounts?.bigmodel?.model).toBe('glm-5.1');
    expect(providerStore.providerAccounts?.bigmodel?.metadata?.customModels).toEqual(['a', 'glm-5.1']);
    expect(providerStore.providerAccounts?.bigmodel?.fallbackModels).toEqual(['glm-5.1']);
    expect(providerStore.providerAccounts?.openrouter?.model).toBe('anthropic/claude-sonnet');
    expect(providerStore.providerAccounts?.openrouter?.metadata?.customModels).toEqual(['anthropic/claude-sonnet']);

    const runtimeConfig = await readOpenClawConfig() as {
      models?: { providers?: Record<string, { models?: Array<{ id?: string; name?: string }> }> };
      agents?: { defaults?: { model?: { primary?: string; fallbacks?: string[] } } };
    };
    expect(runtimeConfig.models?.providers?.bigmodel?.models?.[0]).toMatchObject({
      id: 'glm-5.1',
      name: 'glm-5.1',
    });
    expect(runtimeConfig.models?.providers?.openrouter?.models?.[0]).toMatchObject({
      id: 'anthropic/claude-sonnet',
      name: 'anthropic/claude-sonnet',
    });
    expect(runtimeConfig.agents?.defaults?.model?.primary).toBe('bigmodel/glm-5.1');
    expect(runtimeConfig.agents?.defaults?.model?.fallbacks).toEqual(['openrouter/anthropic/claude-sonnet']);

    const sessions = await readSessions('main') as Record<string, Record<string, string>>;
    expect(sessions['agent:main:main']).toMatchObject({
      modelProvider: 'bigmodel',
      model: 'glm-5.1',
      providerOverride: 'bigmodel',
      modelOverride: 'glm-5.1',
    });
    expect(sessions['agent:main:router']).toMatchObject({
      modelProvider: 'openrouter',
      model: 'anthropic/claude-sonnet',
      providerOverride: 'openrouter',
      modelOverride: 'anthropic/claude-sonnet',
    });

    const idempotentReport = await runStartupModelNamingRepair();
    expect(idempotentReport.changed).toBe(false);
  });
});
