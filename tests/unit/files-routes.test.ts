import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';
import crypto from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PPTX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const originalPlatform = process.platform;

const {
  accessMock,
  copyFileMock,
  mkdirMock,
  parseJsonBodyMock,
  pptxToHtmlMock,
  readdirMock,
  readFileMock,
  resolveStagedUploadFilePathMock,
  resolveUserUploadStorageDirMock,
  rmMock,
  sendJsonMock,
  statMock,
  writeFileMock,
} = vi.hoisted(() => ({
  accessMock: vi.fn(),
  copyFileMock: vi.fn(),
  mkdirMock: vi.fn(),
  parseJsonBodyMock: vi.fn(),
  pptxToHtmlMock: vi.fn(),
  readdirMock: vi.fn(),
  readFileMock: vi.fn(),
  resolveStagedUploadFilePathMock: vi.fn(),
  resolveUserUploadStorageDirMock: vi.fn(),
  rmMock: vi.fn(),
  sendJsonMock: vi.fn(),
  statMock: vi.fn(),
  writeFileMock: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    getAppPath: () => 'D:\\AI\\Deep AI Worker\\ClawX',
  },
  dialog: {
    showSaveDialog: vi.fn(),
  },
  nativeImage: {
    createFromPath: vi.fn(() => ({
      isEmpty: () => true,
      getSize: () => ({ width: 0, height: 0 }),
      resize: () => ({
        toPNG: () => Buffer.alloc(0),
      }),
      toPNG: () => Buffer.alloc(0),
    })),
    createFromBuffer: vi.fn(() => ({
      isEmpty: () => true,
      getSize: () => ({ width: 0, height: 0 }),
      resize: () => ({
        toPNG: () => Buffer.alloc(0),
      }),
      toPNG: () => Buffer.alloc(0),
    })),
  },
}));

vi.mock('node:fs/promises', () => ({
  access: (...args: unknown[]) => accessMock(...args),
  copyFile: (...args: unknown[]) => copyFileMock(...args),
  mkdir: (...args: unknown[]) => mkdirMock(...args),
  readdir: (...args: unknown[]) => readdirMock(...args),
  readFile: (...args: unknown[]) => readFileMock(...args),
  rm: (...args: unknown[]) => rmMock(...args),
  stat: (...args: unknown[]) => statMock(...args),
  writeFile: (...args: unknown[]) => writeFileMock(...args),
  default: {
    access: (...args: unknown[]) => accessMock(...args),
    copyFile: (...args: unknown[]) => copyFileMock(...args),
    mkdir: (...args: unknown[]) => mkdirMock(...args),
    readdir: (...args: unknown[]) => readdirMock(...args),
    readFile: (...args: unknown[]) => readFileMock(...args),
    rm: (...args: unknown[]) => rmMock(...args),
    stat: (...args: unknown[]) => statMock(...args),
    writeFile: (...args: unknown[]) => writeFileMock(...args),
  },
}));

vi.mock('@jvmr/pptx-to-html', () => ({
  pptxToHtml: (...args: unknown[]) => pptxToHtmlMock(...args),
}));

vi.mock('@xmldom/xmldom', () => ({
  DOMParser: class {
    parseFromString(): Document {
      return {} as Document;
    }
  },
}));

vi.mock('@electron/api/route-utils', () => ({
  parseJsonBody: (...args: unknown[]) => parseJsonBodyMock(...args),
  sendJson: (...args: unknown[]) => sendJsonMock(...args),
}));

vi.mock('../../electron/api/route-utils', () => ({
  parseJsonBody: (...args: unknown[]) => parseJsonBodyMock(...args),
  sendJson: (...args: unknown[]) => sendJsonMock(...args),
}));

vi.mock('@electron/utils/session-file-storage', () => ({
  materializeAssistantOutputFiles: vi.fn(),
  resolveAssistantOutputStorageDir: vi.fn(),
  resolveUserUploadStorageDir: (...args: unknown[]) => resolveUserUploadStorageDirMock(...args),
  resolveStagedUploadFilePath: (...args: unknown[]) => resolveStagedUploadFilePathMock(...args),
}));

vi.mock('../../electron/utils/session-file-storage', () => ({
  materializeAssistantOutputFiles: vi.fn(),
  resolveAssistantOutputStorageDir: vi.fn(),
  resolveUserUploadStorageDir: (...args: unknown[]) => resolveUserUploadStorageDirMock(...args),
  resolveStagedUploadFilePath: (...args: unknown[]) => resolveStagedUploadFilePathMock(...args),
}));

