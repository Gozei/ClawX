/* eslint-disable react-hooks/set-state-in-effect -- File preview components reset local render/cache state when the selected preview source changes. */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type UIEvent as ReactUIEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import {
  ChevronsLeft,
  ChevronsRight,
  Copy,
  FileText,
  FolderOpen,
  Loader2,
  Maximize2,
  Minus,
  Minimize2,
  PictureInPicture2,
  Plus,
  RotateCw,
  Table2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { invokeIpc } from '@/lib/api-client';
import { hostApiFetch } from '@/lib/host-api';
import { cn } from '@/lib/utils';
import type { AttachedFileMeta } from '@/stores/chat';
import { FileTypeIcon } from './file-icon';
import { LibreOfficeDownloadDialog } from './LibreOfficeDownloadDialog';
import { MarkdownRenderer } from './MarkdownRenderer';
import type {
  FilePreviewOutlineItem,
  FilePreviewPayload,
  FilePreviewUnavailableReasonCode,
} from './file-preview-types';

const previewCache = new Map<string, FilePreviewPayload>();
const docxBinaryCache = new Map<string, string>();
const presentationSlideCache = new Map<string, string>();
const presentationSlideImageCache = new Map<string, string>();
const officePagesPdfCache = new Map<string, string>();
const PREVIEW_RETRY_DELAYS_MS = [0, 250, 800];
const IMAGE_MIN_ZOOM = 0.5;
const IMAGE_MAX_ZOOM = 4;
const IMAGE_ZOOM_STEP = 0.25;
const PRESENTATION_SCROLL_SETTLE_THRESHOLD_PX = 28;
const PRESENTATION_ACTIVE_SLIDE_OFFSET_PX = 96;
const PRESENTATION_PRELOAD_RADIUS = 2;
const PRESENTATION_LOAD_ROOT_MARGIN = '180% 0px';
const OFFICE_PAGE_INITIAL_RENDERED_PAGES = [1];
const SPREADSHEET_PAGE_ROW_COUNT = 120;
const SPREADSHEET_PAGE_COLUMN_COUNT = 18;
const SPREADSHEET_LOAD_MORE_THRESHOLD_PX = 96;
const SPREADSHEET_MAX_LOADED_ROWS = 1000;
const SPREADSHEET_MAX_LOADED_COLUMNS = 80;
const SYSTEM_UI_FONT_FAMILY = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif';
const SYSTEM_MONO_FONT_FAMILY = 'ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
const PREVIEW_PANEL_BACKGROUND_CLASS = 'bg-[linear-gradient(180deg,rgba(255,255,255,0.97),rgba(248,250,252,0.96))] dark:bg-[linear-gradient(180deg,rgba(10,14,22,0.96),rgba(12,17,26,0.94))]';
const DOCX_PREVIEW_ROOT_ID = 'docx-preview-root';
const DOCX_PREVIEW_HEADING_SELECTOR = [
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
].map((selector) => `#${DOCX_PREVIEW_ROOT_ID} ${selector}`).join(', ');

type DocxPreviewSourcePayload = {
  base64: string;
};

type SpreadsheetPreviewSheet = Extract<FilePreviewPayload, { kind: 'spreadsheet' }>['sheets'][number];

type SpreadsheetRangePayload = SpreadsheetPreviewSheet & {
  rowOffset: number;
  columnOffset: number;
};

type SpreadsheetPreviewMerge = NonNullable<SpreadsheetRangePayload['merges']>[number];

type PdfViewportLike = {
  width: number;
  height: number;
};

type PdfRenderTaskLike = {
  promise: Promise<unknown>;
  cancel?: () => void;
};

type PdfPageLike = {
  getViewport: (options: { scale: number }) => PdfViewportLike;
  render: (options: {
    canvasContext: CanvasRenderingContext2D;
    viewport: PdfViewportLike;
  }) => PdfRenderTaskLike;
  cleanup?: () => void;
};

type PdfDocumentLike = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfPageLike>;
  destroy?: () => Promise<void> | void;
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function buildPreviewCacheKey(file: AttachedFileMeta): string {
  return `${file.filePath ?? ''}|${file.fileName}|${file.mimeType}`;
}

function isPresentationLikePreviewFile(file: AttachedFileMeta, preview: FilePreviewPayload | null): boolean {
  const mimeType = `${file.mimeType} ${preview?.mimeType ?? ''}`.toLowerCase();
  if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) {
    return true;
  }

  const names = [
    file.fileName,
    file.filePath ?? '',
    preview?.fileName ?? '',
  ].join(' ').toLowerCase();
  return /\.pptx(?:$|[\s?#])/i.test(names);
}

function isTransientPreviewLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return normalized.includes('fetch failed')
    || normalized.includes('econnrefused')
    || normalized.includes('socket hang up')
    || normalized.includes('network');
}

function isMissingFileShellResult(result: unknown): boolean {
  if (typeof result !== 'string' || !result.trim()) {
    return false;
  }
  const normalized = result.trim().toLowerCase();
  return normalized.includes('file not found:')
    || normalized.includes('does not exist')
    || normalized.includes('not found')
    || normalized.includes('no such file');
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function resolvePreviewLocale(language: string | undefined): string {
  return (language || '').startsWith('zh') ? 'zh-CN' : 'en';
}

function buildDocxSrcDoc(html: string, language: string): string {
  const locale = resolvePreviewLocale(language);
  return `<!doctype html>
<html lang="${locale}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root {
        color-scheme: light;
      }
      html {
        scroll-behavior: smooth;
      }
      body {
        margin: 0;
        padding: 40px 48px 72px;
        font-family: ${SYSTEM_UI_FONT_FAMILY};
        line-height: 1.7;
        color: #0f172a;
        background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
      }
      main {
        max-width: 880px;
        margin: 0 auto;
      }
      img {
        max-width: 100%;
        height: auto;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        margin: 1.25rem 0;
      }
      th,
      td {
        border: 1px solid #dbe3ef;
        padding: 10px 12px;
        vertical-align: top;
      }
      h1, h2, h3, h4, h5, h6 {
        color: #0f172a;
        line-height: 1.3;
        margin-top: 1.8em;
        scroll-margin-top: 24px;
      }
      p, li {
        font-size: 15px;
      }
      code {
        font-family: ${SYSTEM_MONO_FONT_FAMILY};
        background: #eef2ff;
        border-radius: 6px;
        padding: 0.1rem 0.35rem;
      }
      pre {
        overflow: auto;
        padding: 16px;
        border-radius: 12px;
        background: #eff6ff;
      }
      blockquote {
        margin: 1.25rem 0;
        padding-left: 16px;
        border-left: 4px solid #93c5fd;
        color: #334155;
      }
    </style>
  </head>
  <body>
    <main>${html}</main>
  </body>
</html>`;
}

function buildDocxRenderShell(language: string, cacheMarker: string): string {
  const locale = resolvePreviewLocale(language);
  const encodedMarker = encodeURIComponent(cacheMarker);
  return `<!doctype html>
<html lang="${locale}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="docx-preview-cache-key" content="${encodedMarker}" />
    <style>
      :root {
        color-scheme: light;
      }
      html, body {
        min-height: 100%;
      }
      html {
        scroll-behavior: smooth;
      }
      body {
        margin: 0;
        background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
        font-family: ${SYSTEM_UI_FONT_FAMILY};
        color: #0f172a;
        overflow-x: hidden;
      }
      #${DOCX_PREVIEW_ROOT_ID} {
        min-height: 100vh;
        box-sizing: border-box;
        padding: 18px 20px 36px;
      }
      [data-docx-outline-id] {
        scroll-margin-top: 24px;
      }
    </style>
  </head>
  <body>
    <div id="${DOCX_PREVIEW_ROOT_ID}"></div>
  </body>
</html>`;
}

function normalizeDocxOutlineText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function matchesDocxHeadingLevel(element: Element, level: number): boolean {
  if (element.tagName.toLowerCase() === `h${Math.min(Math.max(level, 1), 6)}`) {
    return true;
  }

  const className = typeof element.className === 'string'
    ? element.className
    : (element.getAttribute('class') ?? '');
  return className.toLowerCase().includes(`docx_heading${Math.min(Math.max(level, 1), 9)}`);
}

function attachDocxHeadingAnchors(
  frameDocument: Document,
  outline: FilePreviewOutlineItem[],
): void {
  const candidates = Array.from(
    frameDocument.querySelectorAll(DOCX_PREVIEW_HEADING_SELECTOR),
  ) as HTMLElement[];
  const unusedCandidateIndexes = new Set(candidates.map((_, index) => index));

  for (const item of outline) {
    const outlineText = normalizeDocxOutlineText(item.text);
    if (!outlineText) {
      continue;
    }

    let matchedIndex: number | undefined;
    for (const candidateIndex of unusedCandidateIndexes) {
      const candidate = candidates[candidateIndex];
      if (!candidate || !matchesDocxHeadingLevel(candidate, item.level)) {
        continue;
      }
      if (normalizeDocxOutlineText(candidate.textContent) !== outlineText) {
        continue;
      }
      matchedIndex = candidateIndex;
      break;
    }

    if (matchedIndex == null) {
      for (const candidateIndex of unusedCandidateIndexes) {
        const candidate = candidates[candidateIndex];
        if (!candidate) {
          continue;
        }
        if (normalizeDocxOutlineText(candidate.textContent) !== outlineText) {
          continue;
        }
        matchedIndex = candidateIndex;
        break;
      }
    }

    if (matchedIndex == null) {
      continue;
    }

    const matchedElement = candidates[matchedIndex];
    matchedElement.id = item.id;
    matchedElement.setAttribute('data-docx-outline-id', item.id);
    unusedCandidateIndexes.delete(matchedIndex);
  }
}

function upsertDocxPreviewOverrides(frameDocument: Document): void {
  let overrideStyle = frameDocument.head.querySelector('style[data-docx-preview-overrides="true"]');
  if (!overrideStyle) {
    overrideStyle = frameDocument.createElement('style');
    overrideStyle.setAttribute('data-docx-preview-overrides', 'true');
    frameDocument.head.appendChild(overrideStyle);
  }

  overrideStyle.textContent = `
    body {
      background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
      color: #0f172a;
    }
    .docx-wrapper {
      background: transparent !important;
      padding: 0 !important;
      display: flex !important;
      flex-flow: column !important;
      align-items: flex-start !important;
    }
    .docx-wrapper > section.docx {
      box-shadow: none !important;
      border: none !important;
      border-radius: 0 !important;
      margin: 0 !important;
      background: transparent !important;
      overflow: visible !important;
      min-height: 0 !important;
      height: auto !important;
      max-width: none !important;
    }
    .docx-wrapper > section.docx > article {
      margin-bottom: 0 !important;
    }
    .docx table {
      width: 100%;
    }
    .docx p,
    .docx li,
    .docx td,
    .docx th {
      overflow-wrap: anywhere;
    }
  `;
}

function flattenDocxPreviewPages(frameDocument: Document): void {
  const pages = Array.from(
    frameDocument.querySelectorAll('.docx-wrapper > section.docx'),
  ) as HTMLElement[];
  if (pages.length <= 1) {
    return;
  }

  const primaryPage = pages[0];
  let primaryArticle = primaryPage.querySelector('article') as HTMLElement | null;
  if (!primaryArticle) {
    primaryArticle = frameDocument.createElement('article');
    primaryPage.appendChild(primaryArticle);
  }

  for (const page of pages.slice(1)) {
    const article = page.querySelector('article');
    if (article) {
      while (article.firstChild) {
        primaryArticle.appendChild(article.firstChild);
      }
    }
    page.remove();
  }
}

function syncDocxPreviewPageScale(frameDocument: Document): void {
  const root = frameDocument.getElementById(DOCX_PREVIEW_ROOT_ID) as HTMLElement | null;
  const wrapper = frameDocument.querySelector('.docx-wrapper') as HTMLElement | null;
  const firstPage = frameDocument.querySelector('.docx-wrapper > section.docx') as HTMLElement | null;
  if (!root || !wrapper || !firstPage) {
    return;
  }

  wrapper.style.zoom = '1';
  const baseWidth = firstPage.getBoundingClientRect().width;
  if (!Number.isFinite(baseWidth) || baseWidth <= 0) {
    return;
  }

  const availableWidth = root.clientWidth;
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) {
    return;
  }

  const scale = Math.min(1, availableWidth / baseWidth);
  wrapper.style.zoom = `${Math.max(scale, 0.1)}`;
}

function installDocxPreviewPageScaler(frameDocument: Document): () => void {
  const frameWindow = frameDocument.defaultView;
  if (!frameWindow) {
    return () => {};
  }

  let rafId = 0;
  let resizeObserver: ResizeObserver | null = null;

  const schedule = () => {
    if (rafId) {
      frameWindow.cancelAnimationFrame(rafId);
    }
    rafId = frameWindow.requestAnimationFrame(() => {
      rafId = 0;
      syncDocxPreviewPageScale(frameDocument);
    });
  };

  schedule();
  frameWindow.addEventListener('resize', schedule);

  if (frameWindow.ResizeObserver) {
    resizeObserver = new frameWindow.ResizeObserver(() => {
      schedule();
    });
    resizeObserver.observe(frameDocument.documentElement);
    const root = frameDocument.getElementById(DOCX_PREVIEW_ROOT_ID);
    if (root) {
      resizeObserver.observe(root);
    }
  }

  return () => {
    if (rafId) {
      frameWindow.cancelAnimationFrame(rafId);
    }
    frameWindow.removeEventListener('resize', schedule);
    resizeObserver?.disconnect();
  };
}

function decodeBase64ToUint8Array(base64: string): Uint8Array {
  const normalized = base64.replace(/\s+/g, '');
  const binary = window.atob(normalized);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function clampZoom(value: number): number {
  return Math.min(IMAGE_MAX_ZOOM, Math.max(IMAGE_MIN_ZOOM, Math.round(value * 100) / 100));
}

function getWheelZoomDelta(deltaY: number): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) {
    return 0;
  }
  return deltaY < 0 ? IMAGE_ZOOM_STEP : -IMAGE_ZOOM_STEP;
}

