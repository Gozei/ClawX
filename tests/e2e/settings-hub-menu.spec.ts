import { closeElectronApp, expect, getStableWindow, openSettingsHub, test } from './fixtures/electron';

test.describe('Settings hub menu', () => {
  async function readComputedVisualState(locator: ReturnType<Awaited<ReturnType<typeof getStableWindow>>['getByTestId']>) {
    return await locator.evaluate((node) => {
      const styles = window.getComputedStyle(node as HTMLElement);
      return {
        backgroundColor: styles.backgroundColor,
        backgroundImage: styles.backgroundImage,
        borderColor: styles.borderColor,
        color: styles.color,
        boxShadow: styles.boxShadow,
      };
    });
  }

  async function expectMenuItemSelectedState(
    page: Awaited<ReturnType<typeof getStableWindow>>,
    key: 'dashboard' | 'models' | 'channels' | 'settings',
  ): Promise<void> {
    const selectedItem = page.getByTestId(`settings-hub-menu-${key}`);
    await expect(selectedItem).toHaveAttribute('data-selected', 'true');
    await expect(selectedItem.locator('[data-slot="settings-hub-icon-shell"]')).toHaveAttribute('data-selected', 'true');
  }

  test('opens the settings sheet and uses it as a menu of entry points', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      await openSettingsHub(page);
      const settingsHubWidth = await page.getByTestId('settings-hub-sheet').evaluate((node) => {
        return window.getComputedStyle(node as HTMLElement).width;
      });
      expect(settingsHubWidth).toBe('300px');

      await expect(page.getByTestId('settings-hub-menu-models')).toBeVisible();
      await expect(page.getByTestId('settings-hub-menu-dashboard')).toBeVisible();
      await expect(page.getByTestId('settings-hub-menu-channels')).toBeVisible();
      await expect(page.getByTestId('settings-hub-menu-theme')).toBeVisible();
      await expect(page.getByTestId('settings-hub-menu-language')).toBeVisible();
      await expect(page.getByTestId('settings-hub-menu-settings')).toBeVisible();
      await expect(page.getByTestId('settings-hub-menu-check-updates')).toBeVisible();
      await expect(page.getByTestId('settings-hub-menu-console')).toBeVisible();

      await page.getByTestId('settings-hub-menu-dashboard').click();
      await expect(page.getByTestId('settings-hub-sheet-container')).toHaveCount(0);
      await expect(page.getByTestId('dashboard-page')).toBeVisible();

      await openSettingsHub(page);
      await expectMenuItemSelectedState(page, 'dashboard');
      await expect(page.getByTestId('settings-hub-menu-models')).toHaveAttribute('data-selected', 'false');
      await expect(page.getByTestId('settings-hub-menu-channels')).toHaveAttribute('data-selected', 'false');
      await expect(page.getByTestId('settings-hub-menu-settings')).toHaveAttribute('data-selected', 'false');
      await page.getByTestId('settings-hub-menu-models').click();
      await expect(page.getByTestId('settings-hub-sheet-container')).toHaveCount(0);
      await expect(page.getByTestId('models-page')).toBeVisible();

      await openSettingsHub(page);
      await expectMenuItemSelectedState(page, 'models');
      await expect(page.getByTestId('settings-hub-menu-channels')).toHaveAttribute('data-selected', 'false');
      await expect(page.getByTestId('settings-hub-menu-settings')).toHaveAttribute('data-selected', 'false');
      await page.getByTestId('settings-hub-menu-channels').click();
      await expect(page.getByTestId('settings-hub-sheet-container')).toHaveCount(0);
      await expect(page.getByTestId('channels-page')).toBeVisible();

      await openSettingsHub(page);
      await expectMenuItemSelectedState(page, 'channels');
      await expect(page.getByTestId('settings-hub-menu-models')).toHaveAttribute('data-selected', 'false');
      await expect(page.getByTestId('settings-hub-menu-settings')).toHaveAttribute('data-selected', 'false');
      await page.getByTestId('settings-hub-menu-settings').click();
      await expect(page.getByTestId('settings-hub-sheet-container')).toHaveCount(0);
      await expect(page.getByTestId('settings-page')).toBeVisible();
      await expect(page.getByTestId('settings-updates-section')).toBeVisible();

      await openSettingsHub(page);
      await expectMenuItemSelectedState(page, 'settings');
      await expect(page.getByTestId('settings-hub-menu-models')).toHaveAttribute('data-selected', 'false');
      await expect(page.getByTestId('settings-hub-menu-channels')).toHaveAttribute('data-selected', 'false');
      await expect(page.getByTestId('settings-hub-menu-check-updates')).toHaveAttribute('data-selected', 'false');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('keeps hover and selected menu visuals coordinated with the icon shell', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      await openSettingsHub(page);

      const themeItem = page.getByTestId('settings-hub-menu-theme');
      const themeIcon = page.getByTestId('settings-hub-menu-theme-icon');
      const themeIdleState = await readComputedVisualState(themeItem);
      const themeIdleIconState = await readComputedVisualState(themeIcon);

      await themeItem.hover();
      await page.waitForTimeout(250);

      const themeHoverState = await readComputedVisualState(themeItem);
      const themeHoverIconState = await readComputedVisualState(themeIcon);

      expect(themeHoverState.backgroundColor).not.toBe(themeIdleState.backgroundColor);
      expect(themeHoverIconState.color).not.toBe(themeIdleIconState.color);

      await page.getByTestId('settings-hub-menu-models').click();
      await expect(page.getByTestId('models-page')).toBeVisible();

      await openSettingsHub(page);

      const selectedModelsItem = page.getByTestId('settings-hub-menu-models');
      const selectedModelsIcon = page.getByTestId('settings-hub-menu-models-icon');
      const idleChannelsItem = page.getByTestId('settings-hub-menu-channels');
      const idleChannelsIcon = page.getByTestId('settings-hub-menu-channels-icon');

      const selectedModelsState = await readComputedVisualState(selectedModelsItem);
      const selectedModelsIconState = await readComputedVisualState(selectedModelsIcon);
      const idleChannelsState = await readComputedVisualState(idleChannelsItem);
      const idleChannelsIconState = await readComputedVisualState(idleChannelsIcon);

      expect(selectedModelsState.backgroundColor).not.toBe(idleChannelsState.backgroundColor);
      expect(selectedModelsState.boxShadow).not.toBe(idleChannelsState.boxShadow);
      expect(selectedModelsState.color).not.toBe(idleChannelsState.color);
      expect(selectedModelsIconState.color).not.toBe(idleChannelsIconState.color);
      expect(selectedModelsIconState.backgroundColor).toBe('rgba(0, 0, 0, 0)');
      expect(idleChannelsIconState.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('shows slash-based theme and language toggles and switches on click', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      await openSettingsHub(page);

      const themeToggle = page.getByTestId('settings-hub-menu-theme').locator('[data-slot="settings-hub-trailing"]');
      const languageToggle = page.getByTestId('settings-hub-menu-language').locator('[data-slot="settings-hub-trailing"]');

      await expect(themeToggle).toContainText('/');
      await expect(languageToggle).toContainText('\u4e2d\u6587');
      await expect(languageToggle).toContainText('English');

      const htmlClassBefore = await page.locator('html').getAttribute('class');
      await page.getByTestId('settings-hub-menu-theme').click();
      await expect.poll(async () => await page.locator('html').getAttribute('class')).not.toBe(htmlClassBefore);

      const languageColorsBefore = await languageToggle.evaluate((node) => {
        return Array.from(node.querySelectorAll('span')).map((item) => window.getComputedStyle(item).color);
      });
      await page.getByTestId('settings-hub-menu-language').click();
      await expect.poll(async () => {
        return await languageToggle.evaluate((node) => {
          return Array.from(node.querySelectorAll('span')).map((item) => window.getComputedStyle(item).color).join('|');
        });
      }).not.toBe(languageColorsBefore.join('|'));
    } finally {
      await closeElectronApp(app);
    }
  });
});
