import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

test.describe('Chat user message copy', () => {
  test('copies the user prompt from the message hover action', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      const textarea = page.locator('textarea').first();
      const messageText = 'Please copy this user prompt';

      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 45_000 });
      await expect(textarea).toBeEnabled({ timeout: 45_000 });

      await app.evaluate(({ clipboard }) => {
        clipboard.clear();
      });

      await textarea.fill(messageText);
      await textarea.press('Enter');

      const messageBubble = page.getByText(messageText);
      await expect(messageBubble).toBeVisible();
      await messageBubble.hover();

      const copyButton = page.getByTestId('chat-message-copy-user');
      await expect(copyButton).toBeVisible();
      await copyButton.click();

      await expect.poll(async () => await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(messageText);
    } finally {
      await closeElectronApp(app);
    }
  });
});
