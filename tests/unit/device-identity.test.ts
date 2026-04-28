import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  homeDir: '',
}));

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const mocked = {
    ...actual,
    homedir: () => state.homeDir,
  };
  return {
    ...mocked,
    default: mocked,
  };
});

describe('device identity sync', () => {
  afterEach(async () => {
    if (state.homeDir) {
      await rm(state.homeDir, { recursive: true, force: true });
      state.homeDir = '';
    }
  });

  it('writes the ClawX Main identity to the OpenClaw Gateway client identity path', async () => {
    state.homeDir = await mkdtemp(join(tmpdir(), 'clawx-device-identity-'));
    const identity = {
      deviceId: 'device-main',
      publicKeyPem: 'public-key',
      privateKeyPem: 'private-key',
    };

    const { syncDeviceIdentityToOpenClawState } = await import('@electron/utils/device-identity');
    await syncDeviceIdentityToOpenClawState(identity);

    const raw = await readFile(join(state.homeDir, '.openclaw', 'identity', 'device.json'), 'utf8');
    expect(JSON.parse(raw)).toEqual(expect.objectContaining({
      version: 1,
      deviceId: 'device-main',
      publicKeyPem: 'public-key',
      privateKeyPem: 'private-key',
      updatedBy: 'clawx',
    }));
  });
});
