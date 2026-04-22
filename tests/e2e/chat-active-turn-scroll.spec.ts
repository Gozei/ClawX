import { mkdir, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createTcpServer, type AddressInfo } from 'node:net';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:active-turn-scroll-test';
const SESSION_FILE = 'active-turn-scroll-test.jsonl';
const SESSION_LABEL = 'Active turn scroll session';
const DEFAULT_ACCOUNT_ID = 'active-turn-scroll-e2e';
const DEFAULT_PROVIDER_LABEL = 'Active Turn Scroll E2E';
const DEFAULT_API_KEY = 'sk-test';
const GATEWAY_START_TIMEOUT_MS = 180_000;
const GATEWAY_STABLE_MS = 9_000;

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
      }, 4_000);
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

async function waitForGatewayStable(page: Page, minConnectedAgeMs = GATEWAY_STABLE_MS): Promise<void> {
  const deadline = Date.now() + minConnectedAgeMs + GATEWAY_START_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const status = await page.evaluate(async () => (
      await window.electron.ipcRenderer.invoke('gateway:status')
    ) as { state?: string; pid?: number; connectedAt?: number | null });

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

async function seedSession(homeDir: string): Promise<void> {
  const baseTimestamp = Math.floor(Date.now() / 1000) - 120;
  const sessionsDir = join(homeDir, '.openclaw', 'agents', 'main', 'sessions');
  const seededMessages: Array<Record<string, unknown>> = [];

  for (let index = 0; index < 18; index += 1) {
    seededMessages.push({
      id: `history-user-${index + 1}`,
      role: 'user',
      content: `History question ${index + 1}`,
      timestamp: baseTimestamp + (index * 2),
    });
    seededMessages.push({
      id: `history-assistant-${index + 1}`,
      role: 'assistant',
      content: `History answer ${index + 1}`,
      timestamp: baseTimestamp + (index * 2) + 1,
    });
  }

  await mkdir(sessionsDir, { recursive: true });
  await writeFile(
    join(sessionsDir, 'sessions.json'),
    JSON.stringify({
      sessions: [
        {
          key: SESSION_KEY,
          id: 'active-turn-scroll-test',
          file: SESSION_FILE,
          label: SESSION_LABEL,
          updatedAt: Date.now(),
        },
      ],
    }, null, 2),
    'utf8',
  );
  await writeFile(
    join(sessionsDir, SESSION_FILE),
    `${seededMessages.map((message) => JSON.stringify(message)).join('\n')}\n`,
    'utf8',
  );
}

async function openSeededSession(page: Page): Promise<void> {
  const sessionRow = page.getByTestId(`sidebar-session-${SESSION_KEY}`);
  await expect(sessionRow).toBeVisible({ timeout: 60_000 });
  await sessionRow.click();
}

async function measureScrollTop(page: Page): Promise<number> {
  return await page.evaluate(() => {
    const scrollContainer = document.querySelector('[data-testid="chat-scroll-container"]') as HTMLElement | null;
    return scrollContainer?.scrollTop ?? 0;
  });
}

async function measureDistanceFromBottom(page: Page): Promise<number | null> {
  return await page.evaluate(() => {
    const scrollContainer = document.querySelector('[data-testid="chat-scroll-container"]') as HTMLElement | null;
    if (!scrollContainer) {
      return null;
    }

    return scrollContainer.scrollHeight - scrollContainer.clientHeight - scrollContainer.scrollTop;
  });
}

test.describe('Chat active turn scroll', () => {
  test('keeps a newly sent turn pinned near the bottom of the chat viewport', async ({ homeDir, launchElectronApp }) => {
    test.setTimeout(240_000);

    await seedSession(homeDir);
    const mockServer = await startDelayedMockOpenAiServer();
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
      await openSeededSession(page);

      const scrollContainer = page.getByTestId('chat-scroll-container');
      const composer = page.getByTestId('chat-composer');
      const messageInput = composer.getByRole('textbox');
      const sendButton = composer.getByTestId('chat-send-button');
      const modelSwitch = composer.getByTestId('chat-model-switch');

      await expect(scrollContainer).toBeVisible();
      await expect(modelSwitch).toContainText(`${DEFAULT_PROVIDER_LABEL} / model-scroll`, { timeout: 20_000 });
      await expect.poll(async () => (
        await sendButton.evaluate((node) => (
          !!node.querySelector('svg.lucide-send-horizontal')
        ))
      ), { timeout: 20_000 }).toBe(true);
      await expect.poll(async () => (
        await scrollContainer.evaluate((node) => (node as HTMLElement).scrollTop)
      ), { timeout: 20_000 }).toBeGreaterThan(0);

      await messageInput.fill('Please keep this active turn aligned to the top.');
      await expect(sendButton).toBeEnabled({ timeout: 10_000 });
      await sendButton.click();

      await expect(page.getByTestId('chat-active-turn-anchor')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText('Please keep this active turn aligned to the top.', { exact: true })).toHaveCount(1);

      await expect.poll(async () => {
        const distanceFromBottom = await measureDistanceFromBottom(page);
        return distanceFromBottom != null ? Math.abs(distanceFromBottom) <= 2 : false;
      }, { timeout: 10_000 }).toBe(true);

      await expect.poll(async () => (
        await page.evaluate(() => document.body.innerText.includes('reply:model-scroll'))
      ), { timeout: 20_000 }).toBe(true);

      await expect.poll(async () => {
        const distanceFromBottom = await measureDistanceFromBottom(page);
        return distanceFromBottom != null ? Math.abs(distanceFromBottom) <= 18 : false;
      }, { timeout: 10_000 }).toBe(true);

      const beforeManualScrollTop = await measureScrollTop(page);
      await scrollContainer.hover();
      await page.mouse.wheel(0, -160);

      await expect.poll(async () => (
        await measureScrollTop(page)
      ), { timeout: 5_000 }).toBeLessThan(beforeManualScrollTop);
      const afterManualScrollTop = await measureScrollTop(page);

      await page.waitForTimeout(750);
      await expect.poll(async () => (
        await measureScrollTop(page)
      ), { timeout: 5_000 }).toBeLessThanOrEqual(afterManualScrollTop + 2);

      await page.getByTestId('sidebar-new-chat').click();
      await expect(page.getByTestId('chat-composer')).toBeVisible({ timeout: 10_000 });

      await openSeededSession(page);
      await expect.poll(async () => {
        const distanceFromBottom = await measureDistanceFromBottom(page);
        return distanceFromBottom != null ? Math.abs(distanceFromBottom) <= 2 : false;
      }, { timeout: 10_000 }).toBe(true);
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
