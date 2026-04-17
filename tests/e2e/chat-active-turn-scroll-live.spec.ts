import { createServer as createHttpServer } from 'node:http';
import { createServer as createTcpServer, type AddressInfo } from 'node:net';
import type { Page } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

const DEFAULT_ACCOUNT_ID = 'active-turn-scroll-live-e2e';
const DEFAULT_PROVIDER_LABEL = 'Active Turn Scroll Live E2E';
const DEFAULT_API_KEY = 'sk-test';
const GATEWAY_START_TIMEOUT_MS = 180_000;
const GATEWAY_STABLE_MS = 9_000;
const HISTORY_TURNS = 6;
const FINAL_REQUEST_INDEX = HISTORY_TURNS + 1;

type GatewayStatus = {
  state: string;
  pid?: number;
  connectedAt?: number;
  port?: number;
};

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
        model: 'model-scroll',
        metadata: {
          customModels: ['model-scroll'],
          modelProtocols: {
            'model-scroll': 'openai-completions',
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
  let requestCount = 0;

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

      requestCount += 1;
      const currentRequest = requestCount;
      const delayMs = currentRequest === FINAL_REQUEST_INDEX ? 4_000 : 150;
      const reply = [
        `reply:${model}:${currentRequest}`,
        '',
        `Response block ${currentRequest}.`,
        'This assistant reply is intentionally verbose to build a tall chat history.',
        '- detail one stays visible long enough to exercise scrolling',
        '- detail two adds extra height',
        '- detail three helps force the viewport to the bottom before the final send',
      ].join('\n');

      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          id: `chatcmpl-${model}-${currentRequest}`,
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: reply,
              },
              finish_reason: 'stop',
            },
          ],
        }));
      }, delayMs);
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
    ) as GatewayStatus);

    if (status?.state === 'running' && status?.pid) {
      return;
    }

    await page.waitForTimeout(500);
  }

  throw new Error('Gateway did not become ready in time');
}

async function waitForGatewayStable(page: Page, minConnectedAgeMs = GATEWAY_STABLE_MS): Promise<void> {
  const deadline = Date.now() + minConnectedAgeMs + GATEWAY_START_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const status = await page.evaluate(async () => (
      await window.electron.ipcRenderer.invoke('gateway:status')
    ) as GatewayStatus);

    if (
      status?.state === 'running'
      && Boolean(status.pid)
      && typeof status.connectedAt === 'number'
      && Date.now() - status.connectedAt >= minConnectedAgeMs
    ) {
      return;
    }

    await page.waitForTimeout(500);
  }

  throw new Error('Gateway did not become stable in time');
}

async function startGateway(page: Page): Promise<void> {
  const result = await page.evaluate(async () => (
    await window.electron.ipcRenderer.invoke('gateway:start')
  ) as { success?: boolean; error?: string });
  expect(result?.success, result?.error || 'gateway:start failed during E2E setup').toBe(true);
  await waitForGatewayRunning(page);
}

async function sendMessageAndExpectReply(page: Page, prompt: string, replyIndex: number): Promise<void> {
  const composer = page.getByTestId('chat-composer');
  const messageInput = composer.getByRole('textbox');
  const sendButton = composer.getByTestId('chat-send-button');

  await messageInput.fill(prompt);
  await sendButton.click();

  await expect.poll(async () => {
    return await page.evaluate((expectedReply) => (
      document.body.innerText.includes(expectedReply)
    ), `reply:model-scroll:${replyIndex}`);
  }, { timeout: 60_000 }).toBe(true);

  await expect.poll(async () => {
    return await sendButton.evaluate((node) => (
      !!node.querySelector('svg.lucide-send-horizontal')
    ));
  }, { timeout: 20_000 }).toBe(true);
}

async function measureActiveTurnAlignment(page: Page): Promise<{ delta: number; scrollTop: number } | null> {
  return await page.evaluate(() => {
    const scrollContainer = document.querySelector('[data-testid="chat-scroll-container"]') as HTMLElement | null;
    const anchor = document.querySelector('[data-testid="chat-active-turn-anchor"]') as HTMLElement | null;

    if (!scrollContainer || !anchor) {
      return null;
    }

    const scrollRect = scrollContainer.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();

    return {
      delta: Number((anchorRect.top - scrollRect.top).toFixed(2)),
      scrollTop: scrollContainer.scrollTop,
    };
  });
}

test.describe('Chat active turn scroll live', () => {
  test('pins the newly sent active turn to the top during a real delayed reply', async ({ launchElectronApp }) => {
    test.setTimeout(300_000);

    const mockServer = await startMockOpenAiServer();
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });

      await seedDefaultProvider(page, mockServer.baseUrl);
      await page.reload();
      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });

      await configureIsolatedGatewayPort(page);
      await startGateway(page);
      await waitForGatewayStable(page);

      const composer = page.getByTestId('chat-composer');
      await expect(composer).toBeVisible({ timeout: 20_000 });
      await expect(composer.getByTestId('chat-model-switch')).toContainText(`${DEFAULT_PROVIDER_LABEL} / model-scroll`, { timeout: 20_000 });

      for (let index = 0; index < HISTORY_TURNS; index += 1) {
        await sendMessageAndExpectReply(
          page,
          [
            `History prompt ${index + 1}.`,
            'Make this message tall enough to build a scrollable chat log.',
            'Include enough content so the next send starts from the bottom of the viewport.',
          ].join(' '),
          index + 1,
        );
      }

      const scrollContainer = page.getByTestId('chat-scroll-container');
      await expect.poll(async () => (
        await scrollContainer.evaluate((node) => (node as HTMLElement).scrollTop)
      ), { timeout: 20_000 }).toBeGreaterThan(0);

      const messageInput = composer.getByRole('textbox');
      const sendButton = composer.getByTestId('chat-send-button');
      await messageInput.fill('Final prompt: this active turn should jump to the top while the reply is still streaming.');
      await sendButton.click();

      await expect(page.getByTestId('chat-active-turn-anchor')).toBeVisible({ timeout: 10_000 });

      let alignment: { delta: number; scrollTop: number } | null = null;
      await expect.poll(async () => {
        alignment = await measureActiveTurnAlignment(page);
        return alignment ? Math.abs(alignment.delta) <= 2 : false;
      }, { timeout: 15_000 }).toBe(true);

      expect(alignment?.scrollTop ?? 0).toBeGreaterThan(0);
    } finally {
      try {
        const page = await getStableWindow(app);
        await page.evaluate(async () => {
          try {
            await window.electron.ipcRenderer.invoke('gateway:stop');
          } catch {
            // ignore gateway shutdown failures during cleanup
          }
        });
      } catch {
        // ignore cleanup failures before closing Electron
      }
      await closeElectronApp(app);
      await mockServer.close();
    }
  });
});
