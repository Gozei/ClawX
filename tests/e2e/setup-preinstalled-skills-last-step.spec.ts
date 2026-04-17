import { closeElectronApp, expect, test } from './fixtures/electron';

function getHoldMs(): number {
  const raw = process.env.CLAWX_E2E_HOLD_MS;
  if (!raw) return 0;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return parsed;
}

test.describe('Setup preinstalled skills guide', () => {
  test('opens the last onboarding step directly for review', async ({ launchElectronApp }) => {
    const electronApp = await launchElectronApp({ setupStep: 'skills' });

    try {
      const page = await electronApp.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      const lastStep = page.getByTestId('setup-preinstalled-skills-step');
      await expect(lastStep).toBeVisible();
      await expect(page.getByTestId('setup-celebration-left')).toBeVisible();
      await expect(page.getByTestId('setup-celebration-right')).toBeVisible();
      await expect(page.getByTestId('setup-preinstalled-category-legal')).toContainText('china-contract-review');
      await expect(page.getByTestId('setup-preinstalled-category-utilities')).toContainText('docx');

      await page.screenshot({
        path: test.info().outputPath('setup-preinstalled-skills-last-step.png'),
        fullPage: true,
      });

      const holdMs = getHoldMs();
      if (holdMs > 0) {
        await page.waitForTimeout(holdMs);
      }
    } finally {
      await closeElectronApp(electronApp);
    }
  });
});
