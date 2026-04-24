import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closeElectronApp, closeSettingsHub, expect, getStableWindow, openSettingsHub, test } from './fixtures/electron';

async function findUploadFile(rootDir: string, fileName: string): Promise<string | null> {
  try {
    const entries = await readdir(rootDir, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = join(rootDir, entry.name);
      if (entry.isDirectory()) {
        const nested = await findUploadFile(entryPath, fileName);
        if (nested) return nested;
      } else if (entry.isFile() && entry.name === fileName) {
        return entryPath;
      }
    }
  } catch {
    return null;
  }

  return null;
}

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

      await page.getByTestId('settings-file-storage-dir-choose').click({ force: true });
      await expect(page.getByTestId('settings-file-storage-dir-input')).toHaveValue(selectedUploadDir);

      await closeSettingsHub(page);

      await page.getByTestId('sidebar-new-chat').click({ force: true });
      const composerShell = page.getByTestId('chat-composer-shell');
      await expect(composerShell).toBeVisible();

      const sessionKey = await composerShell.getAttribute('data-session-key');
      expect(sessionKey).toBeTruthy();

      await page.getByTestId('chat-attach-button').click({ force: true });
      await expect(composerShell).toContainText('selected-attachment.txt', { timeout: 20_000 });

      let uploadedPath: string | null = null;
      await expect.poll(async () => {
        uploadedPath = await findUploadFile(selectedUploadDir, 'selected-attachment.txt');
        return uploadedPath;
      }, {
        timeout: 20_000,
      }).not.toBeNull();

      const resolvedUploadedPath = uploadedPath as string;
      expect(resolvedUploadedPath).toContain(selectedUploadDir);
      expect(resolvedUploadedPath).toContain(`${join('uploads', 'selected-attachment.txt')}`);
    } finally {
      await closeElectronApp(app);
    }
  });
});
