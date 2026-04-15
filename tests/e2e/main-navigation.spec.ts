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
      await expect(page.getByTestId('agent-card-summary-grid').first().getByTestId('agent-card-summary-item')).toHaveCount(5);

      await page.getByTestId('sidebar-nav-channels').click();
      await expect(page.getByTestId('channels-page')).toBeVisible();

      await page.getByTestId('sidebar-nav-skills').click();
      await expect(page.getByTestId('skills-page')).toBeVisible();
      await expect(page.getByTestId('skills-search-input')).toBeVisible();
      await expect(page.getByTestId('skills-page-title')).toBeVisible();

      await page.getByTestId('skills-discover-button').click();
      await expect(page.getByTestId('skills-marketplace-source-select')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('skills-marketplace-source-select')).toHaveCount(0);

      await page.getByTestId('sidebar-nav-settings').click();
      await expect(page.getByTestId('settings-page')).toBeVisible();
      await expect(page.getByTestId('settings-page-title')).toHaveCSS('font-size', '30px');
      await expect(page.getByTestId('settings-page-subtitle')).toHaveCSS('font-size', '14px');
      await expect(page.getByRole('button', { name: 'English' }).first()).toBeVisible();
      await expect(page.getByRole('button', { name: '\u4e2d\u6587' }).first()).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });

  test('keeps the skills page readable after switching to dark theme', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);

      await expect(page.getByTestId('main-layout')).toBeVisible();

      await page.getByTestId('sidebar-nav-settings').click();
      await expect(page.getByTestId('settings-page')).toBeVisible();

      const sidebarLogo = page.getByTestId('sidebar-brand-logo');
      const aboutLogo = page.getByTestId('settings-about-logo');

      await page.getByTestId('settings-theme-light').click();
      await expect(page.locator('html')).toHaveClass(/light/);
      await expect(sidebarLogo).toHaveAttribute('src', /logo-whale-dark/);
      await expect(sidebarLogo).toHaveCSS('height', '22.5px');
      await expect(aboutLogo).toHaveAttribute('src', /logo-whale-dark/);
      await expect(aboutLogo).toHaveCSS('height', '22.5px');

      const aboutHeading = page.getByTestId('settings-about-heading');
      const headingBox = await aboutHeading.boundingBox();
      const logoBox = await aboutLogo.boundingBox();

      expect(headingBox).not.toBeNull();
      expect(logoBox).not.toBeNull();
      if (headingBox && logoBox) {
        expect(logoBox.x).toBeGreaterThan(headingBox.x + headingBox.width - 8);
        expect(Math.abs(logoBox.y - headingBox.y)).toBeLessThan(24);
      }

      await page.getByTestId('sidebar-nav-skills').click();
      await expect(page.getByTestId('skills-page')).toBeVisible();
      await expect(page.getByTestId('skills-search-input')).toBeVisible();
      await expect(page.getByTestId('skills-discover-button')).toBeVisible();
      await page.getByTestId('sidebar-nav-settings').click();
      await expect(page.getByTestId('settings-page')).toBeVisible();

       await page.getByTestId('settings-theme-dark').click();
       await expect(page.locator('html')).toHaveClass(/dark/);
       await expect(sidebarLogo).toHaveAttribute('src', /logo-whale-light/);
       await expect(aboutLogo).toHaveAttribute('src', /logo-whale-light/);

       await page.getByTestId('sidebar-nav-dashboard').click();
       await expect(page.getByTestId('dashboard-page')).toBeVisible();
       await expect(page.getByTestId('dashboard-refresh-button')).toHaveCSS('color', 'rgb(255, 255, 255)');

       await page.getByTestId('sidebar-nav-agents').click();
       await expect(page.getByTestId('agents-page')).toBeVisible();
       await expect(page.getByTestId('agents-refresh-button')).toHaveCSS('color', 'rgb(255, 255, 255)');

       await page.getByTestId('sidebar-nav-channels').click();
       await expect(page.getByTestId('channels-page')).toBeVisible();
       await expect(page.getByTestId('channels-refresh-button')).toHaveCSS('color', 'rgb(255, 255, 255)');

       await page.getByTestId('sidebar-nav-cron').click();
       await expect(page.getByTestId('cron-page')).toBeVisible();
       await expect(page.getByTestId('cron-refresh-button')).toHaveCSS('color', 'rgb(255, 255, 255)');

      await page.getByTestId('sidebar-nav-skills').click();
      await expect(page.getByTestId('skills-page')).toBeVisible();
      await expect(page.getByTestId('skills-search-input')).toBeVisible();
      await expect(page.getByTestId('skills-discover-button')).toBeVisible();
      await expect(page.getByTestId('skills-search-input')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });
});
