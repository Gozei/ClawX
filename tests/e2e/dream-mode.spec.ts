import { closeElectronApp, expect, getStableWindow, openSettingsHub, test } from './fixtures/electron';

test.describe('Dream mode gating', () => {
  test.setTimeout(180_000);

  test('persists the dream mode switch and gates dream navigation', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();
      await expect(page.getByTestId('sidebar-nav-dream')).toHaveCount(0);

      await openSettingsHub(page);
      await page.getByTestId('settings-hub-menu-settings').click({ force: true });
      const switchControl = page.getByTestId('settings-dream-mode-switch');
      await switchControl.scrollIntoViewIfNeeded();
      await expect(switchControl).toHaveAttribute('data-state', 'unchecked');
      await switchControl.click({ force: true });
      await expect(switchControl).toHaveAttribute('data-state', 'checked');

      await expect(page.getByTestId('sidebar-nav-dream')).toBeVisible();
      await openSettingsHub(page);
      await expect(page.getByTestId('settings-hub-menu-dream')).toBeVisible();
      await page.getByTestId('settings-hub-menu-dream').click({ force: true });
      await expect(page.getByTestId('dream-page')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }

    const relaunched = await launchElectronApp({ skipSetup: true });
    try {
      const page = await getStableWindow(relaunched);
      await expect(page.getByTestId('main-layout')).toBeVisible();
      await expect(page.getByTestId('sidebar-nav-dream')).toBeVisible();

      await openSettingsHub(page);
      await page.getByTestId('settings-hub-menu-settings').click({ force: true });
      const switchControl = page.getByTestId('settings-dream-mode-switch');
      await switchControl.scrollIntoViewIfNeeded();
      await expect(switchControl).toHaveAttribute('data-state', 'checked');

      await switchControl.click({ force: true });
      await expect(switchControl).toHaveAttribute('data-state', 'unchecked');
      await expect(page.getByTestId('sidebar-nav-dream')).toHaveCount(0);
    } finally {
      await closeElectronApp(relaunched);
    }
  });
});
