import { createServer as createHttpServer } from 'node:http';
import { createServer as createTcpServer, type AddressInfo } from 'node:net';
import type { Page } from '@playwright/test';
import { completeSetup, expect, openModelsFromSettings, test } from './fixtures/electron';

type GatewayStatus = {
  state: string;
  pid?: number;
  connectedAt?: number;
  port?: number;
};

const DEFAULT_ACCOUNT_ID = 'custom-a1b2c3d4';
const DEFAULT_PROVIDER_LABEL = 'Gateway E2E';
const DEFAULT_API_KEY = 'sk-test';
const GATEWAY_STABLE_MS = 9_000;
const GATEWAY_START_TIMEOUT_MS = 180_000;

async function hostApiJson<T>(
  page: Page,
  path: string,
  options?: {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
    body?: unknown;
  },
): Promise<T> {
  const method = options?.method ?? 'GET';
  const body = options?.body === undefined ? undefined : JSON.stringify(options.body);

  const response = await page.evaluate(async ({ requestPath, requestMethod, requestBody }) => {
    return await window.electron.ipcRenderer.invoke('hostapi:fetch', {
      path: requestPath,
      method: requestMethod,
      headers: requestBody ? { 'Content-Type': 'application/json' } : undefined,
      body: requestBody,
    });
  }, {
    requestPath: path,
    requestMethod: method,
    requestBody: body,
  }) as unknown;

  if (response && typeof response === 'object' && 'data' in response) {
    const payload = response as {
      data?: {
        json?: unknown;
      };
    };
    if (payload.data && 'json' in payload.data) {
      return payload.data.json as T;
    }
  }

  return response as T;
}

async function allocateGatewayPort(): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const server = createTcpServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to allocate an isolated gateway port')));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolvePort(port);
      });
    });
  });
}

async function configureIsolatedGatewayPort(page: Page): Promise<number> {
  const port = await allocateGatewayPort();
  await hostApiJson(page, '/api/settings/gatewayPort', {
    method: 'PUT',
    body: { value: port },
  });
  return port;
}

async function readGatewayStatus(page: Page): Promise<GatewayStatus> {
  return await page.evaluate(async () => (
    await window.electron.ipcRenderer.invoke('gateway:status')
  ) as GatewayStatus);
}

async function waitForGatewayStatus(
  page: Page,
  predicate: (status: GatewayStatus) => boolean,
  timeoutMs = GATEWAY_START_TIMEOUT_MS,
): Promise<GatewayStatus> {
  const deadline = Date.now() + timeoutMs;
  let lastStatus: GatewayStatus | null = null;

  while (Date.now() < deadline) {
    lastStatus = await readGatewayStatus(page);
    if (predicate(lastStatus)) {
      return lastStatus;
    }
    await page.waitForTimeout(500);
  }

  throw new Error(`Gateway status did not reach the expected state in time: ${JSON.stringify(lastStatus)}`);
}

async function startGateway(page: Page): Promise<GatewayStatus> {
  const result = await page.evaluate(async () => (
    await window.electron.ipcRenderer.invoke('gateway:start')
  ) as { success?: boolean; error?: string });
  expect(result?.success, result?.error || 'gateway:start failed during E2E setup').toBe(true);
  return await waitForGatewayStatus(page, (status) => status.state === 'running' && Boolean(status.pid));
}

async function waitForGatewayStable(page: Page, minConnectedAgeMs = GATEWAY_STABLE_MS): Promise<GatewayStatus> {
  return await waitForGatewayStatus(
    page,
    (status) => Boolean(status.pid)
      && typeof status.connectedAt === 'number'
      && Date.now() - status.connectedAt >= minConnectedAgeMs,
    minConnectedAgeMs + GATEWAY_START_TIMEOUT_MS,
  );
}

async function waitForGatewayPidChange(
  page: Page,
  previousPid: number,
  timeoutMs = 60_000,
): Promise<GatewayStatus> {
  return await waitForGatewayStatus(
    page,
    (status) => Boolean(status.pid) && status.pid !== previousPid,
    timeoutMs,
  );
}

