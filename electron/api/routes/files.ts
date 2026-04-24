import type { IncomingMessage, ServerResponse } from 'http';
import { app, dialog, nativeImage } from 'electron';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import { basename, extname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { TextDecoder } from 'node:util';
import { LRUCache } from 'lru-cache';
import { DOMParser as XmlDomParser } from '@xmldom/xmldom';
import type {
  Document as XmlDocument,
  Element as XmlElement,
  Node as XmlNode,
} from '@xmldom/xmldom';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';

const EXT_MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.tar': 'application/x-tar',
  '.7z': 'application/x-7z-compressed',
  '.rar': 'application/vnd.rar',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.jsx': 'text/javascript',
  '.mjs': 'text/javascript',
  '.cjs': 'text/javascript',
  '.ts': 'text/typescript',
  '.tsx': 'text/typescript',
  '.py': 'text/x-python',
  '.yml': 'text/yaml',
  '.yaml': 'text/yaml',
  '.log': 'text/plain',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.ppt': 'application/vnd.ms-powerpoint',
};

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown']);
const CODE_EXTENSIONS = new Set([
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.py',
  '.html',
  '.css',
  '.json',
  '.xml',
  '.yml',
  '.yaml',
  '.sql',
  '.sh',
  '.bash',
  '.ps1',
  '.java',
  '.go',
  '.rs',
  '.c',
  '.cc',
  '.cpp',
  '.h',
  '.hpp',
  '.php',
  '.rb',
  '.swift',
  '.kt',
  '.env',
]);
const WORD_EXTENSIONS = new Set(['.docx']);
const SPREADSHEET_EXTENSIONS = new Set(['.xlsx', '.xls', '.csv']);
const PRESENTATION_EXTENSIONS = new Set(['.pptx']);
const DEFAULT_MAX_PREVIEW_FILE_SIZE_BYTES = 18 * 1024 * 1024;
const MAX_OFFICE_DOCUMENT_PREVIEW_FILE_SIZE_BYTES = 32 * 1024 * 1024;
const MAX_PRESENTATION_PREVIEW_FILE_SIZE_BYTES = 150 * 1024 * 1024;
const MAX_TEXT_PREVIEW_CHARS = 160_000;
const MAX_SPREADSHEET_PREVIEW_ROWS = 120;
const MAX_SPREADSHEET_PREVIEW_COLUMNS = 18;
const MAX_PRESENTATION_PREVIEW_SLIDES = 40;
const MAX_PRESENTATION_SLIDE_PARAGRAPHS = 16;
const POWERPOINT_EXPORT_TARGET_LONG_EDGE_PX = 1600;
const OUTBOUND_DIR = join(homedir(), '.openclaw', 'media', 'outbound');
const PRESENTATION_PREVIEW_DIR = join(homedir(), '.openclaw', 'media', 'presentation-preview');
const PRESENTATION_PREVIEW_MANIFEST_NAME = 'manifest.json';
const PRESENTATION_PREVIEW_CACHE_VERSION = 3;
const XML_ENTITY_MAP: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};
type PptxToHtmlModule = {
  pptxToHtml: (
    buffer: ArrayBuffer,
    config?: {
      width?: number;
      height?: number;
      scaleToFit?: boolean;
      letterbox?: boolean;
      domParserFactory?: () => {
        parseFromString(xml: string, mime: string): unknown;
      };
    },
  ) => Promise<string[]>;
};

const runtimeImport = new Function(
  'specifier',
  'return import(specifier);',
) as <T>(specifier: string) => Promise<T>;

let pptxToHtmlModulePromise: Promise<PptxToHtmlModule> | null = null;

function resolvePptxToHtmlSpecifier(): string {
  const appPath = typeof app?.getAppPath === 'function' ? app.getAppPath() : '';
  const resourcesPath = typeof process.resourcesPath === 'string' ? process.resourcesPath : '';
  const candidates = [
    join(process.cwd(), 'node_modules', '@jvmr', 'pptx-to-html', 'dist', 'index.js'),
    ...(appPath ? [join(appPath, 'node_modules', '@jvmr', 'pptx-to-html', 'dist', 'index.js')] : []),
    ...(resourcesPath ? [join(resourcesPath, 'app.asar.unpacked', 'node_modules', '@jvmr', 'pptx-to-html', 'dist', 'index.js')] : []),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return pathToFileURL(candidate).href;
    }
  }

  return '@jvmr/pptx-to-html';
}

async function loadPptxToHtmlModule(): Promise<PptxToHtmlModule> {
  const testOverride = (globalThis as typeof globalThis & {
    __clawxPptxToHtmlModule?: PptxToHtmlModule;
  }).__clawxPptxToHtmlModule;
  if (testOverride) {
    return testOverride;
  }

  if (!pptxToHtmlModulePromise) {
    // Keep the ESM-only PPTX renderer out of main-process bootstrap. If the
    // Electron CJS entry eagerly requires it, startup can fail before any UI
    // is shown.
    pptxToHtmlModulePromise = runtimeImport<PptxToHtmlModule>(resolvePptxToHtmlSpecifier())
      .catch((error) => {
        pptxToHtmlModulePromise = null;
        throw error;
      });
  }

  return pptxToHtmlModulePromise;
}

function execFileAsync(
  file: string,
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        encoding: 'utf8',
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 1024 * 1024 * 8,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(Object.assign(error, { stdout, stderr }));
          return;
        }
        resolve({
          stdout: typeof stdout === 'string' ? stdout : String(stdout),
          stderr: typeof stderr === 'string' ? stderr : String(stderr),
        });
      },
    );
  });
}

type FilePreviewOutlineItem = {
  id: string;
  text: string;
  level: number;
  isBold?: boolean;
};

type FilePreviewUnavailableReasonCode =
  | 'missingPath'
  | 'tooLarge'
  | 'legacyOffice'
  | 'unsupported';

type PresentationRenderMode = 'html' | 'image';

type PresentationSlideSummary = {
  index: number;
  title: string;
  paragraphs: string[];
  truncatedParagraphs: boolean;
};

type FilePreviewPayload =
  | {
      kind: 'image';
      fileName: string;
      mimeType: string;
      fileSize: number;
      src: string;
    }
  | {
      kind: 'pdf';
      fileName: string;
      mimeType: string;
      fileSize: number;
      src: string;
    }
  | {
      kind: 'markdown';
      fileName: string;
      mimeType: string;
      fileSize: number;
      content: string;
      truncated: boolean;
    }
  | {
      kind: 'text';
      fileName: string;
      mimeType: string;
      fileSize: number;
      content: string;
      truncated: boolean;
    }
  | {
      kind: 'code';
      fileName: string;
      mimeType: string;
      fileSize: number;
      content: string;
      truncated: boolean;
      language?: string;
    }
  | {
      kind: 'docx';
      fileName: string;
      mimeType: string;
      fileSize: number;
      html: string;
      outline: FilePreviewOutlineItem[];
      warnings: string[];
    }
  | {
      kind: 'spreadsheet';
      fileName: string;
      mimeType: string;
      fileSize: number;
      sheets: Array<{
        name: string;
        rows: string[][];
        rowCount: number;
        columnCount: number;
        truncatedRows: boolean;
        truncatedColumns: boolean;
      }>;
      truncatedSheets: boolean;
    }
  | {
      kind: 'presentation';
      fileName: string;
      mimeType: string;
      fileSize: number;
      previewId?: string;
      renderMode?: PresentationRenderMode;
      slideWidth?: number;
      slideHeight?: number;
      slides: PresentationSlideSummary[];
      truncatedSlides: boolean;
    }
  | {
      kind: 'unavailable';
      fileName: string;
      mimeType: string;
      fileSize: number;
      reasonCode: FilePreviewUnavailableReasonCode;
    };

