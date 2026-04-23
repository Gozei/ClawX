import {
  closeElectronApp,
  expect,
  getStableWindow,
  installIpcMocks,
  test,
} from './fixtures/electron';

const SESSION_KEY = 'agent:main:main';
const SESSION_ID = 'process-step-complete-without-refresh';
const RUN_ID = 'run-process-step-complete-without-refresh';
const PROMPT = 'Update the draft script and keep working without stopping.';
const TOOL_PATH = 'D:/AI/Deep AI Worker/ClawX/tmp-process-step.py';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

test.describe('Chat process step completion', () => {
  test('updates a streamed process card to completed without a manual refresh', async ({ launchElectronApp }) => {
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
                chatProcessDisplayMode: 'all',
                assistantMessageStyle: 'bubble',
                hideInternalRoutineProcesses: true,
                setupComplete: true,
              },
            },
          },
        },
      });

      await app.evaluate(({ ipcMain, BrowserWindow }, { prompt, runId, sessionId, sessionKey, toolPath }) => {
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
              id: 'user-process-step-1',
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
                  state: 'delta',
                  message: {
                    role: 'assistant',
                    content: [
                      {
                        type: 'tool_use',
                        id: 'write-process-1',
                        name: 'write',
                        input: {
                          path: toolPath,
                          content: 'print(\"draft\")',
                        },
                      },
                    ],
                    timestamp: Math.floor(Date.now() / 1000),
                  },
                },
              });
            }, 600);

            setTimeout(() => {
              emitNotification({
                method: 'agent',
                params: {
                  runId,
                  sessionKey: activeSessionKey,
                  state: 'delta',
                  message: {
                    role: 'assistant',
                    content: [
                      {
                        type: 'tool_use',
                        id: 'write-process-1',
                        name: 'write',
                        input: {
                          path: toolPath,
                          content: 'print(\"draft\")',
                        },
                      },
                      {
                        type: 'tool_result',
                        id: 'write-process-1',
                        name: 'write',
                        content: `Successfully wrote 149 bytes to ${toolPath}`,
                      },
                    ],
                    timestamp: Math.floor(Date.now() / 1000),
                  },
                },
              });
            }, 1_800);

            return {
              success: true,
              result: { runId },
            };
          }

          return {};
        });
      }, {
        prompt: PROMPT,
        runId: RUN_ID,
        sessionId: SESSION_ID,
        sessionKey: SESSION_KEY,
        toolPath: TOOL_PATH,
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

      const processSummaries = page.getByTestId('chat-process-event-summary');
      await expect(processSummaries.first()).toHaveText('Editing code', { timeout: 30_000 });
      await expect.poll(async () => await processSummaries.allTextContents(), { timeout: 30_000 }).toEqual([
        'Code edit completed',
        'Code edit completed',
      ]);

      await expect.poll(async () => {
        return await sendButton.evaluate((node) => !!node.querySelector('svg.lucide-square'));
      }, { timeout: 5_000 }).toBe(true);
    } finally {
      await closeElectronApp(app);
    }
  });
});
