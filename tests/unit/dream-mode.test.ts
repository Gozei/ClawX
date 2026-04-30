import { describe, expect, it } from 'vitest';
import { applyDreamModeToOpenClawConfig } from '@electron/utils/dream-mode';

describe('dream mode config sync', () => {
  it('enables memory-core dreaming while preserving existing config', () => {
    const result = applyDreamModeToOpenClawConfig({
      plugins: {
        entries: {
          'memory-core': {
            enabled: false,
            config: {
              dreaming: {
                frequency: '0 2 * * *',
                timezone: 'Asia/Shanghai',
              },
            },
          },
        },
      },
    }, true);

    expect(result).toEqual({
      plugins: {
        entries: {
          'memory-core': {
            enabled: true,
            config: {
              dreaming: {
                enabled: true,
                frequency: '0 3 * * *',
                timezone: 'Asia/Shanghai',
                phases: {
                  light: {
                    lookbackDays: 2,
                    limit: 100,
                  },
                  deep: {
                    limit: 10,
                    minScore: 0.8,
                    minRecallCount: 3,
                    minUniqueQueries: 3,
                    recencyHalfLifeDays: 14,
                    maxAgeDays: 30,
                  },
                  rem: {
                    lookbackDays: 7,
                    limit: 10,
                    minPatternStrength: 0.75,
                  },
                },
              },
            },
          },
        },
      },
    });
  });

  it('disables existing dreaming config without removing other memory-core settings', () => {
    const result = applyDreamModeToOpenClawConfig({
      plugins: {
        entries: {
          'memory-core': {
            enabled: true,
            config: {
              memorySearch: { provider: 'ollama' },
              dreaming: {
                enabled: true,
                verboseLogging: true,
              },
            },
          },
        },
      },
    }, false);

    const memoryCore = ((result.plugins as Record<string, unknown>).entries as Record<string, Record<string, unknown>>)['memory-core'];
    expect(memoryCore.config).toEqual({
      memorySearch: { provider: 'ollama' },
      dreaming: {
        enabled: false,
        verboseLogging: true,
      },
    });
  });

  it('does not create memory-core config when disabled on a clean config', () => {
    const input = { commands: { restart: true } };
    const result = applyDreamModeToOpenClawConfig(input, false);
    expect(result).toBe(input);
  });

  it('maps aggressive promotion speed to easier dreaming promotion thresholds', () => {
    const result = applyDreamModeToOpenClawConfig({
      plugins: {
        entries: {
          'memory-core': {
            enabled: true,
            config: {
              dreaming: {
                enabled: true,
              },
            },
          },
        },
      },
    }, true, 'aggressive');

    const memoryCore = ((result.plugins as Record<string, unknown>).entries as Record<string, Record<string, unknown>>)['memory-core'];
    expect(memoryCore.config).toEqual({
      dreaming: {
        enabled: true,
        frequency: '0 3 * * *',
        phases: {
          light: {
            lookbackDays: 7,
            limit: 240,
          },
          deep: {
            limit: 32,
            minScore: 0.42,
            minRecallCount: 1,
            minUniqueQueries: 1,
            recencyHalfLifeDays: 45,
            maxAgeDays: 120,
          },
          rem: {
            lookbackDays: 30,
            limit: 32,
            minPatternStrength: 0.45,
          },
        },
      },
    });
  });
});
