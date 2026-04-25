import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  closeElectronApp,
  getStableWindow,
  installIpcMocks,
} from './fixtures/electron';

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
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolvePort(address.port);
      });
    });
  });
}

async function launchElectron(userDataDir: string): Promise<ElectronApplication> {
  const hostApiPort = await allocatePort();
  const {
    ELECTRON_RUN_AS_NODE: _electronRunAsNode,
    ...parentEnv
  } = process.env;

  return await electron.launch({
    args: [electronEntry],
    env: {
      ...parentEnv,
      ...(process.platform === 'linux' ? { ELECTRON_DISABLE_SANDBOX: '1' } : {}),
      CLAWX_E2E: '1',
      CLAWX_E2E_SKIP_SETUP: '1',
      CLAWX_USER_DATA_DIR: userDataDir,
      CLAWX_PORT_CLAWX_HOST_API: String(hostApiPort),
    },
    timeout: 90_000,
  });
}

async function setLanguage(page: Page, language: string): Promise<void> {
  await page.evaluate(async (nextLanguage) => {
    await window.electron.ipcRenderer.invoke('settings:set', 'language', nextLanguage);
  }, language);
}

test.describe('WeChat channel branding', () => {
  test('renders the app name in Chinese QR setup instructions', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'clawx-e2e-user-data-'));
    await mkdir(userDataDir, { recursive: true });
    const app = await launchElectron(userDataDir);

    try {
      const page = await getStableWindow(app);
      await page.setViewportSize({ width: 1440, height: 900 });
      await expect(page.getByTestId('main-layout')).toBeVisible();

      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
        hostApi: {
          '["/api/channels/accounts","GET"]': {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                channels: [],
              },
            },
          },
          '["/api/agents","GET"]': {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                agents: [],
              },
            },
          },
        },
      });

      await setLanguage(page, 'zh-CN');
      await page.evaluate(() => {
        window.location.hash = '#/channels';
      });
      await expect(page.getByTestId('channels-page')).toBeVisible();
      await page.getByRole('button', { name: /WeChat/ }).first().click({ force: true });

      await expect(page.locator('h3').filter({ hasText: /WeChat/ }).last()).toBeVisible();
      const instructions = page.locator('ol').filter({ hasText: 'Deep AI Worker' }).first();
      await expect(instructions).toContainText('Deep AI Worker');
      await expect(instructions).not.toContainText('{{appName}}');
    } finally {
      await closeElectronApp(app);
      await rm(userDataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
    }
  });
});
