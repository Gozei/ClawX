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

  test('shows agent skill assignment list with global disabled state', async ({ launchElectronApp }) => {
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
      await expect(page.getByTestId('agent-skill-list-item-disabled-assigned')).toContainText(/全局禁用|Globally disabled/);
      await expect(page.getByTestId('agent-skill-list-item-disabled-assigned')).toContainText(/已分配|Assigned/);
      await expect(page.getByTestId('agent-skill-list-item-disabled-unassigned').getByRole('switch')).toBeDisabled();

      const order = await page.locator('[data-testid^="agent-skill-list-item-"]').evaluateAll((items) =>
        items.map((item) => item.getAttribute('data-testid')),
      );
      expect(order).toEqual([
        'agent-skill-list-item-enabled-skill',
        'agent-skill-list-item-disabled-assigned',
        'agent-skill-list-item-disabled-unassigned',
      ]);
    } finally {
      await closeElectronApp(app);
    }
  });
});
