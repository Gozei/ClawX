import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { get as httpGet } from 'node:http';
import { get as httpsGet } from 'node:https';
import { homedir, tmpdir } from 'node:os';
import { app } from 'electron';

type LibreOfficeRuntimeDownloadStatus =
  | 'idle'
  | 'downloading'
  | 'extracting'
  | 'complete'
  | 'error';

type LibreOfficeRuntimeTarget = {
  id: string;
  label: string;
  archiveName: string;
  downloadUrl: string;
  extraction: 'msi' | 'dmg' | 'linux-deb-tar';
};

type LibreOfficeRuntimeJob = {
  id: string;
  targetId: string;
  status: LibreOfficeRuntimeDownloadStatus;
  receivedBytes: number;
  totalBytes: number | null;
  percent: number | null;
  error?: string;
  executablePath?: string;
  updatedAt: number;
};

export type LibreOfficeRuntimeStatusPayload = {
  available: boolean;
  supported: boolean;
  targetId?: string;
  targetLabel?: string;
  status: LibreOfficeRuntimeDownloadStatus;
  jobId?: string;
  receivedBytes?: number;
  totalBytes?: number | null;
  percent?: number | null;
  error?: string;
};

const LIBREOFFICE_VERSION = process.env.CLAWX_LIBREOFFICE_VERSION?.trim() || '26.2.2';
const LIBREOFFICE_DOWNLOAD_BASE_URL = (
  process.env.CLAWX_LIBREOFFICE_DOWNLOAD_BASE_URL?.trim()
  || 'https://download.documentfoundation.org/libreoffice/stable'
).replace(/\/+$/, '');
const LIBREOFFICE_RUNTIME_DOWNLOAD_TIMEOUT_MS = 1000 * 60 * 30;
const LIBREOFFICE_RUNTIME_INSTALL_TIMEOUT_MS = 1000 * 60 * 12;
const libreOfficeRuntimeJobs = new Map<string, LibreOfficeRuntimeJob>();
let activeLibreOfficeRuntimeJobId: string | null = null;

function execFileAsync(
  file: string,
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({
        stdout: String(stdout ?? ''),
        stderr: String(stderr ?? ''),
      });
    });
  });
}

function getLibreOfficeRuntimeBaseDir(): string {
  try {
    if (typeof app?.getPath === 'function') {
      return join(app.getPath('userData'), 'runtimes', 'libreoffice');
    }
  } catch {
    // Fall through to a deterministic user-scoped directory for tests/dev fallbacks.
  }

  return join(homedir(), '.clawx', 'runtimes', 'libreoffice');
}

function getLibreOfficeRuntimeTarget(): LibreOfficeRuntimeTarget | null {
  const version = LIBREOFFICE_VERSION;
  if (process.platform === 'win32') {
    return {
      id: 'win32-x64',
      label: 'Windows x64',
      archiveName: `LibreOffice_${version}_Win_x86-64.msi`,
      downloadUrl: `${LIBREOFFICE_DOWNLOAD_BASE_URL}/${version}/win/x86_64/LibreOffice_${version}_Win_x86-64.msi`,
      extraction: 'msi',
    };
  }

  if (process.platform === 'darwin') {
    if (process.arch === 'arm64') {
      return {
        id: 'darwin-arm64',
        label: 'macOS Apple Silicon',
        archiveName: `LibreOffice_${version}_MacOS_aarch64.dmg`,
        downloadUrl: `${LIBREOFFICE_DOWNLOAD_BASE_URL}/${version}/mac/aarch64/LibreOffice_${version}_MacOS_aarch64.dmg`,
        extraction: 'dmg',
      };
    }

    if (process.arch === 'x64') {
      return {
        id: 'darwin-x64',
        label: 'macOS Intel',
        archiveName: `LibreOffice_${version}_MacOS_x86-64.dmg`,
        downloadUrl: `${LIBREOFFICE_DOWNLOAD_BASE_URL}/${version}/mac/x86_64/LibreOffice_${version}_MacOS_x86-64.dmg`,
        extraction: 'dmg',
      };
    }
  }

  if (process.platform === 'linux') {
    if (process.arch === 'arm64') {
      return {
        id: 'linux-arm64',
        label: 'Linux ARM64',
        archiveName: `LibreOffice_${version}_Linux_aarch64_deb.tar.gz`,
        downloadUrl: `${LIBREOFFICE_DOWNLOAD_BASE_URL}/${version}/deb/aarch64/LibreOffice_${version}_Linux_aarch64_deb.tar.gz`,
        extraction: 'linux-deb-tar',
      };
    }

    if (process.arch === 'x64') {
      return {
        id: 'linux-x64',
        label: 'Linux x64',
        archiveName: `LibreOffice_${version}_Linux_x86-64_deb.tar.gz`,
        downloadUrl: `${LIBREOFFICE_DOWNLOAD_BASE_URL}/${version}/deb/x86_64/LibreOffice_${version}_Linux_x86-64_deb.tar.gz`,
        extraction: 'linux-deb-tar',
      };
    }
  }

  return null;
}

