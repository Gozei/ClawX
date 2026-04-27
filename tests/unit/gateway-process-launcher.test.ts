import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockAppIsPackaged,
  mockExistsSync,
  mockWriteFileSync,
  mockAppendNodeRequireToNodeOptions,
  mockUtilityProcessFork,
} = vi.hoisted(() => ({
  mockAppIsPackaged: { value: false },
  mockExistsSync: vi.fn().mockReturnValue(true),
  mockWriteFileSync: vi.fn(),
  mockAppendNodeRequireToNodeOptions: vi.fn().mockReturnValue('--require "/tmp/preload.cjs"'),
  mockUtilityProcessFork: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    get isPackaged() { return mockAppIsPackaged.value; },
    getPath: () => '/tmp',
  },
  utilityProcess: {
    fork: mockUtilityProcessFork,
  },
}));

vi.mock('fs', () => ({
  __esModule: true,
  default: {
    existsSync: mockExistsSync,
    writeFileSync: mockWriteFileSync,
  },
  existsSync: mockExistsSync,
  writeFileSync: mockWriteFileSync,
}));

vi.mock('path', () => ({
  default: {
    join: (...args: string[]) => args.join('/'),
  },
  join: (...args: string[]) => args.join('/'),
}));

vi.mock('@electron/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@electron/utils/paths', () => ({
  appendNodeRequireToNodeOptions: mockAppendNodeRequireToNodeOptions,
}));

vi.mock('../../shared/branding', () => ({
  DEFAULT_BRANDING: { requestTitle: 'TestApp', productName: 'TestApp' },
}));

vi.mock('./config-sync', () => ({
  prepareGatewayLaunchContext: vi.fn(),
}));

vi.mock('./process-policy', () => ({
  DEFAULT_RECONNECT_CONFIG: {},
}));

import { launchGatewayProcess } from '@electron/gateway/process-launcher';

function createLaunchContext() {
  return {
    openclawDir: '/tmp/openclaw',
    entryScript: '/tmp/entry.js',
    gatewayArgs: ['--port', '18789'],
    forkEnv: { PATH: '/usr/bin' },
    mode: 'bundled' as const,
    binPathExists: true,
    loadedProviderKeyCount: 0,
    proxySummary: 'none',
    channelStartupSummary: 'none',
    discoverySummary: 'none',
    appSettings: { gatewayToken: '' },
  };
}

function createOptions() {
  return {
    port: 18789,
    launchContext: createLaunchContext(),
    sanitizeSpawnArgs: (args: string[]) => args,
    getCurrentState: () => 'stopped' as const,
    getShouldReconnect: () => true,
    onStderrLine: vi.fn(),
    onSpawn: vi.fn(),
    onExit: vi.fn(),
    onError: vi.fn(),
  };
}

describe('launchGatewayProcess — preload injection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAppIsPackaged.value = false;
    mockExistsSync.mockReturnValue(true);
    mockAppendNodeRequireToNodeOptions.mockReturnValue('--require "/tmp/preload.cjs"');

    mockUtilityProcessFork.mockImplementation(() => {
      const child = {
        on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
          if (event === 'spawn') {
            setTimeout(() => handler(), 0);
          }
          return child;
        }),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        pid: 1234,
      };
      return child;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses NODE_OPTIONS --require in dev mode (isPackaged=false)', async () => {
    mockAppIsPackaged.value = false;

    await launchGatewayProcess(createOptions());

    expect(mockAppendNodeRequireToNodeOptions).toHaveBeenCalled();
    const forkCall = mockUtilityProcessFork.mock.calls[0];
    const forkOpts = forkCall[2] as Record<string, unknown>;
    expect(forkOpts.execArgv).toEqual([]);
  });

  it('uses execArgv --require in production build (isPackaged=true)', async () => {
    mockAppIsPackaged.value = true;
    const opts = createOptions();

    await launchGatewayProcess(opts);

    expect(mockAppendNodeRequireToNodeOptions).not.toHaveBeenCalled();
    const forkCall = mockUtilityProcessFork.mock.calls[0];
    const forkOpts = forkCall[2] as Record<string, unknown>;
    expect(forkOpts.execArgv).toEqual(['--require', expect.stringContaining('gateway-fetch-preload.cjs')]);
  });

  it('passes empty execArgv when preload file does not exist', async () => {
    mockAppIsPackaged.value = true;
    mockExistsSync.mockReturnValue(false);
    const opts = createOptions();

    await launchGatewayProcess(opts);

    expect(mockExistsSync).toHaveBeenCalled();
    const forkCall = mockUtilityProcessFork.mock.calls[0];
    const forkOpts = forkCall[2] as Record<string, unknown>;
    expect(forkOpts.execArgv).toEqual([]);
  });

  it('gracefully handles preload write failure', async () => {
    mockAppIsPackaged.value = true;
    mockWriteFileSync.mockImplementation(() => {
      throw new Error('disk full');
    });
    mockExistsSync.mockReturnValue(false);
    const opts = createOptions();

    await launchGatewayProcess(opts);

    const forkCall = mockUtilityProcessFork.mock.calls[0];
    const forkOpts = forkCall[2] as Record<string, unknown>;
    expect(forkOpts.execArgv).toEqual([]);
  });

  it('forwards stdout lines when the Gateway emits diagnostic output', async () => {
    const opts = createOptions();
    const onStdoutLine = vi.fn();

    await launchGatewayProcess({ ...opts, onStdoutLine });

    const child = mockUtilityProcessFork.mock.results[0]?.value as {
      stdout: { on: ReturnType<typeof vi.fn> };
    };
    const stdoutHandler = child.stdout.on.mock.calls.find(([event]) => event === 'data')?.[1] as
      | ((data: Buffer) => void)
      | undefined;

    expect(stdoutHandler).toBeTypeOf('function');
    stdoutHandler?.(Buffer.from('[clawx-boot] phase=ready\nplain line\n'));

    expect(onStdoutLine).toHaveBeenCalledWith('[clawx-boot] phase=ready');
    expect(onStdoutLine).toHaveBeenCalledWith('plain line');
  });
});
