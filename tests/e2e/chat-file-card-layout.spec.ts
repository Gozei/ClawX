import type { ElectronApplication } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  closeElectronApp,
  expect,
  getStableWindow,
  test,
} from './fixtures/electron';

const SESSION_KEY = 'agent:main:file-card-layout';

async function installGatewaySessionMocks(
  app: ElectronApplication,
  payload: {
    sessionKey: string;
    messages: Array<Record<string, unknown>>;
  },
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await app.evaluate(({ ipcMain }, { messages, sessionKey }) => {
        ipcMain.removeHandler('gateway:status');
        ipcMain.handle('gateway:status', async () => ({
          state: 'running',
          port: 18789,
          pid: 12345,
          connectedAt: Date.now(),
        }));

        ipcMain.removeHandler('gateway:rpc');
        ipcMain.handle('gateway:rpc', async (_event, method: string) => {
          if (method === 'sessions.list') {
            return {
              success: true,
              result: {
                sessions: [{
                  key: sessionKey,
                  id: `${sessionKey}-id`,
                  label: 'File Card Layout',
                  updatedAt: Date.now(),
                }],
              },
            };
          }

          if (method === 'chat.history') {
            return {
              success: true,
              result: { messages },
            };
          }

          if (method === 'chat.abort') {
            return {
              success: true,
              result: { ok: true },
            };
          }

          return {
            success: true,
            result: {},
          };
        });
      }, payload);
      return;
    } catch (error) {
      if (attempt === 2 || !String(error).includes('Execution context was destroyed')) {
        throw error;
      }
    }
  }
}

test.describe('Chat file card layout', () => {
  test('restores every numbered media attachment from history text with spaced paths', async ({ launchElectronApp, homeDir }) => {
    test.setTimeout(120_000);

    const sessionKey = 'agent:main:file-card-multi-history';
    const firstFileName = 'first multi attachment.txt';
    const secondFileName = 'second multi attachment.md';
    const firstPath = join(homeDir, firstFileName);
    const secondPath = join(homeDir, secondFileName);

    await Promise.all([
      writeFile(firstPath, 'first attachment', 'utf8'),
      writeFile(secondPath, '# second attachment\n', 'utf8'),
    ]);

    const app = await launchElectronApp({ skipSetup: true });
    const page = await getStableWindow(app);

    try {
      await installGatewaySessionMocks(app, {
        sessionKey,
        messages: [
          {
            id: 'user-file-multi-history',
            role: 'user',
            content: [
              `Please review these files.`,
              `[media attached 1/2: ${firstPath} (text/plain) | ${firstPath}]`,
              `[media attached 2/2: ${secondPath} (text/markdown) | ${secondPath}]`,
            ].join('\n'),
            timestamp: Math.floor(Date.now() / 1000),
          },
        ],
      });

      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });
      await app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows().at(-1);
        window?.webContents.send('gateway:status-changed', {
          state: 'running',
          port: 18789,
          pid: 12345,
          connectedAt: Date.now(),
        });
      });

      await page.getByTestId(`sidebar-session-${sessionKey}`).click({ force: true });

      const attachmentList = page.getByTestId('chat-user-attachments');
      await expect(attachmentList).toBeVisible({ timeout: 20_000 });
      await expect(attachmentList.getByTestId('chat-file-card')).toHaveCount(2);
      await expect(attachmentList).toContainText(firstFileName);
      await expect(attachmentList).toContainText(secondFileName);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('centers short file names without reserving a blank second row', async ({ launchElectronApp, homeDir }) => {
    test.setTimeout(120_000);

    const longCardFileName = 'preview-fixture-with-a-very-long-file-name-that-needs-two-lines-in-chat.md';
    const shortCardFileName = 'brief.md';
    const longPath = join(homeDir, 'long-card.md');
    const shortPath = join(homeDir, shortCardFileName);

    await Promise.all([
      writeFile(longPath, '# Long fixture\n', 'utf8'),
      writeFile(shortPath, '# Brief fixture\n', 'utf8'),
    ]);

    const app = await launchElectronApp({ skipSetup: true });
    const page = await getStableWindow(app);

    try {
      await installGatewaySessionMocks(app, {
        sessionKey: SESSION_KEY,
        messages: [
          {
            id: 'assistant-file-layout-intro',
            role: 'assistant',
            content: 'Open this session and verify the attachment card layout.',
            timestamp: Math.floor(Date.now() / 1000) - 10,
          },
          {
            id: 'user-file-layout-request',
            role: 'user',
            content: 'Please check how the file cards align in the session view.',
            timestamp: Math.floor(Date.now() / 1000),
            _attachedFiles: [
              {
                fileName: longCardFileName,
                mimeType: 'text/markdown',
                fileSize: 96,
                preview: null,
                filePath: longPath,
              },
              {
                fileName: shortCardFileName,
                mimeType: 'text/markdown',
                fileSize: 96,
                preview: null,
                filePath: shortPath,
              },
            ],
          },
        ],
      });

      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });
      await app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows().at(-1);
        window?.webContents.send('gateway:status-changed', {
          state: 'running',
          port: 18789,
          pid: 12345,
          connectedAt: Date.now(),
        });
      });

      await page.getByTestId(`sidebar-session-${SESSION_KEY}`).click({ force: true });

      const attachmentList = page.getByTestId('chat-user-attachments');
      await expect(attachmentList).toBeVisible({ timeout: 20_000 });

      const longCard = attachmentList.getByTestId('chat-file-card').nth(0);
      const shortCard = attachmentList.getByTestId('chat-file-card').nth(1);
      await expect(longCard).toBeVisible({ timeout: 20_000 });
      await expect(shortCard).toBeVisible({ timeout: 20_000 });

      await expect(longCard.getByTestId('chat-file-card-name-second-line')).not.toHaveText('');

      await expect(shortCard.getByTestId('chat-file-card-name')).toHaveAttribute('title', shortCardFileName);
      await expect(shortCard.getByTestId('chat-file-card-name-first-line')).toHaveText(shortCardFileName);
      await expect(shortCard.getByTestId('chat-file-card-name-meta')).toHaveText('96 B');
      await expect(shortCard.locator('[data-testid="chat-file-card-name-second-line"]')).toHaveCount(0);

      const shortBody = shortCard.getByTestId('chat-file-card-body');
      const shortFirstLine = shortCard.getByTestId('chat-file-card-name-first-line');
      const shortMeta = shortCard.getByTestId('chat-file-card-name-meta');
      const shortBodyBox = await shortBody.boundingBox();
      const shortFirstLineBox = await shortFirstLine.boundingBox();
      const shortMetaBox = await shortMeta.boundingBox();

      expect(shortBodyBox).not.toBeNull();
      expect(shortFirstLineBox).not.toBeNull();
      expect(shortMetaBox).not.toBeNull();

      const bodyCenterY = (shortBodyBox?.y ?? 0) + ((shortBodyBox?.height ?? 0) / 2);
      const textCenterY = (shortFirstLineBox?.y ?? 0) + ((shortFirstLineBox?.height ?? 0) / 2);
      const metaCenterY = (shortMetaBox?.y ?? 0) + ((shortMetaBox?.height ?? 0) / 2);

      expect(Math.abs(textCenterY - bodyCenterY)).toBeLessThanOrEqual(4);
      expect(Math.abs(metaCenterY - bodyCenterY)).toBeLessThanOrEqual(4);
    } finally {
      await closeElectronApp(app);
    }
  });
});
