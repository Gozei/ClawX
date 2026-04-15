import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:history-refresh-hydration-test';
const SESSION_FILE = 'history-refresh-hydration-test.jsonl';
const SESSION_LABEL = 'History refresh hydration session';
const USER_TEXT = 'Who are you?';
const FINAL_TEXT = 'I am ClawX.';

function buildSeededMessages(includeAssistant: boolean) {
  const baseTimestamp = Math.floor(Date.now() / 1000);
  return [
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
    } finally {
      await closeElectronApp(app);
    }
  });
});
