import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

test.describe('Deep AI Worker skills page flows', () => {
  test('keeps the empty state and marketplace modal usable without runtime skills', async ({ launchElectronApp }) => {
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

      await page.getByTestId('skills-filter-button').hover();
      await expect(page.getByTestId('skills-filter-menu')).toBeVisible();

      await page.getByTestId('skills-filter-status-enabled').click();
      await expect(page.getByTestId('skills-filter-status-enabled')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('skills-filter-button')).toContainText('1');

      await page.getByTestId('skills-filter-reset').click();
      await expect(page.getByTestId('skills-filter-status-all')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('skills-filter-missing-all')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('skills-filter-source-all')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('skills-filter-button')).not.toContainText('1');

      await page.getByTestId('skills-page-title').hover();
      await expect(page.getByTestId('skills-filter-menu')).toBeHidden();
      await page.getByTestId('skills-discover-button').click();
      await expect(page.getByTestId('skills-marketplace-modal')).toBeVisible();
      await expect(page.getByTestId('skills-marketplace-search-input')).toBeVisible();
      await expect(page.getByTestId('skills-marketplace-source-chips')).toBeVisible();
      await expect(page.getByTestId('skills-marketplace-source-chips').locator('button[aria-pressed="true"]')).toHaveCount(1);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('preserves list search and filters after leaving the page and coming back', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);

      await expect(page.getByTestId('main-layout')).toBeVisible();

      await page.getByTestId('sidebar-nav-skills').click();
      await expect(page.getByTestId('skills-page')).toBeVisible();

      await page.getByTestId('skills-search-input').fill('demo');
      await page.getByTestId('skills-filter-button').hover();
      await expect(page.getByTestId('skills-filter-menu')).toBeVisible();
      await page.getByTestId('skills-filter-status-enabled').click();
      await expect(page.getByTestId('skills-filter-status-enabled')).toHaveAttribute('aria-pressed', 'true');

      await page.getByTestId('sidebar-nav-settings').click();
      await expect(page.getByTestId('settings-page')).toBeVisible();

      await page.goBack();
      await expect(page.getByTestId('skills-page')).toBeVisible();
      await expect(page.getByTestId('skills-search-input')).toHaveValue('demo');
      await expect(page.getByTestId('skills-filter-button')).toContainText('1');

      await page.getByTestId('skills-filter-button').hover();
      await expect(page.getByTestId('skills-filter-status-enabled')).toHaveAttribute('aria-pressed', 'true');
    } finally {
      await closeElectronApp(app);
    }
  });
});
