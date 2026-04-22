import { createServer as createHttpServer } from 'node:http';
import { createServer as createTcpServer, type AddressInfo } from 'node:net';
import type { Page } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

const DEFAULT_ACCOUNT_ID = 'custom-loading-indicator-e2e';
const DEFAULT_PROVIDER_LABEL = 'Loading Indicator E2E';
const DEFAULT_API_KEY = 'sk-test';
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
        model: 'model-loading',
        metadata: {
          customModels: ['model-loading'],
          modelProtocols: {
            'model-loading': 'openai-completions',
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

async function startDelayedMockOpenAiServer(): Promise<{
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

      setTimeout(() => {
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
      }, 2_500);
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

async function waitForGatewayRunning(page: Page, timeoutMs = GATEWAY_START_TIMEOUT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const status = await page.evaluate(async () => (
      await window.electron.ipcRenderer.invoke('gateway:status')
    ) as { state?: string; pid?: number });

    if (status?.state === 'running' && status?.pid) {
      return;
    }

    await page.waitForTimeout(500);
  }

  throw new Error('Gateway did not become ready in time');
}

async function startGateway(page: Page): Promise<void> {
  const result = await page.evaluate(async () => (
    await window.electron.ipcRenderer.invoke('gateway:start')
  ) as { success?: boolean; error?: string });
  expect(result?.success, result?.error || 'gateway:start failed during E2E setup').toBe(true);
  await waitForGatewayRunning(page);
}

test.describe('Chat loading indicator brand', () => {
  test.fixme('shows a chromeless product name beside the avatar before the first reply arrives', async ({ launchElectronApp }) => {
    test.setTimeout(240_000);
    const mockServer = await startDelayedMockOpenAiServer();
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      await seedDefaultProvider(page, mockServer.baseUrl);
      await page.reload();
      await expect(page.getByTestId('main-layout')).toBeVisible();

      await configureIsolatedGatewayPort(page);
      await startGateway(page);

      const composer = page.getByTestId('chat-composer');
      const modelSwitch = composer.getByTestId('chat-model-switch');
      const messageInput = composer.getByRole('textbox');
      const sendButton = composer.getByTestId('chat-send-button');

      await expect(modelSwitch).toContainText(`${DEFAULT_PROVIDER_LABEL} / model-loading`, { timeout: 20_000 });
      await messageInput.fill('Check the loading indicator.');
      await sendButton.click();

      const activeBrandName = page.locator([
        '[data-testid="chat-typing-indicator-name"]',
        '[data-testid="chat-tool-processing-indicator-name"]',
        '[data-testid="chat-process-header-brand-name"]',
      ].join(', ')).first();
      const activeBrandShell = page.locator([
        '[data-testid="chat-typing-indicator-shell"]',
        '[data-testid="chat-tool-processing-indicator-shell"]',
        '[data-testid="chat-process-header-brand-shell"]',
      ].join(', ')).first();
      const activeBrandScan = page.locator([
        '[data-testid="chat-typing-indicator-scan"]',
      ].join(', ')).first();
      const preOutputCard = page.getByTestId('chat-typing-indicator-pre-output-card');
      const preOutputTitle = page.getByTestId('chat-typing-indicator-pre-output-title');
      const preOutputDetail = page.getByTestId('chat-typing-indicator-pre-output-detail');
      const preOutputStatus = page.getByTestId('chat-typing-indicator-pre-output-status-text');
      const activeAvatar = page.locator([
        '[data-testid="chat-typing-avatar"]',
        '[data-testid="chat-tool-processing-avatar"]',
        '[data-testid="chat-process-avatar"]',
      ].join(', ')).first();

      await expect(activeBrandName).toBeVisible({ timeout: 10_000 });
      await expect(activeBrandName).toHaveText('Deep AI Worker');
      await expect(activeBrandName).toHaveCSS('font-size', '16px');
      await expect(preOutputCard).toBeVisible();
      await expect(preOutputTitle).not.toHaveText('');
      await expect(preOutputDetail).not.toHaveText('');
      await expect(preOutputStatus).not.toHaveText('');
      await expect(activeBrandShell).not.toHaveClass(/rounded-full/);
      await expect(activeBrandShell).not.toHaveClass(/border/);
      if (await activeBrandScan.count()) {
        await expect(activeBrandScan).toBeVisible();
        await expect(activeBrandScan).toHaveCSS('animation-name', 'chat-product-scan');
        await expect(activeBrandScan).toHaveCSS('animation-duration', '3.2s');
        await expect(activeBrandScan).toHaveCSS('background-image', /radial-gradient/);
      }
      if (await activeAvatar.count()) {
        const [avatarBox, brandBox] = await Promise.all([
          activeAvatar.boundingBox(),
          activeBrandName.boundingBox(),
        ]);
        expect(avatarBox).not.toBeNull();
        expect(brandBox).not.toBeNull();
        if (avatarBox && brandBox) {
          expect(brandBox.x).toBeGreaterThanOrEqual(avatarBox.x + avatarBox.width - 1);
        }
      }

      await expect(page.getByTestId('chat-message-content-assistant').last()).toContainText('reply:model-loading', {
        timeout: 90_000,
      });
      await expect(page.getByTestId('chat-typing-indicator')).toHaveCount(0);
      await expect(page.getByTestId('chat-typing-indicator-pre-output-card')).toHaveCount(0);
      await expect(page.locator('[data-testid="chat-typing-indicator-scan"]')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
      await mockServer.close();
    }
  });
});
