import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closeElectronApp, closeSettingsHub, expect, getStableWindow, openSettingsHub, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:model-output-e2e';
const SESSION_ID = 'model-output-e2e';
const SESSION_FILE = `${SESSION_ID}.jsonl`;
const OUTPUT_FILE_NAME = '模型结果.txt';

async function seedAssistantOutputSession(homeDir: string, sourcePath: string): Promise<void> {
  const sessionsDir = join(homeDir, '.openclaw', 'agents', 'main', 'sessions');
  const timestamp = new Date().toISOString();

  await mkdir(sessionsDir, { recursive: true });
  await writeFile(
    join(sessionsDir, 'sessions.json'),
    JSON.stringify({
      [SESSION_KEY]: {
        sessionId: SESSION_ID,
        id: SESSION_ID,
        file: SESSION_FILE,
        updatedAt: Date.now(),
        label: 'Model output session',
      },
    }, null, 2),
    'utf8',
  );

  await writeFile(
    join(sessionsDir, SESSION_FILE),
    [
      JSON.stringify({
        type: 'session',
        id: SESSION_ID,
        timestamp,
        cwd: homeDir,
      }),
      JSON.stringify({
        type: 'message',
        id: 'user-1',
        timestamp,
        message: {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Please generate a report file.',
            },
          ],
        },
      }),
      JSON.stringify({
        type: 'message',
        id: 'assistant-1',
        timestamp: new Date(Date.now() + 1000).toISOString(),
        message: {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: `I created the report at ${sourcePath}.`,
            },
          ],
        },
      }),
    ].join('\n'),
    'utf8',
  );
}

async function findOutputFile(rootDir: string, fileName: string): Promise<string | null> {
  try {
    const entries = await readdir(rootDir, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = join(rootDir, entry.name);
      if (entry.isDirectory()) {
        const nested = await findOutputFile(entryPath, fileName);
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

test.describe('Settings output directory', () => {
  test('copies assistant output files into the selected session directory', async ({ launchElectronApp, homeDir }) => {
    const selectedOutputDir = join(homeDir, 'custom-output-root');
    const workspaceOutputDir = join(homeDir, 'workspace-output');
    const sourcePath = join(workspaceOutputDir, OUTPUT_FILE_NAME);
    await mkdir(selectedOutputDir, { recursive: true });
    await mkdir(workspaceOutputDir, { recursive: true });
    await writeFile(sourcePath, 'assistant output directory e2e', 'utf8');
    await seedAssistantOutputSession(homeDir, sourcePath);

    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      await app.evaluate(({ ipcMain }, values) => {
        ipcMain.removeHandler('dialog:open');
        ipcMain.handle('dialog:open', async () => ({
          canceled: false,
          filePaths: [values.outputDir],
        }));
      }, {
        outputDir: selectedOutputDir,
      });

      await openSettingsHub(page);
      await page.getByTestId('settings-hub-menu-settings').click({ force: true });
      await expect(page.getByTestId('settings-page')).toBeVisible();

      await page.getByTestId('settings-file-storage-dir-choose').click({ force: true });
      await expect(page.getByTestId('settings-file-storage-dir-input')).toHaveValue(selectedOutputDir);

      await closeSettingsHub(page);

      const sessionRow = page.getByTestId(`sidebar-session-${SESSION_KEY}`);
      await expect(sessionRow).toBeVisible({ timeout: 60_000 });
      await sessionRow.click();

      let materializedPath: string | null = null;
      await expect.poll(async () => {
        materializedPath = await findOutputFile(selectedOutputDir, OUTPUT_FILE_NAME);
        return materializedPath;
      }, {
        timeout: 20_000,
      }).not.toBeNull();

      const resolvedMaterializedPath = materializedPath as string;
      expect(resolvedMaterializedPath).toContain(selectedOutputDir);
      expect(resolvedMaterializedPath).toContain(`${join('main', '')}`);
      expect(resolvedMaterializedPath).toContain(`${join('outputs', OUTPUT_FILE_NAME)}`);

      await expect(page.getByTestId('chat-assistant-attachments').getByTestId('chat-file-card')).toContainText(OUTPUT_FILE_NAME);
    } finally {
      await closeElectronApp(app);
    }
  });
});
