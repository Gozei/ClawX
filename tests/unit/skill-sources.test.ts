import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDefaultSkillSources, inferSkillSourceFromBaseDir, type SkillSourceConfig } from '../../electron/utils/skill-sources';

describe('skill source defaults', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('builds the bundled default skill sources', async () => {
    process.env.CLAWHUB_SITE = 'http://127.0.0.1:4000';
    process.env.CLAWHUB_REGISTRY = 'http://127.0.0.1:4011';

    const sources = await buildDefaultSkillSources();

    expect(sources).toHaveLength(2);
    expect(sources.find((source) => source.id === 'clawhub')).toMatchObject({
      id: 'clawhub',
      label: 'ClawHub',
      site: 'https://clawhub.ai',
    });
    expect(sources.find((source) => source.id === 'deepaiworker')).toMatchObject({
      id: 'deepaiworker',
      label: 'DeepSkillHub',
      site: 'http://124.71.100.127:4000',
      registry: 'http://124.71.100.127:4011',
    });
  });

  it('infers the source from a source-scoped skills directory', () => {
    const sources: SkillSourceConfig[] = [
      {
        id: 'clawhub',
        label: 'ClawHub',
        enabled: true,
        site: 'https://clawhub.ai',
        workdir: 'C:\\Users\\tester\\.openclaw\\skill-sources\\clawhub',
      },
      {
        id: 'deepaiworker',
        label: 'deepaiworker',
        enabled: true,
        site: 'http://127.0.0.1:4000',
        registry: 'http://127.0.0.1:4011',
        workdir: 'C:\\Users\\tester\\.openclaw\\skill-sources\\deepaiworker',
      },
    ];

    expect(
      inferSkillSourceFromBaseDir(
        'C:\\Users\\tester\\.openclaw\\skill-sources\\deepaiworker\\skills\\weather',
        sources,
      )?.id,
    ).toBe('deepaiworker');
  });
});
