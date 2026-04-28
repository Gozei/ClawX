import { closeElectronApp, completeSetup, expect, getStableWindow, openModelsFromSettings, test } from './fixtures/electron';

const SEEDED_ACCOUNT_ID = 'provider-lifecycle-openai-e2e';
const SEEDED_PROVIDER_LABEL = 'OpenAI Lifecycle E2E';
const SEEDED_MODEL_ID = 'gpt-5.4';
async function seedConfiguredModel(page: Parameters<typeof completeSetup>[0]): Promise<void> {
  await page.evaluate(async ({ accountId, providerLabel, modelId }) => {
    const now = new Date().toISOString();
    await window.electron.ipcRenderer.invoke('hostapi:fetch', {
      path: '/api/provider-accounts',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        account: {
          id: accountId,
          vendorId: 'openai',
          label: providerLabel,
          authMode: 'api_key',
          baseUrl: 'https://api.provider-e2e.invalid/v1',
          apiProtocol: 'openai-completions',
          model: modelId,
          enabled: true,
          isDefault: false,
          createdAt: now,
          updatedAt: now,
        },
        apiKey: 'sk-e2e-placeholder',
      }),
    });

    await window.electron.ipcRenderer.invoke('hostapi:fetch', {
      path: '/api/provider-accounts/default',
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId }),
    });
  }, {
    accountId: SEEDED_ACCOUNT_ID,
    providerLabel: SEEDED_PROVIDER_LABEL,
    modelId: SEEDED_MODEL_ID,
  });
}

test.describe('Models config lifecycle', () => {
  test('shows a seeded config row with the current actions and default badge', async ({ page }) => {
    await completeSetup(page);
    await seedConfiguredModel(page);

    await openModelsFromSettings(page);
    await expect(page.getByTestId('models-config-panel')).toBeVisible();
    await expect(page.getByTestId('models-config-row')).toHaveCount(1);

    const row = page.getByTestId('models-config-row').first();
    await expect(row).toContainText(SEEDED_PROVIDER_LABEL);
    await expect(row).toContainText(SEEDED_MODEL_ID);
    await expect(row.getByText('全局默认')).toBeVisible();
    await expect(page.getByTestId(`models-config-test-${SEEDED_ACCOUNT_ID}:${SEEDED_MODEL_ID}`)).toBeVisible();
    await expect(page.getByTestId(`models-config-edit-${SEEDED_ACCOUNT_ID}:${SEEDED_MODEL_ID}`)).toBeVisible();
    await expect(page.getByTestId(`models-config-delete-${SEEDED_ACCOUNT_ID}:${SEEDED_MODEL_ID}`)).toBeVisible();
  });

  test('deletes a saved config and keeps the workspace empty after relaunch', async ({ electronApp, launchElectronApp, page }) => {
    await completeSetup(page);
    await seedConfiguredModel(page);

    await openModelsFromSettings(page);
    await expect(page.getByTestId('models-config-row')).toHaveCount(1);

    await page.getByTestId(`models-config-delete-${SEEDED_ACCOUNT_ID}:${SEEDED_MODEL_ID}`).click({ force: true });
    const confirmDialog = page.getByTestId('gateway-impact-confirm-dialog');
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole('button', { name: /Apply and Restart|应用并重启/ }).click();
    await expect(page.getByTestId('models-config-row')).toHaveCount(0);
    await expect(page.getByTestId('models-config-empty-state')).toBeVisible();

    await closeElectronApp(electronApp);

    const relaunchedApp = await launchElectronApp({ skipSetup: true });
    try {
      const relaunchedPage = await getStableWindow(relaunchedApp);
      await expect(relaunchedPage.getByTestId('main-layout')).toBeVisible();

      await openModelsFromSettings(relaunchedPage);
      await expect(relaunchedPage.getByTestId('models-config-row')).toHaveCount(0);
      await expect(relaunchedPage.getByTestId('models-config-empty-state')).toBeVisible();
      await expect(relaunchedPage.getByText(SEEDED_PROVIDER_LABEL)).toHaveCount(0);
    } finally {
      await closeElectronApp(relaunchedApp);
    }
  });

  test('keeps the saved config visible when delete confirmation is cancelled', async ({ page }) => {
    await completeSetup(page);
    await seedConfiguredModel(page);

    await openModelsFromSettings(page);
    await expect(page.getByTestId('models-config-row')).toHaveCount(1);

    await page.getByTestId(`models-config-delete-${SEEDED_ACCOUNT_ID}:${SEEDED_MODEL_ID}`).click({ force: true });
    const confirmDialog = page.getByTestId('gateway-impact-confirm-dialog');
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole('button', { name: /Cancel|取消/ }).click();

    await expect(page.getByTestId('gateway-impact-confirm-dialog')).toHaveCount(0);
    await expect(page.getByTestId('models-config-row')).toHaveCount(1);
    await expect(page.getByText(SEEDED_PROVIDER_LABEL)).toBeVisible();
  });
});
