import { closeElectronApp, expect, getStableWindow, openSettingsHub, test } from './fixtures/electron';

test.describe('Settings update check', () => {
  test('checks updates in place and starts the one-click update flow from the dialog', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      await app.evaluate(({ ipcMain }, mockVersion) => {
        const state = globalThis as typeof globalThis & { __e2eUpdateCalls?: string[] };
        state.__e2eUpdateCalls = [];

        ipcMain.removeHandler('app:request');
        ipcMain.handle('app:request', async (_event, request: { module?: string; action?: string }) => {
          if (request?.module !== 'update') {
            return {
              ok: false,
              error: { message: `Unexpected app request: ${String(request?.module)}.${String(request?.action)}` },
            };
          }

          state.__e2eUpdateCalls?.push(String(request.action || ''));

          if (request.action === 'check') {
            return {
              ok: true,
              data: {
                success: true,
                status: {
                  status: 'available',
                  info: { version: mockVersion },
                },
              },
            };
          }

          if (request.action === 'download' || request.action === 'install') {
            return {
              ok: true,
              data: { success: true },
            };
          }

          return {
            ok: false,
            error: { message: `Unexpected update action: ${String(request.action)}` },
          };
        });
      }, '9.9.9');

      await openSettingsHub(page);
      await page.getByTestId('settings-hub-menu-check-updates').click();

      await expect(page.getByTestId('settings-page')).toHaveCount(0);
      await expect(page.getByText(/检测到新版本，是否更新？|A new version was detected\. Update now\?/)).toBeVisible();

      await page.getByRole('button', { name: /^(取消|Cancel)$/i }).click();
      await expect(page.getByText(/检测到新版本，是否更新？|A new version was detected\. Update now\?/)).toHaveCount(0);
      await expect(page.getByTestId('settings-hub-sheet-container')).toBeVisible();

      await page.getByTestId('settings-hub-menu-check-updates').click();
      await expect(page.getByText(/检测到新版本，是否更新？|A new version was detected\. Update now\?/)).toBeVisible();
      await page.getByRole('button', { name: /^(更新|Update)$/i }).click();

      await expect(page.getByTestId('settings-page')).toHaveCount(0);
      await expect(page.getByTestId('settings-hub-sheet-container')).toHaveCount(0);
      await expect(page.getByText(/正在安装更新，请耐心等待|Installing update, please wait/i)).toBeVisible();

      const calls = await app.evaluate(() => {
        const state = globalThis as typeof globalThis & { __e2eUpdateCalls?: string[] };
        return state.__e2eUpdateCalls ?? [];
      });
      expect(calls).toEqual(['check', 'check', 'download', 'install']);
    } finally {
      await closeElectronApp(app);
    }
  });
});
