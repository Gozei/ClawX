import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

const SEEDED_SESSION_KEY = 'agent:main:user-metadata-hidden-test';
const SEEDED_SESSION_FILE = 'user-metadata-hidden-test.jsonl';
const SEEDED_SESSION_LABEL = 'User metadata hidden session';
const SEEDED_USER_PROMPT = 'What can you do?';

async function seedSession(homeDir: string): Promise<void> {
  const sessionsDir = join(homeDir, '.openclaw', 'agents', 'main', 'sessions');
  const seededMessages = [
    {
      id: 'user-metadata-1',
      role: 'user',
      content: [
        'Conversation info (untrusted metadata): ```json',
        '{"agent":{"id":"ops","name":"Operations","preferredModel":"custom-custombc/gpt-5.4"}}',
        '```',
        'Execution playbook:',
        '- You are currently acting as the Operations agent.',
        '- Preferred model: custom-custombc/gpt-5.4',
        '- If tools are unavailable, explain the block instead of fabricating.',
        '',
        SEEDED_USER_PROMPT,
      ].join('\n'),
      timestamp: Math.floor(Date.now() / 1000) - 2,
    },
  ];

  await mkdir(sessionsDir, { recursive: true });
  await writeFile(
    join(sessionsDir, 'sessions.json'),
    JSON.stringify({
      sessions: [
        {
          key: SEEDED_SESSION_KEY,
          id: 'user-metadata-hidden-test',
          file: SEEDED_SESSION_FILE,
          label: SEEDED_SESSION_LABEL,
          updatedAt: Date.now(),
        },
      ],
    }, null, 2),
    'utf8',
  );
  await writeFile(
    join(sessionsDir, SEEDED_SESSION_FILE),
    `${seededMessages.map((message) => JSON.stringify(message)).join('\n')}\n`,
    'utf8',
  );
}

async function ensureGatewayConnected(page: Awaited<ReturnType<typeof getStableWindow>>): Promise<void> {
  const startResult = await page.evaluate(async () => (
    await window.electron.ipcRenderer.invoke('gateway:start')
  ) as { success?: boolean; error?: string });
  expect(startResult?.success, startResult?.error || 'gateway:start failed during E2E setup').toBe(true);
}

async function openSeededSession(page: Awaited<ReturnType<typeof getStableWindow>>, sessionKey: string): Promise<void> {
  const sessionRow = page.getByTestId(`sidebar-session-${sessionKey}`);
  if (await sessionRow.count() === 0) {
    await ensureGatewayConnected(page);
  }
  await expect(sessionRow).toBeVisible({ timeout: 60_000 });
  await sessionRow.click();
}

test.describe('Chat user message copy', () => {
  test('copies the user prompt from the message hover action', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      const textarea = page.locator('textarea').first();
      const messageText = 'Please copy this user prompt';

      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 45_000 });
      await ensureGatewayConnected(page);
      await expect(textarea).toBeEnabled({ timeout: 45_000 });

      await app.evaluate(({ clipboard }) => {
        clipboard.clear();
      });

      await textarea.fill(messageText);
      await textarea.press('Enter');

      const messageBubble = page.getByText(messageText);
      await expect(messageBubble).toBeVisible();
      await messageBubble.hover();

      const copyButton = page.getByTestId('chat-message-copy-user');
      await expect(copyButton).toBeVisible();
      await copyButton.click();

      await expect.poll(async () => await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(messageText);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('hides injected execution metadata from user bubbles and copy actions', async ({ homeDir, launchElectronApp }) => {
    await seedSession(homeDir);

    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 45_000 });
      await ensureGatewayConnected(page);

      await app.evaluate(({ clipboard }) => {
        clipboard.clear();
      });

      await openSeededSession(page, SEEDED_SESSION_KEY);

      const userBubble = page.getByTestId('chat-message-content-user').first();
      await expect(userBubble).toContainText(SEEDED_USER_PROMPT);
      await expect(userBubble).not.toContainText('Execution playbook:');
      await expect(userBubble).not.toContainText('Conversation info (untrusted metadata):');

      await userBubble.hover();
      await page.getByTestId('chat-message-copy-user').click();

      await expect.poll(async () => await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(SEEDED_USER_PROMPT);
    } finally {
      await closeElectronApp(app);
    }
  });
});
