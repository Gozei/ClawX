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
});
