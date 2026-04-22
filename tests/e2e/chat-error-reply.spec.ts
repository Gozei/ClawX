import {
  closeElectronApp,
  closeSettingsHub,
  expect,
  getStableWindow,
  installIpcMocks,
  openSettingsHub,
  test,
} from './fixtures/electron';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

test.describe('Chat error reply', () => {
  test('keeps chat copy synced with the selected UI language', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      await openSettingsHub(page);
      await page.getByTestId('settings-hub-menu-language').click();
      await closeSettingsHub(page);

      await page.getByTestId('sidebar-new-chat').click();
      await expect(page.getByPlaceholder('Gateway not connected...')).toBeVisible();

      await openSettingsHub(page);
      await page.getByTestId('settings-hub-menu-language').click();
      await closeSettingsHub(page);

      await page.getByTestId('sidebar-new-chat').click();
      await expect(page.getByPlaceholder('网关未连接...')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });

  test('shows the restart-gateway reply when chat.send fails with pairing required', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, connectedAt: Date.now() },
        hostApi: {
          [stableStringify(['/api/gateway/status', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                state: 'running',
                port: 18789,
                pid: 12345,
                connectedAt: Date.now(),
              },
            },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                agents: [],
              },
            },
          },
        },
      });

      await app.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('gateway:rpc');
        ipcMain.handle('gateway:rpc', async (_event, method: string) => {
          if (method === 'sessions.list') {
            return { sessions: [] };
          }
          if (method === 'chat.history') {
            return { messages: [] };
          }
          if (method === 'chat.abort') {
            return { ok: true };
          }
          if (method === 'chat.send') {
            throw new Error('gateway closed (1008): pairing required');
          }
          return {};
        });
      });

      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      await openSettingsHub(page);
      await page.getByTestId('settings-hub-menu-language').click();
      await closeSettingsHub(page);

      await page.getByTestId('sidebar-new-chat').click();

      const composer = page.getByTestId('chat-composer');
      await expect(composer).toBeVisible();
      await expect(composer.getByPlaceholder('Send a message...')).toBeVisible();

      await composer.getByRole('textbox').fill('Is the PPT still generating?');
      await composer.getByTestId('chat-send-button').click();

      await expect(page.getByTestId('chat-assistant-error-message').last()).toHaveText(
        'Failed to send message: Gateway error. Please restart the gateway and try again.',
      );
    } finally {
      await closeElectronApp(app);
    }
  });
});
