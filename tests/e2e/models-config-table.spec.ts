import { completeSetup, expect, openModelsFromSettings, test } from './fixtures/electron';

const SEEDED_ACCOUNT_ID = 'models-config-openai-e2e';

async function seedConfiguredModels(page: Parameters<typeof completeSetup>[0]): Promise<void> {
  await page.evaluate(async ({ accountId }) => {
    const now = new Date().toISOString();
    await window.electron.ipcRenderer.invoke('hostapi:fetch', {
      path: '/api/provider-accounts',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        account: {
          id: accountId,
          vendorId: 'openai',
          label: 'OpenAI E2E',
          authMode: 'api_key',
          baseUrl: 'https://api.openai.com/v1',
          apiProtocol: 'openai-completions',
          model: 'gpt-5.4',
          metadata: {
            customModels: ['gpt-5.4-mini'],
            modelProtocols: {
              'gpt-5.4': 'openai-completions',
              'gpt-5.4-mini': 'openai-completions',
            },
          },
          enabled: true,
          isDefault: false,
          createdAt: now,
          updatedAt: now,
        },
        apiKey: 'sk-test',
      }),
    });

    await window.electron.ipcRenderer.invoke('hostapi:fetch', {
      path: '/api/provider-accounts/default',
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId }),
    });
  }, { accountId: SEEDED_ACCOUNT_ID });
}

test.describe('Models config table', () => {
  test('shows the simplified empty state on a fresh workspace', async ({ page }) => {
    await completeSetup(page);
    await openModelsFromSettings(page);
    await expect(page.getByTestId('models-config-panel')).toBeVisible();
    await expect(page.getByTestId('models-config-empty-state')).toBeVisible();
    await expect(page.getByTestId('models-config-add-button')).toBeVisible();
  });

  test('only shows the global default badge for configured rows', async ({ page }) => {
    await completeSetup(page);
    await seedConfiguredModels(page);

    await openModelsFromSettings(page);

    await expect(page.getByTestId('models-config-row')).toHaveCount(2);
    await expect(page.getByText('全局默认')).toBeVisible();
    await expect(page.getByText(/^默认$/)).toHaveCount(0);
  });
});
