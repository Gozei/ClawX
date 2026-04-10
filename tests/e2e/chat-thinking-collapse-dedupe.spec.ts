import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:thinking-collapse-dedupe-test';
const SESSION_FILE = 'thinking-collapse-dedupe-test.jsonl';
const SESSION_LABEL = 'Thinking collapse dedupe session';
const USER_TEXT = 'Please take a photo and send it to me.';
const INTERMEDIATE_TEXT_1 = 'I am checking the camera and preparing to take the photo.';
const INTERMEDIATE_TEXT_2 = 'The photo is saved. I am preparing the final result for you.';
const FINAL_TEXT = 'Done, the photo has been sent to you.';
const THINKING_TEXT = 'Confirm the final output one last time.';

const seededMessages = [
  {
    id: 'user-1',
    role: 'user',
    content: USER_TEXT,
    timestamp: Math.floor(Date.now() / 1000) - 5,
  },
  {
    id: 'assistant-1',
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: 'Confirm the camera tool is available first.' },
      { type: 'text', text: INTERMEDIATE_TEXT_1 },
    ],
    timestamp: Math.floor(Date.now() / 1000) - 4,
  },
  {
    id: 'assistant-2',
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: 'The photo is captured, now prepare and send the result.' },
      { type: 'text', text: INTERMEDIATE_TEXT_2 },
    ],
    timestamp: Math.floor(Date.now() / 1000) - 3,
  },
  {
    id: 'assistant-3',
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: THINKING_TEXT },
      { type: 'text', text: FINAL_TEXT },
    ],
    timestamp: Math.floor(Date.now() / 1000) - 2,
  },
];

async function seedSession(homeDir: string): Promise<void> {
  const sessionsDir = join(homeDir, '.openclaw', 'agents', 'main', 'sessions');
  await mkdir(sessionsDir, { recursive: true });
  await writeFile(
    join(sessionsDir, 'sessions.json'),
    JSON.stringify({
      sessions: [
        {
          key: SESSION_KEY,
          id: 'thinking-collapse-dedupe-test',
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
    `${seededMessages.map((message) => JSON.stringify(message)).join('\n')}\n`,
    'utf8',
  );
}

test.describe('Chat thinking collapse dedupe', () => {
  test('renders the final assistant reply only once when the turn is collapsed', async ({ homeDir, launchElectronApp }) => {
    await seedSession(homeDir);

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

      await expect(page.getByText(USER_TEXT, { exact: true })).toBeVisible({ timeout: 60_000 });
      await expect(page.getByText(FINAL_TEXT, { exact: true })).toBeVisible({ timeout: 60_000 });
      await expect(page.getByText(FINAL_TEXT, { exact: true })).toHaveCount(1);
      await expect(page.getByTestId('chat-process-toggle')).toBeVisible();
      await expect(page.getByTestId('chat-process-toggle')).toHaveCount(1);
      await expect(page.getByText(INTERMEDIATE_TEXT_1, { exact: true })).toHaveCount(0);
      await expect(page.getByText(INTERMEDIATE_TEXT_2, { exact: true })).toHaveCount(0);

      await page.getByTestId('chat-process-toggle').click();

      await expect(page.getByTestId('chat-process-content')).toBeVisible();
      await expect(page.getByText(INTERMEDIATE_TEXT_1, { exact: true })).toBeVisible();
      await expect(page.getByText(INTERMEDIATE_TEXT_2, { exact: true })).toBeVisible();
      await expect(page.getByText(THINKING_TEXT, { exact: true })).toBeVisible();

      const processMessage = page
        .getByTestId('chat-process-content')
        .getByTestId('chat-message-content-assistant')
        .filter({ has: page.getByText(INTERMEDIATE_TEXT_1, { exact: true }) });
      const finalMessage = page
        .getByTestId('chat-message-content-assistant')
        .filter({ has: page.getByText(FINAL_TEXT, { exact: true }) });

      const [processBox, finalBox] = await Promise.all([
        processMessage.boundingBox(),
        finalMessage.boundingBox(),
      ]);

      expect(processBox).not.toBeNull();
      expect(finalBox).not.toBeNull();
      expect(Math.abs((processBox?.width ?? 0) - (finalBox?.width ?? 0))).toBeLessThanOrEqual(2);
    } finally {
      await closeElectronApp(app);
    }
  });
});