type PresentationPreviewCacheEntry = {
  previewId: string;
  dirPath: string;
  renderMode: PresentationRenderMode;
  slideWidth: number;
  slideHeight: number;
  slides: PresentationSlideSummary[];
  truncatedSlides: boolean;
};

type PresentationPreviewManifest = {
  version: number;
  previewId: string;
  renderMode: PresentationRenderMode;
  slideWidth: number;
  slideHeight: number;
  slides: PresentationPreviewCacheEntry['slides'];
  truncatedSlides: boolean;
  createdAt: number;
};

type PresentationImageExportResult = {
  slideWidth: number;
  slideHeight: number;
  slideCount: number;
  truncatedSlides: boolean;
};

const presentationPreviewCache = new LRUCache<string, PresentationPreviewCacheEntry>({
  max: 4,
  ttl: 1000 * 60 * 45,
});
const presentationPreviewBuilds = new Map<string, Promise<PresentationPreviewCacheEntry>>();
type XmlCompatNode = XmlNode & {
  __clawxPatched?: boolean;
  parentElement?: XmlElement | null;
  querySelector?: (selector: string) => XmlElement | null;
  querySelectorAll?: (selector: string) => XmlElement[];
};

function getXmlElementChildren(node: XmlCompatNode | null | undefined): XmlElement[] {
  const children: XmlElement[] = [];
  const childNodes = node?.childNodes ? Array.from(node.childNodes) as XmlCompatNode[] : [];
  for (const child of childNodes) {
    if (child?.nodeType === 1) {
      children.push(child as unknown as XmlElement);
    }
  }
  return children;
}

function parseXmlSelector(selectorText: string): { localName: string } | null {
  const selector = selectorText.trim();
  if (!selector) return null;

  const normalized = selector.replace(/\\:/g, ':');
  const localName = (normalized.includes('|') ? normalized.split('|').at(-1) : normalized.split(':').at(-1))?.trim();
  if (!localName || localName === '*') {
    return null;
  }

  return { localName };
}

function xmlElementMatchesSelector(node: XmlCompatNode, selectorText: string): boolean {
  if (node.nodeType !== 1) {
    return false;
  }

  const parsed = parseXmlSelector(selectorText);
  if (!parsed) {
    return false;
  }

  return node.localName === parsed.localName || node.nodeName === parsed.localName;
}

function collectXmlDescendants(root: XmlCompatNode, selectorText: string): XmlElement[] {
  const matches: XmlElement[] = [];
  const queue = [...getXmlElementChildren(root) as unknown as XmlCompatNode[]];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;

    if (xmlElementMatchesSelector(current, selectorText)) {
      matches.push(current as unknown as XmlElement);
    }
    queue.push(...getXmlElementChildren(current) as unknown as XmlCompatNode[]);
  }

  return matches;
}

function queryXmlSelectorAll(root: XmlCompatNode, selectorText: string): XmlElement[] {
  const selectors = selectorText.split(',').map((part) => part.trim()).filter(Boolean);
  const seen = new Set<XmlElement>();
  const results: XmlElement[] = [];

  for (const selector of selectors) {
    const steps = selector.split(/\s+/).map((part) => part.trim()).filter(Boolean);
    if (steps.length === 0) continue;

    let currentNodes: XmlCompatNode[] = [root];
    for (const step of steps) {
      const nextNodes: XmlCompatNode[] = [];
      for (const node of currentNodes) {
        nextNodes.push(...collectXmlDescendants(node, step) as unknown as XmlCompatNode[]);
      }
      currentNodes = nextNodes;
      if (currentNodes.length === 0) break;
    }

    for (const node of currentNodes) {
      const element = node as unknown as XmlElement;
      if (!seen.has(element)) {
        seen.add(element);
        results.push(element);
      }
    }
  }

  return results;
}

function patchXmlDomNode(node: XmlCompatNode | null | undefined, ownerDocument: XmlDocument): void {
  if (!node || typeof node !== 'object' || node.__clawxPatched) {
    return;
  }
  const nodeWithCompatFields = node as XmlCompatNode & {
    children?: unknown;
    ownerDocument?: unknown;
    parentNode?: XmlCompatNode | null;
  };

  Object.defineProperty(node, '__clawxPatched', {
    value: true,
    enumerable: false,
    configurable: true,
  });

  if ((node.nodeType === 1 || node.nodeType === 9) && typeof nodeWithCompatFields.children === 'undefined') {
    Object.defineProperty(node, 'children', {
      get: () => getXmlElementChildren(node),
      configurable: true,
    });
  }

  if ((node.nodeType === 1 || node.nodeType === 9) && !('parentElement' in node)) {
    Object.defineProperty(node, 'parentElement', {
      get: () => {
        const parentNode = nodeWithCompatFields.parentNode;
        return parentNode?.nodeType === 1 ? parentNode as unknown as XmlElement : null;
      },
      configurable: true,
    });
  }

  if ((node.nodeType === 1 || node.nodeType === 9) && typeof node.querySelector !== 'function') {
    Object.defineProperty(node, 'querySelector', {
      value: (selector: string) => queryXmlSelectorAll(node, selector)[0] ?? null,
      configurable: true,
    });
  }

  if ((node.nodeType === 1 || node.nodeType === 9) && typeof node.querySelectorAll !== 'function') {
    Object.defineProperty(node, 'querySelectorAll', {
      value: (selector: string) => queryXmlSelectorAll(node, selector),
      configurable: true,
    });
  }

  if (node.nodeType !== 9 && !nodeWithCompatFields.ownerDocument) {
    Object.defineProperty(node, 'ownerDocument', {
      get: () => ownerDocument,
      configurable: true,
    });
  }

  const childNodes = node.childNodes ? Array.from(node.childNodes) as XmlCompatNode[] : [];
  for (const child of childNodes) {
    patchXmlDomNode(child, ownerDocument);
  }
}

class PresentationXmlDomParser {
  parseFromString(xml: string, mime: string): XmlDocument {
    const document = new XmlDomParser().parseFromString(xml, mime);
    patchXmlDomNode(document as unknown as XmlCompatNode, document as XmlDocument);

    const elementConstructor = document.documentElement?.constructor;
    const globalWithElement = globalThis as typeof globalThis & { Element?: unknown };
    if (elementConstructor && typeof globalWithElement.Element === 'undefined') {
      globalWithElement.Element = elementConstructor;
    }

    return document as XmlDocument;
  }
}

