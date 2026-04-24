import type { ElectronApplication } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  closeElectronApp,
  expect,
  getStableWindow,
  test,
} from './fixtures/electron';

const SESSION_KEY = 'agent:main:file-preview';

function normalizeFontFamily(value: string): string {
  return value
    .toLowerCase()
    .replace(/["']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function createPresentationSlideDataUrl(options: {
  title: string;
  body: string;
  accent?: string;
}): string {
  const accent = options.accent ?? '#1d4ed8';
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">
      <rect width="1600" height="900" fill="#ffffff" />
      <rect x="1120" y="0" width="360" height="900" fill="${accent}" opacity="0.14" />
      <rect x="0" y="0" width="96" height="900" fill="${accent}" opacity="0.08" />
      <text x="152" y="210" fill="#0f172a" font-size="54" font-weight="700" font-family="Segoe UI, Microsoft YaHei UI, sans-serif">${options.title}</text>
      <text x="152" y="320" fill="#334155" font-size="28" font-family="Segoe UI, Microsoft YaHei UI, sans-serif">${options.body}</text>
    </svg>
  `.replace(/\s{2,}/g, ' ').trim();
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

async function installGatewaySessionMocks(
  app: ElectronApplication,
  payload: {
    sessionKey: string;
    messages: Array<Record<string, unknown>>;
  },
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await app.evaluate(({ ipcMain }, { messages, sessionKey }) => {
        ipcMain.removeHandler('gateway:status');
        ipcMain.handle('gateway:status', async () => ({
          state: 'running',
          port: 18789,
          pid: 12345,
          connectedAt: Date.now(),
        }));

        ipcMain.removeHandler('gateway:rpc');
        ipcMain.handle('gateway:rpc', async (_event, method: string) => {
          if (method === 'sessions.list') {
            return {
              success: true,
              result: {
                sessions: [{
                  key: sessionKey,
                  id: `${sessionKey}-id`,
                  label: sessionKey,
                  updatedAt: Date.now(),
                }],
              },
            };
          }

          if (method === 'chat.history') {
            return {
              success: true,
              result: { messages },
            };
          }

          if (method === 'chat.abort') {
            return {
              success: true,
              result: { ok: true },
            };
          }

          return {
            success: true,
            result: {},
          };
        });
      }, payload);
      return;
    } catch (error) {
      if (attempt === 2 || !String(error).includes('Execution context was destroyed')) {
        throw error;
      }
    }
  }
}

async function installHostApiPreviewMocks(
  app: ElectronApplication,
  payload: {
    markdownFilePath?: string;
    markdownBody?: string;
    textFilePath?: string;
    textBody?: string;
    codeFilePath?: string;
    codeBody?: string;
    codeLanguage?: string;
    docxFilePath?: string;
    docxFileName?: string;
    docxFileSize?: number;
    docxHtml?: string;
    docxBinaryBase64?: string;
    docxOutline?: Array<{
      id: string;
      text: string;
      level: number;
      isBold?: boolean;
    }>;
    spreadsheetFilePath?: string;
    spreadsheetFileName?: string;
    spreadsheetMimeType?: string;
    spreadsheetFileSize?: number;
    spreadsheetSheets?: Array<{
      name: string;
      rows: string[][];
      rowCount: number;
      columnCount: number;
      truncatedRows: boolean;
      truncatedColumns: boolean;
    }>;
    spreadsheetTruncatedSheets?: boolean;
    imageFilePath?: string;
    imagePreview?: string;
    presentationFilePath?: string;
    presentationFileName?: string;
    presentationFileSize?: number;
    presentationPreviewId?: string;
    presentationRenderMode?: 'html' | 'image';
    presentationSlideWidth?: number;
    presentationSlideHeight?: number;
    presentationSlides?: Array<{
      index: number;
      title: string;
      paragraphs: string[];
      truncatedParagraphs: boolean;
    }>;
    presentationSlideHtmlByIndex?: Record<number, string>;
    presentationSlideImageByIndex?: Record<number, string>;
    presentationTruncatedSlides?: boolean;
    sessionHistoryMessages?: Array<Record<string, unknown>>;
    sessionHistoryResolved?: boolean;
    sessionHistoryThinkingLevel?: string | null;
    settingsOverrides?: Record<string, unknown>;
  },
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await app.evaluate(({ ipcMain }, config) => {
        const requestLog: string[] = [];
        const copyRequests: Array<{ filePath?: string; base64?: string }> = [];
        const revealRequests: string[] = [];
        const gatewayStatus = {
          state: 'running',
          port: 18789,
          pid: 12345,
          connectedAt: Date.now(),
        };
        const emptyAgentsSnapshot = {
          success: true,
          agents: [],
          defaultAgentId: 'main',
          defaultModelRef: null,
          configuredChannelTypes: [],
          channelOwners: {},
          channelAccountOwners: {},
        };

        ipcMain.removeHandler('hostapi:fetch');
        ipcMain.handle(
          'hostapi:fetch',
          async (_event, request: { path?: string; method?: string; body?: string }) => {
            const path = request?.path ?? '';
            const method = (request?.method ?? 'GET').toUpperCase();
            requestLog.push(`${method} ${path}`);

            if (path === '/api/settings' && method === 'GET') {
              return {
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
                    ...(config.settingsOverrides ?? {}),
                  },
                },
              };
            }

            if (path === '/api/gateway/status' && method === 'GET') {
              return {
                ok: true,
                data: {
                  status: 200,
                  ok: true,
                  json: gatewayStatus,
                },
              };
            }

            if (path === '/api/sessions/history' && method === 'POST') {
              return {
                ok: true,
                data: {
                  status: 200,
                  ok: true,
                  json: {
                    success: true,
                    resolved: config.sessionHistoryResolved ?? false,
                    messages: config.sessionHistoryMessages ?? [],
                    thinkingLevel: config.sessionHistoryThinkingLevel ?? null,
                  },
                },
              };
            }

            if (path === '/api/agents' && method === 'GET') {
              return {
                ok: true,
                data: {
                  status: 200,
                  ok: true,
                  json: emptyAgentsSnapshot,
                },
              };
            }

            if (path === '/api/provider-accounts' && method === 'GET') {
              return {
                ok: true,
                data: {
                  status: 200,
                  ok: true,
                  json: [],
                },
              };
            }

            if (path === '/api/provider-account-statuses' && method === 'GET') {
              return {
                ok: true,
                data: {
                  status: 200,
                  ok: true,
                  json: [],
                },
              };
            }

            if (path === '/api/provider-vendors' && method === 'GET') {
              return {
                ok: true,
                data: {
                  status: 200,
                  ok: true,
                  json: [],
                },
              };
            }

            if (path === '/api/provider-accounts/default' && method === 'GET') {
              return {
                ok: true,
                data: {
                  status: 200,
                  ok: true,
                  json: {
                    accountId: null,
                  },
                },
              };
            }

            if (path === '/api/sessions/metadata' && method === 'POST') {
              return {
                ok: true,
                data: {
                  status: 200,
                  ok: true,
                  json: {
                    success: true,
                    metadata: {},
                  },
                },
              };
            }

            if (path === '/api/sessions/previews' && method === 'POST') {
              return {
                ok: true,
                data: {
                  status: 200,
                  ok: true,
                  json: {
                    success: true,
                    previews: {},
                  },
                },
              };
            }

            if (path === '/api/files/preview' && method === 'POST') {
              const parsed = request?.body ? JSON.parse(request.body) as { filePath?: string } : {};

              if (parsed.filePath && parsed.filePath === config.markdownFilePath) {
                return {
                  ok: true,
                  data: {
                    status: 200,
                    ok: true,
                    json: {
                      kind: 'markdown',
                      fileName: 'preview-fixture.md',
                      mimeType: 'text/markdown',
                      fileSize: config.markdownBody?.length ?? 0,
                      content: config.markdownBody ?? '',
                      truncated: false,
                    },
                  },
                };
              }

              if (parsed.filePath && parsed.filePath === config.textFilePath) {
                return {
                  ok: true,
                  data: {
                    status: 200,
                    ok: true,
                    json: {
                      kind: 'text',
                      fileName: 'system-font-preview.txt',
                      mimeType: 'text/plain',
                      fileSize: config.textBody?.length ?? 0,
                      content: config.textBody ?? '',
                      truncated: false,
                    },
                  },
                };
              }

              if (parsed.filePath && parsed.filePath === config.codeFilePath) {
                return {
                  ok: true,
                  data: {
                    status: 200,
                    ok: true,
                    json: {
                      kind: 'code',
                      fileName: 'system-font-preview.ts',
                      mimeType: 'text/typescript',
                      fileSize: config.codeBody?.length ?? 0,
                      content: config.codeBody ?? '',
                      truncated: false,
                      language: config.codeLanguage ?? 'typescript',
                    },
                  },
                };
              }

              if (parsed.filePath && parsed.filePath === config.docxFilePath) {
                return {
                  ok: true,
                  data: {
                    status: 200,
                    ok: true,
                    json: {
                      kind: 'docx',
                      fileName: config.docxFileName ?? 'outline-fixture.docx',
                      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                      fileSize: config.docxFileSize ?? 2048,
                      html: config.docxHtml ?? '',
                      outline: config.docxOutline ?? [
                        {
                          id: 'chapter-1',
                          text: 'Chapter 1 Intro With A Very Long Bold Heading That Should Truncate Inside The Outline Panel',
                          level: 1,
                          isBold: true,
                        },
                        {
                          id: 'chapter-2',
                          text: 'Chapter 2 Details',
                          level: 2,
                          isBold: true,
                        },
                      ],
                      warnings: [],
                    },
                  },
                };
              }

              if (parsed.filePath && parsed.filePath === config.spreadsheetFilePath) {
                return {
                  ok: true,
                  data: {
                    status: 200,
                    ok: true,
                    json: {
                      kind: 'spreadsheet',
                      fileName: config.spreadsheetFileName ?? 'system-font-preview.xlsx',
                      mimeType: config.spreadsheetMimeType ?? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                      fileSize: config.spreadsheetFileSize ?? 0,
                      sheets: config.spreadsheetSheets ?? [],
                      truncatedSheets: config.spreadsheetTruncatedSheets ?? false,
                    },
                  },
                };
              }

              if (parsed.filePath && parsed.filePath === config.imageFilePath) {
                return {
                  ok: true,
                  data: {
                    status: 200,
                    ok: true,
                    json: {
                      kind: 'image',
                      fileName: 'preview-image.png',
                      mimeType: 'image/png',
                      fileSize: 1024,
                      src: config.imagePreview,
                    },
                  },
                };
              }

              if (parsed.filePath && parsed.filePath === config.presentationFilePath) {
                return {
                  ok: true,
                  data: {
                    status: 200,
                    ok: true,
                    json: {
                      kind: 'presentation',
                      fileName: config.presentationFileName ?? 'presentation.pptx',
                      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                      fileSize: config.presentationFileSize ?? 0,
                      previewId: config.presentationPreviewId ?? 'presentation-preview',
                      renderMode: config.presentationRenderMode ?? 'html',
                      slideWidth: config.presentationSlideWidth ?? 960,
                      slideHeight: config.presentationSlideHeight ?? 540,
                      slides: config.presentationSlides ?? [],
                      truncatedSlides: config.presentationTruncatedSlides ?? false,
                    },
                  },
                };
              }
            }

            if (path === '/api/files/preview-docx-source' && method === 'POST') {
              const parsed = request?.body ? JSON.parse(request.body) as { filePath?: string } : {};
              if (parsed.filePath && parsed.filePath === config.docxFilePath && config.docxBinaryBase64) {
                return {
                  ok: true,
                  data: {
                    status: 200,
                    ok: true,
                    json: {
                      base64: config.docxBinaryBase64,
                    },
                  },
                };
              }
            }

            if (path === '/api/files/preview-slide' && method === 'POST') {
              const parsed = request?.body ? JSON.parse(request.body) as { slideIndex?: number } : {};
              const html = config.presentationSlideHtmlByIndex?.[parsed.slideIndex ?? 0];
              if (html) {
                return {
                  ok: true,
                  data: {
                    status: 200,
                    ok: true,
                    json: { html },
                  },
                };
              }
            }

            if (path === '/api/files/preview-slide-image' && method === 'POST') {
              const parsed = request?.body ? JSON.parse(request.body) as { slideIndex?: number } : {};
              const src = config.presentationSlideImageByIndex?.[parsed.slideIndex ?? 0];
              if (src) {
                return {
                  ok: true,
                  data: {
                    status: 200,
                    ok: true,
                    json: { src },
                  },
                };
              }
            }

            if (path === '/api/files/save-file' && method === 'POST') {
              return {
                ok: true,
                data: {
                  status: 200,
                  ok: true,
                  json: {
                    success: true,
                    savedPath: config.markdownFilePath
                      || config.docxFilePath
                      || config.imageFilePath
                      || config.presentationFilePath,
                  },
                },
              };
            }

            return {
              ok: true,
              data: {
                status: 200,
                ok: true,
                json: {},
              },
            };
          },
        );

        ipcMain.removeHandler('media:copyImage');
        ipcMain.handle('media:copyImage', async (_event, params: { filePath?: string; base64?: string }) => {
          copyRequests.push(params);
          return { success: true };
        });

        ipcMain.removeHandler('shell:showItemInFolder');
        ipcMain.handle('shell:showItemInFolder', async (_event, targetPath?: string) => {
          if (typeof targetPath === 'string' && targetPath.length > 0) {
            revealRequests.push(targetPath);
          }
          return { success: true };
        });

        const state = globalThis as typeof globalThis & {
          __clawxPreviewState?: {
            requests: string[];
            copyRequests: Array<{ filePath?: string; base64?: string }>;
            revealRequests: string[];
          };
        };
        state.__clawxPreviewState = {
          requests: requestLog,
          copyRequests,
          revealRequests,
        };
      }, payload);
      return;
    } catch (error) {
      if (attempt === 2 || !String(error).includes('Execution context was destroyed')) {
        throw error;
      }
    }
  }
}

async function installPreviewStateProbe(app: ElectronApplication) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await app.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('app:request');
        ipcMain.handle('app:request', async (_event, name?: string) => {
          if (name === 'e2e:file-preview-state') {
            const state = globalThis as typeof globalThis & {
              __clawxPreviewState?: {
                requests: string[];
                copyRequests: Array<{ filePath?: string; base64?: string }>;
                revealRequests: string[];
              };
            };
            return state.__clawxPreviewState ?? {
              requests: [],
              copyRequests: [],
              revealRequests: [],
            };
          }
          return {};
        });
      });
      return;
    } catch (error) {
      if (attempt === 2 || !String(error).includes('Execution context was destroyed')) {
        throw error;
      }
    }
  }
}

test.describe('Chat file preview window', () => {
  test('keeps inline preview in chat and opens a larger detached window only after expand', async ({ launchElectronApp, homeDir }) => {
    test.setTimeout(180_000);

    const markdownPath = join(homeDir, 'preview-fixture.md');
    const longCardFileName = 'preview-fixture-with-a-very-long-file-name-that-needs-two-lines-in-chat.md';
    const markdownBody = [
      '# Preview Fixture',
      '',
      'This is a markdown attachment rendered inside the standalone preview window.',
      '',
      '- Important bullet',
      '- Another bullet',
    ].join('\n');
    const historyMessages = [
      {
        id: 'assistant-width-intro',
        role: 'assistant',
        content: '鍏堟墦寮€涓€涓檮浠堕瑙堬紝鍐嶅叧闂畠锛岀劧鍚庣户缁線涓婃粴鍔ㄣ€?',
        timestamp: Math.floor(Date.now() / 1000) - 20,
      },
      {
        id: 'user-width-request',
        role: 'user',
        content: '鎴戞兂纭棰勮鍏抽棴浠ュ悗鑱婂ぉ瀹藉害涓嶄細鍐嶅彉銆?',
        timestamp: Math.floor(Date.now() / 1000) - 10,
      },
      {
        id: 'assistant-width-final',
        role: 'assistant',
        content: assistantBody,
        timestamp: Math.floor(Date.now() / 1000),
        _attachedFiles: [
          {
            fileName: 'stable-width-preview.md',
            mimeType: 'text/markdown',
            fileSize: 96,
            preview: null,
            filePath: markdownPath,
          },
          {
            fileName: 'result-summary.txt',
            mimeType: 'text/plain',
            fileSize: 423,
            preview: null,
            filePath: join(homeDir, 'result-summary.txt'),
          },
          {
            fileName: 'test_data.xlsx',
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            fileSize: 5427,
            preview: null,
            filePath: join(homeDir, 'test_data.xlsx'),
          },
          {
            fileName: 'test_document.docx',
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            fileSize: 37146,
            preview: null,
            filePath: docxPath,
          },
          {
            fileName: 'test_presentation.pptx',
            mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            fileSize: 31924,
            preview: null,
            filePath: join(homeDir, 'test_presentation.pptx'),
          },
          {
            fileName: 'test_image.png',
            mimeType: 'image/png',
            fileSize: 2451,
            preview: null,
            filePath: join(homeDir, 'test_image.png'),
          },
        ],
      },
    ];

    await writeFile(markdownPath, markdownBody, 'utf8');

    const historyMessages = [
      {
        id: 'assistant-width-intro',
        role: 'assistant',
        content: '鍏堟墦寮€涓€涓檮浠堕瑙堬紝鍐嶅叧闂畠锛岀劧鍚庣户缁線涓婃粴鍔ㄣ€?',
        timestamp: Math.floor(Date.now() / 1000) - 20,
      },
      {
        id: 'user-width-request',
        role: 'user',
        content: '鎴戞兂纭棰勮鍏抽棴浠ュ悗鑱婂ぉ瀹藉害涓嶄細鍐嶅彉銆?',
        timestamp: Math.floor(Date.now() / 1000) - 10,
      },
      {
        id: 'assistant-width-final',
        role: 'assistant',
        content: assistantBody,
        timestamp: Math.floor(Date.now() / 1000),
        _attachedFiles: [
          {
            fileName: 'stable-width-preview.md',
            mimeType: 'text/markdown',
            fileSize: 96,
            preview: null,
            filePath: markdownPath,
          },
          {
            fileName: 'result-summary.txt',
            mimeType: 'text/plain',
            fileSize: 423,
            preview: null,
            filePath: join(homeDir, 'result-summary.txt'),
          },
          {
            fileName: 'test_data.xlsx',
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            fileSize: 5427,
            preview: null,
            filePath: join(homeDir, 'test_data.xlsx'),
          },
          {
            fileName: 'test_document.docx',
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            fileSize: 37146,
            preview: null,
            filePath: docxPath,
          },
          {
            fileName: 'test_presentation.pptx',
            mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            fileSize: 31924,
            preview: null,
            filePath: join(homeDir, 'test_presentation.pptx'),
          },
          {
            fileName: 'test_image.png',
            mimeType: 'image/png',
            fileSize: 2451,
            preview: null,
            filePath: join(homeDir, 'test_image.png'),
          },
        ],
      },
    ];

    const app = await launchElectronApp({ skipSetup: true });
    const page = await getStableWindow(app);

    try {
      await installGatewaySessionMocks(app, {
        sessionKey: SESSION_KEY,
        messages: [
          {
            id: 'assistant-preview-intro',
            role: 'assistant',
            content: 'Open the markdown attachment in a separate preview window.',
            timestamp: Math.floor(Date.now() / 1000) - 10,
          },
          {
            id: 'user-preview-message',
            role: 'user',
            content: 'Please preview this file.',
            timestamp: Math.floor(Date.now() / 1000),
            _attachedFiles: [
              {
                fileName: longCardFileName,
                mimeType: 'text/markdown',
                fileSize: markdownBody.length,
                preview: null,
                filePath: markdownPath,
              },
            ],
          },
        ],
      });
      await installHostApiPreviewMocks(app, {
        markdownFilePath: markdownPath,
        markdownBody,
      });
      await installPreviewStateProbe(app);

      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });
      await app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows().at(-1);
        window?.webContents.send('gateway:status-changed', {
          state: 'running',
          port: 18789,
          pid: 12345,
          connectedAt: Date.now(),
        });
      });

      await page.getByTestId(`sidebar-session-${SESSION_KEY}`).click({ force: true });
      const attachmentList = page.getByTestId('chat-user-attachments');
      await expect(attachmentList).toBeVisible({ timeout: 20_000 });
      const fileCard = attachmentList.getByTestId('chat-file-card').first();
      await expect(fileCard).toBeVisible({ timeout: 20_000 });
      await expect(fileCard.getByTestId('chat-file-card-name')).toHaveAttribute('title', longCardFileName);
      const firstLine = fileCard.getByTestId('chat-file-card-name-first-line');
      const secondLine = fileCard.getByTestId('chat-file-card-name-second-line');
      const meta = fileCard.getByTestId('chat-file-card-name-meta');
      const fileCardBody = fileCard.getByTestId('chat-file-card-body');
      const fileIcon = fileCard.getByTestId('chat-file-icon');
      const fileIconBadge = fileCard.getByTestId('chat-file-ext-badge');
      const revealButton = fileCard.locator('[data-testid="chat-file-card-reveal"]').first();
      await expect(secondLine).not.toHaveText('');
      await expect(revealButton).toHaveCSS('opacity', '0');
      await expect(fileIcon).toHaveCSS('width', '44px');
      await expect(fileIcon).toHaveCSS('box-shadow', 'none');

      const firstLineBox = await firstLine.boundingBox();
      const secondLineBox = await secondLine.boundingBox();
      const metaBox = await meta.boundingBox();

      expect(firstLineBox).not.toBeNull();
      expect(secondLineBox).not.toBeNull();
      expect(metaBox).not.toBeNull();
      expect((firstLineBox?.width ?? 0)).toBeGreaterThan((secondLineBox?.width ?? 0) + 8);
      expect((metaBox?.y ?? 0)).toBeGreaterThan((firstLineBox?.y ?? 0));
      const fileCardBodyBox = await fileCardBody.boundingBox();
      const fileIconBox = await fileIcon.boundingBox();
      const fileIconBadgeBox = await fileIconBadge.boundingBox();
      expect(fileCardBodyBox).not.toBeNull();
      expect(fileIconBox).not.toBeNull();
      expect(fileIconBadgeBox).not.toBeNull();
      expect(((fileIconBox?.y ?? 0) + ((fileIconBox?.height ?? 0) / 2))).toBeLessThan(((fileCardBodyBox?.y ?? 0) + ((fileCardBodyBox?.height ?? 0) / 2)));
      expect(((fileIconBadgeBox?.y ?? 0) + (fileIconBadgeBox?.height ?? 0))).toBeLessThan(((fileIconBox?.y ?? 0) + (fileIconBox?.height ?? 0)) - 1);

      await fileCardBody.hover({ force: true });
      await expect.poll(async () => {
        return await revealButton.evaluate((element) => {
          return Number.parseFloat(window.getComputedStyle(element).opacity);
        });
      }, { timeout: 20_000 }).toBeGreaterThan(0.9);
      await expect(revealButton).toHaveCSS('border-top-left-radius', '8px');
      await expect(revealButton).toHaveCSS('background-color', 'rgb(255, 255, 255)');
      await expect(revealButton).toHaveCSS('border-top-color', 'rgb(203, 213, 225)');
      await expect(revealButton).toHaveCSS('right', '12px');
      await revealButton.click();
      await expect(page.getByTestId('chat-file-preview-panel')).toHaveCount(0);
      await expect.poll(async () => {
        return await page.evaluate(async () => {
          return await window.electron.ipcRenderer.invoke('app:request', 'e2e:file-preview-state') as {
            revealRequests: string[];
          };
        });
      }, { timeout: 20_000 }).toMatchObject({
        revealRequests: [markdownPath],
      });

      await fileCard.click({ force: true });
      const mainPane = page.getByTestId('chat-main-pane');
      const previewPanel = page.getByTestId('chat-file-preview-panel');
      await expect(previewPanel).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('chat-file-preview-header')).toContainText(longCardFileName);
      await expect(page.getByTestId('chat-file-preview-body')).toContainText('Preview Fixture');
      await expect(page.getByTestId('chat-file-preview-body')).toContainText('Important bullet');
      await expect(page.getByTestId('chat-toolbar-header')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('chat-file-preview-expand')).toHaveCSS('width', '36px');
      await expect(page.getByTestId('chat-file-preview-reveal')).toHaveCSS('width', '36px');
      await expect(page.getByTestId('chat-file-preview-close')).toHaveCSS('width', '36px');
      await page.getByTestId('chat-file-preview-reveal').click();
      await expect.poll(async () => {
        return await page.evaluate(async () => {
          return await window.electron.ipcRenderer.invoke('app:request', 'e2e:file-preview-state') as {
            revealRequests: string[];
          };
        });
      }, { timeout: 20_000 }).toMatchObject({
        revealRequests: [markdownPath, markdownPath],
      });

      const mainPaneBox = await mainPane.boundingBox();
      const previewPanelBox = await previewPanel.boundingBox();
      expect(mainPaneBox).not.toBeNull();
      expect(previewPanelBox).not.toBeNull();
      expect(Math.abs((mainPaneBox?.width ?? 0) - (previewPanelBox?.width ?? 0))).toBeLessThanOrEqual(2);

      await expect.poll(async () => await app.evaluate(({ BrowserWindow }) => {
        return BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed()).length;
      }), { timeout: 20_000 }).toBe(1);

      const previewWindowPromise = app.waitForEvent('window');
      await page.getByTestId('chat-file-preview-expand').click();
      const previewPage = await previewWindowPromise;

      await previewPage.waitForLoadState('domcontentloaded');
      await expect(previewPage.getByTestId('chat-file-preview-window')).toBeVisible({ timeout: 20_000 });
      await expect(previewPage.getByTestId('chat-file-preview-window-header')).toContainText(longCardFileName);
      await expect(previewPage.getByTestId('chat-file-preview-window-body')).toContainText('Preview Fixture');
      await expect(previewPage.getByTestId('chat-file-preview-window-minimize')).toBeVisible({ timeout: 20_000 });
      const maximizeButton = previewPage.getByTestId('chat-file-preview-window-maximize');
      await expect(maximizeButton).toBeVisible({ timeout: 20_000 });
      await expect(maximizeButton).toHaveAttribute('data-state', 'maximize');
      await expect(previewPage.getByTestId('chat-file-preview-window-close')).toBeVisible({ timeout: 20_000 });
      await expect.poll(async () => await app.evaluate(({ BrowserWindow }) => {
        return BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed()).length;
      }), { timeout: 20_000 }).toBe(2);

      await maximizeButton.click();
      await expect.poll(async () => {
        return await maximizeButton.getAttribute('data-state');
      }, { timeout: 20_000 }).toBe('restore');
      await expect(previewPage.getByTestId('chat-file-preview-window-restore-icon')).toBeVisible();

      await maximizeButton.click();
      await expect.poll(async () => {
        return await maximizeButton.getAttribute('data-state');
      }, { timeout: 20_000 }).toBe('maximize');
      await expect(previewPage.getByTestId('chat-file-preview-window-maximize-icon')).toBeVisible();

      await previewPage.getByTestId('chat-file-preview-window-reveal').click();
      await expect.poll(async () => {
        return await page.evaluate(async () => {
          return await window.electron.ipcRenderer.invoke('app:request', 'e2e:file-preview-state') as {
            revealRequests: string[];
          };
        });
      }, { timeout: 20_000 }).toMatchObject({
        revealRequests: [markdownPath, markdownPath, markdownPath],
      });

    } finally {
      await closeElectronApp(app);
    }
  });

  test('renders document outlines inline and opens image preview in a detached window after expand', async ({ launchElectronApp, homeDir }) => {
    test.setTimeout(180_000);

    const docxPath = join(homeDir, 'outline-fixture.docx');
    const imagePath = join(homeDir, 'preview-image.png');
    const tinyPngDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9p+9nS8AAAAASUVORK5CYII=';
    const docxHtml = [
      '<h1 id="chapter-1"><strong>Chapter 1 Intro With A Very Long Bold Heading That Should Truncate Inside The Outline Panel</strong></h1>',
      '<p>This is a document preview with an outline.</p>',
      '<div style="height: 1200px;"></div>',
      '<h2 id="chapter-2">Chapter 2 Details</h2>',
      '<p>Clicking the outline should scroll to this section.</p>',
      '<div style="height: 400px;"></div>',
    ].join('');

    await writeFile(docxPath, 'docx placeholder', 'utf8');
    await writeFile(imagePath, 'image placeholder', 'utf8');

    const app = await launchElectronApp({ skipSetup: true });
    const page = await getStableWindow(app);

    try {
      await installGatewaySessionMocks(app, {
        sessionKey: SESSION_KEY,
        messages: [
          {
            id: 'assistant-outline-intro',
            role: 'assistant',
            content: 'Open the outline doc or image from the attachments.',
            timestamp: Math.floor(Date.now() / 1000) - 10,
          },
          {
            id: 'user-outline-message',
            role: 'user',
            content: 'Please inspect these attachments.',
            timestamp: Math.floor(Date.now() / 1000),
            _attachedFiles: [
              {
                fileName: 'outline-fixture.docx',
                mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                fileSize: 2048,
                preview: null,
                filePath: docxPath,
              },
              {
                fileName: 'preview-image.png',
                mimeType: 'image/png',
                fileSize: 1024,
                preview: tinyPngDataUrl,
                filePath: imagePath,
              },
            ],
          },
        ],
      });
      await installHostApiPreviewMocks(app, {
        docxFilePath: docxPath,
        docxHtml,
        imageFilePath: imagePath,
        imagePreview: tinyPngDataUrl,
      });

      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });
      await app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows().at(-1);
        window?.webContents.send('gateway:status-changed', {
          state: 'running',
          port: 18789,
          pid: 12345,
          connectedAt: Date.now(),
        });
      });

      await page.getByTestId(`sidebar-session-${SESSION_KEY}`).click({ force: true });
      const attachmentList = page.getByTestId('chat-user-attachments');
      await expect(attachmentList).toBeVisible({ timeout: 20_000 });
      const docxCard = attachmentList.getByTestId('chat-file-card').nth(0);
      await expect(docxCard).toBeVisible({ timeout: 20_000 });
      await docxCard.click({ force: true });
      const docxPanel = page.getByTestId('chat-file-preview-panel');
      await expect(docxPanel).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('chat-file-preview-outline')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('chat-file-preview-outline-item-0')).toContainText('Chapter 1 Intro');
      await expect(page.getByTestId('chat-file-preview-outline-item-1')).toContainText('Chapter 2 Details');

      await page.getByTestId('chat-file-preview-outline-item-1').click();
      const docxFrame = page.getByTestId('chat-file-preview-docx-frame');
      await expect.poll(async () => {
        return await docxFrame.evaluate((element: HTMLIFrameElement) => {
          const frameDocument = element.contentWindow?.document;
          return frameDocument?.documentElement.scrollTop ?? 0;
        });
      }, { timeout: 20_000 }).toBeGreaterThan(200);

      await page.getByTestId('chat-file-preview-close').click();
      await expect(docxPanel).toHaveCount(0);

      const imageCard = attachmentList.getByTestId('chat-file-card').nth(1);
      await expect(imageCard).toBeVisible({ timeout: 20_000 });

      await imageCard.click({ force: true });
      const inlineImageSurface = page.getByTestId('chat-file-preview-image-surface');
      const inlineImageElement = page.getByTestId('chat-file-preview-image-element');
      await expect(inlineImageSurface).toBeVisible({ timeout: 20_000 });
      await inlineImageSurface.hover();
      await page.mouse.wheel(0, -120);
      await expect.poll(async () => {
        return await inlineImageElement.evaluate((image: HTMLImageElement) => image.style.transform);
      }, { timeout: 20_000 }).toBe('scale(1.25)');
      await page.mouse.wheel(0, 120);
      await expect.poll(async () => {
        return await inlineImageElement.evaluate((image: HTMLImageElement) => image.style.transform);
      }, { timeout: 20_000 }).toBe('scale(1)');
      await expect.poll(async () => await app.evaluate(({ BrowserWindow }) => {
        return BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed()).length;
      }), { timeout: 20_000 }).toBe(1);

      const imageWindowPromise = app.waitForEvent('window');
      await page.getByTestId('chat-file-preview-expand').click();
      const imagePreviewPage = await imageWindowPromise;

      await imagePreviewPage.waitForLoadState('domcontentloaded');
      await expect(imagePreviewPage.getByTestId('chat-file-preview-window')).toBeVisible({ timeout: 20_000 });
      await expect(imagePreviewPage.getByTestId('chat-file-preview-window-minimize')).toBeVisible({ timeout: 20_000 });
      await expect(imagePreviewPage.getByTestId('chat-file-preview-window-maximize')).toBeVisible({ timeout: 20_000 });
      await expect(imagePreviewPage.getByTestId('chat-file-preview-image-surface')).toBeVisible({ timeout: 20_000 });
      await expect(imagePreviewPage.getByTestId('chat-file-preview-image-controls')).toBeVisible({ timeout: 20_000 });
      await expect(imagePreviewPage.getByTestId('chat-file-preview-modal')).toHaveCount(0);
      await expect(imagePreviewPage.getByTestId('chat-file-preview-image-copy')).toBeVisible({ timeout: 20_000 });
      await expect(imagePreviewPage.getByTestId('chat-file-preview-image-zoom-in')).toBeVisible({ timeout: 20_000 });
      await expect(imagePreviewPage.getByTestId('chat-file-preview-image-zoom-out')).toBeVisible({ timeout: 20_000 });
      await expect(imagePreviewPage.getByTestId('chat-file-preview-image-rotate')).toBeVisible({ timeout: 20_000 });
      await expect(imagePreviewPage.getByTestId('chat-file-preview-image-zoom-value')).toHaveText('100%');

      await imagePreviewPage.getByTestId('chat-file-preview-image-surface').hover();
      await imagePreviewPage.mouse.wheel(0, -120);
      await expect(imagePreviewPage.getByTestId('chat-file-preview-image-zoom-value')).toHaveText('125%');
      await imagePreviewPage.mouse.wheel(0, 120);
      await expect(imagePreviewPage.getByTestId('chat-file-preview-image-zoom-value')).toHaveText('100%');

      await imagePreviewPage.getByTestId('chat-file-preview-image-copy').click();
      await installPreviewStateProbe(app);
      await expect.poll(async () => {
        const state = await page.evaluate(async () => {
          return await window.electron.ipcRenderer.invoke('app:request', 'e2e:file-preview-state') as {
            copyRequests: Array<{ filePath?: string; base64?: string }>;
          };
        });
        return state.copyRequests.length;
      }, { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('renders styled docx previews instead of falling back to plain semantic html', async ({ launchElectronApp, homeDir }) => {
    test.setTimeout(180_000);

    const fixtureDocx = await readFile(join(process.cwd(), 'tests', 'e2e', 'fixtures', 'docx-styled-preview.docx'));
    const docxPath = join(homeDir, 'styled-preview.docx');
    const docxHtml = [
      '<h1 id="chapter-1">第一章：简介</h1>',
      '<p>这是一个用于验证会话区 DOCX 预览样式的示例文档。</p>',
      '<h2 id="chapter-2">第二章：列表</h2>',
      '<ul><li>第一项内容</li><li>第二项内容</li><li>第三项内容</li></ul>',
      '<h2 id="chapter-3">第三章：表格</h2>',
      '<table><tbody><tr><th>姓名</th><th>年龄</th><th>城市</th></tr><tr><td>张三</td><td>28</td><td>北京</td></tr></tbody></table>',
    ].join('');

    await writeFile(docxPath, fixtureDocx);

    const app = await launchElectronApp({ skipSetup: true });
    const page = await getStableWindow(app);

    try {
      await installGatewaySessionMocks(app, {
        sessionKey: SESSION_KEY,
        messages: [
          {
            id: 'assistant-styled-docx-intro',
            role: 'assistant',
            content: 'Open the styled DOCX attachment.',
            timestamp: Math.floor(Date.now() / 1000) - 10,
          },
          {
            id: 'user-styled-docx-request',
            role: 'user',
            content: '请检查这个 Word 附件的样式预览。',
            timestamp: Math.floor(Date.now() / 1000),
            _attachedFiles: [
              {
                fileName: 'styled-preview.docx',
                mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                fileSize: fixtureDocx.length,
                preview: null,
                filePath: docxPath,
              },
            ],
          },
        ],
      });
      await installHostApiPreviewMocks(app, {
        docxFilePath: docxPath,
        docxFileName: 'styled-preview.docx',
        docxFileSize: fixtureDocx.length,
        docxHtml,
        docxBinaryBase64: fixtureDocx.toString('base64'),
        docxOutline: [
          {
            id: 'chapter-1',
            text: '第一章：简介',
            level: 1,
            isBold: true,
          },
          {
            id: 'chapter-2',
            text: '第二章：列表',
            level: 2,
            isBold: true,
          },
          {
            id: 'chapter-3',
            text: '第三章：表格',
            level: 2,
            isBold: true,
          },
        ],
      });

      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });
      await app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows().at(-1);
        window?.webContents.send('gateway:status-changed', {
          state: 'running',
          port: 18789,
          pid: 12345,
          connectedAt: Date.now(),
        });
      });

      await page.getByTestId(`sidebar-session-${SESSION_KEY}`).click({ force: true });
      const docxCard = page.getByTestId('chat-file-card').filter({ hasText: 'styled-preview.docx' }).first();
      await expect(docxCard).toBeVisible({ timeout: 20_000 });
      await docxCard.click({ force: true });

      const docxFrame = page.getByTestId('chat-file-preview-docx-frame');
      await expect(docxFrame).toBeVisible({ timeout: 20_000 });
      await expect.poll(async () => {
        return await docxFrame.evaluate((element: HTMLIFrameElement) => {
          const frameDocument = element.contentWindow?.document;
          const heading = frameDocument?.querySelector('p.docx_heading1 span') as HTMLElement | null;
          const paragraph = frameDocument?.querySelector('article p:not([class]) span') as HTMLElement | null;
          const table = frameDocument?.querySelector('table') as HTMLElement | null;
          if (!frameDocument || !heading || !paragraph || !table) {
            return {
              ready: false,
              hasWrapper: false,
              tableClass: '',
            };
          }

          const view = frameDocument.defaultView;
          return {
            ready: true,
            hasWrapper: Boolean(frameDocument.querySelector('.docx-wrapper')),
            headingColor: view?.getComputedStyle(heading).color ?? '',
            headingFontSize: Number.parseFloat(view?.getComputedStyle(heading).fontSize ?? '0'),
            paragraphFontSize: Number.parseFloat(view?.getComputedStyle(paragraph).fontSize ?? '0'),
            tableClass: table.className,
          };
        });
      }, { timeout: 20_000 }).toMatchObject({
        ready: true,
        hasWrapper: true,
      });

      const styledMetrics = await docxFrame.evaluate((element: HTMLIFrameElement) => {
        const frameDocument = element.contentWindow?.document;
        const heading = frameDocument?.querySelector('p.docx_heading1 span') as HTMLElement | null;
        const paragraph = frameDocument?.querySelector('article p:not([class]) span') as HTMLElement | null;
        const table = frameDocument?.querySelector('table') as HTMLElement | null;
        const view = frameDocument?.defaultView;
        return {
          headingColor: heading ? (view?.getComputedStyle(heading).color ?? '') : '',
          headingFontSize: heading ? Number.parseFloat(view?.getComputedStyle(heading).fontSize ?? '0') : 0,
          paragraphFontSize: paragraph ? Number.parseFloat(view?.getComputedStyle(paragraph).fontSize ?? '0') : 0,
          tableClass: table?.className ?? '',
        };
      });

      expect(styledMetrics.tableClass).toContain('docx_');
      expect(styledMetrics.headingFontSize).toBeGreaterThan(styledMetrics.paragraphFontSize);
      expect(styledMetrics.headingColor).not.toBe('rgb(15, 23, 42)');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('flattens explicit docx page breaks into one continuous preview surface', async ({ launchElectronApp, homeDir }) => {
    test.setTimeout(180_000);

    const fixtureDocx = await readFile(join(process.cwd(), 'tests', 'e2e', 'fixtures', 'docx-page-break-preview.docx'));
    const docxPath = join(homeDir, 'page-break-preview.docx');
    await writeFile(docxPath, fixtureDocx);

    const app = await launchElectronApp({ skipSetup: true });
    const page = await getStableWindow(app);

    try {
      await installGatewaySessionMocks(app, {
        sessionKey: SESSION_KEY,
        messages: [
          {
            id: 'assistant-docx-page-break-intro',
            role: 'assistant',
            content: 'Open the paginated DOCX attachment.',
            timestamp: Math.floor(Date.now() / 1000) - 10,
          },
          {
            id: 'user-docx-page-break-request',
            role: 'user',
            content: '看看这个 Word 预览分页是否正确。',
            timestamp: Math.floor(Date.now() / 1000),
            _attachedFiles: [
              {
                fileName: 'page-break-preview.docx',
                mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                fileSize: fixtureDocx.length,
                preview: null,
                filePath: docxPath,
              },
            ],
          },
        ],
      });
      await installHostApiPreviewMocks(app, {
        docxFilePath: docxPath,
        docxFileName: 'page-break-preview.docx',
        docxFileSize: fixtureDocx.length,
        docxBinaryBase64: fixtureDocx.toString('base64'),
        docxHtml: '<h1 id="page-1">分页测试封面</h1><p>第一页内容应该停在这里。</p><h1 id="page-2">第二页开始</h1><p>如果分页准确，这段应该出现在新的页面。</p>',
        docxOutline: [
          { id: 'page-1', text: '分页测试封面', level: 1, isBold: true },
          { id: 'page-2', text: '第二页开始', level: 1, isBold: true },
        ],
      });

      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });
      await app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows().at(-1);
        window?.webContents.send('gateway:status-changed', {
          state: 'running',
          port: 18789,
          pid: 12345,
          connectedAt: Date.now(),
        });
      });

      await page.getByTestId(`sidebar-session-${SESSION_KEY}`).click({ force: true });
      const docxCard = page.getByTestId('chat-file-card').filter({ hasText: 'page-break-preview.docx' }).first();
      await expect(docxCard).toBeVisible({ timeout: 20_000 });
      await docxCard.click({ force: true });

      const docxFrame = page.getByTestId('chat-file-preview-docx-frame');
      await expect.poll(async () => {
        return await docxFrame.evaluate((element: HTMLIFrameElement) => {
          const frameDocument = element.contentWindow?.document;
          const sections = Array.from(frameDocument?.querySelectorAll('section.docx') ?? []);
          return {
            sectionCount: sections.length,
            paragraphCount: frameDocument?.querySelectorAll('section.docx article p').length ?? 0,
          };
        });
      }, { timeout: 20_000 }).toMatchObject({
        sectionCount: 1,
      });

      const flowState = await docxFrame.evaluate((element: HTMLIFrameElement) => {
        const frameDocument = element.contentWindow?.document;
        const sections = Array.from(frameDocument?.querySelectorAll('section.docx') ?? []);
        return {
          sectionCount: sections.length,
          paragraphCount: frameDocument?.querySelectorAll('section.docx article p').length ?? 0,
          textLength: sections[0]?.textContent?.replace(/\s+/g, ' ').trim().length ?? 0,
        };
      });

      expect(flowState.sectionCount).toBe(1);
      expect(flowState.paragraphCount).toBeGreaterThanOrEqual(4);
      expect(flowState.textLength).toBeGreaterThan(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('keeps text-like previews on the system stack while preserving monospace only for code', async ({ launchElectronApp, homeDir }) => {
    test.setTimeout(180_000);

    const markdownPath = join(homeDir, 'system-font-preview.md');
    const textPath = join(homeDir, 'system-font-preview.txt');
    const codePath = join(homeDir, 'system-font-preview.ts');
    const spreadsheetPath = join(homeDir, 'system-font-preview.xlsx');
    const docxPath = join(homeDir, 'system-font-preview.docx');
    const presentationPath = join(homeDir, 'system-font-preview.pptx');
    const markdownBody = '# System Font Preview\n\nThis markdown preview should stay on the system UI font stack.\n';
    const textBody = 'Plain text preview should follow the same system font stack.\nSecond line for preview coverage.\n';
    const codeBody = 'export const previewFont = "monospace";\n';
    const docxHtml = '<h1 id="chapter-1">System Font Preview</h1><p>The document iframe should inherit the same system stack.</p>';

    await Promise.all([
      writeFile(markdownPath, markdownBody, 'utf8'),
      writeFile(textPath, textBody, 'utf8'),
      writeFile(codePath, codeBody, 'utf8'),
      writeFile(spreadsheetPath, 'spreadsheet placeholder', 'utf8'),
      writeFile(docxPath, 'docx placeholder', 'utf8'),
      writeFile(presentationPath, 'presentation placeholder', 'utf8'),
    ]);

    const app = await launchElectronApp({ skipSetup: true });
    const page = await getStableWindow(app);

    try {
      await installGatewaySessionMocks(app, {
        sessionKey: SESSION_KEY,
        messages: [
          {
            id: 'assistant-system-font-intro',
            role: 'assistant',
            content: 'Check the preview typography across the attached files.',
            timestamp: Math.floor(Date.now() / 1000) - 10,
          },
          {
            id: 'user-system-font-request',
            role: 'user',
            content: 'Please preview these files.',
            timestamp: Math.floor(Date.now() / 1000),
            _attachedFiles: [
              {
                fileName: 'system-font-preview.md',
                mimeType: 'text/markdown',
                fileSize: markdownBody.length,
                preview: null,
                filePath: markdownPath,
              },
              {
                fileName: 'system-font-preview.txt',
                mimeType: 'text/plain',
                fileSize: textBody.length,
                preview: null,
                filePath: textPath,
              },
              {
                fileName: 'system-font-preview.ts',
                mimeType: 'text/typescript',
                fileSize: codeBody.length,
                preview: null,
                filePath: codePath,
              },
              {
                fileName: 'system-font-preview.xlsx',
                mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                fileSize: 2048,
                preview: null,
                filePath: spreadsheetPath,
              },
              {
                fileName: 'system-font-preview.docx',
                mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                fileSize: 2048,
                preview: null,
                filePath: docxPath,
              },
              {
                fileName: 'system-font-preview.pptx',
                mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                fileSize: 4096,
                preview: null,
                filePath: presentationPath,
              },
            ],
          },
        ],
      });
      await installHostApiPreviewMocks(app, {
        markdownFilePath: markdownPath,
        markdownBody,
        textFilePath: textPath,
        textBody,
        codeFilePath: codePath,
        codeBody,
        codeLanguage: 'typescript',
        spreadsheetFilePath: spreadsheetPath,
        spreadsheetFileName: 'system-font-preview.xlsx',
        spreadsheetFileSize: 2048,
        spreadsheetSheets: [
          {
            name: 'Summary',
            rows: [
              ['Item', 'Status'],
              ['Typography', 'System UI'],
            ],
            rowCount: 2,
            columnCount: 2,
            truncatedRows: false,
            truncatedColumns: false,
          },
        ],
        docxFilePath: docxPath,
        docxHtml,
        presentationFilePath: presentationPath,
        presentationFileName: 'system-font-preview.pptx',
        presentationFileSize: 4096,
        presentationPreviewId: 'system-font-presentation-preview',
        presentationSlideWidth: 960,
        presentationSlideHeight: 540,
        presentationSlides: [
          {
            index: 1,
            title: 'System Font Slide',
            paragraphs: ['Presentation preview text should keep the same system UI stack.'],
            truncatedParagraphs: false,
          },
        ],
        presentationSlideHtmlByIndex: {
          1: '<div class="slide" style="position: relative; width: 960px; height: 540px; overflow: hidden; background-color: #ffffff;"><div style="position:absolute;left:96px;top:120px;font-size:32px;font-weight:700;color:#0f172a;">System Font Slide</div><div style="position:absolute;left:96px;top:204px;font-size:18px;color:#334155;">Presentation preview text should keep the same system UI stack.</div></div>',
        },
      });

      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });
      await app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows().at(-1);
        window?.webContents.send('gateway:status-changed', {
          state: 'running',
          port: 18789,
          pid: 12345,
          connectedAt: Date.now(),
        });
      });

      await page.getByTestId(`sidebar-session-${SESSION_KEY}`).click({ force: true });
      const attachmentList = page.getByTestId('chat-user-attachments');
      await expect(attachmentList).toBeVisible({ timeout: 20_000 });

      const markdownCard = attachmentList.getByTestId('chat-file-card').filter({ hasText: 'system-font-preview.md' }).first();
      await markdownCard.click({ force: true });
      const markdownSurface = page.getByTestId('chat-file-preview-markdown-surface');
      await expect(markdownSurface).toBeVisible({ timeout: 20_000 });
      const markdownFont = normalizeFontFamily(await markdownSurface.evaluate((element) => {
        return window.getComputedStyle(element).fontFamily;
      }));

      const textCard = attachmentList.getByTestId('chat-file-card').filter({ hasText: 'system-font-preview.txt' }).first();
      await textCard.click({ force: true });
      const textSurface = page.getByTestId('chat-file-preview-textual-content');
      await expect(textSurface).toHaveAttribute('data-kind', 'text');
      const textFont = normalizeFontFamily(await textSurface.evaluate((element) => {
        return window.getComputedStyle(element).fontFamily;
      }));

      const codeCard = attachmentList.getByTestId('chat-file-card').filter({ hasText: 'system-font-preview.ts' }).first();
      await codeCard.click({ force: true });
      const codeSurface = page.getByTestId('chat-file-preview-textual-content');
      await expect(codeSurface).toHaveAttribute('data-kind', 'code');
      const codeFont = normalizeFontFamily(await codeSurface.evaluate((element) => {
        return window.getComputedStyle(element).fontFamily;
      }));

      const spreadsheetCard = attachmentList.getByTestId('chat-file-card').filter({ hasText: 'system-font-preview.xlsx' }).first();
      await spreadsheetCard.click({ force: true });
      const spreadsheetSurface = page.getByTestId('chat-file-preview-spreadsheet');
      await expect(spreadsheetSurface).toBeVisible({ timeout: 20_000 });
      const spreadsheetFont = normalizeFontFamily(await spreadsheetSurface.evaluate((element) => {
        return window.getComputedStyle(element).fontFamily;
      }));

      const docxCard = attachmentList.getByTestId('chat-file-card').filter({ hasText: 'system-font-preview.docx' }).first();
      await docxCard.click({ force: true });
      const docxFrame = page.getByTestId('chat-file-preview-docx-frame');
      await expect.poll(async () => {
        return await docxFrame.evaluate((element: HTMLIFrameElement) => {
          const frameDocument = element.contentWindow?.document;
          return frameDocument?.body
            ? frameDocument.defaultView?.getComputedStyle(frameDocument.body).fontFamily ?? ''
            : '';
        });
      }, { timeout: 20_000 }).not.toBe('');
      const docxFont = normalizeFontFamily(await docxFrame.evaluate((element: HTMLIFrameElement) => {
        const frameDocument = element.contentWindow?.document;
        return frameDocument?.body
          ? frameDocument.defaultView?.getComputedStyle(frameDocument.body).fontFamily ?? ''
          : '';
      }));

      const presentationCard = attachmentList.getByTestId('chat-file-card').filter({ hasText: 'system-font-preview.pptx' }).first();
      await presentationCard.click({ force: true });
      const presentationScroller = page.getByTestId('chat-file-preview-presentation-scroller');
      await expect(presentationScroller).toBeVisible({ timeout: 20_000 });
      const presentationFont = normalizeFontFamily(await presentationScroller.evaluate((element) => {
        return window.getComputedStyle(element).fontFamily;
      }));

      expect(textFont).toBe(markdownFont);
      expect(spreadsheetFont).toBe(markdownFont);
      expect(docxFont).toBe(markdownFont);
      expect(presentationFont).toBe(markdownFont);
      expect(codeFont).not.toBe(textFont);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('renders chinese csv spreadsheet previews without mojibake in the chat panel', async ({ launchElectronApp, homeDir }) => {
    test.setTimeout(180_000);

    const csvPath = join(homeDir, 'contacts-preview.csv');
    await writeFile(csvPath, 'csv placeholder', 'utf8');

    const app = await launchElectronApp({ skipSetup: true });
    const page = await getStableWindow(app);

    try {
      await installGatewaySessionMocks(app, {
        sessionKey: SESSION_KEY,
        messages: [
          {
            id: 'assistant-csv-preview-intro',
            role: 'assistant',
            content: '请打开这份 CSV 看看中文预览是否正常。',
            timestamp: Math.floor(Date.now() / 1000) - 10,
          },
          {
            id: 'user-csv-preview-message',
            role: 'user',
            content: '我想确认会话里的表格预览不再乱码。',
            timestamp: Math.floor(Date.now() / 1000),
            _attachedFiles: [
              {
                fileName: 'contacts-preview.csv',
                mimeType: 'text/csv',
                fileSize: 256,
                preview: null,
                filePath: csvPath,
              },
            ],
          },
        ],
      });
      await installHostApiPreviewMocks(app, {
        spreadsheetFilePath: csvPath,
        spreadsheetFileName: 'contacts-preview.csv',
        spreadsheetMimeType: 'text/csv',
        spreadsheetFileSize: 256,
        spreadsheetSheets: [
          {
            name: 'Sheet1',
            rows: [
              ['姓名', '年龄', '城市'],
              ['张三', '28', '北京'],
              ['李四', '32', '上海'],
            ],
            rowCount: 3,
            columnCount: 3,
            truncatedRows: false,
            truncatedColumns: false,
          },
        ],
      });

      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });
      await app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows().at(-1);
        window?.webContents.send('gateway:status-changed', {
          state: 'running',
          port: 18789,
          pid: 12345,
          connectedAt: Date.now(),
        });
      });

      await page.getByTestId(`sidebar-session-${SESSION_KEY}`).click({ force: true });
      const attachmentList = page.getByTestId('chat-user-attachments');
      await expect(attachmentList).toBeVisible({ timeout: 20_000 });

      const csvCard = attachmentList.getByTestId('chat-file-card').filter({ hasText: 'contacts-preview.csv' }).first();
      await expect(csvCard).toBeVisible({ timeout: 20_000 });
      await csvCard.click({ force: true });

      const spreadsheetSurface = page.getByTestId('chat-file-preview-spreadsheet');
      await expect(spreadsheetSurface).toBeVisible({ timeout: 20_000 });
      await expect(spreadsheetSurface).toContainText('姓名');
      await expect(spreadsheetSurface).toContainText('张三');
      await expect(spreadsheetSurface).toContainText('上海');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('renders a larger pptx attachment inline and can expand it into the detached preview window', async ({ launchElectronApp, homeDir }) => {
    test.setTimeout(180_000);

    const presentationPath = join(homeDir, 'large-deck.pptx');
    const presentationFileSize = 22 * 1024 * 1024;
    const presentationSlideImageByIndex = {
      1: createPresentationSlideDataUrl({
        title: 'Quarterly Business Review',
        body: 'Revenue grew 18% year over year.',
        accent: '#0f3d73',
      }),
      2: createPresentationSlideDataUrl({
        title: 'Roadmap',
        body: 'Focus areas include onboarding, analytics, and approval flow upgrades.',
        accent: '#1d4ed8',
      }),
      3: createPresentationSlideDataUrl({
        title: 'Regional Performance',
        body: 'APAC bookings rose 24% while customer retention improved across enterprise accounts.',
        accent: '#0f172a',
      }),
      4: createPresentationSlideDataUrl({
        title: 'Operating Priorities',
        body: 'Delivery teams are reducing approval latency and tightening launch readiness checklists.',
        accent: '#334155',
      }),
    };

    await writeFile(presentationPath, 'presentation placeholder', 'utf8');

    const app = await launchElectronApp({ skipSetup: true });
    const page = await getStableWindow(app);

    try {
      await installGatewaySessionMocks(app, {
        sessionKey: SESSION_KEY,
        messages: [
          {
            id: 'assistant-presentation-intro',
            role: 'assistant',
            content: 'Open the larger deck from the attachment list.',
            timestamp: Math.floor(Date.now() / 1000) - 10,
          },
          {
            id: 'user-presentation-message',
            role: 'user',
            content: 'Please preview this presentation directly in the app.',
            timestamp: Math.floor(Date.now() / 1000),
            _attachedFiles: [
              {
                fileName: 'large-deck.pptx',
                mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                fileSize: presentationFileSize,
                preview: null,
                filePath: presentationPath,
              },
            ],
          },
        ],
      });
      await installHostApiPreviewMocks(app, {
        presentationFilePath: presentationPath,
        presentationFileName: 'large-deck.pptx',
        presentationFileSize,
        presentationPreviewId: 'large-deck-preview',
        presentationRenderMode: 'image',
        presentationSlideWidth: 960,
        presentationSlideHeight: 540,
        presentationSlides: [
          {
            index: 1,
            title: 'Quarterly Business Review',
            paragraphs: [
              'Quarterly Business Review',
              'Revenue grew 18% year over year.',
              'North America remained the fastest-growing region.',
            ],
            truncatedParagraphs: false,
          },
          {
            index: 2,
            title: 'Roadmap',
            paragraphs: [
              'Roadmap',
              'Focus areas include onboarding, analytics, and approval flow upgrades.',
            ],
            truncatedParagraphs: true,
          },
          {
            index: 3,
            title: 'Regional Performance',
            paragraphs: [
              'Regional Performance',
              'APAC bookings rose 24% while customer retention improved across enterprise accounts.',
            ],
            truncatedParagraphs: false,
          },
          {
            index: 4,
            title: 'Operating Priorities',
            paragraphs: [
              'Operating Priorities',
              'Delivery teams are reducing approval latency and tightening launch readiness checklists.',
            ],
            truncatedParagraphs: false,
          },
        ],
        presentationSlideImageByIndex,
        presentationTruncatedSlides: true,
      });

      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });
      await app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows().at(-1);
        window?.webContents.send('gateway:status-changed', {
          state: 'running',
          port: 18789,
          pid: 12345,
          connectedAt: Date.now(),
        });
      });

      await page.getByTestId(`sidebar-session-${SESSION_KEY}`).click({ force: true });
      const attachmentList = page.getByTestId('chat-user-attachments');
      await expect(attachmentList).toBeVisible({ timeout: 20_000 });
      const presentationCard = attachmentList.getByTestId('chat-file-card').first();
      await expect(presentationCard).toBeVisible({ timeout: 20_000 });

      await presentationCard.click({ force: true });
      const previewPanel = page.getByTestId('chat-file-preview-panel');
      await expect(previewPanel).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('chat-file-preview-header')).toContainText('large-deck.pptx');
      await expect(page.getByTestId('chat-file-preview-header')).toContainText('22.00 MB');
      const presentationScroller = page.getByTestId('chat-file-preview-presentation-scroller');
      await expect(presentationScroller).toBeVisible({ timeout: 20_000 });
      await expect(presentationScroller).toHaveCSS('border-top-width', '0px');
      await expect(presentationScroller).toHaveCSS('box-shadow', 'none');
      const initialScrollMetrics = await presentationScroller.evaluate((element: HTMLDivElement) => ({
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        scrollTop: element.scrollTop,
      }));
      expect(initialScrollMetrics.scrollHeight).toBeGreaterThan(initialScrollMetrics.clientHeight + 100);
      const firstSlidePage = page.getByTestId('chat-file-preview-presentation-page-0');
      await expect.poll(async () => {
        return await firstSlidePage.evaluate((element) => window.getComputedStyle(element).boxShadow);
      }, { timeout: 20_000 }).not.toBe('none');
      const firstSlideFrame = page.getByTestId('chat-file-preview-presentation-frame-0');
      await expect(firstSlideFrame).toBeVisible({ timeout: 20_000 });
      await expect.poll(async () => {
        return await firstSlideFrame.evaluate((element) => {
          return element.tagName;
        });
      }, { timeout: 20_000 }).toBe('IMG');
      await expect(firstSlideFrame).toHaveAttribute('src', /Quarterly%20Business%20Review/);

      await page.getByTestId('chat-file-preview-presentation-stage').hover();
      await page.mouse.wheel(0, 120);
      await page.mouse.wheel(0, 120);
      await page.mouse.wheel(0, 120);
      await expect.poll(async () => {
        return await presentationScroller.evaluate((element: HTMLDivElement) => element.scrollTop);
      }, { timeout: 20_000 }).toBeGreaterThan(initialScrollMetrics.scrollTop + 30);

      await presentationScroller.evaluate((element: HTMLDivElement) => {
        element.scrollTo({ top: element.scrollHeight, behavior: 'auto' });
      });
      await expect(page.getByTestId('chat-file-preview-presentation-section-1')).toBeVisible();
      const secondSlideFrame = page.getByTestId('chat-file-preview-presentation-frame-1');
      await expect(secondSlideFrame).toBeVisible({ timeout: 20_000 });
      await expect(secondSlideFrame).toHaveAttribute('src', /Roadmap/);
      await expect(secondSlideFrame).toHaveAttribute('alt', 'Roadmap');

      const previewWindowPromise = app.waitForEvent('window');
      await page.getByTestId('chat-file-preview-expand').click();
      const previewPage = await previewWindowPromise;

      await previewPage.waitForLoadState('domcontentloaded');
      await expect(previewPage.getByTestId('chat-file-preview-window')).toBeVisible({ timeout: 20_000 });
      await expect(previewPage.getByTestId('chat-file-preview-window-header')).toContainText('large-deck.pptx');
      await expect(previewPage.getByTestId('chat-file-preview-window-header')).toContainText('22.00 MB');
      await expect(previewPage.getByTestId('chat-file-preview-presentation-scroller')).toBeVisible({ timeout: 20_000 });
      const detachedSecondSlideFrame = previewPage.getByTestId('chat-file-preview-presentation-frame-1');
      await expect(detachedSecondSlideFrame).toBeVisible({ timeout: 20_000 });
      await expect(detachedSecondSlideFrame).toHaveAttribute('src', /Roadmap/);
      await expect(detachedSecondSlideFrame).toHaveAttribute('alt', 'Roadmap');

      await Promise.all([
        previewPage.waitForEvent('close'),
        previewPage.getByTestId('chat-file-preview-window-close').click({ force: true }),
      ]);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('keeps the history session content centered and width-stable when file cards are present', async ({ launchElectronApp, homeDir }) => {
    test.setTimeout(180_000);

    const markdownPath = join(homeDir, 'stable-width-preview.md');
    const docxPath = join(homeDir, 'test_document.docx');
    await writeFile(markdownPath, '# Stable Width Preview\n\nThis file is used to open the preview panel.\n', 'utf8');

    const assistantBody = [
      '斌哥，收到！所有文件都成功输出了！✅',
      '',
      '## 输出文件清单',
      '',
      ...Array.from(
        { length: 28 },
        (_value, index) => `- 条目 ${index + 1}：这里是用于验证聊天正文宽度稳定性的较长说明文本，滚动前后都不应该让消息轨道变窄。`,
      ),
      '',
      '---',
      '',
      '继续向上滚动时，正文和附件应该保持在同一条内容轨道里。',
    ].join('\n');

    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installGatewaySessionMocks(app, {
        sessionKey: SESSION_KEY,
        messages: [
          {
            id: 'assistant-width-intro',
            role: 'assistant',
            content: '先打开一个附件预览，再关闭它，然后继续往上滚动。',
            timestamp: Math.floor(Date.now() / 1000) - 20,
          },
          {
            id: 'user-width-request',
            role: 'user',
            content: '我想确认预览关闭以后聊天宽度不会再变。',
            timestamp: Math.floor(Date.now() / 1000) - 10,
          },
          {
            id: 'assistant-width-final',
            role: 'assistant',
            content: assistantBody,
            timestamp: Math.floor(Date.now() / 1000),
            _attachedFiles: [
              {
                fileName: 'stable-width-preview.md',
                mimeType: 'text/markdown',
                fileSize: 96,
                preview: null,
                filePath: markdownPath,
              },
              {
                fileName: 'result-summary.txt',
                mimeType: 'text/plain',
                fileSize: 423,
                preview: null,
                filePath: join(homeDir, 'result-summary.txt'),
              },
              {
                fileName: 'test_data.xlsx',
                mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                fileSize: 5427,
                preview: null,
                filePath: join(homeDir, 'test_data.xlsx'),
              },
              {
                fileName: 'test_document.docx',
                mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                fileSize: 37146,
                preview: null,
                filePath: docxPath,
              },
              {
                fileName: 'test_presentation.pptx',
                mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                fileSize: 31924,
                preview: null,
                filePath: join(homeDir, 'test_presentation.pptx'),
              },
              {
                fileName: 'test_image.png',
                mimeType: 'image/png',
                fileSize: 2451,
                preview: null,
                filePath: join(homeDir, 'test_image.png'),
              },
            ],
          },
        ],
      });
      await installHostApiPreviewMocks(app, {
        markdownFilePath: markdownPath,
        markdownBody: '# Stable Width Preview\n\n- The preview closes back into chat.\n- The chat rail should keep the same width after scrolling.\n',
        docxFilePath: docxPath,
        docxHtml: '<h1 id="chapter-1">Chapter 1</h1><p>Preview switch coverage.</p><h2 id="chapter-2">Chapter 2</h2><p>Sidebar restore coverage.</p>',
        settingsOverrides: {
          assistantMessageStyle: 'stream',
          chatProcessDisplayMode: 'all',
          hideInternalRoutineProcesses: true,
          chatFontScale: 100,
        },
      });

      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });
      await app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows().at(-1);
        window?.webContents.send('gateway:status-changed', {
          state: 'running',
          port: 18789,
          pid: 12345,
          connectedAt: Date.now(),
        });
      });

      const sessionButton = page.getByTestId(`sidebar-session-${SESSION_KEY}`).locator('button').first();
      await expect(sessionButton).toBeVisible({ timeout: 20_000 });
      await sessionButton.click({ force: true });

      const previewCard = page.getByTestId('chat-file-card').filter({ hasText: 'stable-width-preview.md' }).first();
      await expect(previewCard).toBeVisible({ timeout: 20_000 });

      const assistantContent = page.getByTestId('chat-message-content-assistant').last();
      const assistantShell = page.getByTestId('chat-assistant-message-shell').last();
      const assistantStream = page.getByTestId('chat-assistant-message-stream').last();
      const assistantAttachments = page.getByTestId('chat-assistant-attachments').last();
      const contentColumn = page.getByTestId('chat-content-column').last();
      const composer = page.getByTestId('chat-composer');
      const chatScrollContainer = page.getByTestId('chat-scroll-container');
      const mainPane = page.getByTestId('chat-main-pane');

      await expect(assistantContent).toBeVisible({ timeout: 20_000 });
      await expect(assistantShell).toBeVisible({ timeout: 20_000 });
      await expect(assistantStream).toBeVisible({ timeout: 20_000 });
      await expect(assistantAttachments).toBeVisible({ timeout: 20_000 });
      await expect(contentColumn).toBeVisible({ timeout: 20_000 });
      await expect(composer).toBeVisible({ timeout: 20_000 });

      const beforeScroll = {
        contentColumn: await contentColumn.boundingBox(),
        content: await assistantContent.boundingBox(),
        shell: await assistantShell.boundingBox(),
        stream: await assistantStream.boundingBox(),
        attachments: await assistantAttachments.boundingBox(),
        composer: await composer.boundingBox(),
        mainPane: await mainPane.boundingBox(),
        scrollContainer: await chatScrollContainer.boundingBox(),
      };

      expect(beforeScroll.contentColumn).not.toBeNull();
      expect(beforeScroll.content).not.toBeNull();
      expect(beforeScroll.shell).not.toBeNull();
      expect(beforeScroll.stream).not.toBeNull();
      expect(beforeScroll.attachments).not.toBeNull();
      expect(beforeScroll.composer).not.toBeNull();
      expect(beforeScroll.mainPane).not.toBeNull();
      expect(beforeScroll.contentColumn?.width ?? 0).toBeGreaterThanOrEqual(860);
      expect(beforeScroll.contentColumn?.width ?? 0).toBeLessThanOrEqual(866);
      expect(Math.abs((beforeScroll.shell?.width ?? 0) - (beforeScroll.contentColumn?.width ?? 0))).toBeLessThanOrEqual(2);
      expect(Math.abs((beforeScroll.content?.width ?? 0) - (beforeScroll.contentColumn?.width ?? 0))).toBeLessThanOrEqual(2);
      expect(Math.abs((beforeScroll.attachments?.width ?? 0) - (beforeScroll.contentColumn?.width ?? 0))).toBeLessThanOrEqual(2);
      expect(Math.abs((beforeScroll.content?.width ?? 0) - (beforeScroll.attachments?.width ?? 0))).toBeLessThanOrEqual(2);
      expect(Math.abs((beforeScroll.stream?.width ?? 0) - (beforeScroll.attachments?.width ?? 0))).toBeLessThanOrEqual(2);
      expect(Math.abs((beforeScroll.shell?.x ?? 0) - (beforeScroll.contentColumn?.x ?? 0))).toBeLessThanOrEqual(2);
      expect(Math.abs((beforeScroll.content?.x ?? 0) - (beforeScroll.contentColumn?.x ?? 0))).toBeLessThanOrEqual(2);
      expect(Math.abs((beforeScroll.attachments?.x ?? 0) - (beforeScroll.contentColumn?.x ?? 0))).toBeLessThanOrEqual(2);
      expect(Math.abs((beforeScroll.composer?.x ?? 0) - (beforeScroll.contentColumn?.x ?? 0))).toBeLessThanOrEqual(2);
      expect(Math.abs(((beforeScroll.composer?.x ?? 0) + (beforeScroll.composer?.width ?? 0)) - ((beforeScroll.contentColumn?.x ?? 0) + (beforeScroll.contentColumn?.width ?? 0)))).toBeLessThanOrEqual(2);
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
        content: await assistantContent.boundingBox(),
        stream: await assistantStream.boundingBox(),
      };

      expect(afterScroll.content).not.toBeNull();
      expect(afterScroll.stream).not.toBeNull();
      expect(Math.abs((afterScroll.content?.width ?? 0) - (beforeScroll.content?.width ?? 0))).toBeLessThanOrEqual(2);
      expect(Math.abs((afterScroll.stream?.width ?? 0) - (beforeScroll.stream?.width ?? 0))).toBeLessThanOrEqual(2);
    } finally {
      await closeElectronApp(app);
    }
  });
});
