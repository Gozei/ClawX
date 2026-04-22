import { closeElectronApp, completeSetup, expect, openModelsFromSettings, test } from './fixtures/electron';

test.describe('Deep AI Worker Electron smoke flows', () => {
  test('shows the setup wizard on a fresh profile', async ({ page }) => {
    await expect(page.getByTestId('setup-page')).toBeVisible();
    await expect(page.getByTestId('setup-welcome-step')).toBeVisible();
    await expect(page.getByTestId('setup-skip-button')).toBeVisible();
    await expect(page.getByRole('button', { name: 'English' })).toBeVisible();
    await expect(page.getByRole('button', { name: '\u4e2d\u6587' })).toBeVisible();
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
