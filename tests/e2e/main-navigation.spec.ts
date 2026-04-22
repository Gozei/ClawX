import type { Page } from '@playwright/test';
import {
  closeElectronApp,
  expect,
  getStableWindow,
  openSettingsHub,
  test,
} from './fixtures/electron';

async function navigateToHash(page: Page, hashPath: string, testId: string) {
  await page.evaluate((targetHash) => {
    window.location.hash = targetHash;
  }, `#${hashPath}`);
  await expect(page.getByTestId(testId)).toBeVisible();
}

test.describe('Deep AI Worker main navigation baseline', () => {
  test('keeps the chat toolbar core controls visible with setup bypassed', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await page.setViewportSize({ width: 1440, height: 900 });

      await expect(page.getByTestId('main-layout')).toBeVisible();
      await expect(page.getByTestId('sidebar-top-header')).toBeVisible();
      await expect(page.getByTestId('chat-toolbar-header')).toBeVisible();
      await expect(page.getByTestId('chat-toolbar-controls')).toBeVisible();
      await expect(page.getByTestId('chat-refresh-button')).toBeVisible();
      await expect(page.getByTestId('chat-thinking-toggle')).toBeVisible();
      await expect(page.getByTestId('chat-toolbar-current-agent')).toContainText('Main Role');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('renders the core route pages through direct navigation', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      await navigateToHash(page, '/models', 'models-page');
      await expect(page.getByTestId('models-page-title')).toBeVisible();

      await navigateToHash(page, '/agents', 'agents-page');
      await expect(page.getByTestId('agents-card-grid')).toBeVisible();

      await navigateToHash(page, '/channels', 'channels-page');
      await expect(page.getByTestId('channels-page-title')).toBeVisible();

      await navigateToHash(page, '/skills', 'skills-page');
      await expect(page.getByTestId('skills-page-title')).toBeVisible();
      await expect(page.getByTestId('skills-search-input')).toBeVisible();

      await openSettingsHub(page);
      await page.getByTestId('settings-hub-menu-settings').click({ force: true });
      await expect(page.getByTestId('settings-page')).toBeVisible();
      await expect(page.getByTestId('settings-page-title')).toHaveCSS('font-size', '30px');
      await expect(page.getByTestId('settings-page-subtitle')).toHaveCSS('font-size', '14px');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('shows roles as a four-column card grid on wide screens and keeps details in the modal', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await page.setViewportSize({ width: 1440, height: 900 });

      await page.getByTestId('sidebar-nav-agents').click();
      await expect(page.getByTestId('agents-page')).toBeVisible();
      await expect(page.getByTestId('agents-card-grid')).toBeVisible();

      const cards = page.getByTestId('agent-overview-card');
      const grid = page.getByTestId('agents-card-grid');
      let expectedCount = await cards.count();

      for (const name of ['Ops Role', 'Finance Role', 'Support Role']) {
        expectedCount += 1;
        await createRole(page, name);
        await expect(cards).toHaveCount(expectedCount);
      }

      const firstRow = await Promise.all(
        Array.from({ length: 4 }, async (_, index) => await cards.nth(index).boundingBox()),
      );
      const gridBox = await grid.boundingBox();

      expect(firstRow.every(Boolean)).toBe(true);
      expect(gridBox).not.toBeNull();
      const yPositions = firstRow.map((box) => box!.y);
      const maxY = Math.max(...yPositions);
      const minY = Math.min(...yPositions);
      expect(maxY - minY).toBeLessThan(8);
      if (gridBox) {
        expect(minY - gridBox.y).toBeGreaterThan(4);
      }

      await page.getByTestId('agent-overview-card').first().hover();
      await page.getByTestId('agent-open-settings-button').first().click();
      await expect(page.getByTestId('agent-model-summary-card')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });

  test('promotes a role to default from model settings and sorts it to the front', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      const roleName = `Priority Role ${Date.now()}`;

      await page.getByTestId('sidebar-nav-agents').click();
      await expect(page.getByTestId('agents-page')).toBeVisible();

      await createRole(page, roleName);

      const roleCard = getAgentCard(page, roleName);
      await roleCard.hover();
      const settingsButton = roleCard.getByTestId('agent-open-settings-button');
      await expect(settingsButton).toBeVisible();
      await settingsButton.click({ force: true });

      await page.getByTestId('agent-model-summary-card').click();
      await expect(page.getByTestId('agent-model-dialog')).toBeVisible();

      await page.getByTestId('agent-set-default-checkbox').check();
      await page.getByTestId('agent-model-save-button').click();
      await expect(page.getByTestId('agent-model-dialog')).toHaveCount(0);

      const firstCard = page.getByTestId('agent-overview-card').first();
      await expect(firstCard).toContainText(roleName);
      await expect(firstCard.getByTestId('agent-default-badge')).toBeVisible();
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
      await dismissSkillsGuideIfVisible(page);
      await expect(page.getByTestId('skills-search-input')).toBeVisible();
      await expect(page.getByTestId('skills-create-button')).toHaveCount(0);
      await expect(page.getByTestId('skills-discover-button')).toBeVisible();
      await openSettingsHub(page);
      await page.getByTestId('settings-hub-menu-settings').click();
      await expect(page.getByTestId('settings-page')).toBeVisible();

      await ensureTheme(page, 'dark');
      await page.getByTestId('settings-hub-menu-settings').click();
      await expect(page.locator('html')).toHaveClass(/dark/);
      await expect(sidebarLogo).toHaveAttribute('src', /logo-whale-light/);
      await expect(aboutLogo).toHaveAttribute('src', /logo-whale-light/);
      await closeSettingsHub(page);

      await openSettingsHub(page);
      await page.getByTestId('settings-hub-menu-dashboard').click();
      await expect(page.getByTestId('dashboard-page')).toBeVisible();
      await expect(page.getByTestId('dashboard-page-title')).toBeVisible();
      await expect(page.getByTestId('dashboard-refresh-button')).toHaveCount(0);

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
      await dismissSkillsGuideIfVisible(page);
      await expect(page.getByTestId('skills-search-input')).toBeVisible();
      await expect(page.getByTestId('skills-create-button')).toHaveCount(0);
      await expect(page.getByTestId('skills-discover-button')).toBeVisible();
      await expect(page.getByTestId('skills-search-input')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });

  test('keeps the Windows title bar maximize control readable in both themes', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      const platform = await page.evaluate(() => window.electron?.platform ?? null);
      test.skip(platform !== 'win32', 'Custom title bar controls only render on Windows');

      const maximizeButton = page.getByTestId('titlebar-maximize-button');

      await expect(page.getByTestId('main-layout')).toBeVisible();
      await expect(maximizeButton).toBeVisible();
      await expect(maximizeButton).toHaveClass(/hover:bg-\[#ebf1fb\]/);
      await expect(maximizeButton).toHaveClass(/dark:hover:bg-white\/\[0\.08\]/);

      await openSettingsHub(page);
      await ensureTheme(page, 'light');
      await closeSettingsHub(page);
      await expect(maximizeButton).toHaveCSS('color', 'rgb(92, 106, 127)');

      await openSettingsHub(page);
      await ensureTheme(page, 'dark');
      await closeSettingsHub(page);
      await expect(maximizeButton).toHaveCSS('color', 'rgb(201, 212, 227)');
    } finally {
      await closeElectronApp(app);
    }
  });
});
