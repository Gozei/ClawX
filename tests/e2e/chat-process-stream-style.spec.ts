import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:process-stream-style-test';
const SESSION_FILE = 'process-stream-style-test.jsonl';
const SESSION_LABEL = 'Process stream style session';

const seededMessages = [
  {
    id: 'user-1',
    role: 'user',
    content: 'Check the browser status for me.',
    timestamp: Math.floor(Date.now() / 1000) - 5,
  },
  {
    id: 'assistant-1',
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: 'Check the browser before replying.' },
      { type: 'tool_use', id: 'browser-1', name: 'browser', input: { action: 'start', enabled: true } },
    ],
    timestamp: Math.floor(Date.now() / 1000) - 4,
  },
  {
    id: 'assistant-2',
    role: 'assistant',
    content: [
      { type: 'text', text: 'The browser is ready now.' },
    ],
    timestamp: Math.floor(Date.now() / 1000) - 3,
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
          id: 'process-stream-style-test',
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

// Seeded-session sidebar hydration is currently flaky in Electron E2E.
// Keep the scenario documented here while unit tests cover the detailed UI behavior.
test.describe.skip('Chat process stream style', () => {
  test('shows direct thinking content without nested repeated event rows in stream mode', async ({ homeDir, launchElectronApp }) => {
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

      await expect(page.getByText('The browser is ready now.')).toBeVisible({ timeout: 60_000 });

      await page.getByTestId('sidebar-nav-settings').click();
      await expect(page.getByTestId('settings-page')).toBeVisible();
      await page.getByTestId('settings-assistant-message-style-stream').click();
      await page.goBack();

      await expect(page.getByTestId('chat-process-toggle')).toBeVisible({ timeout: 60_000 });
      await page.getByTestId('chat-process-toggle').click();

      const processContent = page.getByTestId('chat-process-content');
      await expect(processContent).toBeVisible();
      await expect(processContent.getByTestId('chat-process-event-row')).toHaveCount(1);
      await expect(processContent.getByText('Check the browser before replying.')).toBeVisible();
      await expect(processContent.getByText('Browser opened')).toBeVisible();
      await expect(processContent.getByText(/"action": "start"/)).toBeVisible();
      await expect(processContent.getByText('Thinking')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });
});
