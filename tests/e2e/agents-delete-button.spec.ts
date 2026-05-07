import type { Locator, Page } from '@playwright/test';
import {
  closeElectronApp,
  expect,
  getStableWindow,
  installIpcMocks,
  test,
} from './fixtures/electron';

function hostJson(json: unknown) {
  return {
    ok: true,
    data: {
      status: 200,
      ok: true,
      json,
    },
  };
}

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

async function confirmDeleteDialog(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog').last();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /删除并重启|Delete and Restart|删除|Delete/i }).click();
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

      await confirmDeleteDialog(page);

      await expect(page.getByTestId('agent-overview-card').filter({ hasText: roleName })).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('hides globally disabled skills from the agent skill assignment list', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789 },
        hostApi: {
          '["/api/agents","GET"]': hostJson({
            agents: [
              {
                id: 'main',
                name: 'Main',
                isDefault: true,
                modelDisplay: 'gpt-5',
                modelRef: 'openai/gpt-5',
                overrideModelRef: null,
                inheritedModel: true,
                workspace: '~/.openclaw/workspace',
                agentDir: '~/.openclaw/agents/main/agent',
                mainSessionKey: 'agent:main:main',
                channelTypes: [],
                skillIds: ['disabled-assigned'],
              },
            ],
            defaultAgentId: 'main',
            defaultModelRef: 'openai/gpt-5',
            configuredChannelTypes: [],
            channelOwners: {},
            channelAccountOwners: {},
          }),
          '["/api/channels/accounts","GET"]': hostJson({ success: true, channels: [] }),
          '["/api/gateway/status","GET"]': hostJson({ state: 'running', port: 18789 }),
          '["/api/provider-accounts","GET"]': hostJson([]),
          '["/api/provider-account-statuses","GET"]': hostJson([]),
          '["/api/provider-vendors","GET"]': hostJson([]),
          '["/api/provider-accounts/default","GET"]': hostJson({ accountId: null }),
          '["/api/skills","GET"]': hostJson([
            {
              id: 'disabled-unassigned',
              name: 'Disabled Unassigned',
              description: 'Unavailable globally',
              enabled: false,
              ready: true,
              version: '1.0.0',
            },
            {
              id: 'disabled-assigned',
              name: 'Disabled Assigned',
              description: 'Historical assignment',
              enabled: false,
              ready: true,
              version: '1.0.0',
            },
            {
              id: 'enabled-skill',
              name: 'Enabled Skill',
              description: 'Available globally',
              enabled: true,
              ready: true,
              version: '1.0.0',
            },
          ]),
        },
      });

      const page = await getStableWindow(app);
      await page.reload();
      await page.getByTestId('sidebar-nav-agents').click();
      await expect(page.getByTestId('agents-page')).toBeVisible();

      const card = page.getByTestId('agent-overview-card').filter({ hasText: 'Main' });
      await expect(card).toBeVisible();
      await card.getByTitle(/设置|Settings/).click();

      const dialog = page.getByTestId('agent-settings-dialog');
      await expect(dialog).toBeVisible();
      await dialog.getByRole('tab', { name: /技能|Skills/ }).click();

      await expect(page.getByTestId('agent-skill-search-input')).toBeVisible();
      await expect(page.getByTestId('agent-skill-list-item-enabled-skill')).toBeVisible();
      await expect(page.getByTestId('agent-skill-list-item-disabled-assigned')).toHaveCount(0);
      await expect(page.getByTestId('agent-skill-list-item-disabled-unassigned')).toHaveCount(0);

      const order = await page.locator('[data-testid^="agent-skill-list-item-"]').evaluateAll((items) =>
        items.map((item) => item.getAttribute('data-testid')),
      );
      expect(order).toEqual([
        'agent-skill-list-item-enabled-skill',
      ]);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('removes deleted role sessions from the sidebar history immediately', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await app.evaluate(({ ipcMain }) => {
        function asHostJson(json: unknown) {
          return {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json,
            },
          };
        }

        const state = {
          agents: [
            {
              id: 'main',
              name: 'Main',
              isDefault: true,
              modelDisplay: 'gpt-5',
              modelRef: 'openai/gpt-5',
              inheritedModel: true,
              workspace: '~/.openclaw/workspace',
              agentDir: '~/.openclaw/agents/main/agent',
              mainSessionKey: 'agent:main:main',
              channelTypes: [],
            },
            {
              id: 'role',
              name: 'Role To Delete',
              isDefault: false,
              modelDisplay: 'gpt-5-mini',
              modelRef: 'openai/gpt-5-mini',
              inheritedModel: false,
              workspace: '~/.openclaw/workspace-role',
              agentDir: '~/.openclaw/agents/role/agent',
              mainSessionKey: 'agent:role:main',
              channelTypes: [],
            },
          ],
          sessions: [
            {
              key: 'agent:role:main',
              label: 'Role Session',
              updatedAt: Date.now(),
            },
            {
              key: 'agent:main:main',
              label: 'Main Session',
              updatedAt: Date.now() - 1000,
            },
          ],
        };

        ipcMain.removeHandler('gateway:status');
        ipcMain.handle('gateway:status', async () => ({ state: 'running', port: 18789 }));

        ipcMain.removeHandler('hostapi:fetch');
        ipcMain.handle(
          'hostapi:fetch',
          async (_event, request: { path?: string; method?: string }) => {
            const method = request?.method ?? 'GET';
            const path = request?.path ?? '';

            if (method === 'GET' && path === '/api/agents') {
              return asHostJson({
                agents: state.agents,
                defaultAgentId: 'main',
                defaultModelRef: 'openai/gpt-5',
                configuredChannelTypes: [],
                channelOwners: {},
                channelAccountOwners: {},
              });
            }

            if (method === 'DELETE' && path === '/api/agents/role') {
              state.agents = state.agents.filter((agent) => agent.id !== 'role');
              state.sessions = state.sessions.filter((session) => !session.key.startsWith('agent:role:'));
              return asHostJson({
                agents: state.agents,
                defaultAgentId: 'main',
                defaultModelRef: 'openai/gpt-5',
                configuredChannelTypes: [],
                channelOwners: {},
                channelAccountOwners: {},
              });
            }

            if (method === 'GET' && path === '/api/sessions/catalog') {
              return asHostJson({
                success: true,
                sessions: state.sessions,
                previews: {},
              });
            }

            if (method === 'POST' && path === '/api/sessions/history') {
              return asHostJson({
                success: true,
                resolved: true,
                messages: [],
                thinkingLevel: null,
              });
            }

            if (method === 'GET' && path === '/api/gateway/status') {
              return asHostJson({ state: 'running', port: 18789 });
            }

            if (method === 'GET' && path === '/api/channels/accounts') {
              return asHostJson({ success: true, channels: [] });
            }

            if (method === 'GET' && path === '/api/provider-accounts') {
              return asHostJson([]);
            }

            if (method === 'GET' && path === '/api/provider-account-statuses') {
              return asHostJson([]);
            }

            if (method === 'GET' && path === '/api/provider-vendors') {
              return asHostJson([]);
            }

            if (method === 'GET' && path === '/api/provider-accounts/default') {
              return asHostJson({ accountId: null });
            }

            return {
              ok: false,
              error: {
                message: `Unexpected hostapi:fetch request: ${method} ${path}`,
              },
            };
          },
        );
      });

      const page = await getStableWindow(app);
      await page.reload();

      await expect(page.getByText('Role Session')).toBeVisible();
      await page.getByTestId('sidebar-nav-agents').click();
      await expect(page.getByTestId('agents-page')).toBeVisible();

      const card = page.getByTestId('agent-overview-card').filter({ hasText: 'Role To Delete' });
      await expect(card).toHaveCount(1);
      await card.hover();
      await card.getByTestId('agent-delete-button').click();

      await confirmDeleteDialog(page);

      await expect(page.getByTestId('agent-overview-card').filter({ hasText: 'Role To Delete' })).toHaveCount(0);
      await expect(page.getByText('Role Session')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });
});
