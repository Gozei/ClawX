import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:session-collapse-test';

async function seedSession(homeDir: string): Promise<void> {
  const sessionsDir = join(homeDir, '.openclaw', 'agents', 'main', 'sessions');
  await mkdir(sessionsDir, { recursive: true });
  await writeFile(
    join(sessionsDir, 'sessions.json'),
    JSON.stringify({
      sessions: [
        {
          key: SESSION_KEY,
          id: 'session-collapse-test',
          file: 'session-collapse-test.jsonl',
          label: 'Collapse sidebar session',
          updatedAt: Date.now(),
        },
      ],
    }, null, 2),
    'utf8',
  );
  await writeFile(
    join(sessionsDir, 'session-collapse-test.jsonl'),
    `${JSON.stringify({
      role: 'user',
      content: 'seed message',
      timestamp: Math.floor(Date.now() / 1000),
    })}\n`,
    'utf8',
  );
}

test.describe('Sidebar new session behavior', () => {
  test('keeps the sidebar expanded when clicking new session, including after reopening it', async ({ homeDir, launchElectronApp }) => {
    await seedSession(homeDir);

    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      const sidebar = page.getByTestId('sidebar');
      await expect(page.getByTestId(`sidebar-session-${SESSION_KEY}`)).toBeVisible({ timeout: 60_000 });

      await page.getByTestId('sidebar-new-chat').click();

      await expect(page.getByTestId(`sidebar-session-${SESSION_KEY}`)).toBeVisible();
      await expect(sidebar).toHaveCSS('width', '256px');

      await sidebar.locator('button').first().click();
      await expect(sidebar).toHaveCSS('width', '64px');

      await sidebar.locator('button').first().click();
      await expect(page.getByTestId(`sidebar-session-${SESSION_KEY}`)).toBeVisible();
      await expect(sidebar).toHaveCSS('width', '256px');

      await page.getByTestId('sidebar-new-chat').click();

      await expect(sidebar).toHaveCSS('width', '256px');
    } finally {
      await closeElectronApp(app);
    }
  });
});
