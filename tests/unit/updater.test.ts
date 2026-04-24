import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getVersion: () => '0.0.0',
  },
  BrowserWindow: vi.fn(),
  ipcMain: {
    handle: vi.fn(),
  },
}));

vi.mock('@electron/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@electron/main/app-state', () => ({
  setQuitting: vi.fn(),
}));

describe('updater module interop', () => {
  it('resolves autoUpdater from the default export shape', async () => {
    const autoUpdater = {
      on: vi.fn(),
      setFeedURL: vi.fn(),
      checkForUpdates: vi.fn(),
      downloadUpdate: vi.fn(),
      quitAndInstall: vi.fn(),
      autoDownload: false,
      autoInstallOnAppQuit: false,
      logger: null,
      channel: 'latest',
    };

    const { resolveElectronAutoUpdater } = await import('@electron/main/updater');

    expect(resolveElectronAutoUpdater({ default: { autoUpdater } })).toBe(autoUpdater);
  });
});
