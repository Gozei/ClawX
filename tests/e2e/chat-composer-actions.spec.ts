import { closeElectronApp, completeSetup, expect, getStableWindow, test } from './fixtures/electron';

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

test.describe('Chat composer baseline', () => {
  test('shows only the core composer actions on a fresh workspace', async ({ launchElectronApp }) => {
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
