import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const FULLY_INJECTED_PREVIEW_TEXT = 'Only this sentence should be shown in the preview.';

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

  it('persists an auto-generated session label when one is missing', async () => {
    const sessionsDir = join(tempRoot, 'agents', 'main', 'sessions');
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(
      join(sessionsDir, 'sessions.json'),
      JSON.stringify({
        sessions: [
          { key: 'agent:main:session-1', updatedAt: 1 },
        ],
      }, null, 2),
      'utf8',
    );
    parseJsonBodyMock.mockResolvedValueOnce({
      sessionKey: 'agent:main:session-1',
      label: 'Auto generated title',
    });

    const { handleSessionRoutes } = await import('@electron/api/routes/sessions');
    const handled = await handleSessionRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/sessions/auto-label'),
      {} as never,
    );

    expect(handled).toBe(true);
    expect(sendJsonMock).toHaveBeenLastCalledWith(expect.anything(), 200, {
      success: true,
      label: 'Auto generated title',
      persisted: true,
    });

    const stored = JSON.parse(await readFile(join(sessionsDir, 'sessions.json'), 'utf8')) as {
      sessions: Array<{ key: string; label?: string }>;
    };
    expect(stored.sessions[0]?.label).toBe('Auto generated title');
  });

  it('does not overwrite an existing persisted session label during auto-label sync', async () => {
    const sessionsDir = join(tempRoot, 'agents', 'main', 'sessions');
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(
      join(sessionsDir, 'sessions.json'),
      JSON.stringify({
        sessions: [
          { key: 'agent:main:session-1', label: 'Pinned title', updatedAt: 1 },
        ],
      }, null, 2),
      'utf8',
    );
    parseJsonBodyMock.mockResolvedValueOnce({
      sessionKey: 'agent:main:session-1',
      label: 'Auto generated title',
    });

    const { handleSessionRoutes } = await import('@electron/api/routes/sessions');
    const handled = await handleSessionRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/sessions/auto-label'),
      {} as never,
    );

    expect(handled).toBe(true);
    expect(sendJsonMock).toHaveBeenLastCalledWith(expect.anything(), 200, {
      success: true,
      label: 'Pinned title',
      persisted: false,
    });

    const stored = JSON.parse(await readFile(join(sessionsDir, 'sessions.json'), 'utf8')) as {
      sessions: Array<{ key: string; label?: string }>;
    };
    expect(stored.sessions[0]?.label).toBe('Pinned title');
  });

  it('persists pin and unpin metadata in sessions.json', async () => {
    const sessionsDir = join(tempRoot, 'agents', 'main', 'sessions');
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(
      join(sessionsDir, 'sessions.json'),
      JSON.stringify({
        sessions: [
          { key: 'agent:main:session-1', label: 'Pinned me', updatedAt: 1 },
        ],
      }, null, 2),
      'utf8',
    );

    parseJsonBodyMock.mockResolvedValueOnce({
      sessionKey: 'agent:main:session-1',
      pinned: true,
      pinOrder: 3,
    });

    const { handleSessionRoutes } = await import('@electron/api/routes/sessions');
    let handled = await handleSessionRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/sessions/pin'),
      {} as never,
    );

    expect(handled).toBe(true);
    expect(sendJsonMock).toHaveBeenLastCalledWith(expect.anything(), 200, {
      success: true,
      pinned: true,
      pinOrder: 3,
    });

    let stored = JSON.parse(await readFile(join(sessionsDir, 'sessions.json'), 'utf8')) as {
      sessions: Array<{ key: string; pinned?: boolean; pinOrder?: number }>;
    };
    expect(stored.sessions[0]).toMatchObject({ pinned: true, pinOrder: 3 });

    parseJsonBodyMock.mockResolvedValueOnce({
      sessionKey: 'agent:main:session-1',
      pinned: false,
    });

    handled = await handleSessionRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/sessions/pin'),
      {} as never,
    );

    expect(handled).toBe(true);
    expect(sendJsonMock).toHaveBeenLastCalledWith(expect.anything(), 200, {
      success: true,
      pinned: false,
      pinOrder: undefined,
    });

    stored = JSON.parse(await readFile(join(sessionsDir, 'sessions.json'), 'utf8')) as {
      sessions: Array<{ key: string; pinned?: boolean; pinOrder?: number }>;
    };
    expect(stored.sessions[0]?.pinned).toBeUndefined();
    expect(stored.sessions[0]?.pinOrder).toBeUndefined();
  });

  it('persists archive metadata in sessions.json and clears it when restored', async () => {
    const sessionsDir = join(tempRoot, 'agents', 'main', 'sessions');
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(
      join(sessionsDir, 'sessions.json'),
      JSON.stringify({
        sessions: [
          { key: 'agent:main:session-1', label: 'Archive me', updatedAt: 1, createdAt: 1 },
        ],
      }, null, 2),
      'utf8',
    );

    parseJsonBodyMock.mockResolvedValueOnce({
      sessionKey: 'agent:main:session-1',
      archived: true,
    });

    const { handleSessionRoutes } = await import('@electron/api/routes/sessions');
    let handled = await handleSessionRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/sessions/archive'),
      {} as never,
    );

    expect(handled).toBe(true);
    expect(sendJsonMock).toHaveBeenLastCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({ success: true, archived: true }),
    );

    let stored = JSON.parse(await readFile(join(sessionsDir, 'sessions.json'), 'utf8')) as {
      sessions: Array<{ key: string; archived?: boolean; archivedAt?: number }>;
    };
    expect(stored.sessions[0]).toMatchObject({ archived: true });
    expect(typeof stored.sessions[0]?.archivedAt).toBe('number');

    parseJsonBodyMock.mockResolvedValueOnce({
      sessionKey: 'agent:main:session-1',
      archived: false,
    });

    handled = await handleSessionRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/sessions/archive'),
      {} as never,
    );

    expect(handled).toBe(true);
    expect(sendJsonMock).toHaveBeenLastCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({ success: true, archived: false }),
    );

    stored = JSON.parse(await readFile(join(sessionsDir, 'sessions.json'), 'utf8')) as {
      sessions: Array<{ key: string; archived?: boolean; archivedAt?: number }>;
    };
    expect(stored.sessions[0]?.archived).toBeUndefined();
    expect(stored.sessions[0]?.archivedAt).toBeUndefined();
  });

  it('persists a session model override in sessions.json', async () => {
    const sessionsDir = join(tempRoot, 'agents', 'main', 'sessions');
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(
      join(sessionsDir, 'sessions.json'),
      JSON.stringify({
        sessions: [
          { key: 'agent:main:session-1', label: 'Pinned me', updatedAt: 1 },
        ],
      }, null, 2),
      'utf8',
    );

    parseJsonBodyMock.mockResolvedValueOnce({
      sessionKey: 'agent:main:session-1',
      modelRef: 'custom-custombc/qwen3.5-plus',
    });

    const { handleSessionRoutes } = await import('@electron/api/routes/sessions');
    const handled = await handleSessionRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/sessions/model'),
      {} as never,
    );

    expect(handled).toBe(true);
    expect(sendJsonMock).toHaveBeenLastCalledWith(expect.anything(), 200, {
      success: true,
      modelRef: 'custom-custombc/qwen3.5-plus',
    });

    const stored = JSON.parse(await readFile(join(sessionsDir, 'sessions.json'), 'utf8')) as {
      sessions: Array<{
        key: string;
        model?: string;
        modelProvider?: string;
        modelOverride?: string;
        providerOverride?: string;
      }>;
    };
    expect(stored.sessions[0]).toMatchObject({
      model: 'qwen3.5-plus',
      modelProvider: 'custom-custombc',
      modelOverride: 'qwen3.5-plus',
      providerOverride: 'custom-custombc',
    });
  });

  it('returns first-user previews without reading full chat history through the gateway', async () => {
    const sessionsDir = join(tempRoot, 'agents', 'main', 'sessions');
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(
      join(sessionsDir, 'sessions.json'),
      JSON.stringify({
        sessions: [
          {
            key: 'agent:main:session-preview',
            file: 'session-preview.jsonl',
            updatedAt: 1,
          },
        ],
      }, null, 2),
      'utf8',
    );
    await writeFile(
      join(sessionsDir, 'session-preview.jsonl'),
      [
        JSON.stringify({
          message: {
            role: 'assistant',
            content: 'Previous reply',
          },
        }),
        JSON.stringify({
          message: {
            role: 'user',
            content: [{
              type: 'text',
              text: [
                'Pre-compaction memory flush. Store durable memories only in memory/2026-04-15.md (create memory/ if needed).',
                'Treat workspace bootstrap/reference files such as MEMORY.md, SOUL.md, TOOLS.md, and AGENTS.md as read-only during this flush; never overwrite, replace, or edit them.',
                'If memory/2026-04-15.md already exists, APPEND new content only and do not overwrite existing entries.',
                'Do NOT create timestamped variant files (e.g., 2026-04-15-HHMM.md); always use the canonical 2026-04-15.md filename.',
                'If nothing to store, reply with NO_REPLY.',
              ].join('\n'),
            }],
          },
        }),
        JSON.stringify({
          message: {
            role: 'user',
            content: [{
              type: 'text',
              text: 'Sender (untrusted metadata):\n```json\n{"label":"ClawX"}\n```\n\n[Fri 2026-04-03 14:35 GMT+8] Preview me please',
            }],
          },
        }),
      ].join('\n'),
      'utf8',
    );
    parseJsonBodyMock.mockResolvedValueOnce({
      sessionKeys: ['agent:main:session-preview'],
    });

    const { handleSessionRoutes } = await import('@electron/api/routes/sessions');
    const handled = await handleSessionRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/sessions/previews'),
      {} as never,
    );

    expect(handled).toBe(true);
    expect(sendJsonMock).toHaveBeenLastCalledWith(expect.anything(), 200, {
      success: true,
      previews: {
        'agent:main:session-preview': {
          firstUserMessage: 'Preview me please',
        },
      },
    });
  });

  it('strips AGENTS, attachment, and execution preludes from preview labels', async () => {
    const sessionsDir = join(tempRoot, 'agents', 'main', 'sessions');
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(
      join(sessionsDir, 'sessions.json'),
      JSON.stringify({
        sessions: [
          {
            key: 'agent:main:session-injected-preview',
            file: 'session-injected-preview.jsonl',
            updatedAt: 1,
          },
        ],
      }, null, 2),
      'utf8',
    );
    await writeFile(
      join(sessionsDir, 'session-injected-preview.jsonl'),
      [
        JSON.stringify({
          message: {
            role: 'user',
            content: [{
              type: 'text',
              text: [
                '[media attached 1/2: C:/Users/Administrator/.openclaw/media/inbound/test-image-a.png (image/png)]',
                '[media attached 2/2: C:/Users/Administrator/.openclaw/media/inbound/test-image-b.webp (image/webp)]',
                '# AGENTS.md instructions for D:/AI/Deep AI Worker/ClawX',
                '',
                '<INSTRUCTIONS>',
                'Use the repository playbook before responding.',
                '</INSTRUCTIONS>',
                '<environment_context>',
                '  <cwd>D:/AI/Deep AI Worker/ClawX</cwd>',
                '  <shell>powershell</shell>',
                '</environment_context>',
                'To send an image back, prefer the message tool (media/path/filePath). If you must inline, use MEDIA:https://example.com/image.jpg (spaces ok, quote if needed) or a safe relative path like MEDIA:./image.jpg. Absolute and ~ paths only work when they stay inside your allowed file-read boundary; host file:// URLs are blocked. Keep caption in the text body.',
                'Only the files listed in the current attachment note for this turn are newly uploaded inputs for this request. Do not automatically inspect older uploaded files, prior-turn attachments, or unrelated workspace files unless the user explicitly asks for them or the current file directly points to them.',
                'When the current turn includes uploaded attachments, resolve references like "this", "this file", "this output", "这个", "这个文件", and "这个输出" against the current turn attachment set first. Do not default those references to prior assistant outputs, earlier uploaded files, or historical workspace artifacts.',
                'This turn has 2 uploaded attachments, so stay within that current attachment set unless the user explicitly names an earlier file. Do not summarize prior assistant outputs when the current turn attachment set is present unless the user explicitly asks for that earlier output.',
                'Sender (untrusted metadata):',
                '```json',
                '{"label":"Deep AI Worker","id":"gateway-client","name":"Deep AI Worker"}',
                '```',
                '',
                '[Wed 2026-04-22 19:54 GMT+8] Conversation info (untrusted metadata): ```json',
                '{"agent":{"id":"main","name":"Main Role","preferredModel":"custom-custombc/qwen3.5-plus"}}',
                '```',
                'Execution playbook:',
                '- You are currently acting as "Main Role" (ID: main).',
                '- Preferred model: custom-custombc/qwen3.5-plus',
                '- If tools are unavailable, explain the block instead of fabricating.',
                '',
                FULLY_INJECTED_PREVIEW_TEXT,
              ].join('\n'),
            }],
          },
        }),
      ].join('\n'),
      'utf8',
    );
    parseJsonBodyMock.mockResolvedValueOnce({
      sessionKeys: ['agent:main:session-injected-preview'],
    });

    const { handleSessionRoutes } = await import('@electron/api/routes/sessions');
    const handled = await handleSessionRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/sessions/previews'),
      {} as never,
    );

    expect(handled).toBe(true);
    expect(sendJsonMock).toHaveBeenLastCalledWith(expect.anything(), 200, {
      success: true,
      previews: {
        'agent:main:session-injected-preview': {
          firstUserMessage: FULLY_INJECTED_PREVIEW_TEXT,
        },
      },
    });
  });

  it('sanitizes stored injected first-user previews before returning them', async () => {
    const sessionsDir = join(tempRoot, 'agents', 'main', 'sessions');
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(
      join(sessionsDir, 'sessions.json'),
      JSON.stringify({
        sessions: [
          {
            key: 'agent:main:session-stored-preview',
            file: 'session-stored-preview.jsonl',
            updatedAt: 1,
            firstUserMessagePreview: [
              '[media attached 1/2: C:/Users/Administrator/.openclaw/media/inbound/test-image-a.png (image/png)]',
              'Sender (untrusted metadata):',
              '```json',
              '{"label":"Deep AI Worker"}',
              '```',
              '',
              'Execution playbook:',
              '- Preferred model: custom-custombc/qwen3.5-plus',
              '',
              FULLY_INJECTED_PREVIEW_TEXT,
            ].join('\n'),
          },
        ],
      }, null, 2),
      'utf8',
    );
    parseJsonBodyMock.mockResolvedValueOnce({
      sessionKeys: ['agent:main:session-stored-preview'],
    });

    const { handleSessionRoutes } = await import('@electron/api/routes/sessions');
    const handled = await handleSessionRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/sessions/previews'),
      {} as never,
    );

    expect(handled).toBe(true);
    expect(sendJsonMock).toHaveBeenLastCalledWith(expect.anything(), 200, {
      success: true,
      previews: {
        'agent:main:session-stored-preview': {
          firstUserMessage: FULLY_INJECTED_PREVIEW_TEXT,
        },
      },
    });
  });

  it('lists recoverable sessions even when sessions.json contains a malformed entry', async () => {
    const sessionsDir = join(tempRoot, 'agents', 'main', 'sessions');
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(
      join(sessionsDir, 'sessions.json'),
      `{
  "agent:main:session-old": {
    "sessionId": "session-old",
    "file": "session-old.jsonl",
    "label": "Older session",
    "updatedAt": 1000
  },
  "agent:main:broken": {
    "sessionId": "broken",
    "file": "broken.jsonl",
    "toolSnapshot": {
      "source": "oops",
      invalid
    }
  },
  "agent:main:session-new": {
    "sessionId": "session-new",
    "file": "session-new.jsonl",
    "updatedAt": 2000
  }
}`,
      'utf8',
    );
    await writeFile(join(sessionsDir, 'session-old.jsonl'), '', 'utf8');
    await writeFile(join(sessionsDir, 'session-new.jsonl'), '', 'utf8');

    const { handleSessionRoutes } = await import('@electron/api/routes/sessions');
    const handled = await handleSessionRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/sessions/list'),
      {} as never,
    );

    expect(handled).toBe(true);
    expect(sendJsonMock).toHaveBeenLastCalledWith(expect.anything(), 200, {
      success: true,
      sessions: [
        {
          key: 'agent:main:session-new',
          createdAt: expect.any(Number),
          updatedAt: 2000,
          archived: undefined,
          pinned: undefined,
          pinOrder: undefined,
        },
        {
          key: 'agent:main:session-old',
          label: 'Older session',
          createdAt: expect.any(Number),
          updatedAt: 1000,
          archived: undefined,
          pinned: undefined,
          pinOrder: undefined,
        },
      ],
    });

    const repaired = JSON.parse(await readFile(join(sessionsDir, 'sessions.json'), 'utf8')) as Record<string, {
      sessionId?: string;
      file?: string;
      label?: string;
      updatedAt?: number;
    }>;
    expect(Object.keys(repaired)).toEqual([
      'agent:main:session-old',
      'agent:main:session-new',
    ]);
    expect(repaired['agent:main:session-old']).toMatchObject({
      sessionId: 'session-old',
      file: 'session-old.jsonl',
      label: 'Older session',
      updatedAt: 1000,
    });
    expect(repaired['agent:main:session-new']).toMatchObject({
      sessionId: 'session-new',
      file: 'session-new.jsonl',
      updatedAt: 2000,
    });
    await expect(readFile(join(sessionsDir, 'sessions.json.malformed.bak'), 'utf8')).resolves.toContain('"agent:main:broken"');
  });

  it('repairs a malformed session store before persisting an auto-generated label', async () => {
    const sessionsDir = join(tempRoot, 'agents', 'main', 'sessions');
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(
      join(sessionsDir, 'sessions.json'),
      `{
  "agent:main:session-1": {
    "sessionId": "session-1",
    "file": "session-1.jsonl",
    "updatedAt": 1,
    "skillsSnapshot": {
      "source": "broken"
    }
  },
  "agent:main:broken": {
    "sessionId": "broken",
    "file": "broken.jsonl",
    "skillsSnapshot": {
      "source": "oops",
      invalid
    }
  }
}`,
      'utf8',
    );
    parseJsonBodyMock.mockResolvedValueOnce({
      sessionKey: 'agent:main:session-1',
      label: 'Recovered title',
    });

    const { handleSessionRoutes } = await import('@electron/api/routes/sessions');
    const handled = await handleSessionRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/sessions/auto-label'),
      {} as never,
    );

    expect(handled).toBe(true);
    expect(sendJsonMock).toHaveBeenLastCalledWith(expect.anything(), 200, {
      success: true,
      label: 'Recovered title',
      persisted: true,
    });

    const stored = JSON.parse(await readFile(join(sessionsDir, 'sessions.json'), 'utf8')) as Record<string, {
      label?: string;
    }>;
    expect(stored['agent:main:session-1']?.label).toBe('Recovered title');
    expect(stored['agent:main:broken']).toBeUndefined();
  });

  it('returns recent transcript messages from the local session history route', async () => {
    const sessionsDir = join(tempRoot, 'agents', 'main', 'sessions');
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(
      join(sessionsDir, 'sessions.json'),
      JSON.stringify({
        'agent:main:session-history': {
          sessionId: 'session-history',
          sessionFile: join(sessionsDir, 'session-history.jsonl'),
        },
      }, null, 2),
      'utf8',
    );
    await writeFile(
      join(sessionsDir, 'session-history.jsonl'),
      [
        JSON.stringify({ type: 'session', id: 'session-start' }),
        JSON.stringify({ type: 'thinking_level_change', id: 'thinking-1', thinkingLevel: 'high' }),
        JSON.stringify({
          type: 'message',
          id: 'assistant-old',
          timestamp: '2026-04-03T06:35:41.310Z',
          message: {
            role: 'assistant',
            content: 'Earlier reply',
          },
        }),
        JSON.stringify({
          type: 'message',
          id: 'user-latest',
          timestamp: '2026-04-03T06:36:16.874Z',
          message: {
            role: 'user',
            content: [{ type: 'text', text: 'Latest question' }],
          },
        }),
        JSON.stringify({
          type: 'compaction',
          id: 'compaction-1',
          timestamp: '2026-04-03T06:36:20.000Z',
        }),
        JSON.stringify({
          type: 'message',
          id: 'assistant-latest',
          timestamp: '2026-04-03T06:36:32.349Z',
          message: {
            role: 'assistant',
            content: 'Latest reply',
          },
        }),
      ].join('\n'),
      'utf8',
    );
    parseJsonBodyMock.mockResolvedValueOnce({
      sessionKey: 'agent:main:session-history',
      limit: 3,
    });

    const { handleSessionRoutes } = await import('@electron/api/routes/sessions');
    const handled = await handleSessionRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/sessions/history'),
      {} as never,
    );

    expect(handled).toBe(true);
    expect(sendJsonMock).toHaveBeenLastCalledWith(expect.anything(), 200, {
      success: true,
      resolved: true,
      thinkingLevel: 'high',
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Latest question' }],
          id: 'user-latest',
          timestamp: Date.parse('2026-04-03T06:36:16.874Z'),
        },
        {
          role: 'system',
          content: [{ type: 'text', text: 'Compaction' }],
          id: 'compaction-1',
          timestamp: Date.parse('2026-04-03T06:36:20.000Z'),
        },
        {
          role: 'assistant',
          content: 'Latest reply',
          id: 'assistant-latest',
          timestamp: Date.parse('2026-04-03T06:36:32.349Z'),
        },
      ],
    });
  });

  it('returns recent transcript messages when the transcript stores direct message rows', async () => {
    const sessionsDir = join(tempRoot, 'agents', 'main', 'sessions');
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(
      join(sessionsDir, 'sessions.json'),
      JSON.stringify({
        'agent:main:raw-session-history': {
          sessionId: 'raw-session-history',
          file: 'raw-session-history.jsonl',
        },
      }, null, 2),
      'utf8',
    );
    await writeFile(
      join(sessionsDir, 'raw-session-history.jsonl'),
      [
        JSON.stringify({
          id: 'user-1',
          role: 'user',
          content: 'Who are you?',
          timestamp: 1_712_000_000,
        }),
        JSON.stringify({
          id: 'assistant-1',
          role: 'assistant',
          content: 'I am ClawX.',
          timestamp: 1_712_000_001,
        }),
      ].join('\n'),
      'utf8',
    );
    parseJsonBodyMock.mockResolvedValueOnce({
      sessionKey: 'agent:main:raw-session-history',
      limit: 10,
    });

    const { handleSessionRoutes } = await import('@electron/api/routes/sessions');
    const handled = await handleSessionRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/sessions/history'),
      {} as never,
    );

    expect(handled).toBe(true);
    expect(sendJsonMock).toHaveBeenLastCalledWith(expect.anything(), 200, {
      success: true,
      resolved: true,
      thinkingLevel: null,
      messages: [
        {
          id: 'user-1',
          role: 'user',
          content: 'Who are you?',
          timestamp: 1_712_000_000,
        },
        {
          id: 'assistant-1',
          role: 'assistant',
          content: 'I am ClawX.',
          timestamp: 1_712_000_001,
        },
      ],
    });
  });

  it('returns persisted session metadata for requested session keys', async () => {
    const sessionsDir = join(tempRoot, 'agents', 'main', 'sessions');
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(
      join(sessionsDir, 'sessions.json'),
      JSON.stringify({
        sessions: [
          { key: 'agent:main:session-1', label: 'Pinned me', pinned: true, pinOrder: 2, updatedAt: 1, archived: true, archivedAt: 10, createdAt: 1 },
          { key: 'agent:main:session-2', label: 'Normal', updatedAt: 2 },
        ],
      }, null, 2),
      'utf8',
    );
    parseJsonBodyMock.mockResolvedValueOnce({
      sessionKeys: ['agent:main:session-1', 'agent:main:session-2', 'agent:main:missing'],
    });

    const { handleSessionRoutes } = await import('@electron/api/routes/sessions');
    const handled = await handleSessionRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/sessions/metadata'),
      {} as never,
    );

    expect(handled).toBe(true);
    expect(sendJsonMock).toHaveBeenLastCalledWith(expect.anything(), 200, {
      success: true,
      metadata: {
        'agent:main:session-1': { pinned: true, pinOrder: 2, archived: true, archivedAt: 10, createdAt: 1 },
        'agent:main:session-2': { pinned: undefined, pinOrder: undefined },
      },
    });
  });

  it('lists archived sessions from the dedicated archive route', async () => {
    const sessionsDir = join(tempRoot, 'agents', 'main', 'sessions');
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(
      join(sessionsDir, 'sessions.json'),
      JSON.stringify({
        sessions: [
          {
            key: 'agent:main:session-archived',
            file: 'session-archived.jsonl',
            label: 'Archived session',
            archived: true,
            archivedAt: 200,
            createdAt: 100,
          },
          {
            key: 'agent:main:session-active',
            file: 'session-active.jsonl',
            label: 'Active session',
            updatedAt: 300,
          },
        ],
      }, null, 2),
      'utf8',
    );
    await writeFile(join(sessionsDir, 'session-archived.jsonl'), '', 'utf8');
    await writeFile(join(sessionsDir, 'session-active.jsonl'), '', 'utf8');

    const { handleSessionRoutes } = await import('@electron/api/routes/sessions');
    const handled = await handleSessionRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/sessions/archived'),
      {} as never,
    );

    expect(handled).toBe(true);
    expect(sendJsonMock).toHaveBeenLastCalledWith(expect.anything(), 200, expect.objectContaining({
      success: true,
      sessions: [
        expect.objectContaining({
          key: 'agent:main:session-archived',
          label: 'Archived session',
          archived: true,
          archivedAt: 200,
          createdAt: 100,
        }),
      ],
    }));
  });
});
