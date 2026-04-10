import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:process-tool-card-test';
const SESSION_FILE = 'process-tool-card-test.jsonl';
const SESSION_LABEL = 'Process tool card session';

const seededMessages = [
  {
    id: 'user-1',
    role: 'user',
    content: 'Show me the cron status.',
    timestamp: Math.floor(Date.now() / 1000) - 5,
  },
  {
    id: 'assistant-1',
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: 'Check the cron tasks before replying.' },
      { type: 'tool_use', id: 'tool-1', name: 'cron', input: { action: 'list' } },
      { type: 'text', text: 'Looking up the cron tasks now.' },
    ],
    timestamp: Math.floor(Date.now() / 1000) - 4,
  },
  {
    id: 'assistant-2',
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: 'Summarize the result clearly.' },
      { type: 'text', text: 'No cron tasks are configured right now.' },
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
          id: 'process-tool-card-test',
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

test.describe('Chat process tool cards', () => {
  test('shows tool cards inside the expanded process section', async ({ homeDir, launchElectronApp }) => {
    await seedSession(homeDir);

    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      await page.getByTestId(`sidebar-session-${SESSION_KEY}`).click();

      await expect(page.getByTestId('chat-process-toggle')).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId('chat-process-status')).toContainText('Processed');
      await page.getByTestId('chat-process-toggle').click();

      await expect(page.getByTestId('chat-process-content')).toBeVisible();
      await expect(page.getByTestId('chat-tool-card')).toBeVisible();
      await expect(page.getByText('No cron tasks are configured right now.', { exact: true })).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });
});
