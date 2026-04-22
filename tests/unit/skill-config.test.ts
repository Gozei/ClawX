import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { testHome } = vi.hoisted(() => {
  const suffix = Math.random().toString(36).slice(2);
  const systemTmp = process.env.TMPDIR || process.env.TEMP || process.env.TMP || '/tmp';
  const separator = process.platform === 'win32' ? '\\' : '/';
  const normalizedTmp = systemTmp.replace(/[\\/]+$/, '');
  return {
    testHome: `${normalizedTmp}${separator}clawx-skill-config-${suffix}`,
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

async function writeOpenClawJson(config: unknown): Promise<void> {
  const openclawDir = join(testHome, '.openclaw');
  await mkdir(openclawDir, { recursive: true });
  await writeFile(join(openclawDir, 'openclaw.json'), JSON.stringify(config, null, 2), 'utf8');
}

async function readOpenClawJson(): Promise<Record<string, unknown>> {
  const content = await readFile(join(testHome, '.openclaw', 'openclaw.json'), 'utf8');
  return JSON.parse(content) as Record<string, unknown>;
}

async function readManagedSkillsJson(): Promise<Record<string, unknown>> {
  const content = await readFile(join(testHome, '.openclaw', 'deep-ai-worker', 'config', 'skills.json'), 'utf8');
  return JSON.parse(content) as Record<string, unknown>;
}

describe('skill-config managed assembly', () => {
  beforeEach(async () => {
    vi.resetModules();
    await rm(testHome, { recursive: true, force: true });
  });

  it('reads legacy skill entries from openclaw.json before managed state exists', async () => {
    await writeOpenClawJson({
      skills: {
        entries: {
          alpha: {
            enabled: true,
            apiKey: 'sk-test',
          },
        },
      },
    });

    const { getAllSkillConfigs } = await import('@electron/utils/skill-config');
    const configs = await getAllSkillConfigs();

    expect(configs).toEqual({
      alpha: {
        enabled: true,
        apiKey: 'sk-test',
      },
    });

    const managed = await readManagedSkillsJson();
    expect(managed).toMatchObject({
      version: 1,
      entries: {
        alpha: {
          enabled: true,
          apiKey: 'sk-test',
        },
      },
    });
  });

  it('writes managed skills state and syncs it back into openclaw.json', async () => {
    await writeOpenClawJson({
      gateway: {
        reload: {
          mode: 'hybrid',
        },
      },
      skills: {
        entries: {
          alpha: {
            enabled: true,
          },
        },
      },
    });

    const { updateSkillConfig } = await import('@electron/utils/skill-config');
    const result = await updateSkillConfig('alpha', {
      apiKey: 'sk-live',
      env: {
        FOO: 'bar',
      },
      config: {
        baseUrl: 'https://api.example.com',
        retries: 3,
      },
    });

    expect(result).toEqual({ success: true });

    const managed = await readManagedSkillsJson();
    expect(managed).toMatchObject({
      version: 1,
      entries: {
        alpha: {
          enabled: true,
          apiKey: 'sk-live',
          env: {
            FOO: 'bar',
          },
          config: {
            baseUrl: 'https://api.example.com',
            retries: 3,
          },
        },
      },
    });

    const runtime = await readOpenClawJson();
    expect(runtime.gateway).toEqual({
      reload: {
        mode: 'hybrid',
      },
    });
    expect(runtime.skills).toEqual({
      entries: {
        alpha: {
          enabled: true,
          apiKey: 'sk-live',
          env: {
            FOO: 'bar',
          },
          config: {
            baseUrl: 'https://api.example.com',
            retries: 3,
          },
        },
      },
    });
  });
});
