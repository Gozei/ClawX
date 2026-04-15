import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

const SESSION_A_KEY = 'agent:main:sidebar-role-alignment-a';
const SESSION_B_KEY = 'agent:main:sidebar-role-alignment-b';
const LONG_ROLE_LABEL = 'Operations Specialist Team';

async function seedSessions(homeDir: string): Promise<void> {
  const sessionsDir = join(homeDir, '.openclaw', 'agents', 'main', 'sessions');
  await mkdir(sessionsDir, { recursive: true });
  await writeFile(
    join(sessionsDir, 'sessions.json'),
    JSON.stringify({
      sessions: [
        {
          key: SESSION_A_KEY,
          id: 'sidebar-role-alignment-a',
          file: 'sidebar-role-alignment-a.jsonl',
          label: 'Aligned title A',
          updatedAt: Date.now(),
        },
        {
          key: SESSION_B_KEY,
          id: 'sidebar-role-alignment-b',
          file: 'sidebar-role-alignment-b.jsonl',
          label: 'Aligned title B',
          updatedAt: Date.now() - 1_000,
        },
      ],
    }, null, 2),
    'utf8',
  );

  for (const [fileName, content] of [
    ['sidebar-role-alignment-a.jsonl', 'alignment seed A'],
    ['sidebar-role-alignment-b.jsonl', 'alignment seed B'],
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

test.describe('Sidebar session role alignment', () => {
  test.describe.configure({ timeout: 180_000 });

  // TODO: Re-enable once seeded sidebar session hydration is stable in Electron E2E on Windows.
  test.fixme('keeps session titles aligned when a role badge becomes longer', async ({ homeDir, launchElectronApp }) => {
    await seedSessions(homeDir);

    const app = await launchElectronApp({ skipSetup: true });

    try {
      let page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      const ensureGatewayConnected = async (): Promise<void> => {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          if (page.isClosed()) {
            page = await getStableWindow(app);
          }
          try {
            const startResult = await page.evaluate(async () => (
              await window.electron.ipcRenderer.invoke('gateway:start')
            ) as { success?: boolean; error?: string });
            expect(startResult?.success, startResult?.error || 'gateway:start failed during E2E setup').toBe(true);
            page = await getStableWindow(app);
            await expect(page.getByTestId('main-layout')).toBeVisible();
            return;
          } catch (error) {
            if (attempt === 1) {
              throw error;
            }
            page = await getStableWindow(app);
          }
        }
      };

      let rowA = page.getByTestId(`sidebar-session-${SESSION_A_KEY}`);
      let rowB = page.getByTestId(`sidebar-session-${SESSION_B_KEY}`);
      if (await rowA.count() === 0 || await rowB.count() === 0) {
        await ensureGatewayConnected();
        rowA = page.getByTestId(`sidebar-session-${SESSION_A_KEY}`);
        rowB = page.getByTestId(`sidebar-session-${SESSION_B_KEY}`);
      }

      await expect(rowA).toBeVisible({ timeout: 60_000 });
      await expect(rowB).toBeVisible({ timeout: 60_000 });

      const roleA = page.getByTestId(`sidebar-session-role-${SESSION_A_KEY}`);
      const roleB = page.getByTestId(`sidebar-session-role-${SESSION_B_KEY}`);
      const titleA = page.getByTestId(`sidebar-session-title-${SESSION_A_KEY}`);
      const titleB = page.getByTestId(`sidebar-session-title-${SESSION_B_KEY}`);

      await expect(roleA).toHaveCSS('width', '63px');
      await expect(roleB).toHaveCSS('width', '63px');

      await page.evaluate(({ sessionKey, roleLabel }) => {
        const role = document.querySelector<HTMLElement>(`[data-testid="sidebar-session-role-${sessionKey}"]`);
        if (!role) return;
        role.title = roleLabel;
        const inner = role.querySelector<HTMLElement>('span');
        if (inner) {
          inner.textContent = roleLabel;
        } else {
          role.textContent = roleLabel;
        }
      }, { sessionKey: SESSION_B_KEY, roleLabel: LONG_ROLE_LABEL });

      await expect(roleB).toHaveCSS('width', '63px');

      const [titleABox, titleBBox] = await Promise.all([
        titleA.boundingBox(),
        titleB.boundingBox(),
      ]);

      expect(titleABox).not.toBeNull();
      expect(titleBBox).not.toBeNull();
      if (titleABox && titleBBox) {
        expect(Math.abs(titleABox.x - titleBBox.x)).toBeLessThan(2);
      }
    } finally {
      await closeElectronApp(app);
    }
  });

  // TODO: Re-enable once seeded sidebar session hydration is stable in Electron E2E on Windows.
  test.fixme('keeps multiple running indicators visible until hover reveals session actions', async () => {
    // Placeholder for the sidebar multi-session action-area regression coverage.
  });

  // TODO: Re-enable once seeded sidebar session hydration is stable in Electron E2E on Windows.
  test.fixme('shows the gateway restart hint with an elapsed timer above new chat while the gateway is starting', async () => {
    // Placeholder for the sidebar gateway restart hint + elapsed timer regression coverage.
  });
});
