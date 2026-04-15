import { app } from 'electron';
import { execFileSync, execSync, spawn } from 'child_process';
import { existsSync } from 'fs';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { getUvMirrorEnv } from './uv-env';
import { logger } from './logger';
import { quoteForCmd, needsWinShell } from './paths';

const UV_VERSION = '0.10.0';

const UV_TARGETS: Record<string, { filename: string; binName: string }> = {
  'darwin-arm64': {
    filename: 'uv-aarch64-apple-darwin.tar.gz',
    binName: 'uv',
  },
  'darwin-x64': {
    filename: 'uv-x86_64-apple-darwin.tar.gz',
    binName: 'uv',
  },
  'win32-arm64': {
    filename: 'uv-aarch64-pc-windows-msvc.zip',
    binName: 'uv.exe',
  },
  'win32-x64': {
    filename: 'uv-x86_64-pc-windows-msvc.zip',
    binName: 'uv.exe',
  },
  'linux-arm64': {
    filename: 'uv-aarch64-unknown-linux-gnu.tar.gz',
    binName: 'uv',
  },
  'linux-x64': {
    filename: 'uv-x86_64-unknown-linux-gnu.tar.gz',
    binName: 'uv',
  },
};

/**
 * Get the path to the bundled uv binary
 */
function getBundledUvPath(): string {
  const platform = process.platform;
  const arch = process.arch;
  const target = `${platform}-${arch}`;
  const binName = platform === 'win32' ? 'uv.exe' : 'uv';

  if (app.isPackaged) {
    return join(process.resourcesPath, 'bin', binName);
  } else {
    return join(process.cwd(), 'resources', 'bin', target, binName);
  }
}

/**
 * Resolve the best uv binary to use.
 *
 * In packaged mode we always prefer the bundled binary so we never accidentally
 * pick up a system-wide uv that may be a different (possibly broken) version.
 * In dev we fall through to the system PATH for convenience.
 */
function resolveUvBin(): { bin: string; source: 'bundled' | 'path' | 'bundled-fallback' | 'missing' } {
  const bundled = getBundledUvPath();

  if (app.isPackaged) {
    if (existsSync(bundled)) {
      return { bin: bundled, source: 'bundled' };
    }
    logger.warn(`Bundled uv binary not found at ${bundled}, falling back to system PATH`);
  }

  // Dev mode or missing bundled binary — check system PATH
  const found = findUvInPathSync();
  if (found) return { bin: found, source: 'path' };

  if (existsSync(bundled)) {
    return { bin: bundled, source: 'bundled-fallback' };
  }

  return { bin: bundled, source: 'missing' };
}

function findUvInPathSync(): string | null {
  try {
    const cmd = process.platform === 'win32' ? 'where.exe uv' : 'which uv';
    const output = execSync(cmd, {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    });
    const resolved = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    return resolved || null;
  } catch {
    return null;
  }
}

function getCurrentUvTarget(): { id: string; filename: string; binName: string } | null {
  const id = `${process.platform}-${process.arch}`;
  const target = UV_TARGETS[id];
  if (!target) return null;
  return { id, ...target };
}

async function findFileRecursive(dir: string, filename: string): Promise<string | null> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isFile() && entry.name === filename) {
      return fullPath;
    }
    if (entry.isDirectory()) {
      const found = await findFileRecursive(fullPath, filename);
      if (found) return found;
    }
  }
  return null;
}

