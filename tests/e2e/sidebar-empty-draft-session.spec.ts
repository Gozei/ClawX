import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:existing-history';

async function seedSession(homeDir: string): Promise<void> {
  const sessionsDir = join(homeDir, '.openclaw', 'agents', 'main', 'sessions');
  await mkdir(sessionsDir, { recursive: true });
  await writeFile(
    join(sessionsDir, 'sessions.json'),
    JSON.stringify({
      sessions: [
        {
          key: SESSION_KEY,
          id: 'existing-history',
          file: 'existing-history.jsonl',
          label: 'Existing history',
          updatedAt: Date.now(),
        },
      ],
    }, null, 2),
    'utf8',
  );
  await writeFile(
    join(sessionsDir, 'existing-history.jsonl'),
    `${JSON.stringify({
      role: 'user',
      content: 'seed message',
      timestamp: Math.floor(Date.now() / 1000),
    })}\n`,
    'utf8',
  );
}

test.describe('Sidebar draft sessions', () => {
  test('does not show an empty new chat as session history before the first message', async ({ homeDir, launchElectronApp }) => {
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

      await page.getByTestId('sidebar-new-chat').click();
      await expect(page.getByTestId('sidebar')).toHaveCSS('width', '256px');
      const composerInput = page.getByTestId('chat-composer').getByRole('textbox');
      await composerInput.fill('draft that should stay with the current conversation');
      await expect(page.getByText(/agent:main:session-\d+/)).toHaveCount(0);
      await expect(page.getByTestId(`sidebar-session-${SESSION_KEY}`)).toBeVisible();
      await expect(composerInput).toHaveValue('draft that should stay with the current conversation');
    } finally {
      await closeElectronApp(app);
    }
  });
});
