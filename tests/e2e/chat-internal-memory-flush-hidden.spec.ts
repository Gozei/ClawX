import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:internal-memory-flush-hidden-test';
const SESSION_FILE = 'internal-memory-flush-hidden-test.jsonl';
const SESSION_LABEL = 'Internal memory flush hidden session';
const VISIBLE_USER_TEXT = 'This is a normal question.';
const VISIBLE_ASSISTANT_TEXT = 'This is a normal reply.';

async function seedSession(homeDir: string): Promise<void> {
  const sessionsDir = join(homeDir, '.openclaw', 'agents', 'main', 'sessions');
  const seededMessages = [
    {
      id: 'flush-user-1',
      role: 'user',
      content: [
        {
          type: 'text',
          text: [
            'Pre-compaction memory flush. Store durable memories only in memory/2026-04-16.md (create memory/ if needed).',
            'Treat workspace bootstrap/reference files such as MEMORY.md, DREAMS.md, SOUL.md, TOOLS.md, and AGENTS.md as read-only during this flush; never overwrite, replace, or edit them.',
            'If memory/2026-04-16.md already exists, APPEND new content only and do not overwrite existing entries.',
            'Do NOT create timestamped variant files (e.g., 2026-04-16-HHMM.md); always use the canonical 2026-04-16.md filename.',
            'If nothing to store, reply with NO_REPLY.',
            '当前时间：Thursday, April 16th, 2026 - 14:48（Etc/GMT-8）',
          ].join('\n'),
        },
      ],
      timestamp: Math.floor(Date.now() / 1000) - 4,
    },
    {
      id: 'user-2',
      role: 'user',
      content: VISIBLE_USER_TEXT,
      timestamp: Math.floor(Date.now() / 1000) - 3,
    },
    {
      id: 'assistant-2',
      role: 'assistant',
      content: VISIBLE_ASSISTANT_TEXT,
      timestamp: Math.floor(Date.now() / 1000) - 2,
    },
  ];

  await mkdir(sessionsDir, { recursive: true });
  await writeFile(
    join(sessionsDir, 'sessions.json'),
    JSON.stringify({
      sessions: [
        {
          key: SESSION_KEY,
          id: 'internal-memory-flush-hidden-test',
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

async function ensureGatewayConnected(page: Awaited<ReturnType<typeof getStableWindow>>): Promise<void> {
  const startResult = await page.evaluate(async () => (
    await window.electron.ipcRenderer.invoke('gateway:start')
  ) as { success?: boolean; error?: string });
  expect(startResult?.success, startResult?.error || 'gateway:start failed during E2E setup').toBe(true);
}

async function openSeededSession(page: Awaited<ReturnType<typeof getStableWindow>>): Promise<void> {
  const sessionRow = page.getByTestId(`sidebar-session-${SESSION_KEY}`);
  if (await sessionRow.count() === 0) {
    await ensureGatewayConnected(page);
  }
  await expect(sessionRow).toBeVisible({ timeout: 60_000 });
  await sessionRow.click();
}

test.describe('Chat internal memory flush hiding', () => {
  test.fixme('does not render internal pre-compaction memory flush turns in chat history', async ({ homeDir, launchElectronApp }) => {
    await seedSession(homeDir);

    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 45_000 });
      await openSeededSession(page);

      await expect(page.getByText(VISIBLE_USER_TEXT, { exact: true })).toBeVisible({ timeout: 60_000 });
      await expect(page.getByText(VISIBLE_ASSISTANT_TEXT, { exact: true })).toBeVisible({ timeout: 60_000 });
      await expect(page.getByText('Pre-compaction memory flush.', { exact: false })).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });
});
