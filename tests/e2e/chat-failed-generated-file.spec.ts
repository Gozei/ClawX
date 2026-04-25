import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:failed-generated-file-e2e';
const SESSION_ID = 'failed-generated-file-e2e';
const SESSION_FILE = `${SESSION_ID}.jsonl`;
const OUTPUT_FILE_NAME = 'failed-output.txt';

async function seedFailedGeneratedFileSession(homeDir: string, failedPath: string): Promise<void> {
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
        label: 'Failed generated file',
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
              text: 'Please generate a file.',
            },
          ],
        },
      }),
      JSON.stringify({
        type: 'message',
        id: 'assistant-tool-1',
        timestamp: new Date(Date.now() + 500).toISOString(),
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'write-1',
              name: 'write_file',
              input: { file_path: failedPath },
            },
          ],
        },
      }),
      JSON.stringify({
        type: 'message',
        id: 'tool-result-1',
        timestamp: new Date(Date.now() + 750).toISOString(),
        message: {
          role: 'toolresult',
          toolCallId: 'write-1',
          toolName: 'write_file',
          status: 'error',
          content: [
            {
              type: 'text',
              text: `Failed to write ${failedPath}: directory does not exist.`,
            },
          ],
        },
      }),
      JSON.stringify({
        type: 'message',
        id: 'assistant-final-1',
        timestamp: new Date(Date.now() + 1000).toISOString(),
        message: {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: 'The file could not be created.',
            },
          ],
        },
      }),
    ].join('\n'),
    'utf8',
  );
}

test.describe('Failed generated files', () => {
  test('does not show a file card when a generation tool result failed', async ({ launchElectronApp, homeDir }) => {
    const failedPath = join(homeDir, 'missing-output-dir', OUTPUT_FILE_NAME);
    await seedFailedGeneratedFileSession(homeDir, failedPath);

    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      const sessionRow = page.getByTestId(`sidebar-session-${SESSION_KEY}`);
      await expect(sessionRow).toBeVisible({ timeout: 60_000 });
      await sessionRow.click();

      await expect(page.getByText('The file could not be created.')).toBeVisible();
      await expect(page.getByTestId('chat-assistant-attachments')).toHaveCount(0);
      await expect(page.getByTestId('chat-file-card').filter({ hasText: OUTPUT_FILE_NAME })).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });
});
