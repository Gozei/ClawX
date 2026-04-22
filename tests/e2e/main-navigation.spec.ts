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
      await expect(page.getByTestId('settings-page-title')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });
});
