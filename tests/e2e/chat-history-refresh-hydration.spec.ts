import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:history-refresh-hydration-test';
const SESSION_FILE = 'history-refresh-hydration-test.jsonl';
const SESSION_LABEL = 'History refresh hydration session';
const EARLIER_USER_TEXT = 'Earlier seeded question.';
const EARLIER_ASSISTANT_TEXT = 'Earlier seeded answer.';
const USER_TEXT = 'Who are you? '.repeat(10).trim();
const FINAL_TEXT = 'I am ClawX.';

function buildSeededMessages(includeAssistant: boolean) {
  const baseTimestamp = Math.floor(Date.now() / 1000);
  return [
    {
      id: 'user-0',
      role: 'user',
      content: EARLIER_USER_TEXT,
      timestamp: baseTimestamp - 2,
    },
    {
      id: 'assistant-0',
      role: 'assistant',
      content: EARLIER_ASSISTANT_TEXT,
      timestamp: baseTimestamp - 1,
    },
    {
      id: 'user-1',
      role: 'user',
      content: USER_TEXT,
      timestamp: baseTimestamp,
    },
    ...(includeAssistant
      ? [{
          id: 'assistant-1',
          role: 'assistant',
          content: FINAL_TEXT,
          timestamp: baseTimestamp + 1,
        }]
      : []),
  ];
}

async function writeSession(homeDir: string, includeAssistant: boolean): Promise<void> {
  const sessionsDir = join(homeDir, '.openclaw', 'agents', 'main', 'sessions');
  await mkdir(sessionsDir, { recursive: true });
  await writeFile(
    join(sessionsDir, 'sessions.json'),
    JSON.stringify({
      sessions: [
        {
          key: SESSION_KEY,
          id: 'history-refresh-hydration-test',
          file: SESSION_FILE,
          label: SESSION_LABEL,
          updatedAt: Date.now(),
        },
      ],
    }, null, 2),
    'utf8',
  );
  await writeFile(
    join(sessionsDir, SESSION_FILE),
    `${buildSeededMessages(includeAssistant).map((message) => JSON.stringify(message)).join('\n')}\n`,
    'utf8',
  );
}

test.describe('Chat history refresh hydration', () => {
  test('hydrates a missing final assistant reply after the initial history load', async ({ homeDir, launchElectronApp }) => {
    await writeSession(homeDir, false);

    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      const sessionRow = page.getByTestId(`sidebar-session-${SESSION_KEY}`);
      if (await sessionRow.count() === 0) {
        const startResult = await page.evaluate(async () => (
          await window.electron.ipcRenderer.invoke('gateway:start')
        ) as { success?: boolean; error?: string });
        expect(startResult?.success, startResult?.error || 'gateway:start failed during E2E setup').toBe(true);
      }
      await expect(sessionRow).toBeVisible({ timeout: 60_000 });
      await sessionRow.click();

      const userMessages = page.getByTestId('chat-message-content-user').filter({ hasText: USER_TEXT });
      await expect(page.getByText(USER_TEXT, { exact: true })).toBeVisible({ timeout: 60_000 });
      await expect(userMessages).toHaveCount(1);
      await expect(page.getByText(FINAL_TEXT, { exact: true })).toHaveCount(0);

      await writeSession(homeDir, true);
      await page.getByTestId('chat-refresh-button').click();

      await expect(page.getByText(FINAL_TEXT, { exact: true })).toBeVisible({ timeout: 60_000 });
      await expect(userMessages).toHaveCount(1);
      await expect(page.getByTestId('chat-active-turn-bottom-spacer')).toHaveCount(0);
      await expect(page.getByTestId(`sidebar-session-running-indicator-${SESSION_KEY}`)).toHaveCount(0);
      const sendButtonTitle = await page.getByTestId('chat-send-button').getAttribute('title');
      expect(['Send', '发送']).toContain(sendButtonTitle);
      await expect
        .poll(async () => page.getByTestId('chat-send-button').locator('svg').getAttribute('fill'))
        .not.toBe('currentColor');

      const [finalMessageBox, composerBox] = await Promise.all([
        page.getByTestId('chat-assistant-message-shell').last().boundingBox(),
        page.getByTestId('chat-composer').boundingBox(),
      ]);

      if (finalMessageBox && composerBox) {
        const gap = composerBox.y - (finalMessageBox.y + finalMessageBox.height);
        expect(gap).toBeGreaterThan(0);
      }

      const scrollContainer = page.getByTestId('chat-scroll-container');
      await scrollContainer.hover();
      await page.mouse.wheel(0, -180);
      await expect(page.getByText(EARLIER_ASSISTANT_TEXT, { exact: true })).toBeVisible();
      await expect(page.getByText(USER_TEXT, { exact: true })).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });
});
