import { createServer as createHttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  closeElectronApp,
  completeSetup,
  expect,
  getStableWindow,
  openModelsFromSettings,
  test,
} from './fixtures/electron';

const SEEDED_ACCOUNT_ID = 'models-config-openai-e2e';
const TEST_SUMMARY_ACCOUNT_ID = 'models-config-minimax-e2e';

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

async function seedSingleConfiguredModel(
  page: Parameters<typeof completeSetup>[0],
  accountId: string,
  modelId: string,
  baseUrl: string,
): Promise<void> {
  await page.evaluate(async ({ accountId: seededAccountId, modelId: seededModelId, providerBaseUrl }) => {
    const now = new Date().toISOString();
    const createResponse = await window.electron.ipcRenderer.invoke('hostapi:fetch', {
      path: '/api/provider-accounts',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        account: {
          id: seededAccountId,
          vendorId: 'custom',
          label: 'MiniMax E2E',
          authMode: 'api_key',
          baseUrl: providerBaseUrl,
          apiProtocol: 'openai-completions',
          model: seededModelId,
          enabled: true,
          isDefault: true,
          createdAt: now,
          updatedAt: now,
        },
        apiKey: 'sk-test-summary',
      }),
    });
    if (!createResponse?.data?.json?.success) {
      throw new Error(`Failed to seed provider account: ${JSON.stringify(createResponse)}`);
    }
  }, { accountId, modelId, providerBaseUrl: baseUrl });
}

async function waitForGatewayMutations(page: Parameters<typeof completeSetup>[0]): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const state = await page.evaluate(async () => {
      const response = await window.electron.ipcRenderer.invoke('hostapi:fetch', {
        path: '/api/gateway/status',
        method: 'GET',
      });
      return response?.data?.json?.state as string | undefined;
    });
    if (state !== 'starting' && state !== 'reconnecting') {
      return;
    }
    await page.waitForTimeout(500);
  }
  throw new Error('Gateway did not leave a transitioning state before provider setup');
}

async function stopGatewayForTeardown(page: Parameters<typeof completeSetup>[0]): Promise<void> {
  await page.evaluate(async () => {
    try {
      await window.electron.ipcRenderer.invoke('hostapi:fetch', {
        path: '/api/gateway/stop',
        method: 'POST',
      });
    } catch {
      // Best-effort cleanup for Windows file handles in e2e temp dirs.
    }
  });

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const state = await page.evaluate(async () => {
      const response = await window.electron.ipcRenderer.invoke('hostapi:fetch', {
        path: '/api/gateway/status',
        method: 'GET',
      });
      return response?.data?.json?.state as string | undefined;
    }).catch(() => undefined);
    if (!state || state === 'stopped' || state === 'error') {
      return;
    }
    await page.waitForTimeout(500);
  }
}

async function startMislabelingOpenAiServer(): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const server = createHttpServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Not found' } }));
      return;
    }

    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: 'chatcmpl-mislabel',
        object: 'chat.completion',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'Connection succeeded. Model: Meta-L',
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

  test('shows the configured model in a successful test summary', async ({ launchElectronApp }) => {
    test.setTimeout(180_000);
    const mockServer = await startMislabelingOpenAiServer();
    const app = await launchElectronApp({ skipSetup: true });
    let page: Awaited<ReturnType<typeof getStableWindow>> | null = null;

    try {
      page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();
      await waitForGatewayMutations(page);
      await seedSingleConfiguredModel(page, TEST_SUMMARY_ACCOUNT_ID, 'minimax2.7', mockServer.baseUrl);

      await openModelsFromSettings(page);

      const row = page.getByTestId('models-config-row').first();
      await expect(row).toContainText('minimax2.7');

      await page.getByTestId(`models-config-test-${TEST_SUMMARY_ACCOUNT_ID}:minimax2.7`).click();

      await expect(row).toContainText('\u8fde\u63a5\u6210\u529f\uff0c\u6a21\u578b\uff1aminimax2.7');
      await expect(row).not.toContainText('Meta-L');
    } finally {
      if (page) {
        await stopGatewayForTeardown(page);
      }
      await closeElectronApp(app);
      await mockServer.close();
    }
  });

  test('prefills the selected vendor base url and only lets custom edit it', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    let page: Awaited<ReturnType<typeof getStableWindow>> | null = null;
    try {
      page = await getStableWindow(app);

      await openModelsFromSettings(page);

      await page.getByTestId('models-config-add-button').click();
      const vendorSelect = page.getByTestId('models-config-sheet-vendor-select');
      const baseUrlInput = page.getByTestId('models-config-sheet-base-url-input');
      const labelInput = page.getByTestId('models-config-sheet-label-input');

      await expect(page.getByLabel('模型厂商')).toBeVisible();
      await expect(page.getByText('先选择模型服务提供商，协议、接口地址和推荐模型会随厂商自动联动。')).toBeVisible();
      await vendorSelect.selectOption('openai');
      await expect(labelInput).toHaveValue('OpenAI');
      await expect(baseUrlInput).toHaveValue('https://api.openai.com/v1');
      await expect(baseUrlInput).toHaveAttribute('readonly', '');

      await vendorSelect.selectOption('deepseek');
      await expect(labelInput).toHaveValue('DeepSeek');
      await expect(baseUrlInput).toHaveValue('https://api.deepseek.com');
      await expect(baseUrlInput).toHaveAttribute('readonly', '');

      await vendorSelect.selectOption('custom');
      await expect(labelInput).toHaveValue('自定义');
      await expect(baseUrlInput).toHaveValue('');
      await expect(baseUrlInput).not.toHaveAttribute('readonly', '');

      await baseUrlInput.fill('https://api.example.com/v1');
      await expect(baseUrlInput).toHaveValue('https://api.example.com/v1');
    } finally {
      if (page) {
        await stopGatewayForTeardown(page);
      }
      await closeElectronApp(app);
    }
  });
});
