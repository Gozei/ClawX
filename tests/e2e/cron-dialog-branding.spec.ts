import type { Page } from '@playwright/test';
import {
  closeElectronApp,
  expect,
  getStableWindow,
  installIpcMocks,
  test,
} from './fixtures/electron';

async function setLanguage(page: Page, language: string): Promise<void> {
  await page.evaluate(async (nextLanguage) => {
    await window.electron.ipcRenderer.invoke('settings:set', 'language', nextLanguage);
  }, language);
}

test.describe('Cron task dialog branding', () => {
  test('uses the app branding and inherits the UI font in Chinese copy', async ({ launchElectronApp }) => {
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
                  name: '每日算力市场报告生成',
                  message: '请搜索最新算力市场数据并生成 PPT 报告。',
                  schedule: {
                    kind: 'cron',
                    expr: '0 9 * * *',
                    tz: 'Asia/Shanghai',
                  },
                  delivery: { mode: 'none' },
                  enabled: true,
                  createdAt: '2026-04-22T03:00:00.000Z',
                  updatedAt: '2026-04-22T03:00:00.000Z',
                  nextRun: '2026-04-23T01:00:00.000Z',
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

      await setLanguage(page, 'zh-CN');
      await page.getByTestId('sidebar-nav-cron').click();
      await expect(page.getByTestId('cron-page')).toBeVisible();
      await expect(page.getByRole('heading', { name: '定时任务', exact: true })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('每日算力市场报告生成', { exact: true }).first()).toBeVisible();

      await page.getByText('每日算力市场报告生成', { exact: true }).first().click();

      await expect(page.getByRole('heading', { name: '每日算力市场报告生成', exact: true })).toBeVisible();
      await page.getByRole('button', { name: /Edit|编辑/ }).click();
      await expect(page.getByRole('heading', { name: '编辑任务', exact: true })).toBeVisible();

      const dialog = page.getByTestId('cron-task-dialog');
      const bodyFont = await page.locator('body').evaluate((node) => getComputedStyle(node).fontFamily);
      const taskNameFont = await dialog.locator('#name').evaluate((node) => getComputedStyle(node).fontFamily);
      const messageFont = await dialog.locator('#message').evaluate((node) => getComputedStyle(node).fontFamily);

      expect(taskNameFont).toBe(bodyFont);
      expect(messageFont).toBe(bodyFont);
    } finally {
      await closeElectronApp(app);
    }
  });
});
