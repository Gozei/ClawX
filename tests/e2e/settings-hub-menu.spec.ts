import { closeElectronApp, expect, getStableWindow, openSettingsHub, test } from './fixtures/electron';

test.describe('Settings hub menu', () => {
  test('opens the settings sheet and uses it as a menu of entry points', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      await openSettingsHub(page);

      await expect(page.getByTestId('settings-hub-menu-models')).toBeVisible();
      await expect(page.getByTestId('settings-hub-menu-channels')).toBeVisible();
      await expect(page.getByTestId('settings-hub-menu-theme')).toBeVisible();
      await expect(page.getByTestId('settings-hub-menu-language')).toBeVisible();
      await expect(page.getByTestId('settings-hub-menu-settings')).toBeVisible();
      await expect(page.getByTestId('settings-hub-menu-console')).toBeVisible();

      await page.getByTestId('settings-hub-menu-models').click();
      await expect(page.getByTestId('settings-hub-sheet-container')).toHaveCount(0);
      await expect(page.getByTestId('models-page')).toBeVisible();

      await openSettingsHub(page);
      await page.getByTestId('settings-hub-menu-channels').click();
      await expect(page.getByTestId('settings-hub-sheet-container')).toHaveCount(0);
      await expect(page.getByTestId('channels-page')).toBeVisible();

      await openSettingsHub(page);
      await page.getByTestId('settings-hub-menu-settings').click();
      await expect(page.getByTestId('settings-hub-sheet-container')).toHaveCount(0);
      await expect(page.getByTestId('settings-page')).toBeVisible();
      await expect(page.getByTestId('settings-updates-section')).toBeVisible();
      await expect(page.getByTestId('settings-assistant-message-style-bubble')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });
});
