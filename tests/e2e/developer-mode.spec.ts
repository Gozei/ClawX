import { closeElectronApp, expect, getStableWindow, openModelsFromSettings, openSettingsHub, test } from './fixtures/electron';

test.describe('Deep AI Worker developer-mode gated UI', () => {
  test('keeps developer-only configuration hidden until dev mode is enabled', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);

      await expect(page.getByTestId('main-layout')).toBeVisible();

      await openSettingsHub(page);
      await expect(page.getByTestId('settings-developer-section')).toHaveCount(0);
      await expect(page.getByTestId('settings-dev-mode-switch')).toHaveAttribute('data-state', 'unchecked');

      await openModelsFromSettings(page);
      await page.getByTestId('providers-add-button').click();
      await expect(page.getByTestId('add-provider-dialog')).toBeVisible();
      await expect(page.getByTestId('add-provider-dialog-card')).toHaveCSS('background-color', 'rgb(246, 247, 249)');
      await page.getByTestId('add-provider-type-siliconflow').click();
      await expect(page.getByTestId('add-provider-model-id-input')).toHaveCount(0);
      await page.getByTestId('add-provider-close-button').click();
      await expect(page.getByTestId('add-provider-dialog')).toHaveCount(0);

      await openSettingsHub(page);
      await page.getByTestId('settings-dev-mode-switch').click();
      await expect(page.getByTestId('settings-dev-mode-switch')).toHaveAttribute('data-state', 'checked');
      await expect(page.getByTestId('settings-developer-section')).toBeVisible();
      await expect(page.getByTestId('settings-developer-gateway-token')).toBeVisible();

      await openModelsFromSettings(page);
      await page.getByTestId('providers-add-button').click();
      await expect(page.getByTestId('add-provider-dialog')).toBeVisible();
      await page.getByTestId('add-provider-type-siliconflow').click();
      await expect(page.getByTestId('add-provider-model-id-input')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });
});
