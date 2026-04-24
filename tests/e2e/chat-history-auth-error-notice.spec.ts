import {
  closeElectronApp,
  expect,
  getStableWindow,
  installIpcMocks,
  test,
} from './fixtures/electron';

const SESSION_KEY = 'agent:main:main';
const SESSION_ID = 'history-auth-error-notice';
const RUN_ID = 'run-history-auth-error-notice';
const PROMPT = 'Summarize the latest supplier risks for this week.';
const STREAMING_TEXT = 'Checking the supplier updates now.';
const PARTIAL_TEXT = 'Current signal: one supplier has delayed shipments and another changed pricing terms.';
const AUTH_ERROR_TEXT = 'HTTP 401: Invalid Authentication';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

test.describe('Chat history auth error notice', () => {
  test('shows a visible auth/config notice when a partial reply ends with provider auth failure', async ({ launchElectronApp }) => {
    test.setTimeout(180_000);

    const app = await launchElectronApp({ skipSetup: true });

    try {
      await getStableWindow(app);

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
          [stableStringify(['/api/settings', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                language: 'en',
                assistantMessageStyle: 'bubble',
                chatProcessDisplayMode: 'all',
                hideInternalRoutineProcesses: true,
                setupComplete: true,
              },
            },
          },
        },
      });

      await app.evaluate(({ ipcMain, BrowserWindow }, {
        prompt,
        sessionKey,
        sessionId,
        runId,
        streamingText,
        partialText,
        authErrorText,
      }) => {
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
              id: 'user-auth-notice-1',
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
            }, 600);

            setTimeout(() => {
              const completedAt = Date.now();
              historyMessages = [
                {
                  id: 'user-auth-notice-1',
                  role: 'user',
                  content: prompt,
                  timestamp: Math.floor(now / 1000),
                },
                {
                  id: 'assistant-auth-notice-1',
                  role: 'assistant',
                  content: partialText,
                  timestamp: Math.floor(completedAt / 1000),
                  stopReason: 'error',
                  errorMessage: authErrorText,
                },
              ];
              sessions = [{
                key: activeSessionKey,
                id: sessionId,
                label: prompt,
                updatedAt: completedAt,
              }];
            }, 1_800);

            setTimeout(() => {
              emitNotification({
                method: 'agent',
                params: {
                  phase: 'completed',
                  runId,
                  sessionKey: activeSessionKey,
                },
              });
            }, 2_000);

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
        partialText: PARTIAL_TEXT,
        authErrorText: AUTH_ERROR_TEXT,
      });

      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });

      const composer = page.getByTestId('chat-composer');
      const messageInput = composer.getByRole('textbox');
      const sendButton = composer.getByTestId('chat-send-button');

      await messageInput.fill(PROMPT);
      await sendButton.click();

      await expect(page.getByText(PARTIAL_TEXT, { exact: true })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('chat-session-notice')).toContainText('Authentication failed', { timeout: 30_000 });

      await expect.poll(async () => {
        return await sendButton.evaluate((node) => !!node.querySelector('svg.lucide-send-horizontal'));
      }, { timeout: 10_000 }).toBe(true);
    } finally {
      await closeElectronApp(app);
    }
  });
});
