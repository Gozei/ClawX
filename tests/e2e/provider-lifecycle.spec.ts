import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { completeSetup, expect, openModelsFromSettings, test } from './fixtures/electron';

const TEST_PROVIDER_ID = 'moonshot-e2e';
const TEST_PROVIDER_LABEL = 'Moonshot E2E';
const TEST_CUSTOM_PROVIDER_ID = 'custom-models-e2e';
const TEST_CUSTOM_PROVIDER_LABEL = 'Custom Models E2E';
const TEST_MERGED_PROVIDER_LABEL = 'Merged Custom E2E';

async function seedTestProvider(page: Parameters<typeof completeSetup>[0]): Promise<void> {
  await page.evaluate(async ({ providerId, providerLabel }) => {
    const now = new Date().toISOString();
    await window.electron.ipcRenderer.invoke('provider:save', {
      id: providerId,
      name: providerLabel,
      type: 'moonshot',
      baseUrl: 'https://api.moonshot.cn/v1',
      model: 'kimi-k2.5',
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
  }, { providerId: TEST_PROVIDER_ID, providerLabel: TEST_PROVIDER_LABEL });
}

async function seedCustomProvider(
  page: Parameters<typeof completeSetup>[0],
  baseUrl: string,
): Promise<void> {
  await page.evaluate(async ({ providerId, providerLabel, providerBaseUrl }) => {
    const now = new Date().toISOString();
    await window.electron.ipcRenderer.invoke('hostapi:fetch', {
      path: '/api/provider-accounts',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        account: {
          id: providerId,
          vendorId: 'custom',
          label: providerLabel,
          authMode: 'api_key',
          baseUrl: providerBaseUrl,
          apiProtocol: 'openai-completions',
          model: 'model-alpha',
          enabled: true,
          isDefault: false,
          createdAt: now,
          updatedAt: now,
        },
        apiKey: 'sk-test',
      }),
    });
  }, {
    providerId: TEST_CUSTOM_PROVIDER_ID,
    providerLabel: TEST_CUSTOM_PROVIDER_LABEL,
    providerBaseUrl: baseUrl,
  });
}

async function seedMergedCustomProviders(page: Parameters<typeof completeSetup>[0]): Promise<void> {
  await page.evaluate(async ({ providerLabel }) => {
    const baseUrl = 'https://api.merged-provider.example/v1';
    const accounts = [
      {
        id: 'custom-aa111111',
        vendorId: 'custom',
        label: providerLabel,
        authMode: 'api_key',
        baseUrl,
        apiProtocol: 'openai-completions',
        model: 'glm-4.6',
        metadata: {
          customModels: ['glm-5'],
        },
        enabled: true,
        isDefault: false,
        createdAt: '2026-04-09T10:00:00.000Z',
        updatedAt: '2026-04-09T10:00:00.000Z',
      },
      {
        id: 'custom-bb222222',
        vendorId: 'custom',
        label: providerLabel,
        authMode: 'api_key',
        baseUrl,
        apiProtocol: 'openai-completions',
        model: 'qwen3.5-plus',
        enabled: true,
        isDefault: false,
        createdAt: '2026-04-09T10:05:00.000Z',
        updatedAt: '2026-04-09T10:05:00.000Z',
      },
    ];

    for (const account of accounts) {
      await window.electron.ipcRenderer.invoke('hostapi:fetch', {
        path: '/api/provider-accounts',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account,
          apiKey: 'sk-test',
        }),
      });
    }
  }, { providerLabel: TEST_MERGED_PROVIDER_LABEL });
}

async function startMockOpenAiServer(): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const server = createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Not found' } }));
      return;
    }

    const chunks: Buffer[] = [];
    req.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on('end', () => {
      const rawBody = Buffer.concat(chunks).toString('utf8');
      const body = rawBody ? JSON.parse(rawBody) as { model?: string } : {};
      const model = body.model || '';

      if (model === 'bad-model') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Model not found' } }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: `chatcmpl-${model}`,
        object: 'chat.completion',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: `连接成功 ${model}`,
            },
            finish_reason: 'stop',
          },
        ],
      }));
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

