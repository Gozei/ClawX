import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:missing-attachment-e2e';
const SESSION_ID = 'missing-attachment-e2e';
const SESSION_FILE = `${SESSION_ID}.jsonl`;
const ATTACHMENT_NAME = 'missing-file.txt';

async function seedAttachmentSession(homeDir: string, attachmentPath: string): Promise<void> {
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
        label: 'Missing attachment',
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
              text: `Please review this file.\n[media attached: ${attachmentPath} (text/plain) | ${attachmentPath}]`,
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
              text: 'Attachment received.',
            },
          ],
        },
      }),
    ].join('\n'),
    'utf8',
  );
}

test.describe('Missing attachment feedback', () => {
  test('shows a toast when an attached file has already been deleted', async ({ launchElectronApp, homeDir }) => {
    const attachmentPath = join(homeDir, ATTACHMENT_NAME);
    await writeFile(attachmentPath, 'temporary attachment contents');
    await seedAttachmentSession(homeDir, attachmentPath);

    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      const sessionRow = page.getByTestId(`sidebar-session-${SESSION_KEY}`);
      await expect(sessionRow).toBeVisible({ timeout: 60_000 });
      await sessionRow.click();

      const fileCard = page.getByTestId('chat-user-attachments').getByTestId('chat-file-card').first();
      await expect(fileCard).toContainText(ATTACHMENT_NAME);

      await rm(attachmentPath, { force: true });
      await fileCard.click();

      await expect(page.getByText(/文件“missing-file\.txt”已被删除或找不到。|"missing-file\.txt" was deleted or could not be found\./)).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });
});
