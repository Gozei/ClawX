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
      await expect(page.getByTestId(`sidebar-session-${SESSION_KEY}`)).toBeVisible({ timeout: 60_000 });

      await page.getByTestId('sidebar-new-chat').click();
      await page.getByTestId('sidebar').locator('button').first().click();

      await expect(page.getByText(/agent:main:session-\d+/)).toHaveCount(0);
      await expect(page.getByTestId(`sidebar-session-${SESSION_KEY}`)).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });
});
