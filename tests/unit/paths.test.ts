import { afterEach, describe, expect, it, vi } from 'vitest';

const originalLocalOpenClawDir = process.env.CLAWX_OPENCLAW_LOCAL_DIR;
const originalPlatform = process.platform;

function setPlatform(platform: string) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

describe('OpenClaw path resolution', () => {
  afterEach(() => {
    if (originalLocalOpenClawDir === undefined) {
      delete process.env.CLAWX_OPENCLAW_LOCAL_DIR;
    } else {
      process.env.CLAWX_OPENCLAW_LOCAL_DIR = originalLocalOpenClawDir;
    }
    setPlatform(originalPlatform);
    vi.resetModules();
  });

  it('uses CLAWX_OPENCLAW_LOCAL_DIR in development mode', async () => {
    process.env.CLAWX_OPENCLAW_LOCAL_DIR = '~/Projects/openclaw';

    const { getOpenClawDir } = await import('@electron/utils/paths');

    expect(getOpenClawDir()).toContain('Projects');
    expect(getOpenClawDir()).toContain('openclaw');
    expect(getOpenClawDir()).not.toContain('node_modules');
  });

  it('normalizes MSYS-style local OpenClaw paths on Windows', async () => {
    setPlatform('win32');
    process.env.CLAWX_OPENCLAW_LOCAL_DIR = '/c/Users/szdee/Projects/openclaw';

    const { getOpenClawDir } = await import('@electron/utils/paths');

    expect(getOpenClawDir()).toBe('C:\\Users\\szdee\\Projects\\openclaw');
  });
});