async function seedDefaultProvider(page: Page, baseUrl: string): Promise<void> {
  const now = new Date().toISOString();
  await hostApiJson(page, '/api/provider-accounts', {
    method: 'POST',
    body: {
      account: {
        id: DEFAULT_ACCOUNT_ID,
        vendorId: 'custom',
        label: DEFAULT_PROVIDER_LABEL,
        authMode: 'api_key',
        baseUrl,
        apiProtocol: 'openai-completions',
        model: 'model-alpha',
        metadata: {
          customModels: ['model-beta', 'model-gamma'],
          modelProtocols: {
            'model-alpha': 'openai-completions',
            'model-beta': 'openai-completions',
            'model-gamma': 'openai-completions',
          },
        },
        enabled: true,
        isDefault: false,
        createdAt: now,
        updatedAt: now,
      },
      apiKey: DEFAULT_API_KEY,
    },
  });

  await hostApiJson(page, '/api/provider-accounts/default', {
    method: 'PUT',
    body: { accountId: DEFAULT_ACCOUNT_ID },
  });
}

async function startMockOpenAiServer(): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const server = createHttpServer((req, res) => {
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
      const model = body.model || 'unknown-model';

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: `chatcmpl-${model}`,
        object: 'chat.completion',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: `reply:${model}`,
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

async function applyModelDraft(page: Page): Promise<void> {
  const sheet = page.getByTestId('models-config-sheet');
  await expect(sheet).toBeVisible();
  await sheet.getByTestId('models-config-sheet-test-button').click();
  await expect(page.getByTestId('models-config-apply-button')).toBeEnabled({ timeout: 20_000 });
  await page.getByTestId('models-config-apply-button').click();
  await expect(sheet).toHaveCount(0);
}

async function sendMessageAndExpectReply(
  page: Page,
  messageInput: ReturnType<Page['getByRole']>,
  sendButton: ReturnType<Page['getByTestId']>,
  modelId: string,
  prompt: string,
): Promise<void> {
  await messageInput.fill(prompt);
  await sendButton.click();

  const assistantMessage = page.getByTestId('chat-message-content-assistant').last();
  const errorMessage = page.getByTestId('chat-assistant-error-message').last();
  const deadline = Date.now() + 90_000;

  while (Date.now() < deadline) {
    if (await assistantMessage.count()) {
      const text = (await assistantMessage.textContent()) || '';
      if (text.includes(`reply:${modelId}`)) {
        return;
      }
    }

    if (await errorMessage.count()) {
      const text = ((await errorMessage.textContent()) || '').trim();
      throw new Error(`Chat returned an error after switching to ${modelId}: ${text}`);
    }

    await page.waitForTimeout(1_000);
  }

  throw new Error(`No assistant reply arrived for model ${modelId} within 90s`);
}

test.describe('Gateway runtime behavior', () => {
  test('keeps the gateway pid stable after adding and editing model configs', async ({ page }) => {
    test.setTimeout(420_000);
    const mockServer = await startMockOpenAiServer();

    try {
      await completeSetup(page);
      await seedDefaultProvider(page, mockServer.baseUrl);
      await page.reload();
      await expect(page.getByTestId('main-layout')).toBeVisible();
      await configureIsolatedGatewayPort(page);
      await startGateway(page);
      await waitForGatewayStable(page);

      await openModelsFromSettings(page);
      await expect(page.getByTestId('models-config-panel')).toBeVisible();

      const stablePid = (await waitForGatewayStable(page)).pid;

      await page.getByTestId('models-config-add-button').click();
      const createSheet = page.getByTestId('models-config-sheet');
      await createSheet.getByTestId('models-config-sheet-vendor-select').selectOption('custom');
      await createSheet.getByTestId('models-config-sheet-label-input').fill('Created Config E2E');
      await createSheet.getByTestId('models-config-sheet-model-input').fill('model-delta');
      await createSheet.getByTestId('models-config-sheet-base-url-input').fill(mockServer.baseUrl);
      await createSheet.locator('#draft-api-key').fill(DEFAULT_API_KEY);
      await applyModelDraft(page);
      await expect(page.locator('tbody tr', { hasText: 'model-delta' }).first()).toBeVisible();
      await expect(page.getByText(/刷新 OpenClaw Gateway 配置|Gateway configuration/i)).toHaveCount(0);
      expect((await readGatewayStatus(page)).pid).toBe(stablePid);

      await waitForGatewayStable(page);
      const deltaRow = page.locator('tbody tr', { hasText: 'model-delta' }).first();
      await deltaRow.locator('[data-testid^="models-config-edit-"]').click();
      const editSheet = page.getByTestId('models-config-sheet');
      await editSheet.getByTestId('models-config-sheet-model-input').fill('model-epsilon');
      await applyModelDraft(page);
      await expect(page.locator('tbody tr', { hasText: 'model-epsilon' }).first()).toBeVisible();
      expect((await readGatewayStatus(page)).pid).toBe(stablePid);

      await waitForGatewayStable(page);
      const epsilonRow = page.locator('tbody tr', { hasText: 'model-epsilon' }).first();
      await epsilonRow.locator('[data-testid^="models-config-edit-"]').click();
      const secondEditSheet = page.getByTestId('models-config-sheet');
      await secondEditSheet.getByTestId('models-config-sheet-model-input').fill('model-zeta');
      await applyModelDraft(page);
      await expect(page.locator('tbody tr', { hasText: 'model-zeta' }).first()).toBeVisible();
      expect((await readGatewayStatus(page)).pid).toBe(stablePid);
    } finally {
      await mockServer.close();
    }
  });

  test('keeps the gateway pid stable while switching chat models and still returns replies', async ({ page }) => {
    test.setTimeout(420_000);
    const mockServer = await startMockOpenAiServer();

    try {
      await completeSetup(page);
      await seedDefaultProvider(page, mockServer.baseUrl);
      await page.reload();
      await expect(page.getByTestId('main-layout')).toBeVisible();
      await configureIsolatedGatewayPort(page);
      await startGateway(page);
      await waitForGatewayStable(page);

      await openModelsFromSettings(page);
      await expect(page.getByTestId('models-config-panel')).toBeVisible();
      const stablePid = (await waitForGatewayStable(page)).pid;

      await page.getByTestId('sidebar-new-chat').click();

      const composer = page.getByTestId('chat-composer');
      const modelSwitch = composer.getByTestId('chat-model-switch');
      const messageInput = composer.getByRole('textbox');
      const sendButton = composer.getByTestId('chat-send-button');

      await expect(modelSwitch).toContainText(`${DEFAULT_PROVIDER_LABEL} / model-alpha`, { timeout: 20_000 });
      await expect(modelSwitch).toBeEnabled();

      await sendMessageAndExpectReply(page, messageInput, sendButton, 'model-alpha', 'baseline alpha');
      expect((await readGatewayStatus(page)).pid).toBe(stablePid);

      const rounds = [
        { modelId: 'model-beta', prompt: 'switch beta' },
        { modelId: 'model-gamma', prompt: 'switch gamma' },
      ];

      for (const [index, round] of rounds.entries()) {
        await modelSwitch.click();
        await page.getByRole('button', { name: `${DEFAULT_PROVIDER_LABEL} / ${round.modelId}` }).click();
        await expect(modelSwitch).toContainText(`${DEFAULT_PROVIDER_LABEL} / ${round.modelId}`);
        expect((await readGatewayStatus(page)).pid).toBe(stablePid);

        await sendMessageAndExpectReply(page, messageInput, sendButton, round.modelId, `round ${index + 1}: ${round.prompt}`);
        await expect(page.getByTestId('chat-message-model-label').last()).toContainText(
          `${DEFAULT_PROVIDER_LABEL} / ${round.modelId}`,
        );
        expect((await readGatewayStatus(page)).pid).toBe(stablePid);
      }
    } finally {
      await mockServer.close();
    }
  });
});
