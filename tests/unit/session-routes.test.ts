import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const parseJsonBodyMock = vi.fn();
const sendJsonMock = vi.fn();
const getOpenClawConfigDirMock = vi.fn();

vi.mock('@electron/api/route-utils', () => ({
  parseJsonBody: (...args: unknown[]) => parseJsonBodyMock(...args),
  sendJson: (...args: unknown[]) => sendJsonMock(...args),
}));

vi.mock('@electron/utils/paths', () => ({
  getOpenClawConfigDir: () => getOpenClawConfigDirMock(),
}));

describe('handleSessionRoutes', () => {
  let tempRoot = '';

  beforeEach(async () => {
    vi.resetAllMocks();
    tempRoot = await mkdtemp(join(tmpdir(), 'clawx-session-routes-'));
    getOpenClawConfigDirMock.mockReturnValue(tempRoot);
  });

  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('renames a session label in sessions.json', async () => {
    const sessionsDir = join(tempRoot, 'agents', 'main', 'sessions');
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(
      join(sessionsDir, 'sessions.json'),
      JSON.stringify({
        sessions: [
          { key: 'agent:main:session-1', label: 'Old name', updatedAt: 1 },
        ],
      }, null, 2),
      'utf8',
    );
    parseJsonBodyMock.mockResolvedValueOnce({
      sessionKey: 'agent:main:session-1',
      label: '新名字ABC123',
    });

    const { handleSessionRoutes } = await import('@electron/api/routes/sessions');
    const handled = await handleSessionRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/sessions/rename'),
      {} as never,
    );

    expect(handled).toBe(true);
    expect(sendJsonMock).toHaveBeenLastCalledWith(expect.anything(), 200, {
      success: true,
      label: '新名字ABC123',
    });

    const stored = JSON.parse(await readFile(join(sessionsDir, 'sessions.json'), 'utf8')) as {
      sessions: Array<{ key: string; label?: string }>;
    };
    expect(stored.sessions[0]?.label).toBe('新名字ABC123');
  });

  it('rejects labels longer than 30 characters', async () => {
    const sessionsDir = join(tempRoot, 'agents', 'main', 'sessions');
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(
      join(sessionsDir, 'sessions.json'),
      JSON.stringify({ sessions: [{ key: 'agent:main:session-1' }] }, null, 2),
      'utf8',
    );
    parseJsonBodyMock.mockResolvedValueOnce({
      sessionKey: 'agent:main:session-1',
      label: '1234567890123456789012345678901',
    });

    const { handleSessionRoutes } = await import('@electron/api/routes/sessions');
    const handled = await handleSessionRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/sessions/rename'),
      {} as never,
    );

    expect(handled).toBe(true);
    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      400,
      expect.objectContaining({ success: false }),
    );
  });
});
