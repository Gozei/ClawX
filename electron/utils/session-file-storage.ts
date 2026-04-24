import { access, copyFile, readFile, stat, writeFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import { homedir } from 'node:os';
import { basename, extname, join, sep } from 'node:path';
import { getSetting } from './store';
import { ensureDir, getDataDir } from './paths';

const LEGACY_USER_UPLOAD_DIR = join(homedir(), '.openclaw', 'media', 'outbound');
const SESSION_UPLOADS_DIR_NAME = 'uploads';
const SESSION_OUTPUTS_DIR_NAME = 'outputs';
const MAX_SAFE_SEGMENT_LENGTH = 48;

type AssistantOutputManifestEntry = {
  targetFileName: string;
  sourceMtimeMs: number;
  sourceSize: number;
};

type AssistantOutputManifest = Record<string, AssistantOutputManifestEntry>;

type ParsedSessionKey = {
  agentId: string;
  sessionSuffix: string;
};

function sanitizePathSegment(value: string, fallback: string): string {
  const sanitized = value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, MAX_SAFE_SEGMENT_LENGTH);

  return sanitized || fallback;
}

function parseSessionKey(sessionKey?: string | null): ParsedSessionKey | null {
  if (typeof sessionKey !== 'string' || !sessionKey.startsWith('agent:')) {
    return null;
  }

  const parts = sessionKey.split(':');
  if (parts.length < 3) {
    return null;
  }

  const agentId = parts[1]?.trim();
  const sessionSuffix = parts.slice(2).join(':').trim();
  if (!agentId || !sessionSuffix) {
    return null;
  }

  return { agentId, sessionSuffix };
}

function buildSessionDirectoryName(sessionSuffix: string): string {
  const safeLabel = sanitizePathSegment(sessionSuffix, 'session');
  const hash = crypto
    .createHash('sha1')
    .update(sessionSuffix)
    .digest('hex')
    .slice(0, 8);

  return `${safeLabel}-${hash}`;
}

export function getDefaultUserUploadDir(): string {
  return LEGACY_USER_UPLOAD_DIR;
}

export function resolveUserUploadStorageDirForBase(
  baseDir: string,
  sessionKey?: string | null,
): string {
  const normalizedBaseDir = baseDir.trim();
  if (!normalizedBaseDir) {
    return LEGACY_USER_UPLOAD_DIR;
  }

  const parsed = parseSessionKey(sessionKey);
  if (!parsed) {
    return join(normalizedBaseDir, 'shared', SESSION_UPLOADS_DIR_NAME);
  }

  const safeAgentId = sanitizePathSegment(parsed.agentId, 'agent');
  const safeSessionDir = buildSessionDirectoryName(parsed.sessionSuffix);
  return join(normalizedBaseDir, safeAgentId, safeSessionDir, SESSION_UPLOADS_DIR_NAME);
}

export async function resolveUserUploadStorageDir(sessionKey?: string | null): Promise<string> {
  const configuredBaseDir = (
    (await getSetting('fileStorageBaseDir')).trim()
    || (await getSetting('userUploadBaseDir')).trim()
  );
  return resolveUserUploadStorageDirForBase(configuredBaseDir, sessionKey);
}

export function resolveAssistantOutputStorageDirForBase(
  baseDir: string,
  sessionKey?: string | null,
): string {
  const normalizedBaseDir = baseDir.trim();
  if (!normalizedBaseDir) {
    return '';
  }

  const parsed = parseSessionKey(sessionKey);
  if (!parsed) {
    return join(normalizedBaseDir, 'shared', SESSION_OUTPUTS_DIR_NAME);
  }

  const safeAgentId = sanitizePathSegment(parsed.agentId, 'agent');
  const safeSessionDir = buildSessionDirectoryName(parsed.sessionSuffix);
  return join(normalizedBaseDir, safeAgentId, safeSessionDir, SESSION_OUTPUTS_DIR_NAME);
}

export async function resolveAssistantOutputStorageDir(sessionKey?: string | null): Promise<string> {
  const configuredBaseDir = (
    (await getSetting('fileStorageBaseDir')).trim()
    || (await getSetting('assistantOutputBaseDir')).trim()
    || (await getSetting('userUploadBaseDir')).trim()
  );
  return resolveAssistantOutputStorageDirForBase(configuredBaseDir, sessionKey);
}

function getAssistantOutputManifestPath(targetDir: string): string {
  const manifestDir = join(getDataDir(), 'assistant-output-manifests');
  ensureDir(manifestDir);
  const manifestId = crypto.createHash('sha1').update(targetDir).digest('hex');
  return join(manifestDir, `${manifestId}.json`);
}

