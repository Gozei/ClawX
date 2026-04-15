import { closeElectronApp, expect, getStableWindow, openSettingsHub, test } from './fixtures/electron';

test.describe('Deep AI Worker developer-mode gated UI', () => {
  test('keeps developer-only configuration hidden until dev mode is enabled', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);

      await expect(page.getByTestId('main-layout')).toBeVisible();

      await openSettingsHub(page);
      await page.getByTestId('settings-hub-menu-settings').click();
      await expect(page.getByTestId('settings-page')).toBeVisible();
      await expect(page.getByTestId('settings-developer-section')).toHaveCount(0);
      await expect(page.getByTestId('settings-dev-mode-switch')).toHaveAttribute('data-state', 'unchecked');

      await openSettingsHub(page);
      await page.getByTestId('settings-hub-menu-settings').click();
      await expect(page.getByTestId('settings-page')).toBeVisible();
      await page.getByTestId('settings-dev-mode-switch').click();
      await expect(page.getByTestId('settings-dev-mode-switch')).toHaveAttribute('data-state', 'checked');
      await expect(page.getByTestId('settings-developer-section')).toBeVisible();
      await expect(page.getByTestId('settings-developer-gateway-token')).toBeVisible();
      await expect(page.getByTestId('settings-audit-enabled-switch')).toBeVisible();
      await expect(page.getByTestId('settings-log-level-select')).toBeVisible();
      await expect(page.getByTestId('settings-audit-mode-select')).toBeVisible();

      await page.getByTestId('settings-log-level-select').selectOption('warn');
      await page.getByTestId('settings-audit-mode-select').selectOption('full');
      await page.getByTestId('settings-audit-enabled-switch').click();
      await expect(page.getByTestId('settings-audit-enabled-switch')).toHaveAttribute('data-state', 'unchecked');

      await openSettingsHub(page);
      await page.getByTestId('settings-hub-menu-settings').click();
      await expect(page.getByTestId('settings-page')).toBeVisible();
      await expect(page.getByTestId('settings-log-level-select')).toHaveValue('warn');
      await expect(page.getByTestId('settings-audit-mode-select')).toHaveValue('full');
      await expect(page.getByTestId('settings-audit-enabled-switch')).toHaveAttribute('data-state', 'unchecked');
    } finally {
      await closeElectronApp(app);
    }
  });
});
