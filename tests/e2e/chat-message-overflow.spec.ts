import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:message-overflow-test';
const SESSION_FILE = 'message-overflow-test.jsonl';
const SESSION_LABEL = 'Message overflow session';
const LONG_MARKDOWN = [
  'A minimal environmental penalty icon, 28x28 pixels. A simple leaf outline drawn with gray lines (#808080), combined with a blue warning mark (#0b7fff). Keep the composition light, centered, and suitable for a compact toolbar badge.',
  '',
  '| Element | Description |',
  '| --- | --- |',
  '| Palette | Gray + blue (#0b7fff) with soft neutral strokes that still wrap inside the chat surface |',
].join('\n');

async function seedSession(homeDir: string): Promise<void> {
  const sessionsDir = join(homeDir, '.openclaw', 'agents', 'main', 'sessions');
  const seededMessages = [
    {
      id: 'user-overflow-1',
      role: 'user',
      content: 'Please draft the icon prompt.',
      timestamp: Math.floor(Date.now() / 1000) - 4,
    },
    {
      id: 'assistant-overflow-1',
      role: 'assistant',
      content: [
        { type: 'text', text: LONG_MARKDOWN },
      ],
      timestamp: Math.floor(Date.now() / 1000) - 3,
    },
    {
      id: 'assistant-overflow-2',
      role: 'assistant',
      content: LONG_MARKDOWN,
      timestamp: Math.floor(Date.now() / 1000) - 2,
    },
  ];

  await mkdir(sessionsDir, { recursive: true });
  await writeFile(
    join(sessionsDir, 'sessions.json'),
    JSON.stringify({
      sessions: [
        {
          key: SESSION_KEY,
          id: 'message-overflow-test',
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

async function ensureGatewayConnected(page: Page): Promise<void> {
  const startResult = await page.evaluate(async () => (
    await window.electron.ipcRenderer.invoke('gateway:start')
  ) as { success?: boolean; error?: string });
  expect(startResult?.success, startResult?.error || 'gateway:start failed during E2E setup').toBe(true);
}

async function allocateGatewayPort(): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to allocate an isolated gateway port')));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolvePort(port);
      });
    });
  });
}

async function configureIsolatedGatewayPort(page: Page): Promise<void> {
  const port = await allocateGatewayPort();
  await page.evaluate(async (gatewayPort) => {
    await window.electron.ipcRenderer.invoke('settings:set', 'gatewayPort', gatewayPort);
  }, port);
}

async function openSeededSession(page: Page): Promise<void> {
  const sessionRow = page.getByTestId(`sidebar-session-${SESSION_KEY}`);
  if (await sessionRow.count() === 0) {
    await ensureGatewayConnected(page);
  }
  await expect(sessionRow).toBeVisible({ timeout: 60_000 });
  await sessionRow.click();
}

async function setChatPresentation(page: Page, {
  assistantMessageStyle,
  chatFontScale = 85,
  chatProcessDisplayMode = 'all',
}: {
  assistantMessageStyle: 'bubble' | 'stream';
  chatFontScale?: number;
  chatProcessDisplayMode?: 'all' | 'files' | 'hidden';
}): Promise<void> {
  await page.evaluate(async ({ nextStyle, nextFontScale, nextDisplayMode }) => {
    await window.electron.ipcRenderer.invoke('settings:set', 'assistantMessageStyle', nextStyle);
    await window.electron.ipcRenderer.invoke('settings:set', 'chatFontScale', nextFontScale);
    await window.electron.ipcRenderer.invoke('settings:set', 'chatProcessDisplayMode', nextDisplayMode);
  }, {
    nextStyle: assistantMessageStyle,
    nextFontScale: chatFontScale,
    nextDisplayMode: chatProcessDisplayMode,
  });
  await page.reload();
  await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });
}

async function expectNoHorizontalOverflow(locator: Locator): Promise<void> {
  const metrics = await locator.evaluate((element) => {
    const htmlElement = element as HTMLElement;
    const rootRect = htmlElement.getBoundingClientRect();
    const descendants = Array.from(htmlElement.querySelectorAll('*')) as HTMLElement[];
    const rightMostEdge = descendants.reduce((maxRight, node) => {
      const rect = node.getBoundingClientRect();
      return Math.max(maxRight, rect.right);
    }, rootRect.right);

    return {
      clientWidth: htmlElement.clientWidth,
      scrollWidth: htmlElement.scrollWidth,
      overflowDelta: Number((rightMostEdge - rootRect.right).toFixed(2)),
    };
  });

  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
  expect(metrics.overflowDelta).toBeLessThanOrEqual(1);
}

async function expectAlignedWithComposer(page: Page, locator: Locator): Promise<void> {
  const composer = page.getByTestId('chat-composer');
  const [composerBox, messageBox] = await Promise.all([
    composer.boundingBox(),
    locator.boundingBox(),
  ]);

  expect(composerBox).not.toBeNull();
  expect(messageBox).not.toBeNull();
  if (composerBox && messageBox) {
    expect(Math.abs(messageBox.x - composerBox.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(messageBox.width - composerBox.width)).toBeLessThanOrEqual(1);
  }
}

test.describe('Chat message overflow', () => {
  test('keeps long markdown within the bubble and process stream surfaces', async ({ homeDir, launchElectronApp }) => {
    test.fixme(process.platform === 'win32', 'Seeded-session sidebar hydration is currently flaky in Electron E2E on Windows.');
    await seedSession(homeDir);

    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });
      await configureIsolatedGatewayPort(page);
      await ensureGatewayConnected(page);

      await setChatPresentation(page, { assistantMessageStyle: 'bubble' });
      await openSeededSession(page);

      const processToggle = page.getByTestId('chat-process-toggle').first();
      await expect(processToggle).toBeVisible({ timeout: 60_000 });
      await processToggle.click();

      await expect(page.getByTestId('chat-process-content').first()).toBeVisible();
      await expect(page.getByTestId('chat-assistant-message-bubble').last()).toBeVisible();
      await expect(page.getByTestId('chat-process-note-content').first()).toBeVisible();

      await expectNoHorizontalOverflow(page.getByTestId('chat-assistant-message-bubble').last());
      await expectNoHorizontalOverflow(page.getByTestId('chat-process-note-content').first());
      await expectAlignedWithComposer(page, page.getByTestId('chat-assistant-message-bubble').last());

      await setChatPresentation(page, { assistantMessageStyle: 'stream' });
      await openSeededSession(page);

      const streamProcessToggle = page.getByTestId('chat-process-toggle').first();
      await expect(streamProcessToggle).toBeVisible({ timeout: 60_000 });
      await streamProcessToggle.click();

      await expect(page.getByTestId('chat-assistant-message-stream').last()).toBeVisible();
      await expect(page.getByTestId('chat-process-note-content').first()).toBeVisible();

      await expectNoHorizontalOverflow(page.getByTestId('chat-assistant-message-stream').last());
      await expectNoHorizontalOverflow(page.getByTestId('chat-process-note-content').first());
      await expectAlignedWithComposer(page, page.getByTestId('chat-assistant-message-stream').last());
    } finally {
      try {
        const page = await getStableWindow(app);
        await page.evaluate(async () => {
          try {
            await window.electron.ipcRenderer.invoke('gateway:stop');
          } catch {
            // ignore gateway shutdown failures during test cleanup
          }
        });
      } catch {
        // ignore cleanup failures before closing the Electron app
      }
      await closeElectronApp(app);
    }
  });
});
