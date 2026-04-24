import { closeElectronApp, expect, getStableWindow, openSettingsHub, test } from './fixtures/electron';

const SEEDED_ACCOUNT_ID = 'dashboard-model-count-openai-e2e';

async function seedConfiguredModels(page: Parameters<typeof getStableWindow>[0]): Promise<void> {
  await page.evaluate(async ({ accountId }) => {
    const now = new Date().toISOString();
    await window.electron.ipcRenderer.invoke('hostapi:fetch', {
      path: '/api/provider-accounts',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        account: {
          id: accountId,
          vendorId: 'openai',
          label: 'OpenAI Dashboard E2E',
          authMode: 'api_key',
          baseUrl: 'https://api.openai.com/v1',
          apiProtocol: 'openai-completions',
          model: 'gpt-5.4',
          metadata: {
            customModels: ['gpt-5.4-mini'],
            modelProtocols: {
              'gpt-5.4': 'openai-completions',
              'gpt-5.4-mini': 'openai-completions',
            },
          },
          enabled: true,
          isDefault: false,
          createdAt: now,
          updatedAt: now,
        },
        apiKey: 'sk-dashboard-e2e',
      }),
    });

    await window.electron.ipcRenderer.invoke('hostapi:fetch', {
      path: '/api/provider-accounts/default',
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId }),
    });
  }, { accountId: SEEDED_ACCOUNT_ID });
}

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

  test('keeps Dashboard model stats aligned with the Models page count', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();
      await seedConfiguredModels(page);

      await openSettingsHub(page);
      await page.getByTestId('settings-hub-menu-dashboard').click();
      await expect(page.getByTestId('dashboard-page')).toBeVisible();
      await expect(page.getByTestId('dashboard-models-card-value')).toHaveText('2');

      await openSettingsHub(page);
      await page.getByTestId('settings-hub-menu-models').click();
      await expect(page.getByTestId('models-page')).toBeVisible();
      await expect(page.getByTestId('models-config-row')).toHaveCount(2);
    } finally {
      await closeElectronApp(app);
    }
  });
});
