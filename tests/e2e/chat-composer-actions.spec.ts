import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

test.describe('Chat composer actions', () => {
  test('renders the redesigned bottom action row', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      await page.getByTestId('sidebar-new-chat').click();

      const composer = page.getByTestId('chat-composer');
      await expect(composer).toBeVisible();
      await expect(composer.getByRole('textbox')).toBeVisible();
      await expect(composer.getByTestId('chat-attach-button')).toBeVisible();
      await expect(composer.getByTestId('chat-model-switch')).toBeVisible();
      await expect(composer.getByTestId('chat-send-button')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });
});
