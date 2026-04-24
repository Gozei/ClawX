import { closeElectronApp, completeSetup, expect, getStableWindow, openModelsFromSettings, test } from './fixtures/electron';

const SEEDED_ACCOUNT_ID = 'setup-default-model-siliconflow-e2e';
const SEEDED_FALLBACK_MODEL_ID = 'deepseek-ai/DeepSeek-V3';

async function seedLegacySetupStyleProvider(page: Parameters<typeof completeSetup>[0]): Promise<void> {
  await page.evaluate(async ({ accountId }) => {
    const now = new Date().toISOString();

    await window.electron.ipcRenderer.invoke('hostapi:fetch', {
      path: '/api/provider-accounts',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        account: {
          id: accountId,
          vendorId: 'siliconflow',
          label: 'SiliconFlow (CN)',
          authMode: 'api_key',
          baseUrl: 'https://api.siliconflow.cn/v1',
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
  }, {
    accountId: SEEDED_ACCOUNT_ID,
  });
}

test.describe('Setup provider persistence', () => {
  test('shows the saved default model in setup after saving a provider with a hidden model field', async ({ launchElectronApp }) => {
    const electronApp = await launchElectronApp({ setupStep: 'provider' });

    try {
      const page = await getStableWindow(electronApp);
      await expect(page.getByTestId('setup-page')).toBeVisible();

      await electronApp.evaluate(({ ipcMain }, fallbackModelId: string) => {
        const success = (json: unknown, status = 200) => ({
          ok: true,
          data: {
            status,
            ok: status >= 200 && status < 300,
            json,
          },
        });

        const vendor = {
          id: 'siliconflow',
          name: 'SiliconFlow (CN)',
          type: 'siliconflow',
          icon: '🌊',
          placeholder: 'sk-...',
          model: 'Multi-Model',
          requiresApiKey: true,
          category: 'compatible',
          supportedAuthModes: ['api_key'],
          defaultAuthMode: 'api_key',
          supportsMultipleAccounts: false,
          defaultBaseUrl: 'https://api.siliconflow.cn/v1',
          showModelId: true,
          showModelIdInDevModeOnly: true,
          modelIdPlaceholder: fallbackModelId,
          defaultModelId: fallbackModelId,
        };
        let savedAccount: Record<string, unknown> | null = null;
        let savedApiKey: string | null = null;
        let defaultAccountId: string | null = null;

        ipcMain.removeHandler('app:request');
        ipcMain.handle('app:request', async (_event, request: { module?: string; action?: string }) => {
          if (request?.module === 'provider' && request?.action === 'validateKey') {
            return {
              ok: true,
              data: { valid: true },
            };
          }

          return {
            ok: false,
            error: {
              message: 'APP_REQUEST_UNSUPPORTED:e2e-setup-provider',
            },
          };
        });

        ipcMain.removeHandler('hostapi:fetch');
        ipcMain.handle('hostapi:fetch', async (_event, request: { path?: string; method?: string; body?: string | null }) => {
          const method = request?.method ?? 'GET';
          const path = decodeURIComponent(request?.path ?? '');
          const parsedBody = typeof request?.body === 'string' && request.body.length > 0
            ? JSON.parse(request.body)
            : undefined;

          if (method === 'GET' && path === '/api/settings') {
            return success({});
          }

          if (method === 'GET' && path === '/api/provider-accounts') {
            return success(savedAccount ? [savedAccount] : []);
          }

          if (method === 'GET' && path === '/api/provider-account-statuses') {
            return success(
              savedAccount
                ? [{
                  id: savedAccount.id,
                  type: 'siliconflow',
                  name: savedAccount.label,
                  baseUrl: savedAccount.baseUrl,
                  model: savedAccount.model,
                  enabled: savedAccount.enabled,
                  createdAt: savedAccount.createdAt,
                  updatedAt: savedAccount.updatedAt,
                  hasKey: Boolean(savedApiKey),
                  keyMasked: savedApiKey ? 'sk-***' : null,
                }]
                : [],
            );
          }

          if (method === 'GET' && path === '/api/provider-vendors') {
            return success([vendor]);
          }

          if (method === 'GET' && path === '/api/provider-accounts/default') {
            return success({ accountId: defaultAccountId });
          }

          if (method === 'POST' && path === '/api/provider-accounts') {
            savedAccount = parsedBody?.account ?? null;
            savedApiKey = parsedBody?.apiKey ?? null;
            return success({ success: true });
          }

          if (method === 'PUT' && path === '/api/provider-accounts/default') {
            defaultAccountId = parsedBody?.accountId ?? null;
            return success({ success: true });
          }

          if (path.startsWith('/api/provider-accounts/') && path.endsWith('/api-key') && method === 'GET') {
            const accountId = path.slice('/api/provider-accounts/'.length, -'/api-key'.length);
            return {
              ok: true,
              data: {
                status: 200,
                ok: true,
                json: {
                  apiKey: savedAccount?.id === accountId ? savedApiKey : null,
                },
              },
            };
          }

          if (path.startsWith('/api/provider-accounts/') && method === 'GET') {
            const accountId = path.slice('/api/provider-accounts/'.length);
            return {
              ok: true,
              data: {
                status: 200,
                ok: true,
                json: savedAccount?.id === accountId ? savedAccount : null,
              },
            };
          }

          if (path.startsWith('/api/provider-accounts/') && method === 'PUT') {
            const accountId = path.slice('/api/provider-accounts/'.length);
            if (savedAccount?.id !== accountId) {
              return success({ success: false, error: 'Account not found' });
            }

            savedAccount = {
              ...savedAccount,
              ...(parsedBody?.updates ?? {}),
            };
            if (Object.prototype.hasOwnProperty.call(parsedBody ?? {}, 'apiKey')) {
              savedApiKey = parsedBody?.apiKey ?? null;
            }
            return success({ success: true });
          }

          return {
            ok: false,
            error: {
              message: `Unexpected hostapi:fetch request: ${method} ${path}`,
            },
          };
        });
      }, SEEDED_FALLBACK_MODEL_ID);

      await page.getByTestId('setup-provider-trigger').click({ force: true });
      await page.getByTestId('setup-provider-option-siliconflow').click({ force: true });
      await expect(page.getByTestId('setup-provider-saved-model')).toHaveCount(0);

      await page.getByTestId('setup-provider-api-key-input').fill('sk-e2e-placeholder');
      await expect(page.getByTestId('setup-provider-save-button')).toBeEnabled();
      await page.getByTestId('setup-provider-save-button').click();

      await expect(page.getByTestId('setup-provider-saved-model')).toBeVisible();
      await expect(page.getByTestId('setup-provider-saved-model-value')).toHaveText(SEEDED_FALLBACK_MODEL_ID);
    } finally {
      await closeElectronApp(electronApp);
    }
  });

  test('shows the vendor default model on the Models page for legacy setup records without an explicit model', async ({ page }) => {
    await completeSetup(page);
    await seedLegacySetupStyleProvider(page);

    await openModelsFromSettings(page);
    await expect(page.getByTestId('models-config-row')).toHaveCount(1);
    await expect(page.getByTestId('models-config-row').first()).toContainText(SEEDED_FALLBACK_MODEL_ID);
  });
});
