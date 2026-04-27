import {
  closeElectronApp,
  expect,
  getStableWindow,
  installIpcMocks,
  test,
} from './fixtures/electron';

test.describe('Cron task dialog dismissal guard', () => {
  test('keeps draft input when clicking outside the create-task dialog', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await page.setViewportSize({ width: 1440, height: 900 });
      await expect(page.getByTestId('main-layout')).toBeVisible();

      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
        hostApi: {
          '["/api/gateway/status","GET"]': {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { state: 'running', port: 18789, pid: 12345 },
            },
          },
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
          '["/api/cron/status","GET"]': {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { enabled: true, jobs: 0, gatewayAvailable: true },
            },
          },
          '["/api/cron/runs?scope=all&limit=50&offset=0&sortDir=desc","GET"]': {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { entries: [], total: 0, offset: 0, nextOffset: null, hasMore: false, gatewayAvailable: true },
            },
          },
          '["/api/cron/jobs?limit=50&offset=0&includeDisabled=true&enabled=all&sortBy=nextRunAtMs&sortDir=asc","GET"]': {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { jobs: [], total: 0, offset: 0, nextOffset: null, hasMore: false, gatewayAvailable: true },
            },
          },
        },
      });

      await page.getByTestId('sidebar-nav-cron').click();
      await expect(page.getByTestId('cron-page')).toBeVisible();

      await page.getByRole('button', { name: /New Task|新建任务/ }).click();
      await expect(page.getByTestId('cron-task-dialog')).toBeVisible();

      await page.locator('#name').fill('Draft task title');
      await page.locator('#message').fill('Keep this draft after an outside click.');

      await page.mouse.click(20, 20);

      await expect(page.getByTestId('cron-task-dialog')).toBeVisible();
      await expect(page.locator('#name')).toHaveValue('Draft task title');
      await expect(page.locator('#message')).toHaveValue('Keep this draft after an outside click.');
    } finally {
      await closeElectronApp(app);
    }
  });
});
