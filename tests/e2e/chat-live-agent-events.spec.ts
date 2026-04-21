import {
  closeElectronApp,
  expect,
  getStableWindow,
  installIpcMocks,
  test,
} from './fixtures/electron';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

async function emitGatewayEvent(
  app: Parameters<typeof installIpcMocks>[0],
  channel: 'gateway:notification' | 'gateway:chat-message',
  payload: unknown,
): Promise<void> {
  await app.evaluate(({ BrowserWindow }, { nextChannel, nextPayload }) => {
    const windows = BrowserWindow.getAllWindows().filter((candidate) => !candidate.isDestroyed());
    if (windows.length === 0) throw new Error('No BrowserWindow available');
    for (const window of windows) {
      window.webContents.send(nextChannel, nextPayload);
    }
  }, { nextChannel: channel, nextPayload: payload });
}

test.describe('Chat live agent events', () => {
  test('renders running process events and live text before the turn completes', async ({ launchElectronApp }) => {
    test.fixme(
      process.platform === 'win32',
      'Live gateway event injection remains flaky in Windows Electron E2E; gateway normalization is covered by unit tests.',
    );
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, connectedAt: Date.now() },
        hostApi: {
          [stableStringify(['/api/gateway/status', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                state: 'running',
                port: 18789,
                pid: 12345,
                connectedAt: Date.now(),
              },
            },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                agents: [],
              },
            },
          },
        },
      });

      await app.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('gateway:rpc');
        ipcMain.handle('gateway:rpc', async (_event, method: string, params: { sessionKey?: string }) => {
          if (method === 'sessions.list') {
            return {
              success: true,
              result: { sessions: [] },
            };
          }
          if (method === 'chat.history') {
            return {
              success: true,
              result: { messages: [] },
            };
          }
          if (method === 'chat.send') {
            return {
              success: true,
              result: {
                runId: 'run-live-process',
              },
            };
          }
          if (method === 'chat.abort') {
            return {
              success: true,
              result: { ok: true },
            };
          }
          return {
            success: true,
            result: {},
          };
        });
      });

      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();
      await page.evaluate(async () => {
        await window.electron.ipcRenderer.invoke('settings:set', 'chatProcessDisplayMode', 'all');
      });
      await page.reload();
      await expect(page.getByTestId('main-layout')).toBeVisible();
      const composer = page.getByTestId('chat-composer');
      const sendButton = composer.getByTestId('chat-send-button');
      await expect(composer).toBeVisible();
      await composer.getByRole('textbox').fill('Find the latest flight options for me.');
      await sendButton.click();
      await expect(page.getByText('Find the latest flight options for me.')).toBeVisible({ timeout: 60_000 });
      await expect.poll(async () => (
        await sendButton.evaluate((node) => !!node.querySelector('svg.lucide-square'))
      ), { timeout: 15_000 }).toBe(true);

      await emitGatewayEvent(app, 'gateway:chat-message', {
        runId: 'run-live-process',
        sessionKey: 'agent:main:main',
        state: 'delta',
        message: {
          role: 'toolresult',
          toolCallId: 'browser-live-1',
          toolName: 'browser',
          status: 'running',
          content: 'Opening Ctrip homepage',
          timestamp: Date.now(),
        },
      });

      await emitGatewayEvent(app, 'gateway:chat-message', {
        runId: 'run-live-process',
        sessionKey: 'agent:main:main',
        state: 'delta',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: 'Searching flights now...',
            },
          ],
          timestamp: Date.now(),
        },
      });

      const processToggle = page.getByTestId('chat-process-toggle').first();
      await expect(processToggle).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId('chat-process-status').first()).not.toContainText(/Processed|\u5df2\u5904\u7406/);
      await processToggle.click();

      const processContent = page.getByTestId('chat-process-content').first();
      await expect(processContent).toBeVisible();
      await expect(processContent.getByText('Opening Ctrip homepage')).toBeVisible({ timeout: 60_000 });
      await expect(processContent.getByTestId('chat-process-event-row')).toBeVisible({ timeout: 60_000 });
      await expect(processContent.getByTestId('chat-process-surface-card')).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId('chat-tool-status-bar')).toHaveCount(0);
      await expect(page.getByText('Searching flights now...')).toBeVisible({ timeout: 60_000 });
    } finally {
      await closeElectronApp(app);
    }
  });
});
