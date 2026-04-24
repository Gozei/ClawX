import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closeElectronApp, closeSettingsHub, expect, getStableWindow, openSettingsHub, test } from './fixtures/electron';
import { resolveUserUploadStorageDirForBase } from '../../electron/utils/session-file-storage';

test.describe('Settings upload directory', () => {
  test('stores staged chat uploads inside the selected session directory', async ({ launchElectronApp, homeDir }) => {
    const selectedUploadDir = join(homeDir, 'custom-upload-root');
    const attachmentPath = join(homeDir, 'selected-attachment.txt');
    await mkdir(selectedUploadDir, { recursive: true });
    await writeFile(attachmentPath, 'custom upload directory e2e');

    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      await app.evaluate(({ ipcMain }, values) => {
        let dialogOpenCount = 0;
        ipcMain.removeHandler('dialog:open');
        ipcMain.handle('dialog:open', async () => {
          dialogOpenCount += 1;
          if (dialogOpenCount === 1) {
            return { canceled: false, filePaths: [values.uploadDir] };
          }
          if (dialogOpenCount === 2) {
            return { canceled: false, filePaths: [values.attachmentPath] };
          }
          return { canceled: true, filePaths: [] };
        });
      }, {
        uploadDir: selectedUploadDir,
        attachmentPath,
      });

      await openSettingsHub(page);
      await page.getByTestId('settings-hub-menu-settings').click({ force: true });
      await expect(page.getByTestId('settings-page')).toBeVisible();

      await page.getByTestId('settings-user-upload-dir-choose').click({ force: true });
      await expect(page.getByTestId('settings-user-upload-dir-input')).toHaveValue(selectedUploadDir);

      await closeSettingsHub(page);

      await page.getByTestId('sidebar-new-chat').click({ force: true });
      const composerShell = page.getByTestId('chat-composer-shell');
      await expect(composerShell).toBeVisible();

      const sessionKey = await composerShell.getAttribute('data-session-key');
      expect(sessionKey).toBeTruthy();

      await page.getByTestId('chat-attach-button').click({ force: true });
      await expect(composerShell).toContainText('selected-attachment.txt', { timeout: 20_000 });

      const expectedSessionDir = resolveUserUploadStorageDirForBase(selectedUploadDir, sessionKey);
      await expect.poll(async () => {
        try {
          const entries = await readdir(expectedSessionDir);
          if (entries.length !== 1) return '';
          return entries[0] || '';
        } catch {
          return '';
        }
      }, {
        timeout: 20_000,
      }).toBe('selected-attachment.txt');
    } finally {
      await closeElectronApp(app);
    }
  });
});
