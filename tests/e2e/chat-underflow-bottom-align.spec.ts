import type { Page } from '@playwright/test';
import {
  closeElectronApp,
  expect,
  getStableWindow,
  installIpcMocks,
  test,
} from './fixtures/electron';

const SESSION_KEY = 'agent:main:main';
const SESSION_ID = 'underflow-bottom-align';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

async function measureBottomGap(page: Page): Promise<{
  clientHeight: number | null;
  gap: number | null;
  scrollHeight: number | null;
  scrollTop: number | null;
}> {
  return await page.evaluate(() => {
    const scrollContainer = document.querySelector('[data-testid="chat-scroll-container"]') as HTMLElement | null;
    const contentColumn = scrollContainer?.querySelector('[data-testid="chat-content-column"]') as HTMLElement | null;
    if (!scrollContainer || !contentColumn) {
      return {
        clientHeight: null,
        gap: null,
        scrollHeight: null,
        scrollTop: null,
      };
    }

    const scrollRect = scrollContainer.getBoundingClientRect();
    const contentRect = contentColumn.getBoundingClientRect();

    return {
      clientHeight: scrollContainer.clientHeight,
      gap: Number((scrollRect.bottom - contentRect.bottom).toFixed(2)),
      scrollHeight: scrollContainer.scrollHeight,
      scrollTop: scrollContainer.scrollTop,
    };
  });
}

test.describe('Chat underflow bottom alignment', () => {
  test('keeps a short transcript anchored near the bottom of the viewport', async ({ launchElectronApp }) => {
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

      await app.evaluate(({ ipcMain }, { sessionId, sessionKey }) => {
        const baseTimestamp = Math.floor(Date.now() / 1000) - 60;
        const sessions = [{
          key: sessionKey,
          id: sessionId,
          label: 'Underflow bottom alignment',
          updatedAt: Date.now(),
        }];
        const historyMessages = [
          {
            id: 'underflow-user-1',
            role: 'user',
            content: 'Keep this transcript intentionally short.',
            timestamp: baseTimestamp,
          },
          {
            id: 'underflow-assistant-1',
            role: 'assistant',
            content: 'Short reply so the viewport underflows.',
            timestamp: baseTimestamp + 1,
          },
        ];

        ipcMain.removeHandler('gateway:rpc');
        ipcMain.handle('gateway:rpc', async (_event, method: string) => {
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

          return {
            success: true,
            result: {},
          };
        });
      }, {
        sessionId: SESSION_ID,
        sessionKey: SESSION_KEY,
      });

      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });
      await expect(page.getByText('Keep this transcript intentionally short.')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('Short reply so the viewport underflows.')).toBeVisible({ timeout: 30_000 });

      await expect.poll(async () => {
        const metrics = await measureBottomGap(page);
        return (
          metrics.scrollHeight != null
          && metrics.clientHeight != null
          && metrics.scrollHeight <= metrics.clientHeight
          && metrics.scrollTop === 0
          && (metrics.gap ?? 999) <= 96
        );
      }, { timeout: 15_000 }).toBe(true);
    } finally {
      await closeElectronApp(app);
    }
  });
});
