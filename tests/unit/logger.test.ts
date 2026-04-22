import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockExistsSync,
  mockMkdirSync,
  mockAppendFileSync,
  mockStatSync,
  mockAppendFile,
  mockOpen,
  mockReadFile,
  mockReaddir,
  mockStat,
  mockUnlink,
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockMkdirSync: vi.fn(),
  mockAppendFileSync: vi.fn(),
  mockStatSync: vi.fn(),
  mockAppendFile: vi.fn(),
  mockOpen: vi.fn(),
  mockReadFile: vi.fn(),
  mockReaddir: vi.fn(),
  mockStat: vi.fn(),
  mockUnlink: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: vi.fn(() => '/tmp/deep-ai-worker-tests'),
    getVersion: vi.fn(() => '0.0.0-test'),
  },
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: mockExistsSync,
    mkdirSync: mockMkdirSync,
    appendFileSync: mockAppendFileSync,
    statSync: mockStatSync,
  };
});

vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises');
  return {
    ...actual,
    appendFile: mockAppendFile,
    open: mockOpen,
    readFile: mockReadFile,
    readdir: mockReaddir,
    stat: mockStat,
    unlink: mockUnlink,
  };
});

describe('logger console fallback', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    mockExistsSync.mockReturnValue(true);
    mockStatSync.mockImplementation(() => {
      throw new Error('missing');
    });
    mockAppendFile.mockResolvedValue(undefined);
    mockReaddir.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not throw when console.error fails with EPIPE', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {
      const error = new Error('broken pipe') as NodeJS.ErrnoException;
      error.code = 'EPIPE';
      throw error;
    });

    const loggerModule = await import('@electron/utils/logger');

    expect(() => {
      loggerModule.error('Main process failure', new Error('root cause'));
    }).not.toThrow();

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(loggerModule.getRecentLogs().at(-1)).toContain('Main process failure');
  });

  it('keeps initLogger safe when initialization fails and console is unavailable', async () => {
    mockExistsSync.mockImplementation(() => {
      throw new Error('userData unavailable');
    });

    vi.spyOn(console, 'error').mockImplementation(() => {
      const error = new Error('broken pipe') as NodeJS.ErrnoException;
      error.code = 'EPIPE';
      throw error;
    });

    const loggerModule = await import('@electron/utils/logger');

    expect(() => {
      loggerModule.initLogger();
    }).not.toThrow();
  });
});
