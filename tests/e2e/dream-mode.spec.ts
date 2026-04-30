import type { Page } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, openSettingsHub, test } from './fixtures/electron';

async function waitForGatewaySettled(page: Page): Promise<void> {
  await expect.poll(async () => await page.evaluate(async () => {
    const status = await window.electron.ipcRenderer.invoke('gateway:status') as { state?: string };
    return status?.state ?? 'unknown';
  }), { timeout: 60_000 }).not.toMatch(/^(starting|reconnecting)$/);
}

async function confirmGatewayImpact(page: Page): Promise<void> {
  const confirmDialog = page.getByTestId('gateway-impact-confirm-dialog');
  await expect(confirmDialog).toBeVisible();
  await confirmDialog.getByRole('button').last().click();
}

test.describe('Dream mode gating', () => {
  test.setTimeout(180_000);

  test('persists the dream mode switch, promotion speed, and gates dream navigation', async ({ launchElectronApp }) => {
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
      await waitForGatewaySettled(page);
      await switchControl.click({ force: true });
      await confirmGatewayImpact(page);
      await expect(switchControl).toHaveAttribute('data-state', 'checked');

      await expect(page.getByTestId('sidebar-nav-dream')).toHaveCount(0);
      await openSettingsHub(page);
      await expect(page.getByTestId('settings-hub-menu-dream')).toBeVisible();
      await page.getByTestId('settings-hub-menu-dream').click({ force: true });
      await expect(page.getByTestId('dream-page')).toBeVisible();

      const promotionSpeedSelect = page.getByTestId('dream-promotion-speed-select');
      await expect(promotionSpeedSelect).toHaveValue('balanced');
      await waitForGatewaySettled(page);
      await promotionSpeedSelect.selectOption('aggressive');
      await confirmGatewayImpact(page);
      await expect(promotionSpeedSelect).toHaveValue('aggressive');
    } finally {
      await closeElectronApp(app);
    }

    const relaunched = await launchElectronApp({ skipSetup: true });
    try {
      const page = await getStableWindow(relaunched);
      await expect(page.getByTestId('main-layout')).toBeVisible();
      await expect(page.getByTestId('sidebar-nav-dream')).toHaveCount(0);

      await openSettingsHub(page);
      await expect(page.getByTestId('settings-hub-menu-dream')).toBeVisible();
      await page.getByTestId('settings-hub-menu-dream').click({ force: true });
      await expect(page.getByTestId('dream-promotion-speed-select')).toHaveValue('aggressive');

      await openSettingsHub(page);
      await page.getByTestId('settings-hub-menu-settings').click({ force: true });
      const switchControl = page.getByTestId('settings-dream-mode-switch');
      await switchControl.scrollIntoViewIfNeeded();
      await expect(switchControl).toHaveAttribute('data-state', 'checked');

      await waitForGatewaySettled(page);
      await switchControl.click({ force: true });
      await confirmGatewayImpact(page);
      await expect(switchControl).toHaveAttribute('data-state', 'unchecked');
      await expect(page.getByTestId('sidebar-nav-dream')).toHaveCount(0);
      await openSettingsHub(page);
      await expect(page.getByTestId('settings-hub-menu-dream')).toHaveCount(0);
    } finally {
      await closeElectronApp(relaunched);
    }
  });
});
