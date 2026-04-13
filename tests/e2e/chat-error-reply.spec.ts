import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

test.describe('Chat error reply', () => {
  test('keeps chat copy synced with the selected UI language', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      await page.getByTestId('sidebar-nav-settings').click();
      await expect(page.getByTestId('settings-page')).toBeVisible();
      await page.getByRole('button', { name: 'English' }).first().click();

      await page.getByTestId('sidebar-new-chat').click();
      await expect(page.getByPlaceholder('Gateway not connected...')).toBeVisible();

      await page.getByTestId('sidebar-nav-settings').click();
      await expect(page.getByTestId('settings-page')).toBeVisible();
      await page.getByRole('button', { name: '中文' }).first().click();

      await page.getByTestId('sidebar-new-chat').click();
      await expect(page.getByPlaceholder('网关未连接...')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });
});
