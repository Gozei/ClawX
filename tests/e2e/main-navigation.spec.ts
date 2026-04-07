import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

test.describe('Deep AI Worker main navigation without setup flow', () => {
  test('navigates between core pages with setup bypassed', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);

      await expect(page.getByTestId('main-layout')).toBeVisible();

      await page.getByTestId('sidebar-nav-models').click();
      await expect(page.getByTestId('models-page')).toBeVisible();
      await expect(page.getByTestId('models-page-title')).toBeVisible();

      await page.getByTestId('sidebar-nav-agents').click();
      await expect(page.getByTestId('agents-page')).toBeVisible();

      await page.getByTestId('sidebar-nav-channels').click();
      await expect(page.getByTestId('channels-page')).toBeVisible();

      await page.getByTestId('sidebar-nav-skills').click();
      await expect(page.getByTestId('skills-page')).toBeVisible();
      await expect(page.getByTestId('skills-search-input')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });
});
