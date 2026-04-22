import { _electron as electron, expect, test as base, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

type LaunchElectronOptions = {
  skipSetup?: boolean;
  setupStep?: string;
};

type ElectronFixtures = {
  electronApp: ElectronApplication;
  page: Page;
  homeDir: string;
  userDataDir: string;
  launchElectronApp: (options?: LaunchElectronOptions) => Promise<ElectronApplication>;
};

type HostApiMockResponse = {
  ok: boolean;
  data?: unknown;
  error?: unknown;
};

type ElectronIpcMocks = {
  gatewayStatus?: Record<string, unknown>;
  openclawStatus?: Record<string, unknown>;
  uvInstallAll?: Record<string, unknown>;
  hostApi?: Record<string, HostApiMockResponse>;
};

const repoRoot = resolve(process.cwd());
const electronEntry = join(repoRoot, 'dist-electron/main/index.js');

async function allocatePort(): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to allocate an ephemeral port')));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolvePort(port);
      });
    });
  });
}

async function getStableWindow(app: ElectronApplication): Promise<Page> {
  const deadline = Date.now() + 30_000;
  let page = await app.firstWindow();

  while (Date.now() < deadline) {
    const openWindows = app.windows().filter((candidate) => !candidate.isClosed());
    const currentWindow = openWindows.at(-1) ?? page;

    if (currentWindow && !currentWindow.isClosed()) {
      try {
        await currentWindow.waitForLoadState('domcontentloaded', { timeout: 2_000 });
        return currentWindow;
      } catch (error) {
        if (!String(error).includes('has been closed')) {
          throw error;
        }
      }
    }

    try {
      page = await app.waitForEvent('window', { timeout: 2_000 });
    } catch {
      // Keep polling until a stable window is available or the deadline expires.
    }
  }

  throw new Error('No stable Electron window became available');
}

async function closeElectronApp(app: ElectronApplication, timeoutMs = 5_000): Promise<void> {
  let closed = false;

  await Promise.race([
    (async () => {
      const [closeResult] = await Promise.allSettled([
        app.waitForEvent('close', { timeout: timeoutMs }),
        app.evaluate(({ app: electronApp }) => {
          electronApp.quit();
        }),
      ]);

      if (closeResult.status === 'fulfilled') {
        closed = true;
      }
    })(),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);

  if (closed) {
    return;
  }

  try {
    await app.close();
    return;
  } catch {
    // Fall through to process kill if Playwright cannot close the app cleanly.
  }

  try {
    app.process().kill('SIGKILL');
  } catch {
    // Ignore process kill failures during e2e teardown.
  }
}

async function removeTempDir(targetDir: string): Promise<void> {
  await rm(targetDir, {
    recursive: true,
    force: true,
    maxRetries: 8,
    retryDelay: 250,
  });
}

async function launchDeepAiWorkerElectron(
  homeDir: string,
  userDataDir: string,
  options: LaunchElectronOptions = {},
): Promise<ElectronApplication> {
  const hostApiPort = await allocatePort();
  const electronEnv = process.platform === 'linux'
    ? { ELECTRON_DISABLE_SANDBOX: '1' }
    : {};
  return await electron.launch({
    args: [electronEntry],
    env: {
      ...process.env,
      ...electronEnv,
      HOME: homeDir,
      USERPROFILE: homeDir,
      APPDATA: join(homeDir, 'AppData', 'Roaming'),
      LOCALAPPDATA: join(homeDir, 'AppData', 'Local'),
      XDG_CONFIG_HOME: join(homeDir, '.config'),
      CLAWX_E2E: '1',
      CLAWX_USER_DATA_DIR: userDataDir,
      ...(options.skipSetup ? { CLAWX_E2E_SKIP_SETUP: '1' } : {}),
      ...(options.setupStep ? { CLAWX_E2E_SETUP_STEP: options.setupStep } : {}),
      CLAWX_PORT_CLAWX_HOST_API: String(hostApiPort),
    },
    timeout: 90_000,
  });
}

export const test = base.extend<ElectronFixtures>({
  homeDir: async ({ browserName: _browserName }, provideHomeDir) => {
    const homeDir = await mkdtemp(join(tmpdir(), 'clawx-e2e-home-'));
    await mkdir(join(homeDir, '.config'), { recursive: true });
    await mkdir(join(homeDir, 'AppData', 'Local'), { recursive: true });
    await mkdir(join(homeDir, 'AppData', 'Roaming'), { recursive: true });
    try {
      await provideHomeDir(homeDir);
    } finally {
      await removeTempDir(homeDir);
    }
  },

  userDataDir: async ({ browserName: _browserName }, provideUserDataDir) => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'clawx-e2e-user-data-'));
    try {
      await provideUserDataDir(userDataDir);
    } finally {
      await removeTempDir(userDataDir);
    }
  },

  launchElectronApp: async ({ homeDir, userDataDir }, provideLauncher) => {
    await provideLauncher(async (options?: LaunchElectronOptions) => await launchDeepAiWorkerElectron(homeDir, userDataDir, options));
  },

  electronApp: async ({ launchElectronApp }, provideElectronApp) => {
    const app = await launchElectronApp();
    let appClosed = false;
    app.once('close', () => {
      appClosed = true;
    });

    try {
      await provideElectronApp(app);
    } finally {
      if (!appClosed) {
        await closeElectronApp(app);
      }
    }
  },

  page: async ({ electronApp }, providePage) => {
    const page = await getStableWindow(electronApp);
    await providePage(page);
  },
});

