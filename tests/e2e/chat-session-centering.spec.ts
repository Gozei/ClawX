import type { Page } from '@playwright/test';
import {
  closeElectronApp,
  expect,
  getStableWindow,
  installIpcMocks,
  test,
} from './fixtures/electron';

const SESSION_KEY = 'agent:main:session-centered';
const SESSION_LABEL = 'Centered Session';
const MAIN_SESSION_KEY = 'agent:main:main';

async function sampleChatScrollTop(page: Page, settleMs = 550, sampleMs = 700): Promise<number[]> {
  return await page.evaluate(async ({ sampleMs, settleMs }) => {
    const scrollContainer = document.querySelector('[data-testid="chat-scroll-container"]') as HTMLElement | null;
    if (!scrollContainer) return [];

    await new Promise((resolve) => {
      window.setTimeout(resolve, settleMs);
    });

    const samples: number[] = [];
    const startedAt = performance.now();
    while (performance.now() - startedAt < sampleMs) {
      samples.push(scrollContainer.scrollTop);
      await new Promise((resolve) => {
        requestAnimationFrame(resolve);
      });
    }
    return samples;
  }, { sampleMs, settleMs });
}

async function measureChatDistanceFromBottom(page: Page): Promise<number | null> {
  return await page.evaluate(() => {
    const scrollContainer = document.querySelector('[data-testid="chat-scroll-container"]') as HTMLElement | null;
    if (!scrollContainer) return null;
    return Math.max(
      0,
      scrollContainer.scrollHeight - scrollContainer.clientHeight - scrollContainer.scrollTop,
    );
  });
}

