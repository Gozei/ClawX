import {
  closeElectronApp,
  expect,
  getStableWindow,
  installIpcMocks,
  test,
} from './fixtures/electron';

test.describe('Cron page', () => {
  test('renders fetched cron jobs on first open', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      await installIpcMocks(app, {
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
          '["/api/cron/status","GET"]': {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { enabled: true, jobs: 1, nextWakeAtMs: 1776913200000, gatewayAvailable: true },
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
              json: {
                jobs: [
                {
                  id: 'daily-computing-power-report',
                  name: 'Daily Computing Power Report',
                  message: 'Generate the report deck.',
                  schedule: {
                    kind: 'cron',
                    expr: '0 11 * * *',
                    tz: 'Asia/Shanghai',
                  },
                  delivery: { mode: 'none' },
                  enabled: true,
                  createdAt: '2026-04-22T03:00:00.000Z',
                  updatedAt: '2026-04-22T03:00:00.000Z',
                  nextRun: '2026-04-23T03:00:00.000Z',
                },
              ],
                total: 1,
                offset: 0,
                nextOffset: null,
                hasMore: false,
                gatewayAvailable: true,
              },
            },
          },
        },
      });

      await page.getByTestId('sidebar-nav-cron').click();
      await expect(page.getByTestId('cron-page')).toBeVisible();
      await expect(page.getByText('Daily Computing Power Report').first()).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('Generate the report deck.').first()).toBeVisible();
      await expect(page.getByText(/No scheduled tasks|暂无定时任务/)).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });
});
