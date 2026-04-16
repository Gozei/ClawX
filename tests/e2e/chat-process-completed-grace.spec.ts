import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:process-completed-grace-test';
const SESSION_FILE = 'process-completed-grace-test.jsonl';
const SESSION_LABEL = 'Process completed grace session';

async function seedSession(homeDir: string): Promise<void> {
  const baseTimestamp = Math.floor(Date.now() / 1000);
  const sessionsDir = join(homeDir, '.openclaw', 'agents', 'main', 'sessions');
  await mkdir(sessionsDir, { recursive: true });
  await writeFile(
    join(sessionsDir, 'sessions.json'),
    JSON.stringify({
      sessions: [
        {
          key: SESSION_KEY,
          id: 'process-completed-grace-test',
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
    [
      JSON.stringify({
        id: 'user-1',
        role: 'user',
        content: 'What model are you using?',
        timestamp: baseTimestamp - 1,
      }),
      JSON.stringify({
        id: 'assistant-1',
        role: 'assistant',
        content: 'I am using qwen3.5-plus.',
        timestamp: baseTimestamp,
      }),
    ].join('\n') + '\n',
    'utf8',
  );
}

async function openSeededSession(page: Awaited<ReturnType<typeof getStableWindow>>): Promise<void> {
  const sessionRow = page.getByTestId(`sidebar-session-${SESSION_KEY}`);
  if (await sessionRow.count() === 0) {
    const startResult = await page.evaluate(async () => (
      await window.electron.ipcRenderer.invoke('gateway:start')
    ) as { success?: boolean; error?: string });
    expect(startResult?.success, startResult?.error || 'gateway:start failed during E2E setup').toBe(true);
  }
  await expect(sessionRow).toBeVisible({ timeout: 60_000 });
  await sessionRow.click();

  const refreshButton = page.getByTestId('chat-refresh-button');
  if (await refreshButton.count() > 0) {
    await refreshButton.click();
  }
}

test.describe('Chat process completed grace state', () => {
  test('shows a completed process status instead of a running timer for a freshly finished turn', async ({ homeDir, launchElectronApp }) => {
    test.fixme(process.platform === 'win32', 'Seeded-session sidebar hydration is currently flaky in Electron E2E on Windows.');
    await seedSession(homeDir);

    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      await openSeededSession(page);

      const processStatus = page.getByTestId('chat-process-status').first();
      await expect(processStatus).toBeVisible({ timeout: 60_000 });
      await expect(processStatus).toContainText(/Processed|已处理/);
      await expect(processStatus).not.toContainText(/Working for|处理中/);
      await expect(page.getByText('I am using qwen3.5-plus.', { exact: true })).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });
});
