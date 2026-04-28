import type { Page } from '@playwright/test';
import {
  closeElectronApp,
  expect,
  getStableWindow,
  installIpcMocks,
  test,
} from './fixtures/electron';

const SESSION_KEY = 'agent:main:main';
const SESSION_ID = 'stream-stability';
const RUN_ID = 'run-stream-stability';
const PROMPT = 'Keep this short transcript stable while the answer streams.';
const CUMULATIVE_PROMPT = 'Research the chip market and keep cumulative stream text tidy.';
const CUMULATIVE_RUN_ID = 'run-stream-cumulative-dedupe';
const CUMULATIVE_SESSION_ID = 'stream-cumulative-dedupe';
const CUMULATIVE_INTRO = 'I will research the chip market now.';
const CUMULATIVE_UPDATE = 'I found the first market figures.';
const CUMULATIVE_FINALIZING = 'I am adding sources to the final answer.';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

async function measureActiveTurnTop(page: Page): Promise<number | null> {
  return await page.evaluate(() => {
    const anchor = document.querySelector('[data-testid="chat-active-turn-anchor"]') as HTMLElement | null;
    return anchor ? anchor.getBoundingClientRect().top : null;
  });
}

async function measureActiveTurnViewport(page: Page): Promise<{
  bottom: number;
  containerBottom: number;
  containerTop: number;
  top: number;
} | null> {
  return await page.evaluate(() => {
    const anchor = document.querySelector('[data-testid="chat-active-turn-anchor"]') as HTMLElement | null;
    const scrollContainer = document.querySelector('[data-testid="chat-scroll-container"]') as HTMLElement | null;
    if (!anchor || !scrollContainer) return null;

    const anchorRect = anchor.getBoundingClientRect();
    const containerRect = scrollContainer.getBoundingClientRect();
    return {
      bottom: anchorRect.bottom,
      containerBottom: containerRect.bottom,
      containerTop: containerRect.top,
      top: anchorRect.top,
    };
  });
}

