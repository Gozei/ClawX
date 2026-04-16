/*
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

      await page.getByTestId('chat-send-button').click();
      await expect(page.getByTestId('chat-queued-message-card')).toBeVisible();

      await composerInput.fill('Second offline draft for queue coverage');
      await page.getByTestId('chat-send-button').click();

      await expect(page.getByTestId('chat-queued-message-card')).toContainText('1 条草稿');
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
*/

import { closeElectronApp as closeRestoredWelcomeApp, expect as expectRestoredWelcome, getStableWindow as getRestoredWelcomeWindow, test as restoredWelcomeTest } from './fixtures/electron';

restoredWelcomeTest.describe('Chat welcome screen', () => {
  restoredWelcomeTest('keeps the restored empty state free of starter cards', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getRestoredWelcomeWindow(app);
      await expectRestoredWelcome(page.getByTestId('main-layout')).toBeVisible();
      await expectRestoredWelcome(page.getByTestId('chat-welcome-title')).toBeVisible();
      await expectRestoredWelcome(page.getByTestId('chat-composer')).toBeVisible();
      await expectRestoredWelcome(page.getByTestId('chat-welcome-starter-askQuestions')).toHaveCount(0);
      await expectRestoredWelcome(page.getByTestId('chat-welcome-starter-creativeTasks')).toHaveCount(0);
      await expectRestoredWelcome(page.getByTestId('chat-welcome-starter-brainstorming')).toHaveCount(0);
    } finally {
      await closeRestoredWelcomeApp(app);
    }
  });
});
