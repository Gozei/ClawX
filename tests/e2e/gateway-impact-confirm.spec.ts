import type { ElectronApplication, Page } from '@playwright/test';
import {
  closeElectronApp,
  expect,
  getStableWindow,
  openSettingsHub,
  test,
} from './fixtures/electron';

async function installGatewayImpactMocks(app: ElectronApplication): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await app.evaluate(({ ipcMain }) => {
        const state = globalThis as typeof globalThis & {
          __clawxGatewayImpactState?: {
            requests: string[];
            dreamModeEnabled: boolean;
          };
        };

        state.__clawxGatewayImpactState = {
          requests: [],
          dreamModeEnabled: false,
        };

        ipcMain.removeHandler('hostapi:fetch');
        ipcMain.handle(
          'hostapi:fetch',
          async (_event, request: { path?: string; method?: string; body?: string | null }) => {
            const path = request?.path ?? '';
            const method = request?.method ?? 'GET';
            const current = state.__clawxGatewayImpactState!;
            current.requests.push(`${method} ${path}`);

            if (path === '/api/settings' && method === 'GET') {
              return {
                ok: true,
                data: {
                  status: 200,
                  ok: true,
                  json: {
                    theme: 'system',
                    language: 'zh',
                    launchAtStartup: false,
                    telemetryEnabled: true,
                    chatProcessDisplayMode: 'files',
                    hideInternalRoutineProcesses: true,
                    assistantMessageStyle: 'bubble',
                    chatFontScale: 100,
                    dreamModeEnabled: current.dreamModeEnabled,
                    fileStorageBaseDir: '',
                    gatewayAutoStart: true,
                    gatewayPort: 18789,
                    proxyEnabled: false,
                    proxyServer: '',
                    proxyHttpServer: '',
                    proxyHttpsServer: '',
                    proxyAllServer: '',
                    proxyBypassRules: '<local>;localhost;127.0.0.1;::1',
                    autoCheckUpdate: true,
                    autoDownloadUpdate: false,
                    devModeUnlocked: true,
                    setupComplete: true,
                  },
                },
              };
            }

            if (path === '/api/gateway/status' && method === 'GET') {
              return {
                ok: true,
                data: {
                  status: 200,
                  ok: true,
                  json: { state: 'running', port: 18789, pid: 12345, connectedAt: Date.now() - 30_000 },
                },
              };
            }

            if (path === '/api/provider-accounts' && method === 'GET') {
              return { ok: true, data: { status: 200, ok: true, json: [] } };
            }

            if (path === '/api/provider-account-statuses' && method === 'GET') {
              return { ok: true, data: { status: 200, ok: true, json: [] } };
            }

            if (path === '/api/provider-vendors' && method === 'GET') {
              return { ok: true, data: { status: 200, ok: true, json: [] } };
            }

            if (path === '/api/provider-accounts/default' && method === 'GET') {
              return { ok: true, data: { status: 200, ok: true, json: { accountId: null } } };
            }

            if (path === '/api/gateway/control-ui' && method === 'GET') {
              return { ok: true, data: { status: 200, ok: true, json: { success: false } } };
            }

            if (path === '/api/logs/dir' && method === 'GET') {
              return { ok: true, data: { status: 200, ok: true, json: { dir: null } } };
            }

            if (path === '/api/gateway/restart' && method === 'POST') {
              return { ok: true, data: { status: 200, ok: true, json: { success: true } } };
            }

            if (path === '/api/settings/dreamModeEnabled' && method === 'PUT') {
              try {
                const parsed = JSON.parse(request?.body ?? '{}') as { value?: boolean };
                current.dreamModeEnabled = parsed.value === true;
              } catch {
                current.dreamModeEnabled = false;
              }
              return { ok: true, data: { status: 200, ok: true, json: { success: true } } };
            }

            return {
              ok: false,
              error: {
                message: `Unexpected hostapi:fetch request: ${method} ${path}`,
              },
            };
          },
        );

        ipcMain.removeHandler('openclaw:getCliCommand');
        ipcMain.handle('openclaw:getCliCommand', async () => ({
          success: true,
          command: 'openclaw',
        }));

        ipcMain.removeHandler('app:request');
        ipcMain.handle('app:request', async (_event, name?: string) => {
          if (name === 'e2e:gateway-impact-state') {
            return state.__clawxGatewayImpactState ?? {
              requests: [],
              dreamModeEnabled: false,
            };
          }
          return {};
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

async function readGatewayImpactState(page: Page): Promise<{ requests: string[]; dreamModeEnabled: boolean }> {
  return await page.evaluate(async () => {
    return await window.electron.ipcRenderer.invoke('app:request', 'e2e:gateway-impact-state') as {
      requests: string[];
      dreamModeEnabled: boolean;
    };
  });
}

test.describe('Gateway impact confirmation', () => {
  test('requires confirmation before applying restart-affecting settings changes', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installGatewayImpactMocks(app);
      const page = await getStableWindow(app);
      await page.setViewportSize({ width: 1440, height: 960 });
      await expect(page.getByTestId('main-layout')).toBeVisible();

      await openSettingsHub(page);
      await page.getByTestId('settings-hub-menu-settings').click({ force: true });
      await expect(page.getByTestId('settings-page')).toBeVisible();

      const confirmDialog = page.getByTestId('gateway-impact-confirm-dialog');
      const dreamModeSwitch = page.getByTestId('settings-dream-mode-switch');
      await expect(dreamModeSwitch).toHaveAttribute('data-state', 'unchecked');
      await dreamModeSwitch.click();
      await expect(confirmDialog).toBeVisible();
      await confirmDialog.getByRole('button', { name: /Cancel|取消/ }).click();
      await expect(page.getByTestId('gateway-impact-confirm-dialog')).toHaveCount(0);
      await expect(dreamModeSwitch).toHaveAttribute('data-state', 'unchecked');
      await expect.poll(async () => (await readGatewayImpactState(page)).requests).not.toContain('PUT /api/settings/dreamModeEnabled');

      await dreamModeSwitch.click();
      await expect(confirmDialog).toBeVisible();
      await confirmDialog.getByRole('button', { name: /Apply and Restart|应用并重启/ }).click();
      await expect.poll(async () => (await readGatewayImpactState(page)).requests).toContain('PUT /api/settings/dreamModeEnabled');
      await expect(dreamModeSwitch).toHaveAttribute('data-state', 'checked');
    } finally {
      await closeElectronApp(app);
    }
  });
});
