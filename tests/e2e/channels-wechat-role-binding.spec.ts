import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
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

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

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

test.describe('WeChat channel role binding', () => {
  test('shows WeChat accounts without bot IDs and binds each account role', async () => {
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
          [stableStringify(['/api/channels/accounts', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                channels: [
                  {
                    channelType: 'wechat',
                    defaultAccountId: 'wx-a-im-bot',
                    status: 'connected',
                    accounts: [
                      {
                        accountId: 'wx-a-im-bot',
                        name: 'Alice WeChat',
                        configured: true,
                        status: 'connected',
                        isDefault: true,
                        agentId: 'sales',
                        lastError: "Cannot read properties of undefined (reading 'logger')",
                      },
                      {
                        accountId: 'wx-b-im-bot',
                        name: 'Bob WeChat',
                        configured: true,
                        status: 'connected',
                        isDefault: false,
                        agentId: 'main',
                      },
                    ],
                  },
                ],
              },
            },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                agents: [
                  { id: 'main', name: 'Main Role' },
                  { id: 'sales', name: 'Sales Role' },
                ],
              },
            },
          },
          [stableStringify(['/api/channels/binding', 'PUT'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { success: true },
            },
          },
        },
      });

      await page.evaluate(() => {
        window.location.hash = '#/channels';
      });
      await expect(page.getByTestId('channels-page')).toBeVisible();

      await expect(page.getByRole('heading', { name: 'WeChat' })).toBeVisible();
      await expect(page.getByText('wx-a-im-bot')).toHaveCount(0);
      await expect(page.getByText('wx-b-im-bot')).toHaveCount(0);
      await expect(page.getByText(/Cannot read properties of undefined/)).toHaveCount(0);
      await expect(page.getByText('Alice WeChat')).toBeVisible();
      await expect(page.getByText('Bob WeChat')).toBeVisible();

      const roleSelectors = page.locator('select');
      await expect(roleSelectors).toHaveCount(2);
      await roleSelectors.nth(1).selectOption('sales');

      await page.getByRole('button', { name: /^(Apply Changes|应用更改|确认)$/ }).click();
      await expect(page.getByText('Bob WeChat')).toBeVisible();
    } finally {
      await closeElectronApp(app);
      await rm(userDataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
    }
  });
});
