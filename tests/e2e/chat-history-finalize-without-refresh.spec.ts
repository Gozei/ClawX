import {
  closeElectronApp,
  expect,
  getStableWindow,
  installIpcMocks,
  test,
} from './fixtures/electron';

const SESSION_KEY = 'agent:main:main';
const SESSION_ID = 'history-finalize-without-refresh';
const RUN_ID = 'run-history-finalize-without-refresh';
const PROMPT = 'Check tomorrow Shenzhen to Nanjing flights and summarize the best options.';
const STREAMING_TEXT = 'Opening the travel site and checking tomorrow flights now.';
const FINAL_TEXT = 'The best option tomorrow is MU2878 departing at 23:25 for CNY 420.';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

test.describe('Chat history finalization', () => {
  test('auto-finalizes the running UI after history settles even without a manual refresh', async ({ launchElectronApp }) => {
    test.setTimeout(180_000);

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

      await app.evaluate(({ ipcMain, BrowserWindow }, { prompt, sessionKey, sessionId, runId, streamingText, finalText }) => {
        let sessions: Array<{ key: string; id: string; label: string; updatedAt: number }> = [];
        let historyMessages: Array<Record<string, unknown>> = [];

        function emitNotification(payload: unknown): void {
          const window = BrowserWindow.getAllWindows().at(-1);
          if (!window) throw new Error('No BrowserWindow available');
          window.webContents.send('gateway:notification', payload);
        }

        ipcMain.removeHandler('gateway:rpc');
        ipcMain.handle('gateway:rpc', async (_event, method: string, params?: { sessionKey?: string }) => {
          if (method === 'sessions.list') {
            return {
              success: true,
              result: { sessions },
            };
          }

          if (method === 'chat.history') {
            return {
              success: true,
              result: { messages: historyMessages },
            };
          }

          if (method === 'chat.abort') {
            return {
              success: true,
              result: { ok: true },
            };
          }

          if (method === 'chat.send') {
            const now = Date.now();
            const activeSessionKey = params?.sessionKey || sessionKey;

            sessions = [{
              key: activeSessionKey,
              id: sessionId,
              label: prompt,
              updatedAt: now,
            }];

            historyMessages = [{
              id: 'user-history-finalize-1',
              role: 'user',
              content: prompt,
              timestamp: Math.floor(now / 1000),
            }];

            setTimeout(() => {
              emitNotification({
                method: 'agent',
                params: {
                  phase: 'started',
                  runId,
                  sessionKey: activeSessionKey,
                },
              });
            }, 0);

            setTimeout(() => {
              emitNotification({
                method: 'agent',
                params: {
                  runId,
                  sessionKey: activeSessionKey,
                  stream: 'assistant',
                  data: {
                    text: streamingText,
                    delta: streamingText,
                  },
                },
              });
            }, 700);

            setTimeout(() => {
              emitNotification({
                method: 'agent',
                params: {
                  runId,
                  sessionKey: activeSessionKey,
                  stream: 'assistant',
                  data: {
                    text: streamingText,
                    delta: streamingText,
                  },
                },
              });
            }, 2_600);

            setTimeout(() => {
              const completedAt = Date.now();
              historyMessages = [
                {
                  id: 'user-history-finalize-1',
                  role: 'user',
                  content: prompt,
                  timestamp: Math.floor(now / 1000),
                },
                {
                  id: 'assistant-history-finalize-1',
                  role: 'assistant',
                  content: finalText,
                  timestamp: Math.floor(completedAt / 1000),
                },
              ];
              sessions = [{
                key: activeSessionKey,
                id: sessionId,
                label: prompt,
                updatedAt: completedAt,
              }];
            }, 4_200);

            return {
              success: true,
              result: { runId },
            };
          }

          return {};
        });
      }, {
        prompt: PROMPT,
        sessionKey: SESSION_KEY,
        sessionId: SESSION_ID,
        runId: RUN_ID,
        streamingText: STREAMING_TEXT,
        finalText: FINAL_TEXT,
      });

      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });

      const composer = page.getByTestId('chat-composer');
      const messageInput = composer.getByRole('textbox');
      const sendButton = composer.getByTestId('chat-send-button');

      await messageInput.fill(PROMPT);
      await sendButton.click();

      await expect.poll(async () => {
        return await sendButton.evaluate((node) => !!node.querySelector('svg.lucide-square'));
      }, { timeout: 30_000 }).toBe(true);

      await expect(page.getByText(FINAL_TEXT, { exact: true })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('chat-session-notice')).toHaveCount(0);

      await expect.poll(async () => {
        return await sendButton.evaluate((node) => !!node.querySelector('svg.lucide-send-horizontal'));
      }, { timeout: 5_000 }).toBe(true);
      await expect(page.getByTestId('chat-streaming-cursor')).toHaveCount(0, { timeout: 5_000 });
    } finally {
      await closeElectronApp(app);
    }
  });

  test('shows a generic warning notice when the final reply never arrives after finalization', async ({ launchElectronApp }) => {
    test.setTimeout(90_000);

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

      await app.evaluate(({ ipcMain, BrowserWindow }, { prompt, sessionKey, sessionId, runId }) => {
        let sessions: Array<{ key: string; id: string; label: string; updatedAt: number }> = [];
        let historyMessages: Array<Record<string, unknown>> = [];

        function emitNotification(payload: unknown): void {
          const window = BrowserWindow.getAllWindows().at(-1);
          if (!window) throw new Error('No BrowserWindow available');
          window.webContents.send('gateway:notification', payload);
        }

        ipcMain.removeHandler('gateway:rpc');
        ipcMain.handle('gateway:rpc', async (_event, method: string, params?: { sessionKey?: string }) => {
          if (method === 'sessions.list') {
            return {
              success: true,
              result: { sessions },
            };
          }

          if (method === 'chat.history') {
            return {
              success: true,
              result: { messages: historyMessages },
            };
          }

          if (method === 'chat.abort') {
            return {
              success: true,
              result: { ok: true },
            };
          }

          if (method === 'chat.send') {
            const now = Date.now();
            const activeSessionKey = params?.sessionKey || sessionKey;

            sessions = [{
              key: activeSessionKey,
              id: sessionId,
              label: prompt,
              updatedAt: now,
            }];

            historyMessages = [{
              id: 'user-history-missing-final-1',
              role: 'user',
              content: prompt,
              timestamp: Math.floor(now / 1000),
            }];

            setTimeout(() => {
              emitNotification({
                method: 'agent',
                params: {
                  phase: 'started',
                  runId,
                  sessionKey: activeSessionKey,
                },
              });
            }, 0);

            setTimeout(() => {
              emitNotification({
                method: 'agent',
                params: {
                  state: 'final',
                  runId,
                  sessionKey: activeSessionKey,
                },
              });
            }, 800);

            return {
              success: true,
              result: { runId },
            };
          }

          return {};
        });
      }, {
        prompt: 'Summarize tomorrow flights from Shenzhen to Beijing.',
        sessionKey: SESSION_KEY,
        sessionId: 'history-finalize-warning',
        runId: 'run-history-finalize-warning',
      });

      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });

      const composer = page.getByTestId('chat-composer');
      const messageInput = composer.getByRole('textbox');
      const sendButton = composer.getByTestId('chat-send-button');

      await messageInput.fill('Summarize tomorrow flights from Shenzhen to Beijing.');
      await sendButton.click();

      const notice = page.getByTestId('chat-session-notice');
      await expect(notice).toBeVisible({ timeout: 20_000 });
      await expect(notice).toHaveAttribute('data-notice-tone', 'warning');
      await expect(notice).toContainText(/final reply|最终回复/i);
      await expect(notice).not.toContainText(/API Key|provider may be unavailable/i);
    } finally {
      await closeElectronApp(app);
    }
  });
});