function buildPresentationSlideCacheKey(previewId: string, slideIndex: number): string {
  return `${previewId}:${slideIndex}`;
}

function buildOfficePagesPdfCacheKey(previewId: string): string {
  return `office-pages:${previewId}`;
}

async function loadPdfDocumentFromDataUrl(dataUrl: string): Promise<PdfDocumentLike> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

  const base64 = extractBase64FromDataUrl(dataUrl);
  if (!base64) {
    throw new Error('Office preview PDF data is empty');
  }

  const loadingTask = pdfjs.getDocument({
    data: decodeBase64ToUint8Array(base64),
    isEvalSupported: false,
  });
  return await loadingTask.promise as unknown as PdfDocumentLike;
}

function scrollElementIntoContainerView(
  container: HTMLElement | null,
  target: HTMLElement | null,
  behavior: ScrollBehavior,
): void {
  if (!container || !target) {
    return;
  }

  const containerRect = container.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  container.scrollTo({
    top: Math.max(0, container.scrollTop + targetRect.top - containerRect.top - 24),
    behavior,
  });
}

const MARKDOWN_HEADING_SELECTOR = 'h1,h2,h3,h4,h5,h6';

function assignMarkdownHeadingAnchors(
  container: HTMLElement | null,
  outline: FilePreviewOutlineItem[],
): void {
  if (!container || outline.length === 0) {
    return;
  }

  const headings = Array.from(container.querySelectorAll<HTMLElement>(MARKDOWN_HEADING_SELECTOR));
  headings.forEach((heading, index) => {
    const item = outline[index];
    if (!item) {
      heading.removeAttribute('data-markdown-outline-id');
      return;
    }

    heading.id = item.id;
    heading.setAttribute('data-markdown-outline-id', item.id);
    heading.classList.add('scroll-mt-6');
  });
}

function findMarkdownHeadingAnchor(
  container: HTMLElement | null,
  id: string,
): HTMLElement | null {
  if (!container) {
    return null;
  }

  return container.querySelector<HTMLElement>(`[data-markdown-outline-id="${id}"]`)
    ?? container.querySelector<HTMLElement>(`[id="${id}"]`);
}

function buildPresentationSlideSrcDoc(
  rawHtml: string,
  slideWidth: number,
  slideHeight: number,
  mode: 'main' | 'thumbnail',
): string {
  const isThumbnail = mode === 'thumbnail';
  const background = 'transparent';
  const padding = isThumbnail ? 0 : 0;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root {
        color-scheme: light;
      }
      html, body {
        margin: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: ${background};
      }
      body {
        display: flex;
        align-items: flex-start;
        justify-content: center;
        font-family: ${SYSTEM_UI_FONT_FAMILY};
      }
      #viewport {
        position: relative;
        width: 100%;
        height: 100%;
        box-sizing: border-box;
        padding: ${padding}px;
        display: flex;
        align-items: flex-start;
        justify-content: center;
        overflow: hidden;
      }
      #stage {
        position: absolute;
        left: 50%;
        top: 0;
        width: ${slideWidth}px;
        height: ${slideHeight}px;
        transform: translate(-50%, 0) scale(1);
        transform-origin: top center;
        background: transparent;
      }
      #content {
        position: relative;
        width: 100%;
        height: 100%;
        overflow: hidden;
      }
      #content > .slide,
      #content > .slide-container {
        width: ${slideWidth}px !important;
        height: ${slideHeight}px !important;
        margin: 0 !important;
      }
    </style>
  </head>
  <body>
    <div id="viewport">
      <div id="stage">
        <div id="content">${rawHtml}</div>
      </div>
    </div>
    <script>
      const fallbackWidth = ${slideWidth};
      const fallbackHeight = ${slideHeight};
      const viewport = document.getElementById('viewport');
      const stage = document.getElementById('stage');
      const content = document.getElementById('content');

      function resolveIntrinsicSize() {
        const root = content?.querySelector('.slide-container, .slide');
        if (!(root instanceof HTMLElement)) {
          return { width: fallbackWidth, height: fallbackHeight };
        }

        const widthFromStyle = Number.parseFloat(root.style.width || '0');
        const heightFromStyle = Number.parseFloat(root.style.height || '0');
        const width = widthFromStyle > 0 ? widthFromStyle : root.scrollWidth || root.offsetWidth || fallbackWidth;
        const height = heightFromStyle > 0 ? heightFromStyle : root.scrollHeight || root.offsetHeight || fallbackHeight;

        return {
          width: width > 0 ? width : fallbackWidth,
          height: height > 0 ? height : fallbackHeight,
        };
      }

      function fitStage() {
        if (!viewport || !stage) return;
        const { width: baseWidth, height: baseHeight } = resolveIntrinsicSize();
        stage.style.width = baseWidth + 'px';
        stage.style.height = baseHeight + 'px';
        const rect = viewport.getBoundingClientRect();
        const scale = Math.min(
          Math.max(rect.width, 1) / baseWidth,
          Math.max(rect.height, 1) / baseHeight,
        );
        stage.style.transform = 'translate(-50%, 0) scale(' + scale + ')';
      }

      fitStage();
      window.addEventListener('resize', fitStage);
      if (window.ResizeObserver && viewport) {
        const resizeObserver = new ResizeObserver(fitStage);
        resizeObserver.observe(viewport);
      }
    </script>
  </body>
