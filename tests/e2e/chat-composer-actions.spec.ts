import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

test.describe('Chat composer actions', () => {
  test('renders the redesigned bottom action row', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      await page.getByTestId('sidebar-new-chat').click();

      const composer = page.getByTestId('chat-composer');
      const modelSwitch = composer.getByTestId('chat-model-switch');
      await expect(composer).toBeVisible();
      await expect(composer.getByRole('textbox')).toBeVisible();
      await expect(composer.getByTestId('chat-attach-button')).toBeVisible();
      await expect(modelSwitch).toBeVisible();
      await expect(modelSwitch).toBeDisabled();
      await expect(composer.getByTestId('chat-send-button')).toBeVisible();

      await expect(composer).toHaveClass(/rounded-\[20px\]/);
    } finally {
      await closeElectronApp(app);
    }
  });
});
