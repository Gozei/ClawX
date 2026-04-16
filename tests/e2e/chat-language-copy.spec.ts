import { closeElectronApp, expect, getStableWindow, openSettingsHub, test } from './fixtures/electron';

test.describe('Chat language copy', () => {
  test('switches the disconnected composer placeholder with the selected UI language', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      await openSettingsHub(page);
      await page.getByTestId('settings-hub-menu-language').click();

      await page.getByTestId('sidebar-new-chat').click();
      await expect(page.getByPlaceholder('Gateway not connected...')).toBeVisible();
      await expect(page.getByTestId('chat-composer-disclaimer')).toHaveText(
        'AI can make mistakes. Please verify important information.',
      );
      await expect(page.getByPlaceholder('网关未连接...')).toHaveCount(0);

      await openSettingsHub(page);
      await page.getByTestId('settings-hub-menu-language').click();

      await page.getByTestId('sidebar-new-chat').click();
      await expect(page.getByPlaceholder('网关未连接...')).toBeVisible();
      await expect(page.getByTestId('chat-composer-disclaimer')).toHaveText(
        'AI\u4e5f\u4f1a\u72af\u9519\uff0c\u8bf7\u4ed4\u7ec6\u6838\u67e5\u4fe1\u606f',
      );
      await expect(page.getByPlaceholder('Gateway not connected...')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });
});