function getLibreOfficeRuntimeDir(target = getLibreOfficeRuntimeTarget()): string | null {
  if (!target) {
    return null;
  }
  return join(getLibreOfficeRuntimeBaseDir(), target.id);
}

async function findFilesByExtension(rootDir: string, extension: string): Promise<string[]> {
  const fsP = await import('node:fs/promises');
  const results: string[] = [];
  const entries = await fsP.readdir(rootDir, { withFileTypes: true }).catch(() => []);

  for (const entry of entries) {
    const entryPath = join(rootDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...await findFilesByExtension(entryPath, extension));
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith(extension.toLowerCase())) {
      results.push(entryPath);
    }
  }

  return results;
}

async function findLibreOfficeExecutableUnder(rootDir: string | null): Promise<string | null> {
  if (!rootDir || !existsSync(rootDir)) {
    return null;
  }

  const fsP = await import('node:fs/promises');
  const executableNames = process.platform === 'win32'
    ? new Set(['soffice.com', 'soffice.exe'])
    : new Set(['soffice', 'libreoffice']);
  const queue = [rootDir];
  let inspected = 0;

  while (queue.length > 0 && inspected < 20_000) {
    const currentDir = queue.shift()!;
    inspected += 1;

    const entries = await fsP.readdir(currentDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const entryPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        queue.push(entryPath);
        continue;
      }

      if (!entry.isFile() || !executableNames.has(entry.name.toLowerCase())) {
        continue;
      }

      const normalized = entryPath.replace(/\\/g, '/').toLowerCase();
      if (
        normalized.includes('/program/')
        || normalized.includes('/libreoffice.app/contents/macos/')
        || normalized.endsWith('/libreoffice')
      ) {
        return entryPath;
      }
    }
  }

  return null;
}

function resolveInstalledLibreOfficeCandidates(): string[] {
  const envOverride = process.env.CLAWX_LIBREOFFICE_PATH?.trim();
  const installedCandidates = process.platform === 'win32'
    ? [
        'C:\\Program Files\\LibreOffice\\program\\soffice.com',
        'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
        'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.com',
        'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
      ]
    : process.platform === 'darwin'
      ? [
          '/Applications/LibreOffice.app/Contents/MacOS/soffice',
        ]
      : [
          '/usr/bin/soffice',
          '/usr/local/bin/soffice',
          '/snap/bin/libreoffice',
        ];

  return [
    ...(envOverride ? [envOverride] : []),
    ...installedCandidates,
  ];
}

