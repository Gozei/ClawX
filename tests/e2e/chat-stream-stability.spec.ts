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

async function sampleActiveTurnTopDrift(
  page: Page,
  baselineTop: number,
  durationMs: number,
): Promise<{ maxAbsDelta: number; minDelta: number; maxDelta: number; sampleCount: number }> {
  return await page.evaluate(
    ({ baselineTop: baseline, durationMs: duration }) => new Promise((resolve) => {
      const startedAt = performance.now();
      let maxAbsDelta = 0;
      let minDelta = 0;
      let maxDelta = 0;
      let sampleCount = 0;

      const sample = () => {
        const anchor = document.querySelector('[data-testid="chat-active-turn-anchor"]') as HTMLElement | null;
        if (anchor) {
          const delta = anchor.getBoundingClientRect().top - baseline;
          maxAbsDelta = Math.max(maxAbsDelta, Math.abs(delta));
          minDelta = Math.min(minDelta, delta);
          maxDelta = Math.max(maxDelta, delta);
          sampleCount += 1;
        }

        if (performance.now() - startedAt >= duration) {
          resolve({ maxAbsDelta, minDelta, maxDelta, sampleCount });
          return;
        }

        requestAnimationFrame(sample);
      };

      requestAnimationFrame(sample);
    }),
    { baselineTop, durationMs },
  ) as Promise<{ maxAbsDelta: number; minDelta: number; maxDelta: number; sampleCount: number }>;
}

async function measureTranscriptDistanceFromBottom(page: Page): Promise<number | null> {
  return await page.evaluate(() => {
    const scrollContainer = document.querySelector('[data-testid="chat-scroll-container"]') as HTMLElement | null;
    if (!scrollContainer) return null;
    return Math.max(
      0,
      scrollContainer.scrollHeight - scrollContainer.clientHeight - scrollContainer.scrollTop,
    );
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
      if (beforeGrowthTop == null) {
        throw new Error('Active turn anchor was not measurable before stream growth');
      }

      const driftDuringGrowthPromise = sampleActiveTurnTopDrift(page, beforeGrowthTop, 3_000);

      await expect(page.getByText('Second visible block.')).toBeVisible({ timeout: 20_000 });
      const driftDuringGrowth = await driftDuringGrowthPromise;
      expect(driftDuringGrowth.sampleCount).toBeGreaterThan(0);
      expect(driftDuringGrowth.maxAbsDelta).toBeLessThanOrEqual(6);

      const afterGrowthTop = await measureActiveTurnTop(page);
      expect(afterGrowthTop).not.toBeNull();
      expect(Math.abs((afterGrowthTop ?? 0) - beforeGrowthTop)).toBeLessThanOrEqual(4);
      await expect.poll(async () => await measureTranscriptDistanceFromBottom(page), { timeout: 10_000 }).toBeLessThanOrEqual(2);
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
