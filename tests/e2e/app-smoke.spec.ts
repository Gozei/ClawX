import { closeElectronApp, completeSetup, expect, openModelsFromSettings, test } from './fixtures/electron';

test.describe('Deep AI Worker Electron smoke flows', () => {
  test('shows the first window without waiting indefinitely for ready-to-show', async ({ launchElectronApp }) => {
    const startupStart = performance.now();
    const electronApp = await launchElectronApp({ skipSetup: true });

    try {
      const firstWindow = await electronApp.firstWindow();
      await firstWindow.waitForLoadState('domcontentloaded');
      await expect(firstWindow.getByTestId('main-layout')).toBeVisible({ timeout: 20_000 });
      expect(performance.now() - startupStart).toBeLessThan(20_000);
    } finally {
      await closeElectronApp(electronApp);
    }
  });

  test('shows the setup wizard on a fresh profile', async ({ page }) => {
    await expect(page.getByTestId('setup-page')).toBeVisible();
    await expect(page.getByTestId('setup-welcome-step')).toBeVisible();
    await expect(page.getByTestId('setup-skip-button')).toBeVisible();
    await expect(page.getByRole('button', { name: 'English' })).toBeVisible();
    await expect(page.getByRole('button', { name: '\u4e2d\u6587' })).toBeVisible();
  });

  test('keeps setup welcome actions fully visible in a compact window', async ({ electronApp }) => {
    const page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    await electronApp.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window?.setSize(1280, 720);
    });

    await expect(page.getByTestId('setup-page')).toBeVisible();
    await expect(page.getByTestId('setup-welcome-step')).toBeVisible();

    const skipButton = page.getByTestId('setup-skip-button');
    const nextButton = page.getByTestId('setup-next-button');
    await expect(skipButton).toBeVisible();
    await expect(nextButton).toBeVisible();

    const viewportHeight = await page.evaluate(() => window.innerHeight);
    const skipBox = await skipButton.boundingBox();
    const nextBox = await nextButton.boundingBox();

    expect(skipBox).not.toBeNull();
    expect(nextBox).not.toBeNull();
    expect((skipBox?.y ?? 0) + (skipBox?.height ?? 0)).toBeLessThanOrEqual(viewportHeight);
    expect((nextBox?.y ?? 0) + (nextBox?.height ?? 0)).toBeLessThanOrEqual(viewportHeight);
    expect(viewportHeight - ((nextBox?.y ?? 0) + (nextBox?.height ?? 0))).toBeGreaterThanOrEqual(4);
  });

  test('can skip setup and navigate to the models page', async ({ page }) => {
    await completeSetup(page);
    await expect(page.getByTestId('chat-welcome-title')).toBeVisible();
    await openModelsFromSettings(page);
    await expect(page.getByTestId('models-page-title')).toBeVisible();
    await expect(page.getByTestId('models-config-panel')).toBeVisible();
  });

  test('persists skipped setup across relaunch for the same isolated profile', async ({ electronApp, launchElectronApp }) => {
    const firstWindow = await electronApp.firstWindow();
    await firstWindow.waitForLoadState('domcontentloaded');
    await completeSetup(firstWindow);

    await closeElectronApp(electronApp);

    const relaunchedApp = await launchElectronApp();
    try {
      const relaunchedWindow = await relaunchedApp.firstWindow();
      await relaunchedWindow.waitForLoadState('domcontentloaded');

      await expect(relaunchedWindow.getByTestId('main-layout')).toBeVisible();
      await expect(relaunchedWindow.getByTestId('setup-page')).toHaveCount(0);
    } finally {
      await closeElectronApp(relaunchedApp);
    }
  });
});