function getMimeType(ext: string): string {
  return EXT_MIME_MAP[ext.toLowerCase()] || 'application/octet-stream';
}

function mimeToExt(mimeType: string): string {
  for (const [ext, mime] of Object.entries(EXT_MIME_MAP)) {
    if (mime === mimeType) return ext;
  }
  return '';
}

function normalizeExtension(filePath: string, fileName?: string, mimeType?: string): string {
  const resolvedName = fileName || basename(filePath);
  const resolvedExt = extname(resolvedName || filePath).toLowerCase();
  if (resolvedExt) return resolvedExt;
  if (mimeType) return mimeToExt(mimeType);
  return '';
}

function resolvePreviewFileSizeLimit(extension: string): number {
  if (PRESENTATION_EXTENSIONS.has(extension)) {
    return MAX_PRESENTATION_PREVIEW_FILE_SIZE_BYTES;
  }

  if (WORD_EXTENSIONS.has(extension) || SPREADSHEET_EXTENSIONS.has(extension)) {
    return MAX_OFFICE_DOCUMENT_PREVIEW_FILE_SIZE_BYTES;
  }

  return DEFAULT_MAX_PREVIEW_FILE_SIZE_BYTES;
}

function getCodeLanguage(extension: string, mimeType: string): string | undefined {
  switch (extension) {
    case '.js':
    case '.mjs':
    case '.cjs':
      return 'javascript';
    case '.jsx':
      return 'jsx';
    case '.ts':
      return 'typescript';
    case '.tsx':
      return 'tsx';
    case '.py':
      return 'python';
    case '.html':
      return 'html';
    case '.css':
      return 'css';
    case '.json':
      return 'json';
    case '.xml':
      return 'xml';
    case '.yml':
    case '.yaml':
      return 'yaml';
    case '.sql':
      return 'sql';
    case '.sh':
    case '.bash':
      return 'bash';
    case '.ps1':
      return 'powershell';
    case '.java':
      return 'java';
    case '.go':
      return 'go';
    case '.rs':
      return 'rust';
    case '.c':
    case '.h':
      return 'c';
    case '.cc':
    case '.cpp':
    case '.hpp':
      return 'cpp';
    case '.php':
      return 'php';
    case '.rb':
      return 'ruby';
    case '.swift':
      return 'swift';
    case '.kt':
      return 'kotlin';
    default:
      if (mimeType.includes('json')) return 'json';
      if (mimeType.includes('xml')) return 'xml';
      return undefined;
  }
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&([a-z]+);/gi, (_, entity) => XML_ENTITY_MAP[entity.toLowerCase()] ?? `&${entity};`);
}

function clampTextPreview(content: string): { content: string; truncated: boolean } {
  if (content.length <= MAX_TEXT_PREVIEW_CHARS) {
    return { content, truncated: false };
  }
  return {
    content: `${content.slice(0, MAX_TEXT_PREVIEW_CHARS)}\n\n...`,
    truncated: true,
  };
}

function stripLeadingBom(value: string): string {
  return value.replace(/^\uFEFF/, '');
}

function decodeBufferWithEncoding(buffer: Buffer, encoding: string): string {
  return stripLeadingBom(new TextDecoder(encoding, { fatal: true }).decode(buffer));
}

function detectUtf16Encoding(buffer: Buffer): 'utf-16le' | 'utf-16be' | null {
  if (buffer.length >= 2) {
    if (buffer[0] === 0xff && buffer[1] === 0xfe) {
      return 'utf-16le';
    }
    if (buffer[0] === 0xfe && buffer[1] === 0xff) {
      return 'utf-16be';
    }
  }

  const sampleLength = Math.min(buffer.length, 512);
  if (sampleLength < 4) {
    return null;
  }

  let evenZeroCount = 0;
  let oddZeroCount = 0;
  for (let index = 0; index < sampleLength; index += 1) {
    if (buffer[index] !== 0) {
      continue;
    }
    if (index % 2 === 0) {
      evenZeroCount += 1;
    } else {
      oddZeroCount += 1;
    }
  }

  const zeroThreshold = Math.max(2, Math.floor(sampleLength / 6));
  if (oddZeroCount >= zeroThreshold && evenZeroCount === 0) {
    return 'utf-16le';
  }
  if (evenZeroCount >= zeroThreshold && oddZeroCount === 0) {
    return 'utf-16be';
  }

  return null;
}

function isLikelyGb18030(buffer: Buffer): boolean {
  let leadByteCount = 0;
  let matchedSequenceCount = 0;

  for (let index = 0; index < buffer.length; index += 1) {
    const current = buffer[index] ?? 0;
    if (current < 0x81 || current > 0xfe) {
      continue;
    }

    leadByteCount += 1;

    const next = buffer[index + 1];
    if (typeof next === 'number' && next >= 0x40 && next <= 0xfe && next !== 0x7f) {
      matchedSequenceCount += 1;
      index += 1;
      continue;
    }

    const third = buffer[index + 2];
    const fourth = buffer[index + 3];
    if (
      typeof next === 'number'
      && typeof third === 'number'
      && typeof fourth === 'number'
      && next >= 0x30
      && next <= 0x39
      && third >= 0x81
      && third <= 0xfe
      && fourth >= 0x30
      && fourth <= 0x39
    ) {
      matchedSequenceCount += 1;
      index += 3;
    }
  }

  return leadByteCount >= 2 && matchedSequenceCount / leadByteCount >= 0.6;
}

function decodeCsvBuffer(buffer: Buffer): string {
  const utf16Encoding = detectUtf16Encoding(buffer);
  if (utf16Encoding) {
    try {
      return decodeBufferWithEncoding(buffer, utf16Encoding);
    } catch {
      // Fall through to the common legacy encodings below.
    }
  }

  try {
    return decodeBufferWithEncoding(buffer, 'utf-8');
  } catch {
    // Fall through to the legacy encoding heuristics below.
  }

  if (isLikelyGb18030(buffer)) {
    try {
      return decodeBufferWithEncoding(buffer, 'gb18030');
    } catch {
      // Fall through to the western ANSI fallback below.
    }
  }

  try {
    return decodeBufferWithEncoding(buffer, 'windows-1252');
  } catch {
    return stripLeadingBom(buffer.toString('latin1'));
  }
}

function createUnavailablePreview(
  fileName: string,
  mimeType: string,
  fileSize: number,
  reasonCode: FilePreviewUnavailableReasonCode,
): FilePreviewPayload {
  return {
    kind: 'unavailable',
    fileName,
    mimeType,
    fileSize,
    reasonCode,
  };
}

function stripHtmlTags(value: string): string {
  return decodeXmlText(value.replace(/<[^>]+>/g, ''));
}

function stripAsciiControlCharacters(value: string): string {
  return Array.from(value)
    .filter((character) => (character.codePointAt(0) ?? 0x20) > 0x1f)
    .join('');
}

