import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  closeElectronApp,
  completeSetup,
  expect,
  getStableWindow,
  installIpcMocks,
  openModelsFromSettings,
  test,
} from './fixtures/electron';

const SEEDED_ACCOUNT_ID = 'chat-composer-openai-e2e';
const SEEDED_ACCOUNT = {
  id: SEEDED_ACCOUNT_ID,
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
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

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

  test('keeps model switching available while the gateway is disconnected', async ({ electronApp, page }) => {
    await completeSetup(page);
    await installIpcMocks(electronApp, {
      gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
      hostApi: {
        '["/api/agents","GET"]': hostJson({
          agents: [
            {
              id: 'main',
              name: 'Main',
              isDefault: true,
              modelDisplay: 'OpenAI / gpt-5.4',
              modelRef: 'openai/gpt-5.4',
              inheritedModel: false,
              workspace: '',
              agentDir: '',
              mainSessionKey: 'agent:main:main',
              channelTypes: [],
              skillIds: [],
              workflowSteps: [],
              triggerModes: [],
            },
          ],
          defaultAgentId: 'main',
          defaultModelRef: 'openai/gpt-5.4',
          configuredChannelTypes: [],
          channelOwners: {},
          channelAccountOwners: {},
        }),
        '["/api/gateway/status","GET"]': hostJson({ state: 'running', port: 18789, pid: 12345 }),
        '["/api/provider-accounts","GET"]': hostJson([SEEDED_ACCOUNT]),
        '["/api/provider-account-statuses","GET"]': hostJson([
          {
            id: SEEDED_ACCOUNT_ID,
            type: 'openai',
            name: 'OpenAI E2E',
            model: 'gpt-5.4',
            enabled: true,
            hasKey: true,
            createdAt: SEEDED_ACCOUNT.createdAt,
            updatedAt: SEEDED_ACCOUNT.updatedAt,
          },
        ]),
        '["/api/provider-vendors","GET"]': hostJson([]),
        '["/api/provider-accounts/default","GET"]': hostJson({ accountId: SEEDED_ACCOUNT_ID }),
        '["/api/sessions/catalog","GET"]': hostJson({ success: true, sessions: [], previews: {} }),
        '["/api/sessions/history","POST"]': hostJson({
          success: true,
          resolved: true,
          messages: [],
          thinkingLevel: null,
        }),
        '["/api/sessions/model","POST"]': hostJson({ success: true }),
      },
    });
    await page.reload();
    await expect(page.getByTestId('main-layout')).toBeVisible();

    const composerBeforeDisconnect = page.getByTestId('chat-composer');
    await expect(composerBeforeDisconnect.getByTestId('chat-model-switch')).toContainText(
      'OpenAI / gpt-5.4',
      { timeout: 20_000 },
    );

    await electronApp.evaluate(({ BrowserWindow, ipcMain }) => {
      ipcMain.removeHandler('gateway:status');
      ipcMain.handle('gateway:status', async () => ({ state: 'stopped', port: 18789 }));
      BrowserWindow.getAllWindows().at(-1)?.webContents.send('gateway:status-changed', {
        state: 'stopped',
        port: 18789,
      });
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

  test('blocks sending when the displayed model is no longer available', async ({ electronApp, page }) => {
    await completeSetup(page);
    await installIpcMocks(electronApp, {
      gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
      hostApi: {
        '["/api/agents","GET"]': hostJson({
          agents: [
            {
              id: 'main',
              name: 'Main',
              isDefault: true,
              modelDisplay: 'Stale / missing-model',
              modelRef: 'stale/missing-model',
              inheritedModel: false,
              workspace: '',
              agentDir: '',
              mainSessionKey: 'agent:main:main',
              channelTypes: [],
              skillIds: [],
              workflowSteps: [],
              triggerModes: [],
            },
          ],
          defaultAgentId: 'main',
          defaultModelRef: 'stale/missing-model',
          configuredChannelTypes: [],
          channelOwners: {},
          channelAccountOwners: {},
        }),
        '["/api/gateway/status","GET"]': hostJson({ state: 'running', port: 18789, pid: 12345 }),
        '["/api/provider-accounts","GET"]': hostJson([SEEDED_ACCOUNT]),
        '["/api/provider-account-statuses","GET"]': hostJson([
          {
            id: SEEDED_ACCOUNT_ID,
            type: 'openai',
            name: 'OpenAI E2E',
            model: 'gpt-5.4',
            enabled: true,
            hasKey: true,
            createdAt: SEEDED_ACCOUNT.createdAt,
            updatedAt: SEEDED_ACCOUNT.updatedAt,
          },
        ]),
        '["/api/provider-vendors","GET"]': hostJson([]),
        '["/api/provider-accounts/default","GET"]': hostJson({ accountId: SEEDED_ACCOUNT_ID }),
        '["/api/sessions/catalog","GET"]': hostJson({ success: true, sessions: [], previews: {} }),
        '["/api/sessions/history","POST"]': hostJson({
          success: true,
          resolved: true,
          messages: [],
          thinkingLevel: null,
        }),
        '["/api/sessions/model","POST"]': hostJson({ success: true }),
      },
    });
    await page.reload();
    await expect(page.getByTestId('main-layout')).toBeVisible();

    const composer = page.getByTestId('chat-composer');
    const modelSwitch = composer.getByTestId('chat-model-switch');
    await expect(modelSwitch).toContainText('stale/missing-model', { timeout: 20_000 });

    await composer.getByRole('textbox').fill('do not auto switch');
    await composer.getByTestId('chat-send-button').click({ force: true });

    await expect(page.getByText(
      /Current session model is unavailable\. Select an available model before sending\.|当前会话模型不可用，请在模型选择器中选择一个可用模型/,
    )).toBeVisible();
    await expect(modelSwitch).toContainText('stale/missing-model');
  });
});
