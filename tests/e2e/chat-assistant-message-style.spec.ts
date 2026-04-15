import { closeElectronApp, expect, getStableWindow, openSettingsHub, test } from './fixtures/electron';

test.describe('Chat assistant message style', () => {
  test('defaults to stream style and no longer shows a settings toggle', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      await openSettingsHub(page);
      await expect(page.locator('[data-testid="settings-assistant-message-style-bubble"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="settings-assistant-message-style-stream"]')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });
});
