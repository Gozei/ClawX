import type { ElectronApplication, Page } from '@playwright/test';
import {
  closeElectronApp,
  expect,
  getStableWindow,
  installIpcMocks,
  test,
} from './fixtures/electron';

const SESSION_KEY = 'agent:main:main';
const SESSION_ID = 'stream-click-scroll';
const RUN_ID = 'run-stream-click-scroll';
const PROMPT = 'Keep the running transcript visible while the browser works.';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

async function measureScrollMetrics(page: Page): Promise<{ scrollTop: number; distanceFromBottom: number | null }> {
  return await page.evaluate(() => {
    const scrollContainer = document.querySelector('[data-testid="chat-scroll-container"]') as HTMLElement | null;
    if (!scrollContainer) {
      return { scrollTop: 0, distanceFromBottom: null };
    }

    return {
      scrollTop: scrollContainer.scrollTop,
      distanceFromBottom: scrollContainer.scrollHeight - scrollContainer.clientHeight - scrollContainer.scrollTop,
    };
  });
}

async function installStreamMockHandlers(
  app: ElectronApplication,
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await app.evaluate(({ ipcMain, BrowserWindow }, { prompt, runId, sessionId, sessionKey }) => {
        const baseTimestamp = Math.floor(Date.now() / 1000) - 600;
        const seedMessages: Array<Record<string, unknown>> = [];
        for (let index = 0; index < 16; index += 1) {
          seedMessages.push({
            id: `history-user-${index + 1}`,
            role: 'user',
            content: `History question ${index + 1}. Keep enough text here so the transcript remains scrollable.`,
            timestamp: baseTimestamp + (index * 4),
          });
          seedMessages.push({
            id: `history-assistant-${index + 1}`,
            role: 'assistant',
            content: `History answer ${index + 1}.\nDetail line one.\nDetail line two.`,
            timestamp: baseTimestamp + (index * 4) + 1,
          });
        }

        const chunkOne = [
          'Working on the browser task now.',
          '',
          'Stage 1 summary:',
          '- Opened the travel site.',
          '- Starting to collect the latest flight rows.',
        ].join('\n');
        const chunkTwo = [
          chunkOne,
          '',
          'Stage 2 details:',
          '- Found a late-night option that lands after midnight.',
          '- Found an early-morning option that arrives before ten.',
          '- Found a midday option with a slightly higher fare.',
          '- Comparing transfer rules and baggage notes now.',
          '- Keeping the transcript live while the browser continues.',
          '- This extra block is intentionally long enough to change scroll height.',
          '- Another line to make the growth obvious in Electron.',
        ].join('\n');

        let sessions = [{
          key: sessionKey,
          id: sessionId,
          label: 'Stream click scroll',
          updatedAt: Date.now(),
        }];
        let historyMessages: Array<Record<string, unknown>> = [...seedMessages];

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
                id: 'user-stream-click-1',
                role: 'user',
                content: prompt,
                timestamp: now,
              },
            ];
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
            }, 400);

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
            }, 2_600);

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
      return;
    } catch (error) {
      if (attempt === 2 || !String(error).includes('Execution context was destroyed')) {
        throw error;
      }
      await getStableWindow(app);
    }
  }
}

test.describe('Chat stream click scroll', () => {
  test('stops following the stream after the user clicks inside the transcript', async ({ launchElectronApp }) => {
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

      await installStreamMockHandlers(app);

      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });

      const composer = page.getByTestId('chat-composer');
      const messageInput = composer.getByRole('textbox');
      const sendButton = composer.getByTestId('chat-send-button');

      await page.getByTestId(`sidebar-session-${SESSION_KEY}`).click({ force: true });
      await expect(page.getByText('History answer 16.')).toBeVisible({ timeout: 30_000 });
      await messageInput.fill(PROMPT);
      await sendButton.click();

      await expect.poll(async () => (
        await sendButton.evaluate((node) => !!node.querySelector('svg.lucide-square'))
      ), { timeout: 20_000 }).toBe(true);

      await expect(page.getByText('Stage 1 summary:')).toBeVisible({ timeout: 20_000 });
      await expect.poll(async () => (
        await page.evaluate(() => document.querySelectorAll('[data-chat-scroll-block-anchor-key]').length)
      ), { timeout: 20_000 }).toBeGreaterThan(0);
      await page.waitForTimeout(300);

      const beforeClick = await measureScrollMetrics(page);
      expect(beforeClick.distanceFromBottom).not.toBeNull();
      expect(beforeClick.distanceFromBottom ?? 999).toBeLessThanOrEqual(24);

      await page.getByText('Stage 1 summary:').click();

      const detachedSnapshot = await page.evaluate(() => {
        const debugApi = (window as typeof window & {
          __CLAWX_CHAT_SCROLL_DEBUG__?: {
            getSnapshot: () => {
              anchor: { anchorType: string } | null;
              detachedScrollTop: number | null;
              mode: string;
            };
          };
        }).__CLAWX_CHAT_SCROLL_DEBUG__;
        return debugApi?.getSnapshot() ?? null;
      });
      expect(detachedSnapshot?.mode).toBe('detached');
      expect(detachedSnapshot?.anchor?.anchorType).toBeTruthy();
      expect(detachedSnapshot?.detachedScrollTop).not.toBeNull();

      await expect(page.getByTestId('chat-content-column')).toContainText('Stage 2 details:', { timeout: 20_000 });
      await expect.poll(async () => {
        const metrics = await measureScrollMetrics(page);
        return metrics.distanceFromBottom ?? 0;
      }, { timeout: 20_000 }).toBeGreaterThan((beforeClick.distanceFromBottom ?? 0) + 120);

      await expect.poll(async () => {
        const metrics = await measureScrollMetrics(page);
        return Math.abs(metrics.scrollTop - (detachedSnapshot?.detachedScrollTop ?? beforeClick.scrollTop));
      }, { timeout: 20_000 }).toBeLessThanOrEqual(3);

      const finalMetrics = await measureScrollMetrics(page);
      expect(finalMetrics.distanceFromBottom).not.toBeNull();
      expect(finalMetrics.distanceFromBottom ?? 0).toBeGreaterThan((beforeClick.distanceFromBottom ?? 0) + 120);

      const debugEvents = await page.evaluate(() => {
        const debugApi = (window as typeof window & {
          __CLAWX_CHAT_SCROLL_DEBUG__?: {
            getEvents: () => Array<{ type: string }>;
          };
        }).__CLAWX_CHAT_SCROLL_DEBUG__;
        return debugApi?.getEvents().map((event) => event.type) ?? [];
      });
      expect(debugEvents).toContain('transition');
      expect(debugEvents).toContain('anchor-captured');
      expect(debugEvents).not.toContain('detached-restored');

      await page.getByTestId('chat-scroll-container').hover();
      await page.mouse.wheel(0, -320);
      await expect.poll(async () => {
        const metrics = await measureScrollMetrics(page);
        return metrics.scrollTop;
      }, { timeout: 10_000 }).toBeLessThan(finalMetrics.scrollTop - 24);

      const afterWheelUp = await measureScrollMetrics(page);
      await page.mouse.wheel(0, 320);
      await expect.poll(async () => {
        const metrics = await measureScrollMetrics(page);
        return metrics.scrollTop;
      }, { timeout: 10_000 }).toBeGreaterThan(afterWheelUp.scrollTop + 24);

      await expect(page.getByTestId('chat-scroll-to-latest')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });
});