function stripHtmlToLines(value: string): string[] {
  const normalized = value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|li|h[1-6]|section|article|td|th|tr|table)>/gi, '\n')
    .replace(/&nbsp;/gi, ' ');

  return stripHtmlTags(normalized)
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function extractPresentationSizeFromHtml(html: string): { width: number; height: number } {
  const match = html.match(/class="slide"[^>]*width:\s*([0-9.]+)px;[^>]*height:\s*([0-9.]+)px;/i)
    || html.match(/width:\s*([0-9.]+)px;[^>]*height:\s*([0-9.]+)px;/i);
  const width = Number.parseFloat(match?.[1] ?? '960');
  const height = Number.parseFloat(match?.[2] ?? '540');
  return {
    width: Number.isFinite(width) && width > 0 ? width : 960,
    height: Number.isFinite(height) && height > 0 ? height : 540,
  };
}

function summarizePresentationSlideFromHtml(
  slideHtml: string,
  slideIndex: number,
): PresentationSlideSummary {
  const lines = stripHtmlToLines(slideHtml);
  return {
    index: slideIndex,
    title: lines[0] || `Slide ${slideIndex}`,
    paragraphs: lines.slice(0, MAX_PRESENTATION_SLIDE_PARAGRAPHS),
    truncatedParagraphs: lines.length > MAX_PRESENTATION_SLIDE_PARAGRAPHS,
  };
}

async function extractPresentationTextPreviewFromBuffer(buffer: Buffer): Promise<{
  slides: PresentationSlideSummary[];
  truncatedSlides: boolean;
}> {
  const jszipModule = await import('jszip');
  const JSZip = jszipModule.default ?? jszipModule;
  const zip = await JSZip.loadAsync(buffer);
  const slideEntries = Object.keys(zip.files)
    .filter((entryName) => /^ppt\/slides\/slide\d+\.xml$/i.test(entryName))
    .sort((left, right) => {
      const leftNumber = Number.parseInt(left.match(/slide(\d+)\.xml/i)?.[1] ?? '0', 10);
      const rightNumber = Number.parseInt(right.match(/slide(\d+)\.xml/i)?.[1] ?? '0', 10);
      return leftNumber - rightNumber;
    });

  const slides: PresentationSlideSummary[] = [];
  for (const slideEntry of slideEntries.slice(0, MAX_PRESENTATION_PREVIEW_SLIDES)) {
    const xml = await zip.file(slideEntry)?.async('string');
    if (!xml) continue;
    const paragraphBlocks = xml.match(/<a:p[\s\S]*?<\/a:p>/gi) ?? [];
    const paragraphs = paragraphBlocks
      .map((block) => {
        const text = Array.from(block.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/gi))
          .map((match) => decodeXmlText(match[1] ?? ''))
          .join('');
        return text.trim();
      })
      .filter(Boolean);

    slides.push({
      index: slides.length + 1,
      title: paragraphs[0] || `Slide ${slides.length + 1}`,
      paragraphs: paragraphs.slice(0, MAX_PRESENTATION_SLIDE_PARAGRAPHS),
      truncatedParagraphs: paragraphs.length > MAX_PRESENTATION_SLIDE_PARAGRAPHS,
    });
  }

  return {
    slides,
    truncatedSlides: slideEntries.length > slides.length,
  };
}

function buildPresentationPreviewId(filePath: string, fileSize: number, modifiedAtMs: number): string {
  return crypto
    .createHash('sha256')
    .update(`${filePath}\u0000${fileSize}\u0000${modifiedAtMs}`)
    .digest('hex')
    .slice(0, 24);
}

function buildPresentationPreviewDirPath(previewId: string): string {
  return join(PRESENTATION_PREVIEW_DIR, previewId);
}

function buildPresentationPreviewManifestPath(dirPath: string): string {
  return join(dirPath, PRESENTATION_PREVIEW_MANIFEST_NAME);
}

function buildPresentationSlideHtmlPath(dirPath: string, slideIndex: number): string {
  return join(dirPath, `slide-${slideIndex}.html`);
}

function buildPresentationSlideImagePath(dirPath: string, slideIndex: number): string {
  return join(dirPath, `slide-${slideIndex}.png`);
}

