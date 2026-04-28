import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

const SESSION_A_KEY = 'agent:main:session-pin-a';
const SESSION_B_KEY = 'agent:main:session-pin-b';
const SESSION_C_KEY = 'agent:main:session-pin-c';

async function seedSessions(homeDir: string): Promise<void> {
  const sessionsDir = join(homeDir, '.openclaw', 'agents', 'main', 'sessions');
  await mkdir(sessionsDir, { recursive: true });
  await writeFile(
    join(sessionsDir, 'sessions.json'),
    JSON.stringify({
      sessions: [
        {
          key: SESSION_A_KEY,
          id: 'session-pin-a',
          file: 'session-pin-a.jsonl',
          label: 'Alpha session',
          updatedAt: Date.now() - 3_000,
        },
        {
          key: SESSION_B_KEY,
          id: 'session-pin-b',
          file: 'session-pin-b.jsonl',
          label: 'Bravo session',
          updatedAt: Date.now() - 2_000,
        },
        {
          key: SESSION_C_KEY,
          id: 'session-pin-c',
          file: 'session-pin-c.jsonl',
          label: 'Charlie session',
          updatedAt: Date.now() - 1_000,
        },
      ],
    }, null, 2),
    'utf8',
  );

  for (const [fileName, content] of [
    ['session-pin-a.jsonl', 'alpha seed'],
    ['session-pin-b.jsonl', 'bravo seed'],
    ['session-pin-c.jsonl', 'charlie seed'],
  ] as const) {
    await writeFile(
      join(sessionsDir, fileName),
      `${JSON.stringify({
        role: 'user',
        content,
        timestamp: Math.floor(Date.now() / 1000),
      })}\n`,
      'utf8',
    );
  }
}

test.describe('Session pin', () => {
  test('pins, orders, unpins, and persists sidebar sessions', async ({ homeDir, launchElectronApp }) => {
    await seedSessions(homeDir);

    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      const alphaRow = page.getByTestId(`sidebar-session-${SESSION_A_KEY}`);
      const alphaButton = page.getByTestId(`sidebar-session-button-${SESSION_A_KEY}`);
      const bravoRow = page.getByTestId(`sidebar-session-${SESSION_B_KEY}`);
      const bravoButton = page.getByTestId(`sidebar-session-button-${SESSION_B_KEY}`);
      await expect(alphaRow).toBeVisible({ timeout: 60_000 });
      await expect(bravoRow).toBeVisible({ timeout: 60_000 });
      const idleTransitionProperty = await alphaButton.evaluate((node) => getComputedStyle(node).transitionProperty);
      expect(idleTransitionProperty).not.toBe('all');
      expect(idleTransitionProperty).not.toContain('padding');
      await page.mouse.move(8, 8);
      await expect(alphaButton).toHaveCSS('padding-right', '12px');
      await alphaRow.hover();
      await expect(alphaButton).toHaveCSS('padding-right', '40px');
      await page.mouse.move(8, 8);
      await expect(alphaButton).toHaveCSS('padding-right', '12px');

      await bravoRow.hover();
      await page.getByTestId(`sidebar-session-menu-trigger-${SESSION_B_KEY}`).click();
      await expect(page.getByTestId(`sidebar-session-menu-panel-${SESSION_B_KEY}`)).toBeVisible();
      const topmostIsSidebarMenu = await page.evaluate((sessionKey) => {
        const menu = document.querySelector(`[data-testid="sidebar-session-menu-panel-${sessionKey}"]`);
        if (!(menu instanceof HTMLElement)) {
          return false;
        }

        const rect = menu.getBoundingClientRect();
        const x = rect.left + Math.min(rect.width / 2, Math.max(rect.width - 16, 16));
        const y = rect.top + Math.min(rect.height / 2, Math.max(rect.height - 16, 16));
        const topElement = document.elementFromPoint(x, y);

        return !!topElement?.closest(`[data-testid="sidebar-session-menu-panel-${sessionKey}"]`);
      }, SESSION_B_KEY);
      expect(topmostIsSidebarMenu).toBe(true);
      await expect(page.getByTestId(`sidebar-session-menu-pin-${SESSION_B_KEY}`)).toBeVisible();
      await page.getByTestId(`sidebar-session-menu-pin-${SESSION_B_KEY}`).click();

      const charlieRow = page.getByTestId(`sidebar-session-${SESSION_C_KEY}`);
      await charlieRow.hover();
      await page.getByTestId(`sidebar-session-menu-trigger-${SESSION_C_KEY}`).click();
      await expect(page.getByTestId(`sidebar-session-menu-pin-${SESSION_C_KEY}`)).toBeVisible();
      await page.getByTestId(`sidebar-session-menu-pin-${SESSION_C_KEY}`).click();

      const pinnedSection = page.getByTestId('sidebar-pinned-sessions');
      await expect(pinnedSection.getByText('Bravo session', { exact: true })).toBeVisible();
      await expect(pinnedSection.getByText('Charlie session', { exact: true })).toBeVisible();
      await expect(page.getByTestId(`sidebar-session-pin-indicator-${SESSION_B_KEY}`)).toBeVisible();
      await expect(page.getByTestId(`sidebar-session-pin-indicator-${SESSION_C_KEY}`)).toBeVisible();
      await expect(bravoButton).toHaveCSS('padding-right', '40px');

      await bravoRow.hover();
      await expect(page.getByTestId(`sidebar-session-menu-trigger-${SESSION_B_KEY}`)).toBeVisible();

      const pinnedLabels = await pinnedSection.locator('[data-testid^="sidebar-session-title-"]').evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('title')).filter(Boolean),
      );
      expect(pinnedLabels.slice(0, 2)).toEqual(['Bravo session', 'Charlie session']);

      await bravoRow.hover();
      await page.getByTestId(`sidebar-session-menu-trigger-${SESSION_B_KEY}`).click();
      await expect(page.getByTestId(`sidebar-session-menu-pin-${SESSION_B_KEY}`)).toBeVisible();
      await page.getByTestId(`sidebar-session-menu-pin-${SESSION_B_KEY}`).click();
      await expect(pinnedSection.getByText('Bravo session', { exact: true })).toHaveCount(0);
      await expect(pinnedSection.getByText('Charlie session', { exact: true })).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }

    const relaunchedApp = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(relaunchedApp);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      const pinnedSection = page.getByTestId('sidebar-pinned-sessions');
      await expect(pinnedSection).toBeVisible({ timeout: 60_000 });
      await expect(pinnedSection.getByText('Charlie session', { exact: true })).toBeVisible({ timeout: 60_000 });
      await expect(pinnedSection.getByText('Bravo session', { exact: true })).toHaveCount(0);
      await expect(page.getByTestId(`sidebar-session-pin-indicator-${SESSION_C_KEY}`)).toBeVisible();
    } finally {
      await closeElectronApp(relaunchedApp);
    }
  });
});
