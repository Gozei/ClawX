import { closeElectronApp, expect, getStableWindow, openSettingsHub, test } from './fixtures/electron';

test.describe('Dashboard layout', () => {
  test('keeps summary and task detail cards the same width on wide screens', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await app.evaluate(({ BrowserWindow }) => {
        const mainWindow = BrowserWindow.getAllWindows()[0];
        mainWindow?.setSize(1440, 960);
      });

      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();
      await expect.poll(async () => await page.evaluate(() => window.innerWidth)).toBeGreaterThanOrEqual(1280);

      await openSettingsHub(page);
      await page.getByTestId('settings-hub-menu-dashboard').click();
      await expect(page.getByTestId('dashboard-page')).toBeVisible();

      const summaryCard = page.getByTestId('dashboard-summary-card');
      const taskListCard = page.getByTestId('dashboard-task-list-card');

      await expect(summaryCard).toBeVisible();
      await expect(taskListCard).toBeVisible();

      const summaryBox = await summaryCard.boundingBox();
      const taskListBox = await taskListCard.boundingBox();

      expect(summaryBox).not.toBeNull();
      expect(taskListBox).not.toBeNull();

      if (summaryBox && taskListBox) {
        expect(Math.abs(summaryBox.width - taskListBox.width)).toBeLessThanOrEqual(2);
        expect(Math.abs(summaryBox.y - taskListBox.y)).toBeLessThanOrEqual(2);
      }
    } finally {
      await closeElectronApp(app);
    }
  });
});
