import { closeElectronApp, closeSettingsHub, expect, getStableWindow, openChannelsFromSettings, openModelsFromSettings, openSettingsHub, test } from './fixtures/electron';

async function ensureTheme(page: Awaited<ReturnType<typeof getStableWindow>>, theme: 'light' | 'dark') {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const className = await page.locator('html').getAttribute('class');
    if (className?.includes(theme)) return;
    await page.getByTestId('settings-hub-menu-theme').click();
  }
  await expect(page.locator('html')).toHaveClass(new RegExp(theme));
}

test.describe('Deep AI Worker main navigation without setup flow', () => {
  test('navigates between core pages with setup bypassed', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);

      await expect(page.getByTestId('main-layout')).toBeVisible();

      await openModelsFromSettings(page);
      await expect(page.getByTestId('models-page-title')).toBeVisible();

      await page.getByTestId('sidebar-nav-agents').click();
      await expect(page.getByTestId('agents-page')).toBeVisible();
      await expect(page.getByText('Main Role').first()).toBeVisible();
      await expect(page.getByTestId('agent-card-summary-grid').first().getByTestId('agent-card-summary-item')).toHaveCount(5);

      await openChannelsFromSettings(page);
      const channelsTitleBox = await page.getByTestId('channels-page-title').boundingBox();

      await page.getByTestId('sidebar-nav-skills').click();
      await expect(page.getByTestId('skills-page')).toBeVisible();
      await expect(page.getByTestId('skills-search-input')).toBeVisible();
      const skillsTitleBox = await page.getByTestId('skills-page-title').boundingBox();
      expect(channelsTitleBox).not.toBeNull();
      expect(skillsTitleBox).not.toBeNull();

      await openSettingsHub(page);
      await page.getByTestId('settings-hub-menu-settings').click();
      await expect(page.getByTestId('settings-page')).toBeVisible();
      await expect(page.getByTestId('settings-page-title')).toHaveCSS('font-size', '30px');
      await expect(page.getByTestId('settings-page-subtitle')).toHaveCSS('font-size', '14px');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('keeps the skills page readable after switching to dark theme', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);

      await expect(page.getByTestId('main-layout')).toBeVisible();

      await openSettingsHub(page);

      const sidebarLogo = page.getByTestId('sidebar-brand-logo');

      await ensureTheme(page, 'light');
      await page.getByTestId('settings-hub-menu-settings').click();
      const aboutLogo = page.getByTestId('settings-about-logo');
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
      await expect(page.getByTestId('skills-toolbar-card')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await openSettingsHub(page);

       await ensureTheme(page, 'dark');
       await page.getByTestId('settings-hub-menu-settings').click();
       await expect(page.locator('html')).toHaveClass(/dark/);
       await expect(sidebarLogo).toHaveAttribute('src', /logo-whale-light/);
       await expect(aboutLogo).toHaveAttribute('src', /logo-whale-light/);
       await closeSettingsHub(page);

       await page.getByTestId('sidebar-nav-dashboard').click();
       await expect(page.getByTestId('dashboard-page')).toBeVisible();
       await expect(page.getByTestId('dashboard-refresh-button')).toHaveCSS('color', 'rgb(255, 255, 255)');

       await page.getByTestId('sidebar-nav-agents').click();
       await expect(page.getByTestId('agents-page')).toBeVisible();
       await expect(page.getByTestId('agents-refresh-button')).toHaveCSS('color', 'rgb(255, 255, 255)');

       await openChannelsFromSettings(page);
       await expect(page.getByTestId('channels-refresh-button')).toHaveCSS('color', 'rgb(255, 255, 255)');

       await page.getByTestId('sidebar-nav-cron').click();
       await expect(page.getByTestId('cron-page')).toBeVisible();
       await expect(page.getByTestId('cron-refresh-button')).toHaveCSS('color', 'rgb(255, 255, 255)');

      await page.getByTestId('sidebar-nav-skills').click();
      await expect(page.getByTestId('skills-page')).toBeVisible();
      await expect(page.getByTestId('skills-toolbar-card')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await expect(page.getByTestId('skills-source-filter-all')).toHaveCSS('color', 'rgb(255, 255, 255)');
      await expect(page.getByTestId('skills-search-input')).toHaveCSS('color', 'rgb(255, 255, 255)');
    } finally {
      await closeElectronApp(app);
    }
  });
});