export async function resolveLibreOfficeExecutable(): Promise<string | null> {
  const downloadedExecutable = await findLibreOfficeExecutableUnder(getLibreOfficeRuntimeDir());
  if (downloadedExecutable) {
    return downloadedExecutable;
  }

  for (const candidate of resolveInstalledLibreOfficeCandidates()) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }

  const whereCommand = process.platform === 'win32' ? 'where.exe' : 'which';
  const lookupNames = process.platform === 'win32'
    ? ['soffice.com', 'soffice.exe']
    : ['soffice', 'libreoffice'];

  for (const lookupName of lookupNames) {
    try {
      const { stdout } = await execFileAsync(whereCommand, [lookupName], 10_000);
      const resolved = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean);
      if (resolved) {
        return resolved;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function calculateDownloadPercent(receivedBytes: number, totalBytes: number | null): number | null {
  if (!totalBytes || totalBytes <= 0) {
    return null;
  }
  return Math.min(99, Math.max(0, Math.round((receivedBytes / totalBytes) * 1000) / 10));
}

function updateLibreOfficeRuntimeJob(
  job: LibreOfficeRuntimeJob,
  patch: Partial<LibreOfficeRuntimeJob>,
): void {
  Object.assign(job, patch, { updatedAt: Date.now() });
}

function buildLibreOfficeRuntimeStatus(
  target: LibreOfficeRuntimeTarget | null,
  job: LibreOfficeRuntimeJob | null,
  available: boolean,
): LibreOfficeRuntimeStatusPayload {
  return {
    available,
    supported: Boolean(target),
    targetId: target?.id,
    targetLabel: target?.label,
    status: available ? 'complete' : job?.status ?? 'idle',
    jobId: job?.id,
    receivedBytes: job?.receivedBytes,
    totalBytes: job?.totalBytes,
    percent: available ? 100 : job?.percent ?? null,
    error: job?.error,
  };
}

function getActiveLibreOfficeRuntimeJob(): LibreOfficeRuntimeJob | null {
  if (activeLibreOfficeRuntimeJobId) {
    return libreOfficeRuntimeJobs.get(activeLibreOfficeRuntimeJobId) ?? null;
  }

  const activeJob = [...libreOfficeRuntimeJobs.values()]
    .reverse()
    .find((job) => job.status === 'downloading' || job.status === 'extracting');
  return activeJob ?? null;
}

export async function getLibreOfficeRuntimeStatus(jobId?: string): Promise<LibreOfficeRuntimeStatusPayload> {
  const target = getLibreOfficeRuntimeTarget();
  const requestedJob = jobId ? libreOfficeRuntimeJobs.get(jobId) ?? null : null;
  const activeJob = requestedJob ?? getActiveLibreOfficeRuntimeJob();

  if (activeJob && activeJob.status !== 'complete' && activeJob.status !== 'error') {
    return buildLibreOfficeRuntimeStatus(target, activeJob, false);
  }

  const executablePath = await resolveLibreOfficeExecutable();
  if (executablePath) {
    return buildLibreOfficeRuntimeStatus(target, activeJob, true);
  }

  return buildLibreOfficeRuntimeStatus(target, activeJob, false);
}

async function downloadFileWithProgress(
  url: string,
  targetPath: string,
  onProgress: (receivedBytes: number, totalBytes: number | null) => void,
  redirectsRemaining = 5,
): Promise<void> {
  const fsP = await import('node:fs/promises');
  await fsP.mkdir(dirname(targetPath), { recursive: true });

  await new Promise<void>((resolve, reject) => {
    const client = url.startsWith('https:') ? httpsGet : httpGet;
    const request = client(url, {
      headers: {
        'User-Agent': 'Deep-AI-Worker LibreOffice Runtime Downloader',
      },
      timeout: LIBREOFFICE_RUNTIME_DOWNLOAD_TIMEOUT_MS,
    }, (response) => {
      const statusCode = response.statusCode ?? 0;
      const location = response.headers.location;
      if (statusCode >= 300 && statusCode < 400 && location && redirectsRemaining > 0) {
        response.resume();
        const redirectedUrl = new URL(location, url).toString();
        downloadFileWithProgress(redirectedUrl, targetPath, onProgress, redirectsRemaining - 1)
          .then(resolve, reject);
        return;
      }

      if (statusCode < 200 || statusCode >= 300) {
        response.resume();
        reject(new Error(`LibreOffice download failed with HTTP ${statusCode}`));
        return;
      }

      const totalBytes = Number.parseInt(String(response.headers['content-length'] ?? ''), 10);
      const resolvedTotalBytes = Number.isFinite(totalBytes) && totalBytes > 0 ? totalBytes : null;
      let receivedBytes = 0;
      const output = createWriteStream(targetPath);

      response.on('data', (chunk: Buffer) => {
        receivedBytes += chunk.length;
        onProgress(receivedBytes, resolvedTotalBytes);
      });
      response.on('error', reject);
      output.on('error', reject);
      output.on('finish', () => {
        output.close((closeError) => {
          if (closeError) {
            reject(closeError);
            return;
          }
          resolve();
        });
      });

      response.pipe(output);
    });

    request.on('timeout', () => {
      request.destroy(new Error('LibreOffice download timed out'));
    });
    request.on('error', reject);
  });
}

async function extractLibreOfficeMsi(archivePath: string, stagingDir: string): Promise<void> {
  await execFileAsync(
    'msiexec.exe',
    ['/a', archivePath, `TARGETDIR=${stagingDir}`, '/qn', '/norestart'],
    LIBREOFFICE_RUNTIME_INSTALL_TIMEOUT_MS,
  );
}

function parseMacDmgMountPoint(stdout: string): string | null {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines.reverse()) {
    const cells = line.split(/\t+/).map((cell) => cell.trim()).filter(Boolean);
    const mountPoint = cells.find((cell) => cell.startsWith('/Volumes/'));
    if (mountPoint) {
      return mountPoint;
    }
  }
  return null;
}

async function extractLibreOfficeDmg(archivePath: string, stagingDir: string): Promise<void> {
  const fsP = await import('node:fs/promises');
  const { stdout } = await execFileAsync(
    'hdiutil',
    ['attach', archivePath, '-nobrowse', '-readonly'],
    LIBREOFFICE_RUNTIME_INSTALL_TIMEOUT_MS,
  );
  const mountPoint = parseMacDmgMountPoint(stdout);
  if (!mountPoint) {
    throw new Error('LibreOffice DMG mounted, but no mount point was returned.');
  }

  try {
    const entries = await fsP.readdir(mountPoint, { withFileTypes: true });
    const appEntry = entries.find((entry) => entry.isDirectory() && /\.app$/i.test(entry.name));
    if (!appEntry) {
      throw new Error('LibreOffice.app was not found in the downloaded DMG.');
    }
    await fsP.cp(join(mountPoint, appEntry.name), join(stagingDir, appEntry.name), { recursive: true });
  } finally {
    await execFileAsync('hdiutil', ['detach', mountPoint, '-quiet'], LIBREOFFICE_RUNTIME_INSTALL_TIMEOUT_MS)
      .catch(() => undefined);
  }
}

async function extractLibreOfficeLinuxDebTar(archivePath: string, stagingDir: string, tempDir: string): Promise<void> {
  const fsP = await import('node:fs/promises');
  const extractDir = join(tempDir, 'deb-extract');
  await fsP.mkdir(extractDir, { recursive: true });
  await execFileAsync('tar', ['-xzf', archivePath, '-C', extractDir], LIBREOFFICE_RUNTIME_INSTALL_TIMEOUT_MS);

  try {
    await execFileAsync('dpkg-deb', ['--version'], 10_000);
  } catch {
    throw new Error('dpkg-deb is required to unpack LibreOffice on Linux. Install LibreOffice from your package manager, or install dpkg-deb and try again.');
  }

  const debFiles = await findFilesByExtension(extractDir, '.deb');
  if (debFiles.length === 0) {
    throw new Error('No LibreOffice .deb packages were found in the downloaded archive.');
  }

  for (const debFile of debFiles.sort((left, right) => basename(left).localeCompare(basename(right)))) {
    await execFileAsync('dpkg-deb', ['-x', debFile, stagingDir], LIBREOFFICE_RUNTIME_INSTALL_TIMEOUT_MS);
  }
}

async function moveStagingRuntimeIntoPlace(stagingDir: string, runtimeDir: string): Promise<void> {
  const fsP = await import('node:fs/promises');
  await fsP.rm(runtimeDir, { recursive: true, force: true });
  await fsP.mkdir(dirname(runtimeDir), { recursive: true });
  try {
    await fsP.rename(stagingDir, runtimeDir);
  } catch {
    await fsP.cp(stagingDir, runtimeDir, { recursive: true });
    await fsP.rm(stagingDir, { recursive: true, force: true });
  }
}

async function runLibreOfficeRuntimeDownload(job: LibreOfficeRuntimeJob, target: LibreOfficeRuntimeTarget): Promise<void> {
  const fsP = await import('node:fs/promises');
  const runtimeDir = getLibreOfficeRuntimeDir(target);
  if (!runtimeDir) {
    throw new Error('LibreOffice runtime is not supported on this platform.');
  }

  const tempDir = join(tmpdir(), `clawx-libreoffice-runtime-${job.id}`);
  const stagingDir = join(tempDir, 'runtime');
  const archivePath = join(tempDir, target.archiveName);

  try {
    await fsP.rm(tempDir, { recursive: true, force: true });
    await fsP.mkdir(stagingDir, { recursive: true });
    updateLibreOfficeRuntimeJob(job, {
      status: 'downloading',
      receivedBytes: 0,
      totalBytes: null,
      percent: null,
      error: undefined,
    });

    await downloadFileWithProgress(target.downloadUrl, archivePath, (receivedBytes, totalBytes) => {
      updateLibreOfficeRuntimeJob(job, {
        receivedBytes,
        totalBytes,
        percent: calculateDownloadPercent(receivedBytes, totalBytes),
      });
    });

    updateLibreOfficeRuntimeJob(job, { status: 'extracting', percent: 99 });

    if (target.extraction === 'msi') {
      await extractLibreOfficeMsi(archivePath, stagingDir);
    } else if (target.extraction === 'dmg') {
      await extractLibreOfficeDmg(archivePath, stagingDir);
    } else {
      await extractLibreOfficeLinuxDebTar(archivePath, stagingDir, tempDir);
    }

    const executablePath = await findLibreOfficeExecutableUnder(stagingDir);
    if (!executablePath) {
      throw new Error('LibreOffice was downloaded, but soffice could not be found after extraction.');
    }

    await moveStagingRuntimeIntoPlace(stagingDir, runtimeDir);
    const installedExecutablePath = await findLibreOfficeExecutableUnder(runtimeDir);
    updateLibreOfficeRuntimeJob(job, {
      status: 'complete',
      percent: 100,
      executablePath: installedExecutablePath ?? executablePath,
    });
  } catch (error) {
    updateLibreOfficeRuntimeJob(job, {
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    if (activeLibreOfficeRuntimeJobId === job.id) {
      activeLibreOfficeRuntimeJobId = null;
    }
    await fsP.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function startLibreOfficeRuntimeDownload(): Promise<LibreOfficeRuntimeStatusPayload> {
  const target = getLibreOfficeRuntimeTarget();
  if (!target) {
    return {
      available: false,
      supported: false,
      status: 'error',
      error: 'LibreOffice runtime download is not supported on this platform.',
    };
  }

  const executablePath = await resolveLibreOfficeExecutable();
  if (executablePath) {
    return buildLibreOfficeRuntimeStatus(target, null, true);
  }

  const activeJob = getActiveLibreOfficeRuntimeJob();
  if (activeJob) {
    return buildLibreOfficeRuntimeStatus(target, activeJob, false);
  }

  const job: LibreOfficeRuntimeJob = {
    id: crypto.randomUUID(),
    targetId: target.id,
    status: 'downloading',
    receivedBytes: 0,
    totalBytes: null,
    percent: null,
    updatedAt: Date.now(),
  };
  libreOfficeRuntimeJobs.set(job.id, job);
  activeLibreOfficeRuntimeJobId = job.id;
  void runLibreOfficeRuntimeDownload(job, target);

  return buildLibreOfficeRuntimeStatus(target, job, false);
}
