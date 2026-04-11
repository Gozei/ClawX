import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:thinking-collapse-test';
const SESSION_FILE = 'thinking-collapse-test.jsonl';
const SESSION_LABEL = 'Thinking collapse session';

const seededMessages = [
  {
    id: 'user-1',
    role: 'user',
    content: '请帮我拍一张照片并发给我',
    timestamp: Math.floor(Date.now() / 1000) - 5,
  },
  {
    id: 'assistant-1',
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: '先确认拍照工具是否可用。' },
      { type: 'text', text: '我先帮你检查摄像头并准备拍照。' },
    ],
    timestamp: Math.floor(Date.now() / 1000) - 4,
  },
  {
    id: 'assistant-2',
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: '拍照完成，准备整理并发送结果。' },
      { type: 'text', text: '照片已保存，正在整理给你的最终结果。' },
    ],
    timestamp: Math.floor(Date.now() / 1000) - 3,
  },
  {
    id: 'assistant-3',
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: '最后再确认输出内容是否完整。' },
      { type: 'text', text: '完成，照片已经发送给你。' },
    ],
    timestamp: Math.floor(Date.now() / 1000) - 2,
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
          id: 'thinking-collapse-test',
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

test.describe('Chat thinking collapse', () => {
  test('shows one collapse entry for intermediate assistant steps and keeps the final reply visible', async ({ homeDir, launchElectronApp }) => {
    await seedSession(homeDir);

    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      await page.getByTestId(`sidebar-session-${SESSION_KEY}`).click();

      await expect(page.getByText('请帮我拍一张照片并发给我', { exact: true })).toBeVisible({ timeout: 60_000 });
      await expect(page.getByText('完成，照片已经发送给你。', { exact: true })).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId('chat-process-toggle')).toBeVisible();
      await expect(page.getByTestId('chat-process-toggle')).toHaveCount(1);

      await expect(page.getByText('我先帮你检查摄像头并准备拍照。', { exact: true })).toHaveCount(0);
      await expect(page.getByText('照片已保存，正在整理给你的最终结果。', { exact: true })).toHaveCount(0);
      await expect(page.getByText('最后再确认输出内容是否完整。', { exact: true })).toHaveCount(0);

      await page.getByTestId('chat-process-toggle').click();

      await expect(page.getByTestId('chat-process-content')).toBeVisible();
      await expect(page.getByText('我先帮你检查摄像头并准备拍照。', { exact: true })).toBeVisible();
      await expect(page.getByText('照片已保存，正在整理给你的最终结果。', { exact: true })).toBeVisible();
      await expect(page.getByText('最后再确认输出内容是否完整。', { exact: true })).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });
});
