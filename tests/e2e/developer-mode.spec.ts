import { closeElectronApp, expect, getStableWindow, openSettingsHub, test } from './fixtures/electron';

test.describe('Developer mode gating', () => {
  test('keeps the developer section hidden until dev mode is enabled', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      await openSettingsHub(page);
      await page.getByTestId('settings-hub-menu-settings').click({ force: true });
      await expect(page.getByTestId('settings-page')).toBeVisible();
      await expect(page.getByTestId('settings-developer-section')).toHaveCount(0);
      await expect(page.getByTestId('settings-dev-mode-switch')).toHaveAttribute('data-state', 'unchecked');

      await page.getByTestId('settings-dev-mode-switch').click({ force: true });
      await expect(page.getByTestId('settings-dev-mode-switch')).toHaveAttribute('data-state', 'checked');
      await expect(page.getByTestId('settings-developer-section')).toBeVisible();
      await expect(page.getByTestId('settings-developer-gateway-token')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });
});