</html>`;
}

function extractBase64FromDataUrl(dataUrl: string): string | undefined {
  const index = dataUrl.indexOf(',');
  if (index < 0) return undefined;
  return dataUrl.slice(index + 1) || undefined;
}

function slugifyHeadingText(value: string, usedIds: Set<string>, fallbackIndex: number): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .split('')
    .filter((char) => char.charCodeAt(0) >= 32)
    .join('')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    || `section-${fallbackIndex}`;

  let candidate = normalized;
  let suffix = 2;
  while (usedIds.has(candidate)) {
    candidate = `${normalized}-${suffix}`;
    suffix += 1;
  }
  usedIds.add(candidate);
  return candidate;
}

function extractMarkdownOutline(content: string): FilePreviewOutlineItem[] {
  const lines = content.split(/\r?\n/);
  const usedIds = new Set<string>();
  const outline: FilePreviewOutlineItem[] = [];
  let inFence = false;
  let headingIndex = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^(```|~~~)/.test(trimmed)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const match = trimmed.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!match) continue;

    const headingText = match[2]
      .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
      .replace(/[*_`~]/g, '')
      .trim();
    if (!headingText) continue;

    headingIndex += 1;
    outline.push({
      id: slugifyHeadingText(headingText, usedIds, headingIndex),
      text: headingText,
      level: match[1].length,
      isBold: /(^|[^\\])(\*\*|__)(?=\S).+?(?<=\S)\2/.test(match[2]) || match[1].length <= 2,
    });
  }

  return outline;
}

function resolveUnavailableReason(
  reasonCode: FilePreviewUnavailableReasonCode,
  t: (key: string) => string,
): string {
  switch (reasonCode) {
    case 'missingPath':
      return t('filePreview.missingPath');
    case 'tooLarge':
      return t('filePreview.unavailable.tooLarge');
    case 'legacyOffice':
      return t('filePreview.unavailable.legacyOffice');
    case 'requiresLibreOffice':
      return t('filePreview.unavailable.requiresLibreOffice');
    case 'unsupported':
    default:
      return t('filePreview.unavailable.unsupported');
  }
}

function PreviewMeta({
  fileName,
  mimeType,
  fileSize,
}: {
  fileName: string;
  mimeType: string;
  fileSize: number;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3" style={{ fontFamily: SYSTEM_UI_FONT_FAMILY }}>
      <FileTypeIcon mimeType={mimeType} fileName={fileName} />
      <div className="min-w-0">
        <div className="truncate text-[14px] font-semibold text-foreground">{fileName}</div>
        <div className="truncate text-[12px] text-foreground/58">{formatFileSize(fileSize)}</div>
      </div>
    </div>
  );
}

function DocumentOutline({
  items,
  activeId,
  onSelect,
}: {
  items: FilePreviewOutlineItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation('chat');
  const [collapsed, setCollapsed] = useState(false);

  if (items.length === 0) {
    return null;
  }

  return (
    <aside
      data-testid="chat-file-preview-outline"
      className={cn(
        'flex shrink-0 flex-col transition-[width] duration-200',
        PREVIEW_PANEL_BACKGROUND_CLASS,
        collapsed
          ? 'w-full sm:w-12'
          : 'w-full sm:w-[236px]',
      )}
      style={{ fontFamily: SYSTEM_UI_FONT_FAMILY }}
    >
      <div
        className={cn(
          'flex w-full shrink-0 items-center justify-end px-2 py-2',
          collapsed ? 'sm:min-h-full sm:flex-1 sm:items-start sm:justify-end sm:pt-3' : '',
        )}
      >
        <button
          type="button"
          data-testid="chat-file-preview-outline-toggle"
          aria-label={collapsed ? t('filePreview.expandOutline') : t('filePreview.collapseOutline')}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-foreground/52 transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/6"
          onClick={() => setCollapsed((current) => !current)}
        >
          {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
        </button>
      </div>
      <div className={cn('min-h-0 flex-1 overflow-y-auto px-2 py-2', collapsed && 'hidden')}>
        {items.map((item, index) => (
          <button
            key={item.id}
            type="button"
            data-testid={`chat-file-preview-outline-item-${index}`}
            className={cn(
              'flex w-full min-w-0 rounded-xl px-3 py-2 text-left text-[13px] leading-5 transition-colors',
              activeId === item.id
                ? 'bg-primary/10 text-primary'
                : 'text-foreground/72 hover:bg-black/5 hover:text-foreground dark:hover:bg-white/6',
            )}
            style={{ paddingLeft: `${12 + Math.max(0, item.level - 1) * 14}px` }}
            onClick={() => onSelect(item.id)}
            title={item.text}
          >
            <span
              data-testid={`chat-file-preview-outline-label-${index}`}
              className={cn(
                'block min-w-0 flex-1 truncate',
                item.level === 1 ? 'font-semibold' : 'font-normal',
              )}
            >
              {item.text}
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}

function MarkdownPreview({
  preview,
  mode,
}: {
  preview: Extract<FilePreviewPayload, { kind: 'markdown' }>;
  mode: 'panel' | 'modal';
}) {
  const outline = useMemo(() => extractMarkdownOutline(preview.content), [preview.content]);
  const [activeId, setActiveId] = useState<string | null>(outline[0]?.id ?? null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setActiveId(outline[0]?.id ?? null);
  }, [outline]);

  useEffect(() => {
    assignMarkdownHeadingAnchors(containerRef.current, outline);
  }, [outline, preview.content]);

  const handleSelectOutline = useCallback((id: string) => {
    setActiveId(id);
    const container = containerRef.current;
    assignMarkdownHeadingAnchors(container, outline);
    const target = findMarkdownHeadingAnchor(container, id);
    scrollElementIntoContainerView(container, target, 'auto');
  }, [outline]);

  if (outline.length === 0) {
    return (
      <div
        className={cn(
          'chat-markdown prose prose-sm min-h-full min-w-0 max-w-none overflow-auto text-foreground dark:prose-invert',
          mode === 'modal' ? 'px-1 py-1 sm:px-2' : 'px-4 py-4',
        )}
        style={{ fontFamily: SYSTEM_UI_FONT_FAMILY }}
      >
        <MarkdownRenderer content={preview.content} />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
      <DocumentOutline items={outline} activeId={activeId} onSelect={handleSelectOutline} />
      <div
        ref={containerRef}
        data-testid="chat-file-preview-markdown-surface"
        className={cn(
          'chat-markdown prose prose-sm min-h-0 min-w-0 max-w-none flex-1 overflow-auto text-foreground dark:prose-invert',
          mode === 'modal' ? 'px-3 py-3 sm:px-5' : 'px-4 py-4',
        )}
        style={{ fontFamily: SYSTEM_UI_FONT_FAMILY }}
      >
        <MarkdownRenderer content={preview.content} />
      </div>
    </div>
  );
}

function TextualPreview({
  preview,
  className,
}: {
  preview: Extract<FilePreviewPayload, { kind: 'text' | 'code' }>;
  className?: string;
}) {
  const isCode = preview.kind === 'code';
  return (
    <pre
      data-testid="chat-file-preview-textual-content"
      data-kind={preview.kind}
      className={cn(
        'min-h-full max-w-full whitespace-pre-wrap break-words bg-transparent p-0 text-[13px] leading-6 text-foreground/86 [overflow-wrap:anywhere]',
        isCode && 'font-mono',
        className,
      )}
      style={{
        fontFamily: isCode ? SYSTEM_MONO_FONT_FAMILY : SYSTEM_UI_FONT_FAMILY,
        overflowWrap: 'anywhere',
        wordBreak: 'break-word',
      }}
    >
      {isCode ? <code className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{preview.content}</code> : preview.content}
    </pre>
  );
}

function DocxPreview({
  file,
  preview,
  mode,
  language,
}: {
  file: AttachedFileMeta;
  preview: Extract<FilePreviewPayload, { kind: 'docx' }>;
  mode: 'panel' | 'modal';
  language: string;
}) {
  const [activeId, setActiveId] = useState<string | null>(preview.outline[0]?.id ?? null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const docxScaleCleanupRef = useRef<(() => void) | null>(null);
  const [frameLoadRevision, setFrameLoadRevision] = useState(0);
  const [useHtmlFallback, setUseHtmlFallback] = useState(!file.filePath);
  const [styledDocReady, setStyledDocReady] = useState(false);
  const docxSourceCacheKey = useMemo(
    () => `${file.filePath ?? ''}|${preview.fileName}|${preview.fileSize}`,
    [file.filePath, preview.fileName, preview.fileSize],
  );
  const iframeSrcDoc = useMemo(
    () => (
      useHtmlFallback
        ? buildDocxSrcDoc(preview.html, language)
        : buildDocxRenderShell(language, docxSourceCacheKey)
    ),
    [docxSourceCacheKey, language, preview.html, useHtmlFallback],
  );

  useEffect(() => {
    setActiveId(preview.outline[0]?.id ?? null);
  }, [preview.outline]);

  useEffect(() => {
    setUseHtmlFallback(!file.filePath);
    setStyledDocReady(false);
    docxScaleCleanupRef.current?.();
    docxScaleCleanupRef.current = null;
  }, [file.filePath, preview.fileName, preview.fileSize, preview.html]);

  useEffect(() => () => {
    docxScaleCleanupRef.current?.();
    docxScaleCleanupRef.current = null;
  }, []);

  useEffect(() => {
    if (useHtmlFallback || !file.filePath || frameLoadRevision === 0) {
      return;
    }

    let cancelled = false;
    setStyledDocReady(false);

    void (async () => {
      try {
        const frameDocument = iframeRef.current?.contentWindow?.document;
        const bodyContainer = frameDocument?.getElementById(DOCX_PREVIEW_ROOT_ID);
        if (!frameDocument || !bodyContainer) {
          throw new Error('DOCX preview frame is not ready');
        }

        const cachedBase64 = docxBinaryCache.get(docxSourceCacheKey);
        const source = cachedBase64
          ? { base64: cachedBase64 }
          : await hostApiFetch<DocxPreviewSourcePayload>('/api/files/preview-docx-source', {
              method: 'POST',
              body: JSON.stringify({
                filePath: file.filePath,
                fileName: preview.fileName,
                mimeType: preview.mimeType,
              }),
            });

        if (!cachedBase64) {
          docxBinaryCache.set(docxSourceCacheKey, source.base64);
        }

        const { renderAsync } = await import('docx-preview');
        if (cancelled) {
          return;
        }

        bodyContainer.replaceChildren();
        await renderAsync(
          decodeBase64ToUint8Array(source.base64),
          bodyContainer,
          frameDocument.head,
          {
            inWrapper: true,
            ignoreWidth: false,
            ignoreHeight: false,
            breakPages: false,
            ignoreLastRenderedPageBreak: true,
            useBase64URL: true,
            renderComments: false,
            renderChanges: false,
          },
        );

        if (cancelled) {
          return;
        }

        flattenDocxPreviewPages(frameDocument);
        upsertDocxPreviewOverrides(frameDocument);
        attachDocxHeadingAnchors(frameDocument, preview.outline);
        docxScaleCleanupRef.current?.();
        docxScaleCleanupRef.current = installDocxPreviewPageScaler(frameDocument);
        if (activeId) {
          frameDocument.getElementById(activeId)?.scrollIntoView({ behavior: 'auto', block: 'start' });
        }
        setStyledDocReady(true);
      } catch (error) {
        if (cancelled) {
          return;
        }
        console.warn('[docx-preview] Falling back to simplified HTML preview', error);
        setUseHtmlFallback(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    activeId,
    docxSourceCacheKey,
    file.filePath,
    frameLoadRevision,
    preview.fileName,
    preview.mimeType,
    preview.outline,
    useHtmlFallback,
  ]);

  const handleSelectOutline = useCallback((id: string) => {
    setActiveId(id);
    const frameDocument = iframeRef.current?.contentWindow?.document;
    const target = frameDocument?.getElementById(id);
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  if (preview.outline.length === 0) {
    return (
      <div className="relative min-h-full overflow-hidden bg-white">
        <iframe
          ref={iframeRef}
          title={preview.fileName}
          srcDoc={iframeSrcDoc}
          sandbox="allow-same-origin"
          data-testid="chat-file-preview-docx-frame"
          className="h-full min-h-[480px] w-full bg-white"
          onLoad={() => setFrameLoadRevision((current) => current + 1)}
        />
        {!useHtmlFallback && !styledDocReady ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/72 backdrop-blur-[1px]">
            <Loader2 className="h-5 w-5 animate-spin text-foreground/40" />
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
      <DocumentOutline items={preview.outline} activeId={activeId} onSelect={handleSelectOutline} />
      <div className={cn('relative min-h-0 flex-1 overflow-hidden bg-white', mode === 'modal' ? 'sm:pl-2' : '')}>
        <iframe
          ref={iframeRef}
          title={preview.fileName}
          srcDoc={iframeSrcDoc}
          sandbox="allow-same-origin"
          data-testid="chat-file-preview-docx-frame"
          className="h-full min-h-[480px] w-full bg-white"
          onLoad={() => setFrameLoadRevision((current) => current + 1)}
        />
        {!useHtmlFallback && !styledDocReady ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/72 backdrop-blur-[1px]">
            <Loader2 className="h-5 w-5 animate-spin text-foreground/40" />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function createSpreadsheetRangeFromSheet(sheet: SpreadsheetPreviewSheet): SpreadsheetRangePayload {
  return {
    ...sheet,
    merges: sheet.merges ?? [],
    rowOffset: sheet.rowOffset ?? 0,
    columnOffset: sheet.columnOffset ?? 0,
  };
}

function createSpreadsheetMergeLookup(merges: SpreadsheetPreviewMerge[] | undefined) {
  const owners = new Map<string, SpreadsheetPreviewMerge>();
  const covered = new Set<string>();

  for (const merge of merges ?? []) {
    const rowSpan = Math.max(1, merge.rowSpan);
    const columnSpan = Math.max(1, merge.columnSpan);
    if (rowSpan === 1 && columnSpan === 1) {
      continue;
    }

    owners.set(`${merge.row}:${merge.column}`, { ...merge, rowSpan, columnSpan });
    for (let rowIndex = merge.row; rowIndex < merge.row + rowSpan; rowIndex += 1) {
      for (let columnIndex = merge.column; columnIndex < merge.column + columnSpan; columnIndex += 1) {
        if (rowIndex === merge.row && columnIndex === merge.column) {
          continue;
        }
        covered.add(`${rowIndex}:${columnIndex}`);
      }
    }
  }

  return { owners, covered };
}

function SpreadsheetPreview({
  file,
  preview,
  className,
  mode,
}: {
  file: AttachedFileMeta;
  preview: Extract<FilePreviewPayload, { kind: 'spreadsheet' }>;
  className?: string;
  mode: 'panel' | 'modal';
}) {
  const { t } = useTranslation('chat');
  const defaultSheet = preview.sheets[0]?.name ?? '';
  const [activeSheet, setActiveSheet] = useState(defaultSheet);
  const initialRanges = useMemo(() => {
    return Object.fromEntries(preview.sheets.map((sheet) => [sheet.name, createSpreadsheetRangeFromSheet(sheet)]));
  }, [preview.sheets]);
  const [ranges, setRanges] = useState<Record<string, SpreadsheetRangePayload>>(() => initialRanges);
  const [loadingRangeKey, setLoadingRangeKey] = useState<string | null>(null);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const selectedSheet = preview.sheets.some((sheet) => sheet.name === activeSheet)
    ? activeSheet
    : defaultSheet;
  const selectedSheetMeta = preview.sheets.find((sheet) => sheet.name === selectedSheet) ?? preview.sheets[0] ?? null;
  const selectedRange = selectedSheetMeta
    ? ranges[selectedSheetMeta.name] ?? createSpreadsheetRangeFromSheet(selectedSheetMeta)
    : null;
  void mode;

  useEffect(() => {
    setActiveSheet(defaultSheet);
    setRanges(initialRanges);
    setLoadingRangeKey(null);
    setRangeError(null);
  }, [defaultSheet, initialRanges]);

  const loadSpreadsheetRange = useCallback(async (
    sheetName: string,
    nextRowLimit: number,
    nextColumnLimit: number,
  ) => {
    const sheet = preview.sheets.find((candidate) => candidate.name === sheetName);
    if (!file.filePath || !sheet) {
      return;
    }

    const maxRowLimit = Math.min(Math.max(SPREADSHEET_PAGE_ROW_COUNT, sheet.rowCount), SPREADSHEET_MAX_LOADED_ROWS);
    const maxColumnLimit = Math.min(Math.max(SPREADSHEET_PAGE_COLUMN_COUNT, sheet.columnCount), SPREADSHEET_MAX_LOADED_COLUMNS);
    const rowLimit = Math.min(Math.max(SPREADSHEET_PAGE_ROW_COUNT, nextRowLimit), maxRowLimit);
    const columnLimit = Math.min(Math.max(SPREADSHEET_PAGE_COLUMN_COUNT, nextColumnLimit), maxColumnLimit);
    const rangeKey = `${sheetName}:${rowLimit}:${columnLimit}`;
    setLoadingRangeKey(rangeKey);
    setRangeError(null);

    try {
      const range = await hostApiFetch<SpreadsheetRangePayload>('/api/files/preview-spreadsheet-range', {
        method: 'POST',
        body: JSON.stringify({
          filePath: file.filePath,
          fileName: preview.fileName,
          mimeType: preview.mimeType,
          sheetName,
          rowOffset: 0,
          columnOffset: 0,
          rowLimit,
          columnLimit,
        }),
      });
      setRanges((current) => ({ ...current, [sheetName]: range }));
    } catch (error) {
      setRangeError(t('filePreview.spreadsheetRangeLoadFailed', {
        error: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      setLoadingRangeKey((current) => (current === rangeKey ? null : current));
    }
  }, [file.filePath, preview.fileName, preview.mimeType, preview.sheets, t]);

  const isLoadingRange = loadingRangeKey !== null;

  const handleSpreadsheetScroll = useCallback((
    event: ReactUIEvent<HTMLDivElement>,
    range: SpreadsheetRangePayload,
  ) => {
    if (isLoadingRange || !file.filePath) {
      return;
    }

    const target = event.currentTarget;
    const loadedRows = range.rows.length;
    const loadedColumns = Math.max(0, ...range.rows.map((row) => row.length));
    const nearBottom = target.scrollHeight - target.scrollTop - target.clientHeight < SPREADSHEET_LOAD_MORE_THRESHOLD_PX;
    const nearRight = target.scrollWidth - target.scrollLeft - target.clientWidth < SPREADSHEET_LOAD_MORE_THRESHOLD_PX;
    const maxLoadedRows = Math.min(range.rowCount, SPREADSHEET_MAX_LOADED_ROWS);
    const maxLoadedColumns = Math.min(range.columnCount, SPREADSHEET_MAX_LOADED_COLUMNS);
    const shouldLoadRows = nearBottom && loadedRows < maxLoadedRows;
    const shouldLoadColumns = nearRight && loadedColumns < maxLoadedColumns;
    if (!shouldLoadRows && !shouldLoadColumns) {
      return;
    }

    const nextRowLimit = shouldLoadRows
      ? Math.min(maxLoadedRows, loadedRows + SPREADSHEET_PAGE_ROW_COUNT)
      : Math.max(loadedRows, SPREADSHEET_PAGE_ROW_COUNT);
    const nextColumnLimit = shouldLoadColumns
      ? Math.min(maxLoadedColumns, loadedColumns + SPREADSHEET_PAGE_COLUMN_COUNT)
      : Math.max(loadedColumns, SPREADSHEET_PAGE_COLUMN_COUNT);
    void loadSpreadsheetRange(range.name, nextRowLimit, nextColumnLimit);
  }, [file.filePath, isLoadingRange, loadSpreadsheetRange]);

  if (!selectedRange) {
    return (
      <div
        data-testid="chat-file-preview-spreadsheet"
        className={cn('flex min-h-0 flex-1 items-center justify-center text-[13px] text-foreground/58', className)}
        style={{ fontFamily: SYSTEM_UI_FONT_FAMILY }}
      >
        {t('filePreview.emptySpreadsheet')}
      </div>
    );
  }

  return (
    <Tabs
      value={selectedSheet}
      onValueChange={setActiveSheet}
      data-testid="chat-file-preview-spreadsheet"
      className={cn('flex min-h-0 flex-1 flex-col', className)}
      style={{ fontFamily: SYSTEM_UI_FONT_FAMILY }}
    >
      <TabsList className="h-auto w-fit max-w-full flex-wrap rounded-2xl bg-black/[0.04] p-1 dark:bg-white/[0.06]">
        {preview.sheets.map((sheet) => (
          <TabsTrigger key={sheet.name} value={sheet.name} className="rounded-xl">
            {sheet.name}
          </TabsTrigger>
        ))}
      </TabsList>
      {preview.sheets.map((sheet) => {
        const range = sheet.name === selectedRange.name
          ? selectedRange
          : ranges[sheet.name] ?? createSpreadsheetRangeFromSheet(sheet);
        const loadedRowCount = range.rows.length;
        const loadedColumnCount = Math.max(0, ...range.rows.map((row) => row.length));
        const rowStart = range.rowCount === 0 ? 0 : 1;
        const rowEnd = Math.min(loadedRowCount, range.rowCount);
        const columnStart = range.columnCount === 0 ? 0 : 1;
        const columnEnd = Math.min(loadedColumnCount, range.columnCount);
        const mergeLookup = createSpreadsheetMergeLookup(range.merges);
        return (
        <TabsContent key={sheet.name} value={sheet.name} className="mt-4 min-h-0 flex-1 outline-none">
          <div className="flex h-full min-h-0 flex-col overflow-hidden" style={{ fontFamily: SYSTEM_UI_FONT_FAMILY }}>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/6 px-1 py-3 text-[12px] text-foreground/60 dark:border-white/8">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Table2 className="h-4 w-4" />
                <span>{t('filePreview.rows', { count: range.rowCount })}</span>
                <span>|</span>
                <span>{t('filePreview.columns', { count: range.columnCount })}</span>
                {(range.rows.length < range.rowCount || Math.max(0, ...range.rows.map((row) => row.length)) < range.columnCount) ? (
                  <span className="text-foreground/46">{t('filePreview.largeSpreadsheetHint')}</span>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-foreground/54">
                <span>{t('filePreview.rowWindow', { start: rowStart, end: rowEnd, total: range.rowCount })}</span>
                <span>|</span>
                <span>{t('filePreview.columnWindow', { start: columnStart, end: columnEnd, total: range.columnCount })}</span>
              </div>
            </div>
            {(isLoadingRange || rangeError) ? (
              <div className="border-b border-black/6 px-1 py-2 text-[12px] text-foreground/58 dark:border-white/8">
                {isLoadingRange ? t('filePreview.loadingSpreadsheetRange') : rangeError}
              </div>
            ) : null}
            <div
              data-testid="chat-file-preview-spreadsheet-grid"
              className="min-h-0 flex-1 overflow-auto"
              onScroll={(event) => handleSpreadsheetScroll(event, range)}
            >
              <table className="w-full border-collapse text-left text-[13px]">
                <tbody>
                  {range.rows.map((row, rowIndex) => (
                    <tr key={`${range.name}-${range.rowOffset}-${range.columnOffset}-${rowIndex}`} className="align-top odd:bg-black/[0.015] dark:odd:bg-white/[0.03]">
                      <th
                        data-testid={rowIndex === 0 ? 'chat-file-preview-spreadsheet-header-row' : undefined}
                        className={cn(
                          'sticky left-0 w-12 min-w-12 border-b border-r border-black/6 bg-slate-50 px-3 py-2 text-left text-[11px] font-medium text-foreground/46 dark:border-white/8 dark:bg-slate-900',
                          rowIndex === 0 ? 'top-0 z-30' : 'z-10',
                        )}
                        scope="row"
                      >
                        {range.rowOffset + rowIndex + 1}
                      </th>
                      {row.map((cell, cellIndex) => {
                        const mergeKey = `${rowIndex}:${cellIndex}`;
                        if (mergeLookup.covered.has(mergeKey)) {
                          return null;
                        }

                        const merge = mergeLookup.owners.get(mergeKey);
                        const CellTag = rowIndex === 0 ? 'th' : 'td';
                        return (
                          <CellTag
                            key={`${range.name}-${rowIndex}-${range.columnOffset + cellIndex}`}
                            rowSpan={merge?.rowSpan}
                            colSpan={merge?.columnSpan}
                            className={cn(
                              'min-w-[140px] border-b border-r border-black/6 px-3 py-2 text-left dark:border-white/8',
                              rowIndex === 0
                                ? 'sticky top-0 z-20 bg-slate-50 font-semibold text-foreground/86 shadow-[0_1px_0_rgba(15,23,42,0.08)] dark:bg-slate-900'
                                : 'text-foreground/82',
                            )}
                            scope={rowIndex === 0 ? 'col' : undefined}
                          >
                            {cell}
                          </CellTag>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(range.truncatedRows || range.truncatedColumns || preview.truncatedSheets) && (
              <div className="border-t border-black/6 px-1 py-3 text-[12px] text-foreground/58 dark:border-white/8">
                {range.truncatedRows ? t('filePreview.firstRowsOnly') : null}
                {range.truncatedRows && range.truncatedColumns ? ' ' : null}
                {range.truncatedColumns ? t('filePreview.trailingColumnsHidden') : null}
                {(range.truncatedRows || range.truncatedColumns) && preview.truncatedSheets ? ' ' : null}
                {preview.truncatedSheets ? t('filePreview.extraSheetsHidden') : null}
              </div>
            )}
          </div>
        </TabsContent>
        );
      })}
    </Tabs>
  );
}

function OfficePageCanvas({
  pdfDocument,
  pageNumber,
  shouldRender,
  dataTestId,
}: {
  pdfDocument: PdfDocumentLike | null;
  pageNumber: number;
  shouldRender: boolean;
  dataTestId?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [aspectRatio, setAspectRatio] = useState('794 / 1123');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    setRendered(false);
    setError(null);
  }, [pdfDocument, pageNumber]);

  useEffect(() => {
    if (!pdfDocument || !shouldRender || rendered) {
      return;
    }

    let cancelled = false;
    let renderTask: PdfRenderTaskLike | null = null;
    setLoading(true);
    setError(null);

    void (async () => {
      const page = await pdfDocument.getPage(pageNumber);
      if (cancelled) {
        page.cleanup?.();
        return;
      }

      const baseViewport = page.getViewport({ scale: 1 });
      const targetWidth = Math.min(1400, Math.max(900, Math.round(baseViewport.width * 1.6)));
      const scale = targetWidth / Math.max(1, baseViewport.width);
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      const context = canvas?.getContext('2d');
      if (!canvas || !context) {
        throw new Error('Office page canvas is not ready');
      }

      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      setAspectRatio(`${Math.max(1, baseViewport.width)} / ${Math.max(1, baseViewport.height)}`);

      renderTask = page.render({
        canvasContext: context,
        viewport,
      });
      await renderTask.promise;
      page.cleanup?.();

      if (!cancelled) {
        setRendered(true);
      }
    })()
      .catch((renderError) => {
        if (!cancelled) {
          setError(renderError instanceof Error ? renderError.message : String(renderError));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      renderTask?.cancel?.();
    };
  }, [pdfDocument, pageNumber, rendered, shouldRender]);

  return (
    <div
      data-testid={dataTestId}
      className="relative mx-auto w-full max-w-[1040px] overflow-hidden bg-white shadow-[0_18px_42px_rgba(15,23,42,0.16)] dark:bg-white"
      style={{ aspectRatio }}
    >
      <canvas
        ref={canvasRef}
        className={cn('block h-full w-full bg-white object-contain', rendered ? 'opacity-100' : 'opacity-0')}
      />
      {!rendered || loading ? (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-100/80">
          <Loader2 className="h-5 w-5 animate-spin text-foreground/42" />
        </div>
      ) : null}
      {error ? (
        <div className="absolute inset-0 flex items-center justify-center bg-white/80 px-4 text-center text-[12px] text-foreground/56">
          {error}
        </div>
      ) : null}
    </div>
  );
}

function OfficePagesPreview({
  file,
  preview,
  className,
  mode,
  language,
}: {
  file: AttachedFileMeta;
  preview: Extract<FilePreviewPayload, { kind: 'office-pages' }>;
  className?: string;
  mode: 'panel' | 'modal';
  language: string;
}) {
  const { t } = useTranslation('chat');
  const [pdfDocument, setPdfDocument] = useState<PdfDocumentLike | null>(null);
  const [pageCount, setPageCount] = useState(preview.pageCount);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [docxFallbackPreview, setDocxFallbackPreview] = useState<Extract<FilePreviewPayload, { kind: 'docx' }> | null>(null);
  const [loadedPages, setLoadedPages] = useState<Set<number>>(() => new Set(OFFICE_PAGE_INITIAL_RENDERED_PAGES));
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const pageSectionRefs = useRef(new Map<number, HTMLElement>());
  const shouldTryDocxFallback = Boolean(file.filePath && /\.docx$/i.test(file.fileName || file.filePath || ''));

  useEffect(() => {
    let cancelled = false;
    let loadedDocument: PdfDocumentLike | null = null;
    setPdfDocument(null);
    setPageCount(preview.pageCount);
    setLoadError(null);
    setDocxFallbackPreview(null);
    setLoadedPages(new Set(OFFICE_PAGE_INITIAL_RENDERED_PAGES));

    const cacheKey = buildOfficePagesPdfCacheKey(preview.previewId);
    void (async () => {
      const cachedPdf = officePagesPdfCache.get(cacheKey);
      const source = cachedPdf
        ? { src: cachedPdf }
        : await hostApiFetch<{ src: string }>('/api/files/preview-office-pages-pdf', {
            method: 'POST',
            body: JSON.stringify({
              previewId: preview.previewId,
            }),
          });
      if (!cachedPdf) {
        officePagesPdfCache.set(cacheKey, source.src);
      }

      const nextDocument = await loadPdfDocumentFromDataUrl(source.src);
      loadedDocument = nextDocument;
      if (cancelled) {
        await nextDocument.destroy?.();
        return;
      }
      setPdfDocument(nextDocument);
      setPageCount(Math.min(nextDocument.numPages, preview.pageCount));
    })()
      .catch((error) => {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : String(error);
          if (shouldTryDocxFallback && file.filePath) {
            void hostApiFetch<Extract<FilePreviewPayload, { kind: 'docx' }>>('/api/files/preview-docx-fallback', {
              method: 'POST',
              body: JSON.stringify({
                filePath: file.filePath,
                fileName: file.fileName,
                mimeType: file.mimeType,
              }),
            })
              .then((fallbackPreview) => {
                if (!cancelled) {
                  setDocxFallbackPreview(fallbackPreview);
                }
              })
              .catch(() => {
                if (!cancelled) {
                  setLoadError(message);
                }
              });
            return;
          }
          setLoadError(message);
        }
      });

    return () => {
      cancelled = true;
      void loadedDocument?.destroy?.();
    };
  }, [file.fileName, file.filePath, file.mimeType, preview.pageCount, preview.previewId, shouldTryDocxFallback]);

  const setPageSectionRef = useCallback((pageNumber: number, node: HTMLElement | null) => {
    if (node) {
      pageSectionRefs.current.set(pageNumber, node);
      return;
    }
    pageSectionRefs.current.delete(pageNumber);
  }, []);

  useEffect(() => {
    const container = scrollerRef.current;
    if (!container || typeof window.IntersectionObserver !== 'function') {
      setLoadedPages(new Set(Array.from({ length: pageCount }, (_unused, index) => index + 1)));
      return;
    }

    const observer = new window.IntersectionObserver((entries) => {
      const nextPages = new Set<number>();
      for (const entry of entries) {
        if (!entry.isIntersecting && entry.intersectionRatio <= 0) {
          continue;
        }

        const pageNumber = Number((entry.target as HTMLElement).dataset.officePageNumber ?? '');
        if (!Number.isFinite(pageNumber) || pageNumber < 1) {
          continue;
        }

        for (let candidate = Math.max(1, pageNumber - 1); candidate <= Math.min(pageCount, pageNumber + 2); candidate += 1) {
          nextPages.add(candidate);
        }
      }

      if (nextPages.size === 0) {
        return;
      }

      setLoadedPages((current) => {
        let changed = false;
        const next = new Set(current);
        for (const pageNumber of nextPages) {
          if (!next.has(pageNumber)) {
            next.add(pageNumber);
            changed = true;
          }
        }
        return changed ? next : current;
      });
    }, {
      root: container,
      rootMargin: PRESENTATION_LOAD_ROOT_MARGIN,
      threshold: 0.01,
    });

    for (const [pageNumber, node] of pageSectionRefs.current.entries()) {
      node.dataset.officePageNumber = String(pageNumber);
      observer.observe(node);
    }

    return () => {
      observer.disconnect();
    };
  }, [pageCount, pdfDocument]);

  if (loadError) {
    return (
      <div className="flex min-h-[320px] flex-1 items-center justify-center px-8 text-center text-[14px] leading-7 text-foreground/68">
        {t('filePreview.loadFailed', { error: loadError })}
      </div>
    );
  }

  if (docxFallbackPreview) {
    return <DocxPreview file={file} preview={docxFallbackPreview} mode={mode} language={language} />;
  }

  return (
    <div
      ref={scrollerRef}
      data-testid="chat-file-preview-office-pages-scroller"
      className={cn('h-full min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain', className)}
      style={{ fontFamily: SYSTEM_UI_FONT_FAMILY, touchAction: 'pan-y' }}
    >
      <div className="space-y-8 px-2 py-3 sm:space-y-10 sm:px-4 sm:py-4">
        {Array.from({ length: pageCount }, (_unused, index) => {
          const pageNumber = index + 1;
          return (
            <section
              key={`office-page-${pageNumber}`}
              ref={(node) => setPageSectionRef(pageNumber, node)}
              data-testid={`chat-file-preview-office-page-section-${index}`}
              className="scroll-mt-4"
            >
              <OfficePageCanvas
                pdfDocument={pdfDocument}
                pageNumber={pageNumber}
                shouldRender={loadedPages.has(pageNumber)}
                dataTestId={`chat-file-preview-office-page-${index}`}
              />
              <div className="mt-3 text-center text-[12px] text-foreground/48">
                {t('filePreview.slideProgress', {
                  current: pageNumber,
                  total: pageCount,
                })}
              </div>
            </section>
          );
        })}

        {preview.truncatedPages ? (
          <div className="rounded-2xl border border-dashed border-black/10 bg-white/60 px-4 py-3 text-[12px] text-foreground/56 dark:border-white/12 dark:bg-white/[0.03]">
            {t('filePreview.extraPagesHidden')}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function LegacyPresentationPreview({
  preview,
  className,
}: {
  preview: Extract<FilePreviewPayload, { kind: 'presentation' }>;
  className?: string;
}) {
  const { t } = useTranslation('chat');

  return (
    <div className={cn('space-y-4', className)} style={{ fontFamily: SYSTEM_UI_FONT_FAMILY }}>
      {preview.slides.map((slide) => (
        <section
          key={`${slide.index}-${slide.title}`}
          className="overflow-hidden border border-black/6 bg-white/92 dark:border-white/8 dark:bg-white/[0.03]"
        >
          <div className="border-b border-black/6 bg-slate-50/80 px-4 py-3 dark:border-white/8 dark:bg-white/[0.04]">
            <div className="text-[11px] uppercase tracking-[0.24em] text-foreground/38">{t('filePreview.slideLabel', { count: slide.index })}</div>
            <h3 className="mt-1 text-[16px] font-semibold text-foreground">{slide.title}</h3>
          </div>
          <div className="space-y-3 px-5 py-5">
            {slide.paragraphs.map((paragraph, index) => (
              <p key={`${slide.index}-${index}`} className="text-[14px] leading-7 text-foreground/82">
                {paragraph}
              </p>
            ))}
            {slide.truncatedParagraphs ? (
              <p className="text-[12px] text-foreground/52">{t('filePreview.extraSlideContentHidden')}</p>
            ) : null}
          </div>
        </section>
      ))}
      {preview.truncatedSlides ? (
        <div className="rounded-2xl border border-dashed border-black/10 px-4 py-3 text-[12px] text-foreground/56 dark:border-white/12">
          {t('filePreview.extraSlidesHidden')}
        </div>
      ) : null}
    </div>
  );
}

function PresentationSlideFrame({
  preview,
  slideIndex,
  mode,
  className,
  dataTestId,
  shouldLoad = true,
  loadingBehavior = 'eager',
}: {
  preview: Extract<FilePreviewPayload, { kind: 'presentation' }>;
  slideIndex: number;
  mode: 'main' | 'thumbnail';
  className?: string;
  dataTestId?: string;
  shouldLoad?: boolean;
  loadingBehavior?: 'eager' | 'lazy';
}) {
  const cacheKey = preview.previewId ? buildPresentationSlideCacheKey(preview.previewId, slideIndex) : '';
  const renderMode = preview.renderMode ?? 'html';
  const initialHtml = renderMode === 'html' && cacheKey ? presentationSlideCache.get(cacheKey) ?? null : null;
  const initialImageSrc = renderMode === 'image' && cacheKey ? presentationSlideImageCache.get(cacheKey) ?? null : null;
  const [rawHtml, setRawHtml] = useState<string | null>(initialHtml);
  const [imageSrc, setImageSrc] = useState<string | null>(initialImageSrc);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    setRawHtml(initialHtml);
    setImageSrc(initialImageSrc);
    setLoadError(null);
  }, [cacheKey, initialHtml, initialImageSrc]);

  useEffect(() => {
    if (!shouldLoad || !preview.previewId || !cacheKey) {
      return;
    }

    if (renderMode === 'html' && initialHtml) {
      return;
    }
    if (renderMode === 'image' && initialImageSrc) {
      return;
    }

    let cancelled = false;
    const requestPromise = renderMode === 'image'
      ? hostApiFetch<{ src: string }>('/api/files/preview-slide-image', {
          method: 'POST',
          body: JSON.stringify({
            previewId: preview.previewId,
            slideIndex,
          }),
        }).then((result) => {
          if (cancelled) return;
          presentationSlideImageCache.set(cacheKey, result.src);
          setImageSrc(result.src);
        })
      : hostApiFetch<{ html: string }>('/api/files/preview-slide', {
          method: 'POST',
          body: JSON.stringify({
            previewId: preview.previewId,
            slideIndex,
          }),
        }).then((result) => {
          if (cancelled) return;
          presentationSlideCache.set(cacheKey, result.html);
          setRawHtml(result.html);
        });

    void requestPromise.catch((slideError) => {
      if (cancelled) return;
      setLoadError(slideError instanceof Error ? slideError.message : String(slideError));
    });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, initialHtml, initialImageSrc, preview.previewId, renderMode, shouldLoad, slideIndex]);

  const srcDoc = useMemo(() => {
    if (!rawHtml) return null;
    return buildPresentationSlideSrcDoc(
      rawHtml,
      preview.slideWidth ?? 960,
      preview.slideHeight ?? 540,
      mode,
    );
  }, [mode, preview.slideHeight, preview.slideWidth, rawHtml]);

  const slideSummary = preview.slides.find((slide) => slide.index === slideIndex);
  const visualReady = renderMode === 'image' ? Boolean(imageSrc) : Boolean(srcDoc);

  if (!shouldLoad && !visualReady) {
    return (
      <div
        data-testid={dataTestId}
        className={cn(
          'rounded-[inherit] bg-[linear-gradient(180deg,rgba(241,245,249,0.96),rgba(226,232,240,0.96))] dark:bg-[linear-gradient(180deg,rgba(15,23,42,0.76),rgba(30,41,59,0.76))]',
          className,
        )}
        aria-hidden="true"
      />
    );
  }

  if (loadError) {
    return (
      <div
        data-testid={dataTestId}
        className={cn(
          'flex items-center justify-center rounded-[inherit] border border-dashed border-black/10 bg-white/70 px-4 py-4 text-center text-[12px] text-foreground/52 dark:border-white/12 dark:bg-white/[0.03]',
          className,
        )}
        style={{ fontFamily: SYSTEM_UI_FONT_FAMILY }}
      >
        {slideSummary?.title || loadError}
      </div>
    );
  }

  if (!visualReady) {
    return (
      <div
        data-testid={dataTestId}
        className={cn('flex items-center justify-center rounded-[inherit] bg-slate-100/80 dark:bg-white/[0.04]', className)}
      >
        <Loader2 className="h-5 w-5 animate-spin text-foreground/42" />
      </div>
    );
  }

  if (renderMode === 'image' && imageSrc) {
    return (
      <img
        src={imageSrc}
        alt={slideSummary?.title || `Slide ${slideIndex}`}
        loading={loadingBehavior}
        draggable={false}
        data-testid={dataTestId}
        className={cn('block h-full w-full select-none object-contain', className)}
      />
    );
  }

  return (
    <iframe
      title={slideSummary?.title || `Slide ${slideIndex}`}
      srcDoc={srcDoc ?? undefined}
      sandbox="allow-scripts allow-same-origin"
      scrolling="no"
      loading={loadingBehavior}
      data-testid={dataTestId}
      className={cn('pointer-events-none h-full w-full rounded-[inherit] border-0 bg-transparent select-none', className)}
    />
  );
}

function PresentationPreview({
  preview,
  className,
  mode,
  initialSlideIndex,
  onActiveSlideChange,
}: {
  preview: Extract<FilePreviewPayload, { kind: 'presentation' }>;
  className?: string;
  mode: 'panel' | 'modal';
  initialSlideIndex?: number;
  onActiveSlideChange?: (slideIndex: number) => void;
}) {
  const { t } = useTranslation('chat');
  const renderMode = preview.renderMode ?? 'html';
  const hasVisualSlides = Boolean(preview.previewId && preview.slideWidth && preview.slideHeight);
  const fallbackSlideIndex = preview.slides[0]?.index ?? 1;
  const resolvedInitialSlideIndex = typeof initialSlideIndex === 'number'
    && preview.slides.some((slide) => slide.index === initialSlideIndex)
    ? initialSlideIndex
    : fallbackSlideIndex;
  const [activeSlideIndex, setActiveSlideIndex] = useState(resolvedInitialSlideIndex);
  const activeSlide = preview.slides.find((slide) => slide.index === activeSlideIndex) ?? preview.slides[0] ?? null;
  const stageAspectRatio = preview.slideWidth && preview.slideHeight
    ? `${preview.slideWidth} / ${preview.slideHeight}`
    : '16 / 9';
  const stageMaxWidthClass = mode === 'modal' ? 'max-w-[1320px]' : 'max-w-[1180px]';
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const slideSectionRefs = useRef(new Map<number, HTMLElement>());
  const pendingScrollTargetRef = useRef<number | null>(null);
  const slideIndexPositions = useMemo(
    () => new Map(preview.slides.map((slide, position) => [slide.index, position])),
    [preview.slides],
  );
  const collectSlidesAround = useCallback((slideIndex: number) => {
    const centerPosition = slideIndexPositions.get(slideIndex) ?? 0;
    const start = Math.max(0, centerPosition - PRESENTATION_PRELOAD_RADIUS);
    const end = Math.min(preview.slides.length - 1, centerPosition + PRESENTATION_PRELOAD_RADIUS);
    const indexes: number[] = [];
    for (let position = start; position <= end; position += 1) {
      const candidate = preview.slides[position];
      if (candidate) {
        indexes.push(candidate.index);
      }
    }
    return indexes;
  }, [preview.slides, slideIndexPositions]);
  const buildLoadedSlideSet = useCallback((seedSlideIndex: number) => {
    return new Set(collectSlidesAround(seedSlideIndex));
  }, [collectSlidesAround]);
  const [loadedSlideIndexes, setLoadedSlideIndexes] = useState<Set<number>>(() => (
    buildLoadedSlideSet(resolvedInitialSlideIndex)
  ));
  const activeSlidePosition = preview.slides.findIndex((slide) => slide.index === activeSlideIndex);

  const setSlideSectionRef = useCallback((slideIndex: number, node: HTMLElement | null) => {
    if (node) {
      slideSectionRefs.current.set(slideIndex, node);
      return;
    }
    slideSectionRefs.current.delete(slideIndex);
  }, []);

  const updateActiveSlideIndex = useCallback((nextSlideIndex: number) => {
    setActiveSlideIndex((current) => current === nextSlideIndex ? current : nextSlideIndex);
    onActiveSlideChange?.(nextSlideIndex);
  }, [onActiveSlideChange]);

  const handlePresentationStageWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    const container = scrollerRef.current;
    if (!container || Math.abs(event.deltaY) < 0.5) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    container.scrollBy({
      top: event.deltaY,
      left: 0,
      behavior: 'auto',
    });
  }, []);

  useEffect(() => {
    const container = scrollerRef.current;
    if (!container) {
      return;
    }

    const handleNativeWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) < 0.5) {
        return;
      }

      event.preventDefault();
      container.scrollBy({
        top: event.deltaY,
        left: 0,
        behavior: 'auto',
      });
    };

    container.addEventListener('wheel', handleNativeWheel, { passive: false, capture: true });
    return () => {
      container.removeEventListener('wheel', handleNativeWheel, { capture: true });
    };
  }, []);

  const syncActiveSlideFromScroll = useCallback(() => {
    const container = scrollerRef.current;
    if (!container || preview.slides.length === 0) {
      return;
    }

    const containerTop = container.getBoundingClientRect().top;
    const pendingSlideIndex = pendingScrollTargetRef.current;
    if (pendingSlideIndex !== null) {
      const pendingNode = slideSectionRefs.current.get(pendingSlideIndex);
      if (pendingNode) {
        const pendingDistance = Math.abs(pendingNode.getBoundingClientRect().top - containerTop - 20);
        updateActiveSlideIndex(pendingSlideIndex);
        if (pendingDistance <= PRESENTATION_SCROLL_SETTLE_THRESHOLD_PX) {
          pendingScrollTargetRef.current = null;
        }
      }
      return;
    }

    const firstSlideIndex = preview.slides[0]?.index ?? 1;
    let nextActiveSlideIndex = firstSlideIndex;
    let upcomingSlideIndex: number | null = null;

    for (const slide of preview.slides) {
      const node = slideSectionRefs.current.get(slide.index);
      if (!node) continue;

      const relativeTop = node.getBoundingClientRect().top - containerTop;
      if (relativeTop <= PRESENTATION_ACTIVE_SLIDE_OFFSET_PX) {
        nextActiveSlideIndex = slide.index;
        continue;
      }

      if (upcomingSlideIndex === null) {
        upcomingSlideIndex = slide.index;
      }
    }

    if (nextActiveSlideIndex === firstSlideIndex && upcomingSlideIndex !== null) {
      nextActiveSlideIndex = upcomingSlideIndex;
    }

    updateActiveSlideIndex(nextActiveSlideIndex);
  }, [preview.slides, updateActiveSlideIndex]);

  useEffect(() => {
    pendingScrollTargetRef.current = resolvedInitialSlideIndex;
    updateActiveSlideIndex(resolvedInitialSlideIndex);
    setLoadedSlideIndexes(buildLoadedSlideSet(resolvedInitialSlideIndex));
  }, [buildLoadedSlideSet, preview.fileName, preview.previewId, resolvedInitialSlideIndex, updateActiveSlideIndex]);

  useEffect(() => {
    const slidesToLoad = collectSlidesAround(activeSlideIndex);
    if (slidesToLoad.length === 0) {
      return;
    }

    setLoadedSlideIndexes((current) => {
      let changed = false;
      const next = new Set(current);
      for (const slideIndex of slidesToLoad) {
        if (!next.has(slideIndex)) {
          next.add(slideIndex);
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [activeSlideIndex, collectSlidesAround]);

  useEffect(() => {
    const container = scrollerRef.current;
    if (!container || preview.slides.length === 0) {
      return;
    }

    if (typeof window.IntersectionObserver !== 'function') {
      setLoadedSlideIndexes(new Set(preview.slides.map((slide) => slide.index)));
      return;
    }

    const observer = new window.IntersectionObserver((entries) => {
      const nextSlideIndexes = new Set<number>();
      for (const entry of entries) {
        if (!entry.isIntersecting && entry.intersectionRatio <= 0) {
          continue;
        }

        const slideIndex = Number((entry.target as HTMLElement).dataset.presentationSlideIndex ?? '');
        if (!Number.isFinite(slideIndex) || slideIndex < 1) {
          continue;
        }

        for (const preloadSlideIndex of collectSlidesAround(slideIndex)) {
          nextSlideIndexes.add(preloadSlideIndex);
        }
      }

      if (nextSlideIndexes.size === 0) {
        return;
      }

      setLoadedSlideIndexes((current) => {
        let changed = false;
        const next = new Set(current);
        for (const slideIndex of nextSlideIndexes) {
          if (!next.has(slideIndex)) {
            next.add(slideIndex);
            changed = true;
          }
        }
        return changed ? next : current;
      });
    }, {
      root: container,
      rootMargin: PRESENTATION_LOAD_ROOT_MARGIN,
      threshold: 0.01,
    });

    for (const [slideIndex, node] of slideSectionRefs.current.entries()) {
      node.dataset.presentationSlideIndex = String(slideIndex);
      observer.observe(node);
    }

    return () => {
      observer.disconnect();
    };
  }, [collectSlidesAround, preview.previewId, preview.slides]);

  useEffect(() => {
    const pendingSlideIndex = pendingScrollTargetRef.current;
    const container = scrollerRef.current;
    const node = pendingSlideIndex ? slideSectionRefs.current.get(pendingSlideIndex) : null;
    if (!pendingSlideIndex || !container || !node) {
      return;
    }

    container.scrollTo({
      top: Math.max(0, node.offsetTop - 20),
      behavior: 'auto',
    });
    updateActiveSlideIndex(pendingSlideIndex);
    window.requestAnimationFrame(() => {
      syncActiveSlideFromScroll();
    });
  }, [activeSlideIndex, preview.slides, syncActiveSlideFromScroll, updateActiveSlideIndex]);

  useEffect(() => {
    const container = scrollerRef.current;
    if (!container) {
      return;
    }

    let frameId: number | null = null;
    const queueSync = () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        syncActiveSlideFromScroll();
      });
    };

    queueSync();
    container.addEventListener('scroll', queueSync, { passive: true });
    window.addEventListener('resize', queueSync);

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      container.removeEventListener('scroll', queueSync);
      window.removeEventListener('resize', queueSync);
    };
  }, [syncActiveSlideFromScroll]);

  if (!hasVisualSlides || !activeSlide) {
    return <LegacyPresentationPreview preview={preview} className={className} />;
  }

  return (
    <div
      ref={scrollerRef}
      data-testid="chat-file-preview-presentation-scroller"
      className={cn(
        'h-full min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain',
        className,
      )}
      style={{ fontFamily: SYSTEM_UI_FONT_FAMILY, touchAction: 'pan-y' }}
    >
      <div className="space-y-8 px-2 py-3 sm:space-y-10 sm:px-4 sm:py-4">
        {preview.slides.map((slide, index) => {
          const isActiveSlide = slide.index === activeSlideIndex;

          return (
            <section
              key={`presentation-slide-${slide.index}`}
              ref={(node) => setSlideSectionRef(slide.index, node)}
              data-testid={`chat-file-preview-presentation-section-${index}`}
              className="scroll-mt-4"
            >
              <div
                data-testid={`chat-file-preview-presentation-page-${index}`}
                className={cn(
                  'relative mx-auto w-full overflow-hidden bg-white shadow-[0_18px_42px_rgba(15,23,42,0.16)] dark:bg-white',
                  stageMaxWidthClass,
                )}
              >
                <div
                  data-testid={isActiveSlide ? 'chat-file-preview-presentation-stage' : undefined}
                  className="relative w-full"
                  style={{ aspectRatio: stageAspectRatio }}
                >
                  {renderMode === 'html' ? (
                    <div
                      aria-hidden="true"
                      className="absolute inset-0 z-10"
                      onWheel={handlePresentationStageWheel}
                    />
                  ) : null}
                  <PresentationSlideFrame
                    preview={preview}
                    slideIndex={slide.index}
                    mode="main"
                    dataTestId={`chat-file-preview-presentation-frame-${index}`}
                    className="rounded-none bg-white"
                    shouldLoad={loadedSlideIndexes.has(slide.index) || activeSlidePosition < 0}
                    loadingBehavior={renderMode === 'image' ? 'eager' : 'lazy'}
                  />
                </div>
              </div>
              <div className="mt-3 text-center text-[12px] text-foreground/48">
                {t('filePreview.slideProgress', {
                  current: slide.index,
                  total: preview.slides.length,
                })}
              </div>
            </section>
          );
        })}

        {preview.truncatedSlides ? (
          <div className="rounded-2xl border border-dashed border-black/10 bg-white/60 px-4 py-3 text-[12px] text-foreground/56 dark:border-white/12 dark:bg-white/[0.03]">
            {t('filePreview.extraSlidesHidden')}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ImagePreviewSurface({
  file,
  preview,
  mode,
  onOpenFullscreen,
  onCopy,
}: {
  file: AttachedFileMeta;
  preview: Extract<FilePreviewPayload, { kind: 'image' }>;
  mode: 'panel' | 'modal';
  onOpenFullscreen?: () => void;
  onCopy: () => void;
}) {
  const { t } = useTranslation(['chat', 'common']);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    setZoom(1);
  }, [file.fileName, file.filePath, preview.src]);

  const handleContextMenu = useCallback((event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    onCopy();
  }, [onCopy]);

  const handleWheelZoom = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    const zoomDelta = getWheelZoomDelta(event.deltaY);
    if (zoomDelta === 0) {
      return;
    }
    event.preventDefault();
    setZoom((current) => clampZoom(current + zoomDelta));
  }, []);

  return (
    <div
      data-testid="chat-file-preview-image-surface"
      className={cn(
        'flex min-h-0 flex-1 items-start justify-center overflow-auto p-4',
        mode === 'panel' && 'cursor-zoom-in',
      )}
      onClick={mode === 'panel' ? onOpenFullscreen : undefined}
      onContextMenu={handleContextMenu}
      onWheel={handleWheelZoom}
      style={{ fontFamily: SYSTEM_UI_FONT_FAMILY }}
    >
      <div className="group relative block" title={mode === 'panel' ? t('filePreview.openFullscreen') : file.fileName}>
        <img
          data-testid="chat-file-preview-image-element"
          src={preview.src}
          alt={file.fileName}
          className="block max-h-full w-auto max-w-full"
          style={{
            transform: `scale(${zoom})`,
            transformOrigin: 'center center',
            willChange: 'transform',
          }}
        />
        {mode === 'panel' ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/10 dark:group-hover:bg-black/16">
            <div className="rounded-full bg-white/88 px-3 py-1 text-[12px] font-medium text-slate-900 opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
              {t('filePreview.openFullscreen')}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PreviewSurface({
  file,
  preview,
  mode,
  language,
  onOpenFullscreen,
  onCopyImage,
  presentationInitialSlideIndex,
  onPresentationSlideChange,
}: {
  file: AttachedFileMeta;
  preview: FilePreviewPayload;
  mode: 'panel' | 'modal';
  language: string;
  onOpenFullscreen?: () => void;
  onCopyImage: () => void;
  presentationInitialSlideIndex?: number;
  onPresentationSlideChange?: (slideIndex: number) => void;
}) {
  const { t } = useTranslation('chat');
  const isModal = mode === 'modal';
  const contentClassName = 'min-h-0 flex-1';

  switch (preview.kind) {
    case 'image':
      return (
        <ImagePreviewSurface
          file={file}
          preview={preview}
          mode={mode}
          onOpenFullscreen={onOpenFullscreen}
          onCopy={onCopyImage}
        />
      );
    case 'pdf':
      return (
        <div className={cn('min-h-full overflow-hidden bg-white', contentClassName)}>
          <iframe title={preview.fileName} src={preview.src} className="h-full min-h-[480px] w-full bg-white" />
        </div>
      );
    case 'markdown':
      return <MarkdownPreview preview={preview} mode={mode} />;
    case 'text':
    case 'code':
      return (
        <div
          className={cn(
            'min-h-full overflow-auto text-foreground',
            isModal ? 'px-1 py-1 sm:px-2' : 'px-4 py-4',
            contentClassName,
          )}
          style={{ fontFamily: SYSTEM_UI_FONT_FAMILY }}
        >
          <TextualPreview preview={preview} />
        </div>
      );
    case 'docx':
      return <DocxPreview file={file} preview={preview} mode={mode} language={language} />;
    case 'spreadsheet':
      return (
        <div className={cn(isModal ? 'min-h-0 flex-1 px-1 py-1 sm:px-2' : 'min-h-full px-4 py-4', contentClassName)}>
          <SpreadsheetPreview file={file} preview={preview} className="h-full" mode={mode} />
        </div>
      );
    case 'office-pages':
      return (
        <div className={cn(isModal ? 'flex min-h-0 flex-1 overflow-hidden px-1 py-1 sm:px-2' : 'flex min-h-0 flex-1 overflow-hidden px-4 py-4', contentClassName)}>
          <OfficePagesPreview file={file} preview={preview} mode={mode} language={language} />
        </div>
      );
    case 'presentation':
      return (
        <div className={cn(isModal ? 'flex min-h-0 flex-1 overflow-hidden px-1 py-1 sm:px-2' : 'flex min-h-0 flex-1 overflow-hidden px-4 py-4', contentClassName)}>
          <PresentationPreview
            preview={preview}
            mode={mode}
            initialSlideIndex={presentationInitialSlideIndex}
            onActiveSlideChange={onPresentationSlideChange}
          />
        </div>
      );
    case 'unavailable':
      return (
        <div className={cn('flex min-h-[320px] flex-col items-center justify-center px-8 py-6 text-center', contentClassName)}>
          <FileText className="mb-4 h-9 w-9 text-foreground/40" />
          <p className="max-w-md text-[14px] leading-7 text-foreground/68">
            {resolveUnavailableReason(preview.reasonCode, t)}
          </p>
        </div>
      );
    default:
      return null;
  }
}

function ImagePreviewWindowWorkspace({
  file,
  preview,
  onCopy,
}: {
  file: AttachedFileMeta;
  preview: Extract<FilePreviewPayload, { kind: 'image' }>;
  onCopy: () => void;
}) {
  const { t } = useTranslation('chat');
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);

  useEffect(() => {
    setZoom(1);
    setRotation(0);
  }, [file.fileName, file.filePath, preview.src]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        setZoom((current) => clampZoom(current + IMAGE_ZOOM_STEP));
      }
      if (event.key === '-') {
        event.preventDefault();
        setZoom((current) => clampZoom(current - IMAGE_ZOOM_STEP));
      }
      if (event.key === '0') {
        event.preventDefault();
        setZoom(1);
        setRotation(0);
      }
      if (event.key.toLowerCase() === 'r') {
        event.preventDefault();
        setRotation((current) => current + 90);
      }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  const handleContextMenu = useCallback((event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    onCopy();
  }, [onCopy]);

  const handleWheelZoom = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    const zoomDelta = getWheelZoomDelta(event.deltaY);
    if (zoomDelta === 0) {
      return;
    }
    event.preventDefault();
    setZoom((current) => clampZoom(current + zoomDelta));
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        data-testid="chat-file-preview-image-surface"
        className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4 sm:p-6"
        onContextMenu={handleContextMenu}
        onWheel={handleWheelZoom}
        style={{ fontFamily: SYSTEM_UI_FONT_FAMILY }}
      >
        <div className="flex min-h-full items-center justify-center py-2">
          <img
            data-testid="chat-file-preview-image-element"
            src={preview.src}
            alt={file.fileName}
            className="block max-h-[calc(100vh-240px)] max-w-[min(82vw,1380px)]"
            style={{
              transform: `scale(${zoom}) rotate(${rotation}deg)`,
              transformOrigin: 'center center',
              willChange: 'transform',
            }}
          />
        </div>
      </div>
      <div
        data-testid="chat-file-preview-image-controls"
        className="shrink-0 border-t border-black/6 bg-white/72 px-4 py-3 dark:border-white/8 dark:bg-white/[0.03]"
      >
        <div className="flex flex-wrap items-center justify-center gap-1.5" style={{ fontFamily: SYSTEM_UI_FONT_FAMILY }}>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            data-testid="chat-file-preview-image-zoom-out"
            className="h-9 w-9 rounded-lg"
            onClick={() => setZoom((current) => clampZoom(current - IMAGE_ZOOM_STEP))}
            title={t('filePreview.zoomOut')}
          >
            <Minus className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-9 rounded-lg px-3 text-[13px]"
            onClick={() => {
              setZoom(1);
              setRotation(0);
            }}
            title={t('filePreview.resetView')}
          >
            <span data-testid="chat-file-preview-image-zoom-value">{Math.round(zoom * 100)}%</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            data-testid="chat-file-preview-image-zoom-in"
            className="h-9 w-9 rounded-lg"
            onClick={() => setZoom((current) => clampZoom(current + IMAGE_ZOOM_STEP))}
            title={t('filePreview.zoomIn')}
          >
            <Plus className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            data-testid="chat-file-preview-image-rotate"
            className="h-9 w-9 rounded-lg"
            onClick={() => setRotation((current) => current + 90)}
            title={t('filePreview.rotate')}
          >
            <RotateCw className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            data-testid="chat-file-preview-image-copy"
            className="h-9 w-9 rounded-lg"
            onClick={onCopy}
            title={t('filePreview.copyImage')}
          >
            <Copy className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function useResolvedFilePreview(file: AttachedFileMeta) {
  const { t, i18n } = useTranslation(['chat', 'common']);
  const cacheKey = useMemo(() => buildPreviewCacheKey(file), [file]);
  const [reloadNonce, setReloadNonce] = useState(0);
  const initialPreview = useMemo<FilePreviewPayload | null>(() => {
    if (!file.filePath) {
      return {
        kind: 'unavailable',
        fileName: file.fileName,
        mimeType: file.mimeType,
        fileSize: file.fileSize,
        reasonCode: 'missingPath',
      };
    }
    if (reloadNonce > 0) {
      return null;
    }
    return previewCache.get(cacheKey) ?? null;
  }, [cacheKey, file, reloadNonce]);
  const [preview, setPreview] = useState<FilePreviewPayload | null>(initialPreview);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!initialPreview);
  const previewLanguage = i18n.resolvedLanguage || i18n.language || 'en';

  useEffect(() => {
    if (!file.filePath || initialPreview) {
      return;
    }

    let cancelled = false;
    void (async () => {
      let lastError: unknown = null;

      for (const [attempt, delay] of PREVIEW_RETRY_DELAYS_MS.entries()) {
        if (delay > 0) {
          await wait(delay);
        }
        if (cancelled) return;

        try {
          const result = await hostApiFetch<FilePreviewPayload>('/api/files/preview', {
            method: 'POST',
            body: JSON.stringify({
              filePath: file.filePath,
              fileName: file.fileName,
              mimeType: file.mimeType,
            }),
          });
          if (cancelled) return;
          if (!(result.kind === 'unavailable' && result.reasonCode === 'requiresLibreOffice')) {
            previewCache.set(cacheKey, result);
          }
          setPreview(result);
          return;
        } catch (previewError) {
          lastError = previewError;
          if (!isTransientPreviewLoadError(previewError) || attempt === PREVIEW_RETRY_DELAYS_MS.length - 1) {
            break;
          }
        }
      }

      if (!cancelled) {
        setError(lastError instanceof Error ? lastError.message : String(lastError));
      }
    })()
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, file, initialPreview, reloadNonce]);

  const reloadPreview = useCallback(() => {
    previewCache.delete(cacheKey);
    setError(null);
    setLoading(true);
    setPreview(null);
    setReloadNonce((current) => current + 1);
  }, [cacheKey]);

  const handleRevealInFolder = useCallback(() => {
    if (!file.filePath) return;
    void invokeIpc<string>('shell:showItemInFolder', file.filePath)
      .then((result) => {
        if (isMissingFileShellResult(result)) {
          toast.error(t('filePreview.fileMissing'));
        }
      })
      .catch((revealError) => {
        toast.error(t('filePreview.revealFailed', {
          error: revealError instanceof Error ? revealError.message : String(revealError),
        }));
      });
  }, [file.filePath, t]);

  const handleCopyImage = useCallback(() => {
    if (preview?.kind !== 'image') return;
    void invokeIpc<{ success?: boolean; error?: string }>('media:copyImage', {
      filePath: file.filePath,
      base64: extractBase64FromDataUrl(preview.src),
    })
      .then((result) => {
        if (!result?.success) {
          throw new Error(result?.error || 'copy failed');
        }
        toast.success(t('filePreview.copySuccess'));
      })
      .catch((copyError) => {
        toast.error(t('filePreview.copyFailed', {
          error: copyError instanceof Error ? copyError.message : String(copyError),
        }));
      });
  }, [file.filePath, preview, t]);

  return {
    error,
    handleCopyImage,
    handleRevealInFolder,
    loading,
    preview,
    previewLanguage,
    reloadPreview,
  };
}

function PreviewBodyState({
  error,
  loading,
  preview,
  file,
  previewLanguage,
  onCopyImage,
  onOpenFullscreen,
  mode,
  presentationInitialSlideIndex,
  onPresentationSlideChange,
  onPreviewReload,
}: {
  error: string | null;
  loading: boolean;
  preview: FilePreviewPayload | null;
  file: AttachedFileMeta;
  previewLanguage: string;
  onCopyImage: () => void;
  onOpenFullscreen?: () => void;
  mode: 'panel' | 'modal';
  presentationInitialSlideIndex?: number;
  onPresentationSlideChange?: (slideIndex: number) => void;
  onPreviewReload: () => void;
}) {
  const { t } = useTranslation('chat');
  const previewReasonCode = preview?.kind === 'unavailable' ? preview.reasonCode : undefined;
  const [dismissedLibreOfficePrompt, setDismissedLibreOfficePrompt] = useState(false);

  useEffect(() => {
    setDismissedLibreOfficePrompt(false);
  }, [preview?.fileName, preview?.mimeType, previewReasonCode]);

  if (loading) {
    return (
      <div className="flex min-h-[280px] flex-1 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-foreground/46" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-[280px] flex-1 flex-col items-center justify-center px-8 text-center">
        <p className="text-[14px] leading-7 text-foreground/70">
          {t('filePreview.loadFailed', { error })}
        </p>
      </div>
    );
  }

  if (!preview) {
    return null;
  }

  if (
    preview.kind === 'unavailable'
    && preview.reasonCode === 'requiresLibreOffice'
    && isPresentationLikePreviewFile(file, preview)
    && mode === 'modal'
    && !dismissedLibreOfficePrompt
  ) {
    return (
      <LibreOfficeDownloadDialog
        onCancel={() => setDismissedLibreOfficePrompt(true)}
        onComplete={onPreviewReload}
      />
    );
  }

  return (
    <PreviewSurface
      file={file}
      preview={preview}
      mode={mode}
      language={previewLanguage}
      onOpenFullscreen={onOpenFullscreen}
      onCopyImage={onCopyImage}
      presentationInitialSlideIndex={presentationInitialSlideIndex}
      onPresentationSlideChange={onPresentationSlideChange}
    />
  );
}

export function ChatFilePreviewPanel({
  file,
  onClose,
  desktopWidthPercent = 50,
}: {
  file: AttachedFileMeta;
  onClose: () => void;
  desktopWidthPercent?: number;
}) {
  const { t } = useTranslation(['chat', 'common']);
  const {
    error,
    handleCopyImage,
    handleRevealInFolder,
    loading,
    preview,
    previewLanguage,
    reloadPreview,
  } = useResolvedFilePreview(file);
  const [presentationSlideIndex, setPresentationSlideIndex] = useState<number | undefined>(undefined);
  const panelStyle = useMemo<CSSProperties>(() => ({
    width: `${desktopWidthPercent}%`,
    flexBasis: `${desktopWidthPercent}%`,
  }) as CSSProperties, [desktopWidthPercent]);

  useEffect(() => {
    setPresentationSlideIndex(undefined);
  }, [file.fileName, file.filePath, file.mimeType]);

  const handleOpenDetachedWindow = useCallback(() => {
    void invokeIpc('window:openFilePreview', {
      fileName: file.fileName,
      mimeType: file.mimeType,
      fileSize: file.fileSize,
      ...(file.filePath ? { filePath: file.filePath } : {}),
      ...(Number.isFinite(presentationSlideIndex) && (presentationSlideIndex ?? 0) > 0
        ? { slideIndex: presentationSlideIndex }
        : {}),
    });
  }, [file.fileName, file.filePath, file.fileSize, file.mimeType, presentationSlideIndex]);

  return (
    <aside
      data-testid="chat-file-preview-panel"
        className={cn(
          'flex h-full min-h-0 w-full shrink-0 flex-col border-l border-black/6 dark:border-white/8',
          PREVIEW_PANEL_BACKGROUND_CLASS,
          'lg:flex-none lg:min-w-[16%] lg:max-w-[84%]',
          'max-lg:absolute max-lg:inset-0 max-lg:z-30 max-lg:!w-full max-lg:!basis-full',
        )}
      style={panelStyle}
    >
      <div
        data-testid="chat-file-preview-header"
        className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-black/6 px-4 dark:border-white/8"
      >
        <PreviewMeta fileName={file.fileName} mimeType={file.mimeType} fileSize={preview?.fileSize ?? file.fileSize} />
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-lg"
            onClick={handleOpenDetachedWindow}
            disabled={!preview || loading}
            data-testid="chat-file-preview-expand"
            title={t('filePreview.openFullscreen')}
          >
            <PictureInPicture2 data-testid="chat-file-preview-expand-icon" className="h-[18px] w-[18px]" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-lg"
            onClick={handleRevealInFolder}
            disabled={!file.filePath}
            data-testid="chat-file-preview-reveal"
            title={t('filePreview.revealInFolder')}
          >
            <FolderOpen className="h-[18px] w-[18px]" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-lg"
            onClick={onClose}
            data-testid="chat-file-preview-close"
            title={t('common:actions.close')}
          >
            <X className="h-[18px] w-[18px]" />
          </Button>
        </div>
      </div>

      <div data-testid="chat-file-preview-body" className="min-h-0 flex flex-1 flex-col overflow-hidden">
        <PreviewBodyState
          error={error}
          loading={loading}
          preview={preview}
          file={file}
          previewLanguage={previewLanguage}
          mode="panel"
          onCopyImage={handleCopyImage}
          onOpenFullscreen={handleOpenDetachedWindow}
          presentationInitialSlideIndex={presentationSlideIndex}
          onPresentationSlideChange={setPresentationSlideIndex}
          onPreviewReload={reloadPreview}
        />
      </div>
    </aside>
  );
}

function createPreviewFileFromSearchParams(searchParams: URLSearchParams): AttachedFileMeta {
  const parsedFileSize = Number.parseInt(searchParams.get('fileSize') ?? '0', 10);
  return {
    fileName: searchParams.get('fileName') || 'file',
    mimeType: searchParams.get('mimeType') || 'application/octet-stream',
    fileSize: Number.isFinite(parsedFileSize) ? parsedFileSize : 0,
    filePath: searchParams.get('filePath') || undefined,
    preview: null,
  };
}

export function ChatFilePreviewWindowPage() {
  const { t } = useTranslation(['chat', 'common']);
  const [searchParams] = useSearchParams();
  const file = useMemo(() => createPreviewFileFromSearchParams(searchParams), [searchParams]);
  const initialPresentationSlideIndex = useMemo(() => {
    const parsedSlideIndex = Number.parseInt(searchParams.get('slideIndex') ?? '', 10);
    return Number.isFinite(parsedSlideIndex) && parsedSlideIndex > 0 ? parsedSlideIndex : undefined;
  }, [searchParams]);
  const {
    error,
    handleCopyImage,
    handleRevealInFolder,
    loading,
    preview,
    previewLanguage,
    reloadPreview,
  } = useResolvedFilePreview(file);
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);

  const refreshWindowChromeState = useCallback(() => {
    void invokeIpc<boolean>('window:isMaximized')
      .then((value) => {
        setIsWindowMaximized(Boolean(value));
      })
      .catch(() => {
        setIsWindowMaximized(false);
      });
  }, []);

  useEffect(() => {
    document.title = `${file.fileName} - Deep AI Worker`;
  }, [file.fileName]);

  useEffect(() => {
    refreshWindowChromeState();
  }, [refreshWindowChromeState]);

  const handleMinimize = useCallback(() => {
    void invokeIpc('window:minimize');
  }, []);

  const handleToggleMaximize = useCallback(() => {
    void invokeIpc('window:maximize')
      .then(() => {
        window.setTimeout(() => {
          refreshWindowChromeState();
        }, 40);
      });
  }, [refreshWindowChromeState]);

  const handleClose = useCallback(() => {
    void invokeIpc('window:close');
  }, []);

  return (
    <div
        data-testid="chat-file-preview-window"
        className={cn('flex h-screen min-h-0 flex-col', PREVIEW_PANEL_BACKGROUND_CLASS)}
    >
        <div
          data-testid="chat-file-preview-window-header"
          className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-black/6 px-4 dark:border-white/8"
          onDoubleClick={handleToggleMaximize}
          style={{ WebkitAppRegion: 'drag' } as CSSProperties}
        >
          <PreviewMeta
            fileName={file.fileName}
            mimeType={file.mimeType}
            fileSize={preview?.fileSize ?? file.fileSize}
          />
          <div className="flex items-center gap-3" style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-md"
                onClick={handleRevealInFolder}
                disabled={!file.filePath}
                data-testid="chat-file-preview-window-reveal"
                title={t('filePreview.revealInFolder')}
              >
                <FolderOpen className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-md"
                onClick={handleMinimize}
                data-testid="chat-file-preview-window-minimize"
                title={t('common:actions.minimize', 'Minimize')}
              >
                <Minus className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-md"
                onClick={handleToggleMaximize}
                data-testid="chat-file-preview-window-maximize"
                data-state={isWindowMaximized ? 'restore' : 'maximize'}
                title={isWindowMaximized ? t('common:actions.restore', 'Restore') : t('common:actions.maximize', 'Maximize')}
              >
                {isWindowMaximized ? (
                  <Minimize2 data-testid="chat-file-preview-window-restore-icon" className="h-4 w-4" />
                ) : (
                  <Maximize2 data-testid="chat-file-preview-window-maximize-icon" className="h-4 w-4" />
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-md"
                onClick={handleClose}
                data-testid="chat-file-preview-window-close"
                title={t('common:actions.close')}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        <div
          data-testid="chat-file-preview-window-body"
          className="min-h-0 flex flex-1 flex-col overflow-hidden"
        >
          {preview?.kind === 'image' ? (
            <ImagePreviewWindowWorkspace
              file={file}
              preview={preview}
              onCopy={handleCopyImage}
            />
          ) : (
            <PreviewBodyState
              error={error}
              loading={loading}
              preview={preview}
              file={file}
              previewLanguage={previewLanguage}
              mode="modal"
              onCopyImage={handleCopyImage}
              presentationInitialSlideIndex={initialPresentationSlideIndex}
              onPreviewReload={reloadPreview}
            />
          )}
        </div>
      </div>
  );
}
