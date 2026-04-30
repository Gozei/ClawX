import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderAccount } from '@electron/shared/providers/types';

const { testHome, testUserData } = vi.hoisted(() => {
  const suffix = Math.random().toString(36).slice(2);
  return {
    testHome: `/tmp/clawx-model-reference-repair-${suffix}`,
    testUserData: `/tmp/clawx-model-reference-repair-user-data-${suffix}`,
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

function makeAccount(overrides: Partial<ProviderAccount> = {}): ProviderAccount {
  return {
    id: 'openai',
    vendorId: 'openai' as ProviderAccount['vendorId'],
    label: 'OpenAI',
    authMode: 'api_key',
    model: 'gpt-5.4',
    enabled: true,
    isDefault: false,
    createdAt: '2026-04-30T00:00:00.000Z',
    updatedAt: '2026-04-30T00:00:00.000Z',
    ...overrides,
  };
}

async function writeOpenClawJson(config: unknown): Promise<void> {
  const openclawDir = join(testHome, '.openclaw');
  await mkdir(openclawDir, { recursive: true });
  await writeFile(join(openclawDir, 'openclaw.json'), JSON.stringify(config, null, 2), 'utf8');
}

async function readOpenClawJson(): Promise<Record<string, unknown>> {
  const content = await readFile(join(testHome, '.openclaw', 'openclaw.json'), 'utf8');
  return JSON.parse(content) as Record<string, unknown>;
}

describe('repairInvalidModelReferences', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(testHome, { recursive: true, force: true });
    await rm(testUserData, { recursive: true, force: true });
  });

  it('replaces stale global, agent, and session model references with available defaults', async () => {
    await writeOpenClawJson({
      agents: {
        defaults: {
          model: {
            primary: 'openai/deleted-model',
            fallbacks: ['openai/deleted-model', 'openai/gpt-5.4-mini'],
          },
        },
        list: [
          { id: 'main', name: 'Main', model: { primary: 'openai/deleted-model' } },
          { id: 'research', name: 'Research', model: { primary: 'openai/gpt-5.4-mini' } },
        ],
      },
    });

    const mainSessionsDir = join(testHome, '.openclaw', 'agents', 'main', 'sessions');
    const researchSessionsDir = join(testHome, '.openclaw', 'agents', 'research', 'sessions');
    await mkdir(mainSessionsDir, { recursive: true });
    await mkdir(researchSessionsDir, { recursive: true });
    await writeFile(join(mainSessionsDir, 'sessions.json'), JSON.stringify({
      'agent:main:main': {
        modelProvider: 'openai',
        model: 'deleted-model',
        providerOverride: 'openai',
        modelOverride: 'deleted-model',
      },
    }, null, 2), 'utf8');
    await writeFile(join(researchSessionsDir, 'sessions.json'), JSON.stringify({
      'agent:research:desk': {
        modelProvider: 'openai',
        model: 'deleted-model',
        providerOverride: 'openai',
        modelOverride: 'deleted-model',
      },
    }, null, 2), 'utf8');

    const { repairInvalidModelReferences } = await import('@electron/utils/model-reference-repair');
    const result = await repairInvalidModelReferences([
      makeAccount({
        id: 'openai',
        model: 'gpt-5.4',
        metadata: { customModels: ['gpt-5.4-mini'] },
      }),
    ], 'openai');

    expect(result).toMatchObject({
      changed: true,
      globalModelChanged: true,
      agentModelFixes: 1,
      sessionModelFixes: 2,
    });

    const config = await readOpenClawJson() as {
      agents?: {
        defaults?: { model?: { primary?: string; fallbacks?: string[] } };
        list?: Array<{ id: string; model?: { primary?: string } }>;
      };
    };
    expect(config.agents?.defaults?.model?.primary).toBe('openai/gpt-5.4');
    expect(config.agents?.defaults?.model?.fallbacks).toEqual(['openai/gpt-5.4-mini']);
    expect(config.agents?.list?.find((agent) => agent.id === 'main')?.model).toBeUndefined();
    expect(config.agents?.list?.find((agent) => agent.id === 'research')?.model?.primary).toBe('openai/gpt-5.4-mini');

    const mainSessions = JSON.parse(await readFile(join(mainSessionsDir, 'sessions.json'), 'utf8')) as Record<string, Record<string, string>>;
    const researchSessions = JSON.parse(await readFile(join(researchSessionsDir, 'sessions.json'), 'utf8')) as Record<string, Record<string, string>>;
    expect(mainSessions['agent:main:main']).toMatchObject({
      modelProvider: 'openai',
      model: 'gpt-5.4',
      providerOverride: 'openai',
      modelOverride: 'gpt-5.4',
    });
    expect(researchSessions['agent:research:desk']).toMatchObject({
      modelProvider: 'openai',
      model: 'gpt-5.4-mini',
      providerOverride: 'openai',
      modelOverride: 'gpt-5.4-mini',
    });
  });
});
