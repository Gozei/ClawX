import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

async function seedOpenClawConfig(homeDir: string): Promise<void> {
  const configDir = join(homeDir, '.openclaw');
  await mkdir(configDir, { recursive: true });
  await writeFile(
    join(configDir, 'openclaw.json'),
    JSON.stringify({
      session: {
        mainKey: 'desk',
      },
      agents: {
        list: [
          {
            id: 'main',
            name: 'Main Role',
            default: true,
          },
          {
            id: 'research',
            name: 'Research Role',
          },
        ],
      },
    }, null, 2),
    'utf8',
  );
}

test.describe('Chat floating menus', () => {
  test('keeps the role picker above surrounding chat content', async ({ homeDir, launchElectronApp }) => {
    await seedOpenClawConfig(homeDir);

    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      await page.getByTestId('sidebar-new-chat').click();

      const rolePickerButton = page.getByTestId('chat-agent-picker-button');
      await expect(rolePickerButton).toBeVisible({ timeout: 60_000 });

      await rolePickerButton.click();
      await expect(page.getByTestId('chat-agent-picker-menu')).toBeVisible();

      const topmostIsRoleMenu = await page.evaluate(() => {
        const menu = document.querySelector('[data-testid="chat-agent-picker-menu"]');
        if (!(menu instanceof HTMLElement)) {
          return false;
        }

        const rect = menu.getBoundingClientRect();
        const x = rect.left + Math.min(rect.width / 2, Math.max(rect.width - 16, 16));
        const y = rect.top + Math.min(rect.height / 2, Math.max(rect.height - 16, 16));
        const topElement = document.elementFromPoint(x, y);

        return !!topElement?.closest('[data-testid="chat-agent-picker-menu"]');
      });

      expect(topmostIsRoleMenu).toBe(true);
    } finally {
      await closeElectronApp(app);
    }
  });
});
