import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:session-rename-test';
const SESSION_FILE = 'session-rename-test.jsonl';
const RENAMED_LABEL = '123456789012345678901234567890XYZ';
const TRUNCATED_LABEL = '123456789012345678901234567890';

async function seedSession(homeDir: string): Promise<void> {
  const sessionsDir = join(homeDir, '.openclaw', 'agents', 'main', 'sessions');
  await mkdir(sessionsDir, { recursive: true });
  await writeFile(
    join(sessionsDir, 'sessions.json'),
    JSON.stringify({
      sessions: [
        {
          key: SESSION_KEY,
          id: 'session-rename-test',
          file: SESSION_FILE,
          label: 'Original session name',
          updatedAt: Date.now(),
        },
      ],
    }, null, 2),
    'utf8',
  );
  await writeFile(
    join(sessionsDir, SESSION_FILE),
    `${JSON.stringify({
      role: 'user',
      content: 'seed message',
      timestamp: Math.floor(Date.now() / 1000),
    })}\n`,
    'utf8',
  );
}

test.describe('Session rename', () => {
  test('renames a sidebar session and persists the 30-character limit across relaunch', async ({ homeDir, launchElectronApp }) => {
    await seedSession(homeDir);

    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      const sessionRow = page.getByTestId(`sidebar-session-${SESSION_KEY}`);
      await expect(sessionRow).toBeVisible({ timeout: 60_000 });
      const sessionButton = sessionRow.locator('button').first();
      await expect(sessionButton).toHaveCSS('padding-top', '6px');
      await expect(sessionButton).toHaveCSS('padding-bottom', '6px');
      await sessionRow.hover();
      await page.getByTestId(`sidebar-session-menu-trigger-${SESSION_KEY}`).click();
      await expect(page.getByTestId(`sidebar-session-menu-rename-${SESSION_KEY}`)).toBeVisible();
      await page.getByTestId(`sidebar-session-menu-rename-${SESSION_KEY}`).click();

      const renameInput = page.getByTestId('sidebar-session-rename-input');
      await expect(renameInput).toBeVisible();
      await renameInput.fill(RENAMED_LABEL);
      await renameInput.press('Enter');

      await expect(page.getByText(TRUNCATED_LABEL, { exact: true })).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }

    const relaunchedApp = await launchElectronApp({ skipSetup: true });

    try {
      const relaunchedPage = await getStableWindow(relaunchedApp);
      await expect(relaunchedPage.getByTestId('main-layout')).toBeVisible();
      await expect(relaunchedPage.getByText(TRUNCATED_LABEL, { exact: true })).toBeVisible({ timeout: 60_000 });
    } finally {
      await closeElectronApp(relaunchedApp);
    }
  });
});