async function downloadBundledUvIfNeeded(): Promise<string | null> {
  const bundledPath = getBundledUvPath();
  if (existsSync(bundledPath)) {
    return bundledPath;
  }

  if (app.isPackaged) {
    return null;
  }

  const target = getCurrentUvTarget();
  if (!target) {
    logger.warn(`No downloadable uv target for ${process.platform}/${process.arch}`);
    return null;
  }

  const tempRoot = await mkdtemp(join(tmpdir(), 'clawx-uv-'));
  const archivePath = join(tempRoot, target.filename);
  const extractDir = join(tempRoot, 'extract');
  const downloadUrl = `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${target.filename}`;

  try {
    logger.info(`Bundled uv missing in dev mode, downloading ${downloadUrl}`);
    const response = await fetch(downloadUrl);
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    }

    const archiveBuffer = await response.arrayBuffer();
    await mkdir(join(process.cwd(), 'resources', 'bin', target.id), { recursive: true });
    await mkdir(extractDir, { recursive: true });
    await writeFile(archivePath, Buffer.from(archiveBuffer));

    if (target.filename.endsWith('.zip')) {
      execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          `Add-Type -AssemblyName System.IO.Compression.FileSystem; ` +
          `[System.IO.Compression.ZipFile]::ExtractToDirectory('${archivePath.replace(/'/g, "''")}', '${extractDir.replace(/'/g, "''")}')`,
        ],
        { stdio: 'ignore', windowsHide: true },
      );
    } else {
      execFileSync('tar', ['-xzf', archivePath, '-C', extractDir], { stdio: 'ignore', windowsHide: true });
    }

    const extractedBin = await findFileRecursive(extractDir, target.binName);
    if (!extractedBin) {
      throw new Error(`Could not find ${target.binName} after extracting ${target.filename}`);
    }

    await writeFile(bundledPath, await readFile(extractedBin));

    if (process.platform !== 'win32') {
      await chmod(bundledPath, 0o755);
    }

    logger.info(`Bundled uv downloaded to ${bundledPath}`);
    return bundledPath;
  } catch (error) {
    logger.error('Failed to download bundled uv automatically:', error);
    return null;
  } finally {
    await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Check if uv is available (either bundled or in system PATH)
 */
export async function checkUvInstalled(): Promise<boolean> {
  const { bin, source } = resolveUvBin();
  if (source === 'missing') {
    return false;
  }
  if (source === 'bundled' || source === 'bundled-fallback' || source === 'path') {
    return existsSync(bin);
  }
  return false;
}

/**
 * "Install" uv - now just verifies that uv is available somewhere.
 * Kept for API compatibility with frontend.
 */
export async function installUv(): Promise<void> {
  let { bin, source } = resolveUvBin();
  if (source === 'missing' || !existsSync(bin)) {
    const downloaded = await downloadBundledUvIfNeeded();
    if (downloaded && existsSync(downloaded)) {
      bin = downloaded;
      source = 'bundled-fallback';
    }
  }
  if (source === 'missing' || !existsSync(bin)) {
    throw new Error(`uv not found in system PATH and bundled binary missing at ${getBundledUvPath()}`);
  }
  logger.info(`uv is available and ready to use (${source}: ${bin})`);
}

/**
 * Check if a managed Python 3.12 is ready and accessible
 */
export async function isPythonReady(): Promise<boolean> {
  const { bin: uvBin, source } = resolveUvBin();
  if (source === 'missing' || !existsSync(uvBin)) {
    return false;
  }
  const useShell = needsWinShell(uvBin);

  return new Promise<boolean>((resolve) => {
    try {
      const child = spawn(useShell ? quoteForCmd(uvBin) : uvBin, ['python', 'find', '3.12'], {
        shell: useShell,
        windowsHide: true,
      });
      child.on('close', (code) => resolve(code === 0));
      child.on('error', () => resolve(false));
    } catch {
      resolve(false);
    }
  });
}

/**
 * Run `uv python install 3.12` once with the given environment.
 * Returns on success, throws with captured stderr on failure.
 */
async function runPythonInstall(
  uvBin: string,
  env: Record<string, string | undefined>,
  label: string,
): Promise<void> {
  const useShell = needsWinShell(uvBin);
  return new Promise<void>((resolve, reject) => {
    const stderrChunks: string[] = [];
    const stdoutChunks: string[] = [];

    const child = spawn(useShell ? quoteForCmd(uvBin) : uvBin, ['python', 'install', '3.12'], {
      shell: useShell,
      env,
      windowsHide: true,
    });

    child.stdout?.on('data', (data) => {
      const line = data.toString().trim();
      if (line) {
        stdoutChunks.push(line);
        logger.debug(`[python-setup:${label}] stdout: ${line}`);
      }
    });

    child.stderr?.on('data', (data) => {
      const line = data.toString().trim();
      if (line) {
        stderrChunks.push(line);
        logger.info(`[python-setup:${label}] stderr: ${line}`);
      }
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        const stderr = stderrChunks.join('\n');
        const stdout = stdoutChunks.join('\n');
        const detail = stderr || stdout || '(no output captured)';
        reject(new Error(
          `Python installation failed with code ${code} [${label}]\n` +
          `  uv binary: ${uvBin}\n` +
          `  platform: ${process.platform}/${process.arch}\n` +
          `  output: ${detail}`
        ));
      }
    });

    child.on('error', (err) => {
      reject(new Error(
        `Python installation spawn error [${label}]: ${err.message}\n` +
        `  uv binary: ${uvBin}\n` +
        `  platform: ${process.platform}/${process.arch}`
      ));
    });
  });
}