test.describe('Chat stream stability', () => {
  test('keeps a short active turn anchored instead of reflowing upward while streaming', async ({ launchElectronApp }) => {
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

      await app.evaluate(({ ipcMain, BrowserWindow }, { prompt, runId, sessionId, sessionKey }) => {
        let sessions = [{
          key: sessionKey,
          id: sessionId,
          label: 'Stream stability',
          updatedAt: Date.now(),
        }];
        let historyMessages: Array<Record<string, unknown>> = [];

        const chunkOne = [
          'Streaming answer started.',
          '',
          'First visible block.',
        ].join('\n');
        const chunkTwo = [
          chunkOne,
          '',
          'Second visible block.',
          '',
          ...Array.from(
            { length: 12 },
            (_value, index) => `Extra line ${index + 1} to grow the active turn without needing a tall history backlog.`,
          ),
        ].join('\n');

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
            const now = Math.floor(Date.now() / 1000);
            const activeSessionKey = params?.sessionKey || sessionKey;

            historyMessages = [{
              id: 'user-stream-stability-1',
              role: 'user',
              content: prompt,
              timestamp: now,
            }];
            sessions = [{
              key: activeSessionKey,
              id: sessionId,
              label: prompt,
              updatedAt: Date.now(),
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
                    text: chunkOne,
                    delta: chunkOne,
                  },
                },
              });
            }, 350);

            setTimeout(() => {
              emitNotification({
                method: 'agent',
                params: {
                  runId,
                  sessionKey: activeSessionKey,
                  stream: 'assistant',
                  data: {
                    text: chunkTwo,
                    delta: chunkTwo.slice(chunkOne.length),
                  },
                },
              });
            }, 2_200);

            return {
              success: true,
              result: { runId },
            };
          }

          return {
            success: true,
            result: {},
          };
        });
      }, {
        prompt: PROMPT,
        runId: RUN_ID,
        sessionId: SESSION_ID,
        sessionKey: SESSION_KEY,
      });

      const page = await getStableWindow(app);
      await page.setViewportSize({ width: 1440, height: 1200 });
      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });

      const composer = page.getByTestId('chat-composer');
      const messageInput = composer.getByRole('textbox');
      const sendButton = composer.getByTestId('chat-send-button');

      await messageInput.fill(PROMPT);
      await sendButton.click();

      await expect(page.getByTestId('chat-active-turn-anchor')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText('First visible block.')).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(250);

      const beforeGrowthTop = await measureActiveTurnTop(page);
      expect(beforeGrowthTop).not.toBeNull();

      await expect(page.getByText('Second visible block.')).toBeVisible({ timeout: 20_000 });
      await expect.poll(async () => {
        const top = await measureActiveTurnTop(page);
        return top == null || beforeGrowthTop == null ? null : Math.round(top - beforeGrowthTop);
      }, { timeout: 20_000 }).not.toBeNull();

      const afterGrowthTop = await measureActiveTurnTop(page);
      expect(afterGrowthTop).not.toBeNull();
      expect(Math.abs((afterGrowthTop ?? 0) - (beforeGrowthTop ?? 0))).toBeLessThanOrEqual(4);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('positions a new follow-up question in view when sending from a long historical session', async ({ launchElectronApp }) => {
    test.setTimeout(180_000);

    const app = await launchElectronApp({ skipSetup: true });
    const prompt = 'Follow-up question from a long historical session should be located.';
    const sessionKey = 'agent:main:session-history-follow-up-location';
    const sessionId = 'history-follow-up-location';
    const runId = 'run-history-follow-up-location';
    const baseTimestamp = Math.floor(Date.now() / 1000) - 4_000;
    const initialHistoryMessages: Array<Record<string, unknown>> = Array.from({ length: 18 }).flatMap((_value, index) => ([
      {
        id: `history-follow-up-user-${index + 1}`,
        role: 'user',
        content: `Historical prompt ${index + 1}: preserve enough transcript height before the new follow-up.`,
        timestamp: baseTimestamp + (index * 20),
      },
      {
        id: `history-follow-up-assistant-${index + 1}`,
        role: 'assistant',
        content: [
          `Historical answer ${index + 1}: this block makes the session tall.`,
          '',
          ...Array.from(
            { length: 8 },
            (_line, lineIndex) => `Detail ${lineIndex + 1} for historical turn ${index + 1}.`,
          ),
        ].join('\n'),
        timestamp: baseTimestamp + (index * 20) + 5,
      },
    ]));

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
          [stableStringify(['/api/sessions/list', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                sessions: [
                  {
                    key: sessionKey,
                    label: 'History follow-up location',
                    updatedAt: Date.now(),
                  },
                ],
              },
            },
          },
          [stableStringify(['/api/sessions/metadata', 'POST'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                metadata: {},
              },
            },
          },
          [stableStringify(['/api/sessions/history', 'POST'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                resolved: true,
                thinkingLevel: null,
                messages: initialHistoryMessages,
              },
            },
          },
        },
      });

      await app.evaluate(({ ipcMain, BrowserWindow }, { initialHistoryMessages, prompt, runId, sessionId, sessionKey }) => {
        const seedMessages = initialHistoryMessages as Array<Record<string, unknown>>;
        let historyMessages: Array<Record<string, unknown>> = [...seedMessages];
        let sessions = [{
          key: sessionKey,
          id: sessionId,
          label: 'History follow-up location',
          updatedAt: Date.now(),
        }];

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
            const now = Math.floor(Date.now() / 1000);
            const activeSessionKey = params?.sessionKey || sessionKey;
            historyMessages = [
              ...seedMessages,
              {
                id: 'history-follow-up-new-user',
                role: 'user',
                content: prompt,
                timestamp: now,
              },
            ];
            sessions = [{
              key: activeSessionKey,
              id: sessionId,
              label: 'History follow-up location',
              updatedAt: Date.now(),
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

            return {
              success: true,
              result: { runId },
            };
          }

          return {
            success: true,
            result: {},
          };
        });
      }, {
        initialHistoryMessages,
        prompt,
        runId,
        sessionId,
        sessionKey,
      });

      const page = await getStableWindow(app);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.reload();
      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });
      const sessionButton = page.getByTestId(`sidebar-session-${sessionKey}`).locator('button').first();
      await expect(sessionButton).toBeVisible({ timeout: 30_000 });
      await sessionButton.click({ force: true });
      await expect.poll(async () => (
        await page.getByTestId('chat-scroll-container').evaluate((element) => (
          element.scrollHeight - element.clientHeight
        ))
      ), { timeout: 30_000 }).toBeGreaterThan(600);

      await page.getByTestId('chat-scroll-container').evaluate((element) => {
        element.scrollTop = Math.max(0, element.scrollHeight * 0.35);
      });
      await page.waitForTimeout(250);

      const composer = page.getByTestId('chat-composer');
      await composer.getByRole('textbox').fill(prompt);
      await composer.getByTestId('chat-send-button').click();

      await expect(page.getByTestId('chat-active-turn-anchor')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(prompt, { exact: true })).toBeVisible({ timeout: 20_000 });

      await expect.poll(async () => {
        const viewport = await measureActiveTurnViewport(page);
        return viewport ? Math.round(viewport.top - viewport.containerTop) : Number.POSITIVE_INFINITY;
      }, { timeout: 20_000 }).toBeLessThanOrEqual(96);

      const viewport = await measureActiveTurnViewport(page);
      expect(viewport).not.toBeNull();
      expect((viewport?.top ?? 0) - (viewport?.containerTop ?? 0)).toBeGreaterThanOrEqual(16);
      expect((viewport?.top ?? 0) - (viewport?.containerTop ?? 0)).toBeLessThanOrEqual(96);
      expect(viewport?.bottom ?? 0).toBeLessThanOrEqual((viewport?.containerBottom ?? 0) + 1);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('does not repeat text snapshots already included in cumulative streaming output', async ({ launchElectronApp }) => {
    test.setTimeout(120_000);

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

      await app.evaluate(
        ({ ipcMain, BrowserWindow }, { prompt, runId, sessionId, sessionKey, intro, update, finalizing }) => {
          let sessions = [{
            key: sessionKey,
            id: sessionId,
            label: 'Cumulative stream dedupe',
            updatedAt: Date.now(),
          }];
          let historyMessages: Array<Record<string, unknown>> = [];

          const cumulativeText = [intro, '', update, '', finalizing].join('\n');

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
              const now = Math.floor(Date.now() / 1000);
              const activeSessionKey = params?.sessionKey || sessionKey;

              historyMessages = [{
                id: 'user-stream-cumulative-1',
                role: 'user',
                content: prompt,
                timestamp: now,
              }];
              sessions = [{
                key: activeSessionKey,
                id: sessionId,
                label: prompt,
                updatedAt: Date.now(),
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
                    seq: 1,
                    stream: 'assistant',
                    data: {
                      text: intro,
                      delta: intro,
                    },
                  },
                });
              }, 150);

              setTimeout(() => {
                emitNotification({
                  method: 'agent',
                  params: {
                    runId,
                    sessionKey: activeSessionKey,
                    seq: 2,
                    stream: 'assistant',
                    data: {
                      text: update,
                      delta: update,
                    },
                  },
                });
              }, 500);

              setTimeout(() => {
                emitNotification({
                  method: 'agent',
                  params: {
                    runId,
                    sessionKey: activeSessionKey,
                    seq: 3,
                    stream: 'assistant',
                    data: {
                      text: cumulativeText,
                      delta: finalizing,
                    },
                  },
                });
              }, 850);

              return {
                success: true,
                result: { runId },
              };
            }

            return {
              success: true,
              result: {},
            };
          });
        },
        {
          prompt: CUMULATIVE_PROMPT,
          runId: CUMULATIVE_RUN_ID,
          sessionId: CUMULATIVE_SESSION_ID,
          sessionKey: SESSION_KEY,
          intro: CUMULATIVE_INTRO,
          update: CUMULATIVE_UPDATE,
          finalizing: CUMULATIVE_FINALIZING,
        },
      );

      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });

      const composer = page.getByTestId('chat-composer');
      const messageInput = composer.getByRole('textbox');
      const sendButton = composer.getByTestId('chat-send-button');

      await messageInput.fill(CUMULATIVE_PROMPT);
      await sendButton.click();

      await expect(page.getByText(CUMULATIVE_FINALIZING, { exact: true })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(CUMULATIVE_INTRO, { exact: true })).toHaveCount(1);
      await expect(page.getByText(CUMULATIVE_UPDATE, { exact: true })).toHaveCount(1);
    } finally {
      await closeElectronApp(app);
    }
  });
});
