import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closeElectronApp, completeSetup, expect, getStableWindow, openModelsFromSettings, test } from './fixtures/electron';

const SEEDED_ACCOUNT_ID = 'chat-composer-openai-e2e';

async function seedConfiguredModels(page: Parameters<typeof completeSetup>[0]): Promise<void> {
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
          label: 'OpenAI E2E',
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
        apiKey: 'sk-e2e-placeholder',
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

async function setLanguage(page: Parameters<typeof completeSetup>[0], language: string): Promise<void> {
  await page.evaluate(async (nextLanguage) => {
    await window.electron.ipcRenderer.invoke('settings:set', 'language', nextLanguage);
  }, language);
}

test.describe('Chat composer actions', () => {
  test('keeps the current draft text and attachment after navigating away and back', async ({ launchElectronApp, homeDir }) => {
    const attachmentPath = join(homeDir, 'composer-draft-persist.txt');
    await writeFile(attachmentPath, 'keep this attachment with the draft');

    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      await app.evaluate(({ ipcMain }, filePath) => {
        ipcMain.removeHandler('dialog:open');
        ipcMain.handle('dialog:open', async () => ({
          canceled: false,
          filePaths: [filePath],
        }));
      }, attachmentPath);

      await page.getByTestId('sidebar-new-chat').click();

      const composerShell = page.getByTestId('chat-composer-shell');
      const composer = page.getByTestId('chat-composer');
      const messageInput = composer.getByRole('textbox');
      await messageInput.fill('leave and come back draft');
      await expect(messageInput).toHaveValue('leave and come back draft');
      const draftSessionKey = await composerShell.getAttribute('data-session-key');
      expect(draftSessionKey).toBeTruthy();
      await composer.getByTestId('chat-attach-button').click();
      await expect(composerShell).toContainText('composer-draft-persist.txt', { timeout: 20_000 });
      const draftSessionRow = page.getByTestId(`sidebar-session-${draftSessionKey}`);
      await expect(draftSessionRow).toBeVisible();

      await openModelsFromSettings(page);
      await expect(page.getByTestId('models-page')).toBeVisible();

      await draftSessionRow.click();
      await expect(page.getByTestId('chat-composer')).toBeVisible();

      const restoredComposerShell = page.getByTestId('chat-composer-shell');
      const restoredComposer = page.getByTestId('chat-composer');
      await expect(restoredComposerShell).toHaveAttribute('data-session-key', draftSessionKey!);
      await expect(restoredComposerShell).toContainText('composer-draft-persist.txt');
      await expect(restoredComposer.getByRole('textbox')).toHaveValue('leave and come back draft');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('renders the redesigned bottom action row', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      await page.getByTestId('sidebar-new-chat').click({ force: true });

      const composer = page.getByTestId('chat-composer');
      const modelSwitch = composer.getByTestId('chat-model-switch');
      const sendButton = composer.getByTestId('chat-send-button');

      await expect(composer).toBeVisible();
      await expect(composer.getByRole('textbox')).toBeVisible();
      await expect(composer.getByTestId('chat-attach-button')).toBeVisible();
      await expect(modelSwitch).toBeVisible();
      await expect(modelSwitch).toBeDisabled();
      await expect(sendButton).toBeVisible();
      await expect(sendButton).toBeDisabled();
      await expect(page.getByTestId('chat-composer-disclaimer')).toHaveText(
        /(AI can make mistakes\. Please verify important information\.|AI也会犯错，请仔细核查信息)/,
      );
    } finally {
      await closeElectronApp(app);
    }
  });

  test('keeps model switching available while the gateway is disconnected', async ({ page }) => {
    await completeSetup(page);
    await seedConfiguredModels(page);
    await page.reload();
    await expect(page.getByTestId('main-layout')).toBeVisible();

    await page.evaluate(async () => {
      try {
        await window.electron.ipcRenderer.invoke('gateway:stop');
      } catch {
        // The final UI assertions verify the disconnected state.
      }
    });

    await page.getByTestId('sidebar-new-chat').click({ force: true });

    const composer = page.getByTestId('chat-composer');
    const modelSwitch = composer.getByTestId('chat-model-switch');
    const messageInput = composer.getByRole('textbox');

    await expect(messageInput).toHaveAttribute('placeholder', /(Gateway not connected|网关未连接)\.\.\./);
    await expect(modelSwitch).toContainText('OpenAI / gpt-5.4', { timeout: 20_000 });
    await expect(modelSwitch).toBeEnabled();

    await modelSwitch.click({ force: true });
    await page.getByRole('button', { name: 'OpenAI / gpt-5.4-mini' }).click({ force: true });
    await expect(modelSwitch).toContainText('OpenAI / gpt-5.4-mini');

    await messageInput.fill('offline model switch queue test');
    await composer.getByTestId('chat-send-button').click({ force: true });

    await expect(page.getByTestId('chat-queued-message-card')).toBeVisible();
    await expect(page.getByTestId('chat-queued-message-preview')).toContainText('offline model switch queue test');
    await expect(modelSwitch).toContainText('OpenAI / gpt-5.4-mini');
  });
});