describe('handleFileRoutes presentation previews', () => {
  const storedPreviewFiles = new Map<string, string>();
  const testGlobal = globalThis as typeof globalThis & {
    __clawxPptxToHtmlModule?: {
      pptxToHtml: (...args: unknown[]) => Promise<string[]>;
    };
    __clawxPresentationImageExporter?: (
      options: { filePath: string; dirPath: string },
    ) => Promise<{
      slideWidth: number;
      slideHeight: number;
      slideCount: number;
      truncatedSlides: boolean;
    } | null>;
    __clawxOfficePagesPdfExporter?: (
      options: { filePath: string; dirPath: string; extension: string },
    ) => Promise<string | null>;
  };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
    storedPreviewFiles.clear();
    testGlobal.__clawxPptxToHtmlModule = {
      pptxToHtml: (...args: unknown[]) => pptxToHtmlMock(...args),
    };

    readFileMock.mockImplementation(async (filePath: string, encoding?: BufferEncoding) => {
      if (encoding === 'utf8' && storedPreviewFiles.has(filePath)) {
        return storedPreviewFiles.get(filePath)!;
      }
      return Buffer.from('pptx-buffer');
    });
    writeFileMock.mockImplementation(async (filePath: string, content: string) => {
      storedPreviewFiles.set(filePath, String(content));
    });
    accessMock.mockResolvedValue(undefined);
    copyFileMock.mockResolvedValue(undefined);
    mkdirMock.mockResolvedValue(undefined);
    readdirMock.mockResolvedValue([]);
    resolveUserUploadStorageDirMock.mockResolvedValue('D:\\staged');
    resolveStagedUploadFilePathMock.mockImplementation(async (_targetDir: string, fileName: string) => {
      return `D:\\staged\\${String(fileName).split(/[\\/]/).pop() ?? 'file'}`;
    });
    rmMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    delete testGlobal.__clawxPptxToHtmlModule;
    delete testGlobal.__clawxPresentationImageExporter;
    delete testGlobal.__clawxOfficePagesPdfExporter;
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
    });
  });

  it('prefers LibreOffice office-page rendering for pptx previews when PDF output is available', async () => {
    const filePath = 'D:\\fixtures\\office-pages-review.pptx';
    const fileSize = 22 * 1024 * 1024;

    testGlobal.__clawxOfficePagesPdfExporter = vi.fn(async ({ dirPath }) => {
      return join(dirPath, 'document.pdf');
    });
    parseJsonBodyMock.mockResolvedValue({
      filePath,
      fileName: 'office-pages-review.pptx',
      mimeType: PPTX_MIME_TYPE,
    });
    statMock.mockResolvedValue({
      size: fileSize,
      mtimeMs: 1_710_000_000_111,
    });

    const { handleFileRoutes } = await import('@electron/api/routes/files');

    const handled = await handleFileRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1/api/files/preview'),
      { store: {}, gateway: {} },
    );

    expect(handled).toBe(true);
    expect(pptxToHtmlMock).not.toHaveBeenCalled();
    expect(testGlobal.__clawxPresentationImageExporter).toBeUndefined();
    expect(sendJsonMock).toHaveBeenCalledWith(expect.anything(), 200, expect.objectContaining({
      kind: 'office-pages',
      fileName: 'office-pages-review.pptx',
      mimeType: PPTX_MIME_TYPE,
      fileSize,
      previewId: expect.any(String),
      pageCount: 1,
      truncatedPages: false,
    }));
  });

  it('builds a cached visual pptx preview with slide metadata', async () => {
    const filePath = 'D:\\fixtures\\quarterly-review.pptx';
    const fileSize = 22 * 1024 * 1024;
    const slideHtml = [
      '<div class="slide" style="position: relative; width: 960px; height: 540px; overflow: hidden; background-color: #fff;"><div>Quarterly Business Review</div><div>Revenue grew 18% year over year.</div></div>',
      '<div class="slide" style="position: relative; width: 960px; height: 540px; overflow: hidden; background-color: #fff;"><div>Roadmap</div><div>Focus areas include onboarding, analytics, and approval flow upgrades.</div></div>',
    ];

    parseJsonBodyMock.mockResolvedValue({
      filePath,
      fileName: 'quarterly-review.pptx',
      mimeType: PPTX_MIME_TYPE,
    });
    statMock.mockResolvedValue({
      size: fileSize,
      mtimeMs: 1_710_000_000_000,
    });
    pptxToHtmlMock.mockResolvedValue(slideHtml);

    const { handleFileRoutes } = await import('@electron/api/routes/files');

    const handled = await handleFileRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/files/preview'),
      {} as never,
    );

    expect(handled).toBe(true);
    expect(pptxToHtmlMock).toHaveBeenCalledTimes(1);
    expect(writeFileMock).toHaveBeenCalledTimes(3);
    expect(sendJsonMock).toHaveBeenCalledWith(expect.anything(), 200, expect.objectContaining({
      kind: 'presentation',
      fileName: 'quarterly-review.pptx',
      mimeType: PPTX_MIME_TYPE,
      fileSize,
      previewId: expect.any(String),
      renderMode: 'html',
      slideWidth: 960,
      slideHeight: 540,
      slides: [
        {
          index: 1,
          title: 'Quarterly Business Review',
          paragraphs: [
            'Quarterly Business Review',
            'Revenue grew 18% year over year.',
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
          truncatedParagraphs: false,
        },
      ],
      truncatedSlides: false,
    }));
  });

  it('uses LibreOffice office-page rendering when previewing pptx on Linux if PDF output is available', async () => {
    Object.defineProperty(process, 'platform', {
      value: 'linux',
    });
    const filePath = '/fixtures/linux-review.pptx';
    const fileSize = 22 * 1024 * 1024;

    testGlobal.__clawxOfficePagesPdfExporter = vi.fn(async ({ dirPath }) => {
      return join(dirPath, 'document.pdf');
    });
    parseJsonBodyMock.mockResolvedValue({
      filePath,
      fileName: 'linux-review.pptx',
      mimeType: PPTX_MIME_TYPE,
    });
    statMock.mockResolvedValue({
      size: fileSize,
      mtimeMs: 1_710_000_000_222,
    });

    const { handleFileRoutes } = await import('@electron/api/routes/files');

    const handled = await handleFileRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1/api/files/preview'),
      { store: {}, gateway: {} },
    );

    expect(handled).toBe(true);
    expect(testGlobal.__clawxOfficePagesPdfExporter).toHaveBeenCalledTimes(1);
    expect(pptxToHtmlMock).not.toHaveBeenCalled();
    expect(sendJsonMock).toHaveBeenCalledWith(expect.anything(), 200, expect.objectContaining({
      kind: 'office-pages',
      fileName: 'linux-review.pptx',
      mimeType: PPTX_MIME_TYPE,
      fileSize,
      previewId: expect.any(String),
      pageCount: 1,
      truncatedPages: false,
    }));
  });

  it('serves cached slide html one slide at a time for the visual preview', async () => {
    const filePath = 'D:\\fixtures\\quarterly-review.pptx';
    const fileSize = 22 * 1024 * 1024;
    const slideHtml = [
      '<div class="slide" style="position: relative; width: 960px; height: 540px; overflow: hidden; background-color: #fff;"><div>Quarterly Business Review</div></div>',
      '<div class="slide" style="position: relative; width: 960px; height: 540px; overflow: hidden; background-color: #fff;"><div>Roadmap</div></div>',
    ];

    parseJsonBodyMock.mockResolvedValueOnce({
      filePath,
      fileName: 'quarterly-review.pptx',
      mimeType: PPTX_MIME_TYPE,
    });
    statMock.mockResolvedValue({
      size: fileSize,
      mtimeMs: 1_710_000_000_000,
    });
    pptxToHtmlMock.mockResolvedValue(slideHtml);

    const { handleFileRoutes } = await import('@electron/api/routes/files');

    await handleFileRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/files/preview'),
      {} as never,
    );

    const previewPayload = sendJsonMock.mock.calls[0]?.[2] as { previewId: string };
    sendJsonMock.mockClear();

    parseJsonBodyMock.mockResolvedValueOnce({
      previewId: previewPayload.previewId,
      slideIndex: 2,
    });

    const handled = await handleFileRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/files/preview-slide'),
      {} as never,
    );

    expect(handled).toBe(true);
    expect(sendJsonMock).toHaveBeenCalledWith(expect.anything(), 200, {
      html: slideHtml[1],
    });
  });

  it('builds an image-based pptx preview when a local slide exporter is available and serves slide png data', async () => {
    const filePath = 'D:\\fixtures\\visual-review.pptx';
    const fileSize = 30 * 1024 * 1024;

    testGlobal.__clawxPresentationImageExporter = vi.fn().mockResolvedValue({
      slideWidth: 1600,
      slideHeight: 900,
      slideCount: 2,
      truncatedSlides: false,
    });

    parseJsonBodyMock.mockResolvedValueOnce({
      filePath,
      fileName: 'visual-review.pptx',
      mimeType: PPTX_MIME_TYPE,
    });
    statMock.mockResolvedValue({
      size: fileSize,
      mtimeMs: 1_710_000_123_000,
    });

    const { handleFileRoutes } = await import('@electron/api/routes/files');

    await handleFileRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/files/preview'),
      {} as never,
    );

    const previewPayload = sendJsonMock.mock.calls[0]?.[2] as {
      previewId: string;
      renderMode: string;
      slides: Array<{ title: string }>;
    };
    expect(previewPayload.renderMode).toBe('image');
    expect(previewPayload.slides).toEqual([
      {
        index: 1,
        title: 'Slide 1',
        paragraphs: [],
        truncatedParagraphs: false,
      },
      {
        index: 2,
        title: 'Slide 2',
        paragraphs: [],
        truncatedParagraphs: false,
      },
    ]);

    sendJsonMock.mockClear();
    parseJsonBodyMock.mockResolvedValueOnce({
      previewId: previewPayload.previewId,
      slideIndex: 1,
    });

    const handled = await handleFileRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/files/preview-slide-image'),
      {} as never,
    );

    expect(handled).toBe(true);
    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({
        src: expect.stringMatching(/^data:image\/png;base64,/),
      }),
    );
  });

  it('reuses the persisted presentation cache on disk without rerendering the pptx', async () => {
    const filePath = 'D:\\fixtures\\cached-review.pptx';
    const fileSize = 24 * 1024 * 1024;
    const modifiedAtMs = 1_710_000_000_500;
    const createdAt = Date.now();
    const previewId = crypto
      .createHash('sha256')
      .update(`${filePath}\u0000${fileSize}\u0000${modifiedAtMs}`)
      .digest('hex')
      .slice(0, 24);
    const dirPath = join(tmpdir(), 'clawx-presentation-preview', previewId);
    const manifestPath = join(dirPath, 'manifest.json');

    storedPreviewFiles.set(manifestPath, JSON.stringify({
      version: 3,
      previewId,
      renderMode: 'html',
      slideWidth: 960,
      slideHeight: 540,
      slides: [
        {
          index: 1,
          title: 'Cached Slide',
          paragraphs: ['Cached Slide', 'Loaded from disk cache.'],
          truncatedParagraphs: false,
        },
      ],
      truncatedSlides: false,
      createdAt,
    }));

    parseJsonBodyMock.mockResolvedValue({
      filePath,
      fileName: 'cached-review.pptx',
      mimeType: PPTX_MIME_TYPE,
    });
    statMock.mockResolvedValue({
      size: fileSize,
      mtimeMs: modifiedAtMs,
    });

    const { handleFileRoutes } = await import('@electron/api/routes/files');

    const handled = await handleFileRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/files/preview'),
      {} as never,
    );

    expect(handled).toBe(true);
    expect(pptxToHtmlMock).not.toHaveBeenCalled();
    expect(writeFileMock).not.toHaveBeenCalled();
    expect(readFileMock).not.toHaveBeenCalledWith(filePath);
    expect(sendJsonMock).toHaveBeenCalledWith(expect.anything(), 200, {
      kind: 'presentation',
      fileName: 'cached-review.pptx',
      mimeType: PPTX_MIME_TYPE,
      fileSize,
      previewId,
      renderMode: 'html',
      slideWidth: 960,
      slideHeight: 540,
      slides: [
        {
          index: 1,
          title: 'Cached Slide',
          paragraphs: ['Cached Slide', 'Loaded from disk cache.'],
          truncatedParagraphs: false,
        },
      ],
      truncatedSlides: false,
    });
  });

  it('still refuses pptx previews that exceed the expanded presentation cap', async () => {
    const fileSize = 160 * 1024 * 1024;

    parseJsonBodyMock.mockResolvedValue({
      filePath: 'D:\\fixtures\\all-hands.pptx',
      fileName: 'all-hands.pptx',
      mimeType: PPTX_MIME_TYPE,
    });
    statMock.mockResolvedValue({ size: fileSize });

    const { handleFileRoutes } = await import('@electron/api/routes/files');

    const handled = await handleFileRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/files/preview'),
      {} as never,
    );

    expect(handled).toBe(true);
    expect(readFileMock).not.toHaveBeenCalled();
    expect(pptxToHtmlMock).not.toHaveBeenCalled();
    expect(sendJsonMock).toHaveBeenCalledWith(expect.anything(), 200, {
      kind: 'unavailable',
      fileName: 'all-hands.pptx',
      mimeType: PPTX_MIME_TYPE,
      fileSize,
      reasonCode: 'tooLarge',
    });
  });

  it('does not warm LibreOffice previews in the background when staging pptx uploads', async () => {
    const filePath = 'D:\\fixtures\\upload-review.pptx';
    const stagedPath = 'D:\\staged\\upload-review.pptx';
    const fileSize = 18 * 1024 * 1024;

    testGlobal.__clawxOfficePagesPdfExporter = vi.fn(async ({ dirPath }) => {
      return join(dirPath, 'document.pdf');
    });
    parseJsonBodyMock.mockResolvedValue({
      filePaths: [filePath],
      sessionKey: 'agent:main:session-123',
    });
    resolveUserUploadStorageDirMock.mockResolvedValue('D:\\staged');
    resolveStagedUploadFilePathMock.mockResolvedValue(stagedPath);
    statMock.mockResolvedValue({
      size: fileSize,
      mtimeMs: 1_710_000_000_333,
    });

    const { handleFileRoutes } = await import('@electron/api/routes/files');

    const handled = await handleFileRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1/api/files/stage-paths'),
      { store: {}, gateway: {} },
    );

    await Promise.resolve();

    expect(handled).toBe(true);
    expect(testGlobal.__clawxOfficePagesPdfExporter).not.toHaveBeenCalled();
    expect(sendJsonMock).toHaveBeenCalledWith(expect.anything(), 200, [
      {
        id: expect.any(String),
        fileName: 'upload-review.pptx',
        mimeType: PPTX_MIME_TYPE,
        fileSize,
        stagedPath,
        preview: null,
      },
    ]);
  });

  it('falls back to file bytes for image previews when native decoding cannot read a unicode path', async () => {
    const filePath = 'D:\\资料\\图片.png';
    const stagedPath = 'D:\\staged\\图片.png';
    const imageBytes = Buffer.from('png-data');

    parseJsonBodyMock.mockResolvedValue({
      filePaths: [filePath],
      sessionKey: 'agent:main:session-123',
    });
    resolveUserUploadStorageDirMock.mockResolvedValue('D:\\staged');
    resolveStagedUploadFilePathMock.mockResolvedValue(stagedPath);
    statMock.mockResolvedValue({
      size: imageBytes.length,
      mtimeMs: 1_710_000_000_444,
    });
    readFileMock.mockResolvedValue(imageBytes);

    const { handleFileRoutes } = await import('@electron/api/routes/files');

    const handled = await handleFileRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1/api/files/stage-paths'),
      { store: {}, gateway: {} },
    );

    expect(handled).toBe(true);
    expect(readFileMock).toHaveBeenCalledWith(stagedPath);
    expect(sendJsonMock).toHaveBeenCalledWith(expect.anything(), 200, [
      {
        id: expect.any(String),
        fileName: '图片.png',
        mimeType: 'image/png',
        fileSize: imageBytes.length,
        stagedPath,
        preview: `data:image/png;base64,${imageBytes.toString('base64')}`,
      },
    ]);
  });
});

