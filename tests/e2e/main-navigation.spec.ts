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
      await expect(page.getByText('Main Role').first()).toBeVisible();
      await expect(page.getByText('触发方式').first()).toBeVisible();
      await expect(page.getByText(/settingsdialog\.runtimesummarytitle/i)).toHaveCount(0);
      await expect(page.getByTestId('agent-card-summary-grid').first().getByTestId('agent-card-summary-item')).toHaveCount(5);

      await page.getByTestId('sidebar-nav-channels').click();
      await expect(page.getByTestId('channels-page')).toBeVisible();

      await page.getByTestId('sidebar-nav-skills').click();
      await expect(page.getByTestId('skills-page')).toBeVisible();
      await expect(page.getByTestId('skills-search-input')).toBeVisible();

      await page.getByTestId('sidebar-nav-settings').click();
      await expect(page.getByTestId('settings-page')).toBeVisible();
      await expect(page.getByRole('button', { name: 'English' }).first()).toBeVisible();
      await expect(page.getByRole('button', { name: '中文' }).first()).toBeVisible();
      await expect(page.getByRole('button', { name: '日本語' })).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });
});
