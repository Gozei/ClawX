import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

test.describe('Deep AI Worker skills page flows', () => {
  test('keeps the empty state and marketplace sheet usable without runtime skills', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);

      await expect(page.getByTestId('main-layout')).toBeVisible();

      await page.getByTestId('sidebar-nav-skills').click();
      await expect(page.getByTestId('skills-page')).toBeVisible();
      await expect(page.getByTestId('skills-page-title')).toBeVisible();
      await expect(page.getByTestId('skills-search-input')).toBeVisible();
      await expect(page.getByTestId('skills-refresh-button')).toHaveCount(0);
      await expect(page.getByTestId('skills-source-tabs')).toBeVisible();
      await expect(page.getByTestId('skills-filter-button')).toBeVisible();

      await page.getByTestId('skills-search-input').fill('demo');
      await expect(page.getByTestId('skills-search-input')).toHaveValue('demo');
      await expect(page.getByTestId('skills-empty-state')).toBeVisible();

      await page.getByTestId('skills-filter-button').click();
      await expect(page.getByTestId('skills-filter-sheet')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('skills-filter-sheet')).toHaveCount(0);

      await page.getByTestId('skills-discover-button').click();
      await expect(page.getByTestId('skills-marketplace-sheet')).toBeVisible();
      await expect(page.getByTestId('skills-marketplace-search-input')).toBeVisible();
      await expect(page.getByTestId('skills-marketplace-source-select')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });
});