/**
 * Use bundled uv to install a managed Python version (default 3.12).
 *
 * Tries with mirror env first (for CN region), then retries without mirror
 * if the first attempt fails, to rule out mirror-specific issues.
 */
export async function setupManagedPython(): Promise<void> {
  let { bin: uvBin, source } = resolveUvBin();
  if (source === 'missing' || !existsSync(uvBin)) {
    const downloaded = await downloadBundledUvIfNeeded();
    if (downloaded && existsSync(downloaded)) {
      uvBin = downloaded;
      source = 'bundled-fallback';
    }
  }
  if (source === 'missing' || !existsSync(uvBin)) {
    throw new Error(
      `uv is unavailable on ${process.platform}/${process.arch}. ` +
      `Expected bundled binary at ${getBundledUvPath()} or a PATH installation.`
    );
  }
  const uvEnv = await getUvMirrorEnv();
  const hasMirror = Object.keys(uvEnv).length > 0;

  logger.info(
    `Setting up managed Python 3.12 ` +
    `(uv=${uvBin}, source=${source}, arch=${process.arch}, mirror=${hasMirror})`
  );

  const baseEnv: Record<string, string | undefined> = { ...process.env };

  // Attempt 1: with mirror (if applicable)
  try {
    await runPythonInstall(uvBin, { ...baseEnv, ...uvEnv }, hasMirror ? 'mirror' : 'default');
  } catch (firstError) {
    logger.warn('Python install attempt 1 failed:', firstError);

    if (hasMirror) {
      // Attempt 2: retry without mirror to rule out mirror issues
      logger.info('Retrying Python install without mirror...');
      try {
        await runPythonInstall(uvBin, baseEnv, 'no-mirror');
      } catch (secondError) {
        logger.error('Python install attempt 2 (no mirror) also failed:', secondError);
        throw secondError;
      }
    } else {
      throw firstError;
    }
  }

  // After installation, verify and log the Python path
  const verifyShell = needsWinShell(uvBin);
  try {
    const findPath = await new Promise<string>((resolve) => {
      const child = spawn(verifyShell ? quoteForCmd(uvBin) : uvBin, ['python', 'find', '3.12'], {
        shell: verifyShell,
        env: { ...process.env, ...uvEnv },
        windowsHide: true,
      });
      let output = '';
      child.stdout?.on('data', (data) => { output += data; });
      child.on('close', () => resolve(output.trim()));
    });

    if (findPath) {
      logger.info(`Managed Python 3.12 installed at: ${findPath}`);
    }
  } catch (err) {
    logger.warn('Could not determine Python path after install:', err);
  }
}
