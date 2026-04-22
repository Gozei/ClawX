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
          '["/api/cron/jobs","GET"]': {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: [
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

      await expect(page.getByRole('heading', { name: '编辑任务', exact: true })).toBeVisible();
      await page.getByText('投递设置', { exact: true }).scrollIntoViewIfNeeded();
      await expect(page.getByText(/选择仅在\s*Deep AI Worker\s*内保留结果/)).toBeVisible();
      await expect(page.getByText('仅在 Deep AI Worker 内', { exact: true })).toBeVisible();
      await expect(page.getByText(/\{\{?appName\}?\}/)).toHaveCount(0);

      const bodyFont = await page.locator('body').evaluate((node) => getComputedStyle(node).fontFamily);
      const taskNameFont = await page.getByLabel('任务名称').evaluate((node) => getComputedStyle(node).fontFamily);
      const messageFont = await page.getByLabel('消息/提示词').evaluate((node) => getComputedStyle(node).fontFamily);

      expect(taskNameFont).toBe(bodyFont);
      expect(messageFont).toBe(bodyFont);
    } finally {
      await closeElectronApp(app);
    }
  });
});
