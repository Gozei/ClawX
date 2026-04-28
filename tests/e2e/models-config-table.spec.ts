import { completeSetup, expect, installIpcMocks, openModelsFromSettings, test } from './fixtures/electron';

const SEEDED_ACCOUNT_ID = 'custom-modelse2e';
const SEEDED_BASE_URL = 'https://api.models-e2e.invalid/v1';
const SEEDED_MODEL_ID = 'model-alpha';

function hostJson(json: unknown) {
  return { ok: true, data: { status: 200, ok: true, json } };
}

async function installSeededModelSnapshot(app: Parameters<typeof installIpcMocks>[0]): Promise<void> {
  const now = '2026-04-13T00:00:00.000Z';
  const account = {
    id: SEEDED_ACCOUNT_ID,
    vendorId: 'custom',
    label: 'Models Config E2E',
    authMode: 'api_key',
    baseUrl: SEEDED_BASE_URL,
    apiProtocol: 'openai-completions',
    model: SEEDED_MODEL_ID,
    metadata: {
      customModels: ['model-beta'],
      modelProtocols: {
        [SEEDED_MODEL_ID]: 'openai-completions',
        'model-beta': 'openai-completions',
      },
    },
    enabled: true,
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  };

  await installIpcMocks(app, {
    hostApi: {
      '["/api/provider-accounts","GET"]': hostJson([account]),
      '["/api/provider-account-statuses","GET"]': hostJson([
        {
          id: SEEDED_ACCOUNT_ID,
          type: 'custom',
          name: 'Models Config E2E',
          hasKey: true,
          keyMasked: 'sk-***',
          enabled: true,
          createdAt: now,
          updatedAt: now,
          model: SEEDED_MODEL_ID,
        },
      ]),
      '["/api/provider-vendors","GET"]': hostJson([
        {
          id: 'custom',
          name: 'Custom',
          hidden: false,
          supportsMultipleAccounts: true,
          supportedAuthModes: ['api_key'],
          defaultAuthMode: 'api_key',
          category: 'custom',
        },
      ]),
      '["/api/provider-accounts/default","GET"]': hostJson({ accountId: SEEDED_ACCOUNT_ID }),
    },
  });
}

test.describe('Models config table', () => {
  test('shows the simplified empty state on a fresh workspace', async ({ page }) => {
    await completeSetup(page);
    await openModelsFromSettings(page);
    await expect(page.getByTestId('models-config-panel')).toBeVisible();
    await expect(page.getByTestId('models-config-empty-state')).toBeVisible();
    await expect(page.getByTestId('models-config-add-button')).toBeVisible();
  });

  test('only shows the global default badge for configured rows', async ({ electronApp, page }) => {
    await completeSetup(page);
    await installSeededModelSnapshot(electronApp);

    await openModelsFromSettings(page);

    await expect(page.getByTestId('models-config-row')).toHaveCount(2);
    await expect(page.getByText('全局默认')).toBeVisible();
    await expect(page.getByText(/^默认$/)).toHaveCount(0);
  });

  test('blocks duplicate drafts with the same provider URL and model ID', async ({ electronApp, page }) => {
    await completeSetup(page);
    await installSeededModelSnapshot(electronApp);

    await openModelsFromSettings(page);
    await expect(page.getByTestId('models-config-row')).toHaveCount(2);

    await page.getByTestId('models-config-add-button').click();
    const sheet = page.getByTestId('models-config-sheet');
    await expect(sheet).toBeVisible();
    await sheet.getByTestId('models-config-sheet-vendor-select').selectOption('custom');
    await sheet.getByTestId('models-config-sheet-model-input').fill('MODEL-ALPHA');
    await sheet.getByTestId('models-config-sheet-base-url-input').fill(`${SEEDED_BASE_URL}/`);
    await sheet.getByTestId('models-config-sheet-test-button').click();

    await expect(page.getByText(`Duplicate model configuration: ${SEEDED_BASE_URL} / ${SEEDED_MODEL_ID}`)).toBeVisible();
    await expect(page.getByTestId('models-config-apply-button')).toBeDisabled();
  });
});
