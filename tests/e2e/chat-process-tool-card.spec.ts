import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:process-tool-card-test';
const SESSION_FILE = 'process-tool-card-test.jsonl';
const SESSION_LABEL = 'Process tool card session';

const seededMessages = [
  {
    id: 'user-1',
    role: 'user',
    content: 'Show me the cron status.',
    timestamp: Math.floor(Date.now() / 1000) - 5,
  },
  {
    id: 'assistant-1',
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: 'Check the cron tasks before replying.' },
      { type: 'tool_use', id: 'tool-1', name: 'cron', input: { action: 'list' } },
      { type: 'text', text: 'Looking up the cron tasks now.' },
    ],
    timestamp: Math.floor(Date.now() / 1000) - 4,
  },
  {
    id: 'assistant-2',
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: 'Summarize the result clearly.' },
      { type: 'text', text: 'No cron tasks are configured right now.' },
    ],
    timestamp: Math.floor(Date.now() / 1000) - 3,
  },
];

async function seedSession(homeDir: string): Promise<void> {
  const sessionsDir = join(homeDir, '.openclaw', 'agents', 'main', 'sessions');
  await mkdir(sessionsDir, { recursive: true });
  await writeFile(
    join(sessionsDir, 'sessions.json'),
    JSON.stringify({
      sessions: [
        {
          key: SESSION_KEY,
          id: 'process-tool-card-test',
          file: SESSION_FILE,
          label: SESSION_LABEL,
          updatedAt: Date.now(),
        },
      ],
    }, null, 2),
    'utf8',
  );
  await writeFile(
    join(sessionsDir, SESSION_FILE),
    `${seededMessages.map((message) => JSON.stringify(message)).join('\n')}\n`,
    'utf8',
  );
}

async function openSeededSession(page: Awaited<ReturnType<typeof getStableWindow>>, sessionKey: string): Promise<void> {
  const sessionRow = page.getByTestId(`sidebar-session-${sessionKey}`);
  if (await sessionRow.count() === 0) {
    const startResult = await page.evaluate(async () => (
      await window.electron.ipcRenderer.invoke('gateway:start')
    ) as { success?: boolean; error?: string });
    expect(startResult?.success, startResult?.error || 'gateway:start failed during E2E setup').toBe(true);
  }
  await expect(sessionRow).toBeVisible({ timeout: 60_000 });
  await sessionRow.click();
}

test.describe('Chat process tool cards', () => {
  test('shows tool cards inside the expanded process section', async ({ homeDir, launchElectronApp }) => {
    await seedSession(homeDir);

    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      await openSeededSession(page, SESSION_KEY);

      await expect(page.getByTestId('chat-process-toggle')).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId('chat-process-status')).toContainText('Processed');
      await page.getByTestId('chat-process-toggle').click();

      await expect(page.getByTestId('chat-process-content')).toBeVisible();
      await expect(page.getByTestId('chat-tool-card')).toBeVisible();
      await expect(page.getByText('No cron tasks are configured right now.', { exact: true })).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });

  test('hides internal heartbeat workspace reads from the expanded process section', async ({ homeDir, launchElectronApp }) => {
    const sessionsDir = join(homeDir, '.openclaw', 'agents', 'main', 'sessions');
    const heartbeatSessionKey = 'agent:main:process-heartbeat-hidden-test';
    const heartbeatSessionFile = 'process-heartbeat-hidden-test.jsonl';
    const heartbeatSessionLabel = 'Heartbeat hidden session';
    const heartbeatMessages = [
      {
        id: 'user-heartbeat-1',
        role: 'user',
        content: 'Continue the previous task.',
        timestamp: Math.floor(Date.now() / 1000) - 5,
      },
      {
        id: 'assistant-heartbeat-1',
        role: 'assistant',
        content: [
          { type: 'text', text: '用户发来了heartbeat检查请求，我需要读取HEARTBEAT.md文件。' },
          {
            type: 'tool_use',
            id: 'heartbeat-tool-1',
            name: 'read_file',
            input: { path: `${homeDir.replace(/\\/g, '/')}/.openclaw/workspace/HEARTBEAT.md` },
          },
          {
            type: 'tool_result',
            id: 'heartbeat-tool-1',
            name: 'read_file',
            content: `已读取内容 ${homeDir.replace(/\\/g, '/')}/.openclaw/workspace/HEARTBEAT.md`,
          },
        ],
        timestamp: Math.floor(Date.now() / 1000) - 4,
      },
      {
        id: 'assistant-heartbeat-2',
        role: 'assistant',
        content: [
          { type: 'text', text: 'No queued heartbeat task was found, so I resumed the normal reply.' },
        ],
        timestamp: Math.floor(Date.now() / 1000) - 3,
      },
    ];

    await mkdir(sessionsDir, { recursive: true });
    await writeFile(
      join(sessionsDir, 'sessions.json'),
      JSON.stringify({
        sessions: [
          {
            key: heartbeatSessionKey,
            id: 'process-heartbeat-hidden-test',
            file: heartbeatSessionFile,
            label: heartbeatSessionLabel,
            updatedAt: Date.now(),
          },
        ],
      }, null, 2),
      'utf8',
    );
    await writeFile(
      join(sessionsDir, heartbeatSessionFile),
      `${heartbeatMessages.map((message) => JSON.stringify(message)).join('\n')}\n`,
      'utf8',
    );

    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      await openSeededSession(page, heartbeatSessionKey);

      await expect(page.getByTestId('chat-process-toggle')).toBeVisible({ timeout: 60_000 });
      await page.getByTestId('chat-process-toggle').click();

      const processContent = page.getByTestId('chat-process-content');
      await expect(processContent).toBeVisible();
      await expect(processContent.getByText('No queued heartbeat task was found, so I resumed the normal reply.')).toBeVisible();
      await expect(processContent.getByText(/HEARTBEAT\.md/)).toHaveCount(0);
      await expect(processContent.getByText(/heartbeat检查请求/)).toHaveCount(0);
      await expect(processContent.getByTestId('chat-process-event-row')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });
});
