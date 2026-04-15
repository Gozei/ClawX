import { closeElectronApp, expect, getStableWindow, openSettingsHub, test } from './fixtures/electron';

test.describe('Chat error reply', () => {
  test('keeps chat copy synced with the selected UI language', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      await openSettingsHub(page);
      await page.getByTestId('settings-hub-menu-language').click();

      await page.getByTestId('sidebar-new-chat').click();
      await expect(page.getByPlaceholder('Gateway not connected...')).toBeVisible();

      await openSettingsHub(page);
      await page.getByTestId('settings-hub-menu-language').click();

      await page.getByTestId('sidebar-new-chat').click();
      await expect(page.getByPlaceholder('网关未连接...')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });
});
