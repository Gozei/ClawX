import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalPlatform = process.platform;

const {
  mockExec,
  mockCreateServer,
} = vi.hoisted(() => ({
  mockExec: vi.fn(),
  mockCreateServer: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp',
  },
  utilityProcess: {},
}));

vi.mock('child_process', () => ({
  exec: mockExec,
  execSync: vi.fn(),
  spawn: vi.fn(),
  default: {
    exec: mockExec,
    execSync: vi.fn(),
    spawn: vi.fn(),
  },
}));

vi.mock('net', () => ({
  createServer: mockCreateServer,
}));

class MockUtilityChild extends EventEmitter {
  pid?: number;
  kill = vi.fn();

  constructor(pid?: number) {
    super();
    this.pid = pid;
  }
}

function setPlatform(platform: string): void {
  Object.defineProperty(process, 'platform', { value: platform, writable: true });
}

describe('gateway supervisor process cleanup', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    mockExec.mockImplementation((_cmd: string, _opts: object, cb: (err: Error | null, stdout: string) => void) => {
      cb(null, '');
      return {} as never;
    });

    mockCreateServer.mockImplementation(() => {
      const handlers = new Map<string, (...args: unknown[]) => void>();
      return {
        once(event: string, callback: (...args: unknown[]) => void) {
          handlers.set(event, callback);
          return this;
        },
        listen() {
          queueMicrotask(() => handlers.get('listening')?.());
          return this;
        },
        close(callback?: () => void) {
          callback?.();
        },
      };
    });
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true });
  });

  it('uses taskkill tree strategy for owned process on Windows', async () => {
    setPlatform('win32');
    const child = new MockUtilityChild(4321);
    const { terminateOwnedGatewayProcess } = await import('@electron/gateway/supervisor');

    const stopPromise = terminateOwnedGatewayProcess(child as unknown as Electron.UtilityProcess);
    child.emit('exit', 0);
    await stopPromise;

    await vi.waitFor(() => {
      expect(mockExec).toHaveBeenCalledWith(
        'taskkill /F /PID 4321 /T',
        expect.objectContaining({ timeout: 5000, windowsHide: true }),
        expect.any(Function),
      );
    });
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('uses direct child.kill for owned process on non-Windows', async () => {
    setPlatform('linux');
    const child = new MockUtilityChild(9876);
    const { terminateOwnedGatewayProcess } = await import('@electron/gateway/supervisor');

    const stopPromise = terminateOwnedGatewayProcess(child as unknown as Electron.UtilityProcess);
    child.emit('exit', 0);
    await stopPromise;

    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it('waits for port release after orphan cleanup on Windows', async () => {
    setPlatform('win32');
    const { findExistingGatewayProcess } = await import('@electron/gateway/supervisor');

    mockExec.mockImplementation((cmd: string, _opts: object, cb: (err: Error | null, stdout: string) => void) => {
      if (cmd.includes('netstat -ano')) {
        cb(null, '  TCP    127.0.0.1:18789    0.0.0.0:0    LISTENING    4321\n');
        return {} as never;
      }
      cb(null, '');
      return {} as never;
    });

    const result = await findExistingGatewayProcess({ port: 18789 });
    expect(result).toBeNull();

    expect(mockExec).toHaveBeenCalledWith(
      expect.stringContaining('taskkill /F /PID 4321 /T'),
      expect.objectContaining({ timeout: 5000, windowsHide: true }),
      expect.any(Function),
    );
    expect(mockCreateServer).toHaveBeenCalled();
  });
});

describe('gateway doctor repair output logging', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('normalizes buffered doctor repair output lines', async () => {
    const { appendNormalizedOutputLines } = await import('@electron/gateway/supervisor');
    const lines: string[] = [];

    appendNormalizedOutputLines(lines, Buffer.from(' first line \n\nsecond line\r\n'));

    expect(lines).toEqual(['first line', 'second line']);
  });

  it('summarizes long doctor repair output instead of logging every line', async () => {
    const { summarizeBufferedOutput } = await import('@electron/gateway/supervisor');
    const lines = Array.from({ length: 15 }, (_, index) => `line-${index + 1}`);

    const summary = summarizeBufferedOutput(lines, 'stdout');

    expect(summary).toContain('stdout: line-1 | line-2');
    expect(summary).toContain('(+3 more lines)');
    expect(summary).not.toContain('line-15');
  });

  it('omits summaries for empty doctor repair output', async () => {
    const { summarizeBufferedOutput } = await import('@electron/gateway/supervisor');

    expect(summarizeBufferedOutput([], 'stdout')).toBe('');
  });
});

describe('waitForPortFree quickCheckFirst', () => {
  let listenCallCount: number;
  let nextListenAvailable: boolean;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    listenCallCount = 0;
    nextListenAvailable = true;

    mockExec.mockImplementation((_cmd: string, _opts: object, cb: (err: Error | null, stdout: string) => void) => {
      cb(null, '');
      return {} as never;
    });

    mockCreateServer.mockImplementation(() => {
      const handlers = new Map<string, (...args: unknown[]) => void>();
      const serverNum = ++listenCallCount;
      const isAvailable = serverNum === 1 ? nextListenAvailable : true;
      return {
        once(event: string, callback: (...args: unknown[]) => void) {
          handlers.set(event, callback);
          return this;
        },
        listen() {
          queueMicrotask(() => {
            if (isAvailable) {
              handlers.get('listening')?.();
            } else {
              handlers.get('error')?.(new Error('EADDRINUSE'));
            }
          });
          return this;
        },
        close(callback?: () => void) {
          callback?.();
        },
      };
    });
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true });
  });

  it('returns immediately when port is free with quickCheckFirst=true (default)', async () => {
    nextListenAvailable = true;
    setPlatform('win32');
    const { waitForPortFree } = await import('@electron/gateway/supervisor');

    const start = Date.now();
    await waitForPortFree(18789, 5000);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(500);
    expect(mockCreateServer).toHaveBeenCalledTimes(1);
  });

  it('enters polling when port is occupied and quickCheckFirst=true', async () => {
    nextListenAvailable = false;
    setPlatform('win32');

    let createServerCallCount = 0;
    mockCreateServer.mockImplementation(() => {
      createServerCallCount++;
      const handlers = new Map<string, (...args: unknown[]) => void>();
      const isFirstCall = createServerCallCount <= 2;
      return {
        once(event: string, callback: (...args: unknown[]) => void) {
          handlers.set(event, callback);
          return this;
        },
        listen() {
          queueMicrotask(() => {
            if (isFirstCall) {
              handlers.get('error')?.(new Error('EADDRINUSE'));
            } else {
              handlers.get('listening')?.();
            }
          });
          return this;
        },
        close(callback?: () => void) {
          callback?.();
        },
      };
    });

    const { waitForPortFree } = await import('@electron/gateway/supervisor');
    await waitForPortFree(18789, 5000);
    expect(createServerCallCount).toBeGreaterThanOrEqual(2);
  });

  it('skips quick check when quickCheckFirst=false', async () => {
    nextListenAvailable = true;
    setPlatform('win32');

    let createServerCallCount = 0;
    mockCreateServer.mockImplementation(() => {
      createServerCallCount++;
      const handlers = new Map<string, (...args: unknown[]) => void>();
      return {
        once(event: string, callback: (...args: unknown[]) => void) {
          handlers.set(event, callback);
          return this;
        },
        listen() {
          queueMicrotask(() => {
            handlers.get('listening')?.();
          });
          return this;
        },
        close(callback?: () => void) {
          callback?.();
        },
      };
    });

    const { waitForPortFree } = await import('@electron/gateway/supervisor');
    await waitForPortFree(18789, 5000, { quickCheckFirst: false });

    expect(createServerCallCount).toBeGreaterThanOrEqual(1);
  });
});
