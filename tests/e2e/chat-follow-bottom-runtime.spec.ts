import type { Page } from '@playwright/test';
import {
  closeElectronApp,
  expect,
  getStableWindow,
  installIpcMocks,
  test,
} from './fixtures/electron';

const SESSION_KEY = 'agent:main:main';
const SESSION_ID = 'follow-bottom-runtime';
const RUN_ID = 'run-follow-bottom-runtime';
const PROMPT = '打开浏览器，访问携程，查一下明天深圳到南京的机票，列一个表格给我';

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

test.describe('Chat follow-bottom runtime', () => {
  test('keeps the newest streamed content visible at the bottom while the user stays hands-off', async ({ launchElectronApp }) => {
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

      await app.evaluate(({ ipcMain, BrowserWindow }, { prompt, runId, sessionKey, sessionId }) => {
        const baseTimestamp = Math.floor(Date.now() / 1000) - 600;
        const seedMessages: Array<Record<string, unknown>> = [];
        for (let index = 0; index < 14; index += 1) {
          seedMessages.push({
            id: `history-user-${index + 1}`,
            role: 'user',
            content: `历史问题 ${index + 1}\n补一行内容，确保消息高度足够。`,
            timestamp: baseTimestamp + (index * 4),
          });
          seedMessages.push({
            id: `history-assistant-${index + 1}`,
            role: 'assistant',
            content: `历史回答 ${index + 1}\n第一行说明。\n第二行说明。\n第三行说明。`,
            timestamp: baseTimestamp + (index * 4) + 1,
          });
        }

        let sessions = [{
          key: sessionKey,
          id: sessionId,
          label: 'Follow bottom runtime',
          updatedAt: Date.now(),
        }];
        let historyMessages: Array<Record<string, unknown>> = [...seedMessages];

        const chunks = [
          [
            '我先打开浏览器访问携程，并整理明天深圳到南京的机票信息。',
            '',
            '| 航空公司 | 航班 | 起飞 | 到达 | 价格 |',
            '| --- | --- | --- | --- | --- |',
            '| 东方航空 | MU2878 | 23:25 | 01:50(+1) | ¥620 起 |',
          ].join('\n'),
          [
            '我先打开浏览器访问携程，并整理明天深圳到南京的机票信息。',
            '',
            '| 航空公司 | 航班 | 起飞 | 到达 | 价格 |',
            '| --- | --- | --- | --- | --- |',
            '| 东方航空 | MU2878 | 23:25 | 01:50(+1) | ¥620 起 |',
            '| 湖南航空 | A67297 | 07:15 | 09:30 | ¥650 起 |',
            '| 南方航空 | CZ5841 | 11:40 | 13:55 | ¥690 起 |',
            '',
            '阶段性整理：目前最低价是东方航空，但到达时间偏晚。',
            '阶段性整理：如果优先看最早出发，湖南航空更合适。',
          ].join('\n'),
          [
            '我先打开浏览器访问携程，并整理明天深圳到南京的机票信息。',
            '',
            '| 航空公司 | 航班 | 起飞 | 到达 | 价格 |',
            '| --- | --- | --- | --- | --- |',
            '| 东方航空 | MU2878 | 23:25 | 01:50(+1) | ¥620 起 |',
            '| 湖南航空 | A67297 | 07:15 | 09:30 | ¥650 起 |',
            '| 南方航空 | CZ5841 | 11:40 | 13:55 | ¥690 起 |',
            '| 深圳航空 | ZH9847 | 14:35 | 17:00 | ¥750 起 |',
            '| 厦门航空 | MF8620 | 16:25 | 18:50 | ¥780 起 |',
            '',
            '补充说明一：东方航空价格最低，但落地时间是次日凌晨。',
            '补充说明二：湖南航空最早出发，适合一早到南京开会。',
            '补充说明三：深圳航空白天时段更均衡，行程体验更稳。',
            '补充说明四：如果你带托运行李，还要额外比较行李额度。',
            '补充说明五：如果你更在意准点率，我可以继续补一列说明。',
            '补充说明六：如果你想压缩预算，我可以按最低价重新排序。',
            '补充说明七：如果你只接受直飞，我也可以只保留直飞航班。',
          ].join('\n'),
        ];
        const chunkDelays = [400, 6_000, 12_000];

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
            historyMessages = [
              ...seedMessages,
              {
                id: 'user-follow-bottom-1',
                role: 'user',
                content: prompt,
                timestamp: now,
              },
            ];
            sessions = [{
              key: sessionKey,
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
                  sessionKey: params?.sessionKey || sessionKey,
                },
              });
            }, 0);

            chunks.forEach((fullText, index) => {
              setTimeout(() => {
                emitNotification({
                  method: 'agent',
                  params: {
                    runId,
                    sessionKey: params?.sessionKey || sessionKey,
                    stream: 'assistant',
                    data: {
                      text: fullText,
                      delta: index === 0 ? fullText : fullText.slice(chunks[index - 1].length),
                    },
                  },
                });
              }, chunkDelays[index] ?? (400 + (index * 6_000)));
            });

            setTimeout(() => {
              const completedAt = Math.floor(Date.now() / 1000);
              historyMessages = [
                ...seedMessages,
                {
                  id: 'user-follow-bottom-1',
                  role: 'user',
                  content: prompt,
                  timestamp: now,
                },
                {
                  id: 'assistant-follow-bottom-1',
                  role: 'assistant',
                  content: chunks[chunks.length - 1],
                  timestamp: completedAt,
                },
              ];
              emitNotification({
                method: 'agent',
                params: {
                  phase: 'completed',
                  state: 'final',
                  runId,
                  sessionKey: params?.sessionKey || sessionKey,
                  message: {
                    role: 'assistant',
                    content: chunks[chunks.length - 1],
                    timestamp: completedAt,
                  },
                },
              });
            }, 16_000);

            return {
              success: true,
              result: { runId },
            };
          }

          return { success: true, result: {} };
        });
      }, {
        prompt: PROMPT,
        runId: RUN_ID,
        sessionKey: SESSION_KEY,
        sessionId: SESSION_ID,
      });

      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });

      const composer = page.getByTestId('chat-composer');
      const messageInput = composer.getByRole('textbox');
      const sendButton = composer.getByTestId('chat-send-button');

      await expect(page.getByText('历史回答 14')).toBeVisible({ timeout: 30_000 });
      await messageInput.fill(PROMPT);
      await sendButton.click();

      await expect.poll(async () => {
        return await sendButton.evaluate((node) => !!node.querySelector('svg.lucide-square'));
      }, { timeout: 20_000 }).toBe(true);

      await expect.poll(async () => {
        const metrics = await measureScrollMetrics(page);
        return metrics.distanceFromBottom != null ? metrics.distanceFromBottom <= 24 : false;
      }, { timeout: 20_000 }).toBe(true);
      const initialMetrics = await measureScrollMetrics(page);

      await expect(page.getByRole('cell', { name: '东方航空', exact: true })).toBeVisible({ timeout: 20_000 });
      await expect.poll(async () => {
        const metrics = await measureScrollMetrics(page);
        return metrics.scrollTop > initialMetrics.scrollTop && (metrics.distanceFromBottom ?? 999) <= 24;
      }, { timeout: 20_000 }).toBe(true);
      const metricsAfterFirstChunk = await measureScrollMetrics(page);

      await expect(page.getByRole('cell', { name: '南方航空', exact: true })).toBeVisible({ timeout: 20_000 });
      await expect.poll(async () => {
        const metrics = await measureScrollMetrics(page);
        return metrics.scrollTop > metricsAfterFirstChunk.scrollTop && (metrics.distanceFromBottom ?? 999) <= 24;
      }, { timeout: 20_000 }).toBe(true);
      const metricsAfterSecondChunk = await measureScrollMetrics(page);

      await expect(page.getByText('补充说明七：如果你只接受直飞，我也可以只保留直飞航班。')).toBeVisible({ timeout: 20_000 });
      await expect.poll(async () => {
        const metrics = await measureScrollMetrics(page);
        return metrics.scrollTop > metricsAfterSecondChunk.scrollTop && (metrics.distanceFromBottom ?? 999) <= 24;
      }, { timeout: 20_000 }).toBe(true);

      await expect.poll(async () => {
        return await sendButton.evaluate((node) => !!node.querySelector('svg.lucide-send-horizontal'));
      }, { timeout: 20_000 }).toBe(true);
    } finally {
      await closeElectronApp(app);
    }
  });
});