function encodePowerShellCommand(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

function quotePowerShellString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function extractSlideNumberFromFileName(fileName: string, fallback: number): number {
  const match = basename(fileName).match(/(\d+)(?!.*\d)/);
  const parsed = Number.parseInt(match?.[1] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function tryExportPresentationImagesWithPowerPoint(options: {
  filePath: string;
  dirPath: string;
}): Promise<PresentationImageExportResult | null> {
  const override = (globalThis as typeof globalThis & {
    __clawxPresentationImageExporter?: (
      options: { filePath: string; dirPath: string },
    ) => Promise<PresentationImageExportResult | null>;
  }).__clawxPresentationImageExporter;
  if (override) {
    return await override(options);
  }

  if (process.platform !== 'win32' || process.env.VITEST || process.env.NODE_ENV === 'test') {
    return null;
  }

  const fsP = await import('node:fs/promises');
  const script = `
$ErrorActionPreference = 'Stop'
$inputPath = ${quotePowerShellString(options.filePath)}
$outputPath = ${quotePowerShellString(options.dirPath)}
$powerPoint = $null
$presentation = $null
try {
  $powerPoint = New-Object -ComObject PowerPoint.Application
  $powerPoint.Visible = -1
  $presentation = $powerPoint.Presentations.Open($inputPath, $false, $true, $false)
  $slideWidth = [double]$presentation.PageSetup.SlideWidth
  $slideHeight = [double]$presentation.PageSetup.SlideHeight
  if ($slideWidth -le 0 -or $slideHeight -le 0) {
    throw 'Invalid slide size'
  }
  $ratio = $slideWidth / $slideHeight
  if ($ratio -ge 1) {
    $exportWidth = ${POWERPOINT_EXPORT_TARGET_LONG_EDGE_PX}
    $exportHeight = [Math]::Max(1, [int][Math]::Round($exportWidth / $ratio))
  } else {
    $exportHeight = ${POWERPOINT_EXPORT_TARGET_LONG_EDGE_PX}
    $exportWidth = [Math]::Max(1, [int][Math]::Round($exportHeight * $ratio))
  }
  $presentation.Export($outputPath, 'PNG', $exportWidth, $exportHeight)
  @{ exportWidth = $exportWidth; exportHeight = $exportHeight } | ConvertTo-Json -Compress
} finally {
  if ($presentation -ne $null) { $presentation.Close() }
  if ($powerPoint -ne $null) { $powerPoint.Quit() }
  [System.GC]::Collect()
  [System.GC]::WaitForPendingFinalizers()
}
`.trim();

  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodePowerShellCommand(script)],
      1000 * 60 * 3,
    );

    const stdoutLines = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const metadataLine = [...stdoutLines]
      .reverse()
      .find((line) => line.startsWith('{') && line.endsWith('}'));
    const metadata = metadataLine ? JSON.parse(metadataLine) as Partial<{ exportWidth: number; exportHeight: number }> : {};

    const exportedFiles = (await fsP.readdir(options.dirPath, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && /\.png$/i.test(entry.name))
      .sort((left, right) => {
        return extractSlideNumberFromFileName(left.name, 0) - extractSlideNumberFromFileName(right.name, 0);
      });

    const limitedFiles = exportedFiles.slice(0, MAX_PRESENTATION_PREVIEW_SLIDES);
    if (limitedFiles.length === 0) {
      return null;
    }

    const stableImagePaths: string[] = [];
    for (const [index, entry] of limitedFiles.entries()) {
      const sourcePath = join(options.dirPath, entry.name);
      const targetPath = buildPresentationSlideImagePath(options.dirPath, index + 1);
      if (sourcePath !== targetPath) {
        await fsP.copyFile(sourcePath, targetPath);
      }
      stableImagePaths.push(targetPath);
    }

    await Promise.all(exportedFiles.map(async (entry) => {
      const originalPath = join(options.dirPath, entry.name);
      if (!stableImagePaths.includes(originalPath)) {
        await fsP.rm(originalPath, { force: true });
      }
    }));

    const fallbackSize = nativeImage.createFromPath(stableImagePaths[0] ?? '').getSize();
    const slideWidth = Number.isFinite(metadata.exportWidth) && (metadata.exportWidth ?? 0) > 0
      ? Number(metadata.exportWidth)
      : fallbackSize.width;
    const slideHeight = Number.isFinite(metadata.exportHeight) && (metadata.exportHeight ?? 0) > 0
      ? Number(metadata.exportHeight)
      : fallbackSize.height;

    if (slideWidth <= 0 || slideHeight <= 0) {
      return null;
    }

    return {
      slideWidth,
      slideHeight,
      slideCount: stableImagePaths.length,
      truncatedSlides: exportedFiles.length > limitedFiles.length,
    };
  } catch {
    return null;
  }
}

function buildPresentationImageSlideSummaries(
  slideCount: number,
  summary: {
    slides: PresentationSlideSummary[];
    truncatedSlides: boolean;
  } | null,
): PresentationSlideSummary[] {
  return Array.from({ length: slideCount }, (_unused, index) => {
    const slideIndex = index + 1;
    const existingSlide = summary?.slides[index];
    if (existingSlide) {
      return {
        ...existingSlide,
        index: slideIndex,
      };
    }
    return {
      index: slideIndex,
      title: `Slide ${slideIndex}`,
      paragraphs: [],
      truncatedParagraphs: false,
    };
  });
}

function isPresentationPreviewManifest(value: unknown): value is PresentationPreviewManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<PresentationPreviewManifest>;
  return candidate.version === PRESENTATION_PREVIEW_CACHE_VERSION
    && typeof candidate.previewId === 'string'
    && (candidate.renderMode === 'html' || candidate.renderMode === 'image')
    && typeof candidate.slideWidth === 'number'
    && typeof candidate.slideHeight === 'number'
    && Array.isArray(candidate.slides)
    && typeof candidate.truncatedSlides === 'boolean';
}

async function readPresentationPreviewCacheFromDisk(previewId: string): Promise<PresentationPreviewCacheEntry | null> {
  const dirPath = buildPresentationPreviewDirPath(previewId);
  const manifestPath = buildPresentationPreviewManifestPath(dirPath);

  try {
    const fsP = await import('node:fs/promises');
    const manifestRaw = await fsP.readFile(manifestPath, 'utf8');
    const manifest = JSON.parse(manifestRaw) as unknown;
    if (!isPresentationPreviewManifest(manifest) || manifest.previewId !== previewId) {
      return null;
    }

    return {
      previewId,
      dirPath,
      renderMode: manifest.renderMode,
      slideWidth: manifest.slideWidth,
      slideHeight: manifest.slideHeight,
      slides: manifest.slides,
      truncatedSlides: manifest.truncatedSlides,
    };
  } catch {
    return null;
  }
}

async function loadPresentationPreviewCacheEntry(previewId: string): Promise<PresentationPreviewCacheEntry | null> {
  const cached = presentationPreviewCache.get(previewId);
  if (cached) {
    return cached;
  }

  const diskEntry = await readPresentationPreviewCacheFromDisk(previewId);
  if (diskEntry) {
    presentationPreviewCache.set(previewId, diskEntry);
    return diskEntry;
  }

  return null;
}

async function writePresentationPreviewManifest(entry: PresentationPreviewCacheEntry): Promise<void> {
  const fsP = await import('node:fs/promises');
  const manifest: PresentationPreviewManifest = {
    version: PRESENTATION_PREVIEW_CACHE_VERSION,
    previewId: entry.previewId,
    renderMode: entry.renderMode,
    slideWidth: entry.slideWidth,
    slideHeight: entry.slideHeight,
    slides: entry.slides,
    truncatedSlides: entry.truncatedSlides,
    createdAt: Date.now(),
  };

  await fsP.writeFile(
    buildPresentationPreviewManifestPath(entry.dirPath),
    JSON.stringify(manifest),
    'utf8',
  );
}

async function buildPresentationPreviewFallback(
  buffer: Buffer,
  fileName: string,
  mimeType: string,
  fileSize: number,
): Promise<FilePreviewPayload> {
  const summary = await extractPresentationTextPreviewFromBuffer(buffer);

  return {
    kind: 'presentation',
    fileName,
    mimeType,
    fileSize,
    slides: summary.slides,
    truncatedSlides: summary.truncatedSlides,
  };
}

