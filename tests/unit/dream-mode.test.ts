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
                frequency: '0 2 * * *',
                timezone: 'Asia/Shanghai',
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
});
