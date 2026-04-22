import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

test.describe('Chat welcome screen', () => {
  test('shows the simplified empty chat state without restored starter cards', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      const newChatButton = page.getByTestId('sidebar-new-chat');
      if (await newChatButton.count()) {
        await newChatButton.click({ force: true });
      }

      await expect(page.getByTestId('chat-scroll-container')).toBeVisible();
      await expect(page.getByTestId('chat-content-column')).toBeVisible();
      await expect(page.getByTestId('chat-welcome-logo')).toBeVisible();
      await expect(page.getByTestId('chat-welcome-title')).toBeVisible();
      await expect(page.getByTestId('chat-composer')).toBeVisible();
      await expect(page.getByTestId('chat-welcome-description')).toHaveCount(0);
      await expect(page.getByTestId('chat-welcome-starter-askQuestions')).toHaveCount(0);
      await expect(page.getByTestId('chat-welcome-starter-creativeTasks')).toHaveCount(0);
      await expect(page.getByTestId('chat-welcome-starter-brainstorming')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });
});