async function ensurePresentationPreviewCache(options: {
  buffer: Buffer;
  filePath: string;
  fileSize: number;
  modifiedAtMs: number;
}): Promise<PresentationPreviewCacheEntry> {
  const previewId = buildPresentationPreviewId(options.filePath, options.fileSize, options.modifiedAtMs);
  const cached = await loadPresentationPreviewCacheEntry(previewId);
  if (cached) {
    return cached;
  }

  const inFlight = presentationPreviewBuilds.get(previewId);
  if (inFlight) {
    return await inFlight;
  }

  const buildPromise = (async (): Promise<PresentationPreviewCacheEntry> => {
    const fsP = await import('node:fs/promises');
    const dirPath = buildPresentationPreviewDirPath(previewId);
    await fsP.mkdir(PRESENTATION_PREVIEW_DIR, { recursive: true });
    await fsP.rm(dirPath, { recursive: true, force: true });
    await fsP.mkdir(dirPath, { recursive: true });

    const imageExport = await tryExportPresentationImagesWithPowerPoint({
      filePath: options.filePath,
      dirPath,
    });

    if (imageExport) {
      let summary: {
        slides: PresentationSlideSummary[];
        truncatedSlides: boolean;
      } | null = null;
      try {
        summary = await extractPresentationTextPreviewFromBuffer(options.buffer);
      } catch {
        summary = null;
      }
      const entry: PresentationPreviewCacheEntry = {
        previewId,
        dirPath,
        renderMode: 'image',
        slideWidth: imageExport.slideWidth,
        slideHeight: imageExport.slideHeight,
        slides: buildPresentationImageSlideSummaries(imageExport.slideCount, summary),
        truncatedSlides: Boolean(summary?.truncatedSlides) || imageExport.truncatedSlides,
      };
      await writePresentationPreviewManifest(entry);
      presentationPreviewCache.set(previewId, entry);
      return entry;
    }

    const arrayBuffer = Uint8Array.from(options.buffer).buffer;
    const { pptxToHtml } = await loadPptxToHtmlModule();
    const renderedSlides = await pptxToHtml(arrayBuffer, {
      scaleToFit: false,
      domParserFactory: () => new PresentationXmlDomParser() as unknown as {
        parseFromString(xml: string, mime: string): unknown;
      },
    });
    const limitedSlides = renderedSlides.slice(0, MAX_PRESENTATION_PREVIEW_SLIDES);
    if (limitedSlides.length === 0) {
      throw new Error('No slides were rendered for presentation preview');
    }
    const slideSize = extractPresentationSizeFromHtml(limitedSlides[0] ?? '');
    const slides = limitedSlides.map((slideHtml, index) => summarizePresentationSlideFromHtml(slideHtml, index + 1));

    await Promise.all(limitedSlides.map((slideHtml, index) => {
      return fsP.writeFile(buildPresentationSlideHtmlPath(dirPath, index + 1), slideHtml, 'utf8');
    }));

    const entry: PresentationPreviewCacheEntry = {
      previewId,
      dirPath,
      renderMode: 'html',
      slideWidth: slideSize.width,
      slideHeight: slideSize.height,
      slides,
      truncatedSlides: renderedSlides.length > limitedSlides.length,
    };
    await writePresentationPreviewManifest(entry);
    presentationPreviewCache.set(previewId, entry);
    return entry;
  })();

  presentationPreviewBuilds.set(previewId, buildPromise);
  try {
    return await buildPromise;
  } finally {
    if (presentationPreviewBuilds.get(previewId) === buildPromise) {
      presentationPreviewBuilds.delete(previewId);
    }
  }
}

function buildPresentationPreviewPayload(
  entry: PresentationPreviewCacheEntry,
  fileName: string,
  mimeType: string,
  fileSize: number,
): FilePreviewPayload {
  return {
    kind: 'presentation',
    fileName,
    mimeType,
    fileSize,
    previewId: entry.previewId,
    renderMode: entry.renderMode,
    slideWidth: entry.slideWidth,
    slideHeight: entry.slideHeight,
    slides: entry.slides,
    truncatedSlides: entry.truncatedSlides,
  };
}

