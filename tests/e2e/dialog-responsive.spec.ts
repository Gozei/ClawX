import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

test.describe('Deep AI Worker responsive dialogs', () => {
  test('keeps the Add Role dialog usable in a short viewport', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);

      await page.setViewportSize({ width: 960, height: 580 });
      await expect(page.getByTestId('main-layout')).toBeVisible();

      await page.getByTestId('sidebar-nav-agents').click();
      await expect(page.getByTestId('agents-page')).toBeVisible();

      await page.getByTestId('agents-add-button').click();
      await expect(page.getByTestId('add-agent-dialog')).toBeVisible();

      const profileTypeSelect = page.locator('#agent-profile-type');
      await expect(profileTypeSelect).toHaveCSS('font-size', '14px');
      const profileTypeFontFamily = await profileTypeSelect.evaluate((element) => getComputedStyle(element).fontFamily.toLowerCase());
      expect(profileTypeFontFamily).not.toContain('mono');
      const profileTypeBackgroundPosition = await profileTypeSelect.evaluate((element) => getComputedStyle(element).backgroundPosition);
      expect(profileTypeBackgroundPosition.toLowerCase()).not.toContain('left');
      expect(profileTypeBackgroundPosition).not.toMatch(/^0(px|%)\s/);

      const viewport = page.viewportSize();
      const dialogCard = page.getByTestId('add-agent-dialog-card');
      const dialogCardBox = await dialogCard.boundingBox();

      expect(viewport).not.toBeNull();
      expect(dialogCardBox).not.toBeNull();

      if (viewport && dialogCardBox) {
        expect(dialogCardBox.y).toBeGreaterThanOrEqual(12);
        expect(dialogCardBox.y + dialogCardBox.height).toBeLessThanOrEqual(viewport.height - 12);
      }

      const inheritWorkspaceSwitch = page.locator('#inherit-workspace');
      await inheritWorkspaceSwitch.scrollIntoViewIfNeeded();

      const switchBox = await inheritWorkspaceSwitch.boundingBox();
      expect(switchBox).not.toBeNull();

      if (viewport && switchBox) {
        expect(switchBox.y).toBeGreaterThanOrEqual(0);
        expect(switchBox.y + switchBox.height).toBeLessThanOrEqual(viewport.height);
      }
    } finally {
      await closeElectronApp(app);
    }
  });
});