export async function completeSetup(page: Page): Promise<void> {
  await expect(page.getByTestId('setup-page')).toBeVisible();
  await page.getByTestId('setup-skip-button').click();
  await expect(page.getByTestId('main-layout')).toBeVisible();
}

export async function openSettingsHub(page: Page): Promise<void> {
  await page.getByTestId('sidebar-nav-settings').click();
  await expect(page.getByTestId('settings-hub-sheet-container')).toBeVisible();
  await expect(page.getByTestId('settings-hub-menu-settings')).toBeVisible();
}

export async function closeSettingsHub(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('settings-hub-sheet-container')).toHaveCount(0);
}

export async function openModelsFromSettings(page: Page): Promise<void> {
  await openSettingsHub(page);
  await page.getByTestId('settings-hub-menu-models').click();
  await expect(page.getByTestId('models-page')).toBeVisible();
}

export async function openChannelsFromSettings(page: Page): Promise<void> {
  await openSettingsHub(page);
  await page.getByTestId('settings-hub-menu-channels').click();
  await expect(page.getByTestId('channels-page')).toBeVisible();
}

export async function installIpcMocks(
  app: ElectronApplication,
  mocks: ElectronIpcMocks,
): Promise<void> {
  await app.evaluate(({ ipcMain }, mockConfig) => {
    function stableStringify(value: unknown): string {
      if (value == null || typeof value !== 'object') return JSON.stringify(value);
      if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
      const entries = Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
      return `{${entries.join(',')}}`;
    }

    if (mockConfig?.gatewayStatus) {
      ipcMain.removeHandler('gateway:status');
      ipcMain.handle('gateway:status', async () => mockConfig.gatewayStatus);
    }

    if (mockConfig?.openclawStatus) {
      ipcMain.removeHandler('openclaw:status');
      ipcMain.handle('openclaw:status', async () => mockConfig.openclawStatus);
    }

    if (mockConfig?.uvInstallAll) {
      ipcMain.removeHandler('uv:install-all');
      ipcMain.handle('uv:install-all', async () => mockConfig.uvInstallAll);
    }

    if (mockConfig?.hostApi) {
      ipcMain.removeHandler('hostapi:fetch');
      ipcMain.handle(
        'hostapi:fetch',
        async (_event, request: { path?: string; method?: string }) => {
          const method = request?.method ?? 'GET';
          const path = request?.path ?? '';
          const requestKey = stableStringify([path, method]);
          const mockedResponse = mockConfig.hostApi?.[requestKey];

          if (mockedResponse) {
            return mockedResponse;
          }

          return {
            ok: false,
            error: {
              message: `Unexpected hostapi:fetch request: ${method} ${path}`,
            },
          };
        },
      );
    }
  }, mocks);
}

export { closeElectronApp };
export { getStableWindow };
export { expect };