async function warmPresentationPreviewCache(
  filePath: string,
  fileName: string,
  mimeType: string,
  fileSize: number,
): Promise<void> {
  const extension = normalizeExtension(filePath, fileName, mimeType);
  if (!PRESENTATION_EXTENSIONS.has(extension)) {
    return;
  }

  try {
    const fsP = await import('node:fs/promises');
    const stat = await fsP.stat(filePath);
    const previewId = buildPresentationPreviewId(filePath, fileSize, stat.mtimeMs);
    const cachedEntry = await loadPresentationPreviewCacheEntry(previewId);
    if (cachedEntry) {
      return;
    }

    const inFlight = presentationPreviewBuilds.get(previewId);
    if (inFlight) {
      await inFlight;
      return;
    }

    const buffer = await fsP.readFile(filePath);
    await ensurePresentationPreviewCache({
      buffer,
      filePath,
      fileSize,
      modifiedAtMs: stat.mtimeMs,
    });
  } catch (error) {
    console.warn('[file-preview] Background PPT preview warmup failed', {
      filePath,
      fileSize,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function slugifyHeading(value: string, fallback: string, usedIds: Set<string>): string {
  const normalized = stripAsciiControlCharacters(
    value
      .trim()
      .toLowerCase(),
  )
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    || fallback;

  let candidate = normalized;
  let suffix = 2;
  while (usedIds.has(candidate)) {
    candidate = `${normalized}-${suffix}`;
    suffix += 1;
  }
  usedIds.add(candidate);
  return candidate;
}

function addDocxHeadingAnchors(html: string): {
  html: string;
  outline: FilePreviewOutlineItem[];
} {
  const usedIds = new Set<string>();
  const outline: FilePreviewOutlineItem[] = [];
  let headingCount = 0;

  const withAnchors = html.replace(
    /<h([1-6])([^>]*)>([\s\S]*?)<\/h\1>/gi,
    (match, rawLevel: string, rawAttrs: string, rawContent: string) => {
      const text = stripHtmlTags(rawContent).replace(/\s+/g, ' ').trim();
      if (!text) {
        return match;
      }

      headingCount += 1;
      const id = slugifyHeading(text, `section-${headingCount}`, usedIds);
      const attrsWithoutId = rawAttrs.replace(/\sid=(["']).*?\1/gi, '');
      outline.push({
        id,
        text,
        level: Number.parseInt(rawLevel, 10),
        isBold: /<(strong|b)\b/i.test(rawContent) || Number.parseInt(rawLevel, 10) <= 2,
      });
      return `<h${rawLevel}${attrsWithoutId} id="${id}">${rawContent}</h${rawLevel}>`;
    },
  );

  return {
    html: withAnchors,
    outline,
  };
}

async function generateImagePreview(filePath: string, mimeType: string): Promise<string | null> {
  try {
    const img = nativeImage.createFromPath(filePath);
    if (img.isEmpty()) return null;
    const size = img.getSize();
    const maxDim = 512;
    if (size.width > maxDim || size.height > maxDim) {
      const resized = size.width >= size.height
        ? img.resize({ width: maxDim })
        : img.resize({ height: maxDim });
      return `data:image/png;base64,${resized.toPNG().toString('base64')}`;
    }
    const { readFile } = await import('node:fs/promises');
    const buf = await readFile(filePath);
    return `data:${mimeType};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

async function readFileAsDataUrl(filePath: string, mimeType: string): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  const buffer = await readFile(filePath);
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

async function buildTextPreview(
  filePath: string,
  fileName: string,
  mimeType: string,
  fileSize: number,
  extension: string,
): Promise<FilePreviewPayload> {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(filePath, 'utf8');
  const preview = clampTextPreview(raw);

  if (MARKDOWN_EXTENSIONS.has(extension) || mimeType === 'text/markdown') {
    return {
      kind: 'markdown',
      fileName,
      mimeType,
      fileSize,
      content: preview.content,
      truncated: preview.truncated,
    };
  }

  if (CODE_EXTENSIONS.has(extension) || mimeType.includes('json') || mimeType.includes('xml')) {
    return {
      kind: 'code',
      fileName,
      mimeType,
      fileSize,
      content: preview.content,
      truncated: preview.truncated,
      language: getCodeLanguage(extension, mimeType),
    };
  }

  return {
    kind: 'text',
    fileName,
    mimeType,
    fileSize,
    content: preview.content,
    truncated: preview.truncated,
  };
}

async function buildDocxPreview(
  filePath: string,
  fileName: string,
  mimeType: string,
  fileSize: number,
): Promise<FilePreviewPayload> {
  const { readFile } = await import('node:fs/promises');
  const buffer = await readFile(filePath);
  const mammothModule = await import('mammoth');
  const mammoth = mammothModule.default ?? mammothModule;
  const result = await mammoth.convertToHtml({ buffer });
  const { html, outline } = addDocxHeadingAnchors(result.value);
  return {
    kind: 'docx',
    fileName,
    mimeType,
    fileSize,
    html,
    outline,
    warnings: Array.isArray(result.messages)
      ? result.messages.map((message) => message.message).filter(Boolean)
      : [],
  };
}

async function buildDocxPreviewSource(
  filePath: string,
  fileName: string,
  mimeType: string,
  fileSize: number,
): Promise<{ base64: string }> {
  void fileName;
  void mimeType;
  if (fileSize > MAX_OFFICE_DOCUMENT_PREVIEW_FILE_SIZE_BYTES) {
    throw new Error('DOCX preview source exceeds the inline preview size limit');
  }

  const { readFile } = await import('node:fs/promises');
  const buffer = await readFile(filePath);
  return {
    base64: buffer.toString('base64'),
  };
}

async function buildSpreadsheetPreview(
  filePath: string,
  fileName: string,
  mimeType: string,
  fileSize: number,
): Promise<FilePreviewPayload> {
  const { readFile } = await import('node:fs/promises');
  const XLSX = await import('xlsx');
  const buffer = await readFile(filePath);
  const extension = normalizeExtension(filePath, fileName, mimeType);
  const workbook = extension === '.csv'
    ? XLSX.read(decodeCsvBuffer(buffer), { type: 'string', cellDates: false })
    : XLSX.read(buffer, { type: 'buffer', cellDates: false });

  const sheets = workbook.SheetNames.slice(0, 8).map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const range = sheet?.['!ref'] ? XLSX.utils.decode_range(sheet['!ref']) : null;
    const rowCount = range ? range.e.r - range.s.r + 1 : 0;
    const columnCount = range ? range.e.c - range.s.c + 1 : 0;
    const rows = (XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: false,
      defval: '',
      blankrows: false,
    }) as unknown[][])
      .slice(0, MAX_SPREADSHEET_PREVIEW_ROWS)
      .map((row) => row.slice(0, MAX_SPREADSHEET_PREVIEW_COLUMNS).map((cell) => String(cell ?? '')));

    return {
      name: sheetName,
      rows,
      rowCount,
      columnCount,
      truncatedRows: rowCount > MAX_SPREADSHEET_PREVIEW_ROWS,
      truncatedColumns: columnCount > MAX_SPREADSHEET_PREVIEW_COLUMNS,
    };
  });

  return {
    kind: 'spreadsheet',
    fileName,
    mimeType,
    fileSize,
    sheets,
    truncatedSheets: workbook.SheetNames.length > sheets.length,
  };
}

async function buildPresentationPreview(
  filePath: string,
  fileName: string,
  mimeType: string,
  fileSize: number,
): Promise<FilePreviewPayload> {
  const fsP = await import('node:fs/promises');
  const stat = await fsP.stat(filePath);
  const previewId = buildPresentationPreviewId(filePath, fileSize, stat.mtimeMs);

  const cachedEntry = await loadPresentationPreviewCacheEntry(previewId);
  if (cachedEntry) {
    return buildPresentationPreviewPayload(cachedEntry, fileName, mimeType, fileSize);
  }

  const inFlight = presentationPreviewBuilds.get(previewId);
  if (inFlight) {
    return buildPresentationPreviewPayload(await inFlight, fileName, mimeType, fileSize);
  }

  const buffer = await fsP.readFile(filePath);
  try {
    const entry = await ensurePresentationPreviewCache({
      buffer,
      filePath,
      fileSize,
      modifiedAtMs: stat.mtimeMs,
    });
    return buildPresentationPreviewPayload(entry, fileName, mimeType, fileSize);
  } catch (error) {
    console.warn('[file-preview] Falling back to text-only PPT preview', {
      filePath,
      fileSize,
      error: error instanceof Error ? error.message : String(error),
    });
    return await buildPresentationPreviewFallback(buffer, fileName, mimeType, fileSize);
  }
}

async function buildFilePreview(
  filePath: string,
  fileName: string,
  mimeType: string,
  fileSize: number,
): Promise<FilePreviewPayload> {
  const extension = normalizeExtension(filePath, fileName, mimeType);
  const previewFileSizeLimit = resolvePreviewFileSizeLimit(extension);

  if (fileSize > previewFileSizeLimit) {
    return createUnavailablePreview(
      fileName,
      mimeType,
      fileSize,
      'tooLarge',
    );
  }

  if (mimeType.startsWith('image/')) {
    return {
      kind: 'image',
      fileName,
      mimeType,
      fileSize,
      src: await readFileAsDataUrl(filePath, mimeType),
    };
  }

  if (mimeType === 'application/pdf' || extension === '.pdf') {
    return {
      kind: 'pdf',
      fileName,
      mimeType: 'application/pdf',
      fileSize,
      src: await readFileAsDataUrl(filePath, 'application/pdf'),
    };
  }

  if (WORD_EXTENSIONS.has(extension)) {
    return await buildDocxPreview(filePath, fileName, mimeType, fileSize);
  }

  if (SPREADSHEET_EXTENSIONS.has(extension)) {
    return await buildSpreadsheetPreview(filePath, fileName, mimeType, fileSize);
  }

  if (PRESENTATION_EXTENSIONS.has(extension)) {
    return await buildPresentationPreview(filePath, fileName, mimeType, fileSize);
  }

  if (
    mimeType.startsWith('text/')
    || MARKDOWN_EXTENSIONS.has(extension)
    || CODE_EXTENSIONS.has(extension)
    || mimeType.includes('json')
    || mimeType.includes('xml')
  ) {
    return await buildTextPreview(filePath, fileName, mimeType, fileSize, extension);
  }

  if (extension === '.doc' || extension === '.ppt') {
    return createUnavailablePreview(
      fileName,
      mimeType,
      fileSize,
      'legacyOffice',
    );
  }

  return createUnavailablePreview(
    fileName,
    mimeType,
    fileSize,
    'unsupported',
  );
}

async function saveFileToUserPath(options: {
  defaultFileName: string;
  mimeType?: string;
  filePath?: string;
  base64?: string;
}): Promise<{ success: boolean; savedPath?: string; error?: string }> {
  const extension = extname(options.defaultFileName) || mimeToExt(options.mimeType || '');
  const filters = extension
    ? [
        { name: 'Matching Files', extensions: [extension.replace(/^\./, '')] },
        { name: 'All Files', extensions: ['*'] },
      ]
    : [{ name: 'All Files', extensions: ['*'] }];

  const result = await dialog.showSaveDialog({
    defaultPath: join(homedir(), 'Downloads', options.defaultFileName),
    filters,
  });
  if (result.canceled || !result.filePath) {
    return { success: false };
  }

  const fsP = await import('node:fs/promises');
  if (options.filePath) {
    await fsP.copyFile(options.filePath, result.filePath);
    return { success: true, savedPath: result.filePath };
  }

  if (options.base64) {
    await fsP.writeFile(result.filePath, Buffer.from(options.base64, 'base64'));
    return { success: true, savedPath: result.filePath };
  }

  return { success: false, error: 'No file data provided' };
}

export async function handleFileRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/files/stage-paths' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ filePaths: string[] }>(req);
      const fsP = await import('node:fs/promises');
      await fsP.mkdir(OUTBOUND_DIR, { recursive: true });
      const results = [];
      for (const filePath of body.filePaths) {
        const id = crypto.randomUUID();
        const ext = extname(filePath);
        const stagedPath = join(OUTBOUND_DIR, `${id}${ext}`);
        await fsP.copyFile(filePath, stagedPath);
        const s = await fsP.stat(stagedPath);
        const mimeType = getMimeType(ext);
        const fileName = basename(filePath) || 'file';
        const preview = mimeType.startsWith('image/')
          ? await generateImagePreview(stagedPath, mimeType)
          : null;
        results.push({ id, fileName, mimeType, fileSize: s.size, stagedPath, preview });
        void warmPresentationPreviewCache(stagedPath, fileName, mimeType, s.size);
      }
      sendJson(res, 200, results);
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/files/stage-buffer' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ base64: string; fileName: string; mimeType: string }>(req);
      const fsP = await import('node:fs/promises');
      await fsP.mkdir(OUTBOUND_DIR, { recursive: true });
      const id = crypto.randomUUID();
      const ext = extname(body.fileName) || mimeToExt(body.mimeType);
      const stagedPath = join(OUTBOUND_DIR, `${id}${ext}`);
      const buffer = Buffer.from(body.base64, 'base64');
      await fsP.writeFile(stagedPath, buffer);
      const mimeType = body.mimeType || getMimeType(ext);
      const preview = mimeType.startsWith('image/')
        ? await generateImagePreview(stagedPath, mimeType)
        : null;
      void warmPresentationPreviewCache(stagedPath, body.fileName, mimeType, buffer.length);
      sendJson(res, 200, {
        id,
        fileName: body.fileName,
        mimeType,
        fileSize: buffer.length,
        stagedPath,
        preview,
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/files/thumbnails' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ paths: Array<{ filePath: string; mimeType: string }> }>(req);
      const fsP = await import('node:fs/promises');
      const results: Record<string, { preview: string | null; fileSize: number }> = {};
      for (const { filePath, mimeType } of body.paths) {
        try {
          const s = await fsP.stat(filePath);
          const preview = mimeType.startsWith('image/')
            ? await generateImagePreview(filePath, mimeType)
            : null;
          results[filePath] = { preview, fileSize: s.size };
        } catch {
          results[filePath] = { preview: null, fileSize: 0 };
        }
      }
      sendJson(res, 200, results);
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/files/preview' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ filePath: string; fileName?: string; mimeType?: string }>(req);
      const fsP = await import('node:fs/promises');
      const fileName = body.fileName || basename(body.filePath) || 'file';
      const extension = normalizeExtension(body.filePath, fileName, body.mimeType);
      const mimeType = body.mimeType || getMimeType(extension);
      const stat = await fsP.stat(body.filePath);
      const preview = await buildFilePreview(body.filePath, fileName, mimeType, stat.size);
      sendJson(res, 200, preview);
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/files/preview-docx-source' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ filePath: string; fileName?: string; mimeType?: string }>(req);
      const fsP = await import('node:fs/promises');
      const fileName = body.fileName || basename(body.filePath) || 'file.docx';
      const extension = normalizeExtension(body.filePath, fileName, body.mimeType);
      const mimeType = body.mimeType || getMimeType(extension);
      if (!WORD_EXTENSIONS.has(extension)) {
        sendJson(res, 400, { success: false, error: 'Only .docx files support styled preview sources' });
        return true;
      }
      const stat = await fsP.stat(body.filePath);
      const source = await buildDocxPreviewSource(body.filePath, fileName, mimeType, stat.size);
      sendJson(res, 200, source);
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/files/preview-slide' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ previewId?: string; slideIndex?: number }>(req);
      const previewId = body.previewId?.trim();
      const slideIndex = Number.isFinite(body.slideIndex) ? Number(body.slideIndex) : 0;

      if (!previewId || slideIndex < 1) {
        sendJson(res, 400, { success: false, error: 'Invalid presentation preview request' });
        return true;
      }

      const entry = await loadPresentationPreviewCacheEntry(previewId);
      if (!entry) {
        sendJson(res, 404, { success: false, error: 'Presentation preview expired' });
        return true;
      }

      if (entry.renderMode !== 'html') {
        sendJson(res, 400, { success: false, error: 'Presentation slide html not available' });
        return true;
      }

      if (slideIndex > entry.slides.length) {
        sendJson(res, 404, { success: false, error: 'Presentation slide not found' });
        return true;
      }

      const fsP = await import('node:fs/promises');
      const html = await fsP.readFile(buildPresentationSlideHtmlPath(entry.dirPath, slideIndex), 'utf8');
      sendJson(res, 200, { html });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/files/preview-slide-image' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ previewId?: string; slideIndex?: number }>(req);
      const previewId = body.previewId?.trim();
      const slideIndex = Number.isFinite(body.slideIndex) ? Number(body.slideIndex) : 0;

      if (!previewId || slideIndex < 1) {
        sendJson(res, 400, { success: false, error: 'Invalid presentation image preview request' });
        return true;
      }

      const entry = await loadPresentationPreviewCacheEntry(previewId);
      if (!entry) {
        sendJson(res, 404, { success: false, error: 'Presentation preview expired' });
        return true;
      }

      if (entry.renderMode !== 'image') {
        sendJson(res, 400, { success: false, error: 'Presentation slide image not available' });
        return true;
      }

      if (slideIndex > entry.slides.length) {
        sendJson(res, 404, { success: false, error: 'Presentation slide not found' });
        return true;
      }

      const src = await readFileAsDataUrl(buildPresentationSlideImagePath(entry.dirPath, slideIndex), 'image/png');
      sendJson(res, 200, { src });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/files/save-file' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{
        filePath?: string;
        base64?: string;
        mimeType?: string;
        defaultFileName: string;
      }>(req);
      const result = await saveFileToUserPath({
        defaultFileName: body.defaultFileName,
        mimeType: body.mimeType,
        filePath: body.filePath,
        base64: body.base64,
      });
      sendJson(res, result.error ? 400 : 200, result);
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/files/save-image' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{
        base64?: string;
        mimeType?: string;
        filePath?: string;
        defaultFileName: string;
      }>(req);
      const result = await saveFileToUserPath({
        defaultFileName: body.defaultFileName,
        mimeType: body.mimeType,
        filePath: body.filePath,
        base64: body.base64,
      });
      sendJson(res, result.error ? 400 : 200, result);
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