describe('handleFileRoutes text preview classification', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
    readFileMock.mockImplementation(async (filePath: string, encoding?: BufferEncoding) => {
      if (encoding === 'utf8') {
        return filePath.endsWith('.ts')
          ? 'export const answer = 42;\n'
          : 'Plain text should keep the regular preview font.\n';
      }
      return Buffer.from('');
    });
    statMock.mockResolvedValue({
      size: 128,
      mtimeMs: 1_710_000_000_000,
    });
  });

  it('treats txt attachments as plain text previews', async () => {
    parseJsonBodyMock.mockResolvedValue({
      filePath: 'D:\\fixtures\\notes.txt',
      fileName: 'notes.txt',
      mimeType: 'text/plain',
    });

    const { handleFileRoutes } = await import('@electron/api/routes/files');

    const handled = await handleFileRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/files/preview'),
      {} as never,
    );

    expect(handled).toBe(true);
    expect(sendJsonMock).toHaveBeenCalledWith(expect.anything(), 200, expect.objectContaining({
      kind: 'text',
      fileName: 'notes.txt',
      mimeType: 'text/plain',
      content: 'Plain text should keep the regular preview font.\n',
      truncated: false,
    }));
  });

  it('keeps source files in the code preview path', async () => {
    parseJsonBodyMock.mockResolvedValue({
      filePath: 'D:\\fixtures\\answer.ts',
      fileName: 'answer.ts',
      mimeType: 'text/typescript',
    });

    const { handleFileRoutes } = await import('@electron/api/routes/files');

    const handled = await handleFileRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/files/preview'),
      {} as never,
    );

    expect(handled).toBe(true);
    expect(sendJsonMock).toHaveBeenCalledWith(expect.anything(), 200, expect.objectContaining({
      kind: 'code',
      fileName: 'answer.ts',
      mimeType: 'text/typescript',
      content: 'export const answer = 42;\n',
      truncated: false,
      language: 'typescript',
    }));
  });
});

