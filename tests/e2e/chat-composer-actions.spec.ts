import { closeElectronApp, completeSetup, expect, getStableWindow, test } from './fixtures/electron';

const SEEDED_ACCOUNT_ID = 'chat-composer-openai-e2e';

async function ensureTheme(page: Awaited<ReturnType<typeof getStableWindow>>, theme: 'light' | 'dark') {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const className = await page.locator('html').getAttribute('class');
    if (className?.includes(theme)) return;
    await page.getByTestId('settings-hub-menu-theme').click();
  }
  await expect(page.locator('html')).toHaveClass(new RegExp(theme));
}

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
        apiKey: 'sk-test',
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
  test('renders the redesigned bottom action row', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await page.setViewportSize({ width: 1440, height: 900 });
      await expect(page.getByTestId('main-layout')).toBeVisible();

      await page.getByTestId('sidebar-new-chat').click();

      const composer = page.getByTestId('chat-composer');
      const contentColumn = page.getByTestId('chat-content-column');
      const scrollContainer = page.getByTestId('chat-scroll-container');
      const modelSwitch = composer.getByTestId('chat-model-switch');
      await expect(composer).toBeVisible();
      await expect(contentColumn).toBeVisible();
      await expect(scrollContainer).toBeVisible();
      await expect(composer.getByRole('textbox')).toBeVisible();
      await expect(composer.getByTestId('chat-attach-button')).toBeVisible();
      await expect(modelSwitch).toBeVisible();
      await expect(modelSwitch).toBeDisabled();
      await expect(composer.getByTestId('chat-send-button')).toBeVisible();
      const disclaimer = page.getByTestId('chat-composer-disclaimer');
      await expect(disclaimer).toHaveText(
        /(AI can make mistakes\. Please verify important information\.|AI也会犯错，请仔细核查信息)/,
      );
      await expect(disclaimer).toHaveCSS('color', 'rgb(0, 0, 0)');

      await expect(composer).toHaveClass(/rounded-\[20px\]/);
      await expect(page.getByTestId('chat-composer-shell')).toHaveCSS('padding-top', '0px');
      await expect(scrollContainer).toHaveCSS('padding-bottom', '32px');
      await expect(contentColumn).toHaveCSS('padding-left', '0px');
      await expect(contentColumn).toHaveCSS('padding-right', '0px');

      const [composerBox, contentColumnBox] = await Promise.all([
        composer.boundingBox(),
        contentColumn.boundingBox(),
      ]);
      expect(composerBox).not.toBeNull();
      expect(contentColumnBox).not.toBeNull();
      if (composerBox && contentColumnBox) {
        expect(Math.abs(composerBox.x - contentColumnBox.x)).toBeLessThan(1);
        expect(Math.abs(composerBox.width - contentColumnBox.width)).toBeLessThan(1);
      }
    } finally {
      await closeElectronApp(app);
    }
  });

  test('softens the dark chat background while keeping the composer slightly lighter', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      await page.getByTestId('sidebar-nav-settings').click();
      await expect(page.getByTestId('settings-hub-sheet-container')).toBeVisible();
      await ensureTheme(page, 'dark');
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('settings-hub-sheet-container')).toHaveCount(0);

      await page.getByTestId('sidebar-new-chat').click();
      await expect(page.locator('html')).toHaveClass(/dark/);

      const themeSnapshot = await page.evaluate(() => {
        const rootStyles = getComputedStyle(document.documentElement);
        const composer = document.querySelector('[data-testid="chat-composer"]');
        if (!(composer instanceof HTMLElement)) {
          throw new Error('chat composer not found');
        }

        return {
          backgroundVar: rootStyles.getPropertyValue('--background').trim(),
          composerBackgroundImage: getComputedStyle(composer).backgroundImage,
        };
      });

      expect(themeSnapshot.backgroundVar).toBe('220 22% 15%');
      expect(themeSnapshot.composerBackgroundImage).toContain('rgba(39, 48, 64, 0.96)');
      expect(themeSnapshot.composerBackgroundImage).toContain('rgba(34, 42, 56, 0.92)');
    } finally {
      await closeElectronApp(app);
    }
  });

  test.fixme('shows localized queued draft actions when offline', async ({ page }) => {
    await completeSetup(page);
    await seedConfiguredModels(page);
    await setLanguage(page, 'zh-CN');
    await page.reload();
    await expect(page.getByTestId('main-layout')).toBeVisible();

    await page.evaluate(async () => {
      try {
        await window.electron.ipcRenderer.invoke('gateway:stop');
      } catch {
        // ignore stop failures; the assertions below validate the final state
      }
    });

    await page.getByTestId('sidebar-new-chat').click();

    const composer = page.getByTestId('chat-composer');
    const messageInput = composer.getByRole('textbox');
    await expect(messageInput).toHaveAttribute('placeholder', /网关未连接\.\.\./);

    await messageInput.fill('offline localized queue test');
    await composer.getByTestId('chat-send-button').click();

    const queuedCard = page.getByTestId('chat-queued-message-card');
    await expect(queuedCard).toBeVisible();
    await expect(queuedCard).toContainText('草稿已加入待发送队列');
    await expect(queuedCard).toContainText('工作引擎恢复后会自动发送。你也可以先继续编辑，或者暂时移除这条草稿。');
    await expect(page.getByTestId('chat-queued-message-edit')).toHaveText('继续编辑');
    await expect(page.getByTestId('chat-queued-message-remove')).toHaveText('移除草稿');
    await expect(page.getByTestId('chat-queued-message-send-now')).toHaveText('立即发送');
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
        // ignore stop failures; the assertion below will validate the final state
      }
    });

    await page.getByTestId('sidebar-new-chat').click();

    const composer = page.getByTestId('chat-composer');
    const modelSwitch = composer.getByTestId('chat-model-switch');
    const messageInput = composer.getByRole('textbox');

    await expect(messageInput).toHaveAttribute('placeholder', /(Gateway not connected|网关未连接)\.\.\./);
    await expect(modelSwitch).toContainText('OpenAI / gpt-5.4', { timeout: 20_000 });
    await expect(modelSwitch).toBeEnabled();

    await modelSwitch.click();
    await page.getByRole('button', { name: 'OpenAI / gpt-5.4-mini' }).click();
    await expect(modelSwitch).toContainText('OpenAI / gpt-5.4-mini');

    await messageInput.fill('offline model switch queue test');
    await composer.getByTestId('chat-send-button').click();

    await expect(page.getByTestId('chat-queued-message-card')).toBeVisible();
    await expect(page.getByTestId('chat-queued-message-preview')).toContainText('offline model switch queue test');
    await expect(modelSwitch).toContainText('OpenAI / gpt-5.4-mini');
  });
});
