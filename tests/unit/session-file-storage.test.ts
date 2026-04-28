import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getDefaultUserUploadDir,
  materializeAssistantOutputFilesForBase,
  resolveAssistantOutputStorageDirForBase,
  resolveUserUploadStorageDirForBase,
  resolveStagedUploadFilePath,
} from '../../electron/utils/session-file-storage';

const tempDirs: string[] = [];
const toPosixPath = (value: string) => value.replace(/\\/g, '/');

describe('session-file-storage', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(async (dir) => {
      const { rm } = await import('node:fs/promises');
      await rm(dir, { recursive: true, force: true });
    }));
  });

  it('falls back to the legacy outbound directory when no base dir is configured', () => {
    expect(resolveUserUploadStorageDirForBase('', 'agent:main:session-123')).toBe(getDefaultUserUploadDir());
  });

  it('builds a session-scoped uploads directory for valid session keys', () => {
    const resolved = resolveUserUploadStorageDirForBase('/tmp/uploads', 'agent:finance:session-123');

    expect(toPosixPath(resolved)).toMatch(/^\/tmp\/uploads\/finance\/session-123-[0-9a-f]{8}\/uploads$/);
  });

  it('uses a shared fallback directory when session key is invalid', () => {
    expect(toPosixPath(resolveUserUploadStorageDirForBase('/tmp/uploads', 'invalid-session-key'))).toBe(
      '/tmp/uploads/shared/uploads',
    );
  });

  it('builds a session-scoped outputs directory for valid session keys', () => {
    const resolved = resolveAssistantOutputStorageDirForBase('/tmp/outputs', 'agent:finance:session-123');

    expect(toPosixPath(resolved)).toMatch(/^\/tmp\/outputs\/finance\/session-123-[0-9a-f]{8}\/outputs$/);
  });

  it('preserves the original file name when there is no collision', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'clawx-session-upload-'));
    tempDirs.push(tempDir);
    await mkdir(tempDir, { recursive: true });

    const stagedPath = await resolveStagedUploadFilePath(tempDir, '哈哈哈.pdf');

    expect(stagedPath).toBe(join(tempDir, '哈哈哈.pdf'));
  });

  it('appends a numeric suffix when the same file name already exists', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'clawx-session-upload-'));
    tempDirs.push(tempDir);
    await mkdir(tempDir, { recursive: true });
    await writeFile(join(tempDir, '哈哈哈.pdf'), 'existing');

    const stagedPath = await resolveStagedUploadFilePath(tempDir, '哈哈哈.pdf');

    expect(stagedPath).toBe(join(tempDir, '哈哈哈 (1).pdf'));
  });

  it('copies assistant output files into the configured session directory using the original file name', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'clawx-session-output-'));
    tempDirs.push(tempDir);
    const previousUserDataDir = process.env.CLAWX_USER_DATA_DIR;
    process.env.CLAWX_USER_DATA_DIR = join(tempDir, 'user-data');

    try {
      const sourceDir = join(tempDir, 'workspace');
      const outputRoot = join(tempDir, 'exports');
      await mkdir(sourceDir, { recursive: true });
      await mkdir(outputRoot, { recursive: true });

      const sourcePath = join(sourceDir, '模型结果.txt');
      await writeFile(sourcePath, 'assistant output contents', 'utf8');

      const results = await materializeAssistantOutputFilesForBase(
        outputRoot,
        'agent:main:output-session-123',
        [sourcePath],
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.fileName).toBe('模型结果.txt');

      const expectedDir = resolveAssistantOutputStorageDirForBase(outputRoot, 'agent:main:output-session-123');
      const expectedPath = join(expectedDir, '模型结果.txt');
      expect(results[0]?.materializedPath).toBe(expectedPath);
      await expect(readFile(expectedPath, 'utf8')).resolves.toBe('assistant output contents');
    } finally {
      if (previousUserDataDir == null) {
        delete process.env.CLAWX_USER_DATA_DIR;
      } else {
        process.env.CLAWX_USER_DATA_DIR = previousUserDataDir;
      }
    }
  });
});
