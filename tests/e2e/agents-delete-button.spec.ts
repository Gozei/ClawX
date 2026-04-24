import type { Locator, Page } from '@playwright/test';
import {
  closeElectronApp,
  expect,
  getStableWindow,
  test,
} from './fixtures/electron';

async function createAgent(page: Page, name: string): Promise<Locator> {
  await page.getByTestId('sidebar-nav-agents').click();
  await expect(page.getByTestId('agents-page')).toBeVisible();

  await page.getByTestId('agents-add-button').click();
  await expect(page.getByTestId('add-agent-dialog')).toBeVisible();
  await page.locator('#agent-name').fill(name);
  await page.getByTestId('add-agent-save-button').click();

  const card = page.getByTestId('agent-overview-card').filter({ hasText: name });
  await expect(card).toHaveCount(1);
  return card;
}

test.describe('Agents delete interaction', () => {
  test('can click the delete action on a non-default role card', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      const roleName = `Delete Target ${Date.now()}`;

      const card = await createAgent(page, roleName);
      await card.hover();

      const deleteButton = card.getByTestId('agent-delete-button');
      await expect(deleteButton).toBeVisible();
      await deleteButton.click();

      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button').nth(1).click();

      await expect(page.getByTestId('agent-overview-card').filter({ hasText: roleName })).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });
});