test.describe('Chat Session Centering', () => {
  test('keeps the composer and history content centered after switching from a blank chat to a saved session', async ({ launchElectronApp, homeDir }) => {
    const app = await launchElectronApp({ skipSetup: true });

    const historyMessages = [
      {
        id: 'assistant-history-intro',
        role: 'assistant',
        content: 'Open this session and verify the content column stays centered.',
        timestamp: Math.floor(Date.now() / 1000) - 20,
      },
      {
        id: 'user-history-request',
        role: 'user',
        content: 'Please keep the composer and the history column aligned.',
        timestamp: Math.floor(Date.now() / 1000) - 10,
      },
      {
        id: 'assistant-history-final',
        role: 'assistant',
        content: [
          'All exported files are ready.',
          '',
          '## Checklist',
          '',
          ...Array.from(
            { length: 28 },
            (_value, index) => `- Item ${index + 1}: keep this session tall enough to require scrolling during the geometry check.`,
          ),
          '',
          'The content column and composer should remain centered.',
        ].join('\n'),
        timestamp: Math.floor(Date.now() / 1000),
        _attachedFiles: [
          {
            fileName: 'stable-width-preview.md',
            mimeType: 'text/markdown',
            fileSize: 96,
            preview: null,
            filePath: `${homeDir}\\stable-width-preview.md`,
          },
          {
            fileName: 'result-summary.txt',
            mimeType: 'text/plain',
            fileSize: 423,
            preview: null,
            filePath: `${homeDir}\\result-summary.txt`,
          },
          {
            fileName: 'test_document.docx',
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            fileSize: 37146,
            preview: null,
            filePath: `${homeDir}\\test_document.docx`,
          },
        ],
      },
    ];

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, connectedAt: Date.now() },
        hostApi: {
          '["/api/settings","GET"]': {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                setupComplete: true,
                language: 'zh',
                theme: 'system',
                sidebarCollapsed: false,
                sidebarWidth: 256,
                assistantMessageStyle: 'stream',
                chatProcessDisplayMode: 'all',
                hideInternalRoutineProcesses: true,
                chatFontScale: 100,
              },
            },
          },
          '["/api/gateway/status","GET"]': {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                state: 'running',
                port: 18789,
                pid: 12345,
                connectedAt: Date.now(),
              },
            },
          },
          '["/api/agents","GET"]': {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                agents: [
                  {
                    id: 'main',
                    name: 'Main Role',
                    default: true,
                    mainSessionKey: MAIN_SESSION_KEY,
                  },
                ],
              },
            },
          },
          '["/api/provider-accounts","GET"]': { ok: true, data: { status: 200, ok: true, json: [] } },
          '["/api/provider-account-statuses","GET"]': { ok: true, data: { status: 200, ok: true, json: [] } },
          '["/api/provider-vendors","GET"]': { ok: true, data: { status: 200, ok: true, json: [] } },
          '["/api/provider-accounts/default","GET"]': { ok: true, data: { status: 200, ok: true, json: null } },
          '["/api/sessions/list","GET"]': {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                sessions: [
                  {
                    key: SESSION_KEY,
                    label: SESSION_LABEL,
                    updatedAt: Date.now(),
                  },
                ],
              },
            },
          },
          '["/api/sessions/metadata","POST"]': {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                metadata: {},
              },
            },
          },
          '["/api/sessions/history","POST"]': {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                resolved: true,
                thinkingLevel: null,
                messages: historyMessages,
              },
            },
          },
        },
      });

      const page = await getStableWindow(app);
      await page.setViewportSize({ width: 1440, height: 900 });
      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 30_000 });

      const mainPane = page.getByTestId('chat-main-pane');
      const composer = page.getByTestId('chat-composer');
      const welcomeTitle = page.getByTestId('chat-welcome-title');
      await expect(welcomeTitle).toBeVisible({ timeout: 30_000 });
      await expect(composer).toBeVisible({ timeout: 30_000 });

      const [blankPaneBox, blankComposerBox] = await Promise.all([
        mainPane.boundingBox(),
        composer.boundingBox(),
      ]);
      expect(blankPaneBox).not.toBeNull();
      expect(blankComposerBox).not.toBeNull();
      expect(Math.abs(
        ((blankComposerBox?.x ?? 0) + ((blankComposerBox?.width ?? 0) / 2))
        - ((blankPaneBox?.x ?? 0) + ((blankPaneBox?.width ?? 0) / 2)),
      )).toBeLessThanOrEqual(2);

      const sessionButton = page.getByTestId(`sidebar-session-${SESSION_KEY}`).locator('button').first();
      await expect(sessionButton).toBeVisible({ timeout: 20_000 });
      await sessionButton.click({ force: true });

      const fileCard = page.getByTestId('chat-file-card').filter({ hasText: 'stable-width-preview.md' }).first();
      const contentColumn = page.getByTestId('chat-content-column').last();
      const assistantContent = page.getByTestId('chat-message-content-assistant').last();
      const assistantAttachments = page.getByTestId('chat-assistant-attachments').last();
      const assistantShell = page.getByTestId('chat-assistant-message-shell').last();
      const chatScrollContainer = page.getByTestId('chat-scroll-container');

      await expect(fileCard).toBeVisible({ timeout: 30_000 });
      await expect(contentColumn).toBeVisible({ timeout: 30_000 });
      await expect(assistantContent).toBeVisible({ timeout: 30_000 });
      await expect(assistantAttachments).toBeVisible({ timeout: 30_000 });
      await expect(composer).toBeVisible({ timeout: 30_000 });

      const scrollTopSamples = await sampleChatScrollTop(page);
      expect(scrollTopSamples.length).toBeGreaterThan(5);
      const scrollTopRange = Math.max(...scrollTopSamples) - Math.min(...scrollTopSamples);
      expect(scrollTopRange).toBeLessThanOrEqual(4);
      await expect.poll(async () => await measureChatDistanceFromBottom(page), { timeout: 10_000 }).toBeLessThanOrEqual(2);

      const beforeScroll = {
        mainPane: await mainPane.boundingBox(),
        composer: await composer.boundingBox(),
        contentColumn: await contentColumn.boundingBox(),
        assistantShell: await assistantShell.boundingBox(),
        assistantContent: await assistantContent.boundingBox(),
        assistantAttachments: await assistantAttachments.boundingBox(),
      };
      expect(beforeScroll.mainPane).not.toBeNull();
      expect(beforeScroll.composer).not.toBeNull();
      expect(beforeScroll.contentColumn).not.toBeNull();
      expect(beforeScroll.assistantContent).not.toBeNull();
      expect(beforeScroll.assistantAttachments).not.toBeNull();
      expect(beforeScroll.contentColumn?.width ?? 0).toBeGreaterThanOrEqual(860);
      expect(beforeScroll.contentColumn?.width ?? 0).toBeLessThanOrEqual(866);
      expect(Math.abs((beforeScroll.composer?.x ?? 0) - (beforeScroll.contentColumn?.x ?? 0))).toBeLessThanOrEqual(2);
      expect(Math.abs(((beforeScroll.composer?.x ?? 0) + (beforeScroll.composer?.width ?? 0)) - ((beforeScroll.contentColumn?.x ?? 0) + (beforeScroll.contentColumn?.width ?? 0)))).toBeLessThanOrEqual(2);
      expect(Math.abs((beforeScroll.assistantContent?.width ?? 0) - (beforeScroll.contentColumn?.width ?? 0))).toBeLessThanOrEqual(2);
      expect(Math.abs((beforeScroll.assistantAttachments?.width ?? 0) - (beforeScroll.contentColumn?.width ?? 0))).toBeLessThanOrEqual(2);
      expect(Math.abs(
        ((beforeScroll.contentColumn?.x ?? 0) + ((beforeScroll.contentColumn?.width ?? 0) / 2))
        - ((beforeScroll.mainPane?.x ?? 0) + ((beforeScroll.mainPane?.width ?? 0) / 2)),
      )).toBeLessThanOrEqual(2);
      expect(Math.abs(
        ((beforeScroll.composer?.x ?? 0) + ((beforeScroll.composer?.width ?? 0) / 2))
        - ((beforeScroll.mainPane?.x ?? 0) + ((beforeScroll.mainPane?.width ?? 0) / 2)),
      )).toBeLessThanOrEqual(2);

      await chatScrollContainer.evaluate((element) => {
        element.scrollTop = Math.max(0, element.scrollTop - 420);
      });
      await page.waitForTimeout(300);

      const afterScroll = {
        assistantContent: await assistantContent.boundingBox(),
        assistantAttachments: await assistantAttachments.boundingBox(),
      };

      expect(afterScroll.assistantContent).not.toBeNull();
      expect(afterScroll.assistantAttachments).not.toBeNull();
      expect(Math.abs((afterScroll.assistantContent?.width ?? 0) - (beforeScroll.assistantContent?.width ?? 0))).toBeLessThanOrEqual(2);
      expect(Math.abs((afterScroll.assistantAttachments?.width ?? 0) - (beforeScroll.assistantAttachments?.width ?? 0))).toBeLessThanOrEqual(2);
    } finally {
      await closeElectronApp(app);
    }
  });
});
