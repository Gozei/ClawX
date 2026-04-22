import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closeElectronApp, expect, getStableWindow, openSettingsHub, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:session-archive-target';
const SESSION_FILE = 'session-archive-target.jsonl';
const SESSION_TITLE = 'Archive target session';

async function seedSessions(homeDir: string): Promise<void> {
  const sessionsDir = join(homeDir, '.openclaw', 'agents', 'main', 'sessions');
  await mkdir(sessionsDir, { recursive: true });
  await writeFile(
    join(sessionsDir, 'sessions.json'),
    JSON.stringify({
      sessions: [
        {
          key: SESSION_KEY,
          id: 'session-archive-target',
          file: SESSION_FILE,
          label: SESSION_TITLE,
          createdAt: Date.now() - 10_000,
          updatedAt: Date.now() - 1_000,
        },
      ],
    }, null, 2),
    'utf8',
  );
  await writeFile(
    join(sessionsDir, SESSION_FILE),
    `${JSON.stringify({
      role: 'user',
      content: 'Archive me',
      timestamp: Math.floor(Date.now() / 1000),
    })}\n`,
    'utf8',
  );
}

test.describe('Session archive', () => {
  test('archives from the sidebar and restores from settings', async ({ homeDir, launchElectronApp }) => {
    await seedSessions(homeDir);

    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      const sessionRow = page.getByTestId(`sidebar-session-${SESSION_KEY}`);
      await expect(sessionRow).toBeVisible({ timeout: 60_000 });
      await sessionRow.click();
      await sessionRow.hover();
      await page.getByTestId(`sidebar-session-menu-trigger-${SESSION_KEY}`).click();
      await expect(page.getByTestId(`sidebar-session-menu-archive-${SESSION_KEY}`)).toBeVisible();
      await page.getByTestId(`sidebar-session-menu-archive-${SESSION_KEY}`).click();

      await expect(page.getByText('确认将该会话归档吗？归档后可在「系统设置-会话归档」中查看已归档任务。')).toBeVisible();
      await page.getByRole('button', { name: '确认' }).click();

      await expect(page.getByText('归档成功')).toBeVisible();
      await expect(page.getByTestId(`sidebar-session-${SESSION_KEY}`)).toHaveCount(0);

      await openSettingsHub(page);
      await page.getByTestId('settings-hub-menu-archives').click();
      await expect(page.getByTestId('session-archive-page')).toBeVisible();
      await expect(page.getByTestId(`session-archive-row-${SESSION_KEY}`)).toBeVisible();
      await expect(page.getByTestId(`session-archive-title-${SESSION_KEY}`)).toHaveText(SESSION_TITLE);

      await page.getByTestId('session-archive-search-input').fill('Archive target');
      await expect(page.getByTestId(`session-archive-row-${SESSION_KEY}`)).toBeVisible();

      await page.getByTestId(`session-archive-restore-${SESSION_KEY}`).click();
      await expect(page.getByText('取消归档成功')).toBeVisible();
      await expect(page.getByTestId('main-layout')).toBeVisible();
      await expect(page.getByTestId(`sidebar-session-${SESSION_KEY}`)).toBeVisible({ timeout: 60_000 });
    } finally {
      await closeElectronApp(app);
    }
  });
});
