import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

test.describe('Deep AI Worker settings logs panel', () => {
  test('shows policy controls plus searchable app and audit log results', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await app.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('hostapi:fetch');
        ipcMain.handle('hostapi:fetch', async (_event, request: { path?: string; method?: string }) => {
          const method = request?.method ?? 'GET';
          const path = request?.path ?? '';

          if (method !== 'GET') {
            return { ok: false, error: { message: `Unexpected hostapi:fetch request: ${method} ${path}` } };
          }

          if (path === '/api/logs/files?kind=app') {
            return {
              ok: true,
              data: {
                status: 200,
                ok: true,
                json: {
                  timezone: 'Asia/Shanghai',
                  files: [{ name: 'clawx-e2e.log', modifiedEpochMs: Date.now(), sizeBytes: 1024 }],
                },
              },
            };
          }

          if (path === '/api/logs/files?kind=audit') {
            return {
              ok: true,
              data: {
                status: 200,
                ok: true,
                json: {
                  timezone: 'Asia/Shanghai',
                  files: [{ name: 'audit-e2e.ndjson', modifiedEpochMs: Date.now(), sizeBytes: 2048 }],
                },
              },
            };
          }

          if (path.startsWith('/api/logs/query?')) {
            const query = new URLSearchParams(path.slice('/api/logs/query?'.length));
            const kind = query.get('kind');

            if (kind === 'audit') {
              return {
                ok: true,
                data: {
                  status: 200,
                  ok: true,
                  json: {
                    kind: 'audit',
                    timezone: 'Asia/Shanghai',
                    files: [{ name: 'audit-e2e.ndjson', modifiedEpochMs: Date.now(), sizeBytes: 2048 }],
                    entries: [{
                      id: 'audit-entry',
                      ts: new Date().toISOString(),
                      tsEpochMs: Date.now(),
                      fileName: 'audit-e2e.ndjson',
                      eventId: 'audit-seeded',
                      action: 'settings.update',
                      resourceType: 'settings',
                      resourceId: 'proxy',
                      result: 'success',
                      requestId: 'req-seeded',
                      changedKeys: ['proxyEnabled'],
                      metadata: { value: false },
                    }],
                  },
                },
              };
            }

            return {
              ok: true,
              data: {
                status: 200,
                ok: true,
                json: {
                  kind: 'app',
                  timezone: 'Asia/Shanghai',
                  files: [{ name: 'clawx-e2e.log', modifiedEpochMs: Date.now(), sizeBytes: 1024 }],
                  entries: [{
                    id: 'app-entry',
                    ts: new Date().toISOString(),
                    tsEpochMs: Date.now(),
                    fileName: 'clawx-e2e.log',
                    level: 'error',
                    message: 'Seeded application failure',
                    raw: '[ERROR] Seeded application failure',
                  }],
                },
              },
            };
          }

          return { ok: false, error: { message: `Unexpected hostapi:fetch request: ${method} ${path}` } };
        });
      });

      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      await page.getByTestId('sidebar-nav-settings').click({ force: true });
      await expect(page.getByTestId('settings-hub-sheet-container')).toBeVisible();
      await page.getByTestId('settings-hub-menu-settings').click({ force: true });

      await expect(page.getByTestId('settings-page')).toBeVisible();
      await expect(page.getByTestId('settings-logs-panel')).toBeVisible();
      await expect(page.getByTestId('settings-app-log-retention-input')).toHaveValue('14');
      await expect(page.getByTestId('settings-audit-log-retention-input')).toHaveValue('30');
      await expect(page.getByTestId('settings-log-file-max-size-input')).toHaveValue('64');
      await expect(page.getByTestId('settings-visible-audit-enabled-switch')).toBeVisible();

      await page.getByTestId('settings-logs-toggle').click({ force: true });

      await page.getByTestId('settings-logs-search-input').fill('Seeded application failure');
      await expect(page.getByTestId('settings-logs-results')).toContainText('Seeded application failure');

      await page.getByTestId('settings-logs-tab-audit').click({ force: true });
      await page.getByTestId('settings-logs-search-input-audit').fill('settings.update');
      await expect(page.getByTestId('settings-logs-results')).toContainText('settings.update');
      await expect(page.getByTestId('settings-logs-results')).toContainText('req-seeded');
    } finally {
      await closeElectronApp(app);
    }
  });
});