test.describe('Deep AI Worker provider lifecycle', () => {
  test('shows a saved provider and removes it cleanly after deletion', async ({ page }) => {
    await completeSetup(page);
    await seedTestProvider(page);

    await openModelsFromSettings(page);
    await expect(page.getByTestId('providers-settings')).toBeVisible();
    await expect(page.getByTestId(`provider-card-${TEST_PROVIDER_ID}`)).toHaveCSS('border-top-width', '1px');
    await expect(page.getByTestId(`provider-card-${TEST_PROVIDER_ID}`)).toContainText(TEST_PROVIDER_LABEL);

    await page.getByTestId(`provider-card-${TEST_PROVIDER_ID}`).hover();
    await page.getByTestId(`provider-delete-${TEST_PROVIDER_ID}`).click();

    await expect(page.getByTestId(`provider-card-${TEST_PROVIDER_ID}`)).toHaveCount(0);
    await expect(page.getByText(TEST_PROVIDER_LABEL)).toHaveCount(0);
  });

  test('does not redisplay a deleted provider after relaunch', async ({ electronApp, launchElectronApp, page }) => {
    await completeSetup(page);
    await seedTestProvider(page);

    await openModelsFromSettings(page);
    await expect(page.getByTestId(`provider-card-${TEST_PROVIDER_ID}`)).toContainText(TEST_PROVIDER_LABEL);

    await page.getByTestId(`provider-card-${TEST_PROVIDER_ID}`).hover();
    await page.getByTestId(`provider-delete-${TEST_PROVIDER_ID}`).click();
    await expect(page.getByTestId(`provider-card-${TEST_PROVIDER_ID}`)).toHaveCount(0);

    await electronApp.close();

    const relaunchedApp = await launchElectronApp();
    try {
      const relaunchedPage = await relaunchedApp.firstWindow();
      await relaunchedPage.waitForLoadState('domcontentloaded');
      await expect(relaunchedPage.getByTestId('main-layout')).toBeVisible();

      await openModelsFromSettings(relaunchedPage);
      await expect(relaunchedPage.getByTestId('providers-settings')).toBeVisible();
      await expect(relaunchedPage.getByTestId(`provider-card-${TEST_PROVIDER_ID}`)).toHaveCount(0);
      await expect(relaunchedPage.getByText(TEST_PROVIDER_LABEL)).toHaveCount(0);
    } finally {
      await relaunchedApp.close();
    }
  });

  test('edits multiple model IDs with full-test gating before save', async ({ page }) => {
    const mockServer = await startMockOpenAiServer();
    const updatedProviderLabel = 'Custom Models E2E Updated';
    try {
      await completeSetup(page);
      await seedCustomProvider(page, mockServer.baseUrl);

      await openModelsFromSettings(page);
      await expect(page.getByTestId('providers-settings')).toBeVisible();
      const providerCard = page.getByTestId(`provider-card-${TEST_CUSTOM_PROVIDER_ID}`);
      await expect(providerCard).toContainText(TEST_CUSTOM_PROVIDER_LABEL);

      await page.getByTestId(`provider-edit-${TEST_CUSTOM_PROVIDER_ID}`).click();
      await page.getByTestId(`provider-edit-name-${TEST_CUSTOM_PROVIDER_ID}`).fill(updatedProviderLabel);

      const modelInput = page.getByTestId(`provider-edit-model-input-${TEST_CUSTOM_PROVIDER_ID}`);
      await modelInput.fill('model-beta\uFF0Cmodel-gamma\uFF0Cmodel-delta');
      await page.getByTestId(`provider-edit-add-model-${TEST_CUSTOM_PROVIDER_ID}`).click();

      await expect(providerCard).toContainText('model-alpha');
      await expect(providerCard).toContainText('model-beta');
      await expect(providerCard).toContainText('model-gamma');
      await expect(providerCard).toContainText('model-delta');
      const alphaChip = page.getByTestId(`provider-edit-remove-model-${TEST_CUSTOM_PROVIDER_ID}-model-alpha`).locator('..');
      const betaChip = page.getByTestId(`provider-edit-remove-model-${TEST_CUSTOM_PROVIDER_ID}-model-beta`).locator('..');
      await expect(
        alphaChip
      ).toHaveClass(/bg-blue-500\/10/);
      await expect(
        betaChip
      ).toHaveClass(/bg-blue-500\/10/);
      await page.getByTestId(`provider-edit-test-model-${TEST_CUSTOM_PROVIDER_ID}`).click();
      await expect(page.getByText(/model-alpha/)).toBeVisible();

      const testButton = page.getByTestId(`provider-edit-test-${TEST_CUSTOM_PROVIDER_ID}`);
      const saveButton = page.getByTestId(`provider-edit-save-${TEST_CUSTOM_PROVIDER_ID}`);
      const cancelButton = page.getByTestId(`provider-edit-cancel-${TEST_CUSTOM_PROVIDER_ID}`);
      await expect(testButton).toBeVisible();
      await expect(saveButton).toBeVisible();
      await expect(cancelButton).toBeVisible();
      await expect(
        saveButton.evaluate((element) => element.previousElementSibling?.getAttribute('data-testid'))
      ).resolves.toBe(`provider-edit-test-${TEST_CUSTOM_PROVIDER_ID}`);
      await expect(
        cancelButton.evaluate((element) => element.previousElementSibling?.getAttribute('data-testid'))
      ).resolves.toBe(`provider-edit-save-${TEST_CUSTOM_PROVIDER_ID}`);
      await expect(saveButton).toBeEnabled();
      await saveButton.click();
      await expect(saveButton).toBeVisible();

      await modelInput.fill('model-pending');
      await testButton.click();
      await expect(testButton).toBeEnabled();
      await expect(modelInput).toHaveValue('model-pending');
      await expect(
        alphaChip
      ).toHaveClass(/bg-blue-500\/10/);
      await modelInput.fill('');

      await testButton.click();
      await expect(testButton).toBeDisabled();
      await expect(testButton).toBeEnabled();
      await expect(
        alphaChip
      ).toHaveClass(/bg-emerald-500\/10/);
      await expect(
        betaChip
      ).toHaveClass(/bg-emerald-500\/10/);
      await saveButton.click();

      await expect(saveButton).toHaveCount(0);
      await expect(page.getByTestId(`provider-name-${TEST_CUSTOM_PROVIDER_ID}`)).toHaveText(updatedProviderLabel);
      await expect(providerCard).toContainText('model-alpha');
      await expect(providerCard).toContainText('model-beta');
      await expect(providerCard).toContainText('model-gamma');
      await expect(providerCard).toContainText('model-delta');
    } finally {
      await mockServer.close();
    }
  });

  test('shows all merged configured model IDs in edit mode for merged compatible providers', async ({ page }) => {
    await completeSetup(page);
    await seedMergedCustomProviders(page);

    await openModelsFromSettings(page);
    await expect(page.getByTestId('providers-settings')).toBeVisible();

    const providerCard = page.locator('[data-testid^="provider-card-"]').filter({ hasText: TEST_MERGED_PROVIDER_LABEL }).first();
    await expect(providerCard).toContainText('glm-4.6');
    await expect(providerCard).toContainText('glm-5');
    await expect(providerCard).toContainText('qwen3.5-plus');

    await providerCard.locator('[data-testid^="provider-edit-"]').click();

    const modelChips = providerCard.locator('[data-testid^="provider-edit-model-chip-"]');
    await expect(modelChips).toHaveCount(3);
    await expect(providerCard).toContainText('glm-4.6');
    await expect(providerCard).toContainText('glm-5');
    await expect(providerCard).toContainText('qwen3.5-plus');
  });
});
