import { completeSetup, expect, openChannelsFromSettings, test } from './fixtures/electron';

const testConfigResponses = {
  channelsAccounts: {
    success: true,
    channels: [
      {
        channelType: 'feishu',
        defaultAccountId: 'default',
        status: 'connected',
        accounts: [
          {
            accountId: 'default',
            name: 'Primary Account',
            configured: true,
            status: 'connected',
            isDefault: true,
          },
        ],
      },
    ],
  },
  agents: {
    success: true,
    agents: [],
  },
  credentialsValidate: {
    success: true,
    valid: true,
    warnings: [],
  },
  channelConfig: {
    success: true,
  },
};

test.describe('Channels account ID validation', () => {
  test('rejects non-canonical custom account ID before save', async ({ electronApp, page }) => {
    await electronApp.evaluate(({ ipcMain }, responses) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).__clawxE2eChannelConfigSaveCount = 0;
      ipcMain.removeHandler('hostapi:fetch');
      ipcMain.handle('hostapi:fetch', async (_event, request: { path?: string; method?: string }) => {
        const method = request?.method ?? 'GET';
        const path = request?.path ?? '';

        if (path === '/api/channels/accounts' && method === 'GET') {
          return { ok: true, data: { status: 200, ok: true, json: responses.channelsAccounts } };
        }
        if (path === '/api/agents' && method === 'GET') {
          return { ok: true, data: { status: 200, ok: true, json: responses.agents } };
        }
        if (path === '/api/channels/credentials/validate' && method === 'POST') {
          return { ok: true, data: { status: 200, ok: true, json: responses.credentialsValidate } };
        }
        if (path === '/api/channels/config' && method === 'POST') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (globalThis as any).__clawxE2eChannelConfigSaveCount += 1;
          return { ok: true, data: { status: 200, ok: true, json: responses.channelConfig } };
        }
        if (path.startsWith('/api/channels/config/') && method === 'GET') {
          return { ok: true, data: { status: 200, ok: true, json: { success: true, values: {} } } };
        }
        return {
          ok: false,
          error: { message: `Unexpected hostapi:fetch request: ${method} ${path}` },
        };
      });
    }, testConfigResponses);

    await completeSetup(page);

    await openChannelsFromSettings(page);
    await expect(page.getByText('Feishu / Lark')).toBeVisible();

    const addAccountButton = page.locator('button').filter({
      hasText: /Add Account|添加账号|アカウントを追加|account\.add/i,
    }).first();
    await expect(addAccountButton).toBeVisible();
    await addAccountButton.click({ force: true });
    await expect(page.locator('#account-id')).toBeVisible();

    await page.locator('#account-id').fill('测试账号');
    await page.locator('#appId').fill('cli_test');
    await page.locator('#appSecret').fill('secret_test');

    const saveAndConnectButton = page.locator('button').filter({
      hasText: /Save & Connect|保存并连接|保存并重连|接続|更新并重连/i,
    }).last();
    await expect(saveAndConnectButton).toBeVisible();
    await saveAndConnectButton.click({ force: true });
    await expect(
      page.getByText(/account\.invalidCanonicalId|must use lowercase letters|仅支持小写字母、数字、连字符和下划线/i).first(),
    ).toBeVisible();

    const saveCalls = await electronApp.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const count = Number((globalThis as any).__clawxE2eChannelConfigSaveCount || 0);
      return { count };
    });
    expect(saveCalls.count).toBe(0);
  });
});
