import { expect, openModelsFromSettings, test } from './fixtures/electron';

test.describe('Models config table', () => {
  test('shows the simplified empty state on a fresh workspace', async ({ page }) => {
    await openModelsFromSettings(page);
    await expect(page.getByTestId('models-config-panel')).toBeVisible();
    await expect(page.getByTestId('models-config-empty-state')).toBeVisible();
    await expect(page.getByTestId('models-config-add-button')).toBeVisible();
  });
});
