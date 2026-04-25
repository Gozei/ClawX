import type { ElectronApplication } from '@playwright/test';
import {
  closeElectronApp,
  expect,
  getStableWindow,
  installIpcMocks,
  test,
} from './fixtures/electron';

const CRON_SESSION_KEY = 'agent:main:cron:daily-report';
const CRON_RUN_ALIAS_KEY = 'agent:main:cron:daily-report:run:session-uuid';

async function installCronSessionMocks(app: ElectronApplication): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await app.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('gateway:rpc');
        ipcMain.handle('gateway:rpc', async (_event, method: string) => {
          if (method === 'sessions.list') {
            return {
              success: true,
              result: {
                sessions: [
                  {
                    key: 'agent:main:cron:daily-report:run:session-uuid',
                    label: 'Cron: Daily report',
                    updatedAt: Date.now(),
                  },
                  {
                    key: 'agent:main:cron:daily-report',
                    label: 'Cron: Daily report',
                    updatedAt: Date.now(),
                  },
                ],
              },
            };
          }

          if (method === 'chat.history') {
            return {
              success: true,
              result: { messages: [] },
            };
          }

          return {
            success: true,
            result: {},
          };
        });
      });
      return;
    } catch (error) {
      if (attempt === 2 || !String(error).includes('Execution context was destroyed')) {
        throw error;
      }
    }
  }
}

test.describe('Cron session deduplication', () => {
  test('shows only the stable cron session when a run alias points at the same transcript', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, connectedAt: Date.now() },
        hostApi: {
          '["/api/gateway/status","GET"]': {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                state: 'running',
                port: 18789,
                pid: 12345,
                connectedAt: Date.now(),
              },
            },
          },
          '["/api/sessions/metadata","POST"]': {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                metadata: {},
              },
            },
          },
        },
      });
      await installCronSessionMocks(app);

      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      await expect(page.getByTestId(`sidebar-session-${CRON_SESSION_KEY}`)).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId(`sidebar-session-${CRON_RUN_ALIAS_KEY}`)).toHaveCount(0);
      await expect(page.getByText('Cron: Daily report', { exact: true })).toHaveCount(1);
    } finally {
      await closeElectronApp(app);
    }
  });
});
