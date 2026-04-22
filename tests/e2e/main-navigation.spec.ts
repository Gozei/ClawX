import type { Page } from '@playwright/test';
import {
  closeElectronApp,
  closeSettingsHub,
  expect,
  getStableWindow,
  openChannelsFromSettings,
  openModelsFromSettings,
  openSettingsHub,
  test,
} from './fixtures/electron';

async function dismissSkillsGuideIfVisible(page: Page) {
  const guideSkipButton = page.getByTestId('app-guide-skip');
  if (await guideSkipButton.isVisible().catch(() => false)) {
    await guideSkipButton.click();
    await expect(page.getByTestId('app-guide-overlay')).toHaveCount(0);
  }
}

async function ensureTheme(page: Awaited<ReturnType<typeof getStableWindow>>, theme: 'light' | 'dark') {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const className = await page.locator('html').getAttribute('class');
    if (className?.includes(theme)) return;
    await page.getByTestId('settings-hub-menu-theme').click();
  }
  await expect(page.locator('html')).toHaveClass(new RegExp(theme));
}

async function createRole(page: Page, name: string) {
  await page.getByTestId('agents-add-button').click();
  await expect(page.getByTestId('add-agent-dialog')).toBeVisible();
  await page.locator('#agent-name').fill(name);
  await page.getByTestId('add-agent-save-button').click();
  await expect(page.getByTestId('add-agent-dialog')).toHaveCount(0);
  await expect(page.getByText(name).first()).toBeVisible();
}

function getAgentCard(page: Page, name: string) {
  return page.locator('[data-testid="agent-overview-card"]', { hasText: name }).first();
}

test.describe('Deep AI Worker main navigation without setup flow', () => {
  test('keeps the chat toolbar split into a left role label and three right-side action groups', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await page.setViewportSize({ width: 1440, height: 900 });
      const newChatButton = page.getByTestId('sidebar-new-chat');
      if (await newChatButton.count()) {
        await newChatButton.click();
      }

      const sidebarHeader = page.getByTestId('sidebar-top-header');
      const toolbarHeader = page.getByTestId('chat-toolbar-header');
      const currentAgent = page.getByTestId('chat-toolbar-current-agent');
      const currentAgentName = page.getByTestId('chat-toolbar-current-agent-name');
      const toolbarControls = page.getByTestId('chat-toolbar-controls');
      const refreshGroup = page.getByTestId('chat-toolbar-refresh-group');
      const readingGroup = page.getByTestId('chat-toolbar-reading');
      const dividerOne = page.getByTestId('chat-toolbar-divider-1');
      const dividerTwo = page.getByTestId('chat-toolbar-divider-2');
      const refreshButton = page.getByTestId('chat-refresh-button');
      const thinkingLabel = page.getByTestId('chat-thinking-label');
      const thinkingToggle = page.getByTestId('chat-thinking-toggle');

      await expect(page.getByTestId('main-layout')).toBeVisible();
      await expect(sidebarHeader).toBeVisible();
      await expect(toolbarHeader).toBeVisible();
      await expect(toolbarControls).toBeVisible();
      await expect(currentAgent).toHaveText('Main Role');
      await expect(refreshGroup).toBeVisible();
      await expect(readingGroup).toBeVisible();
      await expect(dividerOne).toBeVisible();
      await expect(dividerTwo).toBeVisible();
      await expect(refreshButton).toBeVisible();
      await expect(thinkingLabel).toBeVisible();
      await expect(page.getByTestId('chat-toolbar-reading-label')).toHaveCount(0);
      await expect(sidebarHeader).toHaveCSS('height', '56px');
      await expect(toolbarHeader).toHaveCSS('height', '56px');
      await expect(currentAgentName).toHaveCSS('font-size', '13px');
      await expect(thinkingLabel).toHaveCSS('font-size', '13px');

      const [agentBox, refreshBox, readingBox, thinkingBox] = await Promise.all([
        currentAgent.boundingBox(),
        refreshGroup.boundingBox(),
        readingGroup.boundingBox(),
        thinkingToggle.boundingBox(),
      ]);
      expect(agentBox).not.toBeNull();
      expect(refreshBox).not.toBeNull();
      expect(readingBox).not.toBeNull();
      expect(thinkingBox).not.toBeNull();
      if (agentBox && refreshBox && readingBox && thinkingBox) {
        expect(agentBox.x).toBeLessThan(refreshBox.x);
        expect(refreshBox.x).toBeLessThan(readingBox.x);
        expect(readingBox.x).toBeLessThan(thinkingBox.x);
      }
    } finally {
      await closeElectronApp(app);
    }
  });

  test('navigates between core pages with setup bypassed', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);

      await expect(page.getByTestId('main-layout')).toBeVisible();

      await openModelsFromSettings(page);
      await expect(page.getByTestId('models-page-title')).toBeVisible();

      await page.getByTestId('sidebar-nav-agents').click();
      await expect(page.getByTestId('agents-page')).toBeVisible();
      await expect(page.getByTestId('agents-card-grid')).toBeVisible();
      await expect(page.getByText('Main Role').first()).toBeVisible();
      await expect(page.getByText(/Specialist|专家型/).first()).toBeVisible();
      await page.getByTestId('agent-overview-card').first().hover();
      await expect(page.getByTestId('agent-open-settings-button').first()).toBeVisible();

      const firstCard = page.getByTestId('agent-overview-card').first();
      const cardBox = await firstCard.boundingBox();
      const titleBox = await page.getByText('Main Role').first().boundingBox();
      expect(cardBox).not.toBeNull();
      expect(titleBox).not.toBeNull();
      if (cardBox && titleBox) {
        const cardCenterX = cardBox.x + (cardBox.width / 2);
        const titleCenterX = titleBox.x + (titleBox.width / 2);
        expect(Math.abs(cardCenterX - titleCenterX)).toBeLessThan(10);
      }

      await openChannelsFromSettings(page);
      const channelsTitleBox = await page.getByTestId('channels-page-title').boundingBox();

      await page.getByTestId('sidebar-nav-skills').click();
      await expect(page.getByTestId('skills-page')).toBeVisible();
      await dismissSkillsGuideIfVisible(page);
      await expect(page.getByTestId('skills-search-input')).toBeVisible();
      await expect(page.getByTestId('skills-page-title')).toBeVisible();
      await expect(page.getByTestId('skills-create-button')).toHaveCount(0);

      await page.getByTestId('skills-discover-button').click();
      await expect(page.getByTestId('skills-marketplace-panel')).toBeVisible();
      await expect(page.getByTestId('skills-marketplace-source-chips')).toBeVisible();
      await page.getByLabel(/Close skill marketplace|关闭技能市场/).click();
      await expect(page.getByTestId('skills-marketplace-panel')).toHaveCount(0);

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