async function readAssistantOutputManifest(targetDir: string): Promise<AssistantOutputManifest> {
  const manifestPath = getAssistantOutputManifestPath(targetDir);
  try {
    const raw = await readFile(manifestPath, 'utf8');
    const parsed = JSON.parse(raw) as AssistantOutputManifest;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function writeAssistantOutputManifest(
  targetDir: string,
  manifest: AssistantOutputManifest,
): Promise<void> {
  const manifestPath = getAssistantOutputManifestPath(targetDir);
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
}

function normalizePathForComparison(filePath: string): string {
  return process.platform === 'win32'
    ? filePath.replace(/\//g, '\\').toLowerCase()
    : filePath;
}

function isPathInsideDir(filePath: string, dirPath: string): boolean {
  const normalizedFilePath = normalizePathForComparison(filePath);
  const normalizedDirPath = normalizePathForComparison(dirPath).replace(/[\\/]+$/, '');
  return normalizedFilePath === normalizedDirPath
    || normalizedFilePath.startsWith(`${normalizedDirPath}${sep}`);
}

function sanitizeUploadFileName(originalFileName: string): string {
  const rawName = basename(originalFileName).trim();
  const sanitizedName = Array.from(rawName)
    .map((char) => {
      const code = char.charCodeAt(0);
      if (code <= 31 || '\\/:*?"<>|'.includes(char)) {
        return '-';
      }
      return char;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .replace(/^\.+$/, '')
    .trim();

  return sanitizedName || `file-${crypto.randomUUID().slice(0, 8)}`;
}

export async function resolveStagedUploadFilePath(
  targetDir: string,
  originalFileName: string,
): Promise<string> {
  const sanitizedName = sanitizeUploadFileName(originalFileName);
  const extension = extname(sanitizedName);
  const baseName = basename(sanitizedName, extension) || 'file';

  let candidateName = sanitizedName;
  let suffixIndex = 1;
  while (true) {
    const candidatePath = join(targetDir, candidateName);
    try {
      await access(candidatePath);
      candidateName = `${baseName} (${suffixIndex})${extension}`;
      suffixIndex += 1;
    } catch {
      return candidatePath;
    }
  }
}

export async function materializeAssistantOutputFiles(
  sessionKey: string | null | undefined,
  filePaths: string[],
): Promise<Array<{ sourcePath: string; materializedPath: string; fileName: string; fileSize: number }>> {
  const configuredBaseDir = (
    (await getSetting('fileStorageBaseDir')).trim()
    || (await getSetting('assistantOutputBaseDir')).trim()
    || (await getSetting('userUploadBaseDir')).trim()
  );
  return materializeAssistantOutputFilesForBase(configuredBaseDir, sessionKey, filePaths);
}

export async function materializeAssistantOutputFilesForBase(
  baseDir: string,
  sessionKey: string | null | undefined,
  filePaths: string[],
): Promise<Array<{ sourcePath: string; materializedPath: string; fileName: string; fileSize: number }>> {
  const targetDir = resolveAssistantOutputStorageDirForBase(baseDir, sessionKey);
  if (!targetDir) {
    return [];
  }

  ensureDir(targetDir);
  const manifest = await readAssistantOutputManifest(targetDir);
  const results: Array<{ sourcePath: string; materializedPath: string; fileName: string; fileSize: number }> = [];

  for (const sourcePath of Array.from(new Set(filePaths.filter(Boolean)))) {
    try {
      const sourceStat = await stat(sourcePath);
      if (!sourceStat.isFile()) continue;

      if (isPathInsideDir(sourcePath, targetDir)) {
        results.push({
          sourcePath,
          materializedPath: sourcePath,
          fileName: basename(sourcePath),
          fileSize: sourceStat.size,
        });
        continue;
      }

      const manifestEntry = manifest[sourcePath];
      let targetPath = manifestEntry
        ? join(targetDir, manifestEntry.targetFileName)
        : await resolveStagedUploadFilePath(targetDir, basename(sourcePath));

      if (manifestEntry) {
        try {
          await access(targetPath);
        } catch {
          targetPath = await resolveStagedUploadFilePath(targetDir, basename(sourcePath));
        }
      }

      await copyFile(sourcePath, targetPath);

      manifest[sourcePath] = {
        targetFileName: basename(targetPath),
        sourceMtimeMs: sourceStat.mtimeMs,
        sourceSize: sourceStat.size,
      };

      results.push({
        sourcePath,
        materializedPath: targetPath,
        fileName: basename(targetPath),
        fileSize: sourceStat.size,
      });
    } catch {
      // Skip files that are missing or unreadable.
    }
  }

  await writeAssistantOutputManifest(targetDir, manifest);
  return results;
}
