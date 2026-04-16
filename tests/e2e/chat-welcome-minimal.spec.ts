import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

test.describe('Chat welcome screen', () => {
  test('keeps the empty-state message area reduced to the single headline', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await page.setViewportSize({ width: 1440, height: 900 });
      await expect(page.getByTestId('main-layout')).toBeVisible();

      const newChatButton = page.getByTestId('sidebar-new-chat');
      if (await newChatButton.count()) {
        await newChatButton.click();
      }

      const welcomeLogo = page.getByTestId('chat-welcome-logo');
      const welcomeTitle = page.getByTestId('chat-welcome-title');
      const scrollContainer = page.getByTestId('chat-scroll-container');

      await expect(scrollContainer).toBeVisible();
      await expect(welcomeLogo).toBeVisible();
      await expect(welcomeTitle).toBeVisible();
      await expect(page.getByTestId('chat-welcome-description')).toHaveCount(0);
      await expect(welcomeLogo).toHaveCSS('height', '48px');
      await expect(welcomeTitle).toHaveCSS('font-size', '50px');

      await expect.poll(async () => normalizeText(await scrollContainer.textContent())).toBe(
        normalizeText(await welcomeTitle.textContent()),
      );
    } finally {
      await closeElectronApp(app);
    }
  });
});
