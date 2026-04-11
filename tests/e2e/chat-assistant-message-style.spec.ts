import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

test.describe('Chat assistant message style', () => {
  test('switches assistant replies to the stream style from settings', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      await page.getByTestId('sidebar-nav-settings').click();
      await expect(page.getByTestId('settings-page')).toBeVisible();
      await expect(page.getByTestId('settings-assistant-message-style-bubble')).toBeVisible();
      await expect(page.getByTestId('settings-assistant-message-style-stream')).toBeVisible();
      await page.getByTestId('settings-assistant-message-style-stream').click();
      await expect(page.getByTestId('settings-assistant-message-style-stream')).toHaveClass(/bg-primary/);
      await expect(page.getByTestId('settings-assistant-message-style-bubble')).not.toHaveClass(/bg-primary/);

      await page.getByTestId('sidebar-nav-dashboard').click();
      await expect(page.getByTestId('dashboard-page')).toBeVisible();
      await page.getByTestId('sidebar-nav-settings').click();
      await expect(page.getByTestId('settings-page')).toBeVisible();
      await expect(page.getByTestId('settings-assistant-message-style-stream')).toHaveClass(/bg-primary/);
    } finally {
      await closeElectronApp(app);
    }
  });
});
