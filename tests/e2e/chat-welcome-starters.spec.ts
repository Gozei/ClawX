import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

test.describe('Chat welcome starters', () => {
  test('inserts a starter prompt and keeps multiple offline drafts queued', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();
      await expect(page.getByTestId('chat-welcome-starter-askQuestions')).toBeVisible();

      await page.getByTestId('chat-welcome-starter-askQuestions').click();

      const composerInput = page.getByTestId('chat-composer').getByRole('textbox');
      await expect(composerInput).not.toHaveValue('');
      await expect(page.getByTestId('chat-composer-offline-hint')).toBeVisible();

      await page.getByTestId('chat-send-button').click();
      await expect(page.getByTestId('chat-queued-message-card')).toBeVisible();

      await composerInput.fill('Second offline draft for queue coverage');
      await page.getByTestId('chat-send-button').click();

      await expect(page.getByTestId('chat-queued-message-card')).toContainText('2');
      await expect(page.getByTestId('chat-queued-message-preview')).not.toContainText('Second offline draft for queue coverage');

      await page.getByTestId('chat-queued-message-edit').click();
      await expect(composerInput).not.toHaveValue('');
      await expect(page.getByTestId('chat-queued-message-card')).toBeVisible();
      await expect(page.getByTestId('chat-queued-message-preview')).toContainText('Second offline draft for queue coverage');
    } finally {
      await closeElectronApp(app);
    }
  });
});
