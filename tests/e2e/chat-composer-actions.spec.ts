import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

test.describe('Chat composer actions', () => {
  test('renders the redesigned bottom action row', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await page.setViewportSize({ width: 1440, height: 900 });
      await expect(page.getByTestId('main-layout')).toBeVisible();

      await page.getByTestId('sidebar-new-chat').click();

      const composer = page.getByTestId('chat-composer');
      const composerShell = page.getByTestId('chat-composer-shell');
      const contentColumn = page.getByTestId('chat-content-column');
      const scrollContainer = page.getByTestId('chat-scroll-container');
      const modelSwitch = composer.getByTestId('chat-model-switch');
      await expect(composer).toBeVisible();
      await expect(composerShell).toBeVisible();
      await expect(contentColumn).toBeVisible();
      await expect(scrollContainer).toBeVisible();
      await expect(composer.getByRole('textbox')).toBeVisible();
      await expect(composer.getByTestId('chat-attach-button')).toBeVisible();
      await expect(modelSwitch).toBeVisible();
      await expect(modelSwitch).toBeDisabled();
      await expect(composer.getByTestId('chat-send-button')).toBeVisible();

      await expect(composer).toHaveClass(/rounded-\[20px\]/);
      await expect(composerShell).toHaveCSS('padding-top', '0px');
    await expect(scrollContainer).toHaveCSS('padding-bottom', '32px');

      const [composerShellBox, contentColumnBox] = await Promise.all([
        composerShell.boundingBox(),
        contentColumn.boundingBox(),
      ]);
      expect(composerShellBox).not.toBeNull();
      expect(contentColumnBox).not.toBeNull();
      if (composerShellBox && contentColumnBox) {
        expect(Math.abs(composerShellBox.x - contentColumnBox.x)).toBeLessThan(1);
        expect(Math.abs(composerShellBox.width - contentColumnBox.width)).toBeLessThan(1);
      }
    } finally {
      await closeElectronApp(app);
    }
  });
});