describe('handleFileRoutes docx preview source', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
    readFileMock.mockResolvedValue(Buffer.from('docx-binary'));
    statMock.mockResolvedValue({
      size: 256,
      mtimeMs: 1_710_000_000_000,
    });
  });

  it('returns base64 source data for styled docx rendering in the renderer', async () => {
    parseJsonBodyMock.mockResolvedValue({
      filePath: 'D:\\fixtures\\styled-preview.docx',
      fileName: 'styled-preview.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });

    const { handleFileRoutes } = await import('@electron/api/routes/files');

    const handled = await handleFileRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/files/preview-docx-source'),
      {} as never,
    );

    expect(handled).toBe(true);
    expect(sendJsonMock).toHaveBeenCalledWith(expect.anything(), 200, {
      base64: Buffer.from('docx-binary').toString('base64'),
    });
  });
});

describe('handleFileRoutes csv spreadsheet preview decoding', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
    statMock.mockResolvedValue({
      size: 128,
      mtimeMs: 1_710_000_000_000,
    });
  });

  it('decodes utf-8 csv attachments before parsing spreadsheet rows', async () => {
    const csvBuffer = Buffer.from('姓名,年龄,城市\n张三,28,北京\n', 'utf8');
    readFileMock.mockResolvedValue(csvBuffer);
    statMock.mockResolvedValue({
      size: csvBuffer.length,
      mtimeMs: 1_710_000_000_000,
    });
    parseJsonBodyMock.mockResolvedValue({
      filePath: 'D:\\fixtures\\contacts-utf8.csv',
      fileName: 'contacts-utf8.csv',
      mimeType: 'text/csv',
    });

    const { handleFileRoutes } = await import('@electron/api/routes/files');

    const handled = await handleFileRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/files/preview'),
      {} as never,
    );

    expect(handled).toBe(true);
    expect(sendJsonMock).toHaveBeenCalledWith(expect.anything(), 200, expect.objectContaining({
      kind: 'spreadsheet',
      fileName: 'contacts-utf8.csv',
      mimeType: 'text/csv',
      sheets: [
        {
          name: 'Sheet1',
          rows: [
            ['姓名', '年龄', '城市'],
            ['张三', '28', '北京'],
          ],
          rowCount: 2,
          columnCount: 3,
          merges: [],
          rowOffset: 0,
          columnOffset: 0,
          truncatedRows: false,
          truncatedColumns: false,
        },
      ],
      truncatedSheets: false,
    }));
  });

  it('falls back to gb18030 for legacy chinese csv exports', async () => {
    const csvBuffer = Buffer.from([
      0xD0, 0xD5, 0xC3, 0xFB, 0x2C, 0xC4, 0xEA, 0xC1, 0xE4, 0x2C, 0xB3, 0xC7, 0xCA, 0xD0, 0x0A,
      0xD5, 0xC5, 0xC8, 0xFD, 0x2C, 0x32, 0x38, 0x2C, 0xB1, 0xB1, 0xBE, 0xA9, 0x0A,
    ]);
    readFileMock.mockResolvedValue(csvBuffer);
    statMock.mockResolvedValue({
      size: csvBuffer.length,
      mtimeMs: 1_710_000_000_000,
    });
    parseJsonBodyMock.mockResolvedValue({
      filePath: 'D:\\fixtures\\contacts-gbk.csv',
      fileName: 'contacts-gbk.csv',
      mimeType: 'text/csv',
    });

    const { handleFileRoutes } = await import('@electron/api/routes/files');

    const handled = await handleFileRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/files/preview'),
      {} as never,
    );

    expect(handled).toBe(true);
    expect(sendJsonMock).toHaveBeenCalledWith(expect.anything(), 200, expect.objectContaining({
      kind: 'spreadsheet',
      fileName: 'contacts-gbk.csv',
      mimeType: 'text/csv',
      sheets: [
        {
          name: 'Sheet1',
          rows: [
            ['姓名', '年龄', '城市'],
            ['张三', '28', '北京'],
          ],
          rowCount: 2,
          columnCount: 3,
          merges: [],
          rowOffset: 0,
          columnOffset: 0,
          truncatedRows: false,
          truncatedColumns: false,
        },
      ],
      truncatedSheets: false,
    }));
  });

  it('includes xlsx merge ranges in spreadsheet previews', async () => {
    const XLSX = await import('xlsx');
    const worksheet = XLSX.utils.aoa_to_sheet([
      ['Merged title', '', 'Status', ''],
      ['', '', 'Open', 'Closed'],
      ['Owner', 'Count', 'Regional summary', ''],
    ]);
    worksheet['!merges'] = [
      XLSX.utils.decode_range('A1:B2'),
      XLSX.utils.decode_range('C3:D3'),
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Merged');
    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }) as Buffer;

    readFileMock.mockResolvedValue(buffer);
    statMock.mockResolvedValue({
      size: buffer.length,
      mtimeMs: 1_710_000_000_000,
    });
    parseJsonBodyMock.mockResolvedValue({
      filePath: 'D:\\fixtures\\merged.xlsx',
      fileName: 'merged.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    const { handleFileRoutes } = await import('@electron/api/routes/files');

    const handled = await handleFileRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/files/preview'),
      {} as never,
    );

    expect(handled).toBe(true);
    expect(sendJsonMock).toHaveBeenCalledWith(expect.anything(), 200, expect.objectContaining({
      kind: 'spreadsheet',
      sheets: [
        expect.objectContaining({
          name: 'Merged',
          merges: [
            { row: 0, column: 0, rowSpan: 2, columnSpan: 2 },
            { row: 2, column: 2, rowSpan: 1, columnSpan: 2 },
          ],
        }),
      ],
    }));
  });

  it('returns a requested spreadsheet row and column window', async () => {
    const csvBuffer = Buffer.from([
      'A1,B1,C1,D1',
      'A2,B2,C2,D2',
      'A3,B3,C3,D3',
      'A4,B4,C4,D4',
    ].join('\n'), 'utf8');
    readFileMock.mockResolvedValue(csvBuffer);
    statMock.mockResolvedValue({
      size: csvBuffer.length,
      mtimeMs: 1_710_000_000_000,
    });
    parseJsonBodyMock.mockResolvedValue({
      filePath: 'D:\\fixtures\\windowed.csv',
      fileName: 'windowed.csv',
      mimeType: 'text/csv',
      sheetName: 'Sheet1',
      rowOffset: 2,
      columnOffset: 1,
      rowLimit: 2,
      columnLimit: 2,
    });

    const { handleFileRoutes } = await import('@electron/api/routes/files');

    const handled = await handleFileRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/files/preview-spreadsheet-range'),
      {} as never,
    );

    expect(handled).toBe(true);
    expect(sendJsonMock).toHaveBeenCalledWith(expect.anything(), 200, {
      name: 'Sheet1',
      rows: [
        ['B3', 'C3'],
        ['B4', 'C4'],
      ],
      rowCount: 4,
      columnCount: 4,
      merges: [],
      rowOffset: 2,
      columnOffset: 1,
      truncatedRows: false,
      truncatedColumns: true,
    });
  });
});
